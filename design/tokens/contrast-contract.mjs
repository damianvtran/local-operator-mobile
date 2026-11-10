#!/usr/bin/env node
/**
 * The mobile contrast contract, executable.
 *
 *     node design/tokens/contrast-contract.mjs
 *
 * Reads ./tokens.json, recomputes every foreground x ground pair this system
 * permits, and asserts the floors in tokens.json § contrastFloors. Exits
 * non-zero on a violation. No dependencies, no build step, plain `node` >= 18.
 *
 * Adapted from `local-operator-site/docs/design-kit/contrast-contract.mjs`
 * (read 2026-09-29). The tables below are the contract and are SHARED in
 * spirit with the site's; what changed is the enumeration, because this app is
 * a phone client with different surfaces: it adds the message bubble, the
 * hovered and selected row states the desktop palette contract defines, and
 * the diff well, and it drops the marketing-only grounds the site carries
 * (`band`) along with its `island`, which the phone has no equivalent of.
 *
 * Why this file exists. The brand kit states ratios as prose, which means the
 * kit is true on the day it was written and unverifiable afterwards. A
 * hand-maintained table cannot notice that a token was nudged one step for
 * aesthetics. This can.
 *
 * What it does beyond a token-pair checker:
 *
 *   1. It asserts over COMPONENT TRIPLES (ground + fill + border + ink), not
 *      just token pairs, so a control whose fill and border both sit near its
 *      ground fails here instead of shipping as a box with no perceivable edge.
 *   2. It asserts the GROUND LADDER (canvas -> surface -> elevated, sunken
 *      below canvas) as lightness inequalities, because a palette can hold
 *      every contrast floor and still flatten into one grey slab.
 *   3. It asserts the MOBILE floors that are not contrast at all: the touch
 *      target minimums, the input font-size floor that stops iOS zooming on
 *      focus, and that no colour token is missing a theme.
 *   4. Every accepted sub-floor pair and every razor-thin margin is PINNED to
 *      its measured ratio. An exemption is not a mute button, and a 0.01
 *      margin is not a pass: change the token and the pinned value stops
 *      matching, so the decision is re-opened rather than silently absorbed.
 *
 * WHAT IT DOES NOT DO, because a check's scope is itself a claim. It asserts
 * over the pairs and triples ENUMERATED BELOW, and that enumeration is a human
 * judgement about what the system permits — the part most likely to be wrong.
 * A pair nobody listed passes silently, which is indistinguishable in the
 * output from a pair that passes because it is legible. Two consequences worth
 * acting on:
 *
 *   - Adding a component means adding a row to CONTROLS. Green output on an
 *     unlisted component is not evidence about that component.
 *   - It computes sRGB ratios from flat hexes. It cannot see an alpha
 *     composite, a gradient, an image under text, or a colour a platform
 *     picked for itself (a native sheet's own ground, a system keyboard). Those
 *     need a human and a screenshot.
 *   - It measures TOKENS. Whether a component paints the role its row names is a
 *     question about code, answered per rendered node by the frame audit's U-02 —
 *     which has one known limit of its own: a control's `::placeholder` is a
 *     pseudo-element, so U-02 reads the field's stand-in copy rather than the
 *     pseudo-element (proxy coverage, named in `tools/audit/checks.ts` under
 *     U-02). The rows below are the direct assertion; the frame row is the check
 *     that the field actually uses them.
 *
 * Do not read a clean run as "the design system is accessible". Read it as
 * "every pairing we have written down still holds".
 */

import { readFileSync } from "node:fs";

import { EXPECTED_WITHHELD, fleetReport } from "../themes/fleet.mjs";
import { composite, ratio } from "./colour-math.mjs";
import { checkPalette, FLOOR } from "./palette-rules.mjs";

/* ---- 1. the floors, from tokens.json § contrastFloors ------------------- */

/* Keyed by platform, matching tokens.json § size.touchTarget: iOS asks 44pt,
   Material asks 48dp. Both are floors rather than targets. */
const TOUCH_FLOOR = { ios: 44, android: 48 };
const INPUT_FONT_PX = 16;


/* ---- 2. colour maths: `colour-math.mjs`; the pair tables: `palette-rules.mjs` -- */

/* ---- 3. load the palette for one theme --------------------------------- */

const TOKENS = JSON.parse(
	readFileSync(new URL("./tokens.json", import.meta.url), "utf8"),
);

