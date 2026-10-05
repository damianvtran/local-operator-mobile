// biome-ignore-all lint/suspicious/noArrayIndexKey: the bars are POSITIONAL — the row is a scrolling level history and a bar's identity is its slot, not its value. A value-derived key would be recomputed every frame to produce the same value (the case React's own key docs exempt).

import { useSyncExternalStore } from "react";
import { View } from "react-native";

import { LEVEL_BARS, type MeterStore } from "@/stt/levels";

/** The shortest a bar ever gets — its HEIGHT floor. Not zero: a flat meter must
 *  still read as a meter ("the microphone is on and hearing nothing") rather than
 *  as an empty row, which is the silent-take the meter exists to make visible
 *  before it becomes an empty transcript. */
const BAR_MIN_PX = 3;

/** The bars' WIDTH floor — separate from, and lower than, the height floor, because
 *  it exists for a different reason.
 *
 *  `flex-1` gives a bar a flex-BASIS of zero and react-native-web lets a flex item
 *  shrink to it, so at a text scale where the row is squeezed every bar measured
 *  0.0 px wide and the meter — this row's headline — rendered as nothing (design
 *  round 1, D2: 320 pt/150 % and 200 %, 390 pt/200 %). A minimum width the flex
 *  shrink cannot cross keeps each bar visible.
 *
 *  WHY 2.5 AND NOT THE 3 px HEIGHT FLOOR: the floor has to FIT its box. The group's
 *  min-content width is `LEVEL_BARS` widths plus their `gap-0.5` (2 px) gaps, and the
 *  narrowest meter box is 320 pt at 200 % (clientWidth ≈ 76 px, design round 2's
 *  measurement). At a 3 px width floor that group is 16 × 3 + 15 × 2 = 78 px — 2 px
 *  over the box — so the row's `overflow-hidden` took the shortfall off the trailing,
 *  NEWEST bar and clipped it to ≈1 px (design round 2, D7). At 2.5 px the group's
 *  min-content width is 16 × 2.5 + 15 × 2 = 70 px, inside the box with room to spare.
 *
 *  THE FLOOR IS INERT IN EVERY MEASURED CELL, which is a different claim from the
 *  one this comment used to make. It is not that the 2.5 px floor clamps at
 *  320 pt/200 %: the narrowest natural bar there measures 2.875 px, already above
 *  2.5, so the floor clamps nothing and no cell's painted width changed when it
 *  dropped from 3. Every wider cell's natural width is larger still (3.34 px at
 *  320 pt/100 %, up to 9.78 px at 390 pt/150 %). The floor is a backstop for a box
 *  narrower than any the matrix drives, not a value the meter currently rests on
 *  (review round 3, R3-5).
 *
 *  RESIDUAL, bounded: the fit argument assumes the meter box never drops below
 *  `LEVEL_BARS × 2.5 + (LEVEL_BARS − 1) × 2 = 70 px`, since that is where the floor
 *  would start clamping and the trailing bar would clip again. The tightest measured
 *  box is 76 px (320 pt at 200 %), leaving 6 px of slack — so this is a guard, not a
 *  standing margin. */
const BAR_MIN_W_PX = 2.5;

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
			className="h-6 flex-1 flex-row items-end gap-0.5 overflow-hidden"
			testID={testID}
			aria-hidden
		>
			{Array.from({ length: LEVEL_BARS }, (_, index) => {
				/* The history is oldest-first and RIGHT-anchored: a fresh take starts at
				 * the right edge and the row scrolls leftward as it fills, so a history
				 * shorter than the row leaves the SLOTS BEFORE it at the floor and the
				 * newest reading sits at the right (the mapping below places a short
				 * history's entries in the last slots). The alternative — filling from the
				 * left — was what this comment used to claim while the code did this; a
				 * right-anchored scrolling history is the conventional shape and is kept. */
				const offset = levels.length - LEVEL_BARS + index;
				const level = offset >= 0 ? (levels[offset] ?? 0) : 0;
				return (
					<View
						key={index}
						className="flex-1 rounded-full bg-danger"
						style={{
							minWidth: BAR_MIN_W_PX,
							height: BAR_MIN_PX + level * (BAR_MAX_PX - BAR_MIN_PX),
						}}
					/>
				);
			})}
		</View>
	);
};
