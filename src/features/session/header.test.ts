import { describe, expect, it } from "vitest";

import {
	compactTitleChars,
	DISPLAY_ADVANCE_PT,
	headerTitleChars,
	STATE_WORD_PT,
	WIDEST_STATE_WORD,
} from "@/features/session/header";
import {
	MIN_HEADER_NAME_CHARS,
	middleTruncate,
} from "@/features/session/projection";
import { HEADER_STACK_WIDTH, headerStacks } from "@/ui/size-class";

/**
 * The header's character budget, pinned at the numbers it was calibrated on.
 *
 * The assertion that matters is the last one in each block: a name truncated to
 * this budget must FIT — budget × the widest measured advance ≤ the row's
 * available width — because a budget that promises more than the row can hold
 * puts the end clip back, which is the defect (design round 1, D2).
 */

const phone = (width: number) => ({ width, height: 844 });

/**
 * The advance the constant is supposed to be, held HERE as the measurement it came
 * from rather than read back from the module: the point of the budget is that no
 * name it admits overflows, so the test multiplies by the measured worst case and
 * not by whatever the code currently divides by. Set `DISPLAY_ADVANCE_PT` to 10
 * and this fails; the previous version of this assertion (`floor(a/c) * c <= a`)
 * held for every `c` and could not fail at all (review round 4, R6).
 */
const MEASURED_WIDEST_ADVANCE = 14.06;

describe("the header's title budget", () => {
	/* The chrome, as the module's constant derives it: the 16 pt gutters, both 48 pt
	 * header controls at the web build's `IconButton` size, each with its 8 pt gap —
	 * and the back control counts at the same 48 as the find lever (review round 1,
	 * F1: the pass's own U-07 rows measured the h1's box at `width − 144`, not 140).
	 * Kept here as the sum it is rather than read back from the module, for the
	 * reason `MEASURED_WIDEST_ADVANCE` is: the assertion is that the budget never
	 * over-promises the row, and a constant read from the code under test cannot
	 * fail. */
	/* Includes #118's 28 pt `NavigationMark` and the leading cluster's 4 pt gap
	 * (review round 2, R2-M1): the rendered leading slot is 80 pt, not 56. */
	const CHROME = 32 + 48 + 4 + 28 + 8 + 48 + 8;
	/* Below the stack floor the header stacks and the title owns its own row, so the
	 * budget's available width is the viewport minus the `px-4` gutters alone — the
	 * leg `header.ts` budgets with `width − 32` (QA round 1, Q1). */
	const available = (width: number, cap: number | null = null) =>
		width < HEADER_STACK_WIDTH
			? width - 32
			: Math.min(width, cap ?? width) - CHROME;

	it("gives a phone's whole row to the name", () => {
		// 390 − 176 (gutters, back + mark + their gap, find + its gap) = 214 pt.
		expect(headerTitleChars(phone(390))).toBe(15);
		expect(headerTitleChars(phone(430))).toBe(18);
		// 360 keeps 13 (184 pt available); the landscape cap lands at 31 (444 pt).
		expect(headerTitleChars(phone(360))).toBe(13);
	});

	it("gives the stacked header's title its own row below the stack floor", () => {
		// `iphone-se` stacks (`headerStacks`, `src/ui/size-class.ts`), so the title
		// box is 320 − 32 = 288 pt and the leading control's 48 pt stops competing:
		// the single-line arithmetic over-truncated a 13-character name the PRE-FIX
		// frames rendered whole (`Releas…sweep` where `Release sweep` fits — QA
		// round 1, Q1).
		expect(headerTitleChars(phone(320))).toBe(36);
		expect(headerTitleChars(phone(353))).toBe(40);
		expect(middleTruncate("Release sweep", headerTitleChars(phone(320)))).toBe(
			"Release sweep",
		);
	});

	it("keeps the stacked budget on the two-line clamp's wrapped capacity", () => {
		// The title clamps at TWO lines and the type doubles at 2×, so the budget is
		// the two lines' break-free capacity MINUS the wrap margin — the first
		// revision of this branch promised the capacity itself (20 characters) and
		// the audit's re-drive measured `Hello from…provider` wrapping to three
		// lines with the clamp cutting the tail (U-07, `content 202px in a 134px
		// box`, `S5/populated`, `iphone-se` 200 %). The render-time guarantee is the
		// audit's U-07 over the se cells at every scale; this pins the arithmetic
		// that produced the audited value and the shortened string itself.
		/* At the DEFAULT scale the stacked title gets two lines at 1x advance,
		 * not a hard-coded 2x: 288/14.06 = 20 per line, less the wrap slack. The
		 * 2x case is asserted in "the title budget at large text" below. */
		const perLine = Math.floor((320 - 32) / MEASURED_WIDEST_ADVANCE);
		expect(perLine).toBe(20);
		expect(headerTitleChars(phone(320))).toBe(2 * perLine - 4);
		expect(
			middleTruncate(
				"Hello from the mock provider",
				headerTitleChars(phone(320)),
			),
		).toBe("Hello from the mock provider");
	});

	it("never admits a name wider than its lines, at any phone width", () => {
		for (const width of [320, 360, 375, 390, 414, 430, 480]) {
			const budget = headerTitleChars(phone(width));
			/* Below the stack width the title is allowed TWO lines, so the budget
			 * is measured against twice the row, not one. */
			const lines = width < HEADER_STACK_WIDTH ? 2 : 1;
			expect(
				budget * MEASURED_WIDEST_ADVANCE,
				`${width}px`,
			).toBeLessThanOrEqual(available(width) * lines);
		}
	});

	it("uses the measure cap rather than the raw width on the two capped classes", () => {
		// A landscape phone is a phone (620), a 1366 pt landscape tablet is capped at
		// 640, and a portrait tablet at 560 — the three branches of `maxColumnWidth`
		// the budget depends on, each asserted against its own cap rather than against
		// the viewport.
		expect(headerTitleChars({ width: 844, height: 390 })).toBe(
			Math.floor(available(844, 620) / MEASURED_WIDEST_ADVANCE),
		);
		expect(headerTitleChars({ width: 1366, height: 1024 })).toBe(
			Math.floor(available(1366, 640) / MEASURED_WIDEST_ADVANCE),
		);
		expect(headerTitleChars({ width: 820, height: 1180 })).toBe(
			Math.floor(available(820, 560) / MEASURED_WIDEST_ADVANCE),
		);
		// And each of those is bounded by the cap, not by the screen it sits in.
		expect(headerTitleChars({ width: 844, height: 390 })).toBeLessThan(
			Math.floor(available(844) / MEASURED_WIDEST_ADVANCE),
		);
	});

	it("never goes below the kit's floor, even where the row cannot hold it", () => {
		// `components.md` § F-6.1: both ends of a name owe MIN_HEADER_NAME_CHARS
		// characters. A viewport narrower than the chrome still gets that floor —
		// the row overflows its own gap before it drops below the contract.
		expect(headerTitleChars(phone(100))).toBe(MIN_HEADER_NAME_CHARS);
	});

	it("keeps both ends of a real name at every phone width", () => {
		const name = "Refactor the relay client";
		for (const width of [320, 390, 430]) {
			const shown = middleTruncate(name, headerTitleChars(phone(width)));
			expect(shown.startsWith(name.slice(0, 4)), `${width}px head`).toBe(true);
			expect(shown.endsWith(name.slice(-4)), `${width}px tail`).toBe(true);
		}
	});
});

