import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	createThreadViewport,
	DRAG_RELEASE_MS,
	WEB_IDLE_MS,
} from "./thread-viewport";

const RELEASE = /releaseFollow\(\);/g;
const FRESH_PEOPLE = /\?\.people \?\? \[\]/;
const INITIAL_ANCHOR = /maintainVisibleContentPosition=\{\s*positioned/;
const ADMISSION_RECHECK =
	/useEffect\(\(\) => \{\s*if \(readyForPosition && items\.length > 0\) viewport\.current\?\.dataChanged\(\);\s*\}, \[items, readyForPosition\]\)/;

/**
 * A scroll host that behaves like the list's real one: offsets clamp to
 * [0, content - viewport], a programmatic move that changes nothing emits no
 * event, web can be read back synchronously and native reports only through a
 * later scroll event. Every list callback below is the controller's own
 * `handlers` object, the same object the screen spreads onto its FlatList.
 */
const host = ({ web }: { web: boolean }) => {
	let y = 0;
	let viewport = 0;
	let content = 0;
	const queued: number[] = [];
	const read = vi.fn();
	const positioned = vi.fn();
	const moves = vi.fn();
	const newBelow = vi.fn();
	let newest = 0;
	// Timers run only when a test advances them (re-check, hold release):
	// `runTimers` fires every pending one, `advanceClock` only those due.
	let clock = 0;
	const timers: Array<{ run: () => void; at: number }> = [];
	const v = createThreadViewport({
		schedule: (run, ms) => {
			const entry = { run, at: clock + ms };
			timers.push(entry);
			return () => {
				const i = timers.indexOf(entry);
				if (i >= 0) timers.splice(i, 1);
			};
		},
		newBelow,
		scrollTo: (offset) => {
			moves(offset);
			const next = Math.min(offset, Math.max(0, content - viewport));
			if (next === y) return web ? { y, viewport, content } : null;
			y = next;
			if (web) return { y, viewport, content };
			queued.push(y);
			return null;
		},
		positioned,
		read,
		newestSeq: () => newest,
		dataReady: () => true,
		web,
	});
	const event = () => ({
		nativeEvent: {
			contentOffset: { y },
			layoutMeasurement: { height: viewport },
			contentSize: { height: content },
		},
	});
	const h = v.handlers as typeof v.handlers & {
		onWheel?: () => void;
		onPointerDown?: () => void;
		onKeyDown?: (e: {
			key: string;
			target?: unknown;
			currentTarget?: unknown;
		}) => void;
	};
	return {
		v,
		h,
		read,
		positioned,
		moves,
		newBelow,
		/** Run every pending timer once (re-check, drag-release grace). */
		runTimers() {
			for (const { run } of timers.splice(0)) run();
		},
		advanceClock(ms: number) {
			clock += ms;
			for (const entry of timers.filter((t) => t.at <= clock)) {
				const i = timers.indexOf(entry);
				if (i < 0) continue;
				timers.splice(i, 1);
				entry.run();
			}
		},
		get timers() {
			return timers.length;
		},
		set newest(seq: number) {
			newest = seq;
		},
		get y() {
			return y;
		},
		get bottom() {
			return y + viewport;
		},
		layout(height: number) {
			viewport = height;
			h.onLayout({ nativeEvent: { layout: { height } } });
		},
		grow(height: number) {
			content = height;
			h.onContentSizeChange(390, height);
		},
		/** Deliver the native scroll events a programmatic move produced. */
		flush(staleContent?: number, count = queued.length) {
			for (const at of queued.splice(0, count)) {
				const e = event();
				e.nativeEvent.contentOffset.y = at;
				if (staleContent) e.nativeEvent.contentSize.height = staleContent;
				h.onScroll(e);
			}
		},
		/**
		 * A move whose scroll event the list's 100 ms `scrollEventThrottle`
		 * swallowed: the host is there, the controller has not been told.
		 */
		silentMove(at: number) {
			y = at;
		},
		/** The geometry the platform attaches to a drag/momentum end event. */
		event,
		/** A move with no intent callback: scrollbar, screen reader, Tab focus. */
		scrollTo(at: number) {
			y = at;
			h.onScroll(event());
		},
	};
};

const openLong = (web = true) => {
	const r = host({ web });
	r.newest = 80;
	r.layout(599);
	r.grow(2718);
	r.flush();
	return r;
};

describe("initial landing on the newest message", () => {
	it("follows content growth after the first scroll to the end (web, measured F1 geometry)", () => {
		const r = host({ web: true });
		r.layout(599);
		r.grow(2642.5);
		expect(r.y).toBe(2043.5);
		expect(r.positioned).toHaveBeenCalledOnce();
		// Row re-measurement after the first landing: 75.5 px more content.
		r.grow(2718);
		expect(r.bottom).toBe(2718);
	});
	it("confirms against the current content height, not a stale scroll event (native)", () => {
		const r = host({ web: false });
		r.layout(599);
		r.grow(2642.5);
		expect(r.positioned).not.toHaveBeenCalled();
		r.grow(2718);
		// The first move's event arrives late, reporting the old, shorter content.
		r.flush(2642.5, 1);
		expect(r.v.pending).toBe(true);
		r.flush();
		expect(r.bottom).toBe(2718);
		expect(r.positioned).toHaveBeenCalledOnce();
	});
	it("positions a nearly-overflowing short thread with no scroll event (644 in 621)", () => {
		const r = host({ web: true });
		r.layout(621);
		r.grow(644);
		expect(r.y).toBe(23);
		expect(r.v.pending).toBe(false);
		expect(r.positioned).toHaveBeenCalledOnce();
	});
	it("treats a host already at max scroll as positioned without moving it", () => {
		const r = host({ web: false });
		r.layout(500);
		// The host restored its own offset before any content size arrived.
		r.scrollTo(500);
		r.grow(1000);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.positioned).toHaveBeenCalledOnce();
	});
	it.each([0, 100, 500])(
		"admits measured short/empty content of %i without a move",
		(content) => {
			const r = host({ web: false });
			r.layout(500);
			r.grow(content);
			expect(r.positioned).toHaveBeenCalledOnce();
			expect(r.moves).not.toHaveBeenCalled();
		},
	);
	it("ignores a layout scroll before content size and a top event after the request", () => {
		const r = host({ web: false });
		r.layout(500);
		r.scrollTo(0);
		expect(r.v.pending).toBe(true);
		r.grow(4000);
		expect(r.moves).toHaveBeenCalledWith(3500);
		r.scrollTo(0);
		expect(r.v.pending).toBe(true);
		r.flush();
		expect(r.v.pending).toBe(false);
	});
	it("ends initial authority on genuine intent, but not on Space from a control", () => {
		const r = host({ web: true });
		const button = {};
		const list = { contains: (n: unknown) => n === button };
		r.h.onKeyDown?.({
			key: " ",
			target: { closest: () => button },
			currentTarget: list,
		});
		expect(r.v.pending).toBe(true);
		r.h.onKeyDown?.({
			key: "ArrowUp",
			target: { closest: () => null },
			currentTarget: list,
		});
		expect(r.v.pending).toBe(false);
		// Intent does not prove the newest row was seen.
		expect(r.read).not.toHaveBeenCalled();
	});
});

