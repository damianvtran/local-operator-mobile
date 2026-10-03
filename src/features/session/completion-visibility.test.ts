import { describe, expect, it } from "vitest";

import {
	anchorBottomVisible,
	entryComplete,
} from "@/features/session/completion-visibility";

/**
 * The arithmetic the ack gate is built on. The behaviour was learned from the
 * web client's failures, so the cases below are the FAILURES: a completion
 * scrolled off either edge must not count as seen, and a reading that cannot
 * be computed must resolve to NOT visible.
 */
describe("anchorBottomVisible", () => {
	const base = { viewportPt: 800, anchorRendered: true };

	it("is visible when the anchored row is the last row and the list is at its end", () => {
		// tailDistance 0: the content's end sits exactly at the viewport's end.
		expect(
			anchorBottomVisible({ ...base, tailDistance: 0, afterHeight: 0 }),
		).toBe(true);
		// iOS overscroll past the end keeps the end on screen.
		expect(
			anchorBottomVisible({ ...base, tailDistance: -40, afterHeight: 0 }),
		).toBe(true);
	});

	it("is NOT visible when the reader scrolled away from the end", () => {
		// 30 pt up from the bottom pushes the last row's bottom below the
		// viewport: the end the receipt is about is off screen.
		expect(
			anchorBottomVisible({ ...base, tailDistance: 30, afterHeight: 0 }),
		).toBe(false);
	});

	it("accounts for rows after the anchor", () => {
		// 300 pt of rows sit below the anchor. At the very end the anchor's bottom
		// is 498 pt above the bottom edge — on screen — and it stays on screen
		// until the reader scrolls past the point where it leaves the bottom edge
		// (the visible band is tailDistance < afterHeight + 2).
		expect(
			anchorBottomVisible({ ...base, tailDistance: 0, afterHeight: 300 }),
		).toBe(true);
		expect(
			anchorBottomVisible({ ...base, tailDistance: 300, afterHeight: 300 }),
		).toBe(true);
		// 500 + 800 - 300 - 2 = 998 ≥ viewport: the reader scrolled on to earlier
		// content and the anchor's END is below the fold — not being read, not a
		// receipt.
		expect(
			anchorBottomVisible({ ...base, tailDistance: 500, afterHeight: 300 }),
		).toBe(false);
		// The other exit: an anchor far above the fold (2000 pt of later rows) is
		// not visible from the end either — 0 + 800 - 2000 - 2 < 0.
		expect(
			anchorBottomVisible({ ...base, tailDistance: 0, afterHeight: 2000 }),
		).toBe(false);
	});

	it("resolves unmeasurable geometry to NOT visible", () => {
		// Unknown must never read as visible — that direction is the one that can
		// acknowledge by accident.
		expect(
			anchorBottomVisible({ ...base, tailDistance: 0, afterHeight: null }),
		).toBe(false);
		expect(
			anchorBottomVisible({
				...base,
				tailDistance: 0,
				afterHeight: 0,
				anchorRendered: false,
			}),
		).toBe(false);
	});
});

describe("entryComplete", () => {
	it("requires a finished row: final AND text-complete", () => {
		expect(entryComplete({ final: true, text_complete: true })).toBe(true);
		expect(entryComplete({ final: true, text_complete: false })).toBe(false);
		expect(entryComplete({ final: false, text_complete: true })).toBe(false);
	});
});
