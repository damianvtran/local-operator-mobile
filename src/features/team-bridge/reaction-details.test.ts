import { describe, expect, it } from "vitest";
import {
	collapsedReactionCount,
	sampledReactionDetails,
} from "./reaction-details";

describe("reaction summary inspection", () => {
	it("keeps ownership separate from sampled labels and never invents You", () => {
		expect(
			sampledReactionDetails({
				emoji: "👍",
				count: 8,
				reacted_by_me: true,
				sample_labels: ["Ada", "Ben", "Cy"],
			}),
		).toEqual({ labels: ["Ada", "Ben", "Cy"], others: 5, mine: true });
	});
	it("has no identity claims when the hub sends no sample", () => {
		expect(
			sampledReactionDetails({
				emoji: "👍",
				count: 8,
				reacted_by_me: false,
				sample_labels: [],
			}),
		).toEqual({ labels: [], others: 8, mine: false });
	});
	it("bounds collapsed pills by three measured lines, not an emoji count", () => {
		expect(collapsedReactionCount(150, Array(14).fill(44))).toBe(9);
		expect(collapsedReactionCount(150, Array(14).fill(44), 44)).toBe(8);
		expect(collapsedReactionCount(150, [44, 44], 44)).toBe(2);
		expect(collapsedReactionCount(100, Array(14).fill(44))).toBe(6);
		expect(collapsedReactionCount(150, [44, 0, 44])).toBe(3);
		expect(collapsedReactionCount(0, Array(14).fill(44))).toBe(14);
	});
});
