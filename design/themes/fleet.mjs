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
 * Palette id -> why it is withheld. Measured 2026-11-04 against the export at
 * the lock's ref. All four fail on roles the DESKTOP authors (not on anything
 * this repository derives) and on pairs only the phone's contract asserts — the
 * desktop's own contract does not claim `inkDim` on a wash, or `accent` text on
 * `rowSelected`, so these are not desktop defects so much as the phone holding
 * more pairs. The fix belongs upstream (or in a phone-side pair decision), so
 * they ship the day their values clear and this list is emptied.
 */
export const EXPECTED_WITHHELD = {
	catppuccinMocha: "ink-dim on success-wash measures 3.94 (< 4.5); the phone writes captions on its washes",
	tokyoNightStorm: "ink-dim on success-wash measures 4.45 (< 4.5)",
	duskfox: "accent on row-selected measures 4.43 (< 4.5): a link in the selected row",
	outrun: "accent-hover on row-selected measures 4.35 (< 4.5)",
};

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
