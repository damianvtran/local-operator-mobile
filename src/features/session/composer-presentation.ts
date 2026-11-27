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
/** The shell's side padding, both states: the record's 12 pt. Exported so the
 *  Team Bridge composer (`features/team-bridge/thread-chrome.tsx`) insets its
 *  text by the same amount as this one rather than restating the number. */
export const COMPOSER_SIDE_PAD = 12;
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
/** The dock's side margin as the card (the dock's own, 12) and as the scroll-made
 *  pill: the pill is inset further so it reads as a lighter, smaller object than
 *  the card it shrank from. Both are painted off the SAME `progress` value as the
 *  height and radius, so the three travel together. Design value (spec
 *  2026-11-23, tunable 8–40), not measured. Short landscape, whose pill is its
 *  resting form, keeps the card's 12. */
export const COMPOSER_CARD_MARGIN = 12;
export const COMPOSER_PILL_MARGIN = 16;
/** The card<->pill morph, for the scroll-driven shape (spec 2026-11-23 §4.1:
 *  220 ms, cubic-bezier(0.2, 0, 0, 1)). A snap, not a continuous follow: the
 *  composer is a flex sibling of the list, so a height tied to scroll distance
 *  would resize the list on every scroll pixel. */
export const COMPOSER_MORPH_MS = 220;
export const COMPOSER_MORPH_EASING = "cubic-bezier(0.2, 0, 0, 1)";
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
	/** The reader is moving the transcript and the dock has yielded its room
	 *  (`composer-compaction.ts`). Honoured only while nothing pins the card
	 *  (`composerPinsCard`); absent means `false`, so Home and every earlier
	 *  caller are unchanged. A shrunk dock is the pill even with a draft, a live
	 *  turn (Stop) or `card: true`: those force the card only when the dock is
	 *  not shrunk. */
	shrunk?: boolean;
	/** The `$skill` tray is showing. A pin: the list under the field is the thing
	 *  the reader is choosing from. */
	skillTray?: boolean;
	/** The `/` slash sheet is open. A pin, for the same reason. */
	slashSheet?: boolean;
};
/** Facts that keep the dock a CARD whatever the reader's scrolling does: what
 *  the reader is editing or must be able to read. Scrolling never shrinks a
 *  dock holding any of them, and one appearing grows a shrunk dock back.
 *
 *  Deliberately NOT here, per the operator (2026-11-23): a typed draft of any
 *  length (the pill shows its first line; the text is never touched) and a
 *  running turn (the pill keeps the Stop disc). Focus and a visible keyboard ARE
 *  here: shrinking is only for the unfocused, keyboard-down dock. */
export const composerPinsCard = (
	facts: Pick<
		ComposerPresentationFacts,
		| "focused"
		| "keyboard"
		| "attachments"
		| "dictation"
		| "error"
		| "skillTray"
		| "slashSheet"
	>,
) =>
	facts.focused ||
	facts.keyboard ||
	facts.attachments > 0 ||
	facts.dictation ||
	facts.error ||
	facts.skillTray === true ||
	facts.slashSheet === true;
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
	const shrunk = facts.shrunk === true && !composerPinsCard(facts);
	const expanded =
		!shrunk &&
		(facts.card === true ||
			facts.focused ||
			facts.draft.length > 0 ||
			facts.attachments > 0 ||
			facts.dictation ||
			facts.stop ||
			facts.error);
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
		side: COMPOSER_SIDE_PAD,
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

/**
 * The dock's animated bottom margin: 8 plus whatever the keyboard lifts the dock
 * ABOVE the resting safe-area inset the carrier already pays as padding.
 *
 * RIGID RIDE (PR C). The painted bottom is `8 + max(keyboardOffset, restInset)`:
 * the keyboard overlap INCLUDES the home-indicator inset, so the dock rides the
 * keyboard's top edge 1:1 and never sinks below its rest (offset 0, inset 34 ->
 * 42; offset 336, inset 34 -> 344, the old `inset + 8` and `offset + 8`). The old
 * `offset + 8` with the carrier's padding dropped the moment the keyboard showed
 * parked the dock 8 pt above the screen edge, over the indicator, when a finger
 * dragged the keyboard to 0, then jumped 34 pt at `keyboardDidHide`.
 *
 * DEVIATION FROM THE ARCHITECT'S LITERAL FORM (`8 + max(offset, inset)` as one
 * margin, carrier padding 0): the inset stays CARRIER PADDING, always, and this
 * margin carries only the excess. The painted bottom is identical, but a margin
 * of `inset + 8` at rest is the off-scale step the web audit's U-42 refuses (the
 * dialog's split, `dialog.tsx`); at rest this margin is exactly 8.
 *
 * `"worklet"`: called from `dockMotionStyle`, on the UI runtime.
 */
