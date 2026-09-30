import { describe, expect, it } from "vitest";

import {
	COLOR_ROLES,
	PALETTE,
	resolveColor,
	resolveTheme,
} from "@/ui/tokens.gen";

/**
 * The token contract, as tests.
 *
 * `design/tokens/contrast-contract.mjs` already recomputes every permitted
 * foreground/ground pair from the token file and fails on a violation, so
 * contrast itself is not re-derived here. What these tests pin is the part the
 * generator could get wrong on the way from that file into the app: which theme a
 * preference resolves to, whether a role resolves to its OWN theme's value, and
 * the one pair the kit prohibits outright.
 */

/** WCAG 2.x relative-luminance contrast, on sRGB hex. Same method as the
 * contract script (`tokens.json § $meta.ratioMethod`), written small so a
 * prohibition can be asserted as a negative rather than quoted. */
const luminance = (hex: string): number => {
	const value = hex.replace("#", "");
	const channels = [0, 2, 4].map((offset) => {
		const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (foreground: string, background: string): number => {
	const a = luminance(foreground);
	const b = luminance(background);
	const [light, dark] = a > b ? [a, b] : [b, a];
	return (light + 0.05) / (dark + 0.05);
};

describe("theme resolution", () => {
	it("uses the preference whenever it names a theme", () => {
		expect(resolveTheme("light", "dark")).toBe("light");
		expect(resolveTheme("dark", "light")).toBe("dark");
	});

	it("follows the OS appearance only for `system`", () => {
		expect(resolveTheme("system", "dark")).toBe("dark");
		expect(resolveTheme("system", "light")).toBe("light");
	});

	it("treats a missing OS appearance as light rather than as no theme", () => {
		// A platform that reports neither scheme, or reports it after first paint,
		// must still render: an `undefined` theme would leave every role unresolved.
		expect(resolveTheme("system", null)).toBe("light");
		expect(resolveTheme("system", undefined)).toBe("light");
	});
});

describe("the generated palette", () => {
	it("defines every role in both themes", () => {
		for (const role of COLOR_ROLES) {
			// Six digits, or eight where the role carries its own alpha: an overlay
			// (`scrim`) is the one family that does, and it is theme-invariant.
			expect(PALETTE.light[role], `light.${role}`).toMatch(
				/^#[0-9a-f]{6}([0-9a-f]{2})?$/,
			);
			expect(PALETTE.dark[role], `dark.${role}`).toMatch(
				/^#[0-9a-f]{6}([0-9a-f]{2})?$/,
			);
		}
	});

	it("resolves a role to its own theme's value, not the other's", () => {
		// The failure this catches is a real one: an earlier generator emitted the
		// LIGHT value inside the dark block as well, which captured a light sheet
		// for both themes and looked like a styling bug rather than a token one.
		expect(resolveColor("canvas", "light")).not.toBe(
			resolveColor("canvas", "dark"),
		);
		expect(resolveColor("ink", "light")).not.toBe(resolveColor("ink", "dark"));
		// The palette is the token file's own values, so a spot check pins the
		// direction: light paper is light, dark paper is dark.
		expect(luminance(resolveColor("canvas", "light"))).toBeGreaterThan(
			luminance(resolveColor("canvas", "dark")),
		);
	});

	it("keeps ink legible on every ground in both themes", () => {
		const grounds = ["canvas", "surface", "elevated", "sunken"] as const;
		for (const theme of ["light", "dark"] as const) {
			for (const ground of grounds) {
				// `body` text is `ink`; 4.5:1 is the floor the kit holds itself to for
				// body copy, and it is asserted per ground because a ground the kit
				// forgot is exactly the missing pair the contract script would report.
				expect(
					contrast(resolveColor("ink", theme), resolveColor(ground, theme)),
					`ink on ${ground} (${theme})`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("prohibits white on the dark accent, and ships the ink that works", () => {
		// The most common contrast bug in a green palette, and the one pair the kit
		// calls out as asserted negative: white on the dark accent measures 2.16:1.
		expect(contrast("#ffffff", resolveColor("accent", "dark"))).toBeLessThan(3);
		expect(
			contrast(
				resolveColor("on-accent", "dark"),
				resolveColor("accent", "dark"),
			),
		).toBeGreaterThanOrEqual(4.5);
	});
});
