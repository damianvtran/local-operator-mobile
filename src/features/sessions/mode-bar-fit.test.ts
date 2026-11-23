import { describe, expect, it } from "vitest";
import { sidebarWidthFor } from "@/ui/size-class";
import { TOUCH_TARGET } from "@/ui/tokens.gen";
import {
	MODE_FIT_MARGIN,
	MODE_SEGMENT_CHROME,
	MODE_SEGMENT_GAP,
	MODE_TRACK_INSET,
	modeBarSegmentMode,
} from "./mode-bar-fit";

/* The drawer row around the track: its px-2 (16) + gap-1 (4) + the close
 * button + the track's own p-1 on both sides. */
const drawerTrack = (viewport: number, floor: number) =>
	sidebarWidthFor(viewport, floor) - 16 - 4 - floor - 2 * MODE_TRACK_INSET;

/* The natural widths of the two segments at 100 % (label + px-2 + border),
 * measured on the web build: "Agents" 47 pt and "Team Bridge" 79 pt. */
const AGENTS = 47 + MODE_SEGMENT_CHROME;
const BRIDGE = 79 + MODE_SEGMENT_CHROME;

describe("modeBarSegmentMode (issue #324)", () => {
	it("splits the track into equal halves when both labels fit in a half: 402 pt iPhone", () => {
		const track = drawerTrack(402, TOUCH_TARGET.ios);
		expect(track).toBe(286);
		expect([AGENTS, BRIDGE]).toEqual([65, 97]);
		expect(modeBarSegmentMode(track, [AGENTS, BRIDGE], MODE_SEGMENT_GAP)).toBe(
			"equal",
		);
	});

	it("keeps the proportional layout when the longer label does not fit a half: 320 pt Android", () => {
		const track = drawerTrack(320, TOUCH_TARGET.android);
		expect(track).toBe(196);
		// 2 × 97 + 4 = 198 > 196: equal halves would squeeze "Team Bridge".
		expect(modeBarSegmentMode(track, [AGENTS, BRIDGE], MODE_SEGMENT_GAP)).toBe(
			"proportional",
		);
	});

	/* PR #333 QA Q1-1: a MEASURED exact fit is not a fit. react-native-web's
	 *  `onLayout` reports `offsetWidth`, rounded to the nearest pixel: the
	 *  selected "Team Bridge" is 79.11 px and reports 79, so at 322 px the old
	 *  rule saw 2 × (79 + 18) + 4 = 198 ≤ 198, chose halves with a 79 px label
	 *  box and the label wrapped after "Team". Each segment keeps
	 *  MODE_FIT_MARGIN (1 pt) of slack, more than the ±0.5 px rounding. */
	it("leaves each half a 1 pt margin: a measured exact fit stays proportional", () => {
		expect(MODE_FIT_MARGIN).toBe(1);
		expect(modeBarSegmentMode(198, [65, 97], 4)).toBe("proportional");
		expect(modeBarSegmentMode(199, [65, 97], 4)).toBe("proportional");
		expect(modeBarSegmentMode(200, [65, 97], 4)).toBe("equal");
	});

	it("stays proportional until the track and every label are measured", () => {
		expect(modeBarSegmentMode(null, [65, 97], 4)).toBe("proportional");
		expect(modeBarSegmentMode(286, [65, null], 4)).toBe("proportional");
		expect(modeBarSegmentMode(286, [null, null], 4)).toBe("proportional");
		// A zero is a box that has not laid out yet (a hidden or detached view),
		// not a label that costs nothing.
		expect(modeBarSegmentMode(0, [65, 97], 4)).toBe("proportional");
		expect(modeBarSegmentMode(286, [0, 97], 4)).toBe("proportional");
		expect(modeBarSegmentMode(286, [], 4)).toBe("proportional");
	});

	it("uses the longest label whatever its position, so RTL order cannot change the answer", () => {
		expect(modeBarSegmentMode(286, [97, 65], 4)).toBe("equal");
		expect(modeBarSegmentMode(196, [97, 65], 4)).toBe("proportional");
	});
});
