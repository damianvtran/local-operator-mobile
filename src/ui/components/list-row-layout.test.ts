import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lineBoxPt } from "@/ui/text-scale";
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