describe("following after positioning", () => {
	it("releases follow on a scrollbar-style move with no intent, then Load older keeps the reader", () => {
		const r = openLong();
		r.moves.mockClear();
		r.scrollTo(100);
		r.v.releaseFollow();
		r.grow(5200); // prepend
		r.grow(5300); // 20 s poll appends while reading history
		expect(r.moves).not.toHaveBeenCalled();
	});
	it("Load older alone releases follow before the prepend lands", () => {
		const r = openLong();
		r.moves.mockClear();
		r.v.releaseFollow();
		r.grow(5200);
		expect(r.moves).not.toHaveBeenCalled();
	});
	it.each([
		[
			"End key",
			(r: ReturnType<typeof host>) => r.h.onKeyDown?.({ key: "End" }),
		],
		["wheel", (r: ReturnType<typeof host>) => r.h.onWheel?.()],
		["pointer down", (r: ReturnType<typeof host>) => r.h.onPointerDown?.()],
		["native tap jitter", (r: ReturnType<typeof host>) => r.h.onTouchMove()],
	])("%s at the bottom still follows the next message", (_name, act) => {
		const r = openLong();
		act(r);
		// TestFlight 1139: a reader's scroll holds the list until it rests;
		// resting at the end resumes following (web: idle timer).
		r.runTimers();
		r.grow(2800);
		expect(r.bottom).toBe(2800);
	});
	it("a gesture that moves the list releases follow even without moving up", () => {
		const r = openLong();
		r.h.onScrollBeginDrag();
		r.scrollTo(1500);
		r.moves.mockClear();
		r.grow(2900);
		expect(r.moves).not.toHaveBeenCalled();
	});
	it("does not treat virtualized layout drift as the reader leaving", () => {
		const r = openLong();
		// Growth reported by a scroll event at an unchanged offset.
		r.grow(2718);
		r.h.onScroll({
			nativeEvent: {
				contentOffset: { y: r.y },
				layoutMeasurement: { height: 599 },
				contentSize: { height: 2900 },
			},
		});
		r.grow(2900);
		expect(r.bottom).toBe(2900);
	});
	it("keeps a history reader across append, refresh and viewport resize; returning re-enables", () => {
		const r = openLong();
		r.scrollTo(900);
		r.moves.mockClear();
		r.grow(2900);
		r.layout(400);
		expect(r.moves).not.toHaveBeenCalled();
		r.scrollTo(2500);
		r.grow(3100);
		expect(r.bottom).toBe(3100);
	});
});