/* Tokens are either { light, dark, role } or { value, role } for the
   theme-invariant few (the scrim, the photographic ring). */
const load = (theme) => {
	const out = {};
	for (const [groupName, group] of Object.entries(TOKENS.color)) {
		/* The `$`-prefixed group keys are metadata, not token groups; a bare
		   `Object.values` walk included `color.$note` and iterated its
		   CHARACTERS, which reported 428 phantom tokens. */
		if (groupName.startsWith("$") || typeof group !== "object") continue;
		for (const [name, t] of Object.entries(group))
			if (!name.startsWith("$")) out[name] = t.value ?? t[theme];
	}
	return out;
};

/* ---- 4. the permitted surfaces, text pairs and component triples --------
   live in `palette-rules.mjs`, shared with the fleet run below (§ 12). ---- */

/* Pairs the system explicitly does NOT permit, each pinned to the ratio that
   is the reason. Asserted as a negative: if a token change makes one of these
   legal, the prohibition should be reconsidered, so the script says so. A
   `"#hex"` foreground is a literal rather than a token. */
const FORBIDDEN = [
	[
		"#ffffff",
		"accent",
		"dark",
		2.16,
		"white ink on the lit dark green — the one hard prohibition in the system, inherited from the site kit where it is the most common contrast bug in green palettes. The dark accent is a FILL here, never a ground for white text: the dark ramp's `on-accent` is near-black and measures 8.58",
	],
	[
		"on-accent",
		"accent-muted",
		"light",
		1.26,
		"the solid tinted fill takes `ink` or an accent step, never the accent's own ink. `accent-active` on it is 7.69",
	],
	[
		"on-accent",
		"accent-muted",
		"dark",
		1.49,
		"as above. `accent-hover` on it is 6.69",
	],
];

/* ---- 6. accepted sub-floor pairs, each pinned to its ratio ------------- */

const EXCEPTIONS = [
	/* `ink-disabled`'s text on every ground, both themes. An inactive control's
	   text is exempt under SC 1.4.3, and the pins are what keep it honest:
	   these are the values measured on 2026-09-29. */
	...[["light", { canvas: 2.58, surface: 2.76, elevated: 2.96, sunken: 2.42, "message-surface": 2.91, "row-hover": 2.55, "row-selected": 2.43 }],
		["dark", { canvas: 2.37, surface: 2.16, elevated: 1.99, sunken: 2.5, "message-surface": 2.08, "row-hover": 2.0, "row-selected": 1.92 }]]
		.flatMap(([theme, pairs]) =>
			Object.entries(pairs).map(([g, r]) => ({
				pair: ["ink-disabled", g],
				theme,
				ratio: r,
				why: "SC 1.4.3 exempts an inactive control's text",
			})),
		),
];

/* ---- 7. watched margins ------------------------------------------------ */

/* Pairs that PASS, by less than 0.05. They are not exceptions — they are the
   decisions most likely to be quietly lost by a one-step nudge, so they are
   pinned as exact values. If one of these changes, the nudge is not "a
   tweak": it flips a pair across a floor and the reason has to be re-read.
   This list is deliberately short and is the only place the file is brittle
   on purpose. */
const WATCHED = [
	{
		pair: ["accent", "sunken"],
		theme: "light",
		ratio: 4.51,
		why: "the link colour in a well, clearing 4.5 by 0.01. The site's kit solved this by forbidding the pair outright (it measured 4.49) and requiring `accent-hover` (6.14) in a well. This app's accent is the desktop palette's, which measures 4.51, so the pair is legal — but a well should still carry `accent-hover`, and a change that takes this to 4.49 must be treated as a prohibition to design around rather than a rounding error",
	},
	{
		pair: ["success", "sunken"],
		theme: "light",
		ratio: 4.52,
		why: "semantic text in a well, clearing by 0.02. Same argument as above: the well takes the ink ramp, and the semantic colour goes on the glyph",
	},
];

/* ---- 8. run ----------------------------------------------------------- */

let failures = 0;
let checks = 0;
const log = [];

const fail = (msg) => {
	failures += 1;
	log.push(`FAIL  ${msg}`);
};

/** An exception matches when the pair, theme and measured ratio all agree.
    A drifted ratio is a failure, not a silent pass. */
const exception = (fg, bg, theme, got) =>
	EXCEPTIONS.find(
		(e) =>
			e.pair[0] === fg &&
			e.pair[1] === bg &&
			e.theme === theme &&
			e.ratio === got,
	);

