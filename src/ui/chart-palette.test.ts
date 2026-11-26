import { describe, expect, it } from "vitest";
import {
	chartColorsFor,
	chartPalette,
	contrastRatio,
	cvdDistance,
} from "@/ui/chart-palette";
import { THEMES } from "@/ui/tokens.gen";

// Golden vectors from the shared inline-chart spec §4. Desktop, relay web and
// this app pin the SAME outputs, so a change here means all three change.
const GOLDEN = {
	localOperatorDark: {
		grounds: ["#1d1b17", "#26221c", "#2a261d"],
		accent: "#38c96a",
		expected: "#38C96A #92C1FD #17B6A8 #DCBC33 #AD87ED #FF96D3 #E18528",
	},
	localOperatorLight: {
		grounds: ["#f2ede3", "#f7f5ee", "#fcfbf7"],
		accent: "#137742",
		expected: "#137742 #1762B6 #059488 #9B3876 #977E0D #915006 #8F68CB",
	},
	highContrastLight: {
		grounds: ["#E6E6E6", "#F2F2F2", "#fafafa"],
		accent: "#0846C1",
		expected: "#0846C1 #756208 #159085 #9B3876 #CA5551 #107823 #8F68CB",
	},
	dracula: {
		grounds: ["#1D1F2B", "#232539", "#232539"],
		accent: "#C096FC",
		expected: "#C096FC #DCBC33 #17B6A8 #7BD77F #E18528 #FF96D3 #ED756E",
	},
} as const;

describe("chartPalette golden vectors", () => {
	it.each(Object.entries(GOLDEN))("%s", (_, { grounds, accent, expected }) => {
		expect(chartPalette({ grounds, accent }).join(" ")).toBe(expected);
	});
});

describe("chartPalette on every shipped theme", () => {
	it.each(THEMES.map((theme) => [theme.id, theme] as const))(
		"%s: derived slots clear 3:1 on every ground and stay distinct",
		(_, theme) => {
			const colors = chartColorsFor(theme);
			expect(colors).toHaveLength(7);
			expect(colors[0]?.toLowerCase()).toBe(theme.colors.accent.toLowerCase());
			const grounds = [
				theme.colors.canvas,
				theme.colors.surface,
				theme.colors["message-surface"],
			];
			for (const color of colors.slice(1))
				for (const ground of grounds)
					expect(contrastRatio(color, ground)).toBeGreaterThanOrEqual(3);
			// Distinct hues, not shades: every pair is clearly apart in ΔE00.
			for (let i = 0; i < colors.length; i++)
				for (let j = i + 1; j < colors.length; j++)
					expect(cvdDistance(colors[i] ?? "", colors[j] ?? "")).toBeGreaterThan(
						3,
					);
			// Memoised per catalogue entry.
			expect(chartColorsFor(theme)).toBe(colors);
		},
	);

	it("derives for a custom accent composition", () => {
		const colors = chartPalette({
			grounds: ["#1d1b17", "#26221c", "#2a261d"],
			accent: "#e0457b",
		});
		expect(colors[0]).toBe("#E0457B");
		for (const color of colors.slice(1))
			expect(contrastRatio(color, "#2a261d")).toBeGreaterThanOrEqual(3);
	});
});
