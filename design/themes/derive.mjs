/**
 * Desktop palette -> the phone's 47 colour roles.
 *
 * The desktop's `ThemePalette` carries 38 colour roles; the phone's token set
 * (`design/tokens/tokens.json`, flattened by `tailwind-preset.js`) carries 47.
 * The rules below are the ENTIRE mapping — no palette is hand-tuned here, so a
 * new desktop palette arrives on the phone by re-exporting, never by editing
 * this file (decision record `mobile-design-direction.md` § 5, "Role mapping").
 *
 *   34 roles copy straight across (camelCase -> kebab-case).
 *   13 roles exist only on the phone and are derived per palette:
 *     diff-add / diff-remove / diff-hunk   <- success / danger / info
 *     diff-context                          <- inkDim
 *     diff-*-surface                        <- the matching *Wash, stepped in L*
 *                                              into the native diff-tint band
 *     accent-muted                          <- accent into canvas at <= 22 %,
 *                                              solved for its three badge inks
 *     accent-border                         <- accentWash stepped to >= 3:1
 *     panel-edge                            <- borderControl (dark) / hairline
 *                                              (light), stepped to 3:1 on the scrim
 *     shadow-color                          <- overlayShadow's rgb base
 *     focus-ring-photo-inner / -outer       <- fixed (they sit on a photograph,
 *                                              which no palette controls)
 *     scrim                                 <- the phone's fixed literal (see FIXED)
 *   Desktop-only roles are dropped: mediaSurface, chartBarHover, tokenCommand
 *   (and overlayShadow once its colour is taken, and the desktop scrim).
 *
 * A "solved" role that cannot be solved is returned as `null` with a reason, and
 * the contrast contract then withholds that palette rather than shipping a value
 * nobody chose (record § 5: "If a derived role cannot be solved for a palette,
 * that palette is withheld by the gate and listed in the PR").
 *
 * Plain `node`, no dependencies: the design job runs it without `pnpm install`.
 */
import {
	atLightness,
	composite,
	lstar,
	mix,
	ratio,
} from "../tokens/colour-math.mjs";

/** The phone-only constants: the photographic focus ring is drawn over an
 *  image, so it is the same two-tone in every theme (tokens.json § focus). */
export const FIXED = {
	"focus-ring-photo-inner": "#fffefb",
	"focus-ring-photo-outer": "#14110c",
	/* The scrim stays the phone's own theme-invariant literal rather than the
	 * desktop's per-theme value: tokens.json § fixed records why ("a scrim's
	 * job is to recede the content behind it and that job does not change with
	 * the theme"), `check-upstream.mjs` pins it as a standing difference from
	 * the app family, and the drawer's `panel-edge` is measured against THIS
	 * ground. The desktop's light scrims (35-45 % of a light tint) would leave
	 * no 3:1 edge for the drawer on any light palette. */
	scrim: "#0b0a08b3",
};

/** The native diff-tint band, per mode, as a ratio on `sunken`
 *  (contrast-contract.mjs § 9, "The diff tint ladder"). Exported so the solver
 *  and the gate read one number. */
export const DIFF_TINT_BAND = { dark: [1.25, 1.45], light: [1.03, 1.12] };

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `rgb(r g b / a)` or `rgb(r g b)` -> `#rrggbb` or `#rrggbbaa`. The desktop
 *  writes its scrims and shadows as CSS colour functions; the phone's readers
 *  (`shadow.ts`, the contract's `composite`) take hex. */
export const rgbToHex = (css) => {
	const m = css.match(
		/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[/,]\s*([\d.]+))?\s*\)/,
	);
	if (!m) throw new Error(`not an rgb() colour: ${css}`);
	const h = (n) => Number(n).toString(16).padStart(2, "0");
	const base = `#${h(m[1])}${h(m[2])}${h(m[3])}`;
	if (m[4] === undefined || Number(m[4]) === 1) return base;
	return base + h(Math.round(Number(m[4]) * 255));
};

const hex6 = (value) => {
	const v = value.toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(v)) return v;
	throw new Error(`not a 6-digit hex: ${value}`);
};

/** Step `hex` along L* (holding its hue) in direction `dir` (+1 lighter, -1
 *  darker) until `test` holds. Returns the first passing value, or null when
 *  the walk runs out of sRGB. 0.25 L* steps: fine enough that the result sits
 *  at the floor rather than overshooting it, which is the desktop's own "first
 *  clearing step" rule. */
const stepUntil = (hex, dir, test) => {
	if (test(hex)) return hex;
	const start = lstar(hex);
	for (let d = 0.25; d <= 60; d += 0.25) {
		const L = start + dir * d;
		if (L < 0 || L > 100) break;
		const next = atLightness(hex, L);
		if (next && test(next)) return next;
	}
	return null;
};

/** A diff row's tint: the semantic wash, moved into the band on `sunken` AND
 *  kept readable under the inks drawn on it (`inks`, each at 4.5:1). Both
 *  directions along L* are walked and the smaller move wins, because a wash can
 *  sit on either side of its well — six dark palettes author theirs BELOW their
 *  own `sunken` — and the ratio band is symmetric. */
const diffTint = (wash, sunken, mode, inks) => {
	const [lo, hi] = DIFF_TINT_BAND[mode];
	const ok = (c) => {
		const r = ratio(c, sunken);
		return r >= lo && r <= hi && inks.every((ink) => ratio(ink, c) >= 4.5);
	};
	const up = stepUntil(wash, 1, ok);
	const down = stepUntil(wash, -1, ok);
	if (!up || !down) return up ?? down;
	const start = lstar(wash);
	return Math.abs(lstar(up) - start) <= Math.abs(lstar(down) - start)
		? up
		: down;
};

