/**
 * The catalogue registry — the app's only map from a locale to its messages.
 *
 * WHY A GENERATED TS PROJECTION RATHER THAN JSON IMPORTS. The authoring source is
 * `src/i18n/catalogues/<locale>/<namespace>.json` and stays that way; but part of
 * this app runs under plain Node (the CI proof scripts reach the runtime through
 * a feature module) and Node refuses a JSON import without an import attribute.
 * `scripts/i18n/generate.ts` therefore emits `catalogue.gen.ts` from the JSON —
 * the English source AND every other locale directory beside it — and this module
 * is the one place that turns it into a locale→catalogue map. One authoring
 * source, one projection, and `--check` fails if they drift.
 *
 * WHY THE KEYS ARE FULLY QUALIFIED IN THE CATALOGUE. A key is immutable and
 * already carries its namespace (`mobile.schedules.count.wakes`), so one flat map
 * per locale is enough: the namespace is a file-layout and review-boundary
 * decision, not a second lookup at render time. That matches the core and desktop
 * catalogues, and it means `t()` never needs to be told a namespace.
 *
 * WHAT SHIPS IS A SEPARATE DECISION. The projection carries every translated
 * locale that exists on disk, so `catalogues.ts` no longer hand-copies anything;
 * but a locale is renderable only once `SHIPPED_LOCALES` in `locale.ts` names it.
 * That list is the reviewed ship decision (translation plus independent audit),
 * and building this map FROM it means the two cannot disagree: a shipped locale
 * with no projection throws here instead of quietly rendering English.
 */

import { ENGLISH_MESSAGES, LOCALISED_MESSAGES } from "./catalogue.gen";
import { SHIPPED_LOCALES, type ShippedLocale } from "./locale";

/** One locale's messages: fully-qualified key → source text. */
export type Catalogue = Readonly<Record<string, string>>;

/** The English source. Keys are generated from the catalogues, so a key the
 *  catalogue does not define cannot be looked up at all. */
export const ENGLISH_CATALOGUE: Catalogue = ENGLISH_MESSAGES;

/** Every projected locale, shipped or not, keyed by its catalogue directory. */
const PROJECTED: Readonly<Record<string, Catalogue>> = {
	en: ENGLISH_CATALOGUE,
	...LOCALISED_MESSAGES,
};

function catalogueFor(locale: ShippedLocale): Catalogue {
	const catalogue = PROJECTED[locale];
	if (catalogue === undefined) {
		/* Unreachable while `generate.ts` projects every directory and the tests
		 * bind the directories to this list — which is exactly why it throws
		 * rather than falling back: a shipped locale rendering English is the
		 * silent failure this registry exists to prevent. */
		throw new RangeError(
			`No catalogue for shipped locale ${locale}; add src/i18n/catalogues/${locale}/ or remove it from SHIPPED_LOCALES`,
		);
	}
	return catalogue;
}

/** Every locale this build can render, keyed by the locale tag the resolver
 *  produces (`en`, not `en-US`) — exactly the shipped set, no more. */
export const CATALOGUES: Readonly<Record<ShippedLocale, Catalogue>> =
	/* `Object.fromEntries` types its result as a string-keyed record; the cast
	 * restates the contract this module does prove — one entry per shipped locale,
	 * because the list is the input and `catalogueFor` throws for a missing one. */
	Object.fromEntries(
		SHIPPED_LOCALES.map((locale) => [locale, catalogueFor(locale)]),
	) as Readonly<Record<ShippedLocale, Catalogue>>;
