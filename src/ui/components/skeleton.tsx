import { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";

import { LIVE_REGION } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { SKELETON_PULSE_MS, skeletonBarClasses } from "@/ui/variants";

/**
 * A placeholder that matches the layout it is standing in for: three bars for a
 * transcript, one row per list item. Never a bare spinner page
 * (docs/ux/flows.md § 11).
 *
 * The fill is `elevated`, NOT `sunken`. That was measured, not chosen: a `sunken`
 * bar sits at roughly 1.3:1 and vanishes in a still frame, so the loading state
 * reads as an empty one. The resting tone therefore has to be visible on its own,
 * because the pulse is the first thing reduced motion removes
 * (docs/design/components.md § 19).
 *
 * **The pair is a property of the GROUND, which is why `ground` exists.** The
 * `elevated`-on-`canvas` step above assumes the bars sit on the canvas — true for
 * the transcript, the past list and the set-up screens, and false for any surface
 * that is already raised. On those, a resting `elevated` bar is the SAME colour as
 * the ground it is drawn on — measured on the 2026-10-11 full-surface pass: the
 * conversations pane's loading cell (S15/loading, iphone-15, dark) carried zero
 * non-background pixels in the bars' own band, because bar #322d22 sits on the
 * pane's own #322d22 (light: #fefdfa on #fefdfa). That is the "loading reads as
 * empty" failure this component was fixed for, surviving on the raised ground.
 * `ground="raised"` swaps the ends (resting `sunken`, dimming `canvas`) so both
 * ends of the pulse stay visible against everything above the canvas.
 */
export type SkeletonProps = {
	/** Number of bars. One bar is a single-line placeholder. */
	lines?: number;
	/** The bar's height and shape; defaults to a text-line height. */
	barClassName?: string;
	/**
	 * The surface the bars will be drawn on: `canvas` (default — screen grounds)
	 * or `raised` (anything whose own surface is above the canvas, where the
	 * canvas pair would paint the bar in the ground's own colour).
	 */
	ground?: "canvas" | "raised";
	/**
	 * The bar's width, and the ONLY width in its class list.
	 *
	 * Width is a separate prop because the two widths cannot coexist: Tailwind
	 * resolves `w-*` by STYLESHEET order, not by the order they are listed in the
	 * class attribute, so a caller's `w-16` lost to this component's `w-full` and
	 * the bar painted **0 px** inside a content-sized pill — two blank pills where
	 * the loading state should have been (design round 2 D13 / QA round 4 Q1;
	 * measured bar 0 × 12, chip 26 × 44, then a 122 pt sideways jump when the real
	 * label arrived). A caller that stands in for a KNOWN-size value passes the
	 * width here; a list-item placeholder keeps the default.
	 */
	widthClassName?: string;
	testID?: string;
};

export const Skeleton = ({
	lines = 3,
	barClassName = "h-4",
	widthClassName = "w-full",
	ground = "canvas",
	testID,
}: SkeletonProps) => {
	const reduceMotion = useReducedMotion();
	const pulse = useRef(new Animated.Value(0)).current;
	// Stable keys rather than the array index: the bars are identical, so an index
	// key is not wrong here, but a key that survives a change in `lines` is what
	// keeps a re-render from rebuilding every bar when one more line arrives.
	const barKeys = useMemo(
		() =>
			Array.from(
				{ length: Math.max(1, lines) },
				(_, index) => `skeleton-bar-${index}`,
			),
		[lines],
	);
	// Both ends of the pulse are token roles, so the animation cannot drift out of
	// theme and the resting tone stays visible on its own. Which two roles depends
	// on the ground: see the note on `ground` in the type above.
	const resting = useTokenColor(ground === "raised" ? "sunken" : "elevated");
	const dimmed = useTokenColor(ground === "raised" ? "canvas" : "sunken");

	useEffect(() => {
		if (reduceMotion) {
			// The bars keep their resting tone; the pulse stops entirely rather
			// than slowing, because at this duration a slow pulse reads as a
			// rendering artefact.
			pulse.setValue(0);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1,
					duration: SKELETON_PULSE_MS / 2,
					// A colour cannot run on the native driver; this animation is cheap
					// enough (a handful of bars) that the JS driver is the right trade.
					useNativeDriver: false,
				}),
				Animated.timing(pulse, {
					toValue: 0,
					duration: SKELETON_PULSE_MS / 2,
					useNativeDriver: false,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [pulse, reduceMotion]);

	return (
		<View
			className="gap-2"
			testID={testID}
			// Announced once as a polite busy region rather than per bar: what a
			// reader needs is that content is coming, not how many rows are missing.
			accessibilityLiveRegion={LIVE_REGION.polite}
			accessibilityLabel="Loading"
		>
			{barKeys.map((barKey) => (
				<Animated.View
					key={barKey}
					// One width, never two: see `widthClassName` and
					// `skeletonBarClasses`, which holds that as a pure, tested rule.
					className={skeletonBarClasses({ barClassName, widthClassName })}
					style={{
						// A brightness step between two grounds, not an opacity fade: an
						// opacity pulse takes the bar towards the ground this fill exists to
						// stand out from, which is the failure that made `sunken` wrong.
						backgroundColor: pulse.interpolate({
							inputRange: [0, 1],
							outputRange: [resting, dimmed],
						}),
					}}
				/>
			))}
		</View>
	);
};