/**
 * Derive one palette. Returns `{ id, name, mode, colors, unsolved }`, where
 * `unsolved` lists `{ role, why }` for each role the rules could not satisfy.
 */
export const derivePalette = (desktop) => {
	const v = Object.fromEntries(
		Object.entries(desktop.values).map(([k, value]) => [k, value]),
	);
	const mode = desktop.mode;
	const colors = {};
	const unsolved = [];
	const DROPPED = new Set([
		"mediaSurface",
		"chartBarHover",
		"tokenCommand",
		"overlayShadow",
	]);
	/* 34 copied + 13 derived = the phone's 47; `scrim` is copied by name but
	 * replaced from FIXED below, so the count holds. */
	for (const [key, value] of Object.entries(v)) {
		if (DROPPED.has(key)) continue;
		if (key === "scrim") continue;
		colors[kebab(key)] = hex6(value);
	}
	const c = colors;

	c["diff-add"] = c.success;
	c["diff-remove"] = c.danger;
	c["diff-hunk"] = c.info;
	c["diff-context"] = c["ink-dim"];
	/* The inks each tint carries (contrast-contract's diff pairs): its own
	 * diff ink, and the context ink on the add/remove rows. */
	for (const [role, wash, inks] of [
		["diff-add-surface", "success-wash", ["diff-add", "diff-context"]],
		["diff-remove-surface", "danger-wash", ["diff-remove", "diff-context"]],
		["diff-hunk-surface", "info-wash", ["diff-hunk"]],
	]) {
		const solved = diffTint(
			c[wash],
			c.sunken,
			mode,
			inks.map((ink) => c[ink]),
		);
		if (solved) c[role] = solved;
		else {
			c[role] = c[wash];
			unsolved.push({ role, why: `${wash} cannot be moved into the ${mode} diff-tint band on sunken while its inks keep 4.5:1` });
		}
	}

	/* accent-muted: the solid tint behind a selected segment, a chip and a
	 * badge. Start at the record's ~22 % and back off toward the canvas until the
	 * three inks it carries (ink, and the badge ink of each mode) clear 4.5 —
	 * a quieter fill only ever raises those ratios, so the first weight that
	 * clears is the most accent the palette can afford. The focus ring
	 * (`accent`, 3:1) is drawn over it too, so it joins the inks. */
	/* The badge ink is per mode, as the components paint it:
	 * `text-accent-active dark:text-accent-hover` (variants.ts, avatar.tsx). */
	const mutedInks = ["ink", mode === "dark" ? "accent-hover" : "accent-active"];
	let muted = null;
	for (let w = 0.22; w >= 0.04 - 1e-9; w -= 0.01) {
		const candidate = mix(c.accent, c.canvas, w);
		if (
			mutedInks.every((ink) => ratio(c[ink], candidate) >= 4.5) &&
			ratio(c.accent, candidate) >= 3
		) {
			muted = candidate;
			break;
		}
	}
	if (muted) c["accent-muted"] = muted;
	else {
		c["accent-muted"] = mix(c.accent, c.canvas, 0.04);
		unsolved.push({
			role: "accent-muted",
			why: "no accent/canvas mix from 22 % down to 4 % carries ink and the badge ink at 4.5:1 with the focus ring at 3:1",
		});
	}

	/* accent-border: the 1px edge of a selected chip or card, which sits on the
	 * canvas, a card or a sheet — so it clears 3:1 on all three. */
	const borderGrounds = ["canvas", "surface", "elevated"];
	/* Away from the page: darker in a light theme, lighter in a dark one. A
	 * light wash can sit ABOVE its canvas, so the direction comes from the mode,
	 * never from the wash's side of the canvas. */
	const border = stepUntil(c["accent-wash"], mode === "dark" ? 1 : -1, (x) =>
		borderGrounds.every((g) => ratio(x, c[g]) >= 3),
	);
	if (border) c["accent-border"] = border;
	else {
		c["accent-border"] = c.accent;
		unsolved.push({
			role: "accent-border",
			why: "accent-wash cannot be stepped to 3:1 on canvas, surface and elevated inside sRGB",
		});
	}

	/* panel-edge: the drawer's stroke over the scrim. The record maps it from
	 * `borderControl`, and in dark that is what the brand theme ships (#857b69
	 * beside border-control #837c6d). In light the brand ships `hairline`
	 * instead, because a mid-grey control edge measures ~2:1 against the
	 * scrim-darkened ground (the 19 light palettes, 1.62-2.29) while a light
	 * stroke measures 5.68 there — the asymmetry contrast-contract § 10
	 * documents. So the start is per mode, and the value is then stepped in
	 * the mode's direction until its edge pairs hold: the scrim ground in both
	 * modes, and its own `elevated` panel in dark. */
	const scrimGround = composite(FIXED.scrim, c.canvas);
	const edgeOk = (x) =>
		ratio(x, scrimGround) >= 3 && (mode === "light" || ratio(x, c.elevated) >= 3);
	const edge = stepUntil(
		mode === "dark" ? c["border-control"] : c.hairline,
		1,
		edgeOk,
	);
	if (edge) c["panel-edge"] = edge;
	else {
		c["panel-edge"] = c["border-control"];
		unsolved.push({
			role: "panel-edge",
			why: "no lighter step of the start value clears 3:1 on the scrim ground (and on elevated in dark)",
		});
	}
	c["shadow-color"] = rgbToHex(v.overlayShadow.replace(/^.*?(rgba?\()/, "$1")).slice(0, 7);
	Object.assign(c, FIXED);

	return { id: desktop.id, name: desktop.name, mode, colors, unsolved };
};
