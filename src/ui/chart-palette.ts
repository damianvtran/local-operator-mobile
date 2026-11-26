/**
 * Categorical chart colours derived from the composed palette.
 *
 * Why derived, not authored: the inline-chart redesign (desktop, relay web and
 * this app share one spec) needs seven series/slice colours that are distinct
 * HUES, not shades of the accent, and that stay ≥ 3:1 against every ground the
 * chart can sit on. Authoring seven more roles per palette would drift between
 * surfaces and never cover a custom accent, so all three implementations run
 * this one algorithm and pin the same golden vectors in a unit test
 * (`chart-palette.test.ts`). Change the algorithm here only together with the
 * desktop `src/shared/theme-engine/chart-palette.mjs` and the relay web copy.
 *
 * Algorithm (spec §4):
 *   1. Base OKLCH hues in priority order (blue, orange, teal, magenta, yellow,
 *      violet, green, red).
 *   2. A chromatic accent (C ≥ 0.04) is slot 1; the base hue nearest it is
 *      dropped when within 40°, so slot 2 never repeats the accent's hue.
 *   3. Dark ⇔ OKLCH L of canvas < 0.5. Slot i starts at an alternating
 *      lightness, C 0.15 reduced in 0.005 steps until in sRGB gamut, then L
 *      steps by 0.01 away from the ground until contrast ≥ 3.05:1 against
 *      every ground.
 *   4. Greedy order: each next slot takes the remaining hue whose colour is
 *      farthest (min over ΔE00 normal / deuteranopia / protanopia) from the
 *      colours already chosen; ties keep base order.
 */

type Rgb = [number, number, number];
type Lab = [number, number, number];

const BASE_HUES = [255, 60, 185, 345, 95, 300, 145, 25] as const;
const SLOTS = 7;
const CONTRAST_FLOOR = 3.05;

const parseHex = (hex: string): Rgb => {
	const h = hex.replace("#", "");
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h.slice(0, 6);
	return [0, 2, 4].map(
		(i) => Number.parseInt(full.slice(i, i + 2), 16) / 255,
	) as Rgb;
};

const toHex = (rgb: Rgb) =>
	`#${rgb
		.map((c) =>
			Math.round(Math.min(1, Math.max(0, c)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`.toUpperCase();

const toLinear = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
	c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

const linearToOklab = ([r, g, b]: Rgb): Lab => {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
};

const oklabToLinear = ([L, a, b]: Lab): Rgb => {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
};

export const hexToOklch = (hex: string): [number, number, number] => {
	const [L, a, b] = linearToOklab(parseHex(hex).map(toLinear) as Rgb);
	const C = Math.hypot(a, b);
	const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
	return [L, C, H];
};

const oklchToLinear = (L: number, C: number, H: number): Rgb => {
	const rad = (H * Math.PI) / 180;
	return oklabToLinear([L, C * Math.cos(rad), C * Math.sin(rad)]);
};

const GAMUT_EPSILON = 1e-6;
const inGamut = (rgb: Rgb) =>
	rgb.every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);

const luminance = (hex: string) => {
	const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio between two hex colours. */
export const contrastRatio = (a: string, b: string) => {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// Machado, Oliveira & Fernandes 2009, severity 1.0, applied to linear sRGB.
const PROTANOPIA = [
	[0.152286, 1.052583, -0.204868],
	[0.114503, 0.786281, 0.099216],
	[-0.003882, -0.048116, 1.051998],
] as const;
const DEUTERANOPIA = [
	[0.367322, 0.860646, -0.227968],
	[0.280085, 0.672501, 0.047413],
	[-0.01182, 0.04294, 0.968881],
] as const;

const simulate = (
	rgb: Rgb,
	matrix: readonly (readonly [number, number, number])[],
): Rgb =>
	matrix.map((row) =>
		Math.min(
			1,
			Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]),
		),
	) as Rgb;

