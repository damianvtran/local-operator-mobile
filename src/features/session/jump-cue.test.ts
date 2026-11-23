import { describe, expect, it } from "vitest";

import {
	BOTTOM_GROWTH_PT,
	bottomArrival,
	contentArrival,
	JUMP_CUE_ARRIVED,
	JUMP_CUE_AT_TAIL,
	JUMP_CUE_AWAY,
	jumpCueShown,
	NO_BOTTOM,
	NO_TAIL_CONTENT,
	nextBottomMark,
	withArrival,
	withAtTail,
} from "@/features/session/jump-cue";

/**
 * The operator's rule (2026-11-21): the chip is up exactly while the reader is
 * away from the end AND new output landed since they left; arriving at the end
 * by any route retires it. New output is a bottom-row fact, so an older-history
 * insert above the reader never raises it.
 */
describe("jumpCueShown", () => {
	it("is up only for a reader who left the end and has something new below", () => {
		expect(jumpCueShown(JUMP_CUE_ARRIVED)).toBe(true);
		expect(jumpCueShown(JUMP_CUE_AWAY)).toBe(false);
		expect(jumpCueShown(JUMP_CUE_AT_TAIL)).toBe(false);
	});

	it("stays down while the reader is following, even if an arrival was marked", () => {
		expect(jumpCueShown(withArrival(JUMP_CUE_AT_TAIL))).toBe(false);
	});
});

describe("withAtTail", () => {
	it("retires the chip when the reader reaches the end", () => {
		expect(withAtTail(JUMP_CUE_ARRIVED, true)).toEqual(JUMP_CUE_AT_TAIL);
	});

	it("leaves a following reader unchanged (object identity)", () => {
		expect(withAtTail(JUMP_CUE_AT_TAIL, true)).toBe(JUMP_CUE_AT_TAIL);
	});

	it("drops the newest-arrival mark as soon as the reader leaves", () => {
		expect(withAtTail(JUMP_CUE_AT_TAIL, false)).toEqual(JUMP_CUE_AWAY);
	});

	it("keeps an away state unchanged (object identity)", () => {
		expect(withAtTail(JUMP_CUE_AWAY, false)).toBe(JUMP_CUE_AWAY);
		expect(withAtTail(JUMP_CUE_ARRIVED, false)).toBe(JUMP_CUE_ARRIVED);
	});
});

describe("withArrival", () => {
	it("raises the chip for a reader who is away", () => {
		expect(withArrival(JUMP_CUE_AWAY)).toEqual(JUMP_CUE_ARRIVED);
	});

	it("does nothing while the reader follows the end", () => {
		expect(withArrival(JUMP_CUE_AT_TAIL)).toBe(JUMP_CUE_AT_TAIL);
	});

	it("does not churn an arrival already marked", () => {
		expect(withArrival(JUMP_CUE_ARRIVED)).toBe(JUMP_CUE_ARRIVED);
	});
});

describe("nextBottomMark", () => {
	it("remembers a measured row", () => {
		expect(nextBottomMark(NO_BOTTOM, "row-b", 120)).toEqual({
			id: "row-b",
			height: 120,
		});
	});

	it("keeps the last measured height while the bottom row is unmounted", () => {
		const measured = nextBottomMark(NO_BOTTOM, "row-b", 120);
		expect(nextBottomMark(measured, "row-b", null)).toBe(measured);
	});

	it("forgets the old height when a different row becomes the bottom", () => {
		const measured = nextBottomMark(NO_BOTTOM, "row-b", 120);
		expect(nextBottomMark(measured, "row-c", null)).toEqual({
			id: "row-c",
			height: null,
		});
	});

	it("empties with the list", () => {
		expect(
			nextBottomMark(nextBottomMark(NO_BOTTOM, "row-b", 120), null, null),
		).toBe(NO_BOTTOM);
	});
});

describe("bottomArrival", () => {
	it("counts a new last row as new output", () => {
		expect(
			bottomArrival(
				{ id: "row-b", height: 120 },
				{ id: "row-c", height: null },
			),
		).toBe(true);
	});

	it("counts a streamed row growing", () => {
		expect(
			bottomArrival(
				{ id: "row-b", height: 120 },
				{ id: "row-b", height: 120 + BOTTOM_GROWTH_PT + 1 },
			),
		).toBe(true);
	});

	it("ignores a shrink and sub-tolerance re-measures", () => {
		expect(
			bottomArrival({ id: "row-b", height: 120 }, { id: "row-b", height: 100 }),
		).toBe(false);
		expect(
			bottomArrival(
				{ id: "row-b", height: 120 },
				{ id: "row-b", height: 120 + BOTTOM_GROWTH_PT },
			),
		).toBe(false);
	});

	it("does not count a first measurement as growth", () => {
		expect(
			bottomArrival(
				{ id: "row-b", height: null },
				{ id: "row-b", height: 200 },
			),
		).toBe(false);
	});

	it("never counts an older-history insert above the reader", () => {
		/* Content height grew, the bottom row did not: an older page landed above
		 * the viewport, which the operator's rule excludes by name. */
		expect(
			bottomArrival({ id: "row-b", height: 120 }, { id: "row-b", height: 120 }),
		).toBe(false);
	});

	it("does not count the first content of a mount", () => {
		expect(bottomArrival(NO_BOTTOM, { id: "row-a", height: 40 })).toBe(false);
	});
});

/**
 * The WIRE mark, for the reader whose streaming row is unmounted (QA round 1,
 * Q1): no layout exists to read, so the projection's own last row is the signal.
 */
describe("contentArrival", () => {
	it("counts a message arriving at the bottom", () => {
		expect(
			contentArrival({ id: "row-b", size: 12 }, { id: "row-c", size: 4 }),
		).toBe(true);
	});

	it("counts the streamed answer growing under an unchanged id", () => {
		expect(
			contentArrival({ id: "row-b", size: 12 }, { id: "row-b", size: 140 }),
		).toBe(true);
	});

	it("never counts an older-history insert above the reader", () => {
		/* The last row is untouched by a prepend: same id, same text. */
		expect(
			contentArrival({ id: "row-b", size: 40 }, { id: "row-b", size: 40 }),
		).toBe(false);
	});

	it("ignores a shrink and a first observation", () => {
		expect(
			contentArrival({ id: "row-b", size: 140 }, { id: "row-b", size: 12 }),
		).toBe(false);
		expect(contentArrival(NO_TAIL_CONTENT, { id: "row-b", size: 40 })).toBe(
			false,
		);
	});
});
