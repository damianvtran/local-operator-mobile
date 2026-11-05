/**
 * Colour maths for the token gates, in ONE place.
 *
 * The contrast contract, the palette derivation (`design/themes/derive.mjs`) and
 * the generator (`scripts/build-theme.ts`) all measure colours. Each used to
 * carry its own copy, and the contract already had to note a measurement
 * "matching this to ≤1/255" — two copies of a ratio function are how a floor
 * and a solver come to disagree about the same pair. No dependencies, plain
 * `node`, so the design job can run it without `pnpm install`.
 *
 * Every input is a `#rrggbb` string (case-insensitive) unless a function says
 * otherwise; `composite` is the one that takes an 8-digit hex.
 */

const parse = (hex) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

/** WCAG 2.x relative luminance (the 0.03928 knee, tokens.json § $meta.ratioMethod). */
export const lum = (hex) => {
	const [r, g, b] = parse(hex).map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, ROUNDED to two places — the precision the contract's
 *  pins are written at, so a pinned 4.51 compares equal to a measured 4.51. */
export const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
	return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

/** `over` (an 8-digit hex carrying its own alpha) composited on `base`, per
 *  channel in 8-bit — the blend every renderer of these tokens performs. */
export const composite = (over, base) => {
	const alpha = Number.parseInt(over.slice(7, 9), 16) / 255;
	const [o, b] = [parse(over.slice(0, 7)), parse(base)];
	return `#${[0, 1, 2]
		.map((i) =>
			Math.round((o[i] * alpha + b[i] * (1 - alpha)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
};

/** `a` mixed into `b` at weight `w` (0..1 of `a`), in 8-bit sRGB — the same
 *  arithmetic as CSS `color-mix(in srgb, a w%, b)`. */
export const mix = (a, b, w) => {
	const [x, y] = [parse(a), parse(b)];
	return `#${[0, 1, 2]
		.map((i) =>
			Math.round((x[i] * w + y[i] * (1 - w)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
};

/*
 * CIE Lab, CIEDE2000 and the Lab -> hex inverse, copied from the desktop app's
 * `scripts/color.mjs` (damianvtran/local-operator-ui, read at b66bb9e9, the ref
 * `design/themes/desktop-palettes.lock.json` pins) so the phone's ladder
 * measures ΔE00 exactly as the desktop's contract that authored the palettes.
 */
export const toLab = (hex) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
	const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
	const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
	const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
	const [fx, fy, fz] = [f(X), f(Y), f(Z)];
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** CIE L*, the ground ladder's axis. sRGB -> linear -> Y -> L*. */
export const lstar = (hex) => {
	const [r, g, b] = parse(hex).map((c) =>
		c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y;
};

export const deltaE = (h1, h2) => {
	const [L1, a1, b1] = toLab(h1);
	const [L2, a2, b2] = toLab(h2);
	const RAD = Math.PI / 180;
	const DEG = 180 / Math.PI;
	const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
	const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
	const [ap1, ap2] = [(1 + G) * a1, (1 + G) * a2];
	const [Cp1, Cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
	const hp = (b, ap) => {
		if (b === 0 && ap === 0) return 0;
		const h = Math.atan2(b, ap) * DEG;
		return h < 0 ? h + 360 : h;
	};
	const [hp1, hp2] = [hp(b1, ap1), hp(b2, ap2)];
	const dL = L2 - L1;
	const dC = Cp2 - Cp1;
	let dhp = 0;
	if (Cp1 * Cp2 !== 0) {
		dhp = hp2 - hp1;
		if (dhp > 180) dhp -= 360;
		else if (dhp < -180) dhp += 360;
	}
	const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * RAD) / 2);
	const Lb = (L1 + L2) / 2;
	const Cpb = (Cp1 + Cp2) / 2;
	let hpb;
	if (Cp1 * Cp2 === 0) hpb = hp1 + hp2;
	else {
		hpb = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2) / 2;
		if (hpb >= 360) hpb -= 360;
	}
	const T =
		1 -
		0.17 * Math.cos((hpb - 30) * RAD) +
		0.24 * Math.cos(2 * hpb * RAD) +
		0.32 * Math.cos((3 * hpb + 6) * RAD) -
		0.2 * Math.cos((4 * hpb - 63) * RAD);
	const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
	const Sc = 1 + 0.045 * Cpb;
	const Sh = 1 + 0.015 * Cpb * T;
	const Rt =
		-Math.sin(2 * 30 * Math.exp(-(((hpb - 275) / 25) ** 2)) * RAD) *
		2 *
		Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
	return Math.sqrt(
		(dL / Sl) ** 2 +
			(dC / Sc) ** 2 +
			(dH / Sh) ** 2 +
			Rt * (dC / Sc) * (dH / Sh),
	);
};

/** Lab -> lowercase `#rrggbb`, or null when the triple is outside sRGB. */
export const labToHex = ([L, a, b]) => {
	const fy = (L + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const finv = (t) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
	const X = finv(fx) * 0.95047;
	const Y = finv(fy);
	const Z = finv(fz) * 1.08883;
	const lin = [
		X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314,
		X * -0.969266 + Y * 1.8760108 + Z * 0.041556,
		X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252,
	];
	const srgb = lin.map((v) =>
		v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055,
	);
	if (srgb.some((v) => v < -0.0015 || v > 1.0015)) return null;
	const c = (v) =>
		Math.round(Math.min(1, Math.max(0, v)) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${srgb.map(c).join("")}`;
};

/**
 * The colour at lightness `L` holding `hex`'s own hue. Chroma is scaled down
 * only when sRGB cannot hold it at that lightness — the desktop's own rule for
 * re-solving a ground ("a ground is re-solved by holding its own a and b at a
 * new L*; chroma is scaled only where sRGB forces it", docs/branding.md § 2).
 */
export const atLightness = (hex, L) => {
	const [, a, b] = toLab(hex);
	for (let k = 1; k >= 0; k -= 0.05) {
		const out = labToHex([L, a * k, b * k]);
		if (out) return out;
	}
	return null;
};