const watched = (fg, bg, theme) =>
	WATCHED.find(
		(w) => w.pair[0] === fg && w.pair[1] === bg && w.theme === theme,
	);

const assertPair = (fg, bg, floor, theme, P, label) => {
	checks += 1;
	const got = ratio(P[fg], P[bg]);
	if (got >= floor) {
		const w = watched(fg, bg, theme);
		if (w && got !== w.ratio)
			fail(
				`${theme}  WATCHED ${label}: ${fg} on ${bg} was pinned at ${w.ratio} and is now ${got.toFixed(2)} — ${w.why}`,
			);
		return got;
	}
	if (exception(fg, bg, theme, got)) return got;
	const drift = EXCEPTIONS.find(
		(e) => e.pair[0] === fg && e.pair[1] === bg && e.theme === theme,
	);
	fail(
		`${theme}  ${label}: ${fg} on ${bg} = ${got.toFixed(2)} < ${floor}` +
			(drift
				? `  (an exception is documented at ${drift.ratio} — the value moved, re-read the reason)`
				: ""),
	);
	return got;
};

/* ---- 9. structural assertions, which are not about colour ------------- */

{
	/* Every colour token must resolve in both themes, or the token is a hole
	   a component falls into at runtime with no error. */
	const light = load("light");
	const dark = load("dark");
	for (const name of Object.keys(light))
		if (!light[name] || !dark[name])
			fail(`token ${name} does not resolve in both themes`);

	/* The touch floors. A control below them is a defect no screenshot shows. */
	const t = TOKENS.size?.touchTarget;
	if (!t) fail("tokens.json has no size.touchTarget");
	else {
		checks += 1;
		for (const [k, floor] of Object.entries(TOUCH_FLOOR)) {
			const v = Number.parseFloat(t[k]);
			if (!(v >= floor))
				fail(`size.touchTarget.${k} = ${t[k]} < ${floor} — the ${k === "ios" ? "iOS 44pt" : "Android 48dp"} minimum`);
		}
		/* The smallest control in the ramp must still be able to reach the
		   floor with slop; a 32-high control with no hit-area padding is a
		   target a thumb misses. */
		checks += 1;
		const sm = TOKENS.size?.controls?.sm ?? {};
		if (!(sm.minTouch >= TOUCH_FLOOR.ios))
			fail(`size.controls.sm.minTouch = ${sm.minTouch} < ${TOUCH_FLOOR.ios} — the dense control cannot reach the iOS floor with slop`);
	}

	/* The input font-size floor. Below 16px iOS zooms the page on focus, which
	   moves the whole layout under the user's thumb. The composer's field is
	   the `body` step, so that step carries the floor. */
	checks += 1;
	const inputPx = Number.parseFloat(TOKENS.type?.steps?.body?.size ?? "0");
	if (!(inputPx >= INPUT_FONT_PX))
		fail(`type.steps.body = ${inputPx}pt < ${INPUT_FONT_PX} — iOS zooms on focus below this, and the composer's field is set at this step`);

	/* Safe areas must be declared for both platforms, and bottom alone is not
	   enough: a phone in landscape has a left and right inset. */
	checks += 1;
	const insets = TOKENS.safeArea?.insets ?? {};
	for (const platform of ["ios", "android"]) {
		checks += 1;
		if (!insets[platform]?.length)
			fail(`safeArea.insets declares nothing for ${platform}`);
	}
	checks += 1;
	for (const edge of ["top", "bottom", "left", "right"])
		if (!(insets.ios ?? []).includes(edge) || !(insets.android ?? []).includes(edge))
			fail(`safeArea.insets covers nothing for the ${edge} edge on both platforms — landscape has four edges`);

}

/* ---- 10. the colour assertions ---------------------------------------- */

for (const theme of ["light", "dark"]) {
	const P = load(theme);
	checkPalette(theme, P, {
		pair: assertPair,
		fail,
		tick: () => {
			checks += 1;
		},
	});

	/* the negative assertions */
	for (const [fg, bg, t, pinned, why] of FORBIDDEN) {
		if (t !== theme) continue;
		checks += 1;
		const got = ratio(fg.startsWith("#") ? fg : P[fg], P[bg]);
		if (got !== pinned)
			fail(
				`${theme}  forbidden pair ${fg} on ${bg} was pinned at ${pinned} and is now ` +
					`${got.toFixed(2)} — the prohibition (${why}) needs re-reading.`,
			);
	}
}

