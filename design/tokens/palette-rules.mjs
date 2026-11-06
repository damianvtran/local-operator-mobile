/**
 * The per-palette half of the mobile contrast contract.
 *
 * `contrast-contract.mjs` used to hold these tables inline and run them over
 * the two brand themes in `tokens.json`. The phone now ships every desktop
 * palette (decision record `mobile-design-direction.md` § 5), and each one has
 * to clear the SAME pairs, triples and ladder — so the tables live here, and
 * the contract runs `checkPalette` twice: once over the brand themes with their
 * pinned exceptions, and once over each derived palette in the fleet. Moving
 * the text verbatim is deliberate: a second copy of a pair table is how two
 * gates come to disagree about what the system permits.
 *
 * Plain `node`, no dependencies. Every `P` below is a flat map of the phone's
 * kebab-case roles to `#rrggbb` (the scrim may carry an alpha byte).
 */
import { composite, deltaE, lstar, ratio } from "./colour-math.mjs";

/* ---- floors, from tokens.json § contrastFloors -------------------------- */

export const FLOOR = { text: 4.5, nonText: 3.0 };

/* `ink-disabled` is the palette's exempt foreground (SC 1.4.3, an inactive
   control). See contrast-contract.mjs § 1 for why nothing else is exempt by
   category. */
export const EXEMPT_INK = new Set(["ink-disabled"]);

/* ---- 4. the permitted surfaces and text pairs -------------------------- */

/* The seven grounds any text may sit on. `sunken` is in the list; the pairs
   that may not use it are named in FORBIDDEN below. `message-surface` is the
   user bubble's own ground and `row-hover` / `row-selected` are the two row
   states, because a list row is where a phone user reads most of the app. */
export const GROUNDS = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"message-surface",
	"row-hover",
	"row-selected",
];

/** Every foreground x ground pair the system permits, as [ink, ground][]. */
export const textPairs = (theme) => {
	const p = [];
	const on = (fg, grounds) => grounds.forEach((g) => p.push([fg, g]));

	/* The ink ramp carries prose on every ground. */
	on("ink", GROUNDS);
	on("ink-muted", GROUNDS);
	on("ink-dim", GROUNDS);

	/* The exempt ink, listed so its EXCEPTIONS pins are EVALUATED rather than
	   merely printed: every ground is asserted at the text floor and carried by a
	   pinned sub-floor ratio, and a value that drifts fails with the reason.
	   Nothing else in this file asserts `ink-disabled`, which is how a pin can rot
	   unnoticed — the failure mode these pins exist to prevent. */
	on("ink-disabled", GROUNDS);

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
	/* The badge ink on the solid tint is per mode, exactly as the components
	   paint it (`text-accent-active dark:text-accent-hover`, variants.ts and
	   avatar.tsx), so only the ink a mode actually renders is asserted. Both
	   used to be asserted in both themes, which was harmless with two brand
	   palettes and is wrong for a fleet: a dark theme never paints its
	   `accent-active` on the tint. */
	p.push([theme === "dark" ? "accent-hover" : "accent-active", "accent-muted"]);

	/* The primary button's ink on all three accent fills. */
	for (const fill of ["accent", "accent-hover", "accent-active"])
		p.push(["on-accent", fill]);

	return p;
};

/* ---- 5. component triples --------------------------------------------- */

/* A control is legal on a ground when its ink clears 4.5:1 against its own
   fill AND its boundary — fill-vs-ground OR border-vs-ground, whichever is
   stronger — clears 3:1. `fill: null` means transparent, so the ground itself
   is the fill. `boundary: false` drops the boundary assertion (SC 1.4.11
   binds components and required content, not decorative labels); those rows
   still assert their ink.

   Rows mirror docs/design/components.md: this table and that document fail
   together or pass together. */