export const dockLift = (keyboardOffset: number, restInset: number): number => {
	"worklet";
	return 8 + Math.max(0, keyboardOffset - Math.max(0, restInset));
};

/**
 * The dock's animated margins (review W2). Left and right, NOT `marginHorizontal`:
 * Reanimated's web driver writes an animated style straight onto the element, and
 * `marginHorizontal` is a React Native shorthand with no CSS property of its own,
 * so every frame after the first render was dropped and the pill stayed at the
 * card's 12 pt (measured: first painted pixel at x = 24 px at 2x). The two longhand
 * keys are real CSS and real RN, and the margin is symmetric so RTL needs nothing.
 * They are allowlisted in `src/i18n/__tests__/physical-edges.test.ts` by the same
 * reason: Reanimated's web path emits `marginStart` as a CSS `marginStart`, which
 * is not a property, so the logical spelling would be dropped on web.
 *
 * `"worklet"`: called from `useAnimatedStyle` (see `morphPillRadius`).
 */
export const dockMotionStyle = (
	progress: number,
	keyboardOffset: number,
	pillMargin: number,
	restInset = 0,
) => {
	"worklet";
	const side = morphHeight(progress, pillMargin, COMPOSER_CARD_MARGIN);
	return {
		marginBottom: dockLift(keyboardOffset, restInset),
		marginLeft: side,
		marginRight: side,
	};
};

/**
 * The scroll-made pill's ROW height: the 48 resting row, or the one text line at
 * the reader's scale plus the field's own 8 pt top and bottom padding, whichever
 * is taller (review W3). The shell's `4 + row + 4` is then exactly the
 * `ceil(24 * scale + 24)` `composerPresentation` reports, so what is announced is
 * what is painted. Without it the row stayed the 48 touch floor while the line
 * doubled at 200 % and the draft was cut at the pill's bottom edge.
 */
export const composerPillRow = (
	floor: number = COMPOSER_FIELD_BOX,
	scale = 1,
) => Math.max(composerRestRow(floor), Math.ceil(24 * scale + 16));

/**
 * Whether the pill shows its Send disc for this draft (review R6). A draft that is
 * only whitespace has nothing to send, so the pill hides the dead disc the card
 * keeps for layout stability. A DECISION about the control only: the draft itself
 * is still a draft, `composerPresentation` still treats whitespace as content, and
 * nothing here normalises what the reader typed.
 */
export const pillShowsSend = (draft: string) => draft.trim().length > 0;

/**
 * Whether the pill's field shows a trailing "…" (design D1, UX U1; spec §4.1 "first
 * line with an ellipsis"). The pill shows the draft's FIRST line only, so a draft
 * with more lines after a non-blank one needs a cue that there is more.
 *
 * NEWLINE ONLY, deliberately. A single paragraph that wraps past one line is also
 * "more", but nothing here can know it: the field is clipped to one line, the
 * native content-size report fires only on a layout change (see `Textarea`), and a
 * character count is a guess at a width that depends on the font, the text scale
 * and the screen — it would paint a cue under a short draft or miss a long one. A
 * wrong cue is worse than none, so the line break, which is exact, is the whole rule.
 * Trailing whitespace is not "more" (a draft ending in a newline shows all its
 * words), and a blank draft has no first line to be cut after (`pillShowsPlaceholder`).
 */
export const pillShowsEllipsis = (draft: string) =>
	draft.trim().length > 0 &&
	(draft.trimEnd().includes("\n") || draft.trimEnd().includes("\r"));

/**
 * Whether the pill shows the placeholder over a draft that is only whitespace
 * (design D5). A native input paints its placeholder only for an EMPTY value, and
 * the draft is never normalised, so a blank draft would otherwise read as an empty
 * field that is not the resting "Message" one. A DECISION about what is painted over
 * the field: `value` is untouched and a tap still restores the whitespace.
 */
export const pillShowsPlaceholder = (draft: string) =>
	draft.length > 0 && draft.trim().length === 0;

/** The room the "…" cue takes at the right end of the pill's field, in points, at
 *  text scale 1. The glyph's advance is about one em (16 pt); the field keeps this
 *  much clear so the cue never sits over the last glyph of the line. */
export const PILL_ELLIPSIS_CUE_PT = 16;

