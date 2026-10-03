import { describe, expect, it } from "vitest";

import {
	composerChipLabels,
	modelChipText,
} from "@/features/session/chip-labels";

/**
 * The three cases the chips can be in, each asserted on an OBSERVABLE outcome
 * (what the chip renders and what a screen reader is told) rather than on the
 * function's internals.
 *
 * Every case here stands for a defect that shipped once: a noun instead of a
 * skeleton, a skeleton that outlived the value it was waiting for, and an
 * accessible name that was just the raw string.
 */

/** The noun that must never reach the chip: the defect D6 fixed rendered it. */
const NOUN = /"model"/;

const chips = (
	model: string | null,
	effort: string | null,
	connection: "loading" | "connected" | "unreachable" = "connected",
) => composerChipLabels({ model, effort, connection });

describe("the composer's chips", () => {
	it("shows a skeleton — not a noun — while a projection is still coming", () => {
		const { model, effort } = chips(null, null, "loading");
		expect(model.kind).toBe("loading");
		expect(effort.kind).toBe("loading");
		// The defect D6 fixed: the old chip rendered the literal word `model`.
		expect(JSON.stringify(model)).not.toMatch(NOUN);
		expect(model.accessibilityLabel).toBe("Model, loading");
	});

	it("says n/a rather than pulsing forever when nothing is coming", () => {
		// The refused-route case (review R8): `loading` is false, so the chip must
		// report the value as unavailable instead of a skeleton that never resolves.
		const { model, effort } = chips(null, null, "unreachable");
		expect(model).toMatchObject({
			kind: "unavailable",
			text: "n/a",
			accessibilityLabel: "Model, not available",
			accessibilityHint: "Nothing is connected yet",
		});
		expect(effort.kind).toBe("unavailable");
	});

	it("treats a rungless model as unavailable, not as loading", () => {
		// The defect the D6 cut introduced and QA caught: an empty effort string is a
		// KNOWN state — this model has no effort control — and must not pulse.
		const { model, effort } = chips("anthropic/claude-opus-5", "", "connected");
		expect(model).toMatchObject({ kind: "value", text: "claude-opus-5" });
		expect(effort).toMatchObject({
			kind: "unavailable",
			text: "n/a",
			accessibilityHint: "This model has no effort control",
		});
	});

	it("names the field, never just the value", () => {
		const { model, effort } = chips("openai/gpt-5", "high");
		expect(model).toMatchObject({ kind: "value", text: "gpt-5" });
		expect(model.accessibilityLabel).toBe("Model, gpt-5");
		expect(effort.accessibilityLabel).toBe("Effort, high");
	});

	it("keeps the provider out of the chip but a bare name whole", () => {
		expect(modelChipText("anthropic/claude-opus-5")).toBe("claude-opus-5");
		expect(modelChipText("claude-opus-5")).toBe("claude-opus-5");
		// A trailing slash has no name after it, so the whole string is the name
		// rather than an empty chip.
		expect(modelChipText("anthropic/")).toBe("anthropic/");
		expect(modelChipText("")).toBeNull();
	});
});