describe("compactTitleChars", () => {
	it("shrinks with the reader's text size, so one truncation is enough", () => {
		const at = (scale: number) =>
			compactTitleChars({ width: 915, height: 412 }, scale);
		expect(at(1)).toBeGreaterThan(at(1.5));
		expect(at(1.5)).toBeGreaterThan(at(2));
	});

	it("is tighter than the display budget at 200 %, where the old one overflowed", () => {
		// 915x412 at 200 %: the old budget promised more than the one-row title holds.
		expect(compactTitleChars({ width: 915, height: 412 }, 2)).toBeLessThan(
			headerTitleChars({ width: 915, height: 412 }) * 2,
		);
	});

	it("never goes below the floor that keeps both ends of a name", () => {
		// 200 pt of row minus the 144 pt of chrome leaves ~56 pt: well under the floor.
		expect(compactTitleChars({ width: 200, height: 160 }, 3)).toBe(
			MIN_HEADER_NAME_CHARS,
		);
	});

	/* Review round 4, D15 / QA N3. The Q9 fix moved the state word onto this row,
	 * where it takes width from the flex-1 title; a budget that ignored it
	 * promised more than the row holds and the platform clipped the tail (measured
	 * at 135 %: clientWidth 313 against scrollWidth 351). */
	it.each([
		{ width: 844, height: 390 },
		{ width: 915, height: 412 },
	])("charges the state word at $width, at every scale", (viewport) => {
		for (const scale of [1, 1.35, 2]) {
			const withWord = compactTitleChars(viewport, scale, { word: true });
			const bare = compactTitleChars(viewport, scale);
			expect(withWord).toBeLessThan(bare);
		}
	});

	/* DESIGN ROUND 5, D16/D17. The previous version of this row recomputed the
	 * word's width with the SAME constant production used, so it agreed with
	 * whatever production said — which is how a 38 % under-price shipped green.
	 * It now asserts against the RENDERED advance, measured on the shipped bundle
	 * (844x390, dark, 100 %: the 13-character "Not answering" run is 79.22 pt), and
	 * reads the word itself from the catalogue-derived export rather than a list of
	 * literals. A cheaper price or a longer future word fails here. */
	/* DESIGN ROUND 6, D18 / REVIEW M1. Two guards here could not fail: one
	 * bounded against `width - 32` (812 pt) instead of the real 620 pt column, the
	 * other recomputed the word's width with the same constant production used. A
	 * guard that cannot fail is worse than none, so both now assert against
	 * MEASURED numbers from the shipped frames and against the price's own band.
	 *
	 * The measured ink for the widest word ("Not answering", 13 characters) is
	 * 79.22 pt at 100 %; the row adds its 8 pt gap, and one point of slack covers a
	 * font-metric rounding. A doubled price or a wrong advance leaves the band. */
	it("prices the widest word inside a tolerance of the measured ink", () => {
		const INK_PT = 79.22;
		const GAP_PT = 8;
		expect(WIDEST_STATE_WORD.length).toBe(13);
		expect(STATE_WORD_PT).toBeGreaterThanOrEqual(INK_PT + GAP_PT + 1);
		expect(STATE_WORD_PT).toBeLessThanOrEqual(INK_PT + GAP_PT + 2);
	});

	it("never promises more title than the measured box holds", () => {
		/* clientWidth of the title element in `S5/health-quiet` at 844x390 and
		 *  915x412, dark and light (identical), 100/135/200 %: the box the run is
		 *  painted into. A budget that promises more than this is the double cut. */
		const TITLE_ADVANCE_PT = 9.4; // measured; see `COMPACT_TITLE_ADVANCE_PT`
		for (const [box, scale] of [
			[341, 1],
			[313, 1.35],
			[158, 2],
		] as const) {
			const chars = compactTitleChars({ width: 844, height: 390 }, scale, {
				dot: true,
				word: true,
			});
			expect(chars * TITLE_ADVANCE_PT * scale).toBeLessThanOrEqual(box);
			/* And the budget is not so cheap that it starves the name: the 8-character
			 *  floor is the kit's own minimum, and it is honoured at every scale. */
			expect(chars).toBeGreaterThanOrEqual(MIN_HEADER_NAME_CHARS);
		}
	});

	it("fits: a name cut to the budget times the compact advance stays inside the row", () => {
		const viewport = { width: 915, height: 412 };
		const chars = compactTitleChars(viewport, 2);
		const advance = 14.06 * (20 / 28) * 2;
		expect(chars * advance).toBeLessThanOrEqual(620 - 32 - 48 - 8 - 48 - 8);
	});
});

