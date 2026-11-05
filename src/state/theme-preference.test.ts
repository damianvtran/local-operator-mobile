import { describe, expect, it } from "vitest";

import {
	activeThemeId,
	chooseTheme,
	DEFAULT_SELECTION,
	parseSelection,
	serializeSelection,
} from "@/state/theme-preference";

/**
 * The preference model and its migration (decision record § 5, "Preference
 * model"). A stored value is data from an older build, so every shape a
 * previous build could leave behind must read as SOMETHING themed.
 */
describe("parseSelection", () => {
	it("reads nothing as the default pair, following the device", () => {
		expect(parseSelection(null)).toEqual(DEFAULT_SELECTION);
		expect(parseSelection("")).toEqual(DEFAULT_SELECTION);
		expect(DEFAULT_SELECTION).toEqual({
			mode: "system",
			lightTheme: "localOperatorLight",
			darkTheme: "localOperatorDark",
		});
	});

	it("migrates the old three-way preference to the mode, keeping the brand pair", () => {
		for (const mode of ["system", "light", "dark"] as const) {
			// Both a JSON string and a bare word, the two ways one could be stored.
			expect(parseSelection(JSON.stringify(mode))).toEqual({
				...DEFAULT_SELECTION,
				mode,
			});
			expect(parseSelection(mode)).toEqual({ ...DEFAULT_SELECTION, mode });
		}
	});

	it("round-trips a selection", () => {
		const selection = {
			mode: "dark",
			lightTheme: "rosePineDawn",
			darkTheme: "dracula",
		} as const;
		expect(parseSelection(serializeSelection(selection))).toEqual(selection);
	});

	it("falls back per slot for a theme this build does not ship, or one of the wrong side", () => {
		expect(
			parseSelection(
				JSON.stringify({
					mode: "light",
					lightTheme: "dracula", // a dark theme in the light slot
					darkTheme: "no-such-theme",
				}),
			),
		).toEqual({ ...DEFAULT_SELECTION, mode: "light" });
		// A palette the contrast gate withholds is not shipped, so it reads as
		// the default rather than as a theme the app cannot paint.
		expect(
			parseSelection(
				JSON.stringify({ mode: "dark", darkTheme: "catppuccinMocha" }),
			).darkTheme,
		).toBe("localOperatorDark");
	});

	it("treats garbage as the default rather than throwing", () => {
		for (const raw of ["{", "42", "null", "[]", '{"mode":"sepia"}'])
			expect(parseSelection(raw).mode).toBe("system");
	});
});

describe("chooseTheme", () => {
	it("fills the tapped theme's slot", () => {
		const next = chooseTheme(DEFAULT_SELECTION, "dracula", "dark");
		expect(next).toEqual({ ...DEFAULT_SELECTION, darkTheme: "dracula" });
	});

	it("switches a forced mode to the tapped side, so a tap always shows", () => {
		const forcedLight = { ...DEFAULT_SELECTION, mode: "light" } as const;
		expect(chooseTheme(forcedLight, "dracula", "dark").mode).toBe("dark");
		expect(chooseTheme(forcedLight, "paper", "light").mode).toBe("light");
	});

	it("leaves System alone: the slot shows when the phone is on that side", () => {
		expect(chooseTheme(DEFAULT_SELECTION, "paper", "light").mode).toBe(
			"system",
		);
	});
});

describe("activeThemeId", () => {
	it("is the slot of the side that renders", () => {
		const selection = {
			mode: "system",
			lightTheme: "paper",
			darkTheme: "nord",
		} as const;
		expect(activeThemeId(selection, "light")).toBe("paper");
		expect(activeThemeId(selection, "dark")).toBe("nord");
	});
});
