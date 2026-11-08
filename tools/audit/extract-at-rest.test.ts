import { describe, expect, it } from "vitest";

import { extractAtRest } from "./audit";

/**
 * The re-drive's "measure at rest" bracket, pinned.
 *
 * Regression guard for #193's twelve iphone-se U-42 FAILs: the pinned working
 * line's dock tween (`margin-bottom: -gap * (1 - progress)`) was extracted
 * mid-flight on S5 streaming/aborted, scoring -0.3…-3.7 pt. The fakes below model
 * a page whose spacing fingerprint advances while a tween runs.
 */
describe("extractAtRest", () => {
	it("takes one extraction when the spacing did not move across it", async () => {
		let extracts = 0;
		const result = await extractAtRest({
			fingerprint: async () => "rest",
			extract: async () => ++extracts,
			wait: async () => {},
		});
		expect(result).toEqual({ reply: 1, retakes: 0, atRest: true });
	});

	it("retakes an extraction a tween moved across, and scores the settled one", async () => {
		// Readings 0..3 are mid-tween (each differs); from 4 on the tween has ended.
		let reads = 0;
		const fingerprint = async () => {
			const n = reads++;
			return n < 4 ? `margin-bottom:-${(4 - n) * 0.9}px` : "margin-bottom:0px";
		};
		let extracts = 0;
		const waits: number[] = [];
		const result = await extractAtRest({
			fingerprint,
			extract: async () => ++extracts,
			wait: async (ms) => {
				waits.push(ms);
			},
			pollMs: 250,
		});
		// take 1: reads 0/1 differ; take 2: reads 2/3 differ; take 3: reads 4/5 agree.
		expect(result).toEqual({ reply: 3, retakes: 2, atRest: true });
		expect(waits).toEqual([250, 250]);
	});

	it("keeps the last extraction, flagged, when the spacing never holds still", async () => {
		let reads = 0;
		let extracts = 0;
		const result = await extractAtRest({
			fingerprint: async () => reads++,
			extract: async () => ++extracts,
			wait: async () => {},
			takes: 3,
		});
		expect(result).toEqual({ reply: 3, retakes: 2, atRest: false });
	});
});
