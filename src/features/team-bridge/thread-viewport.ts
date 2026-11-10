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
};

export function createThreadViewport(options: ThreadViewportOptions) {
	let initial = true;
	let following = true;
	let gesture = false;
	let height = 0;
	let content: number | null = null;
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
			following = true;
			gesture = false;
		} else if (
			lastY !== null &&
			// Moving up is the reader leaving the tail, whatever moved it
			// (scrollbar, screen reader, focus). Growth below a stationary
			// offset is layout drift, not the reader, unless a gesture is live.
			(y < lastY - POSITION_SLACK || (gesture && y !== lastY))
		) {
			following = false;
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
			// would happen, so no scroll event would ever confirm one.
			if (initial) finish(true);
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
		/** For thread states with no list layout to report (empty, no thread). */
		settledEmpty() {
			content = 0;
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
			following = false;
		},
	};
}

export type ThreadViewport = ReturnType<typeof createThreadViewport>;
