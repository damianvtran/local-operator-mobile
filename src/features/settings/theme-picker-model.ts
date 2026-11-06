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
