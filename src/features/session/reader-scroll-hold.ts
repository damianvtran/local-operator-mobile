/**
 * Whether the reader's own scroll currently owns a bottom-following list.
 *
 * WHY (TestFlight 1139, operator: "when trying to scroll up it anchors me back
 * to the bottom on each frame in a jitter until I apply enough scroll up force
 * to break free"). A tail-following list decides "at the tail" from a band
 * (44 pt in the Team Bridge thread, 48 pt in the agent transcript), so the
 * first points of an upward drag still read as at the tail, and every
 * streamed row, layout commit or content-size event clamped the offset back
 * to the end under the finger. Only a flick that crossed the band between two
 * scroll events escaped.
 *
 * THE RULE, shared by both lists so they cannot drift apart again (PR #289
 * round 1, N1): from the moment the reader starts scrolling until that scroll
 * comes to REST, no programmatic follow runs. At rest, `onRest` lets the list
 * decide from the reader's own CURRENT geometry whether they came back to the
 * end.
 *
 * - Native: a drag (`onScrollBeginDrag`) or a fling's glide
 *   (`onMomentumScrollBegin`) holds. The hold rests on `onMomentumScrollEnd`,
 *   or DRAG_RELEASE_MS after `onScrollEndDrag` when no glide began.
 * - Web has no drag/momentum events. A wheel or scroll key holds until the
 *   list has been idle for WEB_IDLE_MS. A mouse or pen pointer, and a touch,
 *   hold for as long as they are down, and rest WEB_IDLE_MS after they lift
 *   (PR #289 M2: a finger resting mid-drag must not time out). TOUCH is held
 *   through the touch CAPTURE events, not pointer events (R2-M1 / Q2-1): when
 *   a touch pan starts, the browser takes the gesture over for native
 *   scrolling and fires `pointercancel`, so a pointer-based hold dropped while
 *   the finger was still on the glass. Capture props leave `onTouchStart` the
 *   text-selection wiring's own. A lost up event cannot pin the hold forever:
 *   while down, moves and scroll events renew it, and otherwise it rests after
 *   WEB_DOWN_SAFETY_MS.
 */

/**
 * How long after the finger lifts a momentum glide may still begin before the
 * drag counts as over (N2). React Native raises `onMomentumScrollBegin` on the
 * same main-thread pass that ends the drag on iOS (`scrollViewWillEndDragging`
 * → `scrollViewWillBeginDecelerating`) and within a frame or two on Android's
 * fling; 120 ms is ~7 frames at 60 Hz, generous for that hand-off yet below
 * the ~150-200 ms a reader perceives as a hesitation before follow resumes.
 * It only decides WHEN a resting reader at the end is re-pinned; a reader
 * still moving is held by the glide itself.
 */
export const DRAG_RELEASE_MS = 120;
/**
 * Web idle before a wheel/key/lifted-pointer scroll counts as at rest (N2).
 * Browsers deliver wheel and inertial trackpad scroll events every frame
 * (~16 ms) while moving; macOS inertial scrolling can space its tail events
 * ~50-100 ms apart. 150 ms clears that tail without a perceptible delay
 * before following resumes.
 */
export const WEB_IDLE_MS = 150;
/**
 * A pointer held down without moving or scrolling for this long is treated
 * as released: a `pointerup` lost outside the window must not leave the list
 * unable to follow for good. Long enough for any real pause mid-drag.
 */
export const WEB_DOWN_SAFETY_MS = 4000;

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

/** Whether a key event is the reader scrolling the list (not a control). */
export const isScrollKey = (event: KeyIntentEvent) =>
	SCROLL_KEYS.has(event.key) && !fromControl(event);

/** Web scroll-intent handlers; every one is absent on native. */
/**
 * The part of a pointer event the hold reads. React Native types the event as
 * `NativeSyntheticEvent<NativePointerEvent>`, with `pointerType` on
 * `nativeEvent`; react-native-web hands over React DOM's synthetic event,
 * which carries it on both. `nativeEvent` is read first; the top-level field
 * covers callers (and tests) that pass a bare event. Typing `nativeEvent`
 * also gives the shape a property in common with RN's `PointerEvent`, which
 * TypeScript's weak-type check requires (PR #289 R3, TS2769).
 */
export type PointerIntentEvent = {
	pointerType?: string;
	nativeEvent?: { pointerType?: string };
};
const isTouch = (event?: PointerIntentEvent) =>
	(event?.nativeEvent?.pointerType ?? event?.pointerType) === "touch";

export type ReaderScrollWebHandlers = Partial<{
	onWheel: () => void;
	onPointerDown: (event?: PointerIntentEvent) => void;
	onPointerMove: (event?: PointerIntentEvent) => void;
	onPointerUp: (event?: PointerIntentEvent) => void;
	onPointerCancel: (event?: PointerIntentEvent) => void;
	onTouchStartCapture: () => void;
	onTouchMoveCapture: () => void;
	onTouchEndCapture: () => void;
	onTouchCancelCapture: () => void;
	onKeyDown: (event: KeyIntentEvent) => void;
}>;

export type ReaderScrollHoldOptions = {
	/** The reader's scroll came to rest; decide follow from CURRENT geometry. */
	onRest: () => void;
	/**
	 * A reader scroll began or continued (every begin, not only the first):
	 * cancel any programmatic move in flight.
	 */
	onBegin?: () => void;
	/** Web: wheel/pointer/key holds with idle release; native: drag/momentum. */
	web: boolean;
	/** Run `run` after `ms`; returns a cancel. Tests inject one. */
	schedule?: (run: () => void, ms: number) => () => void;
};