describe("a follower re-pins when the viewport GROWS (TestFlight 836)", () => {
	/* The operator's #general screenshot: the keyboard (or a tall draft) had
	 *  shortened the list, the follower sat at the end, and when the list grew
	 *  back iOS kept the old offset — the host below does not clamp on layout,
	 *  as UIScrollView does not — so the newest message hung ~150 pt above the
	 *  composer over blank canvas. */
	it.each([false, true])(
		"keyboard down brings the newest row back to the composer (web: %s)",
		(web) => {
			const r = openLong(web);
			expect(r.bottom).toBe(2718);
			r.layout(300); // keyboard up: the follower is re-pinned at the end
			r.flush();
			expect(r.bottom).toBe(2718);
			r.moves.mockClear();
			r.layout(450); // keyboard down: the list grows by 150 pt
			r.flush();
			expect(r.moves).toHaveBeenCalledWith(2718 - 450);
			expect(r.y).toBe(2718 - 450);
			expect(r.bottom).toBe(2718);
		},
	);
	it("still leaves a history reader where they are when the list grows", () => {
		const r = openLong(false);
		r.scrollTo(900);
		r.moves.mockClear();
		r.layout(700);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.y).toBe(900);
	});
});

describe("an anchored landing is never re-pinned by viewport growth (PR #230 m3)", () => {
	/* #228's anchored open (`anchored()`: following off, `landing` on) and
	 *  #230's past-end re-pin meet here: the keyboard going down grows the
	 *  viewport past the end under the anchored reader, exactly the geometry
	 *  the re-pin exists for. The reader came to read THAT message, so it must
	 *  not fire: `position()` returns before the past-end branch whenever the
	 *  initial phase is over and the thread is not following. Geometry from
	 *  the reviewer's probe: anchor at 2418, viewport 300, content 2718. */
	it.each([false, true])(
		"keyboard down past the end keeps the reader and Jump to newest (web: %s)",
		(web) => {
			const r = host({ web });
			r.newest = 80;
			r.v.anchored();
			r.layout(300);
			r.grow(2718);
			r.scrollTo(2418); // the landing's own scroll: no intent callback
			r.moves.mockClear();
			r.layout(450); // keyboard down: 150 pt past the end
			r.flush();
			r.grow(2900); // and a new message arrives below
			r.flush();
			expect(r.moves).not.toHaveBeenCalled();
			expect(r.v.following).toBe(false);
			expect(r.y).toBe(2418);
		},
	);
});

