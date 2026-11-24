import { afterEach, describe, expect, it } from "vitest";

import type { ModelEntry } from "@/contracts/types.gen";
import {
	NOT_CONNECTED_HINT,
	UNAVAILABLE_TEXT,
} from "@/features/session/chip-labels";
import {
	friendlyModelName,
	sessionChipLabels,
} from "@/features/session/session-chips";
import { resetLocaleSource, setLocaleSource } from "@/i18n";

/**
 * TestFlight 578: an ended session ("Disk: recl… Ended") showed `n/a` / `n/a`
 * while the drawer row for the same conversation named its model. These pin the
 * fallback order (projection, then list row), the pickers' labels, the
 * editable-before-resume reading, and that the literal `n/a` never renders.
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
	it("offers the model picker before reopening a stored conversation", () => {
		const { model } = sessionChipLabels({
			projection: DURABLE,
			row: { model_label: OPUS.selector },
			models: [OPUS],
			connection: "connected",
			ended: true,
		});
		expect(model.kind).toBe("value");
	});
	it("shows the list row's last-known model, editable before resume", () => {
		const { model, effort } = sessionChipLabels({
			projection: DURABLE,
			row: { model_label: "anthropic/claude-opus-5-5" },
			models: [OPUS],
			connection: "connected",
			ended: true,
		});
		expect(model).toEqual({
			kind: "value",
			text: "Claude Opus 5.5",
			accessibilityLabel: "Model, Claude Opus 5.5",
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
			kind: "value",
			text: "Medium",
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
		expect(model.kind === "value" && model.text).toBe("Claude Opus 5.5");
	});

	it("still offers a picker when no source recorded a model", () => {
		const { model } = sessionChipLabels({
			projection: DURABLE,
			row: null,
			models: [],
			connection: "connected",
			ended: true,
		});
		expect(model).toEqual({
			kind: "value",
			text: "Default model",
			accessibilityLabel: "Model, not recorded",
		});
		expect(JSON.stringify(model)).not.toContain("n/a");
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
		// D1: hidden, as on an ended session — not a muted dash, and not the row's rung.
		expect(effort).toBeNull();
	});

	it("an unreachable route keeps the dash — that one says why nothing shows", () => {
		const { effort } = sessionChipLabels({
			projection: null,
			row: { model_label: "x/rungless", effort: "high" },
			models: [],
			connection: "unreachable",
			ended: false,
		});
		expect(effort).toMatchObject({
			kind: "unavailable",
			text: UNAVAILABLE_TEXT,
		});
	});

	it("before the first frame shows the row's model DISABLED — ended is not yet known (m1)", () => {
		const { model, effort } = sessionChipLabels({
			projection: null,
			row: { model_label: "claude-opus-5-5" },
			models: [],
			connection: "loading",
			ended: false,
		});
		// Shown (the row knows it), but not tappable: a tap could send a
		// `set_model` an ended session's relay refuses with 409.
		expect(model).toEqual({
			kind: "unavailable",
			text: "claude-opus-5-5",
			accessibilityLabel: "Model, claude-opus-5-5",
			accessibilityHint: NOT_CONNECTED_HINT,
		});
		expect(effort?.kind).toBe("loading");
	});

	it("skeletons before the first frame when the row names no model either", () => {
		const { model } = sessionChipLabels({
			projection: null,
			row: null,
			models: [],
			connection: "loading",
			ended: false,
		});
		expect(model.kind).toBe("loading");
	});
});

/* QA round 4, Q2 (#335): the ended chat's chips are the run-settings icon's
 *  spoken name too. */
/** The Russian effort name's lead word. */
const RU_EFFORT = /^Усилие, /;

describe("sessionChipLabels — keyed spoken names", () => {
	afterEach(() => resetLocaleSource());

	it("names an ended chat's model and effort in the reader's catalogue (ru)", () => {
		setLocaleSource(() => "ru");
		const { model, effort } = sessionChipLabels({
			projection: DURABLE,
			row: { model_label: "claude-opus-5-5", effort: "medium" },
			models: [OPUS],
			connection: "connected",
			ended: true,
		});
		expect(model.accessibilityLabel).toBe("Модель, Claude Opus 5.5");
		expect(effort?.accessibilityLabel).toMatch(RU_EFFORT);
	});
});
