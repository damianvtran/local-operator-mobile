import {
	DEFAULT_THEME_IDS,
	isThemeId,
	type ThemeId,
	type ThemeName,
} from "@/ui/tokens.gen";

/**
 * The reader's appearance choice: a mode, plus one theme per slot.
 *
 * `mode` is what the old three-way control chose (follow the device, or force
 * one side); `lightTheme` and `darkTheme` are WHICH palette each side paints.
 * Two slots rather than one theme id is the desktop relay's model and the only
 * one that keeps `system` meaningful with 55 themes: under System the phone
 * still flips with the OS, it just flips between the reader's two picks
 * (decision record `mobile-design-direction.md` § 5, "Preference model").
 *
 * Pure data and pure functions, no React Native: the store and its tests stay
 * importable from Node.
 */
export type ThemeMode = "system" | "light" | "dark";

export type ThemeSelection = {
	mode: ThemeMode;
	lightTheme: ThemeId;
	darkTheme: ThemeId;
};

export const DEFAULT_SELECTION: ThemeSelection = {
	// `system` because it is the only mode that is correct without knowing
	// anything about the reader; the brand pair because it is the desktop's
	// default too.
	mode: "system",
	lightTheme: DEFAULT_THEME_IDS.light,
	darkTheme: DEFAULT_THEME_IDS.dark,
};

/** The device-store key. Versioned in the value, not the key, so a future
 *  shape can still read this one. */
export const THEME_SELECTION_KEY = "lo-mobile-appearance";
const VERSION = 1;

const isMode = (value: unknown): value is ThemeMode =>
	value === "system" || value === "light" || value === "dark";

/**
 * Read a stored selection, from ANY shape a previous build could have written.
 *
 * Two legacy shapes are accepted and migrated rather than discarded:
 *   - a bare mode string (`"dark"`), the old `ThemePreference`, which is what a
 *     reader's choice amounts to before this change (until now it lived only in
 *     memory, so in practice this is the shape a test or an older store hands
 *     over) — it becomes `mode`, with the default pair;
 *   - an object with a theme id the build no longer ships (withheld by the
 *     contrast gate, or renamed upstream), or of the wrong mode for its slot —
 *     that slot alone falls back to its default.
 * Anything unreadable is the default: a corrupt preference must never leave the
 * app unthemed or throw during boot.
 */
export const parseSelection = (
	raw: string | null | undefined,
): ThemeSelection => {
	if (raw === null || raw === undefined || raw === "") return DEFAULT_SELECTION;
	let value: unknown = raw;
	try {
		value = JSON.parse(raw);
	} catch {
		// A bare, unquoted mode written by hand or by an older writer.
	}
	if (isMode(value)) return { ...DEFAULT_SELECTION, mode: value };
	if (typeof value !== "object" || value === null) return DEFAULT_SELECTION;
	const record = value as Record<string, unknown>;
	return {
		mode: isMode(record.mode) ? record.mode : DEFAULT_SELECTION.mode,
		lightTheme: isThemeId(record.lightTheme, "light")
			? record.lightTheme
			: DEFAULT_SELECTION.lightTheme,
		darkTheme: isThemeId(record.darkTheme, "dark")
			? record.darkTheme
			: DEFAULT_SELECTION.darkTheme,
	};
};

export const serializeSelection = (selection: ThemeSelection): string =>
	JSON.stringify({ v: VERSION, ...selection });

/**
 * A tap on a theme card. It fills that theme's slot; when the mode is FORCED to
 * the other side, it also switches the mode, so a tap always visibly does
 * something. Under `system` it only fills the slot, and the picker's caption
 * says when the slot shows (record § 5, "Behaviour").
 */
export const chooseTheme = (
	selection: ThemeSelection,
	id: ThemeId,
	themeMode: ThemeName,
): ThemeSelection => {
	const slot = themeMode === "light" ? "lightTheme" : "darkTheme";
	const next = { ...selection, [slot]: id };
	if (selection.mode !== "system" && selection.mode !== themeMode)
		next.mode = themeMode;
	return next;
};

/** The theme id that paints right now, given the OS scheme. */
export const activeThemeId = (
	selection: ThemeSelection,
	resolved: ThemeName,
): ThemeId =>
	resolved === "light" ? selection.lightTheme : selection.darkTheme;
