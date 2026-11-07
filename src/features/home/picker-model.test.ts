import { describe, expect, it } from "vitest";

import type { ModelEntry } from "@/contracts";
import { modelsResponseSchema } from "@/contracts";
import { foldersFrom } from "@/features/home/home-defaults";
import {
	defaultEffortFor,
	EFFORT_VOCABULARY,
	effortAfterModelChange,
	effortOffer,
	filterModels,
	folderRows,
	homeChips,
	MODEL_SEARCH_THRESHOLD,
	typedFolder,
} from "@/features/home/picker-model";

/**
 * The three pickers' rules, asserted on the values that reach the chip and the
 * start body — the daemon contract of local-operator v0.101.9
 * (`docs/design/mobile-start-receipts.md`, "Picking a model and effort").
 */

const entry = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
	selector: "anthropic/claude-opus-5-5",
	provider: "anthropic",
	model_id: "claude-opus-5-5",
	name: "claude-opus-5-5",
	label: "Opus 5.5",
	connected: true,
	efforts: ["low", "medium", "high", "xhigh", "max"],
	...overrides,
});
const opus = entry();
const haiku = entry({
	selector: "anthropic/claude-haiku-4-5",
	model_id: "claude-haiku-4-5",
	name: "claude-haiku-4-5",
	label: "Haiku 4.5",
	efforts: [],
});
const routed = entry({
	selector: "radient/auto",
	provider: "radient",
	model_id: "auto",
	name: "auto",
	label: "Auto",
	efforts: undefined,
});
const models = [opus, haiku, routed];
const fallback = {
	selector: opus.selector,
	provider: "anthropic",
	model_id: opus.model_id,
	effort: "medium",
};

const chips = (over: Partial<Parameters<typeof homeChips>[0]> = {}) => {
	const input = {
		connected: true,
		modelsRead: "ready" as const,
		chosenModel: null,
		chosenEffort: null,
		models,
		catalogueDefault: fallback,
		...over,
	};
	return homeChips({
		...input,
		offer: effortOffer({
			supported: true,
			chosenModel: input.chosenModel,
			models: input.models,
			catalogueDefault: input.catalogueDefault,
		}),
		defaultEffort: defaultEffortFor(input.chosenModel, input.catalogueDefault),
		...over,
	});
};

describe("the models contract additions stay backward compatible", () => {
	it("parses an older daemon's answer with neither `default` nor `efforts`", () => {
		const parsed = modelsResponseSchema.parse({
			models: [{ selector: "a/b", provider: "a", model_id: "b", name: "b" }],
		});
		expect(parsed.default).toBeUndefined();
		expect(parsed.models[0]?.efforts).toBeUndefined();
	});

	it("keeps `default: null` and `efforts: []` as the readings they are", () => {
		const parsed = modelsResponseSchema.parse({
			models: [{ ...haiku }],
			default: null,
		});
		expect(parsed.default).toBeNull();
		expect(parsed.models[0]?.efforts).toStrictEqual([]);
	});
});

describe("what the chips say", () => {
	it("names the computer's default model and effort before any choice", () => {
		// The operator: "The user's default model doesn't seem to be honoured".
		const { model, effort } = chips();
		expect(model).toMatchObject({ kind: "value", text: "Opus 5.5" });
		expect(effort).toMatchObject({ kind: "value", text: "Medium" });
		expect(model.accessibilityLabel).toContain("this computer's default");
	});

	it("names the reader's own choices, by friendly label", () => {
		const { model, effort } = chips({
			chosenModel: routed,
			chosenEffort: "high",
		});
		expect(model).toMatchObject({ kind: "value", text: "Auto" });
		expect(effort).toMatchObject({ kind: "value", text: "High" });
		expect(effort.accessibilityLabel).toContain("chosen for this conversation");
	});

	it("never names a model when the computer resolved no default", () => {
		const { model } = chips({ catalogueDefault: null });
		expect(model).toMatchObject({ kind: "value", text: "No default" });
		expect(JSON.stringify(model)).not.toContain("Opus");
	});

	it("keeps #174's plain Default for an older daemon that publishes none", () => {
		const { model, effort } = chips({ catalogueDefault: undefined });
		expect(model).toMatchObject({ kind: "value", text: "Default" });
		expect(effort).toMatchObject({ kind: "value", text: "Default" });
	});

	it("disables the effort chip, with its reason, for a model with no effort setting", () => {
		const { effort } = chips({ chosenModel: haiku });
		expect(effort.kind).toBe("unavailable");
	});

	it("skeletons both chips while the catalogue loads", () => {
		const { model, effort } = chips({ modelsRead: "loading" });
		expect(model.kind).toBe("loading");
		expect(effort.kind).toBe("loading");
	});
});

