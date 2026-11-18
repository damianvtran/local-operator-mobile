import { describe, expect, it } from "vitest";

import type { ComposerChip } from "./chip-labels";
import {
	applyRunSetting,
	composerControlsPlan,
	folderControlLabel,
	folderSource,
	runSettingsControl,
	runSettingsSummary,
	sessionFolderControl,
	sessionRunSettings,
	settingLock,
} from "./composer-controls";

/**
 * The composer's two icon controls — the folder and the run settings (model and
 * effort) — replacing the text chips that iOS clipped to `loc` / `Claude` with
 * no ellipsis (issue #325; yoga#2006 with two min-floored shrinkers).
 *
 * Every member of the zone is now a rigid 44 pt (48 dp) square, so nothing in it
 * shrinks and the yoga bug has no shape to take. What remains is a decision —
 * which controls fit the measured zone, and where a control that does not fit
 * goes — and that decision is this plan.
 */

/* Widths are the card's zone as the row leaves it: content width (window − 24
 *  dock margin − 24 shell padding) less attach, mic, [stop,] send and the row's
 *  4 pt gaps. 390 pt idle: 342 − 3·44 − 3·4 = 198; with Stop: 342 − 4·44 −
 *  4·4 = 150. 375 pt with Stop: 327 − 192 = 135. 320 pt idle: 272 − 144 = 128;
 *  with Stop: 272 − 192 = 80. */
const ZONE = {
	w390idle: 198,
	w390stop: 150,
	w375stop: 135,
	w320idle: 128,
	w320stop: 80,
} as const;

const plan = (over: Partial<Parameters<typeof composerControlsPlan>[0]>) =>
	composerControlsPlan({
		width: ZONE.w390idle,
		touchFloor: 44,
		gap: 4,
		folder: true,
		dismiss: false,
		moreRows: false,
		queued: null,
		...over,
	});

describe("composerControlsPlan (issue #325)", () => {
	it("shows both icons and no More on an idle home at 390 pt: More has nothing of its own", () => {
		expect(plan({})).toStrictEqual({
			folder: true,
			settings: true,
			trailing: null,
			queued: null,
		});
	});

	it("keeps both icons at 320 pt while More is empty", () => {
		expect(plan({ width: ZONE.w320idle })).toMatchObject({
			folder: true,
			settings: true,
			trailing: null,
		});
	});

	it("keeps More whenever it carries rows of its own (usage, cost, queue, questions)", () => {
		expect(plan({ width: ZONE.w390stop, moreRows: true })).toMatchObject({
			folder: true,
			settings: true,
			trailing: "more",
		});
	});

	it("moves the folder into More first, never More itself, when the zone is short", () => {
		/* The IMG_3410 shape: Stop on, a session with usage in More. */
		expect(plan({ width: ZONE.w375stop, moreRows: true })).toMatchObject({
			folder: false,
			settings: true,
			trailing: "more",
		});
	});

	it("opens More for a displaced control even when More had nothing else", () => {
		/* 320 pt with Stop: one 44 pt slot. Both icons go to More's rows, and
		 *  More takes the slot, so nothing becomes unreachable. */
		expect(plan({ width: ZONE.w320stop })).toMatchObject({
			folder: false,
			settings: false,
			trailing: "more",
		});
	});

	it("never offers a folder the host did not pass", () => {
		expect(plan({ folder: false, width: ZONE.w320stop })).toMatchObject({
			folder: false,
			settings: true,
			trailing: null,
		});
	});

	it("keeps keyboard-dismiss in the trailing slot; a displaced control waits in More one blur away", () => {
		expect(plan({ width: ZONE.w320idle, dismiss: true })).toMatchObject({
			folder: false,
			settings: true,
			trailing: "dismiss",
		});
	});

	it("reads an unmeasured zone (0) as 'everything fits', the common case, so nothing flickers in", () => {
		expect(plan({ width: 0, moreRows: true })).toMatchObject({
			folder: true,
			settings: true,
			trailing: "more",
		});
	});

	it("uses the platform floor: three 48 dp squares need 152", () => {
		expect(plan({ touchFloor: 48, width: 151, moreRows: true })).toMatchObject({
			folder: false,
			settings: true,
			trailing: "more",
		});
		expect(plan({ touchFloor: 48, width: 152, moreRows: true })).toMatchObject({
			folder: true,
			settings: true,
			trailing: "more",
		});
	});

	it("gives up the queued sentence before any control, and never the count", () => {
		const queued = { label: 100, count: 44 };
		expect(
			plan({ width: ZONE.w390idle, moreRows: true, queued }),
		).toMatchObject({
			folder: true,
			settings: true,
			trailing: "more",
			queued: { form: "count", width: 44 },
		});
		expect(plan({ width: 300, moreRows: true, queued })).toMatchObject({
			folder: true,
			queued: { form: "label", width: 100 },
		});
		expect(
			plan({ width: ZONE.w320idle, moreRows: true, queued }),
		).toMatchObject({
			folder: false,
			settings: false,
			trailing: "more",
			queued: { form: "count", width: 44 },
		});
	});

	it("always fits what it returns, at every width down to the zone's floor", () => {
		for (const floor of [44, 48]) {
			for (const width of [floor, 60, 80, 100, 128, 135, 150, 198, 260]) {
				for (const dismiss of [false, true])
					for (const moreRows of [false, true]) {
						const p = plan({ touchFloor: floor, width, dismiss, moreRows });
						const members =
							Number(p.folder) +
							Number(p.settings) +
							Number(p.trailing !== null);
						expect(members).toBeGreaterThan(0);
						expect(members * floor + (members - 1) * 4).toBeLessThanOrEqual(
							width,
						);
						// A displaced control is always reachable: More is up, or
						// keyboard-dismiss holds the slot and More returns on blur.
						if (!p.folder || !p.settings) expect(p.trailing).not.toBeNull();
					}
			}
		}
	});
});

