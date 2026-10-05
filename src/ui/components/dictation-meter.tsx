// biome-ignore-all lint/suspicious/noArrayIndexKey: the bars are POSITIONAL — the row is a scrolling level history and a bar's identity is its slot, not its value. A value-derived key would be recomputed every frame to produce the same value (the case React's own key docs exempt).

import { useSyncExternalStore } from "react";
import { View } from "react-native";

import { LEVEL_BARS, type MeterStore } from "@/stt/levels";

/** The shortest a bar ever gets. Not zero: a flat meter must still read as a meter
 *  ("the microphone is on and hearing nothing") rather than as an empty row, which
 *  is the silent-take the meter exists to make visible before it becomes an empty
 *  transcript. */
const BAR_MIN_PX = 3;

/** The tallest. The row sits inside the composer's recording bar, which is a
 *  `min-h-11` (44 pt) line, so the meter can never be the thing that sets the row's
 *  height — the design's D3 requires one height across recording / transcribing /
 *  outcome, and a meter that grew the row would break it at the loudest sample. */
const BAR_MAX_PX = 22;

/**
 * The recording meter: a row of level bars, oldest on the left.
 *
 * It subscribes to the level history rather than receiving it as a prop, so the
 * eight-per-second sampling re-renders THIS row and nothing else — the field the
 * reader is looking at (defect 1) must not repaint at that rate. `stt/levels.ts`
 * owns the store and says why; `use-dictation.ts` is the only writer.
 *
 * Decoration, and marked as such: the recording state is carried by the word, the
 * timer and the mic's own morphing label (design §2.5 — colour and motion are never
 * the only carrier), so a screen reader is not read a stream of bar heights.
 */
export const DictationMeter = ({
	meter,
	testID,
}: {
	meter: MeterStore;
	testID: string;
}) => {
	const levels = useSyncExternalStore(
		meter.subscribe,
		meter.get,
		/* The Node/SSR snapshot: this component renders inside a native tree, but the
		 * test runner and the web export both evaluate it once without a store. */
		meter.get,
	);
	return (
		<View
			className="h-6 flex-1 flex-row items-end gap-0.5"
			testID={testID}
			aria-hidden
		>
			{Array.from({ length: LEVEL_BARS }, (_, index) => {
				/* The history is oldest-first and may be shorter than the row (a
				 * recording that just started): the slots before it stay at the floor,
				 * so the meter fills from the left as it runs. */
				const offset = levels.length - LEVEL_BARS + index;
				const level = offset >= 0 ? (levels[offset] ?? 0) : 0;
				return (
					<View
						key={index}
						className="flex-1 rounded-full bg-danger"
						style={{ height: BAR_MIN_PX + level * (BAR_MAX_PX - BAR_MIN_PX) }}
					/>
				);
			})}
		</View>
	);
};
