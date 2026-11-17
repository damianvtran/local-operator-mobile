/**
 * Thread-owned positioning and following authority for the Bridge transcript.
 *
 * WHY this exists: opening a conversation must land on the newest message, and a
 * reader scrolled into history must never be pulled back down. Three facts make
 * the naive "scrollToEnd on every content-size change while at the bottom" fail:
 *
 * 1. Virtualized rows keep re-measuring after the first scroll to the end, so
 *    content height grows AFTER the list first reached the (then shorter) end.
 *    Measured on web: landing at 2043.5 + 599 = 2642.5 of a final 2718 px
 *    content height (PR #208 QA round 1). Initial authority therefore confirms
 *    against the CURRENT content height and re-targets on every growth.
 * 2. `FlatList.scrollToEnd` targets an estimated frame offset, not the measured
 *    content height, and a scroll that lands where the list already is emits no
 *    scroll event. A short thread (644 px in a 621 px window) stayed hidden for
 *    good while waiting for that event. So positioning targets the exact measured
 *    offset, completes structurally (content fits, or the host already reads at
 *    max scroll), and reads the web scroll host back synchronously instead of
 *    depending on an event arriving. No timer: there is no measured latency
 *    distribution to size one from.
 * 3. Readers move the list with things that raise no gesture callback
 *    (scrollbar drag, screen readers, Tab focus), and gestures happen at the
 *    bottom without moving anything (End/wheel at max, tap jitter). Following is
 *    therefore derived from real scroll geometry; intent signals only mark a
 *    pending gesture, which lets the next moving scroll event release early.
 *
 * Instances are per mounted thread (the screen keys them by account, org and
 * conversation), so state never leaks between conversations.
 */

import {
	createReaderScrollHold,
	DRAG_RELEASE_MS,
	WEB_IDLE_MS,
} from "../session/reader-scroll-hold";

/** Sub-pixel slack for "at the exact end": web scrollTop is fractional
 * (2043.5) and device-pixel rounding can leave the host < 1 px short of max. */
export const POSITION_SLACK = 1;
/** The transcript's pre-existing "near the bottom" band for following. */
export const FOLLOW_SLACK = 44;

/** Geometry a scroll host reports: offset, viewport length, content length. */
export type ScrollGeometry = { y: number; viewport: number; content: number };

export type { KeyIntentEvent } from "../session/reader-scroll-hold";

export type ThreadViewportOptions = {
	/** Move the list to `offset`. Return the host's geometry read back right
	 * after the move when the platform can (web), or null (native: the
	 * platform's own scroll event reports it). */
	scrollTo: (offset: number) => ScrollGeometry | null;
	/** Initial positioning finished; rows may be shown. Called once. */
	positioned: () => void;
	/** `readSeq` rose; post the read mark. */
	read: () => void;
	/** Newest loaded message seq (0 when none). */
	newestSeq: () => number;
	/** Admitted data (or a settled empty/draft state) is in the list. */
	dataReady: () => boolean;
	/** Web adds wheel, pointer and key intent; native has drag callbacks. */
	web: boolean;
	/** Follow mode flipped (optional): the anchored open's "Jump to newest"
	 *  shows only while the reader is away from the newest edge. */
	followChanged?: (following: boolean) => void;
	/**
	 * The scroll host's geometry right now, when the platform can read it
	 * synchronously (web: the DOM node), else null. Only `dataChanged` uses it:
	 * see there for why a layout event cannot be waited for.
	 */
	measure?: () => ScrollGeometry | null;
	/** Monotonic clock for the in-flight write window (tests inject one). */
	now?: () => number;
	/** Run `run` after `ms`; returns a cancel. Tests inject one. */
	schedule?: (run: () => void, ms: number) => () => void;
	/**
	 * Newer messages arrived while the reader was not following (their own
	 * scroll held the list, or they rest in history): show "Jump to newest"
	 * instead of moving the list. `false` once they are back at the end.
	 */
	newBelow?: (present: boolean) => void;
};

/** The hold timings live with the shared hold (`reader-scroll-hold.ts`). */
export { DRAG_RELEASE_MS, WEB_IDLE_MS };

const monotonic = (): number =>
	typeof globalThis.performance?.now === "function"
		? globalThis.performance.now()
		: Date.now();

const timeout = (run: () => void, ms: number) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