const value = (text: string, accessibilityLabel: string): ComposerChip => ({
	kind: "value",
	text,
	accessibilityLabel,
});

describe("runSettingsControl: one control, the model's and the effort's spoken values", () => {
	it("names both values, model first", () => {
		expect(
			runSettingsControl(
				value("Opus 5", "Model, Opus 5"),
				value("High", "Effort, High"),
			),
		).toStrictEqual({
			accessibilityLabel: "Model, Opus 5, Effort, High",
			accessibilityHint: "Choose the model and effort",
			disabled: false,
		});
	});

	it("names the model alone when there is no effort control", () => {
		expect(
			runSettingsControl(value("Opus 5", "Model, Opus 5"), null)
				.accessibilityLabel,
		).toBe("Model, Opus 5");
	});

	it("is disabled only while nothing is known yet", () => {
		const loading: ComposerChip = {
			kind: "loading",
			accessibilityLabel: "Model, loading",
		};
		expect(runSettingsControl(loading, null)).toMatchObject({
			accessibilityLabel: "Model, loading",
			disabled: true,
		});
		const nothing: ComposerChip = {
			kind: "unavailable",
			text: "\u2014",
			accessibilityLabel: "Model, not available",
			accessibilityHint: "Nothing is connected yet",
		};
		expect(runSettingsControl(nothing, null)).toStrictEqual({
			accessibilityLabel: "Model, not available",
			accessibilityHint: "Nothing is connected yet",
			disabled: true,
		});
	});

	it("opens a read-only sheet for a known value that cannot change, and says why", () => {
		/* An ended session: the last-known model is shown, not hidden behind a
		 *  dead control — the sheet is the only place a sighted reader sees it. */
		const ended: ComposerChip = {
			kind: "unavailable",
			text: "Opus 5",
			accessibilityLabel: "Model, Opus 5",
			accessibilityHint: "Resume this session to change the model",
		};
		expect(runSettingsControl(ended, null)).toStrictEqual({
			accessibilityLabel: "Model, Opus 5",
			accessibilityHint: "Resume this session to change the model",
			disabled: false,
		});
	});
});

describe("folderControlLabel and folderSource", () => {
	it("speaks the folder's own name and where it comes from", () => {
		expect(folderControlLabel("local-operator", "chosen")).toBe(
			"Folder, local-operator, chosen for this conversation",
		);
		expect(folderControlLabel("app", "default")).toBe(
			"Folder, app, this computer's default",
		);
		expect(folderControlLabel("app", null)).toBe("Folder, app");
	});

	it("compares against the computer's own default, and knows nothing without one", () => {
		expect(folderSource("/Users/demo/app", "/Users/demo/app")).toBe("default");
		expect(folderSource("/Users/demo/other", "/Users/demo/app")).toBe("chosen");
		expect(folderSource("/Users/demo/app", null)).toBeNull();
	});
});

