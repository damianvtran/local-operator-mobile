// biome-ignore-all lint/suspicious/noArrayIndexKey: the bars are POSITIONAL — the row is a scrolling level history and a bar's identity is its slot, not its value. A value-derived key would be recomputed every frame to produce the same value (the case React's own key docs exempt).

import { useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, {
	Easing,
	type SharedValue,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";

import {
	LEVEL_BARS,
	METER_SAMPLE_MS,
	type MeterStore,
	peakLevel,
	waveformBars,
} from "@/stt/levels";

/** The shortest a bar ever gets. Not zero: a flat meter must still read as a
 *  meter ("the microphone is on and hearing nothing") rather than as an empty
 *  row, which is the silent take the meter exists to make visible before it
 *  becomes an empty transcript. */
const BAR_MIN_PX = 3;

/** The tallest. The meter sits inside the composer's recording row, whose height
 *  is fixed across recording / transcribing / outcome (design §2.5 D3), so the
 *  meter can never be what sets it — a bar that grew the row would move the
 *  composer at the loudest syllable. */
const BAR_MAX_PX = 22;

/** A bar's share of its slot; the rest is the gap. A ratio rather than the old
 *  fixed `gap-0.5`, because the slot is now MEASURED (the roll needs a pitch in
 *  points): at the narrowest measured box (≈76 px, 320 pt at 200 %) a slot is
 *  4.75 px and the bar 2.9 px — above the 2.5 px width floor the flex layout
 *  needed to keep bars from collapsing to 0 px there (design round 1, D2). */
const BAR_FILL = 0.6;

/** Older bars fade toward this opacity: the trail reads as time passing, and the
 *  newest (full-opacity) bar is where the eye lands. Decoration only. */
const TRAIL_MIN_OPACITY = 0.35;

/** Bars drawn: one more than the history window, so the bar about to scroll off
 *  the leading edge is still painted while it slides out (no empty slot opens at
 *  the left on every sample). */
const DRAWN = LEVEL_BARS + 1;

const barHeight = (level: number) =>
	BAR_MIN_PX + level * (BAR_MAX_PX - BAR_MIN_PX);

/** One bar, reading its height from the shared array on the UI thread. */
const WaveBar = ({
	index,
	levels,
	width,
}: {
	index: number;
	levels: SharedValue<number[]>;
	width: number;
}) => {
	const style = useAnimatedStyle(() => ({
		height: barHeight(levels.value[index] ?? 0),
	}));
	return (
		<Animated.View
			className="rounded-full bg-danger"
			style={[
				{
					width,
					opacity:
						TRAIL_MIN_OPACITY + (1 - TRAIL_MIN_OPACITY) * (index / (DRAWN - 1)),
				},
				style,
			]}
		/>
	);
};

/**
 * The live waveform: a rolling row of level bars, mirrored about the centre line,
 * newest on the right.
 *
 * WHY IT IS BUILT THIS WAY (operator feedback, TestFlight 578: "a slick recording
 * design … with the waveform showing as you're talking"):
 * - The level is SAMPLED at 8 Hz (`METER_SAMPLE_MS`); drawing it at 8 Hz is a
 *   visible step. Each new sample instead sets the bars once and slides the whole
 *   row one slot left over exactly one sample interval on the UI thread
 *   (Reanimated), so the waveform rolls continuously at the display's frame rate.
 * - NOTHING here re-renders React per sample. The store is read through a plain
 *   subscription that writes shared values; the bars read those in worklets. The
 *   composer's controlled field (defect 1: the draft must stay readable while
 *   recording) is untouched by the meter, and so is this component's own tree.
 * - Reduce Motion replaces the roll with one static level bar holding the recent
 *   peak (`peakLevel`) — the "is it hearing me" answer without movement.
 *
 * Decoration, and marked as such: the recording state is carried by the word, the
 * timer and the controls' labels (design §2.5 — colour and motion are never the
 * only carrier), so a screen reader is not read a stream of bar heights.
 */
export const DictationMeter = ({
	meter,
	testID,
}: {
	meter: MeterStore;
	testID: string;
}) => {
	const reducedMotion = useReducedMotion();
	return reducedMotion ? (
		<StaticLevel meter={meter} testID={testID} />
	) : (
		<RollingWaveform meter={meter} testID={testID} />
	);
};

const RollingWaveform = ({
	meter,
	testID,
}: {
	meter: MeterStore;
	testID: string;
}) => {
	/* The slot pitch is the measured box over the window. Measured once per
	 * layout (a React state change on resize only, never per sample). */
	const [boxWidth, setBoxWidth] = useState(0);
	const pitch = boxWidth / LEVEL_BARS;
	const levels = useSharedValue<number[]>(waveformBars(meter.get(), DRAWN));
	const shift = useSharedValue(0);

	useEffect(() => {
		let last = meter.get();
		levels.value = waveformBars(last, DRAWN);
		return meter.subscribe(() => {
			const next = meter.get();
			levels.value = waveformBars(next, DRAWN);
			/* A reset (`set([])` at the start or end of a take) is not a sample:
			 * snap rather than roll a row of floors in. */
			if (next.length === 0 || next.length < last.length) {
				shift.value = 0;
			} else {
				shift.value = pitch;
				shift.value = withTiming(0, {
					duration: METER_SAMPLE_MS,
					easing: Easing.linear,
				});
			}
			last = next;
		});
	}, [meter, levels, shift, pitch]);

	const rowStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: shift.value }],
	}));

	return (
		<View
			className="h-6 flex-1 overflow-hidden"
			/* PHYSICAL AXIS, on purpose, in every locale: the waveform is a strip
			 * chart whose time runs left → right (newest at the right edge), like
			 * the system's own voice-memo and dictation meters, which do not mirror
			 * under RTL. Pinning `direction` keeps the row's flex order, the
			 * one-slot `left` offset and the `translateX` roll on that same axis;
			 * mirroring only some of them would roll the bars backwards. */
			style={{ direction: "ltr" }}
			onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}
			testID={testID}
			aria-hidden
		>
			{boxWidth > 0 ? (
				/* The drawn row is one slot wider than the box and starts one slot
				 * to the left, so at rest exactly the newest `LEVEL_BARS` are in
				 * view and the extra leading bar is the one sliding out. */
				<Animated.View
					className="absolute top-0 bottom-0 flex-row items-center justify-around"
					style={[{ left: -pitch, width: pitch * DRAWN }, rowStyle]}
				>
					{Array.from({ length: DRAWN }, (_, index) => (
						<WaveBar
							key={index}
							index={index}
							levels={levels}
							width={pitch * BAR_FILL}
						/>
					))}
				</Animated.View>
			) : null}
		</View>
	);
};

const StaticLevel = ({
	meter,
	testID,
}: {
	meter: MeterStore;
	testID: string;
}) => {
	/* A re-render of THIS bar alone, and only when the held peak changes value:
	 * React bails out of an unchanged primitive, so steady speech costs nothing. */
	const peak = useSyncExternalStore(
		meter.subscribe,
		() => peakLevel(meter.get()),
		() => peakLevel(meter.get()),
	);
	return (
		<View className="h-6 flex-1 justify-center" testID={testID} aria-hidden>
			<View className="h-1.5 overflow-hidden rounded-full bg-danger-wash">
				<View
					className="h-full rounded-full bg-danger"
					style={{ width: `${Math.max(4, Math.round(peak * 100))}%` }}
				/>
			</View>
		</View>
	);
};
