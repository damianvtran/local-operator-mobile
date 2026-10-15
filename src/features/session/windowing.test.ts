import { describe, expect, it } from "vitest";

import { nextAtTail } from "@/features/session/windowing";

/**
 * D21/R4-1: layout settling must not impersonate reader movement, while a genuine
 * up-scroll even during streaming must be dropped
 * by the reader scrolling up — and a reader who scrolled up must never be re-pinned.
 */
const base = {
	wasAtTail: true,
	distanceToEnd: 0,
	bandPt: 48,
	offsetY: 3269.5,
	previousOffsetY: 3269.5,
	viewportPt: 104,
	previousViewportPt: 104,
	contentPt: 3426,
	previousContentPt: 3426,
};

describe("nextAtTail", () => {
	it("is at the tail inside the band", () => {
		expect(nextAtTail({ ...base, distanceToEnd: 10 })).toBe(true);
	});

	it("keeps following while measured content/viewport settle without an upward offset change", () => {
		// Estimated content grew14pt while the viewport grew14pt; the offset did not move.
		expect(
			nextAtTail({
				...base,
				distanceToEnd: 52.5,
				viewportPt: 118,
				contentPt: 3440,
			}),
		).toBe(true);
	});

	it("does not call an upward movement ending far from the new end a clamp", () => {
		expect(
			nextAtTail({
				...base,
				distanceToEnd: 160,
				offsetY: 3160,
				viewportPt: 118,
				previousViewportPt: 104,
			}),
		).toBe(false);
	});

	it("KEEPS following when a row GREW (content change) and moved the end away", () => {
		expect(nextAtTail({ ...base, distanceToEnd: 90, contentPt: 3516 })).toBe(
			true,
		);
	});

	it("a programmatic pin advancing to the end never demotes", () => {
		expect(nextAtTail({ ...base, distanceToEnd: 80, offsetY: 3300 })).toBe(
			true,
		);
		expect(
			nextAtTail({ ...base, distanceToEnd: 0, offsetY: 3100, viewportPt: 400 }),
		).toBe(true);
	});
	it("a layout/content clamp moving backwards is not reader intent", () => {
		expect(
			nextAtTail({
				...base,
				distanceToEnd: 4,
				offsetY: 3100,
				contentPt: 3200,
			}),
		).toBe(true);
	});
	it("an unchanged offset cannot turn following off just because geometry moved the end", () => {
		expect(nextAtTail({ ...base, distanceToEnd: 200 })).toBe(true);
	});
	it("a real up-scroll in stable geometry leaves the tail", () => {
		expect(nextAtTail({ ...base, distanceToEnd: 200, offsetY: 3100 })).toBe(
			false,
		);
	});
	it("never re-acquires a reader who is already away, unless they come back to the band", () => {
		expect(
			nextAtTail({
				...base,
				wasAtTail: false,
				distanceToEnd: 300,
				viewportPt: 118,
			}),
		).toBe(false);
		expect(nextAtTail({ ...base, wasAtTail: false, distanceToEnd: 20 })).toBe(
			true,
		);
	});
});

/** R4-1 regression: execute the actual helper with internally consistent scroll facts.
 * Content arriving while the reader scrolls must not turn an up-scroll into a clamp. */
describe("concurrent stream growth and reader ownership (R4-1)", () => {
	const transition = (content: number, viewport = 118, offset = 3108) => ({
		wasAtTail: true,
		bandPt: 48,
		previousOffsetY: 3308,
		previousContentPt: 3426,
		previousViewportPt: 118,
		offsetY: offset,
		contentPt: content,
		viewportPt: viewport,
		distanceToEnd: content - viewport - offset,
	});

	it.each([0, 1, 24])(
		"leaves following after up200 with %s pt concurrent growth",
		(growth) => {
			expect(nextAtTail(transition(3426 + growth))).toBe(false);
		},
	);

	it("does not re-acquire on the following content or viewport update", () => {
		const first = nextAtTail(transition(3450));
		expect(first).toBe(false);
		expect(
			nextAtTail({
				...transition(3474, 66),
				wasAtTail: first,
				previousOffsetY: 3108,
			}),
		).toBe(false);
	});

	it("does not swallow up200 merely because the viewport grew one point", () => {
		expect(nextAtTail(transition(3426, 119))).toBe(false);
	});

	it("does not swallow reader movement beyond a real clamp allowance", () => {
		// New max = 3400 - 142 = 3258: only 50pt of backward movement is a clamp.
		// The actual 200pt movement therefore contains 150pt of reader-owned scrolling.
		expect(nextAtTail(transition(3400, 142))).toBe(false);
	});

	it("keeps following for a true browser clamp caused by shrink/growing viewport", () => {
		expect(nextAtTail(transition(3300, 118, 3182))).toBe(true);
		expect(nextAtTail(transition(3426, 142, 3284))).toBe(true);
	});
});
