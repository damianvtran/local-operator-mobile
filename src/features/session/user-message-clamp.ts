import { TYPE_STEPS } from "@/ui/tokens.gen";

/**
 * The clamp on the reader's own message: a long prompt shows its first
 * `USER_MESSAGE_CLAMP_LINES` lines under a fade, with a `Show more` / `Show
 * less` control that releases and restores it.
 *
 * WHY. The operator reported (iOS build 836) that his own messages were cut
 * to one line with no way to open them: a condensed past turn reduced its
 * prompt to a `numberOfLines={1}` landmark, so what he had ASKED was
 * unreadable while the answer under it stayed in full. The desktop app
 * (`local-operator-ui`, `canonical-transcript.tsx`, the user turn's `bodyRef`
 * block) never hides the prompt for good: it clamps a long one to eight lines
 * of `text-body` and offers `Show more`. This module is that rule, one copy
 * for every user row — condensed past turns and the live turn alike.
 *
 * MEASURED, NOT GUESSED. As on the desktop, the block is clipped first and
 * then asked whether it is hiding anything (`scrollHeight > clientHeight + 1`
 * there; the content's laid-out height against the clip here), so a control
 * can never appear on a message that already shows in full. A character count
 * would be wrong at every width and text size.
 *
 * Pure so the decision is testable in the Node environment, which cannot
 * render `uniwind` components (the reason `tool-row.test.ts` gives).
 */

/** The desktop's number: eight lines (`max-h-[174px]` = 8 x 21.7 px, D2). */
export const USER_MESSAGE_CLAMP_LINES = 8;

/** How many lines of the clipped block the fade covers. The desktop clips
 *  hard; the operator asked for its show-more "with fade", and a fade over the
 *  last line and a half is what says "this continues" without a rule. */
export const USER_MESSAGE_FADE_LINES = 1.5;

/** One line of the bubble's `text-body-read` step, in points, at `scale`. The
 *  step is the token's, so a type change moves the clip with it. */
export function userMessageLineHeight(scale: number): number {
	const step = TYPE_STEPS["body-read"];
	return step.size * step.lineHeight * scale;
}

/** The clipped block's height: exactly `USER_MESSAGE_CLAMP_LINES` lines, so
 *  the clip lands on a line boundary rather than through a glyph. */
export function userMessageClipHeight(scale: number): number {
	return USER_MESSAGE_CLAMP_LINES * userMessageLineHeight(scale);
}

/**
 * Whether a message whose content lays out `contentHeight` points tall needs
 * the clamp at `scale`. The 1 pt tolerance is the desktop's `+ 1`: a block
 * that fits exactly must not grow a control that reveals nothing, and line
 * heights are fractional (21.7 pt) so layout rounding can add a hair.
 */
export function needsUserMessageClamp(
	contentHeight: number,
	scale: number,
): boolean {
	return contentHeight > userMessageClipHeight(scale) + 1;
}

/** The control's state after a press: a plain flip, named so the row and its
 *  test agree on what a press does. */
export function nextUserMessageExpanded(expanded: boolean): boolean {
	return !expanded;
}
