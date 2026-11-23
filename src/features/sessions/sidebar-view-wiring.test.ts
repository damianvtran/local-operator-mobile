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

/**
 * The sheet is a `Modal` INSIDE the drawer's `Modal`, so its footer link must
 * hand off (close, wait for the sheet's own native dismissal, then leave the
 * drawer and push) rather than close both in one tick — "More sidebar
 * settings" left iOS holding a presented controller over Settings that way
 * (2026-11-22; `sidebar-view-handoff.ts`).
 *
 * Asserted over the SOURCE for the same reason as above — rendering this file
 * needs the `uniwind` chain — while the WIRING itself is run against emulated
 * native modal hosts in `sidebar-view-handoff.test.tsx`.
 */
describe("the View options sheet hands off before it leaves the drawer", () => {
	it("takes its open state, close, dismissal and navigation from the shared hand-off", () => {
		expect(SHEET).toContain(
			'import { useSidebarViewHandoff } from "@/features/sessions/sidebar-view-handoff";',
		);
		expect(SHEET).toContain("const sheet = useSidebarViewHandoff();");
		expect(SHEET).toContain("onPress={sheet.openSheet}");
		expect(SHEET).toContain("visible={sheet.open}");
		expect(SHEET).toContain("onClose={sheet.closeSheet}");
		expect(SHEET).toContain("onDismiss={sheet.onDismiss}");
		expect(SHEET).toContain("onHidden={sheet.onHidden}");
		expect(SHEET).toContain("exitInstantly={sheet.exitInstantly}");
	});

	it("runs the drawer close and the push only from the hand-off's launch", () => {
		const more = SHEET.indexOf("sheet.moreSettings(");
		const leave = SHEET.indexOf("onNavigate?.();", more);
		const push = SHEET.indexOf('router.push("/settings?section=sidebar"', more);
		expect(more).toBeGreaterThan(0);
		expect(leave).toBeGreaterThan(more);
		expect(push).toBeGreaterThan(leave);
		// The old wiring kept its own open state and closed it beside the push.
		expect(SHEET).not.toContain("setOpen(");
	});
});