describe("settingLock: a run setting the sheet can show but not change", () => {
	it("leaves a changeable value unlocked", () => {
		expect(settingLock(value("Opus 5", "Model, Opus 5"))).toBeNull();
	});

	it("keeps the chip's reason and its last-known value", () => {
		expect(
			settingLock({
				kind: "unavailable",
				text: "Opus 5",
				accessibilityLabel: "Model, Opus 5",
				accessibilityHint: "Resume this session to change the model",
			}),
		).toStrictEqual({
			reason: "Resume this session to change the model",
			value: "Opus 5",
		});
	});

	it("never shows the bare dash as a value", () => {
		expect(
			settingLock({
				kind: "unavailable",
				text: "\u2014",
				accessibilityLabel: "Effort, not available",
				accessibilityHint: "This model has no effort control",
			}),
		).toStrictEqual({
			reason: "This model has no effort control",
			value: null,
		});
	});

	it("says a value still loading is loading", () => {
		expect(
			settingLock({ kind: "loading", accessibilityLabel: "Effort, loading" }),
		).toStrictEqual({ reason: "Loading…", value: null });
	});
});

/* Round 1 R1/Q1/R3: the session screen's sheet wiring, as one pure decision,
 *  so an ended, loading, rungless or remote session cannot drift. */
describe("sessionRunSettings: what the session's run-settings sheet shows", () => {
	const unavailable = (
		text: string,
		label: string,
		hint: string,
	): ComposerChip => ({
		kind: "unavailable",
		text,
		accessibilityLabel: label,
		accessibilityHint: hint,
	});

	it("shows an ENDED session's recorded effort read-only, with the resume reason (R1)", () => {
		/* The durable fold carries `effort_ladder: []`; the journal's rung is the
		 *  chip's last-known value. It used to read "no effort setting". */
		const state = sessionRunSettings({
			chips: {
				model: unavailable(
					"claude-opus-5",
					"Model, claude-opus-5",
					"Resume this session to change the model",
				),
				effort: unavailable(
					"High",
					"Effort, High",
					"Resume this session to change the effort",
				),
			},
			ladder: [],
			ended: true,
		});
		expect(state.effort).toStrictEqual({
			kind: "locked",
			lock: {
				reason: "Resume this session to change the effort",
				value: "High",
			},
		});
		expect(state.model).toStrictEqual({
			kind: "locked",
			lock: {
				reason: "Resume this session to change the model",
				value: "claude-opus-5",
			},
		});
		expect(state.summary).toBe("claude-opus-5 · High");
	});

	it("says an ended session with no recorded effort is resumable, never 'no effort setting'", () => {
		const state = sessionRunSettings({
			chips: { model: value("Opus 5", "Model, Opus 5"), effort: null },
			ladder: [],
			ended: true,
		});
		expect(state.effort).toStrictEqual({
			kind: "locked",
			lock: { reason: "Resume this session to change the effort", value: null },
		});
	});

	it("says a value still loading is loading, before the first frame", () => {
		const state = sessionRunSettings({
			chips: {
				model: { kind: "loading", accessibilityLabel: "Model, loading" },
				effort: { kind: "loading", accessibilityLabel: "Effort, loading" },
			},
			ladder: [],
			ended: false,
		});
		expect(state.effort).toStrictEqual({
			kind: "locked",
			lock: { reason: "Loading…", value: null },
		});
		expect(state.summary).toBeNull();
	});

	it("says a LIVE model with no effort control has none", () => {
		expect(
			sessionRunSettings({
				chips: { model: value("Haiku", "Model, Haiku"), effort: null },
				ladder: [],
				ended: false,
			}).effort,
		).toStrictEqual({ kind: "none" });
	});

	it("offers the live ladder when the effort can change", () => {
		const state = sessionRunSettings({
			chips: {
				model: value("Opus 5", "Model, Opus 5"),
				effort: value("High", "Effort, High"),
			},
			ladder: ["low", "high"],
			ended: false,
		});
		expect(state.effort).toStrictEqual({
			kind: "ladder",
			rungs: ["low", "high"],
		});
		expect(state.model).toStrictEqual({ kind: "list" });
		expect(state.summary).toBe("Opus 5 · High");
	});

	it("locks both for a remote owner's session the relay will not change", () => {
		const owner = "Only the computer that owns this conversation can change it";
		const state = sessionRunSettings({
			chips: {
				model: unavailable("Opus 5", "Model, Opus 5", owner),
				effort: unavailable("High", "Effort, High", owner),
			},
			ladder: ["low", "high"],
			ended: false,
		});
		expect(state.model).toStrictEqual({
			kind: "locked",
			lock: { reason: owner, value: "Opus 5" },
		});
		expect(state.effort).toStrictEqual({
			kind: "locked",
			lock: { reason: owner, value: "High" },
		});
	});
});

