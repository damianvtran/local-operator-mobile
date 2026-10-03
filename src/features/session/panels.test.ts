import { describe, expect, it } from "vitest";

import { ROSTER_ROW_PT, rosterBody } from "@/features/session/panels";

/**
 * The roster body's bound, pinned at the case it exists for: a six-row roster on a
 * 568 pt phone, where the fixed 256 pt body pushed the send button 16 pt below the
 * fold and cut the sixth row into a lone glyph.
 *
 * The assertions are on the RENDERED consequence — a body height that is a whole
 * number of rows, smaller than the constant it replaces on a short screen — rather
 * than on the arithmetic that produces it.
 */

describe("the roster body's bound", () => {
	it("leaves the composer room on a short phone", () => {
		// The D11 measurement: 320×568, six rows, panel open. The old body was a fixed
		// 256 pt; the send button has to stay on screen, so the body must shrink.
		const body = rosterBody({ viewportHeight: 568, rowCount: 6 });
		expect(body.maxHeight).toBeLessThan(256);
		expect(body.maxHeight).toBe(4 * ROSTER_ROW_PT);
	});

	it("hands the same roster more room on a tall screen, up to the old cap", () => {
		const phone = rosterBody({ viewportHeight: 568, rowCount: 6 });
		const tablet = rosterBody({ viewportHeight: 1024, rowCount: 6 });
		expect(tablet.visibleRows).toBeGreaterThan(phone.visibleRows);
		// Still bounded: the cap is what keeps a long roster from being scanned like a
		// page rather than a panel.
		expect(tablet.visibleRows).toBeLessThanOrEqual(6);
		expect(
			rosterBody({ viewportHeight: 2000, rowCount: 40 }).maxHeight,
		).toBeLessThanOrEqual(256);
	});

	it("never shows a partial row", () => {
		// D12: any cap that is not a multiple of the row height clips a row — the sixth
		// row rendered as a lone `–` with no label.
		for (const viewportHeight of [480, 568, 640, 667, 844, 1024, 1366]) {
			const body = rosterBody({ viewportHeight, rowCount: 6 });
			expect(body.maxHeight % ROSTER_ROW_PT, `${viewportHeight}pt`).toBe(0);
		}
	});

	it("says how many rows the cap hides", () => {
		const body = rosterBody({ viewportHeight: 568, rowCount: 6 });
		expect(body.hiddenRows).toBe(2);
		// A roster that fits hides nothing, so the cue never renders.
		expect(rosterBody({ viewportHeight: 568, rowCount: 3 }).hiddenRows).toBe(0);
	});

	it("follows the row height it is GIVEN, not the estimate", () => {
		// The rows are content-driven, so the panel measures one and passes it in: a
		// 56 pt row must produce a 56 pt multiple, not a 49 pt one with a sliver.
		const taller = rosterBody({ viewportHeight: 844, rowCount: 6, rowPt: 56 });
		expect(taller.maxHeight % 56).toBe(0);
		expect(taller.maxHeight).not.toBe(
			rosterBody({ viewportHeight: 844, rowCount: 6 }).maxHeight,
		);
	});

	it("shows a usable body even where the share would round to nothing", () => {
		const tiny = rosterBody({ viewportHeight: 120, rowCount: 4 });
		expect(tiny.visibleRows).toBeGreaterThanOrEqual(2);
		expect(rosterBody({ viewportHeight: 568, rowCount: 1 }).visibleRows).toBe(
			1,
		);
	});
});
