/**
 * When the session composer shrinks to its one-row pill while the reader scrolls
 * the transcript, and when it grows back. Arithmetic and one tiny signal: nothing
 * here draws and nothing imports React or `react-native`, so every rule is
 * asserted in Node with a fake clock.
 *
 * WHY THIS EXISTS (operator, 2026-11-23). The dock rests as the 112 pt card, which
 * costs the transcript 56 pt more than the 56 pt pill. While the reader is moving
 * through the transcript they are not writing, so the composer yields that room
 * and returns the moment they stop or reach for it. Rest is the FULL CARD; a typed
 * draft still shrinks (the pill shows its first line, the text is never altered).
 *
 * THE NUMBERS ARE DESIGN VALUES, NOT MEASURED. Source: the composer-compaction
 * design spec of 2026-11-23 (§4.1, §4.5) and its tuned prototype. No device trace
 * of this app's scrolling exists yet, so there is no distribution here to cap
 * against — tune them from TestFlight, not from these comments (AGENTS.md,
 * "Measure before you cap").
 *
 * WHICH SCROLLS COUNT. Only the READER'S gesture can shrink the dock: a drag the
 * finger holds (`beginDrag` … `endDrag`), or the release of a fast one. The list
 * also moves itself — the tail pin on every streaming growth, a history load, a
 * find reveal, `snapToTail` — and the platforms deliver `onScroll` for those like
 * any other offset. They arrive here as `noteOffset` outside a drag and are
 * recorded as a distance only: they can never shrink the dock. Momentum alone
 * never flips either; only its drag (distance or release velocity) does. This is
 * the same split `transcript-presence.ts` makes for the checkpoint rail.
 *
 * WHY A SUBSCRIPTION AND NOT STATE. The list reports at scroll rate; the Composer
 * lives in the session screen beside the whole transcript. A React state flip per
 * scroll event would re-render all of it. The screen owns this object, the list
 * reports into it, the Composer subscribes, and the only thing that ever reaches
 * React is the boolean flip.
 *
 * THE TAIL TEST IS MADE IN THE CARD'S FRAME. Shrinking resizes the list, and a
 * resize alone moves the reading the dwell rule judges (see `atTail`); the viewport
 * rides along with every offset so that the dock's own height change can never
 * satisfy the rule that grows it back.
 *
 * GROWING BACK NEEDS A RETURN. Settling in the tail band for the dwell is not
 * enough on its own, or the resize that shrank the dock would grow it again. The
 * reader has returned when EITHER they travelled `SHRINK_DISTANCE_PT` away and back
 * in the card's frame, OR their last finger run moved at least `TOWARD_TAIL_MIN_PT`
 * toward the tail (UX U2: a reader who drags up 30–80 pt and comes back must not be
 * left in a pill). The run is read off the raw offset and only inside a drag, so
 * neither the dock's resize nor the tail pin can feed it, and a nudge up and idle
 * stays a pill: the reader is reading.
 *
 * NOTHING TO SCROLL, NOTHING TO SHRINK. A transcript that fits its viewport has no
 * distance to travel, so a bounce or a fling on it never shrinks the dock (QA Q1).
 * A fling toward the tail from inside the band goes nowhere and is ignored; one
 * away from it carries the reader off and shrinks (QA Q3).
 *
 * KNOWN LIMIT — ON WEB THE DOCK NEVER SHRINKS FROM SCROLLING. react-native-web
 * emits only `onScroll` (no drag or momentum events: see `transcript-presence.ts`),
 * so every web offset reads as one the app made. Accepted: the compaction is a
 * touch behaviour. `initialShrunk` is the test seam that lets a web frame render
 * the shrunk state. It works on web because the screen-reader gate is OFF there
 * (`screenReaderSignalUsable`): react-native-web reports a screen reader as always
 * running, which would otherwise disable the compaction, and the seam with it.
 */

/** A reader's drag that nets this far from where it began, either direction,
 *  shrinks the dock. Above a few points so a tap's wobble never does; below a
 *  line of text so the room is given back as soon as the reader is clearly
 *  travelling. */
export const SHRINK_DISTANCE_PT = 24;
/** A release at or above this speed shrinks the dock even if the drag was short:
 *  the reader flicked, and the glide will carry them well past `SHRINK_DISTANCE_PT`.
 *  The same 1000 pt/s the checkpoint rail uses for "fast" (`RAIL_FAST_PT_PER_MS`). */
