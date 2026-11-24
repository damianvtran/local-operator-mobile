import { describe, expect, it } from "vitest";

import type { ComposerChip } from "./chip-labels";
import {
	composerControlsPlan,
	customMarkInset,
	folderControlLabel,
	folderSource,
	modelSearchReached,
	moreHasRows,
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

	it("keeps More on Home when its only row is the agent-or-team picker (round 5, R5-1)", () => {
		/* Home passes no usage, cost, queue or questions; the identity row is
		 *  the "second door" once the hero pill has scrolled away (D-S2/D-S15),
		 *  and an older relay explains itself only there. */
		const none = {
			context: false,
			cost: false,
			queued: 0,
			questions: false,
			identity: false,
		};
		expect(moreHasRows(none)).toBe(false);
		const home = moreHasRows({ ...none, identity: true });
		expect(home).toBe(true);
		expect(plan({ width: ZONE.w390idle, moreRows: home })).toStrictEqual({
			folder: true,
			settings: true,
			trailing: "more",
			queued: null,
		});
		for (const own of [
			{ context: true },
			{ cost: true },
			{ queued: 2 },
			{ questions: true },
		])
			expect(moreHasRows({ ...none, ...own })).toBe(true);
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

	it("lets an ENDED local chat choose before it reopens: loading, then the ladder or none (PR #350)", () => {
		/* Main's stored-model lane keeps a choice on the phone until Resume/Send,
		 *  so "resume to change" is false there. With no effort chip the stored
		 *  catalogue is still loading, or the chosen model has no rungs. */
		const model = value("Opus 5", "Model, Opus 5");
		expect(
			sessionRunSettings({
				chips: { model, effort: null },
				ladder: [],
				ended: true,
				stored: { loading: true, failed: false, modelKnown: false },
			}).effort,
		).toStrictEqual({
			kind: "locked",
			lock: { reason: "Loading…", value: null },
		});
		expect(
			sessionRunSettings({
				chips: { model, effort: null },
				ladder: [],
				ended: true,
				stored: { loading: false, failed: false, modelKnown: true },
			}).effort,
		).toStrictEqual({ kind: "none" });
		expect(
			sessionRunSettings({
				chips: { model, effort: value("High", "Effort, High") },
				ladder: ["low", "high"],
				ended: true,
				stored: { loading: false, failed: false, modelKnown: true },
			}),
		).toMatchObject({
			model: { kind: "list" },
			effort: { kind: "ladder", rungs: ["low", "high"] },
		});
	});

	it("hides an ended local chat's effort when the phone cannot know it, as main did (R5-3/Q1)", () => {
		/* Main hid the effort chip here. "This model has no effort setting"
		 *  would be a claim about a model the stored catalogue does not hold. */
		const model = value("mock", "Model, mock");
		// The recorded model is not in the stored catalogue.
		expect(
			sessionRunSettings({
				chips: { model, effort: null },
				ladder: [],
				ended: true,
				stored: { loading: false, failed: false, modelKnown: false },
			}).effort,
		).toStrictEqual({ kind: "hidden" });
		// The stored catalogue could not be read (Retry is in the model section).
		expect(
			sessionRunSettings({
				chips: { model, effort: null },
				ladder: [],
				ended: true,
				stored: { loading: false, failed: true, modelKnown: false },
			}).effort,
		).toStrictEqual({ kind: "hidden" });
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

describe("modelSearchReached: the run-settings sheet pins its model search only at the models (#335)", () => {
	/* Effort leads the sheet (D1); the search is pinned (#343's keyboard fix)
	 *  but only once the reader has scrolled to the model list it filters. */
	const facts = { viewport: 400, content: 1200, modelTop: 180 };
	it("keeps the search away while the sheet rests at the top", () => {
		expect(modelSearchReached({ ...facts, y: 0 })).toBe(false);
		expect(modelSearchReached({ ...facts, y: 120 })).toBe(false);
	});
	it("reaches the models once their heading scrolls to the top of the body", () => {
		expect(modelSearchReached({ ...facts, y: 180 })).toBe(true);
		expect(modelSearchReached({ ...facts, y: 600 })).toBe(true);
	});
	it("reaches them at the end of a body too short to bring the heading up", () => {
		expect(
			modelSearchReached({
				viewport: 400,
				content: 520,
				modelTop: 180,
				y: 117,
			}),
		).toBe(false);
		expect(
			modelSearchReached({
				viewport: 400,
				content: 520,
				modelTop: 180,
				y: 120,
			}),
		).toBe(true);
	});
	it("treats a fractional end offset as the end, with the Sheet's own 2 pt tolerance (R5-2)", () => {
		/* The native end offset is converted from device pixels and the end is a
		 *  difference of two separately measured heights, so the last scroll
		 *  event can land a fraction short of `content - viewport`. */
		const short = { viewport: 400, content: 520, modelTop: 180 };
		expect(modelSearchReached({ ...short, y: 119.5 })).toBe(true);
		expect(modelSearchReached({ ...short, y: 118 })).toBe(true);
		expect(modelSearchReached({ ...short, y: 117.9 })).toBe(false);
	});
	it("shows the search at once when the body does not scroll: the models are on screen (D3)", () => {
		expect(
			modelSearchReached({ viewport: 900, content: 860, modelTop: 180, y: 0 }),
		).toBe(true);
		// Within the Sheet's 1 pt "scrollable" slack it still fits.
		expect(
			modelSearchReached({ viewport: 900, content: 901, modelTop: 180, y: 0 }),
		).toBe(true);
		expect(
			modelSearchReached({ viewport: 900, content: 902, modelTop: 180, y: 0 }),
		).toBe(false);
		// Still nothing before the section is measured.
		expect(
			modelSearchReached({ viewport: 900, content: 860, modelTop: null, y: 0 }),
		).toBe(false);
	});
	it("decides nothing before the body and the section are measured", () => {
		expect(modelSearchReached({ ...facts, modelTop: null, y: 300 })).toBe(
			false,
		);
		expect(modelSearchReached({ ...facts, viewport: 0, y: 300 })).toBe(false);
		expect(modelSearchReached({ ...facts, content: 0, y: 300 })).toBe(false);
	});
});

describe("customMarkInset: the non-default dot sits on the glyph's corner at either floor (D4)", () => {
	it("centres the dot on the glyph's top-end corner, in the kit's 44 pt visual box", () => {
		/* `IconButton` draws a 44 pt box (`h-11 w-11`) at the TOP-START of its
		 *  touch-floor pressable, so on the 48 dp floor the glyph is at 12, not
		 *  14 (design round 2, D3: the dot measured 2 pt off the corner). */
		expect(
			customMarkInset({ floor: 44, box: 44, glyph: 20, mark: 6 }),
		).toStrictEqual({
			top: 9,
			end: 9,
		});
		expect(
			customMarkInset({ floor: 48, box: 44, glyph: 20, mark: 6 }),
		).toStrictEqual({
			top: 9,
			end: 13,
		});
	});
});
