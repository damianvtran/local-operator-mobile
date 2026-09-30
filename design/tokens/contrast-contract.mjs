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
 *
 * Do not read a clean run as "the design system is accessible". Read it as
 * "every pairing we have written down still holds".
 */

import { readFileSync } from "node:fs";

/* ---- 1. the floors, from tokens.json § contrastFloors ------------------- */

const FLOOR = { text: 4.5, nonText: 3.0 };
/* Keyed by platform, matching tokens.json § size.touchTarget: iOS asks 44pt,
   Material asks 48dp. Both are floors rather than targets. */
const TOUCH_FLOOR = { ios: 44, android: 48 };
const INPUT_FONT_PX = 16;

/* `ink-disabled` is the only exempt foreground (SC 1.4.3, inactive control),
   and a disabled control's boundary is exempt under SC 1.4.11 for the same
   reason. Nothing else is exempt by category — everything else is declared
   below with a ratio and a reason. */
const EXEMPT_INK = new Set(["ink-disabled"]);

/* ---- 2. WCAG 2.x relative luminance and CIE L* -------------------------- */

const parse = (hex) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

const lum = (hex) => {
	const [r, g, b] = parse(hex).map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
	return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

/** CIE L*, used only for the ground ladder. sRGB -> linear -> Y -> L*. */
const lstar = (hex) => {
	const [r, g, b] = parse(hex).map((c) =>
		c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y;
};

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

/* ---- 4. the permitted surfaces and text pairs -------------------------- */

/* The seven grounds any text may sit on. `sunken` is in the list; the pairs
   that may not use it are named in FORBIDDEN below. `message-surface` is the
   user bubble's own ground and `row-hover` / `row-selected` are the two row
   states, because a list row is where a phone user reads most of the app. */
const GROUNDS = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"message-surface",
	"row-hover",
	"row-selected",
];

/** Every foreground x ground pair the system permits, as [ink, ground][]. */
const textPairs = () => {
	const p = [];
	const on = (fg, grounds) => grounds.forEach((g) => p.push([fg, g]));

	/* The ink ramp carries prose on every ground. */
	on("ink", GROUNDS);
	on("ink-muted", GROUNDS);
	on("ink-dim", GROUNDS);

	/* Accent is the link colour and the primary fill. Permitted on every
	   ground INCLUDING the well — see WATCHED for the 0.01 margin that makes
	   that the tightest decision in the file. */
	on("accent", GROUNDS);
	on("accent-hover", GROUNDS);
	on("accent-alt", GROUNDS);

	/* Semantic text on a page ground, and on its own wash. */
	for (const s of ["success", "warning", "danger", "info"]) {
		on(s, GROUNDS);
		p.push([s, `${s}-wash`]);
	}

	/* The diff well: the three diff inks and the context ink, on the code
	   well's ground and on their own tinted line grounds. A diff is read for
	   minutes at a time and is the densest text in the app. */
	for (const fg of ["diff-add", "diff-remove", "diff-hunk", "diff-context"])
		for (const g of ["sunken", "elevated", "surface"]) p.push([fg, g]);
	p.push(["diff-add", "diff-add-surface"]);
	p.push(["diff-remove", "diff-remove-surface"]);
	p.push(["diff-hunk", "diff-hunk-surface"]);
	p.push(["diff-context", "diff-add-surface"]);
	p.push(["diff-context", "diff-remove-surface"]);

	/* Ink on the tinted fills. `ink-dim` IS permitted on the washes here,
	   unlike the site's kit, and that difference is a measurement rather than
	   a preference: this app's washes are the desktop palette's, and the
	   desktop's `inkDim` measures 5.40 (light) / 5.95 (dark) on `accentWash`
	   where the site's own dim ink measured 4.24 and had to be forbidden. */
	for (const fill of [
		"accent-wash",
		"success-wash",
		"warning-wash",
		"danger-wash",
		"info-wash",
	]) {
		p.push(["ink", fill]);
		p.push(["ink-dim", fill]);
	}
	p.push(["ink", "accent-muted"]);
	p.push(["accent-active", "accent-muted"]); // light badge ink
	p.push(["accent-hover", "accent-muted"]); // dark badge ink

	/* The primary button's ink on all three accent fills. */
	for (const fill of ["accent", "accent-hover", "accent-active"])
		p.push(["on-accent", fill]);

	return p;
};

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

/* ---- 5. component triples --------------------------------------------- */

/* A control is legal on a ground when its ink clears 4.5:1 against its own
   fill AND its boundary — fill-vs-ground OR border-vs-ground, whichever is
   stronger — clears 3:1. `fill: null` means transparent, so the ground itself
   is the fill. `boundary: false` drops the boundary assertion (SC 1.4.11
   binds components and required content, not decorative labels); those rows
   still assert their ink.

   Rows mirror docs/design/components.md: this table and that document fail
   together or pass together. */
const CONTROLS = [
	/* Button, components.md § 2. */
	{ id: "button/primary", fill: "accent", border: null, ink: "on-accent" },
	{ id: "button/primary pressed", fill: "accent-active", border: null, ink: "on-accent" },
	{ id: "button/secondary", fill: "surface", border: "border-control", ink: "ink" },
	{ id: "button/outline", fill: null, border: "border-control", ink: "ink" },
	{ id: "button/ghost", fill: null, border: null, ink: "ink-muted", boundary: false },
	{ id: "button/danger", fill: "danger-wash", border: "danger-border", ink: "danger" },

	/* The disabled rows. Both assertions are exempt; listed so the exemption
	   is visible in the output rather than absent from it. */
	{ id: "button/primary disabled", fill: "sunken", border: null, ink: "ink-disabled", boundary: false },
	{ id: "button/secondary disabled", fill: "surface", border: "hairline", ink: "ink-disabled", boundary: false },

	/* Input and textarea, components.md § 4. */
	{ id: "input/rest", fill: "surface", border: "border-control", ink: "ink" },
	{ id: "input/placeholder", fill: "surface", border: "border-control", ink: "ink-dim" },
	{ id: "input/focused", fill: "surface", border: "accent", ink: "ink" },
	{ id: "input/invalid", fill: "surface", border: "danger", ink: "ink" },
	{ id: "input/disabled", fill: "sunken", border: "hairline", ink: "ink-disabled", boundary: false },

	/* List row — the session row, the transcript row, the roster row. */
	{ id: "row/rest", fill: "surface", border: null, ink: "ink", boundary: false },
	{ id: "row/pressed", fill: "elevated", border: null, ink: "ink", boundary: false },
	{ id: "row/selected", fill: "row-selected", border: null, ink: "ink", boundary: false },

	/* Chip and badge. A chip IS a control (it opens a sheet), so its boundary
	   is asserted; a badge is not, so it is not.

	   A chip's grounds are stated rather than defaulted, and the restriction is
	   a real finding from running this script: on `row-selected` the dark
	   selected chip's fill measures 1.06 against the row and its border 2.88,
	   so a selected chip sitting on a selected row has NO edge a low-vision
	   reader can resolve. That is not a token defect to be papered over with an
	   exception — it is the wrong ground for a chip. A chip lives on the page
	   (`canvas`), on a card (`surface`) or inside a sheet (`elevated`); the row
	   states belong to the list's own row, which is the control there. */
	{ id: "chip/rest", fill: "surface", border: "border-control", ink: "ink-muted", grounds: ["canvas", "surface", "elevated"] },
	{ id: "chip/selected", fill: "accent-muted", border: "accent-border", ink: "accent-hover", themes: ["dark"], grounds: ["canvas", "surface", "elevated"] },
	{ id: "chip/selected", fill: "accent-muted", border: "accent-border", ink: "accent-active", themes: ["light"], grounds: ["canvas", "surface", "elevated"] },
	{ id: "badge/neutral", fill: "surface", border: "hairline", ink: "ink-dim", boundary: false },
	{ id: "badge/success", fill: "success-wash", border: "success-border", ink: "success", boundary: false },
	{ id: "badge/warning", fill: "warning-wash", border: "warning-border", ink: "warning", boundary: false },
	{ id: "badge/danger", fill: "danger-wash", border: "danger-border", ink: "danger", boundary: false },
	{ id: "badge/info", fill: "info-wash", border: "info-border", ink: "info", boundary: false },

	/* Card and sheet. A card is read as one block; its edge is decorative
	   (the fill is the boundary), but a SHEET leaves the flow and carries the
	   overlay shadow, so its edge is the shadow rather than a stroke. */
	{ id: "card/rest", fill: "surface", border: "hairline", ink: "ink", boundary: false },
	{ id: "sheet/panel", fill: "elevated", border: null, ink: "ink", boundary: false },

	/* Composer: the one 16px field in the app. */
	{ id: "composer/field", fill: "elevated", border: "border-control", ink: "ink" },
	{ id: "composer/send", fill: "accent", border: null, ink: "on-accent" },
	{ id: "composer/stop", fill: null, border: "danger-border", ink: "danger" },

	/* Pending card — the approval and the ask, the loudest thing on screen. */
	{ id: "pending/card", fill: "accent-wash", border: "accent", ink: "ink" },
	{ id: "pending/approve", fill: "accent", border: null, ink: "on-accent" },
	{ id: "pending/deny", fill: "danger-wash", border: "danger-border", ink: "danger" },

	/* Inline alert / degraded banner. A wash fill never carries a boundary of
	   its own (1.01-1.19:1), so the semantic border is the box's sole
	   boundary and 1.4.11 binds it. */
	{ id: "alert/error", fill: "danger-wash", border: "danger-border", ink: "ink" },
	{ id: "alert/warning", fill: "warning-wash", border: "warning-border", ink: "ink" },
	{ id: "alert/notice", fill: "surface", border: "hairline-strong", ink: "ink", boundary: false },

	/* Toast, segmented control, skeleton. */
	{ id: "toast", fill: "elevated", border: "hairline", ink: "ink", boundary: false },
	{ id: "segmented/track", fill: "sunken", border: null, ink: "ink-muted", boundary: false },
	{ id: "segmented/selected", fill: "accent-muted", border: null, ink: "accent-hover", themes: ["dark"], boundary: false },
	{ id: "segmented/selected", fill: "accent-muted", border: null, ink: "accent-active", themes: ["light"], boundary: false },
	{ id: "skeleton/bar", fill: "elevated", border: null, ink: "ink-dim", boundary: false },
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

	/* The ground ladder. A palette can hold every ratio above and still
	   flatten: the desktop branding doc's floors are canvas L* >= 12 and
	   <= 22 in dark, <= 94 in light, elevated <= 30 in dark, sunken >= 80 in
	   light, a surface 2.5-5.0 L* above the canvas, an elevated 2.5-6.0
	   above that, and a sunken 1.5-6.0 below it. All eight hold here. */
	for (const theme of ["light", "dark"]) {
		const P = load(theme);
		const L = (k) => lstar(P[k]);
		checks += 1;
		if (!(L("elevated") > L("surface") && L("surface") > L("canvas")))
			fail(`${theme}  the ground ladder is not ascending: canvas ${L("canvas").toFixed(1)} -> surface ${L("surface").toFixed(1)} -> elevated ${L("elevated").toFixed(1)}`);
		checks += 1;
		if (!(L("sunken") < L("canvas")))
			fail(`${theme}  sunken (${L("sunken").toFixed(1)}) is not below canvas (${L("canvas").toFixed(1)})`);
		checks += 1;
		const up1 = L("surface") - L("canvas");
		const up2 = L("elevated") - L("surface");
		const down = L("canvas") - L("sunken");
		if (!(up1 >= 2.5 && up1 <= 5.0))
			fail(`${theme}  canvas -> surface is ${up1.toFixed(2)} L*, outside the 2.5-5.0 band`);
		if (!(up2 >= 2.5 && up2 <= 6.0))
			fail(`${theme}  surface -> elevated is ${up2.toFixed(2)} L*, outside the 2.5-6.0 band`);
		if (!(down >= 1.5 && down <= 6.0))
			fail(`${theme}  canvas -> sunken is ${down.toFixed(2)} L*, outside the 1.5-6.0 band`);
		if (theme === "dark") {
			checks += 1;
			if (!(L("canvas") >= 12 && L("canvas") <= 22))
				fail(`dark canvas is L* ${L("canvas").toFixed(2)}, outside the hard 12-22 band`);
			checks += 1;
			if (L("elevated") > 30)
				fail(`dark elevated is L* ${L("elevated").toFixed(2)} > 30, which makes the ink budget unaffordable`);
		} else {
			checks += 1;
			if (L("canvas") > 94)
				fail(`light canvas is L* ${L("canvas").toFixed(2)} > 94`);
			checks += 1;
			if (L("sunken") < 80)
				fail(`light sunken is L* ${L("sunken").toFixed(2)} < 80`);
		}
	}
}

/* ---- 10. the colour assertions ---------------------------------------- */

for (const theme of ["light", "dark"]) {
	const P = load(theme);

	/* text pairs */
	for (const [fg, bg] of textPairs())
		assertPair(fg, bg, FLOOR.text, theme, P, "text");

	/* The structural border on every ground it can sit on. */
	for (const g of GROUNDS)
		assertPair("border-control", g, FLOOR.nonText, theme, P, "structural border");

	/* The focus ring against every ground and every fill it can appear over.
	   On a phone the ring is rarely seen, but a hardware keyboard, a switch
	   control and a remote all reach it, and the shipped client keeps it for
	   exactly that reason. */
	for (const g of [...GROUNDS, "accent-wash", "accent-muted"])
		assertPair("accent", g, FLOOR.nonText, theme, P, "focus ring");

	/* Semantic borders on the grounds the system claims for them, including
	   `elevated`: this app DOES put an inline alert on an elevated ground,
	   where the site's kit could not (its dark semantic borders measured 2.9x
	   there). This ramp's measure 3.14-3.16 at the worst, which is why the
	   `alert/*` rows above are legal on every ground rather than a subset. */
	for (const s of ["success", "warning", "danger", "info"])
		for (const g of GROUNDS)
			assertPair(`${s}-border`, g, FLOOR.nonText, theme, P, "semantic border");

	/* The two lines are decorated as decorative, asserted as a NEGATIVE: a
	   line that clears 3:1 would be legal as a sole boundary, and the rule is
	   that these two never are. If one starts passing, the distinction
	   between a decorative rule and a structural border has been lost. */
	for (const line of ["hairline", "hairline-strong"]) {
		checks += 1;
		const worst = Math.max(...GROUNDS.map((g) => ratio(P[line], P[g])));
		if (worst >= FLOOR.nonText)
			fail(
				`${theme}  ${line} clears ${worst.toFixed(2)} against a ground — it is documented as decorative and must never be a control's sole boundary; if it now passes, either the token moved or a control is relying on it`,
			);
	}

	/* component triples */
	for (const c of CONTROLS) {
		if (c.themes && !c.themes.includes(theme)) continue;
		for (const ground of c.grounds ?? GROUNDS) {
			const fill = c.fill ?? ground;
			const label = `${c.id} on ${ground}`;

			if (!EXEMPT_INK.has(c.ink))
				assertPair(c.ink, fill, FLOOR.text, theme, P, label);

			if (c.boundary === false) continue;
			checks += 1;
			const byFill = c.fill ? ratio(P[fill], P[ground]) : 0;
			const byBorder = c.border ? ratio(P[c.border], P[ground]) : 0;
			if (Math.max(byFill, byBorder) < FLOOR.nonText)
				fail(
					`${theme}  ${label}: no boundary clears ${FLOOR.nonText} — ` +
						`fill ${byFill.toFixed(2)}, border ${byBorder.toFixed(2)}. ` +
						`The control has no edge a low-vision reader can resolve.`,
				);
		}
	}

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

if (failures) {
	console.error(
		`\n${failures} violation(s). See design/tokens/tokens.json § contrastFloors for the floors.`,
	);
	process.exit(1);
}
console.log("\nContrast contract holds.");