/* Review round 1 M1 / design D1 / QA Q7: the health control's dot and the ⋮
 * are chrome on the title line, and a budget that ignores them is the D2
 * double truncation again. */
describe("the session-health chrome", () => {
	const phone = (width: number) => ({ width, height: 844 });
	it("narrows the inline budget by the dot and the menu it is told about", () => {
		const bare = headerTitleChars(phone(390));
		const live = headerTitleChars(phone(390), { dot: true });
		const ended = headerTitleChars(phone(390), { menu: true });
		expect(live).toBeLessThan(bare);
		expect(ended).toBeLessThan(live);
		/* 390 − 176 − 16 = 198 pt; 390 − 176 − 56 = 158 pt, at 14.06 pt/char.
		 * 158 pt is the box QA measured on the ended header at this width, so the
		 *  budget now promises exactly what the row has (R2-M1 / Q7). */
		expect(live).toBe(Math.floor(198 / DISPLAY_ADVANCE_PT));
		expect(ended).toBe(Math.floor(158 / DISPLAY_ADVANCE_PT));
	});
	it("never admits a name wider than the box the extras leave", () => {
		for (const width of [360, 390, 430]) {
			for (const extras of [{ dot: true }, { menu: true }]) {
				const box = width - 176 - ("dot" in extras ? 16 : 56);
				expect(
					headerTitleChars(phone(width), extras) * DISPLAY_ADVANCE_PT,
				).toBeLessThanOrEqual(box);
			}
		}
	});
	it("stacked, only the dot narrows the title row: the menu sits on the back row", () => {
		expect(headerTitleChars(phone(320), { menu: true })).toBe(
			headerTitleChars(phone(320)),
		);
		expect(headerTitleChars(phone(320), { dot: true })).toBeLessThanOrEqual(
			headerTitleChars(phone(320)),
		);
	});
	it("narrows the compact budget the same way", () => {
		const viewport = { width: 844, height: 390 };
		expect(compactTitleChars(viewport, 1, { menu: true })).toBeLessThan(
			compactTitleChars(viewport, 1),
		);
	});
});

/* Review round 1 M1's scale half, measured on the live 200% frame: the dot's
 * 8pt and the gutters are rem-spaced, so at 2x they cost twice as much. */
