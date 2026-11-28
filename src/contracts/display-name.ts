/**
 * An organisation name (or any host-supplied label) made safe to put into a
 * sentence the member is about to ACT on.
 *
 * WHY HERE, ON PARSE. Radient Guard's consent question interpolates the org name
 * into the title, the reason line, the indicators and every outcome, and the
 * member answers "share my stats with <that name>?" from it. The real host
 * already flattens every name it ships (`surface.one_line`: every Unicode `C*`
 * character becomes a space, capped at 80), so this is defence in depth against
 * a hostile or buggy relay (security S-4, PR #402): a name carrying a newline, a
 * right-to-left override or 500 characters of forged sentence must not be able
 * to rewrite the question above the Share button. Doing it in the wire schema
 * (not at each of the ~20 interpolation sites) means no screen can forget.
 *
 * Same discipline as `accountDisplayLabel` (connection/radient-oauth.ts) and the
 * desktop UI: whitespace controls read as one space, every other control and
 * format character (bidi embeddings/overrides/isolates, LRM/RLM/ALM, zero-width
 * space, BOM, tags) is removed, EXCEPT ZWNJ (U+200C) and ZWJ (U+200D), which
 * Persian/Urdu/Hindi orthography and emoji sequences need to spell a name
 * correctly. `\p{…}` is already relied on under Hermes elsewhere in this app.
 */

/** The host's own cap (`surface.one_line`); a longer name is a forged sentence,
 *  not a name. Counted in code points so a cut never splits a surrogate pair. */
export const DISPLAY_NAME_MAX_CODE_POINTS = 80;

const WHITESPACE = /[\s\u0085\u2028\u2029]+/gu;
const INVISIBLE = /(?![\u200c\u200d])[\p{Cc}\p{Cf}]/gu;

export function displayName(value: string): string {
	const visible = value.replace(WHITESPACE, " ").replace(INVISIBLE, "").trim();
	const points = Array.from(visible);
	if (points.length <= DISPLAY_NAME_MAX_CODE_POINTS) return visible;
	return `${points
		.slice(0, DISPLAY_NAME_MAX_CODE_POINTS - 1)
		.join("")
		.trimEnd()}…`;
}
