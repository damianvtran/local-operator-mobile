import { describe, expect, it } from "vitest";
import { THEMES } from "@/ui/tokens.gen";
import { SWITCH_ROLES, switchGeometry, switchRoles } from "@/ui/variants";
import { deltaE, ratio } from "../../design/tokens/colour-math.mjs";

/**
 * The switch's colours, pinned against EVERY shipped palette, because a reader
 * can pick any of them.
 *
 * Two geometries, because the platforms draw the switch differently:
 *  - `inset` (iOS): the thumb sits INSIDE the track, so the thumb is only ever
 *    seen against the track, and the track is the shape on the page.
 *  - `overhang` (react-native-web, Android): the thumb is taller than the track
 *    and its edge sits ON THE PAGE. Review round 1 (Q1/D1): the first fix's
 *    dark thumbs measured 1.00–1.28:1 against the dark page there, so a dark
 *    switch read as a bar with a notch and state was left to track colour alone.
 */

/** The grounds a switch row sits on: Settings (canvas), a card (surface) and
 *  the drawer's View options sheet (elevated). */
const PAGES = ["canvas", "surface", "elevated"] as const;
const PALETTES = THEMES.map(
	(theme) => [theme.id, theme.colors as Record<string, string>] as const,
);
const hex = (c: Record<string, string>, role: string): string =>
	c[role] as string;

/** Any step of the accent ramp: `accent`, `accent-muted`, `accent-border`… */
const ACCENT_ROLE = /^accent/;
/** A neutral ink: `ink`, `ink-muted`, `ink-dim`. */
const INK_ROLE = /^ink(-muted|-dim)?$/;

describe("switch geometry per platform", () => {
	it("iOS draws the thumb inside the track; web and Android overhang it", () => {
		expect(switchGeometry("ios")).toBe("inset");
		expect(switchGeometry("android")).toBe("overhang");
		expect(switchGeometry("web")).toBe("overhang");
	});
});

describe("switch roles", () => {
	it("on is always an accent role and off a neutral one", () => {
		for (const geometry of ["inset", "overhang"] as const) {
			expect(SWITCH_ROLES[geometry].on.track).toMatch(ACCENT_ROLE);
			expect(SWITCH_ROLES[geometry].off.track).not.toMatch(ACCENT_ROLE);
			expect(SWITCH_ROLES[geometry].off.thumb).not.toMatch(ACCENT_ROLE);
		}
		// Where the thumb is what the reader sees, the THUMB carries the state:
		// an accent disc on, a neutral ink disc off.
		expect(SWITCH_ROLES.overhang.on.thumb).toMatch(ACCENT_ROLE);
		expect(SWITCH_ROLES.overhang.off.thumb).toMatch(INK_ROLE);
	});

	it("switchRoles picks the state, and disabled overrides both states", () => {
		expect(switchRoles("overhang", true, false)).toEqual(
			SWITCH_ROLES.overhang.on,
		);
		expect(switchRoles("overhang", false, false)).toEqual(
			SWITCH_ROLES.overhang.off,
		);
		expect(switchRoles("inset", true, false)).toEqual(SWITCH_ROLES.inset.on);
		expect(switchRoles("inset", false, false)).toEqual(SWITCH_ROLES.inset.off);
		for (const geometry of ["inset", "overhang"] as const)
			for (const value of [true, false])
				expect(switchRoles(geometry, value, true)).toEqual(
					SWITCH_ROLES.disabled,
				);
	});

	/* Q3: on the web a disabled switch had become byte-identical to an enabled
	 * one (an explicit thumb overrides react-native-web's own disabled grey).
	 * Disabled is a colour step, never an opacity (components.md § 0): the kit's
	 * disabled ink on a decorative track, exempt from contrast (SC 1.4.11). */
	it("disabled uses the kit's disabled ink, distinct from every enabled role", () => {
		expect(SWITCH_ROLES.disabled.thumb).toBe("ink-disabled");
		const enabled = (["inset", "overhang"] as const).flatMap((g) => [
			SWITCH_ROLES[g].on,
			SWITCH_ROLES[g].off,
		]);
		for (const roles of enabled) {
			expect(roles.thumb).not.toBe(SWITCH_ROLES.disabled.thumb);
			expect(roles.track).not.toBe(SWITCH_ROLES.disabled.track);
		}
	});
});

describe.each(PALETTES)("%s", (_id, c) => {
	it("inset (iOS): thumb clears 3:1 on its track and the track clears 3:1 on the page, both states", () => {
		for (const state of ["on", "off"] as const) {
			const { track, thumb } = SWITCH_ROLES.inset[state];
			expect(
				ratio(hex(c, thumb), hex(c, track)),
				`${state} thumb/track`,
			).toBeGreaterThanOrEqual(3);
			for (const page of PAGES)
				expect(
					ratio(hex(c, track), hex(c, page)),
					`${state} track/${page}`,
				).toBeGreaterThanOrEqual(3);
		}
	});

	it("overhang (web, Android): thumb clears 3:1 on its track AND on the page, both states", () => {
		for (const state of ["on", "off"] as const) {
			const { track, thumb } = SWITCH_ROLES.overhang[state];
			expect(
				ratio(hex(c, thumb), hex(c, track)),
				`${state} thumb/track`,
			).toBeGreaterThanOrEqual(3);
			for (const page of PAGES)
				expect(
					ratio(hex(c, thumb), hex(c, page)),
					`${state} thumb/${page}`,
				).toBeGreaterThanOrEqual(3);
		}
	});

	/* On and off are told apart by the thumb's SIDE (not colour) and, as well,
	 * by a visible colour change in the part the reader sees: never two
	 * near-identical pictures at opposite ends (ΔE76 ≥ 8 is a clearly visible
	 * difference; the fleet's smallest is ≈ 9). */
	it("on and off differ visibly in each geometry, not by position alone", () => {
		for (const geometry of ["inset", "overhang"] as const) {
			const { on, off } = SWITCH_ROLES[geometry];
			const change = Math.max(
				deltaE(hex(c, on.thumb), hex(c, off.thumb)),
				deltaE(hex(c, on.track), hex(c, off.track)),
			);
			expect(change, geometry).toBeGreaterThanOrEqual(8);
		}
	});

	it("disabled reads dimmer than an enabled off thumb", () => {
		for (const geometry of ["inset", "overhang"] as const)
			expect(
				deltaE(
					hex(c, SWITCH_ROLES.disabled.thumb),
					hex(c, SWITCH_ROLES[geometry].off.thumb),
				),
				geometry,
			).toBeGreaterThanOrEqual(8);
	});
});