/**
 * How long a native write counts as in flight. Long enough to collapse ONE
 * burst of triggers (content size, layout and the admission recheck land in
 * the same commit), short enough that a write iOS dropped without a scroll
 * event is re-asserted by the next trigger (QA r1 Q1 / design D2). A
 * programmatic move's event normally arrives within a frame or two, and the
 * list's own `scrollEventThrottle` is 100 ms.
 */
export const IN_FLIGHT_MS = 250;

/** The part of a drag/momentum end event the rest decision reads. */
export type ScrollEndEvent = {
	nativeEvent?: {
		contentOffset?: { y: number };
		layoutMeasurement?: { height: number };
	};
};

export function createThreadViewport(options: ThreadViewportOptions) {
	let initial = true;
	let following = true;
	const setFollowing = (next: boolean) => {
		// Back at the end by any route: nothing newer is waiting below.
		if (next) setBelow(false);
		if (next === following) return;
		// Every true->false transition records what the reader had (PR #289
		// m1): only messages newer than this raise Jump to newest.
		if (!next) seenNewest = options.newestSeq();
		following = next;
		options.followChanged?.(next);
	};
	let gesture = false;
	/**
	 * After an anchored landing, only the READER may resume following. The
	 * landing's own scrolls (`scrollToIndex`, the placement correction, the
	 * scroll-to-index-failed retries) run while the virtualized list is still
	 * mounting rows, so the host can sit at the end of a SHORTER content than
	 * the thread's: PR #228 QA round 2 (Q2-1) saw 24 rows mounted at landing,
	 * 44 a sample later. A tail check on that geometry turned following on,
	 * which retired "Jump to newest" before it was ever seen and would let the
	 * next growth or new message pull the reader off the message they came
	 * for. So until a reader gesture (`intent`) or Jump to newest, arriving at
	 * the tail does not resume following. A reader who moves without raising
	 * intent (a screen reader's scroll) keeps the pill as their way back.
	 */
	let landing = false;
	let height = 0;
	let content: number | null = null;
	/**
	 * Whether `content` was measured while `dataReady` held, i.e. it describes
	 * the admitted rows rather than the skeleton or rows still held back.
	 * The "content fits, nothing to move" shortcut below ends the initial phase
	 * and claims the newest row read WITHOUT any scroll proving it, so it may
	 * only trust such a measurement. PR #228 Q1-1: a missing anchor handed back
	 * through `dataChanged()` while `content` still held the pre-data height;
	 * `content - height <= 1` read as "fits", read seq 80 was posted with zero
	 * scroll calls (instrumented CI artifact ba74e3ac), and the reader stayed
	 * at the oldest row.
	 */
	let contentReady = false;
	let lastY: number | null = null;
	/**
	 * The offset last requested from a host that cannot read back (native),
	 * until a scroll event reports where the host actually is. Native writes
	 * are asynchronous, so between the write and its event every other
	 * trigger — the admission recheck on each new `items`, an equal content
	 * size, a keyboard/dock layout — saw the OLD `lastY` and wrote the same
	 * offset again (Bridge thread flicker: two writes per new message, one per
	 * extra trigger). Cleared by any scroll event, so a reader's move or a
	 * host that settled elsewhere is never masked; a new target still writes.
	 */
	let requested: { target: number; at: number } | null = null;
	const now = options.now ?? monotonic;
	const schedule = options.schedule ?? timeout;
	/**
	 * One self re-check per un-confirmed native write (QA r2, Q1 residual).
	 * Unchanged polls are silent now, so a write iOS drops INSIDE a new
	 * message's burst may get no later trigger to re-assert it. The re-check
	 * runs once per distinct target: a host that never reports can never turn
	 * this into a periodic write loop — the flicker this file guards against.
	 */
	let recheck: (() => void) | null = null;
	let rechecked: number | null = null;
	const cancelRecheck = () => {
		recheck?.();
		recheck = null;
	};
	let readSeq = 0;
	/**
	 * THE READER OWNS THE LIST (TestFlight 1139: "it anchors me back to the
	 * bottom on each frame in a jitter until I apply enough scroll up force").
	 * The first pixels of a drag sit inside FOLLOW_SLACK of the end, so the tail
	 * check alone kept `following` true and every content-size, layout or
	 * admission trigger — and the self re-check — wrote the end offset back
	 * under the finger. From a drag or momentum start (native) or a wheel,
	 * pointer, key or touch scroll (web) until that scroll comes to rest, no
	 * programmatic follow runs at all; at rest, the reader's OWN offset decides:
	 * only a rest at the end (within POSITION_SLACK) resumes following, and
	 * nothing is written at rest (TestFlight 1157); anywhere else is history.
	 * Only Jump to newest (an explicit reader request) overrides it.
	 */
	/** Newest seq the reader was following when they left the end. */
	let seenNewest = 0;
	let below = false;
	const setBelow = (next: boolean) => {
		if (next === below) return;
		below = next;
		options.newBelow?.(next);
	};
	/** Content arrived while not following: a newer message is the pill's cue. */
	const noteArrivals = () => {
		if (initial || (following && !hold.active)) return;
		if (options.newestSeq() > seenNewest) setBelow(true);
	};

	const finish = (atNewest: boolean) => {
		if (!initial) return;
		initial = false;
		// Only a confirmed landing proves the newest row is on screen. Earlier
		// viewability callbacks reported rows that were never at rest (seven
		// marks in ~200 ms, PR #208 Q2), so they are not replayed here.
		if (atNewest) readSeq = Math.max(readSeq, options.newestSeq());
		options.positioned();
		if (readSeq > 0) options.read();
	};

	const settle = (y: number, viewport: number, measured: number) => {
		if (initial) {
			// A layout scroll can arrive before any content size; it proves nothing.
			if (content === null || height <= 0 || !options.dataReady()) {
				lastY = y;
				return;
			}
			const current = Math.max(measured, content);
			if (y + viewport >= current - POSITION_SLACK) finish(true);
			lastY = y;
			return;
		}
		const atTail = y + viewport >= measured - FOLLOW_SLACK;
		/* BEING NEAR THE END IS NOT COMING BACK TO IT (TestFlight 1157). A
		 *  reader who came to rest inside the band, short of the end, chose that
		 *  place; the platform's trailing scroll event at the same offset used to
		 *  turn following back on, and the next row re-measure wrote the end
		 *  offset: "ends me in a different position than the smooth finish".
		 *  Only the END re-acquires a reader who is away from it. #296 round 1 also
		 *  let a downward move into the band re-acquire, and QA (Q1-1) showed why that
		 *  is wrong on native: when a row ABOVE the first visible one changes height,
		 *  iOS maintainVisibleContentPosition moves the offset by the same amount and
		 *  forces a scroll event. The offset went down, the distance to the end did
		 *  not change, and the reader had not moved; re-acquiring there let the next
		 *  re-measure write the end (2410 -> 2442). Every real reader move on native
		 *  and web runs under the scroll hold (`reader-scroll-hold.ts`), whose rest
		 *  decides follow; what reaches this path without a hold is a screen reader,
		 *  focus, or the platform, and of those only arriving AT the end means "take
		 *  me back to following". */
		const reacquires = following || y + viewport >= measured - POSITION_SLACK;
		if (atTail && !reacquires) {
			lastY = y;
			return;
		}
		if (atTail) {
			// A held list is the reader's: arriving near the end mid-scroll is
			// not a request to be pinned (the decision waits for rest).
			if (landing || hold.active) {
				lastY = y;
				return;
			}
			setFollowing(true);
			// A native end bounce is still the reader's gesture until it
			// returns inside the content; do not correct its later frames.
			if (y + viewport <= measured + POSITION_SLACK) gesture = false;
		} else if (
			lastY !== null &&
			// Moving up is the reader leaving the tail, whatever moved it
			// (scrollbar, screen reader, focus). Growth below a stationary
			// offset is layout drift, not the reader, unless a gesture is live.
			(y < lastY - POSITION_SLACK || (gesture && y !== lastY))
		) {
			setFollowing(false);
		}
		lastY = y;
	};

	const position = () => {
		if (hold.active) return;
		if (content === null || height <= 0 || !options.dataReady()) return;
		if (!initial && !following) return;
		const target = Math.max(0, content - height);
		/* PAST the end is not AT the end (TestFlight 836: ~150 pt of empty
		 *  canvas between the newest message and the Bridge composer with the
		 *  keyboard down). When the viewport GROWS — the keyboard goes down, or a
		 *  multi-line draft is sent and the dock shrinks back — the end moves up
		 *  under a host that stays where it was: iOS's UIScrollView does not clamp
		 *  its offset to the new content end on a frame change ("UIScrollView does
		 *  not adjust its offset until user scrolls", React Native's own note in
		 *  RCTScrollViewComponentView.mm), and with no movement no scroll event
		 *  arrives either. Treating `lastY > target` as "already at max" left a
		 *  follower parked over blank space by exactly the growth. A follower is
		 *  brought back to the real end; at it (within slack), nothing moves. */
		const pastEnd = lastY !== null && lastY > target + POSITION_SLACK;
		if (
			!pastEnd &&
			(target <= POSITION_SLACK ||
				(lastY !== null && lastY >= target - POSITION_SLACK))
		) {
			// Content fits, or the host already reads at max scroll: no move
			// would happen, so no scroll event would ever confirm one. Trusted
			// only from a measurement of the admitted rows (`contentReady`); a
			// stale one waits for the layout event those rows will raise.
			if (initial && contentReady) finish(true);
			return;
		}
		if (
			requested !== null &&
			Math.abs(requested.target - target) <= POSITION_SLACK &&
			now() - requested.at < IN_FLIGHT_MS
		)
			return;
		write(target);
	};

	const write = (target: number) => {
		const readBack = options.scrollTo(target);
		requested = readBack ? null : { target, at: now() };
		if (readBack) settle(readBack.y, readBack.viewport, readBack.content);
		else if (
			rechecked === null ||
			Math.abs(rechecked - target) > POSITION_SLACK
		) {
			cancelRecheck();
			recheck = schedule(() => {
				recheck = null;
				if (requested === null) return; // the host reported
				rechecked = requested.target;
				requested = null;
				position();
			}, IN_FLIGHT_MS);
		}
	};

	const intent = () => {
		// Genuine user intent ends initial authority so a reader is never held
		// on hidden rows; it does not prove the newest row is in view.
		if (initial) finish(false);
		gesture = true;
		landing = false;
	};

	/** The reader's scroll began (or continued): cancel every programmatic move. */
	const onBegin = () => {
		intent();
		cancelRecheck();
		requested = null;
		setFollowing(false);
	};

	/**
	 * The reader's scroll came to rest: where it stopped is where it stays.
	 *
	 * NOTHING IS WRITTEN AT REST (TestFlight 1157: "there shouldn't be
	 * something that is updating the scroll position after scroll completion,
	 * it should smoothly stop"). #289 settled a rest anywhere inside the 44 pt
	 * band to the exact end, and decided from `lastY`, which the list's 100 ms
	 * `scrollEventThrottle` can leave a whole glide behind (see `observe`).
	 * Now only a rest AT the end resumes following, and it needs no write: the
	 * list is already there. A rest short of it is history; a newer message
	 * raises Jump to newest instead of moving the reader.
	 */
	const onRest = () => {
		if (
			!landing &&
			lastY !== null &&
			content !== null &&
			lastY + height >= content - POSITION_SLACK
		) {
			setFollowing(true);
			gesture = false;
		}
	};

	/**
	 * Take the geometry a drag- or momentum-end event carries. The list's
	 * `scrollEventThrottle` (100 ms) drops scroll events mid-glide, so the last
	 * `onScroll` can be a glide behind where the list stopped; React Native's
	 * end events carry the final offset. Only the offset and viewport are
	 * taken: content height keeps its own, newer source (`onContentSizeChange`).
	 */
	const observe = (event?: ScrollEndEvent) => {
		const native = event?.nativeEvent;
		if (!native?.contentOffset) return;
		lastY = native.contentOffset.y;
		if (native.layoutMeasurement?.height)
			height = native.layoutMeasurement.height;
	};

	/** One hold for both lists (PR #289 N1): `reader-scroll-hold.ts`. */
	const hold = createReaderScrollHold({
		web: options.web,
		schedule,
		onBegin,
		onRest,
	});

	const handlers = {
		onLayout: (event: { nativeEvent: { layout: { height: number } } }) => {
			height = event.nativeEvent.layout.height;
			// Keyboard/header resize keeps a follower at the tail and leaves a
			// history reader where they are.
			position();
		},
		onContentSizeChange: (_width: number, contentHeight: number) => {
			content = contentHeight;
			contentReady = options.dataReady();
			noteArrivals();
			position();
		},
		onScroll: (event: {
			nativeEvent: {
				contentOffset: { y: number };
				layoutMeasurement: { height: number };
				contentSize: { height: number };
			};
		}) => {
			const { contentOffset, layoutMeasurement, contentSize } =
				event.nativeEvent;
			// The host has reported: whatever was requested is now grounded.
			requested = null;
			cancelRecheck();
			// Only a host that REPORTS can re-enable a re-check for a target it
			// has already had, so this cannot become a loop (QA r3 Q5).
			rechecked = null;
			// Native offset/visible-content anchoring can settle AFTER the final
			// layout callback. That callback's correction is not proof that the
			// host stayed there. Reconcile only an existing follower, without a
			// reader gesture, and only against the current measured geometry:
			// late events from an earlier layout must not move a history/anchor
			// reader or undo a newer resize.
			const reconcile =
				following &&
				!gesture &&
				contentSize.height === content &&
				layoutMeasurement.height === height &&
				contentOffset.y >
					Math.max(0, contentSize.height - height) + POSITION_SLACK;
			settle(contentOffset.y, layoutMeasurement.height, contentSize.height);
			// Web: a held scroll restarts its idle (or pointer-down) clock.
			hold.scrolled();
			if (reconcile) position();
		},
		onScrollBeginDrag: () => hold.beginDrag(),
		onScrollEndDrag: (event?: ScrollEndEvent) => {
			observe(event);
			hold.endDrag();
		},
		onMomentumScrollBegin: () => hold.beginMomentum(),
		onMomentumScrollEnd: (event?: ScrollEndEvent) => {
			observe(event);
			hold.endMomentum();
		},
		onTouchMove: intent,
		// Web: wheel, pointer (mouse, pen AND touch) and scroll keys hold the
		// list; the scrollbar raises pointer events. Empty on native.
		...hold.webHandlers,
	};

	return {
		/** Spread onto the FlatList: the shipping callbacks ARE these. */
		handlers,
		get pending() {
			return initial;
		},
		/** Newest seq proven on screen in a settled, positioned viewport. */
		get readSeq() {
			return readSeq;
		},
		/**
		 * `dataReady` turned true from a state change rather than a layout event
		 * (an anchored open that fell back to newest): run the initial positioning
		 * it was holding. The last layout event may predate the rows it now has to
		 * position against, so re-read the host where the platform allows (web);
		 * elsewhere the stale measurement is not trusted to finish (`contentReady`)
		 * and the rows' own layout event completes the landing.
		 */
		dataChanged() {
			const now = options.measure?.();
			if (now && now.viewport > 0) {
				content = now.content;
				height = now.viewport;
				lastY = now.y;
				contentReady = options.dataReady();
			}
			noteArrivals();
			position();
		},
		/** For thread states with no list layout to report (empty, no thread). */
		settledEmpty() {
			content = 0;
			contentReady = true;
			position();
		},
		/** Viewability of message seqs; only a positioned viewport can mark read. */
		visible(seqs: readonly number[]) {
			if (initial) return;
			const newest = Math.max(0, ...seqs);
			if (newest > readSeq) {
				readSeq = newest;
				options.read();
			}
		},
		/** Load older: the reader is in history; a prepend must not pull them down. */
		releaseFollow() {
			setFollowing(false);
		},
		/**
		 * A message-anchored open (`thread-anchor.ts`) has scrolled the reader to
		 * that message. It IS the initial position, so it ends the initial phase
		 * WITHOUT claiming the newest edge: nothing is marked read on landing
		 * (only rows the reader then sees, via `visible`), and the reader stays
		 * in control — a new message must not pull them away from the one they
		 * came to read. Reaching the tail resumes following as usual.
		 */
		anchored() {
			if (initial) finish(false);
			setFollowing(false);
			gesture = false;
			landing = true;
		},
		/** The thread unmounted: drop a pending re-check. */
		dispose() {
			cancelRecheck();
			hold.dispose();
		},
		/** Whether the reader's own scroll currently holds the list. */
		get held() {
			return hold.active;
		},
		/** The list's visible height (0 before its first layout). */
		get viewportHeight() {
			return height;
		},
		/** Whether new content keeps the reader pinned to the newest edge. */
		get following() {
			return following;
		},
		/**
		 * "Jump to newest" after an anchored open: back to #208's follow mode at
		 * the measured tail (exact offset, as `position` uses).
		 */
		jumpToNewest() {
			if (content === null || height <= 0) return;
			// An explicit request: it ends any hold and is never deduplicated.
			hold.dispose();
			landing = false;
			setFollowing(true);
			setBelow(false);
			gesture = false;
			write(Math.max(0, content - height));
		},
	};
}

export type ThreadViewport = ReturnType<typeof createThreadViewport>;
