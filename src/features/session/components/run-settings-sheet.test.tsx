import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ModelEntry } from "@/contracts";
import { CONTROL, effortRungId, modelOptionId, SURFACE } from "@/ui/a11y";

/**
 * The session's run-settings sheet, as DRAWN (issue #325): ONE sheet that the
 * composer's model-and-effort control opens, holding the model list and the
 * effort rungs that used to be two sheets behind two clipped chips.
 *
 * Same Node convention as `checkpoint-rail.test.tsx`: `renderToStaticMarkup`
 * with leaf stubs that keep `testID`, the accessible name and `disabled` in the
 * markup, so the assertions read the sheet's own branching.
 */

type Props = Record<string, unknown> & { children?: unknown };
const kids = (props: Props): ReactNode =>
	typeof props.children === "function"
		? (props.children as (s: { pressed: boolean }) => ReactNode)({
				pressed: false,
			})
		: (props.children as ReactNode);

vi.mock("react-native", () => ({
	View: (props: Props) =>
		createElement(
			"div",
			{ "data-testid": props.testID as string | undefined },
			kids(props),
		),
	Text: (props: Props) => createElement("span", null, kids(props)),
	Pressable: (props: Props) =>
		createElement(
			"button",
			{
				type: "button",
				"data-testid": props.testID as string | undefined,
				"aria-label": props.accessibilityLabel as string | undefined,
				disabled: props.disabled as boolean | undefined,
			},
			kids(props),
		),
	ScrollView: (props: Props) => createElement("div", null, kids(props)),
}));
const sheet = (props: Props) =>
	props.visible
		? createElement(
				"section",
				{ "data-testid": props.testID as string },
				createElement("h2", null, props.title as string),
				kids(props),
			)
		: null;
vi.mock("@/ui/components", () => ({ Sheet: sheet }));
vi.mock("@/ui/components/sheet", () => ({ Sheet: sheet }));
vi.mock("@/ui/components/badge", () => ({
	Badge: (props: Props) => createElement("i", null, props.label as string),
}));
vi.mock("@/ui/components/alert", () => ({
	Alert: (props: Props) => createElement("p", null, kids(props)),
}));
vi.mock("@/ui/components/button", () => ({
	Button: (props: Props) =>
		createElement(
			"button",
			{ type: "button", "data-testid": props.testID as string },
			props.label as string,
		),
}));
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: (props: Props) =>
		createElement("h3", null, props.label as string),
}));

const { SessionRunSettingsSheet } = await import("./model-sheet");

const model = (id: string, label: string): ModelEntry => ({
	selector: `anthropic/${id}`,
	provider: "anthropic",
	model_id: id,
	name: id,
	label,
	connected: true,
});
const MODELS = [
	model("claude-opus-5", "Opus 5"),
	model("claude-haiku-4-5", "Haiku 4.5"),
];

const draw = (over: Partial<Parameters<typeof SessionRunSettingsSheet>[0]>) =>
	renderToStaticMarkup(
		createElement(SessionRunSettingsSheet, {
			visible: true,
			onClose: () => undefined,
			models: MODELS,
			selectedModel: "anthropic/claude-opus-5",
			selectedEffort: "high",
			model: { kind: "list" },
			effort: { kind: "ladder", rungs: ["low", "medium", "high"] },
			summary: "Opus 5 · High",
			error: null,
			onPickModel: () => undefined,
			onPickEffort: () => undefined,
			...over,
		}),
	);

describe("the session's run-settings sheet (issue #325)", () => {
	it("is one sheet: the current values, the effort rungs, then the model list (D1)", () => {
		const html = draw({});
		expect(html).toContain(`data-testid="${SURFACE.runSettingsSheet}"`);
		expect(html).toContain("<h2>Model and effort</h2>");
		/* The current values lead, so effort is never below the fold: the
		 *  model list is 1400 pt tall on a real catalogue (design D1). */
		const summary = html.indexOf(`data-testid="${SURFACE.runSettingsSummary}"`);
		const efforts = html.indexOf(`data-testid="${SURFACE.effortSheet}"`);
		const models = html.indexOf(`data-testid="${SURFACE.modelSheet}"`);
		expect(summary).toBeGreaterThan(-1);
		expect(html).toContain("Opus 5 · High");
		expect(efforts).toBeGreaterThan(summary);
		expect(models).toBeGreaterThan(efforts);
		expect(html).toContain(`data-testid="${modelOptionId("claude-opus-5")}"`);
		expect(html).toContain(
			`data-testid="${modelOptionId("claude-haiku-4-5")}"`,
		);
		for (const rung of ["low", "medium", "high"])
			expect(html).toContain(`data-testid="${effortRungId(rung)}"`);
		/* Compact: the rungs wrap side by side rather than one full row each. */
		expect(html).toContain(`data-testid="${SURFACE.effortRungs}"`);
	});

	it("labels the session's rungs in the summary's words, not the daemon's (round 2 D2)", () => {
		const html = draw({
			effort: { kind: "ladder", rungs: ["low", "high", "xhigh"] },
		});
		expect(html).toContain(`aria-label="High"`);
		expect(html).toContain(`aria-label="Extra high"`);
		expect(html).not.toContain(`aria-label="xhigh"`);
	});

	it("says, in the kit's words, that a live model has no effort setting", () => {
		const html = draw({ effort: { kind: "none" } });
		expect(html).toContain("This model has no effort setting.");
		expect(html).not.toContain(effortRungId("high"));
	});

	it("shows a value that cannot change read-only, with the reason, instead of dead rows (R1)", () => {
		const html = draw({
			model: {
				kind: "locked",
				lock: {
					reason: "Resume this session to change the model",
					value: "Opus 5",
				},
			},
			effort: {
				kind: "locked",
				lock: {
					reason: "Resume this session to change the effort",
					value: "High",
				},
			},
		});
		expect(html).toContain("Resume this session to change the model");
		expect(html).toContain("<span>Opus 5</span>");
		expect(html).toContain("Resume this session to change the effort");
		expect(html).toContain("<span>High</span>");
		expect(html).not.toContain("This model has no effort setting.");
		expect(html).not.toContain(modelOptionId("claude-opus-5"));
		expect(html).not.toContain(effortRungId("high"));
	});

	it("shows a refused change INSIDE the open sheet, above both sections (R2/D2)", () => {
		const html = draw({ error: "Could not change the model." });
		const alert = html.indexOf("<p>Could not change the model.</p>");
		expect(alert).toBeGreaterThan(-1);
		expect(alert).toBeLessThan(
			html.indexOf(`data-testid="${SURFACE.effortSheet}"`),
		);
		expect(draw({})).not.toContain("<p>");
	});

	it("keys the list's loading and empty lines", () => {
		expect(draw({ models: [], loading: true })).toContain("Loading…");
		expect(draw({ models: [] })).toContain("No models available");
	});

	it("offers Retry when an ended chat's stored catalogue could not be read (PR #350)", () => {
		const html = draw({ models: [], failed: true, onRetry: () => undefined });
		expect(html).toContain(`data-testid="${CONTROL.sessionModelsRetry}"`);
		expect(html).not.toContain("No models available");
	});
});
