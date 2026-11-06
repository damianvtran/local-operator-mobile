/**
 * The transcript's scroll-linked chrome, as arithmetic and one tiny signal.
 *
 * TWO CONSUMERS, ONE SOURCE. The edge fades (item 8 of the design pass) are a
 * function of WHERE the list is scrolled; the checkpoint rail (item 10) is a
 * function of WHETHER it is moving. Both used to be absent, and the rail was the
 * permanent right-edge column of ticks the operator read as a scrollbar. Nothing
 * here draws: this module answers the two questions and the components paint the
 * answer, so the maths is testable without a renderer or an animation clock.
 *
 * WHY THE RAIL IS TIME-BASED AND NOT POSITION-BASED. A rail keyed to velocity
 * flickers on a slow drag; a rail keyed to "has moved recently" is the behaviour
 * every platform's transient scrollbar has — visible while you move, gone a
 * moment after you stop. `RAIL_LINGER_MS` is that moment.
 *
 * WHY A SUBSCRIPTION RATHER THAN STATE. The rail lives in the session screen
 * beside the list, so the signal has to cross one component boundary. A React
 * state flip there would re-render the screen — and the screen owns the whole
 * transcript, the composer and the panels — twice per gesture. So the presence
 * is a plain object the screen owns, the list reports into it, the rail
 * subscribes, and the only thing that changes per gesture is an animated
 * opacity value the rail already knows how to drive natively.
 */

/** The fade band's height in points, both edges. One constant shared by the
 *  top and bottom overlays, and the same 24 pt the sheet body fade and the
 *  markdown table cue already use (`sheet.tsx`'s `SHEET_BODY_FADE`,
 *  `markdown.tsx`'s `TABLE_FADE_PT`) — a third value would be a third
 *  language for the same cue. */
export const TRANSCRIPT_FADE_PT = 24;

/** The distance over which an edge fade ramps between absent and full. Equal to
 *  the band height on purpose: over 24 pt of travel the band goes from invisible
 *  to opaque, which is slow enough to read as a gradient appearing rather than
 *  as a flicker, and it means the band is never half-painted at an extreme. */
export const FADE_RAMP_PT = TRANSCRIPT_FADE_PT;

/** How long the rail stays up after the offset stops moving. */
export const RAIL_LINGER_MS = 1500;

/** The rail's fade in and out. Fast enough to be gone before a reader can aim
 *  at it, slow enough not to strobe at the end of a flick. */
export const RAIL_FADE_MS = 200;

export type EdgeFadeLevels = {
	/** 0 = no fade at the top edge, 1 = fully faded. */
	top: number;
	/** 0 = no fade at the bottom edge, 1 = fully faded. */
	bottom: number;
};

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);

/**
 * Both edge fades, from the three facts the list already tracks.
 *
 * The rules, in the order they win:
 *  - content that does not scroll has NO fade at either edge (a fade on a
 *    screen with nothing hidden behind it is a lie about there being more);
 *  - at the top extreme the top fade is 0, and the bottom fade ramps in over
 *    the first `FADE_RAMP_PT` of travel;
 *  - at the bottom extreme the bottom fade is 0, and the top fade ramps out
 *    over the last `FADE_RAMP_PT`;
 *  - anywhere between, both are 1.
 *
 * `contentPt` is the scroller's content height and `viewportPt` its own height;
 * the maximum offset is their difference, which is what every platform clamps
 * to. A negative maximum (the content shrank under the reader) reads as "does
 * not scroll".
 */
export function edgeFadeLevels({
	offsetY,
	contentPt,
	viewportPt,
}: {
	offsetY: number;
	contentPt: number;
	viewportPt: number;
}): EdgeFadeLevels {
	const maxOffset = contentPt - viewportPt;
	if (!(maxOffset > 0)) return { top: 0, bottom: 0 };
	const offset = clamp01(offsetY / maxOffset) * maxOffset;
	return {
		top: clamp01(offset / FADE_RAMP_PT),
		bottom: clamp01((maxOffset - offset) / FADE_RAMP_PT),
	};
}

/**
 * The rail's presence signal: "the list has moved recently, or is being held".
 *
 * Owned by the screen (`createScrollPresence`), reported to by the list and
 * subscribed to by the rail. `dispose` clears the pending timer; a screen that
 * unmounts mid-linger must not leave one behind.
 */
export type ScrollPresence = {
	/** The offset moved to this value. Ignored when it is the offset already
	 *  reported — a platform that re-delivers the same event must not restart
	 *  the linger, or a stationary list under a scroll view that keeps emitting
	 *  would hold the rail up forever. */
	noteMovement(offsetY: number): void;
	/** A drag gesture began or ended. A HELD thumb keeps the rail up however
	 *  long the reader holds still, which is the pointer analogue of a desktop
	 *  scrollbar's thumb staying under the cursor. */
	setHeld(held: boolean): void;
	/** Fires on every visibility flip. Returns the unsubscribe. */
	subscribe(listener: (visible: boolean) => void): () => void;
	/** The current answer, for a subscriber that mounts late. */
	readVisible(): boolean;
	dispose(): void;
};

export function createScrollPresence(): ScrollPresence {
	let visible = false;
	let held = false;
	let lastOffset: number | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const listeners = new Set<(visible: boolean) => void>();

	const emit = (): void => {
		for (const listener of listeners) listener(visible);
	};
	const clear = (): void => {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
	};
	const show = (): void => {
		if (visible) return;
		visible = true;
		emit();
	};
	/** Start the linger. A held thumb never starts it. */
	const arm = (): void => {
		clear();
		if (held) return;
		timer = setTimeout(() => {
			timer = null;
			if (!visible) return;
			visible = false;
			emit();
		}, RAIL_LINGER_MS);
	};

	return {
		noteMovement(offsetY: number) {
			if (lastOffset !== offsetY) {
				lastOffset = offsetY;
				show();
			}
			arm();
		},
		setHeld(next: boolean) {
			held = next;
			if (held) {
				clear();
				show();
				return;
			}
			arm();
		},
		subscribe(listener: (visible: boolean) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		readVisible() {
			return visible;
		},
		dispose() {
			clear();
			listeners.clear();
		},
	};
}
