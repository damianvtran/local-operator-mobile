import { describe, expect, it } from "vitest";

import {
	compactChromeFor,
	compactChromeShare,
	composerBudget,
	composerLimit,
	HEADER_STACK_WIDTH,
	headerStacks,
	headerStackWidth,
	layoutFor,
	regionOrder,
	SPLIT_MIN_HEIGHT,
	sessionStatusLayout,
	sidebarFooterScrolls,
	snapRegion,
} from "@/ui/size-class";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TOUCH_TARGET } from "@/ui/tokens.gen";
import { FIELD_BORDER_Y } from "@/ui/variants";

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

describe("sidebarFooterScrolls", () => {
	it("preserves rows in short landscape without changing portrait or tablet flow", () => {
		expect(sidebarFooterScrolls(layoutFor(844, 390))).toBe(true);
		expect(sidebarFooterScrolls(layoutFor(568, 320))).toBe(true);
		for (const [width, height] of [
			[390, 844],
			[320, 568],
			[834, 1112],
			[1112, 834],
		] as const) {
			expect(sidebarFooterScrolls(layoutFor(width, height))).toBe(false);
		}
	});
});

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

describe("headerStacks", () => {
	it("stacks at the narrowest phone even at 100 % text", () => {
		/* The width trigger (D1): the busiest header's chrome (248 dp) plus its
		 *  title (106 dp) cannot fit below 354 dp — measured at 320 pt, where the
		 *  title rendered "Ses…" (clientW 72, scrollW 106). */
		expect(headerStacks(1, 320)).toBe(true);
		expect(headerStacks(1, HEADER_STACK_WIDTH - 1)).toBe(true);
	});

	it("keeps one line where the title fits — the sizes the matrix covers", () => {
		expect(headerStacks(1, HEADER_STACK_WIDTH)).toBe(false);
		expect(headerStacks(1, 360)).toBe(false);
		expect(headerStacks(1, 390)).toBe(false);
		expect(headerStacks(1, 430)).toBe(false);
	});

	it("stacks at large text at every width, exactly above the threshold", () => {
		expect(headerStacks(LARGE_TEXT_SCALE, 390)).toBe(false);
		expect(headerStacks(LARGE_TEXT_SCALE + 0.01, 390)).toBe(true);
		expect(headerStacks(2, 320)).toBe(true);
	});

	it("takes the bound a screen passes for its own cluster", () => {
		/* Round 2 (R2-1): a screen whose action cluster is heavier than the kit
		 *  floor passes its live fit as the third argument; callers that pass
		 *  nothing keep the behaviour pinned above. */
		expect(headerStacks(1, 390, 383)).toBe(false);
		expect(headerStacks(1, 390, 397)).toBe(true);
		expect(headerStacks(1, HEADER_STACK_WIDTH)).toBe(false);
	});
});

describe("headerStackWidth", () => {
	/* The round-2 re-derivation (R2-1). The kit floor covers the r1 frame — one
	 *  asks badge; the merged header can carry TWO count badges, and this is the
	 *  live fit the sessions screen passes. Every number is a round-2 probe
	 *  reading; the sum rounds up, so the bound errs toward stacking early. */

	it("reproduces the kit constant for the r1 frame, and floors lighter sets", () => {
		expect(headerStackWidth(null, 4)).toBe(HEADER_STACK_WIDTH);
		expect(headerStackWidth(null, 0)).toBe(HEADER_STACK_WIDTH);
		expect(headerStackWidth(0, 0)).toBe(HEADER_STACK_WIDTH);
		expect(headerStackWidth(99, 0)).toBe(HEADER_STACK_WIDTH);
	});

	it("raises the bound for the merged header's two badges", () => {
		/* Measured before the fix: with both badges at 2-digit counts the title
		 *  clipped at 360 (69/106), 375 (84/106) and 390 (99/106). */
		const both = headerStackWidth(99, 99);
		expect(both).toBe(397);
		for (const width of [360, 375, 390]) {
			expect(headerStacks(1, width, both)).toBe(true);
		}
		expect(headerStacks(1, 430, both)).toBe(false);
	});

	it("keeps 390 single-line at one-digit counts, and fixes 360/375", () => {
		const pair = headerStackWidth(9, 9);
		expect(pair).toBe(383);
		expect(headerStacks(1, 390, pair)).toBe(false);
		expect(headerStacks(1, 375, pair)).toBe(true);
		expect(headerStacks(1, 360, pair)).toBe(true);
	});

	it("widens with further digits rather than clamping", () => {
		expect(headerStackWidth(100, 99)).toBeGreaterThan(headerStackWidth(99, 99));
		expect(headerStackWidth(9, 100)).toBeGreaterThan(headerStackWidth(9, 99));
	});
});

