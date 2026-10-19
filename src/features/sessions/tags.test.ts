import { describe, expect, it } from "vitest";

import type { TagRef } from "@/contracts";
import {
	canAssignSessionTags,
	clearedTags,
	desiredTagWrite,
	settledPrimary,
	TAG_VISIBLE_LIMIT,
	tagAnnouncement,
	tagLineFor,
} from "@/features/sessions/tags";
import { textWidthDp } from "@/ui/components/list-row-meta";

const RESEARCH: TagRef = { id: "cb65004501", name: "Research" };
const WORK: TagRef = { id: "d28b35a273", name: "Work" };
const LONG: TagRef = {
	id: "a1b2c3d4e5",
	name: "A category whose name is far too long for a phone row",
};
const THIRD: TagRef = { id: "ffffffffff", name: "Personal" };

describe("the row's tag line", () => {
	it("paints nothing when the row has no tags", () => {
		expect(tagLineFor([], 232, 1)).toEqual({ labels: [], more: 0 });
	});

	it("preserves the relay's assignment order", () => {
		/* The schema's own contract: the relay's order is the assignment order,
		 *  and nothing here re-sorts by name or primary. */
		const line = tagLineFor([WORK, RESEARCH], 232, 1);
		expect(line.labels).toEqual(["Work", "Research"]);
	});

	it("caps at two labels and counts the rest in a cue", () => {
		const line = tagLineFor([RESEARCH, WORK, THIRD], 232, 1);
		expect(line.labels).toHaveLength(TAG_VISIBLE_LIMIT);
		expect(line.labels).toEqual(["Research", "Work"]);
		expect(line.more).toBe(1);
	});

	it("paints the visible names whole before the first layout", () => {
		/* The common row fits them, so its first frame is its settled frame —
		 *  the same rule `metaLineFor` follows before `onLayout` lands. */
		expect(tagLineFor([RESEARCH, WORK], 0, 1).labels).toEqual([
			"Research",
			"Work",
		]);
	});

	it("truncates a long name from the tail rather than overflowing its share", () => {
		const width = 232;
		const line = tagLineFor([LONG], width, 1);
		const painted = line.labels[0] ?? "";
		expect(painted.endsWith("…")).toBe(true);
		expect(painted.length).toBeLessThan(LONG.name.length);
		/* The painted string plus badge chrome fits the row: `px-2` each side
		 *  (16) and the 1 px border each side (2). Arithmetic, not a screenshot —
		 *  the capture cells prove the pixels. */
		expect(textWidthDp(painted, 1) + 18).toBeLessThanOrEqual(width);
	});

	it("truncates both labels when two long names share the row", () => {
		const width = 232;
		const line = tagLineFor([LONG, { ...LONG, id: "bbbbbbbbbb" }], width, 1);
		const share = Math.floor((width - 4) / 2);
		for (const label of line.labels) {
			expect(label.endsWith("…")).toBe(true);
			expect(textWidthDp(label, 1) + 18).toBeLessThanOrEqual(share);
		}
	});

	it("reserves room for the cue before fitting the labels", () => {
		const width = 120;
		const line = tagLineFor(
			[LONG, { ...LONG, id: "bbbbbbbbbb" }, THIRD],
			width,
			1,
		);
		expect(line.more).toBe(1);
		/* With a cue present the labels are narrower than they would be alone —
		 *  the cue must not be the element that overflows. */
		const alone = tagLineFor([LONG], width, 1).labels[0] ?? "";
		expect((line.labels[0] ?? "").length).toBeLessThan(alone.length);
	});

	it("announces every assigned name, not only the painted ones", () => {
		expect(tagAnnouncement([RESEARCH, WORK, THIRD])).toBe(
			"Tags: Research, Work, Personal",
		);
	});
});

describe("a toggle's desired state", () => {
	it("appends an added tag in assignment order and keeps the primary", () => {
		expect(desiredTagWrite([RESEARCH], RESEARCH.id, WORK.id)).toEqual({
			tags: [RESEARCH.id, WORK.id],
			primary: RESEARCH.id,
		});
	});

	it("gives the primary to the first selected tag when the primary is removed", () => {
		expect(desiredTagWrite([RESEARCH, WORK], RESEARCH.id, RESEARCH.id)).toEqual(
			{
				tags: [WORK.id],
				primary: WORK.id,
			},
		);
	});

	it("keeps the primary when a non-primary tag is removed", () => {
		expect(desiredTagWrite([RESEARCH, WORK], WORK.id, RESEARCH.id)).toEqual({
			tags: [WORK.id],
			primary: WORK.id,
		});
	});

	it("sets a primary when the first tag is added to an empty assignment", () => {
		expect(desiredTagWrite([], null, RESEARCH.id)).toEqual({
			tags: [RESEARCH.id],
			primary: RESEARCH.id,
		});
	});

	it("never leaves the primary pointing at a removed id", () => {
		const next = desiredTagWrite([RESEARCH], null, RESEARCH.id);
		expect(next.tags).toEqual([]);
		expect(next.primary).toBeNull();
	});
});

describe("clearing", () => {
	it("uses the route's exact empty body", () => {
		expect(clearedTags()).toEqual({ tags: [], primary: null });
	});
});

describe("the capability gate", () => {
	it("is closed when the relay does not publish the block", () => {
		expect(canAssignSessionTags(undefined)).toBe(false);
		expect(canAssignSessionTags({} as never)).toBe(false);
	});

	it("is closed when the relay publishes it as unavailable", () => {
		expect(
			canAssignSessionTags({ session_tags: { available: false } } as never),
		).toBe(false);
	});

	it("is open only on an explicit true", () => {
		expect(
			canAssignSessionTags({ session_tags: { available: true } } as never),
		).toBe(true);
	});
});

describe("the settled primary", () => {
	it("keeps a primary that is in the read-back's tags", () => {
		expect(settledPrimary([RESEARCH, WORK], WORK.id)).toBe(WORK.id);
	});

	it("falls back to the first tag when the primary is outside the set", () => {
		expect(settledPrimary([RESEARCH], "not-a-tag")).toBe(RESEARCH.id);
	});

	it("falls back to the first tag when the relay sent null", () => {
		expect(settledPrimary([WORK, RESEARCH], null)).toBe(WORK.id);
	});

	it("is null for an empty assignment", () => {
		expect(settledPrimary([], null)).toBeNull();
	});
});
