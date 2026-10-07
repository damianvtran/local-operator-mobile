/**
 * WCAG 2.x contrast maths.
 *
 * The design kit ships its own contract checker
 * (`design/tokens/contrast-contract.mjs`) over *token pairs*. This module is the
 * other half: the same formulae applied to *rendered* nodes, because the values
 * that ship are not always the values that render — a token behind an opacity,
 * an inherited colour, or a background set on an ancestor all move the measured
 * ratio away from the declared one.
 *
 * The formulae are deliberately identical to the contract's (`parse`, `lum`,
 * `ratio`), so a number here and a number there mean the same thing:
 *
 *   lum   = WCAG 2.x relative luminance on linearised sRGB
 *   ratio = (Lmax + 0.05) / (Lmin + 0.05), rounded to 2 dp
 *
 * Floors come from `tokens.json § contrastFloors` when it is readable, with the
 * WCAG defaults as the fallback so the audit still runs without the design kit.
 */

/** An RGB triple in 0..1, and the same with an alpha in 0..1. */
export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** `#rrggbb` or `#rgb` (and `#rrggbbaa`) → [r, g, b] in 0..1. */
export function parseHex(hex: string): Rgb {
	const clean = hex.trim().replace(/^#/, "");
	const expanded =
		clean.length <= 4
			? clean
					.slice(0, 3)
					.split("")
					.map((c) => c + c)
					.join("")
			: clean.slice(0, 6);
	// Read the three channels by BYTE OFFSET rather than by indexing an array
	// built with `map`: under `noUncheckedIndexedAccess` an indexed read is
	// `| undefined` and every call site would carry a default that cannot happen.
	// The offset is a byte position (0, 2, 4), not a channel index — passing the
	// index here parsed `#b23a31` as 178,35,58 and every hex comparison in the
	// contrast and palette checks was silently wrong.
	const byteAt = (offset: number): number =>
		Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
	return [byteAt(0), byteAt(2), byteAt(4)];
}

/** `rgb()/rgba()/#hex/color(srgb …)` from a computed style → [r,g,b,a] or null. */
export function parseCssColor(value: unknown): Rgba | null {
	if (typeof value !== "string" || value === "" || value === "transparent")
		return null;
	const text = value.trim();
	const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
	if (hex) {
		const [r, g, b] = parseHex(text);
		const digits = hex[1] ?? "";
		const alpha =
			digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
		return [r, g, b, alpha];
	}
	const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
	if (fn) {
		const parts = (fn[1] ?? "")
			.split(/[\s,/]+/)
			.filter(Boolean)
			.map(Number);
		const [r = 0, g = 0, b = 0, a = 1] = parts;
		if (parts.length >= 3)
			return [r / 255, g / 255, b / 255, parts.length > 3 ? a : 1];
	}
	return null;
}

export const relativeLuminance = (rgb: Rgb | Rgba): number => {
	const [r = 0, g = 0, b = 0] = rgb;
	const lin = (c: number): number =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** The WCAG contrast ratio between two colours, rounded to 2 dp. */
export function contrastRatio(a: unknown, b: unknown): number | null {
	const ca = Array.isArray(a) ? (a as Rgb | Rgba) : parseCssColor(a);
	const cb = Array.isArray(b) ? (b as Rgb | Rgba) : parseCssColor(b);
	if (!ca || !cb) return null;
	const luminances = [relativeLuminance(ca), relativeLuminance(cb)].sort(
		(m, n) => n - m,
	);
	const lighter = luminances[0] ?? 0;
	const darker = luminances[1] ?? 0;
	return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/** Composite `fg` (with alpha) over an opaque `bg`, for a translucent colour. */
export function composite(fg: Rgba | null, bg: Rgba | null): Rgba | null {
	if (!fg) return bg;
	const alpha = fg[3] ?? 1;
	if (alpha >= 1 || !bg) return [fg[0], fg[1], fg[2], 1];
	const mixed = [0, 1, 2].map(
		(i) => (fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha),
	);
	return [mixed[0] ?? 0, mixed[1] ?? 0, mixed[2] ?? 0, 1];
}

/** The floors the audit applies, read from the design tokens when available. */
/**
 * The numeric floors a check measures against, all of them read from the design
 * tokens with the documented value as the fallback — never a second copy of the
 * number, so a token change moves the check with it.
 */
export interface Floors {
	bodyText: number;
	largeText: number;
	nonTextBoundary: number;
	touch: {
		ios: number;
		android: number;
		minimum: number;
		minimumVisualWithSlop: number;
	};
	/**
	 * The allowed spacing steps, in pt: `space.scale` × `space.base`, read from
	 * the tokens so U-42 measures against the same ramp the utilities compile from
	 * (`--spacing: 4px`, so a step's pt value is exact). An empty kit falls back to
	 * the documented scale rather than to no scale at all — a check that skipped
	 * because the tokens were unreadable would pass everything.
	 */
	spacing: number[];
}

export function floorsFromTokens(tokens: unknown): Floors {
	const root =
		typeof tokens === "object" && tokens !== null && !Array.isArray(tokens)
			? (tokens as Record<string, unknown>)
			: {};
	const declared =
		typeof root.contrastFloors === "object" && root.contrastFloors !== null
			? (root.contrastFloors as Record<string, unknown>)
			: {};
	const size =
		typeof root.size === "object" && root.size !== null
			? (root.size as Record<string, unknown>)
			: {};
	const touch =
		typeof size.touchTarget === "object" && size.touchTarget !== null
			? (size.touchTarget as Record<string, unknown>)
			: {};
	const number = (value: unknown, fallback: number): number =>
		typeof value === "number" ? value : fallback;
	const space =
		typeof root.space === "object" && root.space !== null
			? (root.space as Record<string, unknown>)
			: {};
	const base = number(space.base, 4);
	const scale = Array.isArray(space.scale)
		? space.scale.filter(
				(step): step is number => typeof step === "number" && step > 0,
			)
		: [];
	return {
		bodyText: number(declared.bodyText, 4.5),
		largeText: number(declared.largeText, 3),
		nonTextBoundary: number(declared.nonTextBoundary, 3),
		touch: {
			ios: number(touch.ios, 44),
			android: number(touch.android, 48),
			minimum: number(touch.minimum, 44),
			minimumVisualWithSlop: number(touch.minimumVisualWithSlop, 32),
		},
		spacing:
			scale.length > 0
				? scale.map((step) => step * base)
				: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96],
	};
}
