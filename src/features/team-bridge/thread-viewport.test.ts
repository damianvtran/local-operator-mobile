import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createThreadViewport } from "./thread-viewport";

const RELEASE = /releaseFollow\(\);/g;
const INITIAL_ANCHOR = /maintainVisibleContentPosition=\{\s*positioned/;

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
	let newest = 0;
	const v = createThreadViewport({
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
