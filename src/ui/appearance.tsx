import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { Uniwind, useCSSVariable } from "uniwind";

import { hydrateWhenAvailable } from "@/state/hydrate-when-available";
import { preferenceStore, subscribeAppActive } from "@/state/preferences";
import {
	activeThemeId,
	parseSelection,
	serializeSelectionOver,
	THEME_SELECTION_KEY,
	type ThemeMode,
	type ThemeSelection,
} from "@/state/theme-preference";
import { useUiStore } from "@/state/ui-store";
import {
	COLOR_ROLES,
	type ColorRole,
	cssColorVar,
	resolveTheme,
	type ThemeEntry,
	type ThemeName,
	themeEntry,
} from "@/ui/tokens.gen";

/**
 * The app's view of appearance: which theme is active, how to change it, and how
 * to read a token's value in JavaScript.
 *
 * Two decisions, kept apart:
 *
 *   - WHICH SIDE renders (light or dark) is `resolveTheme` in the generated
 *     token module, a pure function of the mode and the OS scheme. Uniwind owns
 *     it at run time through `setTheme`, which is what keeps every `dark:`
 *     variant and the `system` media follow working: the two compiled themes,
 *     `light` and `dark`, stay the only ones Uniwind knows.
 *   - WHICH PALETTE paints that side is the reader's slot (`lightTheme` /
 *     `darkTheme`), applied by overwriting the side's colour variables with
 *     `Uniwind.updateCSSVariables(side, vars)`.
 *
 * WHY `updateCSSVariables` AND NOT 55 COMPILED THEMES (record § 5, "Runtime").
 * Registering every palette as a Uniwind `extraTheme` would compile 55 copies of
 * every themed class into the bundle and break the `dark:` variants, which only
 * know `light` and `dark`. Spike, read from uniwind 1.12.0's own source (not yet
 * observed on a device — the native frames are the proof): on native,
 * `updateCSSVariables` replaces the side's variable getters in `UniwindStore.vars`
 * and notifies `StyleDependency.Variables`; every style that reads a variable
 * subscribes to that dependency (`metro/transformer.mjs`, "usedVars.length > 0
 * -> Variables"), and the cached style is dropped on the same notification, so
 * mounted components re-resolve. On the web it writes one `.light {}` /
 * `.dark {}` rule and the cascade does the rest. `useCSSVariable` subscribes to
 * the same dependency, which is what keeps icon colours and the status bar in
 * step. The fallback, should a device show a stale style, is a remount keyed on
 * the active theme id (see `ThemeProvider`'s `key`), not compiled themes.
 *
 * There is no context to read: the selection lives in the UI store, and a second
 * copy in React context would be a second answer to the same question.
 */

/** The side the OS is on, narrowed: React Native's `ColorSchemeName` can also
 *  be "unspecified", which the resolver treats as "no answer". */
const useSystemScheme = (): ThemeName | null => {
	const scheme = useColorScheme();
	return scheme === "dark" ? "dark" : scheme === "light" ? "light" : null;
};

/** Every colour role of `entry` as the CSS variables Uniwind reads. */
const variablesFor = (entry: ThemeEntry): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const role of COLOR_ROLES) out[cssColorVar(role)] = entry.colors[role];
	return out;
};

/**
 * Apply the stored selection to the styling system, and keep it stored.
 *
 * Effects, not render-time calls: each is a side effect on a module that
 * outlives React, so doing it during render would mutate global state on every
 * re-render and leave a discarded render's theme applied.
 *
 * Both sides' palettes are written, not just the visible one: under `system` the
 * OS can flip the side at any moment, and Uniwind switches sides without asking
 * React, so the side that is not showing has to be correct already.
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
	const selection = useUiStore((state) => state.themeSelection);
	const hydrated = useUiStore((state) => state.themeHydrated);
	const hydrate = useUiStore((state) => state.hydrateThemeSelection);

	/* What was last read or written: the bytes, and the selection they parsed
	 *  to. The persist effect writes only what the reader changed relative to it
	 *  (`serializeSelectionOver`), so a value this build cannot display is never
	 *  overwritten by the default it displays instead. */
	const stored = useRef<{
		raw: string | null;
		selection: ThemeSelection;
	} | null>(null);

	/* An unreadable store renders the default WITHOUT hydrating: the store stays
	 *  unhydrated, so the persist effect below cannot write that default over the
	 *  reader's choice, and the read is retried on the next `active` (a locked
	 *  background launch is the case; see `hydrateWhenAvailable`). Appearance is
	 *  still never a reason not to render. */
	useEffect(
		() =>
			hydrateWhenAvailable({
				read: () => preferenceStore.get(THEME_SELECTION_KEY),
				onValue: (raw) => {
					const selection = parseSelection(raw);
					stored.current = { raw, selection };
					hydrate(selection);
				},
				subscribeActive: subscribeAppActive,
			}),
		[hydrate],
	);

	useEffect(() => {
		Uniwind.updateCSSVariables(
			"light",
			variablesFor(themeEntry(selection.lightTheme, "light")),
		);
		Uniwind.updateCSSVariables(
			"dark",
			variablesFor(themeEntry(selection.darkTheme, "dark")),
		);
		Uniwind.setTheme(selection.mode);
	}, [selection]);

	useEffect(() => {
		// Never before hydration: the default it holds would overwrite the choice
		// it is about to read. Never for the selection just read, either: writing
		// back what was read is how a display fallback became a stored reset.
		const previous = stored.current;
		if (!hydrated || previous === null || selection === previous.selection)
			return;
		const raw = serializeSelectionOver(
			previous.raw,
			previous.selection,
			selection,
		);
		stored.current = { raw, selection };
		preferenceStore.set(THEME_SELECTION_KEY, raw).catch(() => {
			// A failed write costs persistence across a relaunch, not the
			// choice on screen, and there is nobody to tell mid-tap.
		});
	}, [hydrated, selection]);

	return children;
};