export const CONTROLS = [
	/* Button, components.md § 2. */
	{ id: "button/primary", fill: "accent", border: null, ink: "on-accent" },
	{ id: "button/primary pressed", fill: "accent-active", border: null, ink: "on-accent" },
	{ id: "button/secondary", fill: "surface", border: "border-control", ink: "ink" },
	{ id: "button/outline", fill: null, border: "border-control", ink: "ink" },
	{ id: "button/ghost", fill: null, border: null, ink: "ink-muted", boundary: false },
	{ id: "button/danger", fill: "danger-wash", border: "danger-border", ink: "danger" },

	/* The disabled rows. Their ink is `ink-dim`, which is what the kit actually
	   paints (`CONTROL_DISABLED_INK` in src/ui/variants.ts, pinned by its own test):
   a disabled label NAMES its action, so it is asserted at the text floor rather
   than exempted. These rows used to say `ink-disabled`, an ink the shipped
   Button and field had already replaced — and a row documenting the wrong ink is
   worse than no row, because the session composer's primary read it as sanction
   for a 2.42:1 disabled label (see `composer/send disabled` below).
   `ink-disabled` stays the palette's exempt ink for an icon-only disabled
   control; its pinned values live in EXCEPTIONS. */
	{ id: "button/primary disabled", fill: "sunken", border: null, ink: "ink-dim", boundary: false },
	{ id: "button/secondary disabled", fill: "surface", border: "hairline", ink: "ink-dim", boundary: false },

	/* Input and textarea, components.md § 4. */
	{ id: "input/rest", fill: "surface", border: "border-control", ink: "ink" },
	/* The ink the field SHIPS is `ink-muted`, not the `ink-dim` the role summary in
	   tokens.json mentions for placeholders — `Textarea` resolves the value with
	   `useTokenColor("ink-muted")` and hands the same binding to
	   `placeholderTextColor` and to its measuring stand-in copy. This row asserts
	   what a reader actually sees (8.19:1 light, 7.85:1 dark). */
	{ id: "input/placeholder", fill: "surface", border: "border-control", ink: "ink-muted" },
	{ id: "input/focused", fill: "surface", border: "accent", ink: "ink" },
	{ id: "input/invalid", fill: "surface", border: "danger", ink: "ink" },
	{ id: "input/disabled", fill: "sunken", border: "hairline", ink: "ink-dim", boundary: false },

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

	/* The switcher's two NAVIGATION entry points: the Home header's computer chip
	   and the drawer footer's workspace row. Both paint `border-control`, and the
	   edge is load-bearing rather than decorative — at 200 % text the chip drops
	   its chevron, so the capsule is the only thing that says "this opens a
	   picker" (design round 2, D8). `panel-edge` is deliberately NOT the role
	   here: in the light palette it is `hairline` (#dad5cb), measured 1.25:1 on
	   canvas and 1.34:1 on surface. `border-control` measures 3.42 / 3.65 light
	   and 3.93 / 3.58 dark. */
	{ id: "nav/computer-chip", fill: null, border: "border-control", ink: "ink-muted", grounds: ["canvas"] },
	{ id: "nav/drawer-computer-row", fill: "surface", border: "border-control", ink: "ink", grounds: ["canvas", "surface"] },

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

	/* The two composer pairs the frame audit measures on every cell, named here so
	   a token nudge that breaks them fails by name instead of only as a frame row.
	   `composer/send disabled` is what the primary control takes when it is
	   disabled (fill `sunken`, the kit's disabled ink); `composer/placeholder` is
	   the placeholder's ink on the field's own fill, which is `surface` on this
	   head: `Textarea` calls `fieldClasses(fieldState)` without `inComposer`, so
	   the `elevated` fill on the row above is the intent and not the render.
	   Recorded, not assumed — the audit measures the shipped fill either way. */
	{ id: "composer/send disabled", fill: "sunken", border: null, ink: "ink-dim", boundary: false },
	{ id: "composer/placeholder", fill: "surface", border: null, ink: "ink-muted", boundary: false },

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
	/* The same bar on a RAISED ground (a surface above the canvas — the
	   conversations pane draws on `elevated`): the component swaps the pulse's ends
	   for that case (`Skeleton`'s `ground="raised"`), painting `sunken` at rest and
	   dimming to `canvas`, because the canvas pair paints the bar in the ground's
	   OWN colour there (measured 1.00:1 on the 2026-10-11 full-surface pass — the
	   "loading reads as empty" failure). Carried as its own row so a token nudge
	   re-opens this pair too: `sunken` must stay a step off the raised ground
	   (1.25:1 dark / 1.22:1 light today), and `ink-dim` must still read on it.
	   `components.md` § 19 states both pairs. */
	{ id: "skeleton/bar-raised", fill: "sunken", border: null, ink: "ink-dim", boundary: false },
];

/* ---- the ground ladder ------------------------------------------------- */