describe("compactChromeFor", () => {
	const screen = (width: number, height: number) => ({ width, height });

	it("is on for a phone physically on its side, at every short landscape size", () => {
		for (const [w, h] of [
			[844, 390],
			[915, 412],
			[568, 320],
		] as const) {
			expect(
				compactChromeFor({ window: screen(w, h), screen: screen(w, h) }),
			).toBe(true);
		}
	});

	it("stays off for portrait phones and portrait tablets", () => {
		for (const [w, h] of [
			[390, 844],
			[320, 568],
			[834, 1112],
		] as const) {
			expect(
				compactChromeFor({ window: screen(w, h), screen: screen(w, h) }),
			).toBe(false);
		}
	});

	it("stays off for a landscape tablet that has the room", () => {
		expect(
			compactChromeFor({
				window: screen(1112, 834),
				screen: screen(1112, 834),
			}),
		).toBe(false);
		expect(
			compactChromeFor({
				window: screen(1366, 1024),
				screen: screen(1366, 1024),
			}),
		).toBe(false);
	});

	it("is NOT fooled by a keyboard-shortened portrait window", () => {
		// 390x844 portrait with the keyboard up: the WINDOW is 390x300 (wider than
		// tall) but the physical screen is still portrait. Deciding from the window
		// would flip the whole screen to the landscape layout on every keystroke.
		expect(
			compactChromeFor({ window: screen(390, 300), screen: screen(390, 844) }),
		).toBe(false);
		expect(
			compactChromeFor({ window: screen(320, 200), screen: screen(320, 568) }),
		).toBe(false);
	});

	it("stays off for a portrait-SHAPED window even on a landscape screen (floating window)", () => {
		expect(
			compactChromeFor({ window: screen(400, 600), screen: screen(1112, 834) }),
		).toBe(false);
	});

	it("keeps the compact form while a landscape keyboard shortens the window further", () => {
		expect(
			compactChromeFor({ window: screen(844, 200), screen: screen(844, 390) }),
		).toBe(true);
	});
});

