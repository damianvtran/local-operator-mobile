import { memo, useEffect } from "react";
import { Animated, Easing, Text, View } from "react-native";

import { TRACE_GLYPH_BOX_CLASS } from "@/features/session/components/trace-rail";
import { useReducedMotion } from "@/ui/appearance";
import { createSharedLoop } from "@/ui/shared-loop";
import { cx } from "@/ui/variants";

/**
 * The trace's 16 pt glyph column, with the "this is the live tool" indicator.
 *
 * WHY THIS EXISTS. Operator feedback on the native app: a running call's row
 * "looks like it's static and not the currently running tool". The row used to
 * wrap its accent `⟳` in `Shimmer` (`@/ui/components/shimmer`), which DOES run
 * on native — Uniwind's metro resolver maps the imports inside React Native's
 * `Animated/components/` onto its own `View`, so the class and the native-
 * driver opacity both land — but `Shimmer` is the STREAMING-TEXT shimmer: its
 * floor is 0.72 so body text stays legible in every frame. A 28 % brightness
 * dip on one 16 pt mono glyph is below what a reader notices on a phone panel,
 * and with Reduce Motion on it rested at full opacity, i.e. drew nothing extra
 * at all. The glyph is a state mark, not text a reader has to read mid-frame,
 * so it does not need that floor.
 *
 * WHY A PULSE (and not a spinner or a sweep). The mobile relay's running glyph
 * is `lo-pulse` — opacity 1 → 0.4 → 1 over 1.2 s, ease-in-out
 * (`local_operator/mobile/web/src/styles/index.css`, `.lo-pulse`) — on both
 * the tool row and the condensed fold's header. Matching it keeps the two
 * phone surfaces saying "live" the same way. Rotating `⟳` was rejected: a
 * text glyph's ink is not centred in its advance box, so it wobbles around
 * the wrong axis; a label sweep was rejected because the label is real text
 * the 0.72 floor exists to protect. No fill or card: visual audit D4 (no fill
 * in any state) still holds — only the glyph's own ink moves.
 *
 * REDUCE MOTION gets a STATIC, still-distinct mark rather than nothing: a 2 pt
 * accent rail tick in the gutter beside the glyph. It is a mark, not a fill —
 * it never sits behind the row's text — and it is absolutely positioned, so the
 * slot's 16 pt width and the row's baseline (U-08/U-41 geometry) do not move.
 *
 * PERFORMANCE. Every live glyph shares ONE native-driver loop
 * (`createSharedLoop`, as the skeleton does): a parallel turn's live rows beat
 * in phase, the JS thread schedules nothing per frame, and scrolling does not
 * re-render anything. A settled or composing glyph takes no share of the loop
 * and renders no `Animated` node at all. `memo` keeps the elapsed-time tick of
 * a running row from re-rendering the glyph.
 */
export type LiveGlyphMode = "still" | "pulse" | "static-live";

/** The indicator, as a pure rule so the state → drawing contract is a test. */
export const liveGlyphMode = (
	live: boolean,
	reduceMotion: boolean,
): LiveGlyphMode => (!live ? "still" : reduceMotion ? "static-live" : "pulse");

/** Test handles for the two drawn indicators (no visible text, aria-hidden). */
export const LIVE_GLYPH_PULSE_ID = "trace-live-pulse";
export const LIVE_GLYPH_TICK_ID = "trace-live-tick";

/** `lo-pulse` in the relay: 1.2 s cycle, floor 0.4. */
export const LIVE_PULSE_PERIOD_MS = 1200;
export const LIVE_PULSE_FLOOR = 0.4;

/* Created on first use, not at import: the transcript's other suites mock
 * `react-native` without `Animated`, and a module-level value would make
 * merely importing `ToolRow` throw there. */
let livePulseValue: Animated.Value | null = null;
const livePulse = (): Animated.Value => {
	livePulseValue ??= new Animated.Value(1);
	return livePulseValue;
};
let livePulseLoop: Animated.CompositeAnimation | null = null;

/** Exported for the loop-count test; the component is its only real user. */
export const livePulseUsers = createSharedLoop({
	start: () => {
		const ease = Easing.inOut(Easing.ease);
		livePulseLoop = Animated.loop(
			Animated.sequence([
				Animated.timing(livePulse(), {
					toValue: LIVE_PULSE_FLOOR,
					duration: LIVE_PULSE_PERIOD_MS / 2,
					easing: ease,
					useNativeDriver: true,
				}),
				Animated.timing(livePulse(), {
					toValue: 1,
					duration: LIVE_PULSE_PERIOD_MS / 2,
					easing: ease,
					useNativeDriver: true,
				}),
			]),
		);
		livePulseLoop.start();
	},
	stop: () => {
		livePulseLoop?.stop();
		livePulseLoop = null;
		// Rest at full ink so the next first user starts from a visible frame.
		livePulse().setValue(1);
	},
});

export type LiveGlyphProps = {
	/** The character (`⟳`, `✓`, …) — `toolGlyph` / the fold's own rule. */
	glyph: string;
	/** The glyph's ink class (`text-accent` when live). */
	inkClass: string;
	/** True only for the call that is running NOW (never composing/queued). */
	live: boolean;
};

const LiveGlyphImpl = ({ glyph, inkClass, live }: LiveGlyphProps) => {
	const reduceMotion = useReducedMotion();
	const mode = liveGlyphMode(live, reduceMotion);

	useEffect(() => {
		if (mode !== "pulse") return;
		return livePulseUsers.retain();
	}, [mode]);

	const text = (
		<Text className={cx(TRACE_GLYPH_BOX_CLASS, inkClass)} aria-hidden>
			{glyph}
		</Text>
	);

	if (mode === "pulse") {
		return (
			<Animated.View
				className="w-4 shrink-0"
				style={{ opacity: livePulse() }}
				testID={LIVE_GLYPH_PULSE_ID}
			>
				{text}
			</Animated.View>
		);
	}
	if (mode === "static-live") {
		return (
			<View className="w-4 shrink-0">
				{/* `-start-1.5` puts the tick 6 pt into the 16 pt row gutter, clear of
				 *  the glyph's ink; `inset-y` keeps it to the glyph's line box. */}
				<View
					aria-hidden
					pointerEvents="none"
					className="absolute -start-1.5 top-1 bottom-1 w-0.5 rounded-full bg-accent"
					testID={LIVE_GLYPH_TICK_ID}
				/>
				{text}
			</View>
		);
	}
	return <View className="w-4 shrink-0">{text}</View>;
};

export const LiveGlyph = memo(LiveGlyphImpl);
