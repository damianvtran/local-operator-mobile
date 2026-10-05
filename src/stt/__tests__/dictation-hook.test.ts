import { describe, expect, it } from "vitest";

import { dictationFromHook, forcedLevels } from "@/stt/dictation-hook";
import { LEVEL_BARS } from "@/stt/levels";

describe("the lo-dictation capture hook", () => {
	it("names the state each accepted value forces", () => {
		expect(dictationFromHook("starting")).toEqual({
			phase: "starting",
			outcome: null,
		});
		expect(dictationFromHook("recording")).toEqual({
			phase: "recording",
			outcome: null,
		});
		expect(dictationFromHook("transcribing")).toEqual({
			phase: "transcribing",
			outcome: null,
		});
		// The three outcome lines are a RESTING machine with something to say —
		// forcing them as their own phase would render a state the machine has.
		expect(dictationFromHook("added")).toEqual({
			phase: "idle",
			outcome: "added",
		});
		expect(dictationFromHook("empty")).toEqual({
			phase: "idle",
			outcome: "empty",
		});
		expect(dictationFromHook("discarded")).toEqual({
			phase: "idle",
			outcome: "discarded",
		});
	});

	it("forces nothing for an absent or unknown value", () => {
		// A viewer, not a parser: a page asking for a state that does not exist
		// renders the ordinary composer rather than failing the capture.
		expect(dictationFromHook(null)).toBeNull();
		expect(dictationFromHook(undefined)).toBeNull();
		expect(dictationFromHook("")).toBeNull();
		expect(dictationFromHook("nonsense")).toBeNull();
	});
});

describe("the synthetic meter history", () => {
	it("fills exactly the meter's bar count, all within [0, 1]", () => {
		const levels = forcedLevels();
		expect(levels).toHaveLength(LEVEL_BARS);
		for (const level of levels) {
			expect(level).toBeGreaterThanOrEqual(0);
			expect(level).toBeLessThanOrEqual(1);
		}
	});

	it("is deterministic, so the same cell renders the same bytes twice", () => {
		expect(forcedLevels()).toEqual(forcedLevels());
	});
});