const timeout = (run: () => void, ms: number) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

export function createReaderScrollHold(options: ReaderScrollHoldOptions) {
	const schedule = options.schedule ?? timeout;
	let active = false;
	let momentum = false;
	/** A mouse/pen pointer is down. */
	let pointerDown = false;
	/** A finger is on the list (touch capture events). */
	let touching = false;
	const isDown = () => pointerDown || touching;
	let release: (() => void) | null = null;
	const cancelRelease = () => {
		release?.();
		release = null;
	};
	const arm = (ms: number) => {
		cancelRelease();
		release = schedule(rest, ms);
	};
	const rest = () => {
		cancelRelease();
		pointerDown = false;
		touching = false;
		if (!active) return;
		active = false;
		momentum = false;
		options.onRest();
	};
	const begin = () => {
		cancelRelease();
		active = true;
		options.onBegin?.();
	};
	const press = () => {
		begin();
		arm(WEB_DOWN_SAFETY_MS);
	};
	const lift = () => {
		if (active && !isDown()) arm(WEB_IDLE_MS);
	};
	/** Web wheel / key / scrollbar: held until idle (or until a lift). */
	const nudge = () => {
		begin();
		arm(isDown() ? WEB_DOWN_SAFETY_MS : WEB_IDLE_MS);
	};
	return {
		get active() {
			return active;
		},
		beginDrag() {
			begin();
			// A glide caught by a new drag is over: without this reset the
			// drag's end saw `momentum` still set and never released (PR #289
			// M1 / Q1-1).
			momentum = false;
			// Web may raise a begin-drag with no end/momentum after it.
			if (options.web) arm(isDown() ? WEB_DOWN_SAFETY_MS : WEB_IDLE_MS);
		},
		endDrag() {
			if (!active || momentum) return;
			arm(DRAG_RELEASE_MS);
		},
		beginMomentum() {
			begin();
			momentum = true;
		},
		endMomentum: rest,
		/**
		 * Any scroll event. Native: nothing (drag/momentum bound the hold).
		 * Web: a held scroll restarts its idle clock, or its safety clock
		 * while a pointer is still down.
		 */
		scrolled() {
			if (!active || !options.web) return;
			arm(isDown() ? WEB_DOWN_SAFETY_MS : WEB_IDLE_MS);
		},
		/** Spread onto the list on web (empty on native). */
		webHandlers: (options.web
			? {
					onWheel: nudge,
					// Mouse and pen only: touch is held by the capture events below,
					// and its `pointercancel` at pan start is the browser, not a lift.
					onPointerDown: (event?: PointerIntentEvent) => {
						if (isTouch(event)) return;
						pointerDown = true;
						press();
					},
					onPointerMove: (event?: PointerIntentEvent) => {
						if (isTouch(event) || !pointerDown) return;
						press();
					},
					onPointerUp: (event?: PointerIntentEvent) => {
						if (isTouch(event) || !pointerDown) return;
						pointerDown = false;
						lift();
					},
					onPointerCancel: (event?: PointerIntentEvent) => {
						if (isTouch(event) || !pointerDown) return;
						pointerDown = false;
						lift();
					},
					onTouchStartCapture: () => {
						touching = true;
						press();
					},
					onTouchMoveCapture: () => {
						if (!touching) return;
						press();
					},
					onTouchEndCapture: () => {
						if (!touching) return;
						touching = false;
						lift();
					},
					onTouchCancelCapture: () => {
						if (!touching) return;
						touching = false;
						lift();
					},
					onKeyDown: (event: KeyIntentEvent) => {
						if (isScrollKey(event)) nudge();
					},
				}
			: {}) as ReaderScrollWebHandlers,
		/** The list unmounted: drop a pending release without resting (m2). */
		dispose() {
			cancelRelease();
			active = false;
			momentum = false;
			pointerDown = false;
			touching = false;
		},
	};
}

export type ReaderScrollHold = ReturnType<typeof createReaderScrollHold>;

/** Sub-point slack for "at the end": web offsets are fractional. */
export const REST_END_SLACK_PT = 1;

/**
 * The tail decision at rest, from the CURRENT geometry (PR #289 Q1-2).
 *
 * The scroll-event `atTail` is stale at rest: content that streamed in while
 * the finger was still raised no scroll event, so a reader 30 pt up with
 * 240 pt arriving underneath still read as "at the tail". Distance is
 * measured against the latest content height.
 *
 * ONLY THE END ITSELF IS THE TAIL AT REST (TestFlight 1157: "it jitters when
 * the scroll finishes and ends me in a different position than the scroll
 * smooth finish"). #289 treated a rest anywhere inside the follow band as the
 * tail and pinned it to the end: a write after the scroll had stopped. The
 * band still decides while content moves under a follower; it no longer
 * decides where a reader who chose to stop belongs. `bandPt` stays in the
 * signature so the caller names the band this deliberately does not use.
 */
export const restsAtTail = (geometry: {
	offsetY: number;
	viewportPt: number;
	contentPt: number;
	bandPt: number;
}): boolean =>
	geometry.contentPt - geometry.offsetY - geometry.viewportPt <=
	REST_END_SLACK_PT;
