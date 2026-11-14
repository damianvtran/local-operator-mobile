import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The drawer's wiring of the View options cues (PR #255 review round 1: design
 * D1/D2, code M1, QA Q2). The RULES are unit-tested in `sidebar-view.test.ts`;
 * this pins that the pane and the sheet actually draw them.
 *
 * Asserted over the SOURCE, for the reason `sidebar-footer.test.ts` and
 * `tags-wiring.test.ts` record: the pane reaches `uniwind` through `@/ui`, which
 * the Node test environment cannot import, and a rendered frame is the capture
 * rig's job (QA's), not a unit's.
 */
const read = (name: string) =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
const PANE = read("./conversations-pane.tsx");
const SHEET = read("./sidebar-view-sheet.tsx");

describe("the drawer draws the view's cues", () => {
	it("D1: the flat list draws a divider after its pinned run", () => {
		expect(PANE).toContain('kind: "divider"');
		expect(PANE).toContain("group.pinnedLead");
		expect(PANE).toContain("testID={REGION.sidebarPinnedDivider}");
	});

	it("D2: hidden sections are announced in the list, and the trigger fills when custom", () => {
		expect(PANE).toContain("hiddenSectionCount(sidebarView)");
		expect(PANE).toContain('t("mobile.sidebar.hidden_sections"');
		expect(SHEET).toContain("active={isCustomSidebarView(view)}");
	});

	it("M1: a list the view emptied gets its own empty state, with a reset", () => {
		expect(PANE).toContain("isEmptiedByView(filtered, groups)");
		expect(PANE).toContain('t("mobile.sidebar.empty_by_view.headline")');
		expect(PANE).toContain("setSidebarView(DEFAULT_SIDEBAR_VIEW)");
	});

	it("Q2: the sheet title may take two lines rather than ellipsize at 320 pt / 200 %", () => {
		expect(SHEET).toContain("titleLines={2}");
	});
});
