import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderFor, SHIPPED_LOCALES, t } from "@/i18n";
import { DEFAULT_SELECTION } from "@/state/theme-preference";
import { THEMES } from "@/ui/tokens.gen";
import {
	isSelectedTheme,
	pickerColumns,
	pickerSections,
	THEME_MODE_ORDER,
	themeModeOptions,
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

/** A hand-written mode option in a screen: the shape the drift came from. */
const LITERAL_MODE_OPTION = /value: "(system|light|dark)"/;

describe("themeModeOptions: one mode order for both surfaces", () => {
	const ids = { system: "s", light: "l", dark: "d" } as const;

	it("is System, Light, Dark — the order the mode cycles from neutral to forced", () => {
		expect(THEME_MODE_ORDER).toEqual(["system", "light", "dark"]);
		expect(themeModeOptions(ids)).toEqual([
			{
				value: "system",
				label: t("mobile.settings.theme.mode_system"),
				testID: "s",
			},
			{
				value: "light",
				label: t("mobile.settings.theme.mode_light"),
				testID: "l",
			},
			{
				value: "dark",
				label: t("mobile.settings.theme.mode_dark"),
				testID: "d",
			},
		]);
	});

	/* The defect (UX pass, settings): Settings listed System / Dark / Light while
	 * the Theme picker listed System / Light / Dark, because each screen spelled
	 * its own option array. Node cannot mount either screen (react-native
	 * styling), so pin the wiring: both read the shared list, and neither keeps a
	 * hand-written mode option of its own that could drift again. */
	it.each(["./settings.tsx", "./theme-picker.tsx"])(
		"%s builds its mode control from themeModeOptions",
		(file) => {
			const source = readFileSync(new URL(file, import.meta.url), "utf8");
			expect(source).toContain("options={themeModeOptions(");
			expect(source).not.toMatch(LITERAL_MODE_OPTION);
		},
	);
});

describe("Theme picker search field", () => {
	/* UX pass, theme picker, then review round 1 (R1/Q2/D2): "Search themes" was
	 * drawn as the label AND as the placeholder right under it. Hiding the label
	 * made the placeholder the field's only visible label (components.md § 4 and
	 * anti-pattern 14). The label stays; the placeholder is a different hint, the
	 * way Library ("Search the library" / "Name, tag or words") and Past do it. */
	const source = readFileSync(
		new URL("./theme-picker.tsx", import.meta.url),
		"utf8",
	);
	const at = source.indexOf("CONTROL.themePickerSearch");
	const field = source.slice(
		source.lastIndexOf("<Input", at),
		source.indexOf("/>", at),
	);

	it("keeps the drawn label: no hidden-label mode", () => {
		expect(field).toContain('label={t("mobile.settings.theme.search_label")}');
		expect(field).toContain(
			'placeholder={t("mobile.settings.theme.search_placeholder")}',
		);
		expect(field).not.toContain("labelHidden");
	});

	it.each(SHIPPED_LOCALES)(
		"%s: the placeholder never repeats the label",
		(locale) => {
			const label = renderFor("mobile.settings.theme.search_label", {}, locale);
			const hint = renderFor(
				"mobile.settings.theme.search_placeholder",
				{},
				locale,
			);
			expect(hint.trim().toLocaleLowerCase(locale)).not.toBe(
				label.trim().toLocaleLowerCase(locale),
			);
		},
	);
});
