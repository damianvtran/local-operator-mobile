import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	HERO_EDGE,
	HERO_LIST_MIN_GAP,
	HERO_MARK_BLOCK,
	HERO_MARK_SIZE,
	HERO_OPTICAL_NUDGE,
	heroHeldInset,
	heroMeasured,
	heroTopInset,
	heroTopInsetAbove,
	IDENTITY_PILL_MARK_CAP_PT,
	identityPillMarks,
	listNaturalHeight,
	WORK_LIST_GAP,
	workListYield,
} from "./hero-layout";

const DRAWS_PILL_MARK = /size=\{marks\.mark\}/;
const DRAWS_PILL_CHEVRON = /size=\{marks\.chevron\}/;
const FIXED_PILL_CHEVRON = /<ChevronDown size=\{14\}/;

/* Design spec §2: the hero is optically centred in the band between the header
 * and the composer STACK, clamped 24 pt from both ends, on the 4 pt scale. */
const BLOCK = 154; // display greeting 34 + 24 + 44 + 8 + 44 (the spec's block)

describe("heroTopInset (spec §2)", () => {
	it("centres the block in the band, nudged up by 8 pt, on the 4 pt scale", () => {
		const band = 652;
		const top = heroTopInset(band, BLOCK);
		expect(top % 4).toBe(0);
		const centred = (band - BLOCK) / 2 - HERO_OPTICAL_NUDGE;
		expect(top).toBeLessThanOrEqual(centred);
		expect(centred - top).toBeLessThan(4);
		// Acceptance: the block's centre sits within 8 pt of the band's centre.
		const blockCentre = top + BLOCK / 2;
		expect(Math.abs(blockCentre - band / 2)).toBeLessThanOrEqual(
			HERO_OPTICAL_NUDGE + 3,
		);
	});

	it("re-centres UPWARD when a notice shortens the band, never past the clamps", () => {
		const without = heroTopInset(652, BLOCK);
		const withNotice = heroTopInset(652 - 67, BLOCK);
		expect(withNotice).toBeLessThan(without);
		expect(withNotice).toBeGreaterThanOrEqual(HERO_EDGE);
	});

	it("keeps 24 pt at both ends, and falls back to the top anchor when it cannot", () => {
		for (let band = BLOCK; band < 900; band += 1) {
			const top = heroTopInset(band, BLOCK);
			expect(top).toBeGreaterThanOrEqual(HERO_EDGE);
			if (band >= BLOCK + 2 * HERO_EDGE)
				expect(band - (top + BLOCK)).toBeGreaterThanOrEqual(HERO_EDGE);
		}
		// Under block + 48 the region scrolls from the 24 pt anchor.
		expect(heroTopInset(BLOCK + 47, BLOCK)).toBe(HERO_EDGE);
	});

	it("paints the top anchor until both boxes are measured", () => {
		expect(heroTopInset(0, BLOCK)).toBe(HERO_EDGE);
		expect(heroTopInset(652, 0)).toBe(HERO_EDGE);
	});
});

describe("hero first frame and focus hold (R4/D4, U1)", () => {
	it("is unpainted until both band and block are measured", () => {
		expect(heroMeasured(0, 0)).toBe(false);
		expect(heroMeasured(652, 0)).toBe(false);
		expect(heroMeasured(0, BLOCK)).toBe(false);
		expect(heroMeasured(652, BLOCK)).toBe(true);
	});
	it("holds the resting inset when the rows step away on focus", () => {
		const band = 652;
		const rest = heroTopInset(band, BLOCK);
		/* Rows gone: the block is just the greeting, which would centre lower. */
		const shorter = heroTopInset(band, 34);
		expect(shorter).toBeGreaterThan(rest);
		expect(heroHeldInset(shorter, rest)).toBe(rest);
	});
	it("still rises when the band itself shrinks (keyboard, notice)", () => {
		const rest = heroTopInset(652, BLOCK);
		const keyboardUp = heroTopInset(300, 34);
		expect(keyboardUp).toBeLessThan(rest);
		expect(heroHeldInset(keyboardUp, rest)).toBe(keyboardUp);
	});
});

/* TestFlight 578: "make sure the local operator logo is in the center above the
 * 'what would you like to work on' text, maybe all that text could be just a bit
 * smaller too". */
