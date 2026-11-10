import { composerOuterGap } from "@/ui/device-corner";

/** The field's painted box on iOS at 100 % text: the 44 pt touch floor. The
 *  web and Android floor is 48, so every total below is a FUNCTION of the
 *  platform floor — the record's 56/112 are its iOS values, and the same rule
 *  paints 56/120 where the floor is larger (the resting pill is 56 everywhere
 *  since H5, below). Hardcoding 44 here is what made a
 *  web frame look 4 pt "wrong" when it was the record's rule on another floor. */
export const COMPOSER_FIELD_BOX = 44;
/** The record's gap between the expanded field and its controls row. */
export const COMPOSER_CONTROLS_GAP = 4;
/** The record's two painted totals, exported so the component animates TO them. */
export const COMPOSER_BASE_HEIGHT = 56;
export const COMPOSER_EXPANDED_HEIGHT = 112;
/** The resting shell's vertical padding: ONE `space.1` step (4 pt).
 *
 *  WHY 4, and why the resting row is 48 (H5, operator build-453 pass). The
 *  record's pill was 6 + 44 + 6, and 6 is off the 4 pt `space.scale`: the web
 *  audit's U-42 failed ~612 rows per device on that padding alone. The two
 *  on-scale splits that keep the 56 pt pill were 4 + 48 + 4 and 8 + 40 + 8, and
 *  only the first keeps a control row at or above the touch floor — 40 is under
 *  iOS's 44 and Android/web's 48, so 8 + 40 + 8 would put attach and send in a
 *  row shorter than their own targets. Raising the height to 8 + 44 + 8 = 60
 *  instead would grow the dock by 4 pt on every screen for a spacing rule.
 *
 *  So the resting ROW is 48 (`COMPOSER_REST_ROW`), the larger platform floor,
 *  on EVERY platform: on iOS the 44 pt discs sit centred in it, 2 pt from each
 *  row edge, so the disc-to-shell distance is the 4 + 2 = 6 pt the pill always
 *  painted, and only the declared padding moved onto the scale. On the 48 floor
 *  the row was already 48, and the pill drops from 6 + 48 + 6 = 60 to 56 — one
 *  pill height on every platform, the record's own number.
 *
 *  The expanded card is untouched: 12 + h + 4 + h + 8 were already on-scale. */
export const COMPOSER_REST_PAD = 4;
export const COMPOSER_REST_ROW = 48;
/** Where the record's heights come from, so a test can assert the arithmetic
 *  rather than a class name: rest 4 + max(floor, 48) + 4 = 56; expanded 12 + 44
 *  + 4 + 44 + 8 = 112. A change to either padding has to keep these sums true. */
export const composerShellPadding = (expanded: boolean) =>
	expanded
		? { top: 12, bottom: 8 }
		: { top: COMPOSER_REST_PAD, bottom: COMPOSER_REST_PAD };
/** The resting row's box on a platform floor: never under the floor, never
 *  under the 48 pt row the on-scale padding is balanced against. */
export const composerRestRow = (floor: number = COMPOSER_FIELD_BOX) =>
	Math.max(floor, COMPOSER_REST_ROW);
/** The field row's cross-axis alignment (review R1). AT REST it is CENTRED:
 *  the row is 48 on every platform but iOS children are 44, and `items-end`
 *  put them 8 pt from the shell's top and 4 pt from its bottom — the 6/6 the
 *  H5 note above promises only holds when the 4 pt slack splits evenly. OPEN,
 *  the row holds only the multi-line field, which must keep growing upward
 *  from its last line, so it stays bottom-aligned. A class rather than a
 *  boolean so the component reads the same decision the tests assert. */
export const composerFieldRowAlign = (expanded: boolean) =>
	expanded ? "items-end" : "items-center";
/** Where a resting control of height `floor` paints inside the shell, edge to
 *  edge, under `composerFieldRowAlign(false)`: the shell padding plus its half
 *  of the row's slack. iOS (44) gives 6/6, the 48 floor 4/4 — equal on both
 *  sides on every floor, which is what "centred" means for H5. */
