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

/** Sub-pixel slack for "at the exact end": web scrollTop is fractional
 * (2043.5) and device-pixel rounding can leave the host < 1 px short of max. */
export const POSITION_SLACK = 1;
/** The transcript's pre-existing "near the bottom" band for following. */
export const FOLLOW_SLACK = 44;

/** Geometry a scroll host reports: offset, viewport length, content length. */
export type ScrollGeometry = { y: number; viewport: number; content: number };

/** Keys that scroll a focused web scroll container. */
const SCROLL_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End",
	" ",
]);
/** Keys pressed on these act on the control (Space activates Load older), not
 * on the transcript, so they are not scroll intent (PR #208 NIT-1). */
const INTERACTIVE =
	'button,a,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[contenteditable="true"]';

type Closest = { closest?: (selector: string) => unknown };
type Container = { contains?: (node: unknown) => boolean };
export type KeyIntentEvent = {
	key: string;
	target?: unknown;
	currentTarget?: unknown;
};

const fromControl = (event: KeyIntentEvent) => {
	const target = event.target as Closest | null | undefined;
	const control = target?.closest?.(INTERACTIVE);
	if (!control || control === event.currentTarget) return false;
	const container = event.currentTarget as Container | null | undefined;
	return container?.contains ? container.contains(control) : true;
};

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
};

export function createThreadViewport(options: ThreadViewportOptions) {
	let initial = true;
	let following = true;
	const setFollowing = (next: boolean) => {
		if (next === following) return;
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
	let readSeq = 0;

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
		if (atTail) {
			if (landing) {
				lastY = y;
				return;
			}
			setFollowing(true);
			gesture = false;
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
		if (content === null || height <= 0 || !options.dataReady()) return;
		if (!initial && !following) return;
		const target = Math.max(0, content - height);
		if (
			target <= POSITION_SLACK ||
			(lastY !== null && lastY >= target - POSITION_SLACK)
		) {
			// Content fits, or the host already reads at max scroll: no move
			// would happen, so no scroll event would ever confirm one. Trusted
			// only from a measurement of the admitted rows (`contentReady`); a
			// stale one waits for the layout event those rows will raise.
			if (initial && contentReady) finish(true);
			return;
		}
		const readBack = options.scrollTo(target);
		if (readBack) settle(readBack.y, readBack.viewport, readBack.content);
	};

	const intent = () => {
		// Genuine user intent ends initial authority so a reader is never held
		// on hidden rows; it does not prove the newest row is in view.
		if (initial) finish(false);
		gesture = true;
		landing = false;
	};

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
			settle(contentOffset.y, layoutMeasurement.height, contentSize.height);
		},
		onScrollBeginDrag: intent,
		onTouchMove: intent,
		...(options.web
			? {
					onWheel: intent,
					// Covers the web scrollbar, which raises no wheel or key event.
					onPointerDown: intent,
					onKeyDown: (event: KeyIntentEvent) => {
						if (SCROLL_KEYS.has(event.key) && !fromControl(event)) intent();
					},
				}
			: {}),
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
			landing = false;
			setFollowing(true);
			gesture = false;
			const readBack = options.scrollTo(Math.max(0, content - height));
			if (readBack) settle(readBack.y, readBack.viewport, readBack.content);
		},
	};
}

export type ThreadViewport = ReturnType<typeof createThreadViewport>;
