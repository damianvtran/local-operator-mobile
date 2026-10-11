import { describe, expect, it } from "vitest";

import { headerTitleChars } from "@/features/session/header";
import {
	MIN_HEADER_NAME_CHARS,
	middleTruncate,
} from "@/features/session/projection";
import { HEADER_STACK_WIDTH } from "@/ui/size-class";

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
	const CHROME = 32 + 48 + 8 + 48 + 8;
	/* Below the stack floor the header stacks and the title owns its own row, so the
	 * budget's available width is the viewport minus the `px-4` gutters alone — the
	 * leg `header.ts` budgets with `width − 32` (QA round 1, Q1). */
	const available = (width: number, cap: number | null = null) =>
		width < HEADER_STACK_WIDTH
			? width - 32
			: Math.min(width, cap ?? width) - CHROME;

	it("gives a phone's whole row to the name", () => {
		// 390 − 144 (gutters, the two 48 pt controls, both gaps) = 246 pt available.
		expect(headerTitleChars(phone(390))).toBe(17);
		expect(headerTitleChars(phone(430))).toBe(20);
		// 360 keeps 15 (216 pt available); the landscape cap lands at 33 (476 pt).
		expect(headerTitleChars(phone(360))).toBe(15);
	});

	it("gives the stacked header's title its own row below the stack floor", () => {
		// `iphone-se` stacks (`headerStacks`, `src/ui/size-class.ts`), so the title
		// box is 320 − 32 = 288 pt and the leading control's 48 pt stops competing:
		// the single-line arithmetic over-truncated a 13-character name the PRE-FIX
		// frames rendered whole (`Releas…sweep` where `Release sweep` fits — QA
		// round 1, Q1).
		expect(headerTitleChars(phone(320))).toBe(16);
		expect(headerTitleChars(phone(353))).toBe(18);
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
		const perLineAt2x = Math.floor((320 - 32) / (2 * MEASURED_WIDEST_ADVANCE));
		expect(perLineAt2x).toBe(10);
		expect(headerTitleChars(phone(320))).toBe(2 * perLineAt2x - 4);
		expect(
			middleTruncate(
				"Hello from the mock provider",
				headerTitleChars(phone(320)),
			),
		).toBe("Hello fr…rovider");
	});

	it("never admits a name wider than the row, at any phone width", () => {
		for (const width of [320, 360, 375, 390, 414, 430, 480]) {
			const budget = headerTitleChars(phone(width));
			expect(
				budget * MEASURED_WIDEST_ADVANCE,
				`${width}px`,
			).toBeLessThanOrEqual(available(width));
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