export const composerRestInsets = (floor: number = COMPOSER_FIELD_BOX) => {
	const slack = composerRestRow(floor) - floor;
	return {
		top: COMPOSER_REST_PAD + slack / 2,
		bottom: COMPOSER_REST_PAD + slack / 2,
	};
};
/** The radius of the shell's GLASS layer (review R2 / design D5a). The layer
 *  sits inside the shell's `overflow: hidden`, whose radius is ANIMATED
 *  (`composerShellRadius`, 24 open → the pill's half-height at rest, and the
 *  pill's measured base can exceed the render-time estimate at large text). A
 *  layer radius LARGER than the live clip leaves unfilled corner wedges inside
 *  the ring; one at or under the clip's minimum is always trimmed by it. 24 is
 *  that minimum, so the shell's clip is the only shape — and a rounded layer,
 *  not 0, keeps the corner rounded if a native clip ever misses the glass rim. */
export const COMPOSER_GLASS_LAYER_RADIUS = 24;
export const composerPaintedHeight = (
	expanded: boolean,
	floor: number = COMPOSER_FIELD_BOX,
) => {
	const pad = composerShellPadding(expanded);
	return expanded
		? pad.top + floor + COMPOSER_CONTROLS_GAP + floor + pad.bottom
		: pad.top + composerRestRow(floor) + pad.bottom;
};
/** Build389 presentation only: never derives auth or modifies draft content. */
export type ComposerPresentationFacts = {
	focused: boolean;
	draft: string;
	attachments: number;
	dictation: boolean;
	stop: boolean;
	error: boolean;
	keyboard: boolean;
	inset: number;
	scale: number;
	/** The platform's touch floor; the field paints at it. Defaults to iOS's 44. */
	floor?: number;
	/** The dock RESTS as the two-row card rather than the one-row pill (visual
	 *  audit D1/D5): model and effort live on the card's controls row beside
	 *  attach, as on the relay, so that row must exist before the reader types —
	 *  a pill has nowhere to put them, which is what kept a separate 48 pt chip
	 *  band above the composer. Short landscape passes `false` and keeps its
	 *  pill; absent means `false`, so every earlier caller and pin is unchanged. */
	card?: boolean;
};
/** Clearance is outside the shell; one radius applies to all corners. Whitespace
 * is still a draft, so geometry must never normalize the reader's content.
 *
 * Deliberately NOT a worklet, and it must stay that way: it calls
 * `composerOuterGap`, `composerPaintedHeight` and `composerShellPadding`, none of
 * which are worklets. The UI runtime does not load modules — it serialises
 * closures — so marking this one would capture those three as remote functions
 * and reproduce the same synchronous-call crash one call deeper. It is only ever
 * called during render. */
export const composerPresentation = (facts: ComposerPresentationFacts) => {
	const expanded =
		facts.card === true ||
		facts.focused ||
		facts.draft.length > 0 ||
		facts.attachments > 0 ||
		facts.dictation ||
		facts.stop ||
		facts.error;
	const floor = facts.floor ?? COMPOSER_FIELD_BOX;
	/* The painted pill, on the SAME floor the component paints, plus the large-text
	 *  growth. Reporting 56/28 over a 60/30 paint was a second source of truth for
	 *  the shape (R7-4). */
	const idleHeight = Math.max(
		composerPaintedHeight(false, floor),
		Math.ceil(24 * facts.scale + 24),
	);
	return {
		expanded,
		height: expanded ? composerPaintedHeight(true, floor) : idleHeight,
		radius: expanded ? 24 : morphPillRadius(idleHeight),
		gap: composerOuterGap(facts.inset, facts.keyboard),
		side: 12,
	};
};
export const keyboardOverlap = (hostBottom: number, keyboardTop: number) =>
	Math.max(0, hostBottom - keyboardTop);

/**
 * What the expanded controls row's TRAILING slot holds — the spot under the
 * finger that pressed the collapsed pill's mic.
 *
 * - `actions` (Stop/Send) whenever the card is open for its own reasons: a
 *   draft, an attachment, focus or an error put Send there, and it is live.
 * - `mic` when the card is open ONLY for dictation and the take is not
 *   recording: the press that expanded the card must not slide a disabled Send
 *   under the same finger (UX round 1, U2). A start or permission failure keeps
 *   this too, because it rests on the dictation row, not the error line
 *   (`DictationOutcome`, D6/U6/Q4).
 * - `finish` while RECORDING on that card: the toolbar mic is hidden then (D2,
 *   one finish control), and a reader used to tap-to-toggle taps the same spot
 *   again, so ✓ moves from the dictation row to here rather than leaving a
 *   disabled Send in its place (UX round 2, U7). It MOVES, it is not copied —
 *   two "Finish and transcribe" controls is the D2 defect again.
 *
 * A value rather than a ternary in the JSX so a test can pin the decision.
 */
