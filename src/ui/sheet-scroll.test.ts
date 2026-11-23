/**
 * The two anchors a focused field scrolls to, and the arithmetic between them
 * (see `sheet-scroll.ts`).
 */
import { describe, expect, it } from "vitest";

import {
	FOCUS_FOOTER_GAP,
	FOCUS_HEADER_GAP,
	focusScrollTarget,
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
