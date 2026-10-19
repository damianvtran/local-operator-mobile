import { describe, expect, it } from "vitest";

import type { TagRef } from "@/contracts";
import {
	canAssignSessionTags,
	catalogueWithAssigned,
	clearedTags,
	desiredTagWrite,
	draftMatchesDesired,
	settledPrimary,
	TAG_LINE_TARGET_DP,
	TAG_VISIBLE_LIMIT,
	tagAnnouncement,
	tagLineFor,
	tagLineTargetHeightDp,
} from "@/features/sessions/tags";
import {
	rowAccessibilityLabel,
	sansTextWidthDp,
	textWidthDp,
} from "@/ui/components/list-row-meta";

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
		expect(sansTextWidthDp(painted, 1) + 18).toBeLessThanOrEqual(width);
	});

	it("truncates both labels when two long names share the row", () => {
		const width = 232;
		const line = tagLineFor([LONG, { ...LONG, id: "bbbbbbbbbb" }], width, 1);
		const share = Math.floor((width - 4) / 2);
		for (const label of line.labels) {
			expect(label.endsWith("…")).toBe(true);
			expect(sansTextWidthDp(label, 1) + 18).toBeLessThanOrEqual(share);
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

	it("fits a badge with the SANS advance, not the mono line's", () => {
		/* The regression this pins (review round 1, G): the label is a sans
		 *  `Badge`, and charging it `textWidthDp` (0.600 em every glyph) elided
		 *  "Research" when only 51.3 dp of a 52 dp budget was needed. The mono
		 *  figure is asserted too, so a future edit cannot make this pass by
		 *  swapping the helper back while the two faces happen to agree. */
		expect(textWidthDp("Research", 1)).toBeGreaterThan(52);
		expect(sansTextWidthDp("Research", 1)).toBeLessThanOrEqual(52);
		expect(tagLineFor([RESEARCH], 70, 1).labels).toEqual(["Research"]);
	});

	it("lets a short label's slack rescue a longer neighbour", () => {
		/* R2-m3, the second half of D5: equal shares gave each label half the row,
		 *  so "Work" used ~50 of its 114 dp and the other 64 could not help the
		 *  long name. The allocation now satisfies short labels first and hands
		 *  the remainder to the one that needs it. */
		const width = 232;
		const line = tagLineFor([WORK, LONG], width, 1);
		expect(line.labels[0]).toBe("Work");
		const painted = line.labels[1] ?? "";
		expect(painted.endsWith("…")).toBe(true);
		const equalShare = Math.floor((width - 4) / 2);
		expect(sansTextWidthDp(painted, 1) + 18).toBeGreaterThan(equalShare);
		expect(sansTextWidthDp(painted, 1) + 18).toBeLessThanOrEqual(width);
	});
});

describe("the disclosure's target", () => {
	it("is a real 44 dp box, never the 22 dp badge row", () => {
		/* R2-3: the badges are 22 dp tall, and react-native-web drops
		 *  `Pressable` hitSlop, so the control needs real geometry. */
		expect(TAG_LINE_TARGET_DP).toBeGreaterThanOrEqual(44);
		expect(tagLineTargetHeightDp(44)).toBe(44);
		expect(tagLineTargetHeightDp(48)).toBe(48);
	});
});

describe("a settled answer's paint right", () => {
	const afterFirstPress = { tags: [WORK], primary: WORK.id };
	const afterSecondPress = {
		tags: [WORK, RESEARCH],
		primary: WORK.id,
	};
	const firstDesired = { tags: [WORK.id], primary: WORK.id };

	it("does not paint the first answer over a newer second press", () => {
		/* R2-2: the read-back for Work's answer is {Work}; the draft already
		 *  holds Research too, so painting it would visibly uncheck that press
		 *  until the queued write settled. */
		expect(draftMatchesDesired(afterFirstPress, firstDesired)).toBe(true);
		expect(draftMatchesDesired(afterSecondPress, firstDesired)).toBe(false);
	});

	it("paints the queued write's answer, which still matches the draft", () => {
		expect(
			draftMatchesDesired(afterSecondPress, {
				tags: [WORK.id, RESEARCH.id],
				primary: WORK.id,
			}),
		).toBe(true);
	});

	it("keeps a third press derived from the second press's draft", () => {
		/* The wiped draft used to make this press omit Research and lose the
		 *  queued change; deriving from the intact draft keeps it. */
		expect(
			desiredTagWrite(afterSecondPress.tags, afterSecondPress.primary, WORK.id),
		).toEqual({ tags: [RESEARCH.id], primary: RESEARCH.id });
	});

	it("paints nothing when no draft remains", () => {
		expect(draftMatchesDesired(null, firstDesired)).toBe(false);
	});
});

describe("the catalogue the checkboxes offer", () => {
	const catalogue = [
		{ ...WORK, order: 0, conversations: 3 },
		{ ...RESEARCH, order: 1, conversations: 2 },
	];

	it("keeps the registry's order and entries", () => {
		expect(catalogueWithAssigned(catalogue, [])).toEqual(catalogue);
	});

	it("appends an assigned tag the registry omitted, so it can be unchecked", () => {
		/* A category deleted from the desktop can still sit on a conversation;
		 *  a stale `GET /api/tags` must not hide the assignment (review round 1,
		 *  K). The appended entry is selectable, with no invented count. */
		const merged = catalogueWithAssigned(catalogue, [THIRD]);
		expect(merged.map((tag) => tag.id)).toEqual([
			WORK.id,
			RESEARCH.id,
			THIRD.id,
		]);
		expect(merged[2]).toEqual({
			id: THIRD.id,
			name: THIRD.name,
			order: 2,
			conversations: 0,
		});
	});

	it("does not duplicate an assigned tag that is already listed", () => {
		const merged = catalogueWithAssigned(catalogue, [RESEARCH, WORK]);
		expect(merged).toHaveLength(2);
		expect(merged.map((tag) => tag.id)).toEqual([WORK.id, RESEARCH.id]);
	});

	it("offers an assigned tag when the whole registry is empty", () => {
		/* The sheet branches its empty state on `options`, not on the raw
		 *  catalogue: an empty registry plus one assignment is NOT an empty
		 *  list (K). This is that derivation without the component. */
		expect(catalogueWithAssigned([], [THIRD])).toEqual([
			{ id: THIRD.id, name: THIRD.name, order: 0, conversations: 0 },
		]);
	});
});

describe("the row's accessible label", () => {
	it("includes every tag, including the one behind +N", () => {
		/* The tag line is a child node of a row that is ONE accessible element;
		 *  without folding the announcement in, a reader heard the title and never
		 *  the tags (review round 1, D4/Q2). The third tag is the one the compact
		 *  line hid behind `+1`, so a label built from the painted badges would
		 *  still fail this. */
		const label = rowAccessibilityLabel({
			title: "Three categories",
			attention: "none",
			attentionWord: "approval",
			selected: false,
			tagAnnouncement: tagAnnouncement([RESEARCH, WORK, THIRD]),
		});
		for (const tag of [RESEARCH, WORK, THIRD]) {
			expect(label).toContain(tag.name);
		}
	});

	it("leaves an untagged row's label unchanged", () => {
		expect(
			rowAccessibilityLabel({
				title: "No categories",
				attention: "none",
				attentionWord: "approval",
				selected: false,
			}),
		).toBe("No categories");
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
