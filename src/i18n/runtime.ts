import { IntlMessageFormat } from "intl-messageformat";

import englishHome from "../../i18n/catalogues/en/mobile.home.json";
import config from "./config.json";
import type { Translator } from "./keys.gen";

export interface Catalogues {
	readonly [locale: string]: {
		readonly [namespace: string]: { readonly [key: string]: string };
	};
}
export type Params = Record<string, string | number | Date>;

/** Bundled publication is intentionally English-only. A backend can resolve to
 * another supported locale without granting this client permission to publish
 * unaudited catalogues. Test fixtures may inject other catalogues explicitly. */
const BUNDLED: Catalogues = { en: { "mobile.home": englishHome } };

const metadata: Readonly<Record<string, { direction: string }>> = config.locales;
const directionFor = (locale: string): "ltr" | "rtl" => metadata[locale]?.direction === "rtl" ? "rtl" : "ltr";

export function resolveMessage(locale: string, key: string, catalogues: Catalogues = BUNDLED): { source: string; locale: string; direction: "ltr" | "rtl" } {
	const namespace = key.slice(0, key.lastIndexOf("."));
	const local = catalogues[locale]?.[namespace]?.[key];
	if (local !== undefined) return { source: local, locale, direction: directionFor(locale) };
	return { source: catalogues.en?.[namespace]?.[key] ?? key, locale: "en", direction: "ltr" };
}

export function formatMessage(locale: string, key: string, params: Params = {}, catalogues: Catalogues = BUNDLED): string {
	const message = resolveMessage(locale, key, catalogues);
	// The source owns plural/number semantics: requested ru must not turn the
	// English fallback for 21 into "21 job". Never pass the requested locale here.
	const rendered = new IntlMessageFormat(message.source, message.locale, undefined, { ignoreTag: true }).format(params);
	if (typeof rendered !== "string") throw new Error(`Non-text i18n message: ${key}`);
	return rendered;
}

export function createTranslator(locale: string): Translator {
	return (key: string, params?: Params) => formatMessage(locale, key, params);
}