describe("read marks", () => {
	it("posts once, for the newest seq, on open", () => {
		const r = host({ web: true });
		r.newest = 80;
		r.layout(599);
		// Viewability of rows passing by while the list is still unpositioned.
		r.v.visible([39, 40, 41, 42]);
		r.v.visible([53, 54]);
		r.grow(2718);
		r.v.visible([68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
		expect(r.read).toHaveBeenCalledOnce();
		expect(r.v.readSeq).toBe(80);
	});
	it("marks a short thread whose rows reported before its content size", () => {
		const r = host({ web: true });
		r.newest = 6;
		r.layout(621);
		r.v.visible([1, 2, 3, 4, 5, 6]);
		r.grow(400);
		// No later viewability callback arrives: nothing on screen changed.
		expect(r.read).toHaveBeenCalledOnce();
		expect(r.v.readSeq).toBe(6);
	});
	it("posts again only when a newer message becomes visible", () => {
		const r = openLong();
		r.v.visible([60, 61]);
		r.v.visible([81]);
		expect(r.read).toHaveBeenCalledTimes(2);
		expect(r.v.readSeq).toBe(81);
	});
});

describe("admission without a content-size change", () => {
	it.each([true, false])(
		"remeasures unchanged fitting content safely (web: %s)",
		(web) => {
			let ready = false;
			const positioned = vi.fn();
			const scrollTo = vi.fn(() => null);
			const v = createThreadViewport({
				web,
				scrollTo,
				positioned,
				read: vi.fn(),
				newestSeq: () => 7,
				dataReady: () => ready,
				measure: () => (web ? { y: 0, viewport: 888, content: 888 } : null),
			});
			v.handlers.onLayout({ nativeEvent: { layout: { height: 888 } } });
			v.handlers.onContentSizeChange(471, 888);
			ready = true;
			// Admission is a React state transition, not a size transition.
			v.dataChanged();
			if (!web) {
				// Native must not claim stale skeleton geometry as admitted rows.
				expect(v.pending).toBe(true);
				// Its container remains natural-sized until positioning, so the
				// admitted fitting rows can report their own measurement.
				v.handlers.onContentSizeChange(471, 400);
			}
			expect(v.pending).toBe(false);
			expect(positioned).toHaveBeenCalledOnce();
			expect(v.readSeq).toBe(7);
			expect(scrollTo).not.toHaveBeenCalled();
		},
	);
});

describe("late native end geometry", () => {
	it("reconciles a follower offset reported past the end after layout has settled", () => {
		const r = openLong(false);
		r.layout(700);
		r.flush();
		r.moves.mockClear();
		// Native anchoring can report its offset after the layout correction.
		// No further layout/content callback exists to trigger position().
		r.scrollTo(2208);
		r.flush();
		expect(r.moves).toHaveBeenCalledWith(2018);
		expect(r.bottom).toBe(2718);
	});
	it("reconciles an initial native landing that reports past the end", () => {
		const r = host({ web: false });
		r.layout(500);
		r.grow(1000);
		r.moves.mockClear();
		r.scrollTo(690);
		r.flush();
		expect(r.moves).toHaveBeenCalledWith(500);
		expect(r.bottom).toBe(1000);
		expect(r.v.pending).toBe(false);
	});
	it("leaves a reader's bottom-edge bounce alone", () => {
		const r = openLong(false);
		r.h.onScrollBeginDrag();
		r.moves.mockClear();
		r.scrollTo(2309);
		r.scrollTo(2250);
		expect(r.moves).not.toHaveBeenCalled();
		// Once the bounce returns to the tail and the drag is over (TestFlight
		// 1139: never mid-gesture), following resumes.
		r.scrollTo(2119);
		r.h.onScrollEndDrag?.();
		r.runTimers();
		r.grow(2800);
		expect(r.moves).toHaveBeenCalledWith(2201);
	});
	it("does not correct from a late event with pre-resize geometry", () => {
		const r = openLong(false);
		r.layout(700);
		r.flush();
		r.moves.mockClear();
		r.h.onScroll({
			nativeEvent: {
				contentOffset: { y: 2309 },
				layoutMeasurement: { height: 599 },
				contentSize: { height: 2718 },
			},
		});
		expect(r.moves).not.toHaveBeenCalled();
	});
	it.each(["history", "anchor"])(
		"does not reconcile a %s reader's offset",
		(mode) => {
			const r = openLong(false);
			if (mode === "anchor") r.v.anchored();
			else r.v.releaseFollow();
			r.moves.mockClear();
			r.scrollTo(2309);
			expect(r.moves).not.toHaveBeenCalled();
		},
	);
});

/*
 * Bridge thread flicker (operator report, builds 1112/1130): "about once a
 * second another frame flickers in". Each signal an unchanged refresh can
 * raise on the shipping handlers — the admission recheck (`dataChanged`, run
 * for every new `items`), an equal content size, an equal layout, and a late
 * native scroll event at the resting offset — is replayed on a synthetic
 * periodic tick. None may write an offset. The #283 reconcile is included so
 * a follower corrected once can never be bounced back and forth.
 */
describe("a periodic unchanged refresh", () => {
	const tick = (r: ReturnType<typeof openLong>, content = 2718) => {
		r.v.dataChanged();
		r.grow(content);
		r.layout(599);
		r.h.onScroll({
			nativeEvent: {
				contentOffset: { y: r.y },
				layoutMeasurement: { height: 599 },
				contentSize: { height: content },
			},
		});
		r.flush();
	};
	it.each([
		["native", false],
		["web", true],
	])("writes no offset for a follower at the newest edge (%s)", (_, web) => {
		const r = openLong(web);
		r.moves.mockClear();
		for (let i = 0; i < 30; i += 1) tick(r);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.bottom).toBe(2718);
	});
	it("a genuinely new message still follows, exactly once", () => {
		const r = openLong(false);
		r.moves.mockClear();
		tick(r, 2800);
		expect(r.moves.mock.calls).toEqual([[2201]]);
		expect(r.bottom).toBe(2800);
		r.moves.mockClear();
		for (let i = 0; i < 10; i += 1) tick(r, 2800);
		expect(r.moves).not.toHaveBeenCalled();
	});
	it("never moves a reader on older history, through ticks and a new message", () => {
		const r = openLong(false);
		r.scrollTo(900);
		r.moves.mockClear();
		for (let i = 0; i < 10; i += 1) {
			r.v.dataChanged();
			r.grow(2718);
			r.layout(599);
		}
		r.grow(2800);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.y).toBe(900);
	});
	/*
	 * QA round 1 Q1 / design D2: a native write that iOS drops raises no
	 * scroll event. The in-flight dedupe must only collapse the duplicates of
	 * ONE burst of triggers, never strand the follower short of the end.
	 */
	it("re-asserts a dropped native write once the in-flight window has passed", () => {
		let clock = 0;
		const moves: number[] = [];
		const v = createThreadViewport({
			scrollTo: (offset) => {
				moves.push(offset); // dropped: the host never moves, no event
				return null;
			},
			positioned: vi.fn(),
			read: vi.fn(),
			newestSeq: () => 4,
			dataReady: () => true,
			web: false,
			now: () => clock,
		});
		const scroll = (y: number, content: number) =>
			v.handlers.onScroll({
				nativeEvent: {
					contentOffset: { y },
					layoutMeasurement: { height: 599 },
					contentSize: { height: content },
				},
			});
		v.handlers.onLayout({ nativeEvent: { layout: { height: 599 } } });
		v.handlers.onContentSizeChange(390, 2718);
		scroll(2119, 2718); // landed and positioned
		moves.length = 0;
		v.handlers.onContentSizeChange(390, 2800); // a new message
		v.handlers.onLayout({ nativeEvent: { layout: { height: 599 } } });
		v.dataChanged();
		expect(moves).toEqual([2201]); // one burst, one write
		clock += 1000; // iOS dropped it: no event ever arrived
		v.handlers.onLayout({ nativeEvent: { layout: { height: 599 } } });
		expect(moves).toEqual([2201, 2201]);
	});
	/*
	 * QA round 2 (Q1 residual): with unchanged polls now silent, a write iOS
	 * drops INSIDE the new message's burst may get no later trigger at all.
	 * The controller re-checks once on its own, and only once per target, so
	 * a host that never reports can never turn into a periodic write loop.
	 */
	const nativeDropping = () => {
		const timers: Array<() => void> = [];
		const moves: number[] = [];
		let clock = 0;
		const v = createThreadViewport({
			scrollTo: (offset) => {
				moves.push(offset);
				return null;
			},
			positioned: vi.fn(),
			read: vi.fn(),
			newestSeq: () => 4,
			dataReady: () => true,
			web: false,
			now: () => clock,
			schedule: (run) => {
				timers.push(run);
				return () => {
					const i = timers.indexOf(run);
					if (i >= 0) timers.splice(i, 1);
				};
			},
		});
		const scroll = (y: number, content: number) =>
			v.handlers.onScroll({
				nativeEvent: {
					contentOffset: { y },
					layoutMeasurement: { height: 599 },
					contentSize: { height: content },
				},
			});
		v.handlers.onLayout({ nativeEvent: { layout: { height: 599 } } });
		v.handlers.onContentSizeChange(390, 2718);
		scroll(2119, 2718);
		moves.length = 0;
		timers.length = 0;
		return {
			v,
			moves,
			timers,
			scroll,
			advance(ms: number) {
				clock += ms;
				for (const run of timers.splice(0)) run();
			},
		};
	};
	it("re-checks a write dropped inside its burst with no later trigger, once", () => {
		const r = nativeDropping();
		r.v.handlers.onContentSizeChange(390, 2800);
		r.v.handlers.onLayout({ nativeEvent: { layout: { height: 599 } } });
		expect(r.moves).toEqual([2201]);
		r.advance(300); // no event, no trigger: the controller re-asserts once
		expect(r.moves).toEqual([2201, 2201]);
		for (let i = 0; i < 20; i += 1) r.advance(300); // and never loops
		expect(r.moves).toEqual([2201, 2201]);
	});
	it("a target that returns after a reported scroll gets its re-check again (QA r3 Q5)", () => {
		const r = nativeDropping();
		r.v.handlers.onContentSizeChange(390, 2800);
		r.advance(300); // dropped twice: re-checked once
		expect(r.moves).toEqual([2201, 2201]);
		// The host reports (the reader nudged it), then the same end comes back
		// and that write is dropped too: it is re-checked again, still once.
		r.scroll(2150, 2800);
		r.v.handlers.onLayout({ nativeEvent: { layout: { height: 599 } } });
		r.advance(300);
		for (let i = 0; i < 10; i += 1) r.advance(300);
		expect(r.moves).toEqual([2201, 2201, 2201, 2201]);
	});
	it("a scroll event before the re-check cancels it", () => {
		const r = nativeDropping();
		r.v.handlers.onContentSizeChange(390, 2800);
		r.scroll(2201, 2800);
		r.advance(300);
		expect(r.moves).toEqual([2201]);
	});
	it("dispose cancels a pending re-check", () => {
		const r = nativeDropping();
		r.v.handlers.onContentSizeChange(390, 2800);
		r.v.dispose();
		expect(r.timers).toHaveLength(0);
	});
	it("the #283 reconcile corrects a past-end report once and then rests", () => {
		const r = openLong(false);
		r.moves.mockClear();
		// One late past-end report (native anchoring), then the periodic tick.
		r.scrollTo(2309);
		r.flush();
		expect(r.moves.mock.calls).toEqual([[2119]]);
		r.moves.mockClear();
		for (let i = 0; i < 30; i += 1) tick(r);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.bottom).toBe(2718);
	});
});

