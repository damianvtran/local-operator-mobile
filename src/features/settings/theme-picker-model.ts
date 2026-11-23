import { t } from "@/i18n";
import type { ThemeMode, ThemeSelection } from "@/state/theme-preference";
import { THEMES, type ThemeEntry, type ThemeName } from "@/ui/tokens.gen";

/**
 * The Theme picker's decisions, as pure functions the Node tests can pin
 * (decision record `mobile-design-direction.md` § 5, "Picker UX"). The screen
 * (`theme-picker.tsx`) only renders what these return.
 */

/** 2 columns from 320 to 599 pt, 3 at ≥ 600 (record § 5). Below 320 — a
 *  narrow split pane — one column, so a card never drops under its minimum. */
export const pickerColumns = (width: number): 1 | 2 | 3 =>
	width >= 600 ? 3 : width >= 320 ? 2 : 1;

/** Case- and accent-insensitive, so "rose" finds "Rosé Pine" and "rosewood". */
const fold = (text: string): string =>
	text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();

export type PickerSection = { mode: ThemeName; themes: readonly ThemeEntry[] };

/**
 * The two sections, filtered by `query` and ordered with the side the reader
 * is LOOKING AT first: the forced side, or under System the side the OS is on.
 * Inside a section the desktop's family order is kept (`THEMES` is generated in
 * that order). A section with no match is still returned, empty, so the screen
 * can say so instead of silently dropping a heading.
 */
export const pickerSections = (
	query: string,
	resolved: ThemeName,
	themes: readonly ThemeEntry[] = THEMES,
): PickerSection[] => {
	const needle = fold(query);
	const match = (entry: ThemeEntry) =>
		needle === "" ||
		fold(entry.name).includes(needle) ||
		fold(entry.id).includes(needle);
	const sides: ThemeName[] =
		resolved === "dark" ? ["dark", "light"] : ["light", "dark"];
	return sides.map((mode) => ({
		mode,
		themes: themes.filter((entry) => entry.mode === mode && match(entry)),
	}));
};

/** Whether `entry` is the theme its slot holds — the card's selected state. */
export const isSelectedTheme = (
	entry: ThemeEntry,
	selection: ThemeSelection,
): boolean =>
	entry.mode === "light"
		? selection.lightTheme === entry.id
		: selection.darkTheme === entry.id;

/** The caption's case: which sentence describes the pair (record § 5, "a
 *  caption with the current pair"). */
export type CaptionCase = { kind: ThemeMode; light: string; dark: string };

export const captionCase = (
	selection: ThemeSelection,
	names: { light: string; dark: string },
): CaptionCase => ({ kind: selection.mode, ...names });

/** The appearance modes, in the ONE order every mode control shows them:
 *  System first (the default, which follows the device), then the two forced
 *  sides Light and Dark. Settings and the Theme picker both draw from this, so
 *  the same three choices can never sit in two orders (UX pass, settings). */
export const THEME_MODE_ORDER: readonly ThemeMode[] = [
	"system",
	"light",
	"dark",
];

const MODE_LABEL = {
	system: "mobile.settings.theme.mode_system",
	light: "mobile.settings.theme.mode_light",
	dark: "mobile.settings.theme.mode_dark",
} as const satisfies Record<ThemeMode, string>;

/** The `Segmented` options for a mode control, in `THEME_MODE_ORDER`. Each
 *  surface passes its own test ids (the E2E flows address them), nothing else. */
export const themeModeOptions = (
	testIDs: Readonly<Record<ThemeMode, string>>,
): { value: ThemeMode; label: string; testID: string }[] =>
	THEME_MODE_ORDER.map((mode) => ({
		value: mode,
		label: t(MODE_LABEL[mode]),
		testID: testIDs[mode],
	}));
