import { useEffect, useRef } from "react";
import { Animated, type ViewStyle } from "react-native";

import { useReducedMotion } from "@/ui/appearance";

/**
 * The streaming shimmer: a brightness pulse on text that is still arriving.
 *
 * **Why a wrapper rather than a class.** The design kit says a streaming row
 * shimmers *on the name* (docs/design/components.md § 7) — the spinner lives in
 * the reserved 12 pt slot and the title carries the "working" signal. The styling
 * system's type utilities resolve font size, weight and colour through the token
 * variables, but nothing in `theme.css` animates brightness, and `theme.css` is
 * generated and pinned by `theme:check`. So the motion lives here, in React
 * Native's own animation driver, which is the same code path on both platforms.
 *
 * Three constraints this component exists to keep:
 *
 *  - **Opacity, not colour.** A colour ramp through the token roles would pass
 *    through fills that are not in the palette; opacity keeps the role's hue and
 *    only moves its weight.
 *  - **A floor of 0.72, not 0.35.** The title is body text and must stay legible
 *    in every frame: the audit reads the computed colour, but a reader watching
 *    the animation is the one a low floor would fail.
 *  - **Reduced motion stops it.** The resting value is full opacity, so the state
 *    is still legible as "working" from the spinner beside it — the animation is
 *    the second channel, never the only one.
 */
export type ShimmerProps = {
	/** Whether the text is still arriving. When false the text renders at rest,
	 *  and no animation is started at all (an unused loop is a wakeup a phone
	 *  does not need). */
	active: boolean;
	children: React.ReactNode;
	className?: string;
	style?: ViewStyle;
	testID?: string;
};

/** The cycle. 1400 ms matches the skeleton's pulse so the two "something is
 *  still happening" motions in the app beat at the same tempo. */
const HALF_PERIOD_MS = 700;
const LOW = 0.72;

export const Shimmer = ({
	active,
	children,
	className,
	style,
	testID,
}: ShimmerProps) => {
	const reduceMotion = useReducedMotion();
	const value = useRef(new Animated.Value(1)).current;

	useEffect(() => {
		if (!active || reduceMotion) {
			value.setValue(1);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(value, {
					toValue: LOW,
					duration: HALF_PERIOD_MS,
					useNativeDriver: true,
				}),
				Animated.timing(value, {
					toValue: 1,
					duration: HALF_PERIOD_MS,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [active, reduceMotion, value]);

	return (
		<Animated.View
			className={className}
			style={[style, active ? { opacity: value } : null]}
			testID={testID}
		>
			{children}
		</Animated.View>
	);
};