describe("runSettingsSummary: the sheet's current-value line and More's row value", () => {
	it("joins the model and a named effort", () => {
		expect(runSettingsSummary(value("Opus 5", "m"), value("High", "e"))).toBe(
			"Opus 5 · High",
		);
	});
	it("names the model alone when the effort says nothing", () => {
		expect(runSettingsSummary(value("Opus 5", "m"), null)).toBe("Opus 5");
		expect(
			runSettingsSummary(value("Opus 5", "m"), {
				kind: "loading",
				accessibilityLabel: "e",
			}),
		).toBe("Opus 5");
		expect(
			runSettingsSummary(value("Opus 5", "m"), {
				kind: "unavailable",
				text: "\u2014",
				accessibilityLabel: "e",
				accessibilityHint: "h",
			}),
		).toBe("Opus 5");
		expect(
			runSettingsSummary(value("Opus 5", "m"), {
				...value("Default", "e"),
				rowHidden: true,
			} as ComposerChip),
		).toBe("Opus 5");
	});
	it("is null only while the model is loading (More paints its skeleton then)", () => {
		expect(
			runSettingsSummary({ kind: "loading", accessibilityLabel: "m" }, null),
		).toBeNull();
		/* An unavailable model keeps its dash: More's row must not fall back to
		 *  the loading skeleton for a fact that is settled. */
		expect(
			runSettingsSummary(
				{
					kind: "unavailable",
					text: "\u2014",
					accessibilityLabel: "m",
					accessibilityHint: "h",
				},
				null,
			),
		).toBe("\u2014");
	});
});

describe("sessionFolderControl: the session's folder is read-only (the relay takes cwd only at start)", () => {
	it("names the folder and is never editable", () => {
		expect(sessionFolderControl("/Users/demo/code/app")).toStrictEqual({
			name: "app",
			path: "/Users/demo/code/app",
			source: null,
			editable: false,
		});
	});
	it("offers no control without a folder", () => {
		expect(sessionFolderControl("")).toBeNull();
	});
});

describe("applyRunSetting: a refused change is reported, not swallowed (R2)", () => {
	it("sends the command to the session and clears the last error first", async () => {
		const sent: unknown[] = [];
		const errors: Array<string | null> = [];
		await applyRunSetting({
			endpoints: {
				command: async (id: string, body: unknown) => {
					sent.push([id, body]);
					return {};
				},
			},
			sessionId: "s1",
			body: { op: "set_effort", effort: "high" },
			failure: "Could not change the effort.",
			onError: (e) => errors.push(e),
		});
		expect(sent).toStrictEqual([["s1", { op: "set_effort", effort: "high" }]]);
		expect(errors).toStrictEqual([null]);
	});
	it("reports the refusal in the caller's words", async () => {
		const errors: Array<string | null> = [];
		await applyRunSetting({
			endpoints: {
				command: async () => {
					throw new Error("409");
				},
			},
			sessionId: "s1",
			body: {
				op: "set_model",
				provider: "anthropic",
				model_id: "claude-opus-5",
			},
			failure: "Could not change the model.",
			onError: (e) => errors.push(e),
		});
		expect(errors).toStrictEqual([null, "Could not change the model."]);
	});
	it("reports a missing route rather than doing nothing", async () => {
		const errors: Array<string | null> = [];
		await applyRunSetting({
			endpoints: null,
			sessionId: "s1",
			body: { op: "set_effort", effort: "low" },
			failure: "Could not change the effort.",
			onError: (e) => errors.push(e),
		});
		expect(errors).toStrictEqual([null, "Could not change the effort."]);
	});
});
