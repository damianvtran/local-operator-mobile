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
 * KNOWN LIMIT — ON WEB THE DOCK NEVER SHRINKS FROM SCROLLING. react-native-web
 * emits only `onScroll` (no drag or momentum events: see `transcript-presence.ts`),
 * so every web offset reads as one the app made. Accepted: the compaction is a
 * touch behaviour. `initialShrunk` is the test seam that lets a web frame render
 * the shrunk state.
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
/** The least time between two scroll-driven flips. A tap, a send, a jump or a pin
 *  is the reader's intent and is not held. */
export const HOLD_MS = 300;

export type ComposerCompaction = {
	/** The reader's finger went down on the list at this offset. */
	beginDrag(offsetY: number): void;
	/** The list scrolled to `offsetY`, `distanceToTail` points short of its end
	 *  (negative past it). Shrinks only while a drag holds the list. */
	noteOffset(offsetY: number, distanceToTail: number): void;
	/** The finger lifted. `velocityPtPerS` is the release velocity (the list
	 *  reports pt/ms; multiply by 1000), either sign. */
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
		/* Intent also resets the hold, so the next scroll-driven flip is free. */
		lastFlipAt = held ? now() : Number.NEGATIVE_INFINITY;
		clearDwell();
		emit();
	};
	const requestShrink = (): void => {
		if (!enabled || pinned) return;
		set(true, true);
	};
	const atTail = (): boolean => distance <= TAIL_BAND_PT;
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
			clearDwell();
		},
		noteOffset(offsetY, distanceToTail) {
			distance = distanceToTail;
			if (dragging && dragStart !== null) {
				const net = Math.abs(
					withoutOverscroll(offsetY, distanceToTail) - dragStart,
				);
				if (net >= SHRINK_DISTANCE_PT) requestShrink();
			}
			evaluateDwell();
		},
		endDrag(velocityPtPerS) {
			dragging = false;
			dragStart = null;
			/* A fling that ends at the tail goes nowhere: shrinking there is a shape
			 *  the dwell would undo 300 ms later. */
			if (Math.abs(velocityPtPerS) >= FLING_PT_PER_S && !atTail())
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