export type ControlsTrailing = "actions" | "mic" | "finish";
export const controlsTrailing = (input: {
	/** The card would be the collapsed pill without the dictation. */
	openForDictationOnly: boolean;
	recording: boolean;
	/** A mic (usable or set-up) renders at all. */
	micShown: boolean;
}): ControlsTrailing =>
	!input.openForDictationOnly || !input.micShown
		? "actions"
		: input.recording
			? "finish"
			: "mic";

/**
 * The pill's radius for a painted height: half of it, so every resting pill is a
 * stadium whatever platform floor it paints on. It is NOT capped — the 24 pt
 * expanded radius is a second shape the morph travels to, not a limit on this
 * one, and a cap here would have rounded a 60 pt pill to the expanded card's
 * corners while it was still standing.
 *
 * Kept as a FUNCTION of the painted base rather than a constant, because the
 * 28/24 pair is one rule — the resting pill is a stadium, the expanded card is a
 * 24 pt rectangle — and a radius derived from a number the box does not paint is
 * a shape nobody sees (a landscape pill kept 24 on a 56 pt card that way).
 *
 * `"worklet"`: `composerShellRadius` runs ON the UI runtime and calls this, and a
 * helper missing the directive is a synchronous call back into JS —
 * `[Worklets] Tried to synchronously call a Remote Function`, the launch crash in
 * nightly 42156335030. That constraint is also why this has to stay pure
 * arithmetic: no React state, no I/O, no module the UI runtime does not have.
 */
export const morphPillRadius = (base: number) => {
	"worklet";
	return base / 2;
};

/**
 * Which end of the morph a measurement seeds.
 *
 * The predicate is deliberately ONE fact — expanded or not — because the bug it
 * replaces was a second condition (`!compactSingle`) that skipped short landscape
 * entirely: the seeded 56 stayed put while the content grew past it and the
 * overflow rule clipped the field. Returns the branch as a value so a test can
 * assert the DECISION rather than grep for an expression.
 */
export const seedFor = (expanded: boolean, total: number) =>
	expanded
		? ({ kind: "expanded", total } as const)
		: ({ kind: "collapsed", total } as const);

/**
 * Where the card is between the collapsed pill and the expanded card.
 *
 * Linear on one progress value because the record asks for one morph, not two:
 * the same value drives the radius. Extracted so a test can assert the SHAPE of
 * the motion — an intermediate value strictly between the ends — instead of
 * grepping the component for the expression that produces it.
 *
 * `"worklet"`: `shellMotion` calls this from the UI runtime (see
 * `morphPillRadius` for the failure it prevents). `Math.min`/`Math.max` are
 * available there; a helper would have to be a worklet too.
 */
export const morphHeight = (progress: number, from: number, to: number) => {
	"worklet";
	return from + (to - from) * Math.min(1, Math.max(0, progress));
};

/**
 * The shell's corner radius on the morph, read by BOTH edges the composer paints:
 * the shell's own fill and the 1 px ring drawn over it (see `composer.tsx`).
 *
 * Shared rather than written twice because the two edges are concentric for every
 * frame of the travel: a ring carrying a copied expression drifts the moment one
 * of the two is edited, and it shows as a second corner peeking out of the first.
 * The radius is the shell's own — the ring is exactly the shell's box, so there is
 * nothing to inset it by.
 *
 * `"worklet"`: called from BOTH `shellMotion` and `ringMotion`, which run on the
 * UI runtime — an unmarked helper throws `[Worklets] Tried to synchronously call
 * a Remote Function` at mount (nightly 42156335030).
 */
export const composerShellRadius = (progress: number, base: number) => {
	"worklet";
	return morphHeight(progress, morphPillRadius(base), 24);
};
