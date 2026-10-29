/**
 * Text direction, resolved in ONE place so the later RTL pass has one thing to
 * read.
 *
 * THIS SLICE WIRES NOTHING. `I18nManager`, a direction-aware layout, mirrored
 * icons and bidi isolation are all deliberately out of scope: they change pixels
 * on every screen, and this slice's contract is that `en` output stays
 * byte-identical. What ships is the resolver and its tests.
 *
 * URDU IS THE ONLY RTL CLAIM. The programme supports one RTL locale so far, so
 * returning `rtl` for Arabic, Hebrew or Persian would be a promise no catalogue,
 * font or layout in this build backs. The alias set is the one the core's
 * `locale_direction` normalizes (`ur_PK`, `ur_IN` → `ur`), which
 * `normalizeLocaleTag` already handles, so the check is on the primary subtag.
 *
 * An unknown or absent tag is `ltr`: direction is never the place to fail a
 * render, and every shipped locale today is left-to-right.
 */

import { activeLocale, normalizeLocaleTag } from "./locale";

export type TextDirection = "rtl" | "ltr";

/** Primary subtags this build can call right-to-left. */
const RTL_LANGUAGES: ReadonlySet<string> = new Set(["ur"]);

/**
 * `rtl` for Urdu (any region or script), `ltr` for everything else — including
 * an absent tag, which is the pre-connection state.
 */
export function directionFor(tag: string | null | undefined): TextDirection {
	const normalized = normalizeLocaleTag(tag);
	if (normalized === null) return "ltr";
	const primary = normalized.split("-")[0];
	return primary !== undefined && RTL_LANGUAGES.has(primary) ? "rtl" : "ltr";
}

/**
 * The direction of the copy that will actually render.
 *
 * Bound to the ACTIVE catalogue, not the raw preference: an Urdu preference this
 * build cannot render lands on English source, and laying English out RTL would
 * be worse than not mirroring at all. The day `ur` joins `SHIPPED_LOCALES` and a
 * catalogue lands, this answers `rtl` with no call-site change — which is the
 * whole point of keeping the resolver in one place.
 */
export function activeDirection(): TextDirection {
	return directionFor(activeLocale());
}