/*
 * TestFlight 1139 (operator, verbatim): "when trying to scroll up it anchors
 * me back to the bottom on each frame in a jitter until I apply enough scroll
 * up force to break free". The first pixels of a drag sit inside FOLLOW_SLACK
 * of the end, so `settle` kept `following` true and cleared `gesture`, and
 * `position()` ignored the drag: every content-size event (virtualized rows
 * mounting as the reader moves up), layout, admission recheck or #286's
 * self re-check wrote the end offset back under the finger. Only a flick that
 * crossed 44 pt between two scroll events escaped.
 *
 * The rule: once the reader starts a drag or momentum scroll, every
 * programmatic follow and re-check is cancelled until the reader's OWN scroll
 * comes to rest within the bottom threshold. New messages meanwhile raise the
 * Jump to newest pill instead of moving the list.
 */
describe("a reader's drag is never fought (TestFlight 1139)", () => {
	const dragUp = (r: ReturnType<typeof openLong>, by: number) => {
		r.h.onScrollBeginDrag();
		r.scrollTo(r.y - by);
	};
	it("zero programmatic writes after drag start, through every trigger", () => {
		const r = openLong(false);
		r.moves.mockClear();
		dragUp(r, 10); // still inside the 44 pt follow band
		for (let i = 0; i < 20; i += 1) {
			r.grow(2718 + i); // rows mounting / measuring under the finger
			r.layout(599);
			r.v.dataChanged(); // poll / admission recheck
			r.runTimers(); // #286 re-check
			r.scrollTo(r.y - 1);
		}
		expect(r.moves).not.toHaveBeenCalled();
	});
	it("cancels a re-check already pending when the drag starts", () => {
		const r = openLong(false);
		r.grow(2800); // a new message: one write, re-check armed
		r.moves.mockClear();
		r.h.onScrollBeginDrag();
		r.runTimers();
		expect(r.moves).not.toHaveBeenCalled();
	});
	it("momentum after the finger lifts is still the reader's scroll", () => {
		const r = openLong(false);
		r.moves.mockClear();
		dragUp(r, 5);
		r.h.onScrollEndDrag?.();
		r.h.onMomentumScrollBegin?.();
		r.runTimers(); // the end-drag grace must not release during momentum
		r.grow(2800);
		r.scrollTo(r.y - 3);
		expect(r.moves).not.toHaveBeenCalled();
	});
	it("a new message while held shows the pill instead of moving", () => {
		const r = openLong(false);
		r.moves.mockClear();
		dragUp(r, 20);
		r.newest = 81;
		r.grow(2800);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.newBelow).toHaveBeenLastCalledWith(true);
	});
	it("resting short of the end stays put; resting at the end resumes follow", () => {
		// TestFlight 1157 superseded #289's "inside the band resumes follow":
		// that settled the last points with a write AFTER the scroll ended.
		const r = openLong(false);
		dragUp(r, 20);
		r.h.onScrollEndDrag?.();
		r.runTimers(); // no momentum began: the drag is over
		expect(r.v.following).toBe(false);
		r.moves.mockClear();
		r.newest = 81;
		r.grow(2800);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.newBelow).toHaveBeenLastCalledWith(true);
		// The reader drags back to the end themselves: following resumes.
		r.h.onScrollBeginDrag();
		r.scrollTo(2201);
		r.h.onScrollEndDrag?.();
		r.runTimers();
		expect(r.v.following).toBe(true);
		expect(r.moves).not.toHaveBeenCalled();
		r.newest = 82;
		r.grow(2880);
		expect(r.moves).toHaveBeenCalledWith(2281);
	});
	it("resting above the threshold leaves the reader in history", () => {
		const r = openLong(false);
		dragUp(r, 300);
		r.h.onScrollEndDrag?.();
		r.h.onMomentumScrollBegin?.();
		r.scrollTo(r.y - 200);
		r.h.onMomentumScrollEnd?.();
		expect(r.v.following).toBe(false);
		r.moves.mockClear();
		r.newest = 81;
		r.grow(2800);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.newBelow).toHaveBeenLastCalledWith(true);
	});
	it("Jump to newest from the pill ends the hold and clears the pill", () => {
		const r = openLong(false);
		dragUp(r, 300);
		r.h.onScrollEndDrag?.();
		r.runTimers();
		r.newest = 81;
		r.grow(2800);
		r.moves.mockClear();
		r.v.jumpToNewest();
		expect(r.moves).toHaveBeenCalledWith(2201);
		expect(r.newBelow).toHaveBeenLastCalledWith(false);
	});
	it("a glide caught by a drag, lifted with no new glide, resumes follow (M1)", () => {
		const r = openLong(false);
		r.h.onScrollBeginDrag();
		r.scrollTo(r.y - 10);
		r.h.onScrollEndDrag?.();
		r.h.onMomentumScrollBegin?.();
		r.h.onScrollBeginDrag(); // caught: no momentum end arrives
		r.scrollTo(r.y + 10);
		r.h.onScrollEndDrag?.();
		r.advanceClock(DRAG_RELEASE_MS);
		expect(r.v.held).toBe(false);
		expect(r.v.following).toBe(true);
		r.moves.mockClear();
		r.grow(2800);
		expect(r.moves).toHaveBeenCalledWith(2201);
	});
	it("web: a touch held still for 300 ms is still the reader's (M2)", () => {
		const r = openLong(true);
		r.moves.mockClear();
		r.h.onPointerDown?.(); // touch down: browsers raise pointer events
		r.h.onPointerMove?.();
		r.scrollTo(r.y - 10);
		r.advanceClock(300); // the finger pauses on the glass
		r.grow(2760); // content changes under it
		r.v.dataChanged();
		expect(r.moves).not.toHaveBeenCalled();
		r.h.onPointerUp?.();
		r.advanceClock(WEB_IDLE_MS);
		expect(r.v.held).toBe(false);
	});
	it("web: a touch pan survives the browser's pointercancel (R2-M1 / Q2-1)", () => {
		const r = openLong(true);
		r.moves.mockClear();
		const touch = { pointerType: "touch" };
		// The browser's real order for a touch pan: touchstart and pointerdown,
		// a move, then pointercancel once it takes over the gesture to scroll.
		r.h.onTouchStartCapture?.();
		r.h.onPointerDown?.(touch);
		r.h.onTouchMoveCapture?.();
		r.h.onPointerMove?.(touch);
		r.h.onPointerCancel?.(touch);
		r.scrollTo(r.y - 10);
		r.advanceClock(300); // the finger rests on the glass
		r.grow(2760);
		r.v.dataChanged();
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.v.held).toBe(true);
		r.h.onTouchEndCapture?.();
		r.advanceClock(WEB_IDLE_MS);
		expect(r.v.held).toBe(false);
	});
	it("only messages newer than the reader's departure raise the pill (m1)", () => {
		const r = openLong(false);
		// Leaving the tail without a gesture (screen reader / scrollbar).
		r.scrollTo(r.y - 300);
		expect(r.v.following).toBe(false);
		r.grow(2760); // an image loads: no new message
		expect(r.newBelow).not.toHaveBeenCalledWith(true);
		r.newest = 81;
		r.grow(2820);
		expect(r.newBelow).toHaveBeenLastCalledWith(true);
	});
	it("web: a wheel near the end holds until the scroll goes idle", () => {
		const r = openLong(true);
		r.moves.mockClear();
		r.h.onWheel?.();
		r.scrollTo(r.y - 10);
		r.grow(2730);
		expect(r.moves).not.toHaveBeenCalled();
		r.runTimers(); // idle: rested 10 px short of the end, so it stays put
		r.grow(2800);
		expect(r.moves).not.toHaveBeenCalled();
		// A wheel back to the end resumes following once it idles.
		r.h.onWheel?.();
		r.scrollTo(2201);
		r.runTimers();
		r.grow(2860);
		expect(r.moves).toHaveBeenCalledWith(2261);
	});
});

