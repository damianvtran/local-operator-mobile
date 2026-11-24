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

/* Design round 4, D1 and round 5, D4 (#335): a pinned region that appears over
 *  a scrolled body moves the body's top down by however much the BODY shrank
 *  (the surface is bottom-anchored), so the offset follows that measured change
 *  — not the region's height, which a sheet that grows instead of shrinking
 *  would over-correct. */
describe("pinnedRevealScroll", () => {
	it("moves the offset down by the body's measured shrink, so the rows stay where they were", () => {
		// The design frame: 390 pt at 100 %, revealed at 200 under an 83 pt region.
		expect(
			pinnedRevealScroll({
				y: 200,
				viewportBefore: 400,
				viewportAfter: 317,
				content: 1200,
			}),
		).toBe(283);
	});

	it("follows the body, not the region, when the sheet grows instead (320 pt, 200 %, ru)", () => {
		/* Design round 5, D4 (a): a 122 pt region, but the body stops at its
		 *  120 pt floor and the sheet grows 29 pt, so the body's top moves 93. */
		expect(
			pinnedRevealScroll({
				y: 180,
				viewportBefore: 213,
				viewportAfter: 120,
				content: 1200,
			}),
		).toBe(180 + 93);
	});

	it("reaches an offset past the old end: the shrink is the new scroll room (D4 b)", () => {
		/* 21 models in a 1,248 pt body: the reader is at the old maximum (182)
		 *  when a 61 pt region appears. Measured after the body shrank, the new
		 *  maximum is 243, and the rows keep their place. */
		expect(
			pinnedRevealScroll({
				y: 182,
				viewportBefore: 1248,
				viewportAfter: 1187,
				content: 1430,
			}),
		).toBe(243);
	});

	it("never asks for more than the body can scroll", () => {
		expect(
			pinnedRevealScroll({
				y: 182,
				viewportBefore: 1248,
				viewportAfter: 1187,
				content: 1400,
			}),
		).toBe(1400 - 1187);
	});

	it("leaves a body at its top alone: a region pinned when the sheet opens moves nothing", () => {
		expect(
			pinnedRevealScroll({
				y: 0,
				viewportBefore: 400,
				viewportAfter: 317,
				content: 1200,
			}),
		).toBeNull();
	});

	it("moves nothing when the body kept its height (the sheet grew by the whole region)", () => {
		expect(
			pinnedRevealScroll({
				y: 180,
				viewportBefore: 120,
				viewportAfter: 120,
				content: 1200,
			}),
		).toBeNull();
	});
});
