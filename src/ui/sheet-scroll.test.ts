/**
 * The two anchors a focused field scrolls to, and the arithmetic between them
 * (see `sheet-scroll.ts`).
 */
import { describe, expect, it } from "vitest";

import {
	FOCUS_FOOTER_GAP,
	FOCUS_HEADER_GAP,
	focusScrollOffset,
	focusScrollTarget,
} from "@/ui/sheet-scroll";

const base = {
	offset: 0,
	viewportHeight: 300,
	blockTop: 0,
	blockHeight: 200,
	fieldTop: 150,
	fieldHeight: 44,
};

describe("focusScrollOffset", () => {
	it("puts a question that starts above the header 8 pt under it", () => {
		// Block top is 2 pt into the viewport, so the anchor pulls it down 6.
		expect(focusScrollOffset({ ...base, blockTop: 2 })).toBe(
			-(2 - FOCUS_HEADER_GAP),
		);
	});

	it("moves nothing when the question already sits under the header", () => {
		expect(focusScrollOffset({ ...base, blockTop: 40 })).toBe(0);
	});

	it("pins a too-tall question's field bottom 16 pt above the footer", () => {
		// The field's bottom is 294, ten past the 284 footer line, so the body
		// scrolls ten further down.
		expect(
			focusScrollOffset({
				...base,
				offset: 300,
				blockHeight: 400,
				blockTop: -120,
				fieldTop: 250,
				fieldHeight: 44,
			}),
		).toBe(300 + (300 - FOCUS_FOOTER_GAP - 44 - 250));
	});

	it("moves nothing when a too-tall question's field is already above the footer", () => {
		expect(
			focusScrollOffset({
				...base,
				blockHeight: 400,
				blockTop: -120,
				fieldTop: 120,
				fieldHeight: 44,
			}),
		).toBe(0);
	});

	it("adds the current offset back, because the measurements are viewport positions", () => {
		expect(focusScrollOffset({ ...base, offset: 500, blockTop: -40 })).toBe(
			500 + FOCUS_HEADER_GAP - -40,
		);
	});

	it("clamps a target above the top of the content at zero", () => {
		// Same too-tall question at the very top of the body: the ten points it
		// would scroll back do not exist.
		expect(
			focusScrollOffset({
				...base,
				offset: 0,
				blockHeight: 400,
				blockTop: -120,
				fieldTop: 250,
				fieldHeight: 44,
			}),
		).toBe(0);
	});

	it("falls back to the block anchor while the field has no height yet", () => {
		expect(
			focusScrollOffset({
				...base,
				blockHeight: 400,
				blockTop: -30,
				fieldHeight: 0,
			}),
		).toBe(FOCUS_HEADER_GAP - -30);
	});

	it("does nothing before the body has a viewport", () => {
		expect(focusScrollOffset({ ...base, viewportHeight: 0, offset: 120 })).toBe(
			120,
		);
	});
});

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
