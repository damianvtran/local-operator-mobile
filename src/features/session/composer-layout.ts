/**
 * The composer's three lines, as shared constants and one pure fit rule.
 *
 * WHY (operator feedback on TestFlight 365, decision record 2026-11-04 §2.2).
 * The shipped composer put the mic inside a wrapping "receipt" row between
 * attach and send, so on a real phone the model chip filled the line and the
 * 44 pt mic wrapped onto its own line (D-S4); the stop control was a bare
 * glyph ~30 pt from send (D-S5); and attach was a 14 pt "＋" (D-H5). The relay
 * already solved the same problem with three FIXED lines — field, controls,
 * meta — and these constants are that structure for native:
 *
 *  1. the field, its own full-width row (1–6 lines);
 *  2. one 44 pt controls row: attach and mic lead, stop and send are a 2 pt
 *     cluster pinned to the trailing edge. The mic is never on the meta line;
 *  3. one 44 pt meta line that never wraps: queued · folder · model · effort ·
 *     context % · cost, yielding from the end as width shrinks (`footerFit`). The
 *     MODEL keeps a reserved 44 pt slot and every other fact leaves the line
 *     before it does — see `footerFit`'s ladder for why the review round found
 *     the old order insufficient.
 *
 * With the keyboard up the meta folds INLINE into the controls row with a zero
 * flex-basis, so it only takes what attach/mic/stop/send leave and the model
 * truncates instead of the controls wrapping (relay QA round 3, O1).
 *
 * Plain module, no `react-native` import: the classes and the fit are pinned in
 * Node (`composer-layout.test.ts`), the same split the relay uses between
 * `composer.tsx` and `composer.spacing.test.tsx`.
 */
import { TYPE_STEPS } from "@/ui/tokens.gen";

/** Row 2. `gap-x-0.5`: 2 pt between every control, so no two 44 pt targets
 *  sit flush (relay operator finding A). */
export const COMPOSER_CONTROLS_ROW = "min-h-11 flex-row items-center gap-x-0.5";

/** The stop/send pair: 2 pt apart, held at the inline end. */
export const COMPOSER_ACTION_CLUSTER =
	"ms-auto shrink-0 flex-row items-center gap-0.5";

/** The attach control opens the row, so its GLYPH is the row's first ink. A
 *  44 pt box around a 20 pt paperclip has 12 pt of centring; `-ms-1.5` (6 pt)
 *  moves the box so the glyph lands near the field's text column, while the
 *  box still starts inside the shell's padding. */
export const COMPOSER_LEADING = "-ms-1.5";

/** Every round control in the row: a 44 pt disc. */
export const COMPOSER_DISC =
	"h-11 w-11 items-center justify-center rounded-full";

/** Row 3, resting: one 44 pt band, never wrapping, clipped rather than grown. */
export const COMPOSER_META_ROW =
	"min-h-11 min-w-0 flex-row items-center gap-1 overflow-hidden";

/** Row 3 folded into row 2 with the keyboard up: zero basis, so the meta gets
 *  only the leftover width and the controls never wrap (relay O1). */
export const COMPOSER_META_INLINE =
	"min-h-11 min-w-0 flex-1 basis-0 flex-row items-center gap-1 overflow-hidden";

/** A meta fact (queued, context %, cost): the relay's meta step, unwrapped. */
export const COMPOSER_META_TEXT = "shrink-0 text-meta text-ink-dim";

/** The paperclip glyph's size, pt (relay: 18–20). */
export const ATTACH_GLYPH_PT = 20;

/* ---- the meta line's fit --------------------------------------------- */

/** The chips' horizontal paint around their label: quiet chip `px-2` each side. */
const CHIP_PAD_PT = 16;
/** `gap-1`. */
const META_GAP_PT = 4;
/** The model chip's floor: it never disappears, it pins to a 44 pt target.
 *  Exported because the row itself has to reserve it — a child's min-width does
 *  not reserve its ancestor's flex allocation (review round 1, R163-1). */
export const MODEL_FLOOR_PT = 44;
/** The folder chip collapsed to its glyph only. */
const FOLDER_GLYPH_PT = 44;
/** A conservative advance for the 12 pt meta/mono steps, in em. Over-estimating
 *  only yields an item one step early; under-estimating would clip one. */
const ADVANCE_EM = 0.62;

const widthOf = (text: string, scale: number): number =>
	[...text].length * TYPE_STEPS.meta.size * scale * ADVANCE_EM;

const chipWidth = (text: string, scale: number): number =>
	Math.max(MODEL_FLOOR_PT, widthOf(text, scale) + CHIP_PAD_PT);

