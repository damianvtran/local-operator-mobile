/**
 * `t()` — the one call a screen makes to get user-facing text.
 *
 * THREE GUARANTEES, each with a test:
 *
 * 1. **The key is typed.** `CatalogueKey` is generated from the English
 *    catalogues, and `MessageParams` carries each message's arguments, so an
 *    unknown key, a misspelled key, a missing argument, a wrong argument type or
 *    a stray argument on a parameterless key is a `tsc` error. Nothing renders
 *    `undefined` because nothing can reach the renderer to do it.
 * 2. **English is the floor, not a special case.** A preference with no shipped
 *    catalogue renders the ENGLISH SOURCE: the sentence, never the key and never
 *    an empty string. If the preference's catalogue HAS the key, that text is
 *    used; if it merely exists but lacks this namespace, English is used rather
 *    than falling through to a second preference.
 * 3. **An English fallback is formatted with English rules.** The locale passed
 *    to the plural selector is the locale the MESSAGE came from, not the reader's
 *    preference. Otherwise a Russian preference reading an English fallback would
 *    render `21 wake` — the programme names this exact failure. `renderFor`
 *    below is where that decision lives.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: live re-render on a locale change. The four
 * copy modules export their strings as `const`s because every screen and test
 * reads them as values, so those constants resolve once, at import. Functions
 * (`deleteProjectBody`, `wakeCadenceWord`, …) call `t()` per invocation and do
 * re-resolve. Converting the constants to a hook is a screen rewrite and belongs
 * to the wave that lands translations; it is not smuggled in here.
 */

import type {
	CatalogueKey,
	MessageParams,
	NoParamKey,
	ParamKey,
} from "./catalogue.gen";
import { CATALOGUES, ENGLISH_CATALOGUE } from "./catalogues";
import { catalogueLocaleFor, preferredLocale } from "./locale";
import { formatMessage, type MessageArguments, parseMessage } from "./messages";

export type { CatalogueKey, MessageParams, NoParamKey, ParamKey };

/**
 * Render one key in the reader's locale, falling back to English source.
 *
 * TWO OVERLOADS, because the key surface has two shapes: a message with no
 * placeholders takes no second argument, and every other message takes exactly
 * one object of its declared parameters. That rejects — at compile time — an
 * unknown key, a misspelled key, a missing argument, a wrong argument type and a
 * stray argument on a parameterless key.
 */
export function t(key: NoParamKey): string;
export function t<K extends ParamKey>(key: K, params: MessageParams[K]): string;
export function t(key: CatalogueKey, params?: MessageArguments): string {
	return renderFor(key, params ?? {}, preferredLocale());
}

/**
 * Render `key` for an explicit preference tag. Exported for tests and for the
 * generator's round-trip check; screens use `t()`.
 */
export function renderFor(
	key: CatalogueKey,
	params: MessageArguments,
	preference: string | null,
): string {
	const catalogueLocale = catalogueLocaleFor(preference);
	const localized =
		catalogueLocale === null ? undefined : CATALOGUES[catalogueLocale]?.[key];
	/* The SOURCE locale is chosen with the text: a message that only exists in
	 * English is formatted with English plural rules even when the reader prefers
	 * another locale. A message present in the preference's own catalogue is
	 * formatted with that locale's rules. */
	const source = localized ?? ENGLISH_CATALOGUE[key];
	if (source === undefined) {
		/* Unreachable through the typed surface — the generated union is built
		 * from these same files. It throws rather than rendering `undefined` so a
		 * catalogue that drifts from its generated keys fails loudly in
		 * development instead of shipping a blank label. */
		throw new RangeError(`No English source for catalogue key ${key}`);
	}
	return formatMessage(
		parseMessage(source),
		params,
		localized === undefined ? "en" : (catalogueLocale ?? "en"),
	);
}