describe("the title budget at large text", () => {
	const phone = (width: number) => ({ width, height: 844 });
	it("stacked at 200%, the dot and gutters cost twice as much", () => {
		const bare = headerTitleChars(phone(320), {}, 2);
		const withDot = headerTitleChars(phone(320), { dot: true }, 2);
		expect(withDot).toBeLessThan(bare);
		/* 320 − 64 − 32 = 224 pt per line at 2x14.06 → 7 chars/line, two lines
		 * less the wrap slack = 10. */
		expect(withDot).toBe(10);
	});
	it("the inline branch scales chrome and advance together", () => {
		expect(
			headerTitleChars(phone(390), { dot: true, menu: true }, 2),
		).toBeLessThanOrEqual(headerTitleChars(phone(390), { dot: true }, 2));
	});
	it("native chrome is pt-based: only the advance scales", () => {
		expect(
			headerTitleChars(phone(320), { dot: true }, 2, true),
		).toBeGreaterThan(headerTitleChars(phone(320), { dot: true }, 2));
	});
});

/* Review round 2, R2-M1 / R2-M2 (design D1, QA Q7). Each row names the MEASURED
 * geometry it is pinned to, so a budget that drifts off the row again fails by
 * name rather than by an ellipsis the audit exempts. */
describe("the round-2 budget regressions", () => {
	const phone = (width: number) => ({ width, height: 844 });
	it("ended at iphone-15 / 100%: the budget fits the measured 158 pt box, once", () => {
		/* Rendered leading slot is 80 pt (back 48 + gap 4 + NavigationMark 28), so
		 * the control starts at x 104; find starts at 270, less the 8 pt gap, and
		 * the title box is 158 pt. Before this fix the budget assumed a 56 pt
		 * leading slot and promised 13 characters (164 px) — the platform clipped
		 * the tail a second time (`Hello …ovi…`). */
		const chars = headerTitleChars(phone(390), { menu: true });
		expect(chars * DISPLAY_ADVANCE_PT).toBeLessThanOrEqual(158);
		expect(middleTruncate("Hello from the mock provider", chars)).not.toContain(
			"……",
		);
	});
	it("live at iphone-15 / 100%: the dot still fits the row it actually gets", () => {
		const chars = headerTitleChars(phone(390), { dot: true });
		expect(chars * DISPLAY_ADVANCE_PT).toBeLessThanOrEqual(198);
	});
	it("the dot costs the same in EVERY state, because it renders in every state", () => {
		/* D11: the dot holds ONE slot before the name whether live, yellow or grey,
		 * so the budget must charge it in every state. Charging it only on live
		 * (the round-1 rule, when non-live states drew it on a line of its own)
		 * made the ended budget 16 pt too generous — the second clip's last pixel. */
		expect(headerTitleChars(phone(390), { dot: true })).toBe(
			headerTitleChars(phone(390), { dot: true, menu: false }),
		);
		expect(
			headerTitleChars(phone(390), { dot: true, menu: true }),
		).toBeLessThan(headerTitleChars(phone(390), { dot: true }));
	});
	it("iphone-15 / 200%: the SCREEN's stacking predicate decides, not a width test", () => {
		/* `headerStacks(2, 390)` is true on SCALE, so this phone stacks even though
		 * 390 > HEADER_STACK_WIDTH. The inline formula used to run here with doubled
		 * chrome and collapse the name to the 8-character floor (`Hell…der`, where
		 * main gave 17). Stacked, the title row holds none of that inline chrome. */
		expect(headerStacks(2, 390)).toBe(true);
		const chars = headerTitleChars(phone(390), { menu: true }, 2);
		expect(chars).toBeGreaterThan(MIN_HEADER_NAME_CHARS);
		/* Two clamped lines at 2x in a 390 − 32×2 = 326 pt title row, less the wrap
		 * slack: floor(326 / 28.12) = 11 per line, ×2 − 4 = 18. */
		expect(chars).toBe(
			2 * Math.floor((390 - 64) / (2 * DISPLAY_ADVANCE_PT)) - 4,
		);
	});
	it("the tag-line header at 200% gets the same stacked budget", () => {
		/* The tag line is `headerDetail`, not extra title-row chrome, so the budget
		 * is the same one — it was collapsing to the floor identically. */
		expect(headerTitleChars(phone(390), {}, 2)).toBe(
			headerTitleChars(phone(390), { menu: true }, 2),
		);
	});
	it("iphone-se / 200% stays inside its two clamped lines", () => {
		const chars = headerTitleChars(phone(320), { menu: true }, 2);
		const perLine = Math.floor((320 - 64) / (2 * DISPLAY_ADVANCE_PT));
		expect(chars).toBe(2 * perLine - 4);
	});
});
