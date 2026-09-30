import { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";

import { LIVE_REGION } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { SKELETON_PULSE_MS } from "@/ui/variants";

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
 */
export type SkeletonProps = {
	/** Number of bars. One bar is a single-line placeholder. */
	lines?: number;
	/** Height class per bar; defaults to a text-line height. */
	barClassName?: string;
	testID?: string;
};

export const Skeleton = ({
	lines = 3,
	barClassName = "h-4",
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
	// theme and the resting tone stays visible on its own.
	const resting = useTokenColor("elevated");
	const dimmed = useTokenColor("sunken");

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
					className={`${barClassName} w-full rounded-sm`}
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
