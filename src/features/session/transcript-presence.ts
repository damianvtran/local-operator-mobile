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
 * The gradient's two stop opacities for one edge band, in offset order
 * (`[offset 0, offset 1]`) along a gradient drawn top → bottom.
 *
 * WHY THIS IS A FUNCTION WITH ITS OWN TEST. Round 1 shipped both bands inverted
 * (design D1): solid canvas on the CONTENT side and clear at the screen edge,
 * which paints a hard canvas line 24 pt in instead of dissolving the content
 * into the edge. Nothing pinned the order, because the levels test only covers
 * how strongly a band shows, not which way it runs. The rule, and the in-repo
 * precedent (`sheet.tsx`'s bottom cue, the same `y1 0% → y2 100%` geometry):
 * the band is OPAQUE at the screen edge and CLEAR toward the content.
 *  - top band: offset 0 is the screen's top edge → `[1, 0]`;
 *  - bottom band: offset 1 is the screen's bottom edge → `[0, 1]`.
 */
export function edgeFadeStops(
	edge: "top" | "bottom",
): readonly [number, number] {
	return edge === "top" ? [1, 0] : [0, 1];
}

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
 * The rail's presence signal: "the READER is moving the list, or just did".
 *
 * Owned by the screen (`createScrollPresence`), reported to by the list and
 * subscribed to by the rail. `dispose` clears the pending timer; a screen that
 * unmounts mid-linger must not leave one behind.
 *
 * ONLY THE READER'S OWN GESTURE COUNTS (review round 1, U3 / m2 / Q4). The list
 * moves itself too: the tail pin (`pinTail` → `scrollToOffset`) runs on every
 * content growth while a turn streams, and the platforms deliver `onScroll` for
 * that programmatic offset like any other. Counting it raised the rail through
 * every streaming turn — the "constantly take space" the operator asked to be
 * rid of, in the state they spend most time in. So movement shows the rail only
 * while a drag holds the list (`setHeld`) or its momentum carries it
 * (`setCoasting`); an offset change outside both is a scroll the app made, and
 * is recorded but never shown. Known limit: a web wheel scroll emits neither
 * gesture event, so on the web target the rail answers touch drags only.
 */
export type ScrollPresence = {
	/** The offset moved to this value. Shows the rail only during a reader
	 *  gesture (see above). Ignored when it is the offset already reported — a
	 *  platform that re-delivers the same event must not restart the linger, or
	 *  a stationary list under a scroll view that keeps emitting would hold the
	 *  rail up forever (round 1, m3 / Q3 / U8). */
	noteMovement(offsetY: number): void;
	/** A drag gesture began or ended. A HELD thumb keeps the rail up however
	 *  long the reader holds still, which is the pointer analogue of a desktop
	 *  scrollbar's thumb staying under the cursor. */
	setHeld(held: boolean): void;
	/** The list's momentum after a drag began or ended. The rail stays up while
	 *  it coasts and lingers from the moment it stops, so a flick reads as one
	 *  gesture rather than a drag plus an unexplained glide. */
	setCoasting(coasting: boolean): void;
	/** Fires on every visibility flip. Returns the unsubscribe. */
	subscribe(listener: (visible: boolean) => void): () => void;
	/** The current answer, for a subscriber that mounts late. */
	readVisible(): boolean;
	dispose(): void;
};

export function createScrollPresence(): ScrollPresence {
	let visible = false;
	let held = false;
	let coasting = false;
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
	/** Start the linger. A held thumb or a coasting list never starts it. */
	const arm = (): void => {
		clear();
		if (held || coasting) return;
		timer = setTimeout(() => {
			timer = null;
			if (!visible) return;
			visible = false;
			emit();
		}, RAIL_LINGER_MS);
	};

	return {
		noteMovement(offsetY: number) {
			/* A repeated offset is not movement and must not re-arm the linger. */
			if (lastOffset === offsetY) return;
			lastOffset = offsetY;
			/* A scroll the app made (the tail pin, a restore) is not the reader's. */
			if (!held && !coasting) return;
			show();
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
		setCoasting(next: boolean) {
			coasting = next;
			if (coasting) {
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
