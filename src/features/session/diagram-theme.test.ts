import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	PELE_COLOUR_ROLES,
	peleThemeVariables,
} from "@/features/session/diagram-theme";
import { COLOR_ROLES, THEMES } from "@/ui/tokens.gen";

const HEX = /^#[0-9a-f]{6,8}$/i;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i;
const SERIES = /^--pele-series-(\d)$/;

describe("Pele's colours read the app's role tokens", () => {
	it("maps every variable to a role the token system defines", () => {
		for (const [variable, role] of Object.entries(PELE_COLOUR_ROLES)) {
			expect(variable.startsWith("--pele-"), variable).toBe(true);
			expect(
				COLOR_ROLES as readonly string[],
				`${variable} -> ${role}`,
			).toContain(role);
		}
	});

	it("covers the eight chart series, in the desktop's order", () => {
		const series = Object.entries(PELE_COLOUR_ROLES)
			.filter(([name]) => SERIES.test(name))
			.map(([, role]) => role);
		expect(series).toEqual([
			"accent",
			"accent-alt",
			"warning",
			"danger",
			"info",
			"success",
			"accent",
			"accent-alt",
		]);
	});

	it("carries no colour literal: the roles are the only source", () => {
		const source = readFileSync(
			new URL("./diagram-theme.ts", import.meta.url),
			"utf8",
		);
		expect(source.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(LITERAL_COLOUR);
	});

	it("resolves to a concrete colour in every shipped palette, light and dark", () => {
		const modes = new Set<string>();
		for (const entry of THEMES) {
			modes.add(entry.mode);
			const variables = peleThemeVariables((role) => entry.colors[role]);
			for (const [name, value] of Object.entries(variables)) {
				expect(value, `${entry.id} ${name}`).toMatch(HEX);
			}
		}
		expect([...modes].sort()).toEqual(["dark", "light"]);
	});

	it("gives light and dark different values, so a theme change redraws", () => {
		const light = THEMES.find((entry) => entry.mode === "light");
		const dark = THEMES.find((entry) => entry.mode === "dark");
		if (!(light && dark)) throw new Error("no light/dark theme");
		const a = peleThemeVariables((role) => light.colors[role]);
		const b = peleThemeVariables((role) => dark.colors[role]);
		expect(a["--pele-bg"]).not.toBe(b["--pele-bg"]);
		expect(a["--pele-fg"]).not.toBe(b["--pele-fg"]);
	});
});
