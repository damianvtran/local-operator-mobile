import {
	userMessageClipHeight,
	userMessageLineHeight,
} from "@/features/session/user-message-clamp";
import { lineBoxPt } from "@/ui/text-scale";

/**
 * How much of the subagent screen the child's prompt may take (PR #390 design
 * round 1, D1; QA Q1).
 *
 * WHY. The prompt is pinned above the transcript as fixed chrome — seeing the
 * child's brief at a glance is the point of the screen — and that screen does
 * not scroll as a whole (`Screen scroll={false}`; the list owns scrolling). With
 * the transcript's eight-line clamp, a collapsed prompt at 320×692 and 200 %
 * text was 425 px tall and left the transcript 25.8 px; opened, a long brief
 * pushed `Show less` and the whole transcript below the screen, and on native
 * nothing scrolled to reach them. Team briefs of several KB are normal.
 *
 * THE RULE. Collapsed, three lines instead of eight. Open, the prompt body
 * scrolls inside its own scroller whose height is the SMALLER of:
 *  - the design's bound, 45 % of the window for the body; and
 *  - what still leaves the transcript 40 % of the window, given the height the
 *    prompt and the transcript share (measured on the screen; it excludes the
 *    header, the status strip, any error line and the todos, which do not move).
 * `Show less` sits below that scroller, so it is always on screen. The second
 * bound is the one that binds on a short window or at large text, where the
 * header and strip alone take a third of the height.
 *
 * Pure so the geometry is testable in Node, which cannot lay out a screen.
 */

/** Lines the collapsed prompt shows. Three keep the brief's opening (usually
 *  its task line) readable while costing ~65 pt at 100 % text instead of ~174. */
export const SUBAGENT_PROMPT_LINES = 3;

/** The open prompt body's bound, as a share of the window (design, D1). */
export const SUBAGENT_PROMPT_MAX_SHARE = 0.45;

/** What the transcript keeps of the window while the prompt is open (D1's
 *  regression bar). */
export const SUBAGENT_TRANSCRIPT_MIN_SHARE = 0.4;

/** The prompt block's vertical padding (`py-2`) plus its hairline (`border-b`). */
const BLOCK_PADDING = 8 + 8 + 1;
/** The "prompt" label's bottom padding (`pb-1`). */
const LABEL_GAP = 4;

/**
 * The prompt block's height OTHER than the body, while open: padding, the
 * "prompt" label at `scale`, and the `Show less` row (open, the control adds
 * its whole row: `userMessageControlMarginTop` is 0).
 *
 * The row is `minHeight: TOUCH_FLOOR` around a `text-meta` label, so it is the
 * LARGER of the two: at the 3x scale ceiling (`TEXT_SCALE_BOUNDS.max`) meta's
 * line box is 12 x 1.4 x 3 = 50.4 pt, past iOS's 44, and counting only the
 * floor cost the transcript ~6 pt of its 40 % share (PR #390 review m1).
 */
export function subagentPromptChrome(
	scale: number,
	touchFloor: number,
): number {
	const label = lineBoxPt("meta", scale);
	return BLOCK_PADDING + label + LABEL_GAP + Math.max(touchFloor, label);
}

/**
 * The open prompt body's maximum height, in points.
 *
 * `regionHeight` is the height the prompt block and the transcript share; null
 * before the first layout, when only the window bound applies (the prompt opens
 * on a press, after layout, so that case does not reach a reader in practice).
 * Never below one line: a scroller with no visible line would hide the brief
 * entirely, so on a window too short for both bounds the transcript yields first.
 */
export function subagentPromptScrollMax(input: {
	windowHeight: number;
	regionHeight: number | null;
	scale: number;
	touchFloor: number;
}): number {
	const { windowHeight, regionHeight, scale, touchFloor } = input;
	const chrome = subagentPromptChrome(scale, touchFloor);
	const byWindow = windowHeight * SUBAGENT_PROMPT_MAX_SHARE;
	const byTranscript =
		regionHeight === null
			? byWindow
			: regionHeight - windowHeight * SUBAGENT_TRANSCRIPT_MIN_SHARE - chrome;
	return Math.floor(
		Math.max(userMessageLineHeight(scale), Math.min(byWindow, byTranscript)),
	);
}

/** What the prompt's clamp renders with: lines shown collapsed, and the open
 *  body's scroller height. */
export interface SubagentPromptLayout {
	collapsedLines: number;
	expandedMaxHeight: number;
}

/**
 * The collapsed clamp and the open bound, chosen together so `Show more` never
 * shows LESS of the brief than the collapsed state (PR #390 design D5).
 *
 * THE INVERSION. At 320x692 and 200 % text the 40 % transcript bound leaves
 * the open scroller ~75 pt, about 1.7 body lines, while the collapsed clamp
 * shows 3 lines (130 pt): the control promising more showed less, and the
 * block shrank when opened.
 *
 * THE CHOICE, in order — each keeps both promises (open >= collapsed, and the
 * transcript's 40 % while open) wherever the window allows them:
 *  1. The bound already fits the collapsed lines: nothing changes.
 *  2. Flooring the open scroller at the collapsed clip still leaves the
 *     transcript its 40 % (only the 45 % window bound was binding, or the
 *     region is not measured yet): floor it there — D5's suggested
 *     `max(scrollMax, collapsedClip)`.
 *  3. Otherwise the floor would take the transcript under 40 % (at the D5
 *     corner it would drop to ~33 %), which is D1's own regression bar. So the
 *     COLLAPSED clamp shrinks instead, to the whole lines the open bound can
 *     show (never under one), and the open scroller is floored at that. D5
 *     advised against a flat 2-line clamp at large text because 2 lines
 *     (87 pt) still exceed the 75 pt bound and the inversion remains; sizing
 *     the clamp FROM the bound is what closes it. The cost is confined to the
 *     corner where the transcript would otherwise lose its share — at
 *     430x932 and 100 % text the clamp stays at 3 lines and the bound at 378 pt.
 */
export function subagentPromptLayout(input: {
	windowHeight: number;
	regionHeight: number | null;
	scale: number;
	touchFloor: number;
}): SubagentPromptLayout {
	const { windowHeight, regionHeight, scale, touchFloor } = input;
	const scrollMax = subagentPromptScrollMax(input);
	const clip = userMessageClipHeight(scale, SUBAGENT_PROMPT_LINES);
	if (scrollMax >= clip)
		return {
			collapsedLines: SUBAGENT_PROMPT_LINES,
			expandedMaxHeight: scrollMax,
		};
	const transcriptBound =
		regionHeight === null
			? Number.POSITIVE_INFINITY
			: regionHeight -
				windowHeight * SUBAGENT_TRANSCRIPT_MIN_SHARE -
				subagentPromptChrome(scale, touchFloor);
	if (transcriptBound >= clip)
		return {
			collapsedLines: SUBAGENT_PROMPT_LINES,
			expandedMaxHeight: Math.ceil(clip),
		};
	const line = userMessageLineHeight(scale);
	const collapsedLines = Math.max(
		1,
		Math.min(SUBAGENT_PROMPT_LINES, Math.floor(scrollMax / line)),
	);
	return {
		collapsedLines,
		expandedMaxHeight: Math.max(
			scrollMax,
			Math.ceil(userMessageClipHeight(scale, collapsedLines)),
		),
	};
}