describe("what the effort picker offers", () => {
	const offer = (chosenModel: ModelEntry | null, supported = true) =>
		effortOffer({ supported, chosenModel, models, catalogueDefault: fallback });

	it("offers the default model's ladder when nothing is chosen", () => {
		expect(offer(null)).toStrictEqual({
			kind: "ladder",
			rungs: opus.efforts,
			exact: true,
		});
	});

	it("offers nothing for an empty ladder", () => {
		expect(offer(haiku)).toStrictEqual({ kind: "none" });
	});

	it("offers the whole vocabulary when the ladder is unknown", () => {
		expect(offer(routed)).toStrictEqual({
			kind: "ladder",
			rungs: EFFORT_VOCABULARY,
			exact: false,
		});
	});

	it("offers nothing on a relay without `session_start.effort`", () => {
		expect(offer(null, false)).toStrictEqual({ kind: "unsupported" });
	});

	it("knows the default effort only for the default model", () => {
		expect(defaultEffortFor(null, fallback)).toBe("medium");
		expect(defaultEffortFor(opus, fallback)).toBe("medium");
		expect(defaultEffortFor(routed, fallback)).toBeNull();
	});

	it("keeps the reader's effort across a model change only while it is still offered", () => {
		expect(effortAfterModelChange("xhigh", offer(opus))).toBe("xhigh");
		expect(effortAfterModelChange("minimal", offer(opus))).toBeNull();
		expect(effortAfterModelChange("high", offer(haiku))).toBeNull();
		expect(effortAfterModelChange("minimal", offer(routed))).toBe("minimal");
		expect(effortAfterModelChange(null, offer(opus))).toBeNull();
	});
});

describe("the model search", () => {
	it("matches every token, in the catalogue's order", () => {
		expect(filterModels(models, "anthropic 4.5")).toStrictEqual([haiku]);
		expect(filterModels(models, "  ")).toBe(models);
		expect(filterModels(models, "opus anthropic")).toStrictEqual([opus]);
	});

	it("appears only past the threshold", () => {
		expect(MODEL_SEARCH_THRESHOLD).toBe(12);
	});
});

describe("the folder picker", () => {
	const folders = foldersFrom({
		home: "/Users/reader",
		recent: ["/Users/reader/src/app", "/Users/reader/notes"],
		tmp: "/tmp",
		default: "/Users/reader/src/app",
	} as Parameters<typeof foldersFrom>[0]);

	it("lists the default first and each path once", () => {
		expect(folderRows(folders)).toStrictEqual([
			{ kind: "default", path: "/Users/reader/src/app" },
			{ kind: "recent", path: "/Users/reader/notes" },
			{ kind: "home", path: "/Users/reader" },
			{ kind: "tmp", path: "/tmp" },
		]);
	});

	it("admits a typed path only where the start route's gate would", () => {
		expect(typedFolder("  ~/work ", folders)).toStrictEqual({
			ok: true,
			path: "~/work",
		});
		expect(typedFolder("/Users/reader/x", folders).ok).toBe(true);
		expect(typedFolder("/tmp/scratch", folders).ok).toBe(true);
		expect(typedFolder("/etc", folders)).toStrictEqual({
			ok: false,
			reason: "outside",
		});
		// A sibling whose name merely starts with home's is outside it.
		expect(typedFolder("/Users/readerother", folders).ok).toBe(false);
		expect(typedFolder("   ", folders)).toStrictEqual({
			ok: false,
			reason: "empty",
		});
		expect(typedFolder(`~/${"a".repeat(4096)}`, folders)).toStrictEqual({
			ok: false,
			reason: "too_long",
		});
	});
});