const linearToLab = ([r, g, b]: Rgb): Lab => {
	// sRGB D65 → XYZ → CIELAB (D65 white).
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
	const f = (t: number) =>
		t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116;
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** CIEDE2000 colour difference. */
export const deltaE00 = ([L1, a1, b1]: Lab, [L2, a2, b2]: Lab) => {
	const rad = Math.PI / 180;
	const C1 = Math.hypot(a1, b1);
	const C2 = Math.hypot(a2, b2);
	const Cbar = (C1 + C2) / 2;
	const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
	const a1p = (1 + G) * a1;
	const a2p = (1 + G) * a2;
	const C1p = Math.hypot(a1p, b1);
	const C2p = Math.hypot(a2p, b2);
	const hue = (b: number, a: number) =>
		b === 0 && a === 0 ? 0 : (((Math.atan2(b, a) / rad) % 360) + 360) % 360;
	const h1p = hue(b1, a1p);
	const h2p = hue(b2, a2p);
	const dLp = L2 - L1;
	const dCp = C2p - C1p;
	let dhp = 0;
	if (C1p * C2p !== 0) {
		dhp = h2p - h1p;
		if (dhp > 180) dhp -= 360;
		else if (dhp < -180) dhp += 360;
	}
	const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
	const Lbarp = (L1 + L2) / 2;
	const Cbarp = (C1p + C2p) / 2;
	let hbarp = h1p + h2p;
	if (C1p * C2p !== 0) {
		if (Math.abs(h1p - h2p) > 180) hbarp += h1p + h2p < 360 ? 360 : -360;
		hbarp /= 2;
	}
	const T =
		1 -
		0.17 * Math.cos((hbarp - 30) * rad) +
		0.24 * Math.cos(2 * hbarp * rad) +
		0.32 * Math.cos((3 * hbarp + 6) * rad) -
		0.2 * Math.cos((4 * hbarp - 63) * rad);
	const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
	const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
	const Sl =
		1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
	const Sc = 1 + 0.045 * Cbarp;
	const Sh = 1 + 0.015 * Cbarp * T;
	const Rt = -Math.sin(2 * dTheta * rad) * Rc;
	return Math.sqrt(
		(dLp / Sl) ** 2 +
			(dCp / Sc) ** 2 +
			(dHp / Sh) ** 2 +
			Rt * (dCp / Sc) * (dHp / Sh),
	);
};

/** min(ΔE00 normal, deuteranopia, protanopia) between two hex colours. */
export const cvdDistance = (a: string, b: string) => {
	const la = parseHex(a).map(toLinear) as Rgb;
	const lb = parseHex(b).map(toLinear) as Rgb;
	return Math.min(
		deltaE00(linearToLab(la), linearToLab(lb)),
		deltaE00(
			linearToLab(simulate(la, DEUTERANOPIA)),
			linearToLab(simulate(lb, DEUTERANOPIA)),
		),
		deltaE00(
			linearToLab(simulate(la, PROTANOPIA)),
			linearToLab(simulate(lb, PROTANOPIA)),
		),
	);
};

const hueGap = (a: number, b: number) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

function slotColor(
	hue: number,
	slot: number,
	dark: boolean,
	grounds: string[],
) {
	const starts = dark ? [0.8, 0.7] : [0.5, 0.6];
	const step = dark ? 0.01 : -0.01;
	let L = starts[slot % 2] ?? starts[0] ?? 0.5;
	for (let guard = 0; guard < 100; guard++) {
		let C = 0.15;
		let rgb = oklchToLinear(L, C, hue);
		while (!inGamut(rgb) && C > 0) {
			C = Math.max(0, Math.round((C - 0.005) * 1000) / 1000);
			rgb = oklchToLinear(L, C, hue);
		}
		const hex = toHex(rgb.map(fromLinear) as Rgb);
		if (grounds.every((ground) => contrastRatio(hex, ground) >= CONTRAST_FLOOR))
			return hex;
		L = Math.round((L + step) * 100) / 100;
		if (L <= 0 || L >= 1) return hex;
	}
	return toHex(oklchToLinear(L, 0, hue).map(fromLinear) as Rgb);
}

/**
 * Seven categorical colours for a composed palette; slot 0 is the accent.
 * `grounds` are every surface a chart sits on (canvas, surface and the message
 * surface); the first one decides light vs dark.
 */
export function chartPalette({
	grounds,
	accent,
}: {
	grounds: readonly string[];
	accent: string;
}): string[] {
	const [canvas = "#000000"] = grounds;
	const dark = hexToOklch(canvas)[0] < 0.5;
	const [, accentC, accentH] = hexToOklch(accent);
	let hues: number[] = [...BASE_HUES];
	if (accentC >= 0.04) {
		let nearest = -1;
		let best = Infinity;
		hues.forEach((h, i) => {
			const gap = hueGap(h, accentH);
			if (gap < best) {
				best = gap;
				nearest = i;
			}
		});
		if (best <= 40) hues = hues.filter((_, i) => i !== nearest);
	}
	const chosen = [toHex(parseHex(accent))];
	const groundList = [...grounds];
	while (chosen.length < SLOTS && hues.length > 0) {
		// Lightness alternates by DERIVED slot (0 = first colour after the
		// accent); the golden vectors pin this indexing.
		const derived = chosen.length - 1;
		let pick = 0;
		let pickColor = "";
		let pickDistance = -Infinity;
		hues.forEach((hue, i) => {
			const color = slotColor(hue, derived, dark, groundList);
			const distance = Math.min(...chosen.map((c) => cvdDistance(c, color)));
			if (distance > pickDistance) {
				pickDistance = distance;
				pick = i;
				pickColor = color;
			}
		});
		chosen.push(pickColor);
		hues = hues.filter((_, i) => i !== pick);
	}
	return chosen;
}

type PaletteEntry = {
	colors: {
		canvas: string;
		surface: string;
		"message-surface": string;
		accent: string;
	};
};

// Theme entries are static catalogue objects, so one derivation per entry
// serves every chart in the transcript (and survives theme flips back).
const CACHE = new WeakMap<PaletteEntry, readonly string[]>();

/** The memoised chart colours for a catalogue theme (`useTheme().chart`). */
export function chartColorsFor(entry: PaletteEntry): readonly string[] {
	const cached = CACHE.get(entry);
	if (cached) return cached;
	const { colors } = entry;
	const derived = chartPalette({
		grounds: [colors.canvas, colors.surface, colors["message-surface"]],
		accent: colors.accent,
	});
	CACHE.set(entry, derived);
	return derived;
}
