import { describe, expect, it } from "vitest";

import { nextAtTail } from "@/features/session/windowing";

/**
 * D21 (design round 3): the tail flag must not be dropped by a layout change that moved
 * the END away (the secondary region collapsing grows the viewport), but must be dropped
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

	it("KEEPS following when a layout change (viewport 104 -> 118) moved the end 52.5 pt away", () => {
		// the measured race: pinned at client 104, then the region collapsed
		expect(nextAtTail({ ...base, distanceToEnd: 52.5, viewportPt: 118 })).toBe(
			true,
		);
	});

	it("keeps a geometry-driven backwards clamp distinct from a stable reader scroll", () => {
		expect(
			nextAtTail({
				...base,
				distanceToEnd: 160,
				offsetY: 3160,
				viewportPt: 118,
				previousViewportPt: 104,
			}),
		).toBe(true);
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
				distanceToEnd: 60,
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
