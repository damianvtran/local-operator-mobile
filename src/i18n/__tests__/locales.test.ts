import { describe, expect, it } from "vitest";

import {
	CATALOGUES,
	NOT_YET_SHIPPED_LOCALES,
	normalizeLocaleTag,
	SHIPPED_LOCALES,
	SUPPORTED_LOCALES,
} from "@/i18n";

/**
 * The supported/shipped split, bound to each other.
 *
 * WHY THIS EXISTS. `SHIPPED_LOCALES` answers "what can this build render today";
 * `SUPPORTED_LOCALES` answers "what must the next change be translated into".
 * They are different questions with different right answers, and the gap between
 * them is where a language silently stops being translated: adding a locale to
 * one list and forgetting the other leaves either an untranslated supported
 * language or a catalogue directory nobody promised. These assertions make the
 * gap an explicit entry in `NOT_YET_SHIPPED_LOCALES` instead — one conscious
 * decision per locale, reviewed as a diff — which is what
 * `docs/i18n.md` tells a contributor to expect.
 *
 * The catalogue DIRECTORY is already compared with `SHIPPED_LOCALES` in
 * `catalogues.test.ts`; this file covers the decision behind that list.
 */
describe("the locale manifest", () => {
	it("makes every supported locale a stated decision", () => {
		/* The rule the manifest exists for: a supported locale is either shipped
		 * or explicitly pending. A new language added to `SUPPORTED_LOCALES` and
		 * nowhere else fails here, which is the moment to say whether its copy
		 * ships in this wave. */
		const shipped = new Set<string>(SHIPPED_LOCALES);
		const pending = new Set<string>(NOT_YET_SHIPPED_LOCALES);
		const undecided = SUPPORTED_LOCALES.filter(
			(locale) => !shipped.has(locale) && !pending.has(locale),
		);

		expect(undecided).toEqual([]);
	});

	it("keeps the pending list inside the supported set and out of the shipped one", () => {
		/* A pending locale that is not supported is a typo the decision test above
		 * cannot see (it would read as a supported locale with no problem), and a
		 * locale both pending and shipped is a contradiction the two lists should
		 * never express. Both are cheap to state once. */
		const supported = new Set<string>(SUPPORTED_LOCALES);
		const shipped = new Set<string>(SHIPPED_LOCALES);

		expect(
			NOT_YET_SHIPPED_LOCALES.filter((locale) => !supported.has(locale)),
		).toEqual([]);
		expect(
			NOT_YET_SHIPPED_LOCALES.filter((locale) => shipped.has(locale)),
		).toEqual([]);
	});

	it("names every locale in a tag the resolver can match", () => {
		/* `normalizeLocaleTag` canonicalizes the relay's tag before any lookup, so
		 * a manifest entry the normalizer rewrites (`zh_cn`, `EN`, `pt-br`) could
		 * never equal itself and would never be found. The manifest is written in
		 * canonical tags, not in whatever spelling a translation introduced. */
		const rewritten = SUPPORTED_LOCALES.filter(
			(locale) => normalizeLocaleTag(locale) !== locale,
		);

		expect(rewritten).toEqual([]);
	});

	it("renders exactly the shipped locales", () => {
		/* The other half of the promise: being listed as shipped without a
		 * catalogue in `CATALOGUES` would render English for a locale the manifest
		 * calls shipped. `catalogues.test.ts` binds the directories; this binds the
		 * runtime map the renderer actually reads. */
		expect(Object.keys(CATALOGUES).sort()).toEqual([...SHIPPED_LOCALES].sort());
	});
});
