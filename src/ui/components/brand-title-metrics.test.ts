import { describe, expect, it } from "vitest";
import { brandTitleMetrics } from "./brand-title-metrics";

describe("first-line brand alignment", () => {
	it("uses only the first line's cap and line height when a title wraps", () => {
		const first = { capHeight: 20, height: 34, y: 0 };
		const second = { capHeight: 20, height: 34, y: 34 };
		expect(brandTitleMetrics(([first, second] as const)[0])).toEqual({
			cap: 20,
			top: 7,
		});
		expect(brandTitleMetrics({ capHeight: 60, height: 102, y: 0 })).toEqual({
			cap: 60,
			top: 21,
		});
	});
	it("ignores invalid platform metrics", () => {
		expect(brandTitleMetrics({ capHeight: 0, height: 34, y: 0 })).toBeNull();
	});
});
