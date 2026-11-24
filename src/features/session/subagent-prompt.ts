import { userMessageLineHeight } from "@/features/session/user-message-clamp";
import { TYPE_STEPS } from "@/ui/tokens.gen";

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
 * "prompt" label at `scale`, and the `Show less` control's touch floor (open,
 * the control adds its whole floor: `userMessageControlMarginTop` is 0).
 */
export function subagentPromptChrome(
	scale: number,
	touchFloor: number,
): number {
	const meta = TYPE_STEPS.meta;
	return (
		BLOCK_PADDING + meta.size * meta.lineHeight * scale + LABEL_GAP + touchFloor
	);
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
