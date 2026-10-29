/**
 * The catalogue registry — the app's only map from a locale to its messages.
 *
 * WHY A GENERATED TS PROJECTION RATHER THAN JSON IMPORTS. The authoring source is
 * `src/i18n/catalogues/<locale>/<namespace>.json` and stays that way; but part of
 * this app runs under plain Node (the CI proof scripts reach the runtime through
 * a feature module) and Node refuses a JSON import without an import attribute.
 * `scripts/i18n/generate.ts` therefore emits `catalogue.gen.ts` from the JSON, and
 * this module is the one place that turns it into a locale→catalogue map. One
 * authoring source, one projection, and `--check` fails if they drift.
 *
 * WHY THE KEYS ARE FULLY QUALIFIED IN THE CATALOGUE. A key is immutable and
 * already carries its namespace (`mobile.schedules.count.wakes`), so one flat map
 * per locale is enough: the namespace is a file-layout and review-boundary
 * decision, not a second lookup at render time. That matches the core and desktop
 * catalogues, and it means `t()` never needs to be told a namespace.
 *
 * TRANSLATIONS ARE NOT SHIPPED HERE. Only `en` exists: it is the SOURCE, and the
 * programme treats a catalogue filled by a translator as a separate wave with an
 * independent auditor. A locale directory appearing without passing that gate
 * must not become renderable, which is why `locale.ts` keeps its own shipped list
 * rather than trusting this registry's contents.
 */

import { ENGLISH_MESSAGES } from "./catalogue.gen";

/** One locale's messages: fully-qualified key → source text. */
export type Catalogue = Readonly<Record<string, string>>;

/** The English source. Keys are generated from the catalogues, so a key the
 *  catalogue does not define cannot be looked up at all. */
export const ENGLISH_CATALOGUE: Catalogue = ENGLISH_MESSAGES;

/** Every locale this build can render, keyed by the locale tag the resolver
 *  produces (`en`, not `en-US`). */
export const CATALOGUES: Readonly<Record<string, Catalogue>> = {
	en: ENGLISH_CATALOGUE,
};