/**
 * The ladder's bands, synced to the desktop's 2026-11-03 values — the "darker
 * grounds" pass that re-lit every desktop palette, and therefore every palette
 * this app now ships. Source: damianvtran/local-operator-ui at b66bb9e9 (the
 * ref `design/themes/desktop-palettes.lock.json` pins):
 *   - `scripts/contrast-contract.mjs` l.270-273 (`LIFT`) and l.291-312 (`STEP`),
 *     l.315 (`GROUND_STEP_DELTA_E`), l.5321 (`ELEVATED_PANEL_DELTA_E`);
 *   - `docs/branding.md` § 2, l.136-142 (the same rules as prose).
 * Before the sync the phone asserted the desktop's PRE-re-light bands (dark
 * canvas 12-22, elevated <= 30, surface -> elevated >= 2.5), which 31 of the 59
 * re-lit palettes fail (record § 5, "Contrast gate"). `surface -> elevated`
 * takes the desktop's own relaxation: 2.0 L* plus a ΔE00 2.0 floor, because the
 * L* step was only ever a proxy for "the two grounds do not merge" and the
 * desktop now asserts that statement directly.
 */
export const LADDER = {
	dark: { canvasMin: 9.0, canvasMax: 15.0, elevatedMax: 22.0 },
	light: { canvasMax: 94.0, sunkenMin: 80.0 },
	canvasSurface: [2.5, 5.0],
	surfaceElevated: [2.0, 6.0],
	canvasSunken: [1.5, 6.0],
	/** ΔE00 floors on the two steps whose L* band is a proxy. */
	surfaceElevatedDeltaE: 2.0,
	canvasSunkenDeltaE: 2.0,
};

	/* The diff tint ladder.
	 *
	 * A diff's row tint is not decoration: it is the channel that tells a reader
	 * scanning a long hunk which lines are new and which are gone, and the
	 * first sheet this kit rendered had none of it — the dark tints measured
	 * 1.11:1 against the well they are painted in, which is a step no reader
	 * can see, so the diff's only channel was its text colour.
	 *
	 * The floors are PER THEME and the difference is measured rather than
	 * stylistic. A tint needs a perceivable step; what makes it perceivable
	 * differs by where it sits in CIE L*:
	 *   light, L* ~92: chroma resolves, so a hue difference of 1.04-1.07
	 *                  luminance reads as two different rows
	 *   dark,  L* ~10: chroma compresses, so only a luminance step survives
	 *                  and the band is 1.25-1.45
	 * Both bands are pinned, so an edit that moves a tint out of its band — in
	 * either direction — re-opens the reasoning instead of passing silently. */
export const DIFF_TINT_BAND = { dark: [1.25, 1.45], light: [1.03, 1.12] };

/**
 * Assert every per-palette rule over `P`, whose mode is `theme`.
 *
 * `h` decides what a violation MEANS, which is the one thing the brand run and
 * the fleet run differ on: `h.pair(fg, bg, floor, theme, P, label)` asserts a
 * pair (the brand run consults its pinned exceptions there; the fleet run
 * skips the exempt ink), `h.fail(msg)` records a failure and `h.tick()` counts
 * an assertion that is not a pair.
 */
