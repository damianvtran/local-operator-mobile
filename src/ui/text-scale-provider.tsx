import { useCallback, useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform, useWindowDimensions } from "react-native";
import { ScopedVariables } from "uniwind";

import {
	clampTextScale,
	resolveTextScale,
	scaledTextVariables,
	TEXT_SCALE_PERCENTS,
	type TextScalePreference,
	type TextUnit,
} from "@/ui/text-scale";

/**
 * Text scale, applied: the platform's own signal, and the variables that carry
 * it into every `text-*` utility.
 *
 * **Where the platform signal comes from, and why it differs.** React Native
 * scales `<Text>` by the OS font scale on its own, but that happens inside the
 * platform text layer and is invisible to a `fontSize` the layout has to reason
 * about — and on web there is no such layer at all: React Native Web's
 * `PixelRatio.getFontScale()` is a constant `1`. So:
 *
 *  - **native**: `PixelRatio.getFontScale()`, which is the same number the OS
 *    will apply to the glyphs. Read through `useWindowDimensions().fontScale`
 *    so a change re-renders (React Native publishes font-scale changes on the
 *    `Dimensions` event).
 *  - **web**: the ROOT font size, as a ratio of the 16 px default. That is the
 *    browser's own "default font size" setting and the harness's
 *    `--lo-text-scale` dimension expressed the same way
 *    (`tools/visual/matrix.mjs` § PRE_PAINT_PROBE sets
 *    `root.style.fontSize = 16 * scale + 'px'`). Reading the computed value
 *    rather than a query parameter means the app follows the setting it is
 *    actually rendered under, not the one a URL claimed.
 *
 * The scaled values are published with Uniwind's own runtime-variable mechanism
 * (the one `Uniwind.setTheme` uses to swap colour roles), so one mechanism
 * carries the scale to both platforms rather than a CSS write on web and a
 * different one natively.
 */

/** The 16 px baseline both the browser default and the harness scale from. */
const ROOT_FONT_BASELINE_PX = 16;

/**
 * The platform's scale, read outside React. Exported for the diagnostics row,
 * which states the number it is actually using.
 */
export function platformTextScale(): number {
	if (Platform.OS !== "web") return PixelRatio.getFontScale();
	if (typeof document === "undefined" || !document.documentElement) return 1;
	const root = globalThis.getComputedStyle?.(document.documentElement);
	const parsed = Number.parseFloat(root?.fontSize ?? "");
	/* Clamped HERE, where the number is read, rather than at a call site that can
	 *  forget: this value reaches `effectiveScale`, the diagnostics row and every
	 *  `LARGE_TEXT_SCALE` layout decision, and a misreported root size (a stray
	 *  `!important`, an odd user stylesheet) must not become a 3.5x ramp. */
	return Number.isFinite(parsed) && parsed > 0
		? clampTextScale(parsed / ROOT_FONT_BASELINE_PX)
		: 1;
}

export type TextScale = {
	/** The factor the token variables are built from — the in-app preference on
	 *  web, the preference applied over the platform's own signal on native. */
	scale: number;
	/**
	 * What a READER actually gets, which is not `scale` on the web.
	 *
	 * Since the type roles are `rem` there, the platform's factor reaches the
	 * glyphs through the root font size, and `scale` is only the preference on top
	 * of it. A layout decision — does the header stack, does a segmented track wrap
	 * — must ask this and not `scale`: gating on `scale` made every such rule inert
	 * under a platform text size of 200 % (measured: the wrap never engaged, and two
	 * segment labels overprinted each other by 27x36 pt).
	 */
	effectiveScale: number;
	/** What the reader chose. */
	preference: TextScalePreference;
	setPreference: (preference: TextScalePreference) => void;
	/** The platform's own signal, before the preference is applied. Shown in
	 *  Settings so "System" is a number the reader can check rather than a word. */
	platformScale: number;
	/** The scaled token variables. */
	variables: Record<string, string>;
};

/**
 * The effective text scale and the controls for it.
 *
 * The preference is this module's own (see `useTextScalePreference` below for why
 * it is not in the merged UI store), so this hook is a read of it plus the platform
 * signal — there is deliberately no second copy in React context, because a second
 * copy is a second answer to "how large is type".
 */