/*
 * TestFlight 1157 (operator, #general): "it jitters when the scroll finishes
 * and ends me in a different position than the scroll smooth finish ...
 * there shouldn't be something that is updating the scroll position after
 * scroll completion, it should smoothly stop". After #289 a reader's scroll is
 * never fought WHILE it moves; these pin that nothing moves it AFTER it rests
 * either: not the rest decision, not a late scroll event, not a re-measure.
 */
describe("a scroll that comes to rest stays where it stopped (TestFlight 1157)", () => {
	/** Every trigger that can arrive after rest, in a burst. */
	const lateBurst = (r: ReturnType<typeof openLong>, grownTo: number) => {
		r.scrollTo(r.y); // the platform's trailing scroll event at the same y
		r.grow(grownTo); // a row re-measures (avatar, image, markdown)
		r.layout(599);
		r.v.dataChanged(); // the admission recheck / an unchanged poll
		r.runTimers(); // any pending re-check
		r.scrollTo(r.y);
		r.grow(grownTo + 6);
	};
	it("momentum ending mid-history is followed by zero writes", () => {
		const r = openLong(false);
		r.moves.mockClear();
		r.h.onScrollBeginDrag();
		r.scrollTo(1700);
		r.h.onScrollEndDrag?.(r.event());
		r.h.onMomentumScrollBegin?.();
		r.scrollTo(1200);
		r.h.onMomentumScrollEnd?.(r.event());
		r.runTimers();
		lateBurst(r, 2760);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.y).toBe(1200);
	});
	it("a rest a few points short of the end is not snapped to it", () => {
		const r = openLong(false);
		r.moves.mockClear();
		r.h.onScrollBeginDrag();
		r.scrollTo(2119 - 30); // inside the 44 pt follow band
		r.h.onScrollEndDrag?.(r.event());
		r.runTimers(); // no glide: the drag is over
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.y).toBe(2089);
	});
	it("a late scroll event and re-measure after that rest do not re-acquire it", () => {
		const r = openLong(false);
		r.h.onScrollBeginDrag();
		r.scrollTo(2119 - 30);
		r.h.onScrollEndDrag?.(r.event());
		r.runTimers();
		r.moves.mockClear();
		lateBurst(r, 2760);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.y).toBe(2089);
	});
	it("decides from the rest event's own geometry, not a throttled scroll event", () => {
		const r = openLong(false);
		r.moves.mockClear();
		r.h.onScrollBeginDrag();
		// The last event the throttle let through was AT the end (#296 R1-m1:
		// an in-band reading would be history either way, proving nothing).
		r.scrollTo(2119);
		r.h.onScrollEndDrag?.(r.event());
		r.h.onMomentumScrollBegin?.();
		r.silentMove(1800); // the glide carried on, unreported
		r.h.onMomentumScrollEnd?.(r.event());
		expect(r.v.following).toBe(false);
		r.grow(2760);
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.y).toBe(1800);
	});
	it("a rest AT the end resumes following without a write at rest", () => {
		const r = openLong(false);
		r.moves.mockClear();
		r.h.onScrollBeginDrag();
		r.scrollTo(2000);
		r.h.onScrollEndDrag?.(r.event());
		r.h.onMomentumScrollBegin?.();
		r.scrollTo(2119); // the glide ends at the end itself
		r.h.onMomentumScrollEnd?.(r.event());
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.v.following).toBe(true);
		// The next new message is still followed.
		r.newest = 81;
		r.grow(2800);
		expect(r.moves).toHaveBeenCalledWith(2201);
	});
	it("an anchoring shift after a rest short of the end re-acquires nothing (#296 Q1-1)", () => {
		const r = openLong(false);
		r.h.onScrollBeginDrag();
		r.scrollTo(2119 - 20);
		r.h.onScrollEndDrag?.(r.event());
		r.runTimers();
		r.moves.mockClear();
		// A row ABOVE the first visible one grows 30 pt: iOS
		// maintainVisibleContentPosition moves the offset by the same 30 and
		// forces a scroll event. The reader did not move toward the end.
		r.grow(2748);
		r.scrollTo(2099 + 30);
		// Then the newest row re-measures, and the admission recheck runs.
		r.grow(2760);
		r.v.dataChanged();
		r.runTimers();
		expect(r.moves).not.toHaveBeenCalled();
		expect(r.v.following).toBe(false);
	});
	it("a reader who scrolls back down to the end by hand still re-acquires", () => {
		const r = openLong(false);
		r.h.onScrollBeginDrag();
		r.scrollTo(1500);
		r.h.onScrollEndDrag?.(r.event());
		r.runTimers();
		// A screen reader (no gesture callback) moves them down to the end.
		r.scrollTo(2119);
		expect(r.v.following).toBe(true);
	});
});