describe("compact secondary region", () => {
	it("shrinks its share as text grows, inside the 0.27-0.34 band", () => {
		expect(compactChromeShare(1)).toBeCloseTo(0.34);
		expect(compactChromeShare(1.5)).toBeCloseTo(0.305);
		expect(compactChromeShare(2)).toBeCloseTo(0.27);
		expect(compactChromeShare(3)).toBeCloseTo(0.27);
		expect(compactChromeShare(0.5)).toBeCloseTo(0.34);
	});

	it("keeps the transcript at >= 96 pt at 844x390 for 100 %, 150 % and 200 % text", () => {
		// header + composer measured on the rig: 157 / 161 / 177 pt, plus the 4 pt gap.
		for (const [scale, fixed] of [
			[1, 157],
			[1.5, 161],
			[2, 177],
		] as const) {
			const region = Math.round(390 * compactChromeShare(scale));
			expect(390 - fixed - 4 - region).toBeGreaterThanOrEqual(96);
		}
	});

	it("cuts on a row boundary and reports what is hidden", () => {
		expect(snapRegion([49, 72, 52, 44], 400, 24)).toEqual({
			height: 217,
			hidden: 0,
		});
		expect(snapRegion([49, 72, 52, 44], 117, 24)).toEqual({
			height: 49,
			hidden: 3,
		});
		expect(snapRegion([49, 72, 52, 44], 150, 24)).toEqual({
			height: 121,
			hidden: 2,
		});
	});

	it("shows the first row whole when the cap holds it, even if the cue then no longer fits", () => {
		// a wrapped roster header (89 pt) in a 111 pt cap with a 48 pt cue: 111 - 48 = 63 < 89
		expect(snapRegion([89, 44, 52], 111, 48)).toEqual({
			height: 89,
			hidden: 2,
		});
	});

	it("shows neither region nor cue when the cap cannot hold a readable line (UX U3)", () => {
		// the 7.4 pt sliver measured at a 200 pt keyboard-shortened window
		expect(snapRegion([89, 44], 7, 38)).toEqual({ height: 0, hidden: 2 });
		expect(snapRegion([89, 44], 39, 38)).toEqual({ height: 0, hidden: 2 });
		// the 844x200 keyboard-shortened window: a 54 pt cap less the 38 pt cue is 16 pt
		expect(snapRegion([49, 44], 54, 38)).toEqual({ height: 0, hidden: 2 });
	});

	it("only cuts a first row that is taller than the whole cap", () => {
		expect(snapRegion([200, 40], 117, 24)).toEqual({ height: 117, hidden: 1 });
	});

	it("ignores rows that are not rendered", () => {
		expect(snapRegion([0, 49, 0, 52], 117, 24)).toEqual({
			height: 101,
			hidden: 0,
		});
	});
});

describe("regionOrder", () => {
	it("keeps the wide column's order exactly", () => {
		expect(regionOrder(false, false)).toEqual([
			"todos",
			"subagents",
			"working",
		]);
		expect(regionOrder(false, true)).toEqual(["todos", "subagents", "working"]);
	});

	it("leads the compact region with live work, the strip before the tasks list", () => {
		expect(regionOrder(true, false)).toEqual([
			"working",
			"subagents",
			"strip",
			"todos",
		]);
	});

	it("lifts a roster with a failed or parked child above the working line", () => {
		expect(regionOrder(true, true)).toEqual([
			"subagents",
			"working",
			"strip",
			"todos",
		]);
	});
});

describe("composerLimit (D-c: portrait is bounded by the window too)", () => {
	it("answers only when the composer reaches the window's bottom", () => {
		// The recheck's exact frame: 320x568, composer 314.4 + 424.8 = 739.2
		expect(composerLimit(568, 314, 425)).toBe(254);
		expect(composerLimit(844, 470, 400)).toBe(374);
	});

	it("has no answer before the first measurement, or while it still fits", () => {
		expect(composerLimit(568, null, null)).toBe(null);
		// 100 % portrait: the composer still sits inside the window — old behaviour
		expect(composerLimit(568, 380, 60)).toBe(null);
		// 320/200% long draft: 314 + 424 is over the bottom, and stays capped at it
		expect(composerLimit(568, 314, 254)).toBe(254);
	});

	it("never returns less than one control target", () => {
		expect(composerLimit(568, 560, 40)).toBe(TOUCH_TARGET.ios);
		expect(composerLimit(568, 700, 10)).toBe(TOUCH_TARGET.ios);
	});
});