export function useTextScale(): TextScale {
	const preference = useTextScalePreference();
	const setPreference = useSetTextScalePreference();
	/* Subscribed (not read once) so an OS font-scale change or a window resize
	 * re-resolves the scale: on Android a font-scale change is published on the
	 * Dimensions event, and on web the browser's default font size applies at
	 * the next layout. */
	const { fontScale } = useWindowDimensions();

	const platformScale = useMemo(() => {
		/* `fontScale` is the platform's answer where it is real; falling back to
		 * the direct read keeps the web path (where it is a constant) honest. */
		const reported = platformTextScale();
		return Platform.OS === "web" ? reported : fontScale || reported;
	}, [fontScale]);

	/* The platform's factor is applied ONCE, by whichever mechanism can carry it.
	 *
	 * On the web that mechanism is the unit: the type roles are `rem`, so the
	 * browser's root font size multiplies every size by itself. Multiplying here as
	 * well squares it — measured: the harness's 200 % captured at a median text
	 * height of 4.00x before this line existed. On native there is no root font
	 * size to do the work, so the factor is applied to the values instead — by
	 * `scaledTextVariables` for `px`, which is a different place from this line but
	 * still exactly once. */
	const scale = resolveTextScale(preference);

	/* ONE rule, in the one place the factor is decided: the emitted value never
	 * carries the platform's factor, and the unit selects which mechanism applies it
	 * (`TextUnit` in `text-scale.ts` carries the reasoning and the measurements).
	 * `rem` on the web hands it to the browser's root font size; `px` everywhere else
	 * hands it to nobody — React Native's own text scaling applies it on native, and an
	 * explicit preference REPLACES the browser's on web rather than compounding. */
	const unit: TextUnit =
		Platform.OS === "web" && preference === "system" ? "rem" : "px";

	const variables = useMemo(
		() => scaledTextVariables(scale, unit),
		[scale, unit],
	);

	/* What a reader actually gets, which is what every `LARGE_TEXT_SCALE` layout
	 * decision is made against — so it describes the rendered result rather than one
	 * input to it. An explicit preference REPLACES the browser's factor on web (that is
	 * the `px` unit's whole point); everywhere else the platform's factor sits on top of
	 * the preference, applied by the browser's root font size or by React Native. */
	const effectiveScale =
		Platform.OS === "web" && preference !== "system"
			? scale
			: scale * platformScale;

	return {
		scale,
		effectiveScale,
		preference,
		setPreference,
		platformScale,
		variables,
	};
}

/**
 * Publishes the scaled type-scale variables above every route.
 *
 * Placed INSIDE the theme provider and outside the router, so every screen
 * inherits one scale — and so the value is recomputed on a preference change
 * rather than only at boot.
 */
/**
 * The chosen text scale, in this provider rather than in `ui-store`.
 *
 * The merged store (PR #7's head) carries the THEME preference and nothing about
 * text scale, and that file belongs to another stream — so this slice keeps its own
 * preference. `useState` + a module-level holder is deliberate: the value is a
 * runtime preference read by every screen's provider, and persisting it is a
 * separate decision (it would need a storage key beside the tunnel's).
 */
let textScalePreference: TextScalePreference = "system";
const scaleListeners = new Set<() => void>();
const useTextScalePreference = (): TextScalePreference => {
	const [, force] = useState(0);
	useEffect(() => {
		const listener = () => force((n: number) => n + 1);
		scaleListeners.add(listener);
		return () => {
			scaleListeners.delete(listener);
		};
	}, []);
	return textScalePreference;
};
const useSetTextScalePreference = (): ((
	preference: TextScalePreference,
) => void) => {
	return useCallback((preference: TextScalePreference) => {
		textScalePreference = preference;
		for (const listener of scaleListeners) listener();
	}, []);
};

export const TextScaleProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const { variables } = useTextScale();
	return <ScopedVariables variables={variables}>{children}</ScopedVariables>;
};

/** The options Settings renders, in order, with the label each one shows. */
export const TEXT_SCALE_OPTIONS: ReadonlyArray<{
	value: TextScalePreference;
	label: string;
}> = [
	{ value: "system", label: "System" },
	...TEXT_SCALE_PERCENTS.map((percent) => ({
		value: String(percent) as TextScalePreference,
		label: `${percent}%`,
	})),
];
