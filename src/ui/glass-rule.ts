/**
 * When the composer and its chips are drawn as Liquid Glass, and what the
 * glass is tinted with — pure, so the rule is asserted in Node.
 *
 * WHY THIS RULE (decision record 2026-11-04 §4). The operator asked for the
 * native iOS 26 composer material. `expo-glass-effect` renders it through
 * `UIGlassEffect`, but only where the OS has it; elsewhere its JS falls back
 * to a plain `View`, which would paint NOTHING (no fill) — so the fallback
 * cannot be left to the library: this app paints the solid `elevated` fill
 * itself whenever glass is off.
 *
 * Glass is ON only when every one of these holds:
 *  - iOS (the module is Apple-only);
 *  - `isGlassEffectAPIAvailable()` — guards the early iOS 26 betas whose
 *    glass API crashes (expo/expo#40911), so availability alone is not enough;
 *  - `isLiquidGlassAvailable()` — iOS 26+ and a build linked against it;
 *  - Reduce Transparency is OFF. With it on, iOS itself replaces materials
 *    with opaque fills; an app that keeps a translucent composer then reads
 *    as broken, and the setting is an accessibility request, not a style.
 *
 * Glass changes the FILL only. Every box — margins, radii, padding — is
 * identical across the three fills (glass, solid on iOS < 26, solid with
 * Reduce Transparency), so a glass frame and a fallback frame are
 * pixel-comparable and the acceptance diff of their boxes is zero.
 */

export type GlassFacts = {
	platform: string;
	apiAvailable: boolean;
	liquidGlassAvailable: boolean;
	reduceTransparency: boolean;
};

export const glassEnabled = (facts: GlassFacts): boolean =>
	facts.platform === "ios" &&
	facts.apiAvailable &&
	facts.liquidGlassAvailable &&
	!facts.reduceTransparency;

/**
 * The same rule, fed what the accessibility read has actually returned.
 *
 * `reduceTransparency` is `null` UNTIL THE READ RESOLVES, and a null must read as
 * "the reader asked for solid" rather than as "the reader asked for nothing"
 * (review round 1, R163-2): the setting is an accessibility request, so a frame
 * drawn before it is known has to honour the request it cannot see yet. Only a
 * resolved `false` turns glass on, which also makes a REJECTED read fail safe —
 * the state stays null and the composer keeps its solid fill.
 */
export const chromeGlass = (facts: {
	platform: string;
	available: boolean;
	reduceTransparency: boolean | null;
}): boolean =>
	glassEnabled({
		platform: facts.platform,
		apiAvailable: facts.available,
		liquidGlassAvailable: facts.available,
		reduceTransparency: facts.reduceTransparency !== false,
	});

/** Alpha of the `elevated` tint laid over the glass: enough of the theme's own
 *  ground that the placeholder keeps its contrast over a bright transcript
 *  row, while the material still reads as glass (record §4, "Legibility"). */
export const GLASS_TINT_ALPHA = 0.6;

/**
 * `#rrggbb` (or `#rgb`) plus an alpha, as an 8-digit hex the native view
 * accepts. A colour that is not hex (a CSS variable not yet resolved, an
 * `rgb()` string) is returned untouched: the glass then takes the opaque
 * tint, which is the legible failure direction.
 */
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#([0-9a-f]{6})$/i;

export const withAlpha = (color: string, alpha: number): string => {
	const hex = color.trim();
	const short = SHORT_HEX.exec(hex);
	const long = LONG_HEX.exec(hex);
	const rgb = short
		? `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
		: long?.[1];
	if (rgb === undefined) return color;
	const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
		.toString(16)
		.padStart(2, "0");
	return `#${rgb}${a}`;
};