/** Keep the separate meta row when inline controls cannot share their targets.
 * The width is the controls row's leftover budget, independent of meta onLayout,
 * so falling back cannot oscillate as the row moves (R163-3). */
export const inlineMetaFits = (
	width: number,
	scale: number,
	effort: string | null,
): boolean =>
	width >=
	MODEL_FLOOR_PT + (effort ? META_GAP_PT + chipWidth(effort, scale) : 0);

export type FooterFacts = {
	/** The meta line's own width, pt (measured by `onLayout`). */
	width: number;
	scale: number;
	queued?: string | null;
	folder?: string | null;
	model: string;
	effort?: string | null;
	context?: string | null;
	cost?: string | null;
};

export type FooterFit = {
	showCost: boolean;
	showContext: boolean;
	/** The folder chip is on the line at all. */
	showFolder: boolean;
	/** The folder paints its glyph only, its full path staying in its name. */
	folderGlyphOnly: boolean;
	showEffort: boolean;
	showQueued: boolean;
};

/**
 * What a fit needs, in pt — the model at its floor plus whatever the fit kept.
 *
 * Exported so the regression can assert the arithmetic the component relies on
 * (that a chosen fit FITS) instead of restating the estimate in a test, where
 * the two copies would drift apart and only one of them would be wrong.
 */
export const metaNeed = (facts: FooterFacts, fit: FooterFit): number => {
	/* The label is elastic: charge its target, not its natural label width.
	 * Otherwise a long provider-qualified name evicts effort even when both
	 * targets fit (R163-3); truncation belongs to the model's flex wrapper. */
	const parts: number[] = [MODEL_FLOOR_PT];
	if (fit.showEffort && facts.effort)
		parts.push(chipWidth(facts.effort, facts.scale));
	if (fit.showQueued && facts.queued)
		parts.push(widthOf(facts.queued, facts.scale));
	if (fit.showFolder && facts.folder)
		parts.push(
			fit.folderGlyphOnly
				? FOLDER_GLYPH_PT
				: chipWidth(facts.folder, facts.scale),
		);
	if (fit.showContext && facts.context)
		parts.push(widthOf(facts.context, facts.scale));
	if (fit.showCost && facts.cost) parts.push(widthOf(facts.cost, facts.scale));
	return (
		parts.reduce((sum, w) => sum + w, 0) + META_GAP_PT * (parts.length - 1)
	);
};

/**
 * Which meta facts the line can hold, in the record's yield order:
 * cost → context % → folder to glyph-only → queued → folder itself → effort.
 *
 * The MODEL never yields: it is the one fact that keeps a reserved 44 pt slot,
 * and every other fact leaves the line before it does. Review round 1 (R163-1)
 * is why effort and queued are in this list at all — with the keyboard up the
 * meta folds inline into the controls row, and with only cost/context/folder
 * yielding, the two non-shrinking facts beside the model could leave the model
 * wrapper zero width, so the chip it promises to keep was clipped away by the
 * row's `overflow-hidden`. A yield route has to exist for every other fact, or
 * the floor is a claim about arithmetic nothing enforces.
 *
 * Unmeasured (`width <= 0`) shows everything: the first frame is the widest
 * reading, and measurement may only remove items, never add them back mid-frame.
 */
export const footerFit = (facts: FooterFacts): FooterFit => {
	const all: FooterFit = {
		showCost: Boolean(facts.cost),
		showContext: Boolean(facts.context),
		showFolder: Boolean(facts.folder),
		folderGlyphOnly: false,
		showEffort: Boolean(facts.effort),
		showQueued: Boolean(facts.queued),
	};
	if (facts.width <= 0) return all;
	/* The narrowest step, named rather than indexed: it is also the fallback the
	 * rule returns when nothing fits, and `noUncheckedIndexedAccess` is right that
	 * `steps[steps.length - 1]` could be undefined. */
	const modelOnly: FooterFit = {
		...all,
		showCost: false,
		showContext: false,
		folderGlyphOnly: true,
		showEffort: false,
		showQueued: false,
		showFolder: false,
	};
	const quiet: FooterFit = {
		...all,
		showCost: false,
		showContext: false,
		folderGlyphOnly: true,
	};
	// Pending facts and optional navigation yield before the session's sole
	// effort route. Its label must not disappear merely to save queue text.
	const steps: FooterFit[] = [
		all,
		{ ...all, showCost: false },
		{ ...all, showCost: false, showContext: false },
		quiet,
		{ ...quiet, showQueued: false },
		{ ...quiet, showQueued: false, showFolder: false },
		modelOnly,
	];
	return steps.find((fit) => metaNeed(facts, fit) <= facts.width) ?? modelOnly;
};
