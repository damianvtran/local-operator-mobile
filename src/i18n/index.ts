/**
 * The i18n runtime's public surface.
 *
 * Screens and copy modules import from here, never from a file path inside the
 * directory: the catalogue layout, the parser and the locale source are
 * implementation, and a future replacement of any one of them should not touch a
 * caller. Named exports rather than `export *` so this list is the contract a
 * reader can audit.
 */

export type {
	CatalogueContext,
	CatalogueKey,
	ContextRole,
	MessageParams,
	NoParamKey,
	ParamKey,
} from "./catalogue.gen";
export { ENGLISH_CONTEXT, ENGLISH_MESSAGES } from "./catalogue.gen";
export type { Catalogue } from "./catalogues";
export { CATALOGUES, ENGLISH_CATALOGUE } from "./catalogues";
export type { TextDirection } from "./direction";
export { activeDirection, directionFor } from "./direction";
export type { LocaleSource, ShippedLocale } from "./locale";
export {
	activeLocale,
	catalogueLocaleFor,
	normalizeLocaleTag,
	preferredLocale,
	resetLocaleSource,
	SHIPPED_LOCALES,
	setLocaleSource,
} from "./locale";
export type {
	MessageArgumentKind,
	MessageArguments,
	ParsedMessage,
} from "./messages";
export { formatMessage, parseMessage, pluralCategory } from "./messages";
export { renderFor, t } from "./runtime";
