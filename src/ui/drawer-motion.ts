/**
 * The drawer's motion arithmetic: one ease-in-out curve, the plan a release
 * resumes from, and the release decision, in a plain module with no
 * `react-native` import so every number is unit-tested in Node.
 *
 * WHY THE CURVE IS LOCAL. The operator asked for CSS `ease-in-out` on
 * 2026-11-26 ("have it transition a little slicker like ease in ease out").
 * The kit's `in-out` token is `(0.65, 0, 0.35, 1)` and `tokens.gen.ts` is
 * generated, so the requested curve is contracted here rather than edited into
 * the kit. It is the same curve for tap-open, drag release, spring-back and
 * close, so the drawer never changes speed when the finger lifts.
 *
 * WHY A PLAN RATHER THAN A DURATION. A release must resume the same curve from
 * the position the finger left it at: starting a fresh ease-in from standstill
 * would be a visible stall and a speed discontinuity. The mirror trick (animate
 * from the FAR edge toward the current side) makes opening and closing share
 * one function: the fraction `f` of the mirror still to travel is the curve's
 * own output at the release point, so the inverse gives the curve's time there
 * and only the remaining time is spent.
 *
 * `FULL_MS` is the kit's `duration.reveal` (320); the floor stops a release
 * near an end from finishing in a frame or two, and the reduced-motion cap
 * applies on top (`effectiveMs`).
 */
import { effectiveDuration } from "@/ui/motion";
import { DURATIONS } from "@/ui/tokens.gen";

/** CSS `ease-in-out`, the operator's pick (2026-11-26). */
export const DRAWER_BEZIER: readonly [number, number, number, number] = [
	0.42, 0, 0.58, 1,
];

/** Full-width travel time: the kit's `duration.reveal`. */
export const DRAWER_FULL_MS = DURATIONS.reveal;

/** A settle never claims to finish faster than this, however short the rest. */
export const DRAWER_MIN_MS = 120;

/** Released past this fraction of the width, the drawer commits. */
export const DRAWER_COMMIT = 0.5;

/** A flick this fast (pt/s) commits below the distance threshold... */
export const DRAWER_FLING = 1000;

/** ...but only once the finger has travelled this fraction of the width. */
export const DRAWER_FLING_MIN = 0.2;

const X1 = 0.42;
const Y1 = 0;
const X2 = 0.58;
const Y2 = 1;
const CX = 3 * X1;
const BX = 3 * (X2 - X1) - CX;
const AX = 1 - CX - BX;
const CY = 3 * Y1;
const BY = 3 * (Y2 - Y1) - CY;
const AY = 1 - CY - BY;

const clamp01 = (value: number): number => {
	"worklet";
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

/**
 * The curve's output at TIME fraction `t` (solve the Bezier's x for `t`, then
 * read y). Newton's method, seeded at `t`, as the prototype did; the curve is
 * monotone so the seed always converges.
 */
export const easeInOut = (t: number): number => {
	"worklet";
	const time = clamp01(t);
	let u = time;
	for (let i = 0; i < 8; i += 1) {
		const x = ((AX * u + BX) * u + CX) * u - time;
		const dx = (3 * AX * u + 2 * BX) * u + CX;
		if (Math.abs(x) < 1e-6 || dx === 0) break;
		u -= x / dx;
	}
	const solved = clamp01(u);
	return ((AY * solved + BY) * solved + CY) * solved;
};

/** The curve's time fraction at output `f`: the inverse a release resumes at. */
export const easeInOutInverse = (f: number): number => {
	"worklet";
	const target = clamp01(f);
	// The binary search would converge to within a billionth of an endpoint, not
	// to it; a plan that starts at 0 should take exactly the full duration.
	if (target === 0) return 0;
	if (target === 1) return 1;
	let low = 0;
	let high = 1;
	for (let i = 0; i < 30; i += 1) {
		const middle = (low + high) / 2;
		if (easeInOut(middle) < target) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
};

export type SettlePlan = {
	/** Position (pt) the settle starts from: the mirror edge, not the finger. */
	from: number;
	/** Position (pt) the settle ends on. */
	to: number;
	/** The curve's time fraction where the settle resumes. */
	t0: number;
	/** How long the remaining travel takes, before reduced motion. */
	ms: number;
};

/**
 * The plan for a settle from `position` to `target` on a `width`-wide drawer.
 *
 * The plan starts at the FAR edge (`from`): the curve is mirrored so `f` is the
 * fraction still to travel and `easeInOutInverse(f)` is the curve time already
 * spent. At `u = 0` `settleAt` is exactly `position`, so a release is
 * continuous; at `u = 1` it is exactly the target.
 *
 * A zero/negative/NaN width or a NaN position is a caller bug, but this runs
 * from a UI-thread reaction: return a finite, immediately-finished plan rather
 * than letting NaN reach a transform.
 */
export const settlePlan = ({
	position,
	width,
	target,
}: {
	position: number;
	width: number;
	target: 0 | 1;
}): SettlePlan => {
	"worklet";
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(position)) {
		return { from: 0, to: 0, t0: 1, ms: DRAWER_MIN_MS };
	}
	const from = target === 0 ? width : 0;
	const f = clamp01(Math.abs(position - from) / width);
	const t0 = easeInOutInverse(f);
	return {
		from,
		to: target === 0 ? 0 : width,
		t0,
		ms: Math.max(DRAWER_MIN_MS, DRAWER_FULL_MS * (1 - t0)),
	};
};

/** Position at clock fraction `u` of the plan's remaining time. */
export const settleAt = (plan: SettlePlan, u: number): number => {
	"worklet";
	const k = clamp01(u);
	const t = plan.t0 + (1 - plan.t0) * k;
	return plan.from + (plan.to - plan.from) * easeInOut(t);
};

/**
 * Whether a release commits.
 *
 * `amount` and `velocity` are measured IN THE COMMIT DIRECTION, so a closing
 * drag passes its mirrored values (leftward travel and speed as positives) and
 * the same rule decides both directions. A cancelled gesture never commits:
 * the platform took the touch away, and that must not count as a choice.
 */
export const decideRelease = ({
	amount,
	width,
	velocity,
	cancelled,
}: {
	amount: number;
	width: number;
	velocity: number;
	cancelled: boolean;
}): boolean => {
	"worklet";
	if (cancelled) return false;
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(amount))
		return false;
	const travelled = Math.max(0, amount);
	const speed = Number.isFinite(velocity) ? velocity : 0;
	return (
		travelled >= DRAWER_COMMIT * width ||
		(speed >= DRAWER_FLING && travelled >= DRAWER_FLING_MIN * width)
	);
};

/** The reduced-motion cap for a settle, from the one motion module. */
export const effectiveMs = (ms: number, reduceMotion: boolean): number =>
	effectiveDuration(ms, reduceMotion);
