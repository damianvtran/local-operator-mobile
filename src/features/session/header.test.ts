import { describe, expect, it } from "vitest";

import { headerTitleChars } from "@/features/session/header";
import {
	MIN_HEADER_NAME_CHARS,
	middleTruncate,
} from "@/features/session/projection";

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
	const available = (width: number, cap: number | null = null) =>
		Math.min(width, cap ?? width) - 32 - 44 - 8;

	it("gives a phone's whole row to the name", () => {
		// 390 − 32 (gutters) − 44 (back control) − 8 (row gap) = 306 pt available.
		expect(headerTitleChars(phone(390))).toBe(21);
		expect(headerTitleChars(phone(430))).toBe(24);
		expect(headerTitleChars(phone(320))).toBe(16);
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
