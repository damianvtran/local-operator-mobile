import { describe, expect, it } from "vitest";
import {
	activityCounts,
	activityCountsLabel,
	activityCountsStack,
	activityCountsWidth,
} from "./activity-counts";

/**
 * The activity line's trailing counts (visual audit D1): the Tasks/Agents
 * capsules and the composer's queued chip folded into the working line. The
 * view paints exactly what these return, so what is shown, what is announced
 * and when the counts take their own line are pinned here without a renderer.
 */
describe("activityCounts", () => {
	const facts = {
		tasks: { open: 2, total: 5 },
		agents: { running: 1, total: 6 },
	};

	it("reads done/total tasks, running/total agents and the queue, in that order", () => {
		const counts = activityCounts(facts, 2);
		expect(counts.map((count) => [count.kind, count.text])).toEqual([
			["tasks", "3/5"],
			["agents", "1/6"],
			["queued", "2"],
		]);
		/* The words the capsules and the queued chip used to show are the
		 *  accessible name: the glyphs are not announced. */
		expect(activityCountsLabel(counts)).toBe(
			"Tasks 3/5, Agents 1/6, 2 queued messages",
		);
	});

	it("omits a list that does not exist, and keeps a zero that is a fact", () => {
		expect(
			activityCounts(
				{ tasks: { open: 0, total: 0 }, agents: { running: 0, total: 0 } },
				0,
			),
		).toEqual([]);
		expect(activityCounts({ tasks: null, agents: null }, 0)).toEqual([]);
		/* All done, none running: still facts about a list that exists. */
		expect(
			activityCounts(
				{ tasks: { open: 0, total: 4 }, agents: { running: 0, total: 3 } },
				0,
			).map((count) => count.text),
		).toEqual(["4/4", "0/3"]);
	});

	it("keeps the queue count when the tasks/agents counts yield to a pending card", () => {
		/* The host passes `null` facts while a pending card owns the slot (UX
		 *  U12); the queue shows nowhere else, so it must survive that. */
		expect(activityCounts(null, 1).map((count) => count.kind)).toEqual([
			"queued",
		]);
		expect(activityCountsLabel(activityCounts(null, 1))).toBe(
			"1 queued message",
		);
	});
});

describe("activityCountsStack (one line, or the counts under it)", () => {
	const all = activityCounts(
		{ tasks: { open: 2, total: 5 }, agents: { running: 1, total: 6 } },
		2,
	);
	const stack = (width: number, scale: number, counts = all) =>
		activityCountsStack({ width, scale, counts, touchFloor: 44 });

	it("shares one line at 390 pt and 100 % text — the band is gone, not moved", () => {
		expect(stack(390, 1)).toBe(false);
	});

	it("takes its own line at 200 % text and never squeezes the status", () => {
		expect(stack(390, 2)).toBe(true);
		expect(stack(320, 2)).toBe(true);
	});

	it("is monotonic: narrower or larger never un-stacks", () => {
		let stacked = false;
		for (let width = 600; width >= 240; width -= 4) {
			const now = stack(width, 1);
			expect(stacked && !now).toBe(false);
			stacked = now;
		}
		expect(stacked).toBe(true);
		expect(activityCountsWidth(all, 2)).toBeGreaterThan(
			activityCountsWidth(all, 1),
		);
	});

	it("never stacks nothing", () => {
		expect(stack(200, 3, [])).toBe(false);
	});
});
