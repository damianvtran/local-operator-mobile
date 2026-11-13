import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	metaLineFor,
	metaPathBox,
	metaPathFloorDp,
	textWidthDp,
} from "@/ui/components/list-row-meta";
import { LARGE_TEXT_SCALE, lineBoxPt } from "@/ui/text-scale";
import {
	LIST_ROW_GAP_PT,
	LIST_ROW_SLOT_PT,
	LIST_ROW_SPINNER_PT,
	listRowHangingIndicator,
	listRowLine2,
	navCardClasses,
} from "@/ui/variants";

/**
 * The drawer's row layout after Ola's 430 pt frame (TestFlight 883, design
 * D6/D7/D8). Node has no layout engine, so the rules are pinned as values and
 * the components are checked to use them.
 */
const SRC = join(process.cwd(), "src");
const flat = (path: string) =>
	readFileSync(join(SRC, path), "utf8").replace(/\s+/g, " ");

describe("D6: state marks and folder/model share line 2", () => {
	it("inlines them at normal text, so a marked row is two lines, not three", () => {
		expect(listRowLine2({ hasMarks: true, wrapMarks: false })).toBe("inline");
	});
	it("keeps the stacked layout above LARGE_TEXT_SCALE (D13/Q4-1)", () => {
		expect(listRowLine2({ hasMarks: true, wrapMarks: true })).toBe("stacked");
	});
	it("is the meta alone when there are no marks", () => {
		expect(listRowLine2({ hasMarks: false, wrapMarks: false })).toBe("meta");
		expect(listRowLine2({ hasMarks: false, wrapMarks: true })).toBe("meta");
	});
	it("ListRow lays line 2 out by that rule, the meta taking what the marks leave", () => {
		const row = flat("ui/components/list-row.tsx");
		expect(row).toContain(
			"const line2 = listRowLine2({ hasMarks: Boolean(hasMarks), wrapMarks });",
		);
		expect(row).toContain('line2 === "inline" && "min-w-0 flex-1"');
		expect(row).toContain(
			'{line2 === "inline" ? ( <View className="flex-row items-center gap-2"> {marks} {metaLine} </View>',
		);
	});
});

/* PR #245 agent review R1-R1 / design round 1 D13. Inline runs up to
 *  LARGE_TEXT_SCALE, and on a 320 pt drawer at 1.4 the reviewer's case
 *  (approval + 2 agents + 5 todos, ~250 pt of shrink-0 marks) leaves the meta
 *  ~6 pt of a ~264 pt line. A 100.8 pt cwd floor with flexShrink 0 overflowed
 *  the pane; the cwd must shrink into what the marks leave instead. */
describe("D13: an inline cwd yields to the marks instead of leaving the pane", () => {
	const LINE = 264;
	const MARKS = 250;
	const GAP = 8;
	it("shrinks the cwd box when it shares line 2 with the marks", () => {
		expect(metaPathBox(LARGE_TEXT_SCALE, true)).toMatchObject({
			flexShrink: 1,
			minWidth: 0,
		});
	});
	it("keeps the floor guaranteed when the cwd has its own line (D26)", () => {
		for (const scale of [1, LARGE_TEXT_SCALE, 2]) {
			expect(metaPathBox(scale, false)).toEqual({
				flexBasis: metaPathFloorDp(scale),
				flexGrow: 1,
				flexShrink: 0,
				minWidth: 0,
			});
		}
	});
	it("keeps the floor as the basis inline, so a line with room is unchanged", () => {
		expect(metaPathBox(1, true).flexBasis).toBe(metaPathFloorDp(1));
	});
	it("paints a string that fits what the marks leave, at every inline scale", () => {
		for (const scale of [1.1, 1.2, 1.3, LARGE_TEXT_SCALE]) {
			const left = LINE - MARKS - GAP;
			/* The floor alone would not fit: the case the reviewer measured. */
			expect(metaPathFloorDp(scale)).toBeGreaterThan(left);
			const painted = metaLineFor({
				cwd: "/Users/ola/work_folder/minervaai",
				model: "anthropic/claude-opus-5",
				widthDp: left,
				scale,
			});
			expect(painted.model).toBeNull();
			expect(textWidthDp(painted.cwd ?? "", scale)).toBeLessThanOrEqual(left);
		}
	});
	it("ListRow takes the box from that rule, by its line-2 layout", () => {
		const row = flat("ui/components/list-row.tsx");
		expect(row).toContain(
			'style={metaPathBox(effectiveScale, line2 === "inline")}',
		);
		expect(row).not.toContain("META_PATH_BOX");
	});
});

describe("D7: the indicator sits on the title line, the spinner in its slot", () => {
	it("hangs back across the slot and the gap, one title line tall", () => {
		expect(listRowHangingIndicator({ scale: 1 })).toEqual({
			start: -(LIST_ROW_SLOT_PT + LIST_ROW_GAP_PT),
			top: 0,
			height: lineBoxPt("label", 1),
		});
		expect(lineBoxPt("label", 1)).toBeCloseTo(18);
		expect(listRowHangingIndicator({ scale: 2 }).height).toBeCloseTo(36);
	});
	it("keeps a padded row's dot on its left edge", () => {
		expect(listRowHangingIndicator({ slotPt: 40, scale: 1 }).start).toBe(
			-(40 + LIST_ROW_GAP_PT),
		);
	});
	it("paints the streaming spinner at the slot's 12 pt, not iOS's intrinsic 20", () => {
		expect(LIST_ROW_SPINNER_PT).toBeLessThanOrEqual(12.5);
		const row = flat("ui/components/list-row.tsx");
		expect(row).toContain(
			"<Indicator attention={attention} spinnerPt={LIST_ROW_SPINNER_PT} />",
		);
		expect(row).toContain("style={listRowHangingIndicator({");
	});
});

describe("D8: the row owns the gutter in the conversations pane", () => {
	const pane = flat("features/sessions/conversations-pane.tsx");
	it("does not pad the list, so the gutter is not doubled", () => {
		expect(pane).toContain('contentContainerClassName="grow"');
		expect(pane).not.toContain('contentContainerClassName="grow px-4"');
		expect(pane).not.toContain("marginHorizontal: -16");
	});
	it("pads section headers, the stale line and the empty state themselves", () => {
		expect(pane).toContain(
			'<View className="px-4"> <SectionHeader label={item.label} testID={item.testID} /> </View>',
		);
		expect(pane).toContain('<View className="px-4 pt-2">');
		expect(pane).toContain('"flex-none px-4" : "flex-1 px-4"');
	});
});

describe("the nav card (Computers row, Team Bridge entry)", () => {
	it("has a control edge and a visible pressed and selected ground", () => {
		expect(navCardClasses()).toContain("border-border-control");
		expect(navCardClasses()).toContain("bg-surface");
		expect(navCardClasses({ pressed: true })).toContain("bg-sunken");
		expect(navCardClasses({ selected: true })).toContain("bg-row-selected");
		expect(navCardClasses()).not.toContain("hairline");
	});
});