export type Theme = {
	/** What the reader chose: the mode and both slots. */
	selection: ThemeSelection;
	setSelection: (selection: ThemeSelection) => void;
	/** The mode alone (System / Light / Dark). */
	preference: ThemeMode;
	setPreference: (mode: ThemeMode) => void;
	/** The side that renders. Differs from `preference` only for `system`. */
	theme: ThemeName;
	isDark: boolean;
	/** The palette that paints right now. */
	active: ThemeEntry;
};

/** The active theme. `selection` is the choice; `theme` and `active` the result. */
export const useTheme = (): Theme => {
	const selection = useUiStore((state) => state.themeSelection);
	const setSelection = useUiStore((state) => state.setThemeSelection);
	const setPreference = useUiStore((state) => state.setThemeMode);
	const systemScheme = useSystemScheme();
	const theme = resolveTheme(selection.mode, systemScheme);
	const active = useMemo(
		() => themeEntry(activeThemeId(selection, theme), theme),
		[selection, theme],
	);
	return {
		selection,
		setSelection,
		preference: selection.mode,
		setPreference,
		theme,
		isDark: theme === "dark",
		active,
	};
};

/**
 * The keyboard's appearance for the ACTIVE theme, for every `TextInput`.
 *
 * iOS draws the keyboard in its own light or dark material; left on `default`
 * it follows the OS, so a reader who forces Dark on a light phone typed on a
 * white keyboard under a dark composer. One hook so every field agrees; Android
 * ignores the prop (its IME owns its own theme).
 */
export const useKeyboardAppearance = (): "light" | "dark" =>
	useTheme().isDark ? "dark" : "light";

/**
 * A token's value as a string, for the APIs that cannot take a class name.
 *
 * Exactly two cases need this: a vector icon's `color` prop (an SVG cannot
 * inherit a text colour, so `text-ink-muted` has to become a value) and native
 * chrome such as the status bar. Everything else uses `className`, which is
 * cheaper and cannot drift out of theme.
 *
 * The value comes from the live CSS variable so it tracks a theme change; the
 * active palette from the generated catalogue is the fallback for the frame before the variable resolves
 * and for a role that no `className` currently uses — Uniwind only exposes the
 * variables it has seen in a class, and an icon painted with `undefined` is
 * invisible rather than merely wrong.
 */
export const useTokenColor = (role: ColorRole): string => {
	const { active } = useTheme();
	const variable = useCSSVariable(cssColorVar(role));
	if (typeof variable === "string" && variable.length > 0) return variable;
	return active.colors[role];
};

/**
 * Whether the reader has asked for reduced motion.
 *
 * One place answers "should this move", so a later data-saver or low-power signal
 * can be folded into the same flag rather than consulted separately at every
 * animation (`tokens.json § motion.reducedMotion.detect`).
 */
export const useReducedMotion = (initial = false): boolean => {
	const [reduce, setReduce] = useState(initial);

	useEffect(() => {
		let cancelled = false;
		AccessibilityInfo.isReduceMotionEnabled()
			.then((enabled) => {
				if (!cancelled) setReduce(enabled);
			})
			.catch(() => {
				// Keep the caller's initial policy if the platform has no reading.
				// An optional reveal can stay off; control feedback defaults on.
			});
		const subscription = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			setReduce,
		);
		return () => {
			cancelled = true;
			subscription.remove();
		};
	}, []);

	return reduce;
};
