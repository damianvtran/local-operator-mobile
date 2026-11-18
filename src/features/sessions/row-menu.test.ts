import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { rowMenuActions } from "@/features/sessions/row-menu";
import { t } from "@/i18n";
import { CONTROL } from "@/ui/a11y";

/**
 * The row's long-press menu is an ACTION LIST, not a button stack.
 *
 * Tapping the row already opens the conversation, so `Open` as the sheet's green
 * primary was the loudest thing on the sheet for the one action the reader did
 * not long-press for. Every entry is one row style, and `Open` comes last.
 */
describe("the session row menu", () => {
	it("lists the row's own actions first and Open last", () => {
		const actions = rowMenuActions({ pinned: false, tagsAssignable: true });
		expect(actions.map((action) => action.key)).toEqual([
			"pin",
			"move",
			"tags",
			"open",
		]);
	});

	it("keeps the testIDs the flows and the capture matrix press", () => {
		const actions = rowMenuActions({ pinned: false, tagsAssignable: true });
		expect(actions.map((action) => action.testID)).toEqual([
			CONTROL.sessionOpenCurrent,
			CONTROL.sessionMoveOpen,
			CONTROL.sessionTagsAction,
			CONTROL.sessionOpenPrevious,
		]);
	});

	it("offers Tags only where the relay can assign them", () => {
		const keys = rowMenuActions({ pinned: false, tagsAssignable: false }).map(
			(action) => action.key,
		);
		expect(keys).toEqual(["pin", "move", "open"]);
	});

	it("names the pin action for the row's current state, from the catalogue", () => {
		const [pin] = rowMenuActions({ pinned: false, tagsAssignable: false });
		const [unpin] = rowMenuActions({ pinned: true, tagsAssignable: false });
		expect(pin?.label).toBe(t("mobile.sidebar.menu.pin"));
		expect(unpin?.label).toBe(t("mobile.sidebar.menu.unpin"));
		expect(pin?.label).not.toBe(unpin?.label);
	});

	it("renders every entry as one row style, with no primary button", () => {
		const pane = readFileSync(
			fileURLToPath(new URL("./conversations-pane.tsx", import.meta.url)),
			"utf8",
		);
		const start = pane.indexOf("testID={SURFACE.sessionMenuSheet}");
		const end = pane.indexOf("</Sheet>", start);
		const menu = pane.slice(start, end);
		expect(menu).toContain("rowMenuActions({");
		expect(menu).toContain("<RowMenuItem");
		expect(menu).not.toContain("<Button");
		for (const literal of ['"Open"', '"Pin to the top"', '"Move or copy…"'])
			expect(menu).not.toContain(literal);
	});
});
