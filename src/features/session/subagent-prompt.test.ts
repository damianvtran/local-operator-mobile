import { describe, expect, it } from "vitest";
import {
	SUBAGENT_PROMPT_MAX_SHARE,
	SUBAGENT_TRANSCRIPT_MIN_SHARE,
	subagentPromptChrome,
	subagentPromptScrollMax,
} from "@/features/session/subagent-prompt";
import { userMessageLineHeight } from "@/features/session/user-message-clamp";

/**
 * The open subagent prompt's bound, as geometry (PR #390 design round 1, D1;
 * QA Q1). The screen is a fixed column: header, status strip, then a REGION the
 * pinned prompt and the transcript share, then the todos. Opening a very long
 * brief drew the transcript 0 px and pushed `Show less` below a screen that does
 * not scroll. Node cannot lay the screen out (`subagent-screen.test.tsx` gives
 * why), so the column is modelled from the same numbers the screen uses: the
 * prompt block is its chrome (`subagentPromptChrome`) plus a body no taller than
 * `subagentPromptScrollMax`, `Show less` is the last thing in that block, and
 * the transcript is whatever the region has left.
 */

/** 44 pt: the iOS touch floor `TOUCH_FLOOR` resolves to (`touchFloorFor`). */
const FLOOR = 44;

/** The column for an OPEN prompt whose body is longer than any bound (a
 *  25-step brief): where `Show less` ends and what the transcript keeps. */
const openColumn = (windowHeight: number, above: number, scale: number) => {
	const regionHeight = windowHeight - above;
	const body = subagentPromptScrollMax({
		windowHeight,
		regionHeight,
		scale,
		touchFloor: FLOOR,
	});
	const block = subagentPromptChrome(scale, FLOOR) + body;
	return {
		body,
		/** The control's bottom edge, in window points: the block's bottom less
		 *  its bottom padding and hairline (8 + 1). */
		showLessBottom: above + block - 9,
		transcript: regionHeight - block,
	};
};

describe("the open subagent prompt's bound", () => {
	it.each([
		// QA's frames: 430x932 at 100 % text, and 320x692 at 200 % text, where
		// the header, strip and safe area measured 241 px (692 - 425 - 25.8).
		{ windowHeight: 932, above: 140, scale: 1 },
		{ windowHeight: 692, above: 120, scale: 1 },
		{ windowHeight: 692, above: 241.2, scale: 2 },
		{ windowHeight: 932, above: 241.2, scale: 2 },
	])(
		"keeps Show less on screen and the transcript >= 40 % at $windowHeight pt, $scale x text",
		({ windowHeight, above, scale }) => {
			const column = openColumn(windowHeight, above, scale);
			expect(column.showLessBottom).toBeLessThanOrEqual(windowHeight);
			expect(column.transcript).toBeGreaterThanOrEqual(
				windowHeight * SUBAGENT_TRANSCRIPT_MIN_SHARE - 1,
			);
			// Still a scroller with a line of the brief in it, never a sliver.
			expect(column.body).toBeGreaterThanOrEqual(
				Math.floor(userMessageLineHeight(scale)),
			);
		},
	);

	it("never exceeds the design's 45 % window bound on a tall region", () => {
		for (const windowHeight of [692, 844, 932, 1366]) {
			const body = subagentPromptScrollMax({
				windowHeight,
				regionHeight: windowHeight,
				scale: 1,
				touchFloor: FLOOR,
			});
			expect(body).toBeLessThanOrEqual(
				windowHeight * SUBAGENT_PROMPT_MAX_SHARE,
			);
		}
	});

	it("falls back to the window bound before the region is measured", () => {
		expect(
			subagentPromptScrollMax({
				windowHeight: 932,
				regionHeight: null,
				scale: 1,
				touchFloor: FLOOR,
			}),
		).toBe(Math.floor(932 * SUBAGENT_PROMPT_MAX_SHARE));
	});

	it("keeps at least one line of the brief on a window too short for both bounds", () => {
		const scale = 2;
		expect(
			subagentPromptScrollMax({
				windowHeight: 320,
				regionHeight: 150,
				scale,
				touchFloor: FLOOR,
			}),
		).toBe(Math.floor(userMessageLineHeight(scale)));
	});
});
