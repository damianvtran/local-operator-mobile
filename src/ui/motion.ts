/**
 * Motion: the durations and easings the system is allowed, and nothing else.
 *
 * `tokens.json § motion` is explicit about what is forbidden — springs,
 * `Easing.elastic`, `Easing.bounce`, any overshoot. A spring makes the duration
 * non-deterministic, and a duration that cannot be reasoned about cannot be
 * budgeted for a reduced-motion reader. So the component layer takes its timing
 * from here, and `parseCubicBezier` is the one adapter: the tokens are authored
 * as CSS `cubic-bezier(...)` because the same curve has to hold on both sides of
 * the bridge (`tokens.json § motion.native`), and React Native's `Easing.bezier`
 * takes those four numbers.
 *
 * This module imports nothing, so the parsing is unit-tested in Node.
 */

const CUBIC_BEZIER =
	/^cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/;

/**
 * Parse a CSS cubic-bezier easing into the four control-point values React
 * Native's `Easing.bezier` expects.
 *
 * Throws on anything it does not recognise rather than returning a default: a
 * silently-substituted easing is a motion change nobody reviews, and the input
 * is a token, so it is fixed at build time and a failure here is a bug in the
 * tokens rather than a runtime condition.
 */
export const parseCubicBezier = (
	easing: string,
): [number, number, number, number] => {
	if (easing === "linear") return [0, 0, 1, 1];
	const match = CUBIC_BEZIER.exec(easing.trim());
	if (!match) {
		throw new Error(
			`Not a cubic-bezier easing: "${easing}". Motion values come from tokens.json § motion.easing; springs and named easings are not part of the system.`,
		);
	}
	const [, x1, y1, x2, y2] = match as unknown as [
		string,
		string,
		string,
		string,
		string,
	];
	const values = [x1, y1, x2, y2].map(Number) as [
		number,
		number,
		number,
		number,
	];
	if (values.some((value) => !Number.isFinite(value))) {
		throw new Error(`Non-numeric control point in easing "${easing}"`);
	}
	return values;
};

import { REDUCED_MOTION_DURATION_CAP_MS } from "@/ui/tokens.gen";

/**
 * A global cap applied when the reader asks for reduced motion, read from the
 * token file rather than restated here.
 *
 * Reduced motion is not a kill switch (`tokens.json § motion.reducedMotion`): the
 * floor CAPS durations rather than zeroing them, because an instantaneous colour
 * change loses the affordance that a press IS feedback. Looping animations — the
 * danger pulse, the skeleton pulse, the streaming shimmer — stop at their resting
 * frame instead, which is why each of those has a resting state that carries the
 * meaning on its own.
 */
export const REDUCED_MOTION_FLOOR_MS = REDUCED_MOTION_DURATION_CAP_MS;

/** Apply the reduced-motion cap to a token duration. */
export const effectiveDuration = (
	durationMs: number,
	reduceMotion: boolean,
): number =>
	reduceMotion
		? Math.min(durationMs, REDUCED_MOTION_DURATION_CAP_MS)
		: durationMs;
