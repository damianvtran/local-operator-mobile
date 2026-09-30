import { useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { Uniwind, useCSSVariable } from "uniwind";

import { useUiStore } from "@/state/ui-store";
import {
	type ColorRole,
	cssColorVar,
	resolveColor,
	resolveTheme,
	type ThemeName,
	type ThemePreference,
} from "@/ui/tokens.gen";

/**
 * The app's view of appearance: which theme is active, how to change it, and how
 * to read a token's value in JavaScript.
 *
 * The decision of WHICH theme renders is `resolveTheme` in the generated token
 * module, a pure function the Node tests pin. This module only carries that
 * decision to the two systems that have to agree on it:
 *
 *   - Uniwind owns the compiled class names, so `setTheme('dark')` is what makes
 *     `bg-surface` resolve to the dark role on every platform, and `system` hands
 *     the choice back to the OS appearance.
 *   - React Native's `useColorScheme()` is where the OS appearance comes from
 *     while the preference is `system`.
 *
 * Reading the OS scheme here instead of asking Uniwind for a resolved name keeps
 * the preference and the resolution separable, which is what makes the `system`
 * case testable at all: `resolveTheme("system", "dark")` is a unit test, whereas
 * "Uniwind followed the media query" is a screenshot.
 *
 * There is no context to read: the preference lives in the UI store, and a second
 * copy in React context would be a second answer to the same question.
 */

/**
 * Apply the stored preference to the styling system.
 *
 * An effect, not a render-time call: it is a side effect on a module that
 * outlives React, so doing it during render would mutate global state on every
 * re-render and leave a discarded render's theme applied.
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
	const preference = useUiStore((state) => state.themePreference);

	useEffect(() => {
		Uniwind.setTheme(preference);
	}, [preference]);

	return children;
};

export type Theme = {
	/** What the reader chose. */
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
	/** What actually renders. Differs from `preference` only for `system`. */
	theme: ThemeName;
	isDark: boolean;
};

/** The active theme. `preference` is the choice; `theme` is the result. */
export const useTheme = (): Theme => {
	const preference = useUiStore((state) => state.themePreference);
	const setPreference = useUiStore((state) => state.setThemePreference);
	// React Native's `ColorSchemeName` is wider than the two themes — it can also
	// report "unspecified" — so it is narrowed here rather than in the resolver,
	// which stays a two-value function the tests can pin.
	const systemScheme = useColorScheme();
	const theme = resolveTheme(
		preference,
		systemScheme === "dark"
			? "dark"
			: systemScheme === "light"
				? "light"
				: null,
	);
	return { preference, setPreference, theme, isDark: theme === "dark" };
};

/**
 * A token's value as a string, for the APIs that cannot take a class name.
 *
 * Exactly two cases need this: a vector icon's `color` prop (an SVG cannot
 * inherit a text colour, so `text-ink-muted` has to become a value) and native
 * chrome such as the status bar. Everything else uses `className`, which is
 * cheaper and cannot drift out of theme.
 *
 * The value comes from the live CSS variable so it tracks a theme change; the
 * generated palette is the fallback for the frame before the variable resolves
 * and for a role that no `className` currently uses — Uniwind only exposes the
 * variables it has seen in a class, and an icon painted with `undefined` is
 * invisible rather than merely wrong.
 */
export const useTokenColor = (role: ColorRole): string => {
	const { theme } = useTheme();
	const variable = useCSSVariable(cssColorVar(role));
	if (typeof variable === "string" && variable.length > 0) return variable;
	return resolveColor(role, theme);
};

/**
 * Whether the reader has asked for reduced motion.
 *
 * One place answers "should this move", so a later data-saver or low-power signal
 * can be folded into the same flag rather than consulted separately at every
 * animation (`tokens.json § motion.reducedMotion.detect`).
 */
export const useReducedMotion = (): boolean => {
	const [reduce, setReduce] = useState(false);

	useEffect(() => {
		let cancelled = false;
		AccessibilityInfo.isReduceMotionEnabled()
			.then((enabled) => {
				if (!cancelled) setReduce(enabled);
			})
			.catch(() => {
				// A platform without the API keeps motion on. Reduced motion is a
				// preference the reader opts into; failing closed would remove
				// feedback nobody asked to lose.
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
