import { forwardRef, useImperativeHandle, useRef } from "react";
import { Animated } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
	type EdgeFadeLevels,
	TRANSCRIPT_FADE_PT,
} from "@/features/session/transcript-presence";
import { SURFACE } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";

/**
 * The transcript's two edge fades: `canvas` at the edge, transparent at the
 * content side, 24 pt deep.
 *
 * WHY A REAL GRADIENT AND NOT A MASK. The relay fades the scroller itself
 * (`mask-image` on `.lo-fade-y`), which React Native has no equivalent for. The
 * in-repo precedent for the same cue is an SVG gradient painted over the edge
 * (`sheet.tsx`'s body cue, `markdown.tsx`'s table cue), both 24 pt, both
 * `canvas`-toward-transparent. This is that, twice.
 *
 * WHY IT TAKES NO TOUCHES. `composer.tsx` records the incident: an absolutely
 * positioned layer across the composer's band swallowed every tap on the field
 * (round 4, U1/U2/U3). A fade is a picture of the edge, never a control, so the
 * overlay is `pointerEvents="none"` and hidden from the accessibility tree.
 *
 * WHY AN IMPERATIVE HANDLE AND NOT PROPS. Opacity is a function of the scroll
 * offset, which arrives at frame rate. Passing it as a prop would re-render this
 * component — and its parent, the list — on every scroll event. The list calls
 * `setLevels` from the handler it already runs, and only the two animated
 * opacities change; the tween runs on the native driver, so the JS thread does
 * no per-frame work for the fades themselves.
 *
 * A level that has not changed is not re-animated: `setLevels` drops a target
 * within 1 % of the one already running, so a slow drag asks for one tween per
 * ramp step instead of one per frame.
 */

export type TranscriptEdgeFadesHandle = {
	/** Aim both edges at these levels. */
	setLevels(levels: EdgeFadeLevels): void;
};

/** Gradient ids must be unique per instance — two fades can share one document
 *  and `url(#…)` resolves to the first id in it. A module counter, not a
 *  content-derived id, for the reason `markdown.tsx`'s table cue gives: the id
 *  must survive the re-renders a streaming frame causes. */
let fadeSeq = 0;

const Band = ({
	edge,
	ground,
	opacity,
	testID,
}: {
	edge: "top" | "bottom";
	ground: string;
	opacity: Animated.Value;
	testID: string;
}) => {
	const id = useRef("");
	if (id.current === "") {
		fadeSeq += 1;
		id.current = `transcript-fade-${fadeSeq}`;
	}
	return (
		<Animated.View
			pointerEvents="none"
			aria-hidden
			testID={testID}
			style={{
				position: "absolute",
				/* `start`/`end`, not `left`/`right`: the band spans the scroller and
				 *  must span it in a right-to-left reading order too (the repo's
				 *  physical-edge guard, `physical-edges.test.ts`). */
				start: 0,
				end: 0,
				[edge]: 0,
				height: TRANSCRIPT_FADE_PT,
				opacity,
			}}
		>
			<Svg width="100%" height="100%">
				<Defs>
					{/* Drawn toward the EDGE, so the content nearest the edge is the
					    thing dissolved: `near` is the content side and transparent,
					    `far` is the edge and is the ground itself. */}
					<LinearGradient id={id.current} x1="0%" y1="0%" x2="0%" y2="100%">
						<Stop
							key="near"
							offset="0"
							stopColor={ground}
							stopOpacity={edge === "top" ? 0 : 1}
						/>
						<Stop
							key="far"
							offset="1"
							stopColor={ground}
							stopOpacity={edge === "top" ? 1 : 0}
						/>
					</LinearGradient>
				</Defs>
				<Rect width="100%" height="100%" fill={`url(#${id.current})`} />
			</Svg>
		</Animated.View>
	);
};

export const TranscriptEdgeFades = forwardRef<TranscriptEdgeFadesHandle>(
	(_props, ref) => {
		/* The band's ground: `canvas`, the transcript's own colour, resolved here
		 * rather than passed in — the fades are a drawing and they own their paint.
		 * It changes with the theme, never with a frame. */
		const ground = useTokenColor("canvas");
		const top = useRef(new Animated.Value(0)).current;
		const bottom = useRef(new Animated.Value(0)).current;
		const targets = useRef<EdgeFadeLevels>({ top: 0, bottom: 0 });
		const reduced = useReducedMotion();
		const reducedRef = useRef(reduced);
		reducedRef.current = reduced;

		useImperativeHandle(
			ref,
			() => ({
				setLevels(levels: EdgeFadeLevels) {
					const aim = (value: Animated.Value, edge: "top" | "bottom"): void => {
						if (Math.abs(targets.current[edge] - levels[edge]) < 0.01) return;
						targets.current = { ...targets.current, [edge]: levels[edge] };
						/* A reader who asked for stillness gets the level, not the tween
						 * (U-13). The fade still says what the edge is; it just does not
						 * move to say it. */
						if (reducedRef.current) {
							value.setValue(levels[edge]);
							return;
						}
						Animated.timing(value, {
							toValue: levels[edge],
							duration: 120,
							useNativeDriver: true,
						}).start();
					};
					aim(top, "top");
					aim(bottom, "bottom");
				},
			}),
			[top, bottom],
		);

		return (
			<>
				<Band
					edge="top"
					ground={ground}
					opacity={top}
					testID={SURFACE.transcriptFadeTop}
				/>
				<Band
					edge="bottom"
					ground={ground}
					opacity={bottom}
					testID={SURFACE.transcriptFadeBottom}
				/>
			</>
		);
	},
);
TranscriptEdgeFades.displayName = "TranscriptEdgeFades";