/* ---- 11. report ------------------------------------------------------- */

for (const line of log) console.log(line);

console.log(`\n${checks} assertions over 2 themes.`);
console.log(
	`${EXCEPTIONS.length} accepted sub-floor pairs, each pinned to its ratio:`,
);
for (const e of EXCEPTIONS)
	console.log(
		`  ${e.ratio.toFixed(2)}  ${e.theme.padEnd(5)} ${e.pair[0]} on ${e.pair[1]}` +
			(e.why === "as above" ? "" : `\n         ${e.why}`),
	);
console.log(
	`${WATCHED.length} watched pairs, passing by under 0.05 and pinned so a nudge re-opens them:`,
);
for (const w of WATCHED)
	console.log(`  ${w.ratio.toFixed(2)}  ${w.theme.padEnd(5)} ${w.pair[0]} on ${w.pair[1]}`);
console.log(
	`${FORBIDDEN.length} pairs prohibited outright, pinned so a token change re-opens them:`,
);
for (const [fg, bg, t, pinned, why] of FORBIDDEN)
	console.log(`  ${pinned.toFixed(2)}  ${t.padEnd(5)} ${fg} on ${bg} — ${why}`);

/* The scoped pair the `panel-edge` role was derived for, in full — printed so a
   run shows the measurement rather than only meaning it (an unmeasured token is
   the defect class this file exists for). */
console.log(
	"The overlay panel's edge (scoped: reads against a scrim, never a control boundary):",
);
for (const theme of ["light", "dark"]) {
	const P = load(theme);
	const ground = composite(P.scrim, P.canvas);
	console.log(
		`  ${ratio(P["panel-edge"], ground).toFixed(2)}  ${theme.padEnd(5)} panel-edge on the scrim ground (${ground}) — on the panel itself: ${ratio(P["panel-edge"], P.elevated).toFixed(2)}`,
	);
}

/* ---- 12. the fleet: every desktop palette the phone can ship ----------

   The same per-palette rules (`palette-rules.mjs`) over each palette in
   `design/themes/desktop-palettes.json`, after the phone's 14 derived roles
   are solved (`design/themes/derive.mjs`). A failing palette is WITHHELD: the
   generator leaves it out of the app. The withheld set is pinned in
   `design/themes/fleet.mjs` (EXPECTED_WITHHELD), so it cannot change in either
   direction without this file going red. Every palette and its verdict is
   printed: this output IS the gate's evidence. */
console.log("\nThe fleet — every desktop palette, derived and judged by the same rules:");
const fleet = fleetReport();
let fleetChecks = 0;
const withheld = [];
for (const entry of fleet) {
	fleetChecks += entry.checks;
	const verdict = entry.failures.length ? "WITHHELD" : "ships";
	console.log(
		`  ${verdict.padEnd(8)} ${entry.id.padEnd(22)} ${entry.mode.padEnd(5)} ${String(entry.checks).padStart(4)} assertions` +
			(entry.failures.length ? `, ${entry.failures.length} failing` : ""),
	);
	for (const f of entry.failures) console.log(`             - ${f}`);
	if (entry.failures.length) withheld.push(entry.id);
}
const pinned = Object.keys(EXPECTED_WITHHELD);
for (const id of withheld)
	if (!pinned.includes(id))
		fail(`fleet  ${id} now fails and would be withheld silently — fix the derivation, or pin it in design/themes/fleet.mjs EXPECTED_WITHHELD with the reason`);
for (const id of pinned) {
	if (!fleet.some((entry) => entry.id === id))
		fail(`fleet  ${id} is pinned as withheld but is not in the export`);
	else if (!withheld.includes(id))
		fail(`fleet  ${id} is pinned as withheld but now passes — remove it from EXPECTED_WITHHELD so it ships`);
}
const shipped = fleet.length - withheld.length;
console.log(
	`${fleet.length} palettes, ${fleetChecks} assertions: ${shipped} ship (${fleet.filter((e) => !e.failures.length && e.mode === "dark").length} dark, ${fleet.filter((e) => !e.failures.length && e.mode === "light").length} light), ${withheld.length} withheld${withheld.length ? `: ${withheld.join(", ")}` : ""}.`,
);

if (failures) {
	console.error(
		`\n${failures} violation(s). See design/tokens/tokens.json § contrastFloors for the floors.`,
	);
	process.exit(1);
}
console.log("\nContrast contract holds.");
