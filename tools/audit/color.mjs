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

/** `#rrggbb` or `#rgb` (and `#rrggbbaa`) → [r, g, b] in 0..1. */
export function parseHex(hex) {
	const clean = String(hex).trim().replace(/^#/, "");
	const expanded = clean.length <= 4
		? clean.slice(0, 3).split("").map((c) => c + c).join("")
		: clean.slice(0, 6);
	return [0, 2, 4].map((i) => Number.parseInt(expanded.slice(i, i + 2), 16) / 255);
}

/** `rgb()/rgba()/#hex/color(srgb …)` from a computed style → [r,g,b,a] or null. */
export function parseCssColor(value) {
	if (!value || value === "transparent") return null;
	const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
	if (hex) {
		const [r, g, b] = parseHex(value);
		const alpha = hex[1].length === 8 ? Number.parseInt(hex[1].slice(6, 8), 16) / 255 : 1;
		return [r, g, b, alpha];
	}
	const fn = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
	if (fn) {
		const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
		if (parts.length >= 3) return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] : 1];
	}
	return null;
}

export const relativeLuminance = ([r, g, b]) => {
	const [lr, lg, lb] = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

/** The WCAG contrast ratio between two colours, rounded to 2 dp. */
export function contrastRatio(a, b) {
	const ca = Array.isArray(a) ? a : parseCssColor(a);
	const cb = Array.isArray(b) ? b : parseCssColor(b);
	if (!ca || !cb) return null;
	const [x, y] = [relativeLuminance(ca), relativeLuminance(cb)].sort((m, n) => n - m);
	return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Composite `fg` (with alpha) over an opaque `bg`, for a translucent colour. */
export function composite(fg, bg) {
	if (!fg) return bg;
	const alpha = fg[3] ?? 1;
	if (alpha >= 1 || !bg) return [fg[0], fg[1], fg[2], 1];
	return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)).concat(1);
}

/** The floors the audit applies, read from the design tokens when available. */
export function floorsFromTokens(tokens) {
	const declared = tokens?.contrastFloors ?? {};
	return {
		bodyText: typeof declared.bodyText === "number" ? declared.bodyText : 4.5,
		largeText: typeof declared.largeText === "number" ? declared.largeText : 3,
		nonTextBoundary: typeof declared.nonTextBoundary === "number" ? declared.nonTextBoundary : 3,
		touch: tokens?.size?.touchTarget ?? { ios: 44, android: 48, minimum: 44, minimumVisualWithSlop: 32 },
	};
}