describe("the hero is a centred stack: mark, greeting, rows", () => {
	const SPLASH = readFileSync(
		new URL("./home-splash.tsx", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	const splash = SPLASH.slice(SPLASH.indexOf("export const HomeSplash"));
	const block = splash.slice(splash.indexOf("setBlock("));

	it("paints the mark at 32 pt, no larger than the 128 px asset holds at 3x", () => {
		/* Equality, not just the ceiling (code review n1): `* 3 <= 128` alone
		 *  would also pass at 42. */
		expect(HERO_MARK_SIZE).toBe(32);
		expect(HERO_MARK_SIZE * 3).toBeLessThanOrEqual(128);
	});

	it("puts the mark INSIDE the measured block, above the greeting, all centred", () => {
		const mark = block.indexOf("<NavigationMark size={HERO_MARK_SIZE} />");
		const greeting = block.indexOf("testID={starting ? SURFACE.homeStarting");
		expect(mark).toBeGreaterThan(0);
		expect(greeting).toBeGreaterThan(mark);
		expect(block.slice(0, mark)).toContain('className="items-center"');
		expect(block).toContain("testID={SURFACE.homeHeroMark}");
		/* Design D3: the white disc's edge reads on the light canvas. */
		expect(block).toContain(
			'className="mb-4 rounded-full border border-border-control" testID={SURFACE.homeHeroMark}',
		);
		expect(block).toContain('"text-center text-ink"');
	});

	it("steps the greeting one size down the scale, by token", () => {
		expect(splash).toContain('headline ? "text-title" : "text-heading"');
		expect(splash).not.toContain("text-display");
	});

	it("draws no suggestion rows in the hero: the bottom of the band is the work list's", () => {
		expect(block).not.toContain("SuggestionRow");
		expect(block).not.toContain("SURFACE.homeSuggestions");
	});
});

describe("the work list's rows (footer and TRY)", () => {
	const VIEW = readFileSync(
		new URL("./work-list-view.tsx", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");

	it("are full-width 44 pt targets on the hero's 16 pt rail", () => {
		// The container pulls out by the screen's 16 pt; each row brings its own.
		expect(VIEW).toContain('className="-mx-4" testID={SURFACE.homeWorkList}');
		expect(VIEW).toContain('"min-h-11 flex-row items-center gap-2 px-4"');
		expect(VIEW).toContain("style={{ minHeight: TOUCH_FLOOR }}");
	});

	it("reuse the drawer's row and offer no long-press menu", () => {
		expect(VIEW).toContain("<SessionRow");
		expect(VIEW).not.toContain("onLongPress");
		expect(VIEW).toContain(
			'section(t("mobile.sidebar.section.running"), running, "running")',
		);
	});
});

describe("the identity pill's mark and chevron (PR #358 D5)", () => {
	it("grow with the reader's text size, capped at the spec's 28 pt", () => {
		expect(identityPillMarks(1)).toStrictEqual({ mark: 20, chevron: 14 });
		// RED before the fix: 20 / 14 at every scale, a speck beside a 28 px label.
		expect(identityPillMarks(1.5)).toStrictEqual({ mark: 28, chevron: 21 });
		expect(identityPillMarks(2)).toStrictEqual({
			mark: IDENTITY_PILL_MARK_CAP_PT,
			chevron: IDENTITY_PILL_MARK_CAP_PT,
		});
	});

	it("are what the pill draws", () => {
		const splash = readFileSync(
			new URL("./home-splash.tsx", import.meta.url),
			"utf8",
		);
		expect(splash).toMatch(DRAWS_PILL_MARK);
		expect(splash).toMatch(DRAWS_PILL_CHEVRON);
		expect(splash).not.toMatch(FIXED_PILL_CHEVRON);
	});
});

describe("heroTopInsetAbove: the hero centres in the space the list leaves", () => {
	it("is heroTopInset exactly when there is no list", () => {
		expect(heroTopInsetAbove(652, BLOCK, 0)).toBe(heroTopInset(652, BLOCK));
	});

	it("centres in the band less the list and its 12 pt gap, on the 4 pt grid", () => {
		const band = 652;
		const list = 250;
		const top = heroTopInsetAbove(band, BLOCK, list);
		expect(top).toBe(heroTopInset(band - list - WORK_LIST_GAP, BLOCK));
		expect(top % 4).toBe(0);
		// Higher than the no-list centre: the hero sits in the smaller space.
		expect(top).toBeLessThan(heroTopInset(band, BLOCK));
		// The list's foot is the band's foot less the gap, so the hero's bottom
		// stays at least 24 pt above the list's top.
		expect(band - list - WORK_LIST_GAP - (top + BLOCK)).toBeGreaterThanOrEqual(
			HERO_EDGE,
		);
	});

	it("falls back to the 24 pt anchor when the space cannot hold the block", () => {
		expect(heroTopInsetAbove(400, BLOCK, 250)).toBe(HERO_EDGE);
	});

	it("keeps the held-inset rule: focus drops the list and the hero does not move", () => {
		const rest = heroTopInsetAbove(652, BLOCK, 250);
		const live = heroTopInsetAbove(652, BLOCK, 0);
		expect(heroHeldInset(live, rest)).toBe(rest);
	});
});

describe("workListYield: the mark goes first, then the rows, then the region scrolls", () => {
	const need = (hero: number, list: number) =>
		hero + list + WORK_LIST_GAP + 2 * HERO_EDGE;

	it("keeps everything when it fits", () => {
		expect(
			workListYield({
				band: need(BLOCK, 250),
				hero: BLOCK,
				mark: HERO_MARK_BLOCK,
				list: 250,
			}),
		).toBe(0);
	});

	it("drops the mark when that is enough", () => {
		const band = need(BLOCK - HERO_MARK_BLOCK, 250);
		expect(
			workListYield({ band, hero: BLOCK, mark: HERO_MARK_BLOCK, list: 250 }),
		).toBe(1);
		expect(
			workListYield({
				band: band - 1,
				hero: BLOCK,
				mark: HERO_MARK_BLOCK,
				list: 250,
			}),
		).toBe(2);
	});

	it("answers 0 until everything is measured", () => {
		expect(
			workListYield({ band: 0, hero: BLOCK, mark: HERO_MARK_BLOCK, list: 250 }),
		).toBe(0);
		expect(
			workListYield({ band: 500, hero: 0, mark: HERO_MARK_BLOCK, list: 250 }),
		).toBe(0);
		expect(
			workListYield({ band: 500, hero: BLOCK, mark: HERO_MARK_BLOCK, list: 0 }),
		).toBe(0);
	});
});

describe("the yield level settles (review r1 #1)", () => {
	// A work list of 2 running + 1 recent and the footer, as the splash measures
	// it: level 2 drops the second running row and the whole Recent section,
	// header included.
	const ROW = 56;
	const HEADER = 30;
	const FOOTER = 44;
	const FULL = HEADER + 2 * ROW + (HEADER + ROW) + FOOTER;
	const TRIMMED = HEADER + ROW + FOOTER;
	const TRIMMABLE = 2;

	type Natural = (input: {
		measured: number;
		level: 0 | 1 | 2;
		full: number;
	}) => number;
	/** The splash's loop: level from the natural heights, the list drawn at that
	 *  level, its layout measured, the natural height derived from it. */
	const run = (band: number, natural: Natural): (0 | 1 | 2)[] => {
		let list = 0;
		let full = 0;
		const levels: (0 | 1 | 2)[] = [];
		for (let frame = 0; frame < 12; frame++) {
			const level = workListYield({
				band,
				hero: BLOCK,
				mark: HERO_MARK_BLOCK,
				list,
			});
			const measured = level === 2 ? TRIMMED : FULL;
			if (level < 2) full = measured;
			list = natural({ measured, level, full });
			levels.push(level);
		}
		return levels;
	};
	const shipped: Natural = ({ measured, level, full }) =>
		listNaturalHeight({
			measured,
			level,
			full,
			trimmable: TRIMMABLE,
			rowHeight: ROW,
		});
	// What the splash did before: rows rebuilt from the first row's height.
	const rowEstimate: Natural = ({ measured, level }) =>
		measured + (level === 2 ? TRIMMABLE * ROW : 0);

	const bands = Array.from({ length: 400 }, (_, i) => 300 + i);

	it("negative control: the row-height estimate flips level in a band one header tall", () => {
		const flipping = bands.filter((band) => {
			const tail = run(band, rowEstimate).slice(-4);
			return new Set(tail).size > 1;
		});
		expect(flipping.length).toBe(HEADER);
	});

	it("settles in every band from short to tall, within a few frames", () => {
		for (const band of bands) {
			const tail = run(band, shipped).slice(-6);
			expect(new Set(tail).size, `band ${band}`).toBe(1);
		}
	});

	it("walks 0 -> 1 -> 2 as the band shrinks, with no band answering out of order", () => {
		const settled = bands.map((band) => run(band, shipped).at(-1) as number);
		for (let i = 1; i < settled.length; i++)
			expect(settled[i]).toBeLessThanOrEqual(settled[i - 1] ?? 2);
		expect(new Set(settled)).toEqual(new Set([0, 1, 2]));
	});

	it("uses the full height at level 2, and the row estimate only when none is known", () => {
		const input = { measured: TRIMMED, trimmable: TRIMMABLE, rowHeight: ROW };
		expect(listNaturalHeight({ ...input, level: 2, full: FULL })).toBe(FULL);
		expect(listNaturalHeight({ ...input, level: 2, full: 0 })).toBe(
			TRIMMED + TRIMMABLE * ROW,
		);
		expect(listNaturalHeight({ ...input, level: 1, full: FULL })).toBe(TRIMMED);
	});
});

describe("the hero keeps off the first section header (design D4)", () => {
	it("floors the layout gap at 16 pt, below the 24 pt a fitting hero keeps", () => {
		expect(HERO_LIST_MIN_GAP).toBe(16);
		expect(HERO_LIST_MIN_GAP).toBeLessThanOrEqual(HERO_EDGE);
	});

	it("is the spacer's minHeight in the splash, so the scrolling region keeps it", () => {
		const splash = readFileSync(
			new URL("./home-splash.tsx", import.meta.url),
			"utf8",
		);
		expect(splash).toContain("flexGrow: 1, minHeight: HERO_LIST_MIN_GAP");
	});

	it("keeps the yield level while an empty composer holds focus (review r1 #2)", () => {
		const splash = readFileSync(
			new URL("./home-splash.tsx", import.meta.url),
			"utf8",
		);
		expect(splash).toContain(
			"hasList ? listLevel : holding ? lastLevel.current : 0",
		);
	});
});
