import { describe, expect, it } from "vitest";

import { layoutFor, SPLIT_MIN_HEIGHT } from "@/ui/size-class";

/**
 * The layout thresholds, and only the thresholds.
 *
 * Each case below is a decision a reviewer argues with, and the two that matter
 * most are the ones where width alone would get it wrong: a landscape PHONE is
 * wide and short, so it must not get two panes, and a tablet near the breakpoint
 * must not either. What is NOT here: any assertion about a rendered component,
 * which belongs to the capture harness in `tools/visual` where the frames and the
 * geometry come from the same run.
 */

describe("layoutFor", () => {
	it("calls a phone compact at every phone size the matrix covers", () => {
		for (const [w, h] of [
			[320, 568],
			[360, 780],
			[390, 844],
			[430, 932],
		] as const) {
			const layout = layoutFor(w, h);
			expect(layout.sizeClass).toBe("compact");
			// A phone is its own measure: a cap would only add margins.
			expect(layout.measure).toBeNull();
			expect(layout.split).toBe(false);
		}
	});

	it("caps the column on a tablet, portrait and landscape differently", () => {
		// The cap is a MEASURE, not a fraction: a wider tablet must not get a wider
		// column, which is the defect the cap exists to prevent.
		const portrait = layoutFor(834, 1112);
		const landscape = layoutFor(1112, 834);
		expect(portrait.sizeClass).toBe("regular");
		expect(portrait.measure).toBe(560);
		expect(landscape.measure).toBe(640);
		expect(landscape.orientation).toBe("landscape");
	});

	it("splits only when there is room in BOTH directions", () => {
		// The rule the brief calls out: 844x390 and 915x412 are landscape phones, wide
		// and short, where two panes are two slivers under the keyboard.
		expect(layoutFor(844, 390).split).toBe(false);
		expect(layoutFor(915, 412).split).toBe(false);
		// And a wide window that is merely short is still not a split.
		expect(layoutFor(1440, SPLIT_MIN_HEIGHT - 1).split).toBe(false);
		// A large tablet is, in both orientations.
		expect(layoutFor(1366, 1024).split).toBe(true);
		expect(layoutFor(1112, 834).split).toBe(true);
		// 834x1112 is regular width but under the split width: one column, capped.
		expect(layoutFor(834, 1112).split).toBe(false);
	});
	it("drives the cap opt-out from the same two values the split uses", () => {
		/* `Screen`'s `capColumn={!split}` reads exactly these, so this pins the pair
		 *  a reviewer argues with: the split sizes DO carry a measure (the cap moves
		 *  from the screen into the detail pane), and every single-column size keeps
		 *  its own — including a landscape phone, which is wide enough to lose the
		 *  cap by accident and must not. */
		/* 1024x768 is read as LANDSCAPE by the width rule (1024 > 768) and therefore
		 *  takes the landscape-tablet measure, not the portrait one. Worth stating:
		 *  the only sizes that split today are LANDSCAPE tablets — a true portrait
		 *  tablet (768x1024) is under `SPLIT_MIN_WIDTH` and stays one column. */
		expect(layoutFor(1024, 768)).toMatchObject({ split: true, measure: 640 });
		expect(layoutFor(1366, 1024)).toMatchObject({ split: true, measure: 640 });
		expect(layoutFor(768, 1024)).toMatchObject({ split: false, measure: 560 });
		expect(layoutFor(844, 390)).toMatchObject({ split: false, measure: 620 });
		expect(layoutFor(390, 844).measure).toBeNull();
	});
});