/**
 * Whether the dock is open ONLY because of dictation: with no take it would be the
 * collapsed pill (UX round 1, U2).
 *
 * `blankIsEmpty` reads a whitespace-only draft as no draft. The pill hides Send for
 * one (`pillShowsSend`), so a take that began there, with nothing else holding the
 * card open, must drop the dead Send too, or the mic slides one disc left under the
 * finger that pressed it (review R2-2). Stop, focus, an attachment or an error still
 * open the card for their own reasons, and the Stop disc must stay.
 */
export const openOnlyForDictation = (
	facts: ComposerPresentationFacts,
	{ blankIsEmpty = false }: { blankIsEmpty?: boolean } = {},
) => {
	const draft = blankIsEmpty && !pillShowsSend(facts.draft) ? "" : facts.draft;
	return (
		/* A take (or its outcome line) is what this asks about. Without the fact a
		 *  blank draft alone would read as "dictation-only" and a card left open by
		 *  nothing but whitespace would drop its Send after the take ended. */
		facts.dictation &&
		composerPresentation(facts).expanded &&
		/* `shrunk: false`: "open only because of dictation" asks what the dock would
		 *  be with no take, and a draft or Stop opens it for its own reasons — a
		 *  scroll-made pill must not make those read as dictation-only. */
		!composerPresentation({
			...facts,
			draft,
			dictation: false,
			shrunk: false,
		}).expanded
	);
};

/**
 * Whether the card that dictation opened drops its dead Send disc (review R2).
 *
 * The scroll-made pill has no Send beside an empty field, so its mic is the
 * right-most control. The card that dictation then pins renders `mic · Send`, which
 * moved the mic one disc LEFT of the finger that pressed it, over a disabled Send —
 * and a tap-again-to-finish reader silently did nothing. When the take STARTED FROM
 * THE PILL the card therefore drops Send, and the mic (or ✓) takes the right-most
 * slot, the spot the finger is already on. When it started on the card the mic was
 * already beside Send, so that layout is unchanged (`controlsTrailing`, U2/U7).
 */
export const dictationDropsSend = (input: {
	openForDictationOnly: boolean;
	startedFromPill: boolean;
}) => input.openForDictationOnly && input.startedFromPill;

/**
 * The card's trailing slot and whether its Send is dropped, decided TOGETHER
 * (review R4-1 / QA Q2). They used to read two different rules for a blank draft:
 * the slot the strict one (`actions`, which renders no mic while recording) and
 * the Send the blank-aware one (dropped), so a ' ' draft with a take begun on the
 * pill left an EMPTY slot and slid the ✓ off the finger. One function means they
 * cannot disagree: Send is dropped only when the slot holds the mic or ✓ in its
 * place.
 *
 * `restsAsCard` picks the rule. The card reads a whitespace-only draft as no draft
 * (the pill's Send is already dead there, `pillShowsSend`). Short landscape keeps
 * its one row and its Send, so ' ' stays a draft there and the slot stays
 * `actions` through a take (R3-2), and nothing is dropped.
 */
export const dictationSlots = (input: {
	facts: ComposerPresentationFacts;
	restsAsCard: boolean;
	startedFromPill: boolean;
	recording: boolean;
	micShown: boolean;
}): { trailing: ControlsTrailing; dropSend: boolean } => {
	const openForDictationOnly = openOnlyForDictation(input.facts, {
		blankIsEmpty: input.restsAsCard,
	});
	const trailing = controlsTrailing({
		openForDictationOnly,
		recording: input.recording,
		micShown: input.micShown,
	});
	return {
		trailing,
		dropSend:
			input.restsAsCard &&
			trailing !== "actions" &&
			dictationDropsSend({
				openForDictationOnly,
				startedFromPill: input.startedFromPill,
			}),
	};
};

/**
 * The `selection` the composer forces on its field, or `null` for none (review R3).
 *
 * A native text view keeps its scroll offset, so a draft typed over several lines
 * leaves the pill showing its LAST lines, not the first. While the dock is the pill
 * the caret is therefore held at the start (`{0, 0}`), which brings the first line
 * into view without touching `value`. When the reader taps the pill, `restoreCaretAt`
 * puts the caret at the end of the draft for the one render that focuses it, which
 * is where a reader returning to a draft expects it. `null` leaves the field the
 * skills tray's, exactly as before (its one-shot selection, or uncontrolled).
 */
export const fieldSelectionOverride = (input: {
	shrunkPill: boolean;
	restoreCaretAt: number | null;
}): { start: number; end: number } | null => {
	if (input.shrunkPill) return { start: 0, end: 0 };
	if (input.restoreCaretAt !== null)
		return { start: input.restoreCaretAt, end: input.restoreCaretAt };
	return null;
};
