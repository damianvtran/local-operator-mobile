import { useEffect, useMemo } from "react";
import { Animated, View } from "react-native";

import { LIVE_REGION } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { createSharedLoop } from "@/ui/shared-loop";
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

/* ------------------------------------------------------------------ the pulse */

/**
 * ONE pulse for every bar on screen, on the NATIVE driver (performance audit P6).
 *
 * The pulse used to interpolate each bar's `backgroundColor`, which no native
 * driver can animate, so every `Skeleton` instance ran its own 60 Hz loop on the
 * JS thread. Skeletons are on screen exactly when that thread is busiest —
 * mounting the transcript they stand in for — so the pulse stuttered and added
 * load to the very mount it was waiting on.
 *
 * It is now an OPACITY, the one property the native driver animates here: the
 * bar is painted in its resting colour and a layer in the dimmed colour fades
 * over it. That is the same picture as the colour interpolation it replaces —
 * a layer of colour B at opacity `t` over colour A composites to
 * `A + t·(B − A)` per channel, which is what the interpolation computed — so
 * the earlier rule stands: this is a brightness step BETWEEN TWO GROUNDS, never
 * a fade of the bar itself towards the surface it has to stand out from.
 *
 * The value is module-level and reference-counted: N bars share one loop
 * (started by the first, stopped by the last), so they also beat in phase.
 */
const sharedPulse = new Animated.Value(0);
let pulseLoop: Animated.CompositeAnimation | null = null;

const pulseUsers = createSharedLoop({
	start: () => {
		pulseLoop = Animated.loop(
			Animated.sequence([
				Animated.timing(sharedPulse, {
					toValue: 1,
					duration: SKELETON_PULSE_MS / 2,
					useNativeDriver: true,
				}),
				Animated.timing(sharedPulse, {
					toValue: 0,
					duration: SKELETON_PULSE_MS / 2,
					useNativeDriver: true,
				}),
			]),
		);
		pulseLoop.start();
	},
	stop: () => {
		pulseLoop?.stop();
		pulseLoop = null;
		// Back to the resting tone, so the next first user starts a full cycle.
		sharedPulse.setValue(0);
	},
});

export const Skeleton = ({
	lines = 3,
	barClassName = "h-4",
	widthClassName = "w-full",
	ground = "canvas",
	testID,
}: SkeletonProps) => {
	const reduceMotion = useReducedMotion();
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
		// Reduced motion: the bars keep their resting tone and this instance
		// takes no share of the loop at all — the pulse stops entirely rather
		// than slowing, because at this duration a slow pulse reads as a
		// rendering artefact.
		if (reduceMotion) return;
		return pulseUsers.retain();
	}, [reduceMotion]);

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
				<View
					key={barKey}
					// One width, never two: see `widthClassName` and
					// `skeletonBarClasses`, which holds that as a pure, tested rule.
					// `overflow-hidden` clips the pulse layer to the bar's radius.
					className={`${skeletonBarClasses({ barClassName, widthClassName })} overflow-hidden`}
					style={{ backgroundColor: resting }}
				>
					{reduceMotion ? null : (
						<Animated.View
							aria-hidden
							pointerEvents="none"
							className="absolute inset-0"
							style={{ backgroundColor: dimmed, opacity: sharedPulse }}
						/>
					)}
				</View>
			))}
		</View>
	);
};