describe("composerBudget (UX U1: the actions never scroll away)", () => {
	it("on a tight screen the field gets everything and the extras scroll in what is left", () => {
		// 390 pt screen at 200 %: composer share 0.45 -> 175 pt; receipt line 52; padding 8.
		// An error line (40 pt) is above the field.
		const budget = composerBudget(175, 52, 40, 48, 8);
		// `field` is the CONTENT cap; the field paints cap + its 1px border top and
		// bottom, which is the box the composer's share has to pay for.
		expect(budget).toEqual({ extras: 40, field: 73 });
		const painted = budget.field + FIELD_BORDER_Y + budget.extras + 52 + 8;
		if (painted > 175) throw new Error(`over budget: ${painted} > 175`);
		expect(painted).toBe(175);
	});

	it("never takes the field's touch floor for the extras: they scroll instead", () => {
		// 150 pt of attachments in 115 pt of room: the extras are capped, the field keeps 48
		const budget = composerBudget(175, 52, 150, 48, 8);
		// 46 content + 2 border = the 48 pt touch floor, in the box the screen spends
		expect(budget.field).toBe(48 - FIELD_BORDER_Y);
		expect(budget.field + FIELD_BORDER_Y).toBe(48);
		expect(budget.extras).toBe(115 - 48);
	});

	it("with nothing above the field the field takes the whole remainder", () => {
		expect(composerBudget(175, 52, 0, 48, 8)).toEqual({
			extras: 0,
			field: 115 - FIELD_BORDER_Y,
		});
	});

	it("reserves the dictation row so a recording take cannot push the composer past its share", () => {
		// 175 pt share, 52 receipt, 8 pad, 49 + 8 dictation: only 58 pt left for the field
		const budget = composerBudget(175, 52, 0, 48, 8, 57);
		expect(budget.field).toBe(58 - FIELD_BORDER_Y);
		expect(budget.field + FIELD_BORDER_Y + 52 + 8 + 57).toBeLessThanOrEqual(
			175,
		);
	});

	it("spends a portrait column budget without overspending it", () => {
		// 320x568 / 200 %: limit 254, receipt wrapped to 112, root pad 16, no extras.
		const budget = composerBudget(254, 112, 0, 48, 16);
		const painted = budget.field + FIELD_BORDER_Y + 112 + 16;
		if (painted > 254) throw new Error(`over column: ${painted} > 254`);
		expect(painted).toBe(254);
		expect(budget.field).toBe(254 - 112 - 16 - FIELD_BORDER_Y);
	});

	it("gives the extras their share before the field on a narrow column", () => {
		const budget = composerBudget(254, 112, 80, 48, 16);
		// 126 of room, of which the field's 48 pt floor is reserved: the extras get 78
		expect(budget.extras).toBe(78);
		expect(budget.field).toBe(48 - FIELD_BORDER_Y);
		expect(budget.field + FIELD_BORDER_Y + 112 + 16 + budget.extras).toBe(254);
	});

	it("never shrinks the field below its touch floor, even if the budget is smaller", () => {
		// The floor is a PAINTED floor (min-height on the field's box), so the content
		// cap it translates to is one border shorter.
		expect(composerBudget(90, 52, 30, 48, 8).field).toBe(48 - FIELD_BORDER_Y);
	});
});

/**
 * D2, final visual audit: the tray is a PHONE surface, and the old inline bands must
 * not survive on a portrait phone. These are the exact widths the store/README
 * captures use, plus the tablet and short-landscape cases that must NOT change.
 */
describe("session status layout", () => {
	it("is a phone at the capture widths and not at tablet", () => {
		for (const width of [360, 390, 430]) {
			expect(sessionStatusLayout(width, false)).toEqual({
				phone: true,
				tray: true,
				inlineSecondary: false,
				statusSheet: true,
			});
		}
		expect(sessionStatusLayout(1024, false).phone).toBe(false);
		// Tablet: inline panels, per-panel open state, no tray.
		expect(sessionStatusLayout(1024, false)).toEqual({
			phone: false,
			tray: false,
			inlineSecondary: true,
			statusSheet: false,
		});
	});

	it("keeps short landscape exactly as it was", () => {
		// Before the phone flag, compact rendered the TRAY, no inline region and the
		// sheet — the tray was designed here. Encoding the opposite turned landscape
		// into a duplicate band with dead panel buttons (R8-1).
		const landscape = sessionStatusLayout(844, true);
		expect(landscape.phone).toBe(false);
		expect(landscape.tray).toBe(true);
		expect(landscape.inlineSecondary).toBe(false);
		expect(landscape.statusSheet).toBe(true);
	});
});
