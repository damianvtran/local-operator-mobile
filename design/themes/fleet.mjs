/**
 * The fleet verdict: which desktop palettes the phone ships.
 *
 * Every palette in `desktop-palettes.json` is derived (`derive.mjs`) and then
 * run through the SAME per-palette rules as the brand themes
 * (`design/tokens/palette-rules.mjs`), plus the scoped overlay-edge pair. A
 * palette with any failure is WITHHELD: the generator leaves it out of the app,
 * and the contrast contract names it. Record § 5: "The floors are the
 * curation, not a hand-picked subset … if a derived role cannot be solved for
 * a palette, that palette is withheld by the gate and listed in the PR, not
 * silently shipped."
 *
 * `EXPECTED_WITHHELD` pins the withheld set so it cannot change silently in
 * either direction: a palette that starts failing turns the contract red until
 * someone decides (fix the derivation, or add it here with a reason), and a
 * palette that starts passing turns it red until it is removed — the same
 * discipline as the contract's EXCEPTIONS and WATCHED pins.
 *
 * One consumer per side: `scripts/build-theme.ts` reads `shippedPalettes()` to
 * emit `tokens.gen.ts`, and `contrast-contract.mjs` reads `fleetReport()` to
 * print and gate. Plain `node`, no dependencies.
 */
import { readFileSync } from "node:fs";

import { composite, ratio } from "../tokens/colour-math.mjs";
import { checkPalette, EXEMPT_INK, FLOOR } from "../tokens/palette-rules.mjs";
import { derivePalette } from "./derive.mjs";

/**
 * Palette id -> why it is withheld. EMPTY as of 2026-11-05: all 59 palettes the
 * desktop ships now pass every per-palette rule on the phone.
 *
 * It was four (catppuccinMocha, tokyoNightStorm, duskfox, outrun), each failing
 * ONLY on a pair the phone asserts and the desktop does not — `ink-dim` on a
 * semantic wash, and the accent ramp on the selected row. Those failures were
 * 3.94-4.45 against a 4.5 floor, on a GROUND whose job is to carry an ink, and
 * `derive.mjs`'s `ADAPTED_GROUNDS` policy clears them with a bounded (<6 L*),
 * hue-preserving move that leaves the canvas, the ladder, the bubble and every
 * ink byte-identical (design round 1, D164-1). The four survivors of that change
 * are the four palettes, not a subset of them: the table above records what the
 * values were, so this entry can be re-derived rather than remembered.
 *
 * The pin still does its two jobs: a palette that starts failing turns the
 * contract red until someone decides, and a palette that starts passing turns it
 * red until it is removed from this list. With the list empty, a regression
 * cannot hide behind an expected-withheld entry; the gate simply names it.
 */
export const EXPECTED_WITHHELD = {};

const SOURCE = new URL("./desktop-palettes.json", import.meta.url);

/** The desktop export, in the desktop's `definitions` (family) order. */
export const desktopPalettes = () =>
	JSON.parse(readFileSync(SOURCE, "utf8")).palettes;

/** Run one derived palette through every per-palette rule. Exported for the
 *  gate's negative control (`scripts/design/theme-fleet.test.ts`). */
export const judge = (derived) => {
	const P = derived.colors;
	const theme = derived.mode;
	const failures = derived.unsolved.map(
		(u) => `${u.role} could not be derived: ${u.why}`,
	);
	let checks = 0;
	const fail = (msg) => failures.push(msg);
	const pair = (fg, bg, floor, _theme, colours, label) => {
		checks += 1;
		/* The brand run pins `ink-disabled`'s sub-floor ratios one by one; across
		 * 59 palettes that would be 413 pins of a value SC 1.4.3 exempts anyway,
		 * so the fleet run applies the exemption by category instead. */
		if (EXEMPT_INK.has(fg)) return;
		const got = ratio(colours[fg], colours[bg]);
		if (got < floor) fail(`${label}: ${fg} on ${bg} = ${got.toFixed(2)} < ${floor}`);
	};
	checkPalette(theme, P, {
		pair,
		fail,
		tick: () => {
			checks += 1;
		},
	});
	/* The overlay panel's edge over the scrim, as the brand run asserts it
	 * (contrast-contract.mjs § 10): against the dimmed ground in both modes, and
	 * against its own panel in dark, where the stroke is the whole read. */
	checks += 1;
	const scrimGround = composite(
		P.scrim.length === 9 ? P.scrim : `${P.scrim}ff`,
		P.canvas,
	);
	const edgeOnScrim = ratio(P["panel-edge"], scrimGround);
	if (edgeOnScrim < FLOOR.nonText)
		fail(`panel-edge on the scrim ground (${scrimGround}) = ${edgeOnScrim.toFixed(2)} < ${FLOOR.nonText}`);
	if (theme === "dark") {
		checks += 1;
		const onPanel = ratio(P["panel-edge"], P.elevated);
		if (onPanel < FLOOR.nonText)
			fail(`panel-edge on elevated = ${onPanel.toFixed(2)} < ${FLOOR.nonText}`);
	}
	return { checks, failures };
};

/** Every palette, derived and judged, in family order. */
export const fleetReport = () =>
	desktopPalettes().map((desktop) => {
		const derived = derivePalette(desktop);
		return { ...derived, ...judge(derived) };
	});

/** The palettes the app ships: every one with no failure. */
export const shippedPalettes = () =>
	fleetReport().filter((entry) => entry.failures.length === 0);
