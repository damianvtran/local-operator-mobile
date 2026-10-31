/**
 * Where the client's locale comes from — and the ONLY place that answers that.
 *
 * THE BACKEND OWNS THE LANGUAGE. There is no phone-local language preference in
 * this app, and this module deliberately cannot create one: the relay resolves
 * the operator's single `language` setting (`auto` → `LOP_LANG` → OS → `en`, then
 * filters it through its shipped set) and pushes the RESULT down
 * `/api/config/events`, which the app already stores:
 *
 *   `configStore.language` in `src/state/config-store.ts` — "The RESOLVED locale
 *   tag the last frame carried… Never the raw setting: the relay resolves `auto`
 *   before it is sent, and an unshipped configured tag arrives as `en`."
 *
 * `src/features/auth/connection-provider.tsx` owns that store as a process-wide
 * singleton and registers it here with one line. This module holds a FUNCTION
 * rather than the store itself so the runtime stays importable from a Node test
 * (the provider imports `react-native`; a copy module must not).
 *
 * WHAT THE CLIENT DOES WITH THE TAG. It filters it through its OWN shipped set
 * before rendering, rather than trusting the relay: a newer relay may recognize a
 * locale this build has no catalogue for, and the programme's rule is that an
 * unshipped candidate renders ENGLISH SOURCE — not the next preference, and never
 * the key. With only `en` shipped today, every preference resolves to English
 * source, which is why this slice changes no rendered byte.
 *
 * The tag is normalized once, here: `en_us`, `EN-US` and `en-US` are one locale,
 * so a catalogue lookup, a plural-rule lookup and a direction lookup cannot
 * disagree about what the reader asked for.
 */

/**
 * Every language the programme will translate this app into — the manifest a
 * contributor reads INSTEAD of inferring the set from the catalogue directories.
 *
 * WHAT "SUPPORTED" PROMISES: every key must reach this locale, not only English.
 * A feature is not done until it is localized in all of them; "English first,
 * translate later" is a missing feature, not a follow-up. The set is the
 * programme's, not this client's invention — it mirrors the core repository's
 * `i18n/languages.json` (`en` as `source`, the rest `supported`) because the
 * relay resolves ONE language for the whole product, and a phone translating a
 * different set would answer a French reader partly in French.
 *
 * WHY IT IS TYPED AND TESTED. Recognizing a language and shipping its copy are
 * two different decisions, and `locales.test.ts` refuses a supported locale that
 * is neither shipped nor explicitly pending — so adding a language here is the
 * deliberate "the next copy needs it" moment rather than a silent one. Removing
 * one is a product decision, never a code cleanup.
 */
export const SUPPORTED_LOCALES = [
	"en",
	"fr",
	"es",
	"zh-CN",
	"ru",
	"vi",
	"ur",
	"hi",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Supported locales this build has no catalogue for; English source stands in
 * for them until their translation wave ships. `locales.test.ts` requires every
 * supported locale to be listed here or in `SHIPPED_LOCALES`, so flipping one is
 * a reviewed change rather than a forgotten one.
 */
/* Every supported locale now ships a catalogue: this list is empty on purpose
 * rather than deleted, because the next target locale starts here and the test
 * that keeps the two lists exhaustive reads it. */
export const NOT_YET_SHIPPED_LOCALES =
	[] as const satisfies readonly SupportedLocale[];

/** The locale directories this build actually ships. Being in this list is not
 *  enough: the locale must also be projected by `generate.ts` into
 *  `catalogue.gen.ts`, which `catalogues.ts` now builds `CATALOGUES` from — the
 *  registry is derived from this list rather than hand-written beside it, so a
 *  locale listed here without a translated directory throws at import and fails
 *  `catalogues.test.ts`. A subset of `SUPPORTED_LOCALES`, enforced by the type. */
export const SHIPPED_LOCALES = [
	"en",
	"fr",
	"es",
	"zh-CN",
	"ru",
	"vi",
	"hi",
	"ur",
] as const satisfies readonly SupportedLocale[];

export type ShippedLocale = (typeof SHIPPED_LOCALES)[number];

/** A process-wide reader for the relay's resolved language. Returns `null`
 *  before the first config frame (and on a relay too old to serve the route). */
export type LocaleSource = () => string | null;

let source: LocaleSource = () => null;

/**
 * Point the runtime at the app's config store. Called once from
 * `connection-provider.tsx`; tests call it with a stub, and `null` puts the
 * runtime back to "no frame yet" (English).
 */
export function setLocaleSource(next: LocaleSource | null): void {
	source = next ?? (() => null);
}

export function resetLocaleSource(): void {
	source = () => null;
}

const LANGUAGE = /^[A-Za-z]{2,3}$/;
const REGION = /^[A-Za-z]{2}$/;
const SCRIPT = /^[A-Za-z]{4}$/;

/**
 * Canonicalize a BCP-47-ish tag: `en_us` → `en-US`, `EN` → `en`, `zh_hans` →
 * `zh-Hans`. `null` when the input is absent, blank or not a language tag.
 *
 * Only shape is canonicalized. Whether the locale is SHIPPED is a separate
 * question (`catalogueLocaleFor`), because "this is Urdu" and "this build has
 * Urdu copy" must stay two different answers.
 */
export function normalizeLocaleTag(
	tag: string | null | undefined,
): string | null {
	if (typeof tag !== "string") return null;
	const parts = tag.trim().replace(/_/g, "-").split("-").filter(Boolean);
	const language = parts[0];
	if (language === undefined || !LANGUAGE.test(language)) return null;
	const normalized = [language.toLowerCase()];
	for (const part of parts.slice(1)) {
		if (REGION.test(part)) {
			normalized.push(part.toUpperCase());
		} else if (SCRIPT.test(part)) {
			normalized.push(
				part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
			);
		} else {
			normalized.push(part.toLowerCase());
		}
	}
	return normalized.join("-");
}

/** The relay's resolved tag as the app last received it, normalized; `null`
 *  before any config frame. */
export function preferredLocale(): string | null {
	return normalizeLocaleTag(source());
}

/**
 * The catalogue locale that will actually be rendered for `tag`, or `null` when
 * the tag is not shipped (the caller then uses English source).
 *
 * `en-GB` finds the `en` catalogue, because English variants share one source;
 * a shipped locale that carried its own region (`pt-BR`) would be matched
 * exactly first, so this does not flatten a future region-specific catalogue.
 */
export function catalogueLocaleFor(
	tag: string | null | undefined,
): ShippedLocale | null {
	const normalized = normalizeLocaleTag(tag);
	if (normalized === null) return null;
	if ((SHIPPED_LOCALES as readonly string[]).includes(normalized)) {
		return normalized as ShippedLocale;
	}
	const primary = normalized.split("-")[0];
	if (primary === undefined) return null;
	return (SHIPPED_LOCALES as readonly string[]).includes(primary)
		? (primary as ShippedLocale)
		: null;
}

/**
 * The locale the runtime renders in: the shipped catalogue for the relay's
 * preference, else English. This is the value `t()` reads, so a missing frame,
 * an absent relay route and an unshipped tag all land on English source.
 */
export function activeLocale(): ShippedLocale {
	return catalogueLocaleFor(preferredLocale()) ?? "en";
}
