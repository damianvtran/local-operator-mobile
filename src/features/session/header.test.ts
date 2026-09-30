import { describe, expect, it } from "vitest";

import {
	DISPLAY_ADVANCE_PT,
	headerTitleChars,
} from "@/features/session/header";
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

describe("the header's title budget", () => {
	it("gives a phone's whole row to the name", () => {
		// 390 − 32 (gutters) − 44 (back control) − 8 (row gap) = 306 pt available.
		expect(headerTitleChars(phone(390))).toBe(21);
		expect(headerTitleChars(phone(430))).toBe(24);
		expect(headerTitleChars(phone(320))).toBe(16);
	});

	it("never promises more than the row can hold", () => {
		for (const width of [320, 360, 375, 390, 414, 430, 480]) {
			const budget = headerTitleChars(phone(width));
			const available = width - 32 - 44 - 8;
			expect(budget * DISPLAY_ADVANCE_PT, `${width}px`).toBeLessThanOrEqual(
				available,
			);
		}
	});

	it("respects the measure cap on a tablet rather than the raw width", () => {
		// A 1366 pt landscape tablet renders the screen in a 640 pt column.
		const budget = headerTitleChars({ width: 1366, height: 1024 });
		expect(budget).toBe(Math.floor((640 - 84) / DISPLAY_ADVANCE_PT));
		expect(budget * DISPLAY_ADVANCE_PT).toBeLessThanOrEqual(640 - 84);
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
			expect(shown).toContain("…");
		}
	});
});