export const checkPalette = (theme, P, h) => {
	const assertPair = h.pair;
	const L = (k) => lstar(P[k]);

	h.tick();
	if (!(L("elevated") > L("surface") && L("surface") > L("canvas")))
		h.fail(`${theme}  the ground ladder is not ascending: canvas ${L("canvas").toFixed(1)} -> surface ${L("surface").toFixed(1)} -> elevated ${L("elevated").toFixed(1)}`);
	h.tick();
	if (!(L("sunken") < L("canvas")))
		h.fail(`${theme}  sunken (${L("sunken").toFixed(1)}) is not below canvas (${L("canvas").toFixed(1)})`);
	for (const [name, step, [lo, hi]] of [
		["canvas -> surface", L("surface") - L("canvas"), LADDER.canvasSurface],
		["surface -> elevated", L("elevated") - L("surface"), LADDER.surfaceElevated],
		["canvas -> sunken", L("canvas") - L("sunken"), LADDER.canvasSunken],
	]) {
		h.tick();
		if (step < lo - 1e-9 || step > hi + 1e-9)
			h.fail(`${theme}  ${name} is ${step.toFixed(2)} L*, outside the ${lo}-${hi} band`);
	}
	for (const [from, to, need] of [
		["surface", "elevated", LADDER.surfaceElevatedDeltaE],
		["canvas", "sunken", LADDER.canvasSunkenDeltaE],
	]) {
		h.tick();
		const got = deltaE(P[from], P[to]);
		if (got < need)
			h.fail(`${theme}  ${from} and ${to} are ΔE00 ${got.toFixed(2)} apart (need ${need}) — two grounds a reader cannot tell apart`);
	}
	if (theme === "dark") {
		h.tick();
		if (L("canvas") < LADDER.dark.canvasMin || L("canvas") > LADDER.dark.canvasMax)
			h.fail(`${theme}  dark canvas is L* ${L("canvas").toFixed(2)}, outside the hard ${LADDER.dark.canvasMin}-${LADDER.dark.canvasMax} band`);
		h.tick();
		if (L("elevated") > LADDER.dark.elevatedMax)
			h.fail(`${theme}  dark elevated is L* ${L("elevated").toFixed(2)} > ${LADDER.dark.elevatedMax}, which makes the ink budget unaffordable`);
	} else {
		h.tick();
		if (L("canvas") > LADDER.light.canvasMax)
			h.fail(`${theme}  light canvas is L* ${L("canvas").toFixed(2)} > ${LADDER.light.canvasMax}`);
		h.tick();
		if (L("sunken") < LADDER.light.sunkenMin)
			h.fail(`${theme}  light sunken is L* ${L("sunken").toFixed(2)} < ${LADDER.light.sunkenMin}`);
	}

	for (const tint of ["diff-add-surface", "diff-remove-surface", "diff-hunk-surface"]) {
		h.tick();
		const got = ratio(P[tint], P.sunken);
		const [lo, hi] = DIFF_TINT_BAND[theme];
		if (got < lo || got > hi)
			h.fail(`${theme}  the diff tint step is unusable: ${tint} on sunken is ${got.toFixed(2)}, outside the ${lo}-${hi} band for ${theme}`);
	}


	/* text pairs */
	for (const [fg, bg] of textPairs(theme))
		assertPair(fg, bg, FLOOR.text, theme, P, "text");

	/* The structural border on every ground it can sit on. */
	for (const g of GROUNDS)
		assertPair("border-control", g, FLOOR.nonText, theme, P, "structural border");

	/* The overlay panel's edge (the scoped `panel-edge` role): the conversations
	   drawer over the scrim. D-dark-1 measured the panel fill at 1.38:1 against
	   the scrim ground in dark — a panel that far from its ground does not read
	   as its own surface, and no scrim alpha fixed it — so the edge carries the
	   read and must clear the non-text floor against the ground it separates
	   FROM. In dark it must also clear it against the panel it sits on, because
	   there the stroke IS the whole read; in light the fill already measures
	   ≈8.2 and the edge keeps the hairline's quiet step, so only the scrim pair
	   is asserted there — an asymmetry the tokens' own derivation explains. */
	h.tick();
	const scrimGround = composite(P.scrim, P.canvas);
	const edgeOnScrim = ratio(P["panel-edge"], scrimGround);
	if (edgeOnScrim < FLOOR.nonText)
		h.fail(
			`${theme}  the overlay panel edge: panel-edge on the scrim ground (${scrimGround}) = ${edgeOnScrim.toFixed(2)} < ${FLOOR.nonText} — the panel has no edge against the dimmed content behind it`,
		);
	if (theme === "dark") {
		h.tick();
		const edgeOnPanel = ratio(P["panel-edge"], P.elevated);
		if (edgeOnPanel < FLOOR.nonText)
			h.fail(
				`dark  the overlay panel edge on its own panel = ${edgeOnPanel.toFixed(2)} < ${FLOOR.nonText} — the stroke melts into the fill it outlines`,
			);
	}

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
		h.tick();
		const worst = Math.max(...GROUNDS.map((g) => ratio(P[line], P[g])));
		if (worst >= FLOOR.nonText)
			h.fail(
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
			h.tick();
			const byFill = c.fill ? ratio(P[fill], P[ground]) : 0;
			const byBorder = c.border ? ratio(P[c.border], P[ground]) : 0;
			if (Math.max(byFill, byBorder) < FLOOR.nonText)
				h.fail(
					`${theme}  ${label}: no boundary clears ${FLOOR.nonText} — ` +
						`fill ${byFill.toFixed(2)}, border ${byBorder.toFixed(2)}. ` +
						`The control has no edge a low-vision reader can resolve.`,
				);
		}
	}
};