export const FLING_PT_PER_S = 1000;
/** Within this distance of the end of the transcript the reader is "at the tail".
 *  Deliberately under `SHRINK_DISTANCE_PT` so one drag cannot satisfy shrink and
 *  grow-back at once and flicker at the boundary. */
export const TAIL_BAND_PT = 16;
/** The reader must stay inside the tail band this long, with no finger down and no
 *  glide, before the dock grows back. Long enough to ignore a pass-through. */
export const TAIL_DWELL_MS = 150;
/** A settle inside the tail band also grows the dock when the reader's LAST finger
 *  run moved at least this far TOWARD the tail (offset increasing, overscroll
 *  counted): they went to the end on purpose, however shallow the peek away was.
 *  A nudge away and no return leaves the run at 0, so a reader who stops to read
 *  stays a pill. A DESIGN VALUE like the rest, not a measurement: in the UX
 *  review's simulated drag-away-and-return traces (2026-11-23) 12 and 8 left some
 *  returning drags a pill and 6 did not. Tune it on TestFlight. */
export const TOWARD_TAIL_MIN_PT = 6;
/** The largest single step AWAY from the tail that is still jitter, in points. A
 *  finger that has stopped (or lifts) still reports a sub-point wobble, and one
 *  such step used to zero the run, so a fling TOWARD the tail shrank the dock and
 *  nothing grew it back (review R4-2 / QA Q1). A step at or under this costs the
 *  run only what it moved back; a larger one, or one that comes with the dock's own resize, ends the run.
 *  A DESIGN VALUE like the rest, not a measurement: it sits under
 *  `TOWARD_TAIL_MIN_PT`, so one wobble cannot undo a run that counted. Tune it on
 *  TestFlight. */
export const TOWARD_RESET_PT = 2;
/** The least time between two scroll-driven flips. A tap, a send, a jump or a pin
 *  is the reader's intent and is not held. */
export const HOLD_MS = 300;

export type ComposerCompaction = {
	/** The reader's finger went down on the list at this offset. */
	beginDrag(offsetY: number): void;
	/** The list scrolled to `offsetY`, `distanceToTail` points short of its end
	 *  (negative past it), its viewport `viewportHeight` tall. Shrinks only while a
	 *  drag holds the list. The viewport is how the tail test stays independent of
	 *  the dock's own height change (see `atTail`); absent, it reads as unchanged. */
	noteOffset(
		offsetY: number,
		distanceToTail: number,
		viewportHeight?: number,
	): void;
	/** The finger lifted. `velocityPtPerS` is the release velocity (the list
	 *  reports pt/ms; multiply by 1000). Only its magnitude is read: its sign is
	 *  platform-dependent (offset rate on iOS, finger rate on Android). */
	endDrag(velocityPtPerS: number): void;
	/** The list's glide after a release began or ended. */
	setCoasting(coasting: boolean): void;
	/** Something is on the card that must stay visible (attachment, dictation,
	 *  error, `$` tray, `/` sheet, focus/keyboard). While pinned the dock never
	 *  shrinks, and a pin appearing grows it back at once. */
	setPinned(pinned: boolean): void;
	/** Off for a screen reader, a tablet or split layout, or short landscape: the
	 *  dock stays whatever the Composer already makes it, and the signal rests at
	 *  "not shrunk". */
	setEnabled(enabled: boolean): void;
	/** The reader asked for the card: a send, jump-to-latest, a tap on the pill.
	 *  Beats the hold, and the next scroll-driven flip is not held either. */
	grow(): void;
	subscribe(listener: (shrunk: boolean) => void): () => void;
	readShrunk(): boolean;
	dispose(): void;
};

export type ComposerCompactionOptions = {
	/** The clock the hold is measured against; injectable for tests. Timers are
	 *  the platform's `setTimeout`, which vitest's fake timers drive together
	 *  with `Date.now`. */
	now?: () => number;
	/** Start shrunk. The test seam for rendering frames of the shrunk state,
	 *  chiefly on web where no reader gesture can reach it. */
	initialShrunk?: boolean;
};

/** A distance to the tail that has not been reported yet reads as "far". */
const FAR_PT = Number.POSITIVE_INFINITY;

