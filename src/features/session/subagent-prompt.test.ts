import { describe, expect, it } from "vitest";
import {
	SUBAGENT_PROMPT_LINES,
	SUBAGENT_PROMPT_MAX_SHARE,
	SUBAGENT_TRANSCRIPT_MIN_SHARE,
	subagentPromptChrome,
	subagentPromptLayout,
	subagentPromptScrollMax,
} from "@/features/session/subagent-prompt";
import {
	userMessageClipHeight,
	userMessageLineHeight,
} from "@/features/session/user-message-clamp";

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

/** PR #390 review m1: the `Show less` row is `minHeight: TOUCH_FLOOR` around a
 *  `text-meta` label, so past the floor the label's line box sets its height.
 *  Modelled independently of `subagentPromptChrome` (12 x 1.4 is meta's step),
 *  so the test cannot inherit the function's own arithmetic. */
describe("the open prompt's chrome at large text (m1)", () => {
	const metaBox = (scale: number) => 12 * 1.4 * scale;
	const independentChrome = (scale: number) =>
		8 + 8 + 1 + metaBox(scale) + 4 + Math.max(FLOOR, metaBox(scale));

	it.each([1, 2, 2.5, 3])(
		"counts the taller of floor and label at %s x",
		(scale) => {
			expect(subagentPromptChrome(scale, FLOOR)).toBeCloseTo(
				independentChrome(scale),
				6,
			);
		},
	);

	it("keeps the transcript its 40 % at the 3x scale ceiling", () => {
		const windowHeight = 932;
		const regionHeight = windowHeight - 241.2;
		const body = subagentPromptScrollMax({
			windowHeight,
			regionHeight,
			scale: 3,
			touchFloor: FLOOR,
		});
		const transcript = regionHeight - independentChrome(3) - body;
		expect(transcript).toBeGreaterThanOrEqual(
			windowHeight * SUBAGENT_TRANSCRIPT_MIN_SHARE - 1,
		);
	});
});

/** PR #390 design D5: at 320x692 and 200 % text `Show more` opened a 72 pt
 *  scroller (~1.7 lines) under a 3-line collapsed clamp — the control that
 *  promises more showed less. The layout must keep open >= collapsed AND the
 *  transcript's 40 % while open. */
describe("the prompt's collapsed and open heights together (D5)", () => {
	const columnFor = (windowHeight: number, above: number, scale: number) => {
		const regionHeight = windowHeight - above;
		const input = { windowHeight, regionHeight, scale, touchFloor: FLOOR };
		const layout = subagentPromptLayout(input);
		return {
			layout,
			collapsedPt: userMessageClipHeight(scale, layout.collapsedLines),
			openTranscript:
				regionHeight -
				subagentPromptChrome(scale, FLOOR) -
				layout.expandedMaxHeight,
			boundTranscript:
				regionHeight -
				subagentPromptChrome(scale, FLOOR) -
				subagentPromptScrollMax(input),
		};
	};

	it("never opens shorter than it collapses at the 320x692, 200 % corner", () => {
		const { layout, collapsedPt, openTranscript } = columnFor(692, 241.2, 2);
		expect(layout.expandedMaxHeight).toBeGreaterThanOrEqual(collapsedPt);
		expect(openTranscript).toBeGreaterThanOrEqual(
			692 * SUBAGENT_TRANSCRIPT_MIN_SHARE - 1,
		);
		// Flooring at three lines would have cost the transcript its share here,
		// so the collapsed clamp shrinks to what the open bound shows instead.
		expect(layout.collapsedLines).toBe(1);
	});

	it("leaves a roomy window at three lines and the plain bound", () => {
		const input = {
			windowHeight: 932,
			regionHeight: 932 - 140,
			scale: 1,
			touchFloor: FLOOR,
		};
		expect(subagentPromptLayout(input)).toEqual({
			collapsedLines: SUBAGENT_PROMPT_LINES,
			expandedMaxHeight: subagentPromptScrollMax(input),
		});
	});

	it("floors the open scroller at the collapsed clip when only the window bound binds", () => {
		// No region measured yet and a window whose 45 % is under three lines at
		// 2x: the 40 % transcript bound is not in play, so the floor is free.
		const layout = subagentPromptLayout({
			windowHeight: 250,
			regionHeight: null,
			scale: 2,
			touchFloor: FLOOR,
		});
		expect(layout.collapsedLines).toBe(SUBAGENT_PROMPT_LINES);
		expect(layout.expandedMaxHeight).toBe(
			Math.ceil(userMessageClipHeight(2, SUBAGENT_PROMPT_LINES)),
		);
	});

	it("keeps both promises across phone sizes and text scales", () => {
		for (const windowHeight of [568, 667, 692, 844, 932])
			for (const above of [120, 241.2])
				for (const scale of [1, 1.5, 2, 2.5, 3]) {
					const column = columnFor(windowHeight, above, scale);
					const where = `${windowHeight}/${above}/${scale}x`;
					expect(column.layout.expandedMaxHeight, where).toBeGreaterThanOrEqual(
						column.collapsedPt,
					);
					expect(column.layout.collapsedLines, where).toBeGreaterThanOrEqual(1);
					expect(column.layout.collapsedLines, where).toBeLessThanOrEqual(
						SUBAGENT_PROMPT_LINES,
					);
					// The transcript keeps its 40 % wherever the plain bound kept it;
					// where the window is too short for that, it loses at most the
					// rounding up to one whole line of brief.
					expect(column.openTranscript, where).toBeGreaterThanOrEqual(
						Math.min(
							windowHeight * SUBAGENT_TRANSCRIPT_MIN_SHARE,
							column.boundTranscript,
						) - 1,
					);
				}
	});
});
