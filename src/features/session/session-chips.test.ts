import { describe, expect, it } from "vitest";

import type { ModelEntry } from "@/contracts/types.gen";
import { UNAVAILABLE_TEXT } from "@/features/session/chip-labels";
import {
	friendlyModelName,
	sessionChipLabels,
} from "@/features/session/session-chips";

/**
 * TestFlight 578: an ended session ("Disk: recl… Ended") showed `n/a` / `n/a`
 * while the drawer row for the same conversation named its model. These pin the
 * fallback order (projection, then list row), the pickers' labels, the
 * disabled-until-resumed reading, and that the literal `n/a` never renders.
 */

const OPUS: ModelEntry = {
	selector: "anthropic/claude-opus-5-5",
	provider: "anthropic",
	model_id: "claude-opus-5-5",
	name: "claude-opus-5-5",
	label: "Claude Opus 5.5",
};

/** The durable fold an ended session is served: no runtime, so no model. */
const DURABLE = { model_label: "", model_selector: "", effort: "" };

describe("friendlyModelName", () => {
	it("names the catalogue row for a selector or a bare id", () => {
		expect(friendlyModelName("anthropic/claude-opus-5-5", [OPUS])).toBe(
			"Claude Opus 5.5",
		);
		expect(friendlyModelName("claude-opus-5-5", [OPUS])).toBe(
			"Claude Opus 5.5",
		);
	});
	it("falls back to the bare id when the catalogue has no row", () => {
		expect(friendlyModelName("openai/gpt-9", [OPUS])).toBe("gpt-9");
		expect(friendlyModelName("", [OPUS])).toBeNull();
	});
});

describe("sessionChipLabels — an ended session", () => {
	it("shows the list row's last-known model, disabled until resumed", () => {
		const { model, effort } = sessionChipLabels({
			projection: DURABLE,
			row: { model_label: "anthropic/claude-opus-5-5" },
			models: [OPUS],
			connection: "connected",
			ended: true,
		});
		expect(model).toEqual({
			kind: "unavailable",
			text: "Claude Opus 5.5",
			accessibilityLabel: "Model, Claude Opus 5.5",
			accessibilityHint: "Resume this session to change the model",
		});
		// No relay sends a last-known effort yet: hidden, not a dash.
		expect(effort).toBeNull();
	});

	it("uses the row's effort when a relay sends one, in the picker's words", () => {
		const { effort } = sessionChipLabels({
			projection: DURABLE,
			row: { model_label: "claude-opus-5-5", effort: "medium" },
			models: [OPUS],
			connection: "connected",
			ended: true,
		});
		expect(effort).toMatchObject({
			kind: "unavailable",
			text: "Medium",
			accessibilityHint: "Resume this session to change the effort",
		});
	});

	it("prefers a durable fold that did record a model over the row", () => {
		const { model } = sessionChipLabels({
			projection: { ...DURABLE, model_label: "anthropic/claude-opus-5-5" },
			row: { model_label: "openai/gpt-9" },
			models: [OPUS],
			connection: "connected",
			ended: true,
		});
		expect(model.kind === "unavailable" && model.text).toBe("Claude Opus 5.5");
	});

	it("is an explained dash only when no source has a model", () => {
		const { model } = sessionChipLabels({
			projection: DURABLE,
			row: null,
			models: [],
			connection: "connected",
			ended: true,
		});
		expect(model).toEqual({
			kind: "unavailable",
			text: UNAVAILABLE_TEXT,
			accessibilityLabel: "Model, not recorded",
			accessibilityHint: "This session has not recorded a model",
		});
		expect(JSON.stringify(model)).not.toMatch(/n\/a/);
	});
});

describe("sessionChipLabels — an attached session", () => {
	it("names the live model and rung with the pickers' labels, tappable", () => {
		const { model, effort } = sessionChipLabels({
			projection: {
				model_label: "anthropic/claude-opus-5-5",
				model_selector: "anthropic/claude-opus-5-5",
				effort: "medium",
			},
			row: { model_label: "anthropic/claude-opus-5-5" },
			models: [OPUS],
			connection: "connected",
			ended: false,
		});
		expect(model).toEqual({
			kind: "value",
			text: "Claude Opus 5.5",
			accessibilityLabel: "Model, Claude Opus 5.5",
		});
		expect(effort).toEqual({
			kind: "value",
			text: "Medium",
			accessibilityLabel: "Effort, Medium",
		});
	});

	it("backs an empty live model with the row, still tappable", () => {
		const { model } = sessionChipLabels({
			projection: DURABLE,
			row: { model_label: "claude-opus-5-5" },
			models: [],
			connection: "connected",
			ended: false,
		});
		expect(model).toMatchObject({ kind: "value", text: "claude-opus-5-5" });
	});

	it("never lets a row's rung paper over a live rungless model", () => {
		const { effort } = sessionChipLabels({
			projection: { ...DURABLE, model_label: "x/rungless" },
			row: { model_label: "x/rungless", effort: "high" },
			models: [],
			connection: "connected",
			ended: false,
		});
		expect(effort).toMatchObject({
			kind: "unavailable",
			text: UNAVAILABLE_TEXT,
		});
	});

	it("skeletons while the first frame is still coming", () => {
		const { model, effort } = sessionChipLabels({
			projection: null,
			row: { model_label: "claude-opus-5-5" },
			models: [],
			connection: "loading",
			ended: false,
		});
		// The row's model is known, so it shows rather than a skeleton.
		expect(model.kind).toBe("value");
		expect(effort?.kind).toBe("loading");
	});
});
