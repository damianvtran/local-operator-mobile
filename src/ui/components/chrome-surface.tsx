import {
	GlassContainer,
	GlassView,
	isGlassEffectAPIAvailable,
	isLiquidGlassAvailable,
} from "expo-glass-effect";
import { type ReactNode, useEffect, useState } from "react";
import {
	AccessibilityInfo,
	Keyboard,
	Platform,
	type StyleProp,
	View,
	type ViewStyle,
} from "react-native";

import { useTheme, useTokenColor } from "@/ui/appearance";
import { GLASS_TINT_ALPHA, glassEnabled, withAlpha } from "@/ui/glass-rule";

/**
 * Whether the composer chrome is drawn as Liquid Glass right now — the rule in
 * `glass-rule.ts`, fed live. Reduce Transparency is subscribed rather than read
 * once: a reader who flips it in Control Center while a conversation is open
 * must see the opaque fill immediately, not on the next launch.
 */
export const useChromeGlass = (): boolean => {
	/* The two availability probes are synchronous constants per process, read
	 * once. They are only CALLED on iOS: on other platforms the module's JS
	 * returns false anyway, but not calling it keeps the web/Android paths free
	 * of a native-module lookup. */
	const [available] = useState(
		() =>
			Platform.OS === "ios" &&
			isGlassEffectAPIAvailable() &&
			isLiquidGlassAvailable(),
	);
	const [reduceTransparency, setReduceTransparency] = useState(false);
	useEffect(() => {
		if (!available) return;
		let live = true;
		void AccessibilityInfo.isReduceTransparencyEnabled().then((on) => {
			if (live) setReduceTransparency(on);
		});
		const sub = AccessibilityInfo.addEventListener(
			"reduceTransparencyChanged",
			setReduceTransparency,
		);
		return () => {
			live = false;
			sub.remove();
		};
	}, [available]);
	return glassEnabled({
		platform: Platform.OS,
		apiAvailable: available,
		liquidGlassAvailable: available,
		reduceTransparency,
	});
};

/**
 * Whether the soft keyboard is up. The composer's bottom geometry depends on
 * it (record §2.1: the keyboard covers the display corner, so the bottom radius
 * squares to the top one and the home-indicator inset is not paid).
 *
 * iOS listens to the `Will` events so the geometry changes WITH the keyboard's
 * animation rather than a frame after it lands; Android only emits `Did`.
 */
export const useKeyboardVisible = (): boolean => {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (Platform.OS === "web") return;
		const show = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
		const a = Keyboard.addListener(show, () => setVisible(true));
		const b = Keyboard.addListener(hide, () => setVisible(false));
		return () => {
			a.remove();
			b.remove();
		};
	}, []);
	return visible;
};

export type ChromeSurfaceProps = {
	glass: boolean;
	/** Per-corner radii: glass needs them as props (UICornerConfiguration), the
	 *  solid fill as style, and the two must be the same numbers. */
	radii: { top: number; bottom: number };
	style?: StyleProp<ViewStyle>;
	/** Classes for the content box (padding, layout). The fill is this
	 *  component's: a caller-supplied `bg-*` would paint over the glass. Applied
	 *  to an inner plain `View` in the glass branch, because uniwind maps
	 *  `className` only on React Native's own components and `GlassView` is a
	 *  third-party native view — the classes would otherwise be dropped there
	 *  and the glass frame's padding would differ from the solid frame's. */
	className?: string;
	children: ReactNode;
	testID?: string;
	onLayout?: React.ComponentProps<typeof View>["onLayout"];
	ref?: React.Ref<View>;
};

/**
 * One chrome surface — the composer shell or a chip capsule — in either fill.
 *
 * Solid: `bg-elevated`, the relay's look (record §4: elevated on canvas is a
 * 6.4 L* ground step in dark, so it reads without a border). Glass: a regular
 * (never clear) `GlassView` tinted with the theme's own `elevated` at 60 %, in
 * the theme's colour scheme, so the material follows Local Operator Dark/Light
 * rather than the system appearance.
 */
export const ChromeSurface = ({
	glass,
	radii,
	style,
	className,
	children,
	testID,
	onLayout,
	ref,
}: ChromeSurfaceProps) => {
	const { isDark } = useTheme();
	const elevated = useTokenColor("elevated");
	/* Logical corner names (the RTL rule, `physical-edges.test.ts`). Both sides
	 *  carry the same value, so direction cannot change the shape; the glass view
	 *  maps the same names onto UICornerConfiguration (`GlassView.swift`). */
	const corners: ViewStyle = {
		borderTopStartRadius: radii.top,
		borderTopEndRadius: radii.top,
		borderBottomStartRadius: radii.bottom,
		borderBottomEndRadius: radii.bottom,
	};
	if (glass) {
		return (
			<GlassView
				ref={ref}
				glassEffectStyle="regular"
				tintColor={withAlpha(elevated, GLASS_TINT_ALPHA)}
				colorScheme={isDark ? "dark" : "light"}
				style={[corners, { overflow: "hidden" }, style]}
				testID={testID}
				onLayout={onLayout}
			>
				<View className={className}>{children}</View>
			</GlassView>
		);
	}
	return (
		<View
			ref={ref}
			className="bg-elevated"
			style={[corners, style]}
			testID={testID}
			onLayout={onLayout}
		>
			{/* The same inner box as the glass branch, so the two trees have one
			 *  geometry and a fill swap never moves a child (record §4). */}
			<View className={className}>{children}</View>
		</View>
	);
};

/** Groups adjacent glass capsules so iOS merges and morphs them as one
 *  material (the Tasks/Agents chips). A plain row when glass is off. */
export const ChromeGroup = ({
	glass,
	className,
	children,
}: {
	glass: boolean;
	className?: string;
	children: ReactNode;
}) =>
	glass ? (
		<GlassContainer spacing={8}>
			<View className={className}>{children}</View>
		</GlassContainer>
	) : (
		<View className={className}>{children}</View>
	);
