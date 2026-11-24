/**
 * The two anchors a focused field scrolls to, and the arithmetic between them
 * (see `sheet-scroll.ts`).
 */
import { describe, expect, it } from "vitest";

import {
	FOCUS_FOOTER_GAP,
	FOCUS_HEADER_GAP,
	focusScrollTarget,
	pinnedRevealScroll,
} from "@/ui/sheet-scroll";

/** The production path: `measureLayout` yields CONTENT coordinates (the numbers
 *  in the evidence run's log), so the target is an absolute offset. */
describe("focusScrollTarget", () => {
	const content = {
		viewportHeight: 336,
		blockTop: 159,
		blockHeight: 411,
		fieldTop: 478,
		fieldHeight: 44,
	};

	it("scrolls a field below the fold up to 16 pt above the footer line", () => {
		// 478 + 44 = 522; the footer line is at 320, so 32 pt past it.
		expect(focusScrollTarget(content)).toBe(522 - (336 - FOCUS_FOOTER_GAP));
	});

	it("moves nothing when the field is already above the footer", () => {
		expect(
			focusScrollTarget({ ...content, fieldTop: 100, blockHeight: 400 }),
		).toBe(0);
	});

	it("anchors a question that fits 8 pt under the header", () => {
		expect(
			focusScrollTarget({ ...content, blockHeight: 200, blockTop: 159 }),
		).toBe(159 - FOCUS_HEADER_GAP);
	});

	it("never asks for a negative offset", () => {
		expect(
			focusScrollTarget({ ...content, blockTop: 2, blockHeight: 200 }),
		).toBe(0);
	});
});

/* Design round 4, D1 (#335): a pinned region that appears over a scrolled body
 *  takes its height from the top of the body, so at the same offset the rows
 *  under the reader's finger move down by that height. */
describe("pinnedRevealScroll", () => {
	it("moves the offset down by the pinned height, so the rows stay where they were", () => {
		// The design frame: 390 pt at 100 %, revealed at 200 under an 83 pt region.
		expect(pinnedRevealScroll({ y: 200, pinnedHeight: 83 })).toBe(283);
	});

	it("leaves a body at its top alone: a region pinned when the sheet opens moves nothing", () => {
		expect(pinnedRevealScroll({ y: 0, pinnedHeight: 83 })).toBeNull();
	});

	it("does nothing before the region has a height", () => {
		expect(pinnedRevealScroll({ y: 200, pinnedHeight: 0 })).toBeNull();
	});
});