describe("screen wiring", () => {
	const source = readFileSync(
		new URL("./thread-screen.tsx", import.meta.url),
		"utf8",
	);
	it("spreads the controller's handlers and releases follow in both Load-older paths", () => {
		expect(source).toContain("{...viewport.current.handlers}");
		expect(source.match(RELEASE)).toHaveLength(2);
		expect(source).not.toContain("onScroll={");
		expect(source).not.toContain("onContentSizeChange={");
	});
	it("re-arms the day-turnover timer on every fire and disposes the viewport (r2)", () => {
		// Keyed on a fire counter, not the day: a timer that fires early (clock
		// set back, timezone moved west) must still arm the next one.
		expect(source).toContain("setDayTick((tick) => tick + 1)");
		expect(source).toContain("}, [dayTick]);");
		expect(source).toContain("viewport.current?.dispose()");
	});
	it("hands memoised rows a stable people list when the directory is absent", () => {
		// `?? []` minted a new array per render, so every store publish (an
		// unread refresh, a read receipt) re-rendered every message row.
		expect(source).not.toMatch(FRESH_PEOPLE);
		expect(source).toContain("?.people ?? NO_PEOPLE");
	});
	it("waits for positioned rows before growing the container, and rechecks admitted data", () => {
		expect(source).toContain('positioned ? "grow justify-end pb-2" : "pb-2"');
		expect(source).toMatch(ADMISSION_RECHECK);
	});
	it("keeps the heading semantic and scalable and the identity account scoped", () => {
		// The heading is the session header's title style now (one line, two
		// when stacked): `thread-chrome.test.tsx` renders and pins it.
		expect(source).toContain("<BridgeThreadTitle");
		// The drawn `# ` is decorative: the spoken name is the plain title (R1-10).
		expect(source).toContain(
			"accessibilityLabel={title === rawTitle ? undefined : rawTitle}",
		);
		// Stacked, the notifications icon rides the back row like the session's.
		expect(source).toContain("stackedActionsBeside");
		expect(source).not.toContain("allowFontScaling={false}");
		expect(source).not.toContain("adjustsFontSizeToFit");
		expect(source).toContain("accessibilityElementsHidden={initialRowsHidden}");
		expect(source).toContain(["key={`", "$", "{selfAccountId}/"].join(""));
		expect(source).toMatch(INITIAL_ANCHOR);
	});
});