/** An offset with the elastic overscroll taken off: past the top reads as the top
 *  and past the end as the end. Bounce at the tail would otherwise net 24 pt on a
 *  reader who never left it, and shrink a dock the dwell rule grows back 300 ms
 *  later. */
const withoutOverscroll = (offsetY: number, distanceToTail: number): number =>
	Math.max(0, offsetY) +
	Math.min(0, Number.isFinite(distanceToTail) ? distanceToTail : 0);

export function createComposerCompaction(
	options: ComposerCompactionOptions = {},
): ComposerCompaction {
	const now = options.now ?? Date.now;
	let shrunk = options.initialShrunk === true;
	let enabled = true;
	let pinned = false;
	let dragging = false;
	let coasting = false;
	/* Where the current drag began, overscroll removed. */
	let dragStart: number | null = null;
	let distance = FAR_PT;
	/* THE TAIL TEST IN THE CARD'S FRAME (review R1). Shrinking makes the list's
	 *  viewport taller by the dock's own height delta, so the same finger position
	 *  reads that much closer to the tail on the next offset event: a 24–72 pt drag
	 *  shrank the dock, the resize pulled the reading into the band, and the dock
	 *  grew back 450 ms after release. `adjusted` is the distance the card's
	 *  viewport would show — the raw one plus the viewport growth since the flip —
	 *  and `peakAway` its farthest value since the flip. Settling at the tail only
	 *  grows the dock once the reader has come back from that peak by a shrink
	 *  distance in that frame, so the resize alone can never satisfy it. */
	let viewport: number | null = null;
	let flipViewport: number | null = null;
	let adjusted = FAR_PT;
	let peakAway = FAR_PT;
	/* THE READER'S LAST RUN TOWARD THE TAIL (UX U2). The excursion rule above asks a
	 *  reader who peeked 30–80 pt up to travel 24 pt away AND back before the dock
	 *  returns, which left a reader who dragged up a little and came back in a pill.
	 *  `towardRun` is how far the finger's current run has carried the RAW offset
	 *  toward the tail since the last reversal (a step away over `TOWARD_RESET_PT`) or
	 *  touch; it is judged on the raw
	 *  offset, so the dock's own resize (which moves the viewport, not the offset)
	 *  cannot feed it, and it only counts inside a drag, so the tail pin cannot
	 *  either. */
	let lastRawOffset: number | null = null;
	let towardRun = 0;
	/* Whether the list has anything to scroll: content taller than its viewport.
	 *  Unknown until the first offset, and then it reads as scrollable. */
	let scrollable = true;
	/* `-Infinity`: nothing held until the first flip. */
	let lastFlipAt = Number.NEGATIVE_INFINITY;
	let dwellTimer: ReturnType<typeof setTimeout> | null = null;
	const listeners = new Set<(shrunk: boolean) => void>();

	const emit = (): void => {
		for (const listener of listeners) listener(shrunk);
	};
	const clearDwell = (): void => {
		if (dwellTimer === null) return;
		clearTimeout(dwellTimer);
		dwellTimer = null;
	};
	const set = (next: boolean, held: boolean): void => {
		if (shrunk === next) return;
		/* A scroll-driven flip waits out the hold; the reader's own intent does not. */
		if (held && now() - lastFlipAt < HOLD_MS) return;
		shrunk = next;
		/* A new flip starts a new excursion, measured from here. */
		flipViewport = next ? viewport : null;
		peakAway = next ? distance : FAR_PT;
		adjusted = distance;
		/* Intent also resets the hold, so the next scroll-driven flip is free. */
		lastFlipAt = held ? now() : Number.NEGATIVE_INFINITY;
		clearDwell();
		emit();
	};
	const requestShrink = (): void => {
		if (!enabled || pinned) return;
		set(true, true);
	};
	/* Settled at the tail: in the band AND the reader came back to it, either by
	 *  travelling away and back in the card's frame, or by a finger run toward it. */
	const atTail = (): boolean =>
		distance <= TAIL_BAND_PT &&
		(!shrunk ||
			peakAway - adjusted >= SHRINK_DISTANCE_PT ||
			towardRun >= TOWARD_TAIL_MIN_PT);
	/** Arm or drop the dwell: shrunk, inside the band, finger up, no glide. */
	const evaluateDwell = (): void => {
		if (!shrunk || dragging || coasting || !atTail()) {
			clearDwell();
			return;
		}
		if (dwellTimer !== null) return;
		const arm = (ms: number): void => {
			dwellTimer = setTimeout(() => {
				dwellTimer = null;
				if (!shrunk || dragging || coasting || !atTail()) return;
				const wait = HOLD_MS - (now() - lastFlipAt);
				/* Inside the hold of the shrink that just happened: try again when
				 *  it ends, rather than dropping the grow-back for good. */
				if (wait > 0) {
					arm(wait);
					return;
				}
				set(false, true);
			}, ms);
		};
		arm(TAIL_DWELL_MS);
	};

	return {
		beginDrag(offsetY) {
			dragging = true;
			/* A new touch ends any glide it caught; `onMomentumScrollEnd` is not
			 *  reliably delivered first. */
			coasting = false;
			dragStart = withoutOverscroll(offsetY, distance);
			lastRawOffset = offsetY;
			towardRun = 0;
			clearDwell();
		},
		noteOffset(offsetY, distanceToTail, viewportHeight) {
			distance = distanceToTail;
			/* offset + distance is content − viewport, whatever the overscroll: the
			 *  scrollable range, negative when everything already fits. A bounce on
			 *  a short transcript has nowhere to go, so it must not shrink the dock. */
			scrollable = offsetY + distanceToTail > 0;
			/* An offset report that carries a NEW viewport is the dock's own resize
			 *  talking (the list clamps its offset to the new end), not the finger. */
			const resized =
				viewportHeight !== undefined &&
				viewport !== null &&
				viewportHeight !== viewport;
			if (viewportHeight !== undefined) viewport = viewportHeight;
			const growth =
				shrunk && flipViewport !== null && viewport !== null
					? Math.max(0, viewport - flipViewport)
					: 0;
			adjusted = distanceToTail + growth;
			if (shrunk) peakAway = Math.max(peakAway, adjusted);
			if (dragging && dragStart !== null) {
				const net = Math.abs(
					withoutOverscroll(offsetY, distanceToTail) - dragStart,
				);
				/* The run is brought up to date BEFORE the shrink: a listener that
				 *  resizes the list at once can re-enter with the clamped offset, and
				 *  it must find this event's offset already recorded, or the clamp
				 *  would read as a run toward the tail. */
				const step = offsetY - (lastRawOffset ?? offsetY);
				if (step > 0) towardRun += step;
				else if (step < 0)
					towardRun =
						resized || -step > TOWARD_RESET_PT
							? 0
							: Math.max(0, towardRun + step);
				lastRawOffset = offsetY;
				if (net >= SHRINK_DISTANCE_PT && scrollable) requestShrink();
			}
			lastRawOffset = offsetY;
			evaluateDwell();
		},
		endDrag(velocityPtPerS) {
			dragging = false;
			dragStart = null;
			/* A fling TOWARD the tail from inside the band goes nowhere: shrinking
			 *  there is a shape the dwell would undo (the hold, `HOLD_MS` 300 ms from the
			 *  last flip, then `TAIL_DWELL_MS` 150 ms). A fling AWAY from
			 *  it that starts inside the band carries the reader off (QA Q3), so
			 *  only a toward-tail drag is exempt. "Toward" comes from the finger's own
			 *  offset motion (`towardRun`), never from the velocity's sign: iOS
			 *  reports the offset's rate (positive toward the end) but Android
			 *  reports the finger's (positive = offset falling), so the sign means
			 *  opposite things there. Only the magnitude is read from the velocity. */
			const towardTail = towardRun > 0 && distance <= TAIL_BAND_PT;
			if (
				Math.abs(velocityPtPerS) >= FLING_PT_PER_S &&
				scrollable &&
				!towardTail
			)
				requestShrink();
			evaluateDwell();
		},
		setCoasting(next) {
			coasting = next;
			evaluateDwell();
		},
		setPinned(next) {
			pinned = next;
			if (pinned) set(false, false);
		},
		setEnabled(next) {
			enabled = next;
			if (!enabled) {
				dragging = false;
				dragStart = null;
				set(false, false);
			}
		},
		grow() {
			set(false, false);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		readShrunk() {
			return shrunk;
		},
		dispose() {
			clearDwell();
			listeners.clear();
		},
	};
}
