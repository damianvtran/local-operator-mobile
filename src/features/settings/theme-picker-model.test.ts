import { describe, expect, it } from "vitest";

import { DEFAULT_SELECTION } from "@/state/theme-preference";
import { THEMES } from "@/ui/tokens.gen";
import {
	isSelectedTheme,
	pickerColumns,
	pickerSections,
} from "./theme-picker-model";

describe("pickerColumns", () => {
	it("is 2 from 320 to 599 pt and 3 from 600 (record § 5)", () => {
		expect(pickerColumns(320)).toBe(2);
		expect(pickerColumns(599)).toBe(2);
		expect(pickerColumns(600)).toBe(3);
		expect(pickerColumns(1024)).toBe(3);
		// Narrower than a phone (a split pane): one card per row, never a card
		// under its own minimum.
		expect(pickerColumns(280)).toBe(1);
	});
});

describe("pickerSections", () => {
	it("puts the side being looked at first, and keeps the desktop family order", () => {
		const dark = pickerSections("", "dark");
		expect(dark.map((s) => s.mode)).toEqual(["dark", "light"]);
		expect(pickerSections("", "light").map((s) => s.mode)).toEqual([
			"light",
			"dark",
		]);
		const order = THEMES.filter((t) => t.mode === "dark").map((t) => t.id);
		expect(dark[0]?.themes.map((t) => t.id)).toEqual(order);
		expect(dark[0]?.themes[0]?.id).toBe("localOperatorDark");
	});

	it("lists every shipped theme exactly once with no query", () => {
		const all = pickerSections("", "dark").flatMap((s) => s.themes);
		expect(all).toHaveLength(THEMES.length);
	});

	it("filters by name, ignoring case and accents", () => {
		const ids = pickerSections("ROSE", "dark").flatMap((s) =>
			s.themes.map((t) => t.id),
		);
		expect(ids).toEqual(
			expect.arrayContaining([
				"rosePine",
				"rosePineMoon",
				"rosePineDawn",
				"rosewood",
			]),
		);
		expect(ids).not.toContain("dracula");
	});

	it("keeps an empty section so the screen can say nothing matched", () => {
		const sections = pickerSections("zzzz-no-theme", "light");
		expect(sections).toHaveLength(2);
		expect(sections.every((s) => s.themes.length === 0)).toBe(true);
	});
});

describe("isSelectedTheme", () => {
	it("marks each side's slot, one card per side", () => {
		const selected = THEMES.filter((t) =>
			isSelectedTheme(t, DEFAULT_SELECTION),
		);
		expect(selected.map((t) => t.id).sort()).toEqual([
			"localOperatorDark",
			"localOperatorLight",
		]);
	});
});
