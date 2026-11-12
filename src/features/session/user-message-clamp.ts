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

/**
 * How much the COLLAPSED control adds below the clipped text, in points
 * (design follow-up to PR #235, D1). The control keeps its full touch floor —
 * a thumb target is not negotiable — but a 48 pt band under every long prompt
 * read as a second empty line, more chrome than the clamp saved. So the
 * collapsed control is pulled up over the fade by the difference: its top part
 * overlaps the fade (which is decorative and already says "this continues"),
 * and only this much shows as new height. 32 pt still clears the meta line
 * with air above and below it.
 */
export const USER_MESSAGE_MORE_GROWTH = 32;

/**
 * The control's top margin: negative while collapsed, so the touch floor
 * overlaps the fade and only `USER_MESSAGE_MORE_GROWTH` is added; zero while
 * expanded, because there is no fade to overlap and pulling `Show less` up
 * would sit it on the message's last line of text. Never positive — on a
 * floor already at or under the visible growth there is nothing to pull up.
 */
export function userMessageControlMarginTop(
	expanded: boolean,
	touchFloor: number,
): number {
	if (expanded) return 0;
	return -Math.max(0, touchFloor - USER_MESSAGE_MORE_GROWTH);
}

/** Where the bubble's top lands after `Show less` brought it back into view:
 *  this far below the list's top edge (design follow-up to PR #235, D2). Inside
 *  the asked-for 8-12 pt band, clear of the top edge fade's hard edge, and
 *  close enough that the reader sees the message they just closed first. */
export const USER_MESSAGE_COLLAPSE_INSET = 10;

/**
 * The scroll offset that keeps a collapsing message's top in view, or `null`
 * to leave the list where it is (D2).
 *
 * WHY. A reader who opened a long prompt and scrolled down through it presses
 * `Show less` at its foot. The bubble shrinks by everything below the clamp,
 * and the content under it slides up past the reader, who is left looking at
 * the NEXT turn with the message they just closed somewhere above the screen.
 * The fix is the desktop's own: bring the message's top back.
 *
 * ONLY WHEN ITS TOP IS ABOVE THE VIEWPORT. A bubble whose top is already on
 * screen is left alone: moving a list the reader can already read is motion
 * for nothing, and a `Show less` pressed with the whole message in view must
 * not jump. The bubble's top does not move when the bubble itself shrinks
 * (everything above it is unchanged), so measuring before or after the
 * collapse gives the same answer.
 *
 * All three inputs are window/scroll points: `bubbleTop` and `viewportTop` from
 * `measureInWindow`, `offsetY` the list's current content offset. Never
 * negative — a message at the head of the content scrolls to the top.
 */
export function collapseScrollOffset(input: {
	bubbleTop: number;
	viewportTop: number;
	offsetY: number;
}): number | null {
	const { bubbleTop, viewportTop, offsetY } = input;
	if (bubbleTop >= viewportTop) return null;
	return Math.max(
		0,
		Math.round(
			offsetY - (viewportTop - bubbleTop) - USER_MESSAGE_COLLAPSE_INSET,
		),
	);
}
