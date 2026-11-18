/**
 * The composer's two icon controls — FOLDER and RUN SETTINGS (model + effort) —
 * as pure decisions: what fits the controls row, what each control says, and
 * where a control that does not fit goes.
 *
 * WHY ICONS (issue #325). The row carried the folder and the model as text
 * chips. On iOS they were cut to `loc` / `Claude` with no ellipsis, and More
 * could leave the row while Stop was up: RN 0.86's vendored Yoga freezes a
 * min-floored shrinker in its first pass and still charges the next one against
 * the original free space (yoga#2006, fixed upstream, not vendored), and the
 * chips were two such shrinkers. Every member of the zone is now a rigid touch-
 * floor square, so nothing in it shrinks and that bug has no shape to take. The
 * values a chip used to paint live on each control's spoken name and in the
 * sheet it opens.
 *
 * WHAT IS LEFT IS A DECISION, made from widths that do not depend on it (the
 * zone is `flex-1` between fixed siblings — the #206 rule): which controls fit,
 * and the order they leave in. The queued sentence goes first (its bare count
 * never does), then the folder, then run settings; a control that leaves the
 * row becomes a row in More, so More takes the trailing slot whenever anything
 * is displaced and is otherwise shown only when it has rows of its own. An
 * empty More was a control that opened nothing (the U-24 dead end).
 */
import { t } from "@/i18n";
import type { CommandBody } from "@/relay/endpoints";
import { type ComposerChip, UNAVAILABLE_TEXT } from "./chip-labels";

export type ControlsPlan = {
	/** The folder icon is on the row (else, when offered, it is a More row). */
	folder: boolean;
	/** The run-settings icon is on the row (else it is a More row). */
	settings: boolean;
	/** The zone's trailing slot: More, keyboard-dismiss, or nothing. */
	trailing: "more" | "dismiss" | null;
	/** The queued count's form and the width charged for it; `null` when the
	 *  card carries no count. */
	queued: { form: "label" | "count"; width: number } | null;
};

export const composerControlsPlan = (input: {
	/** The zone's measured width, pt. `<= 0` is "not measured yet". */
	width: number;
	touchFloor: number;
	/** The zone's own gap, pt. */
	gap: number;
	/** The host offers a folder control at all. */
	folder: boolean;
	/** The field has the keyboard: the trailing slot is the way to put it down,
	 *  and a displaced control waits in More, one blur away. */
	dismiss: boolean;
	/** More has rows of its own (usage, cost, queue, questions). */
	moreRows: boolean;
	/** The queued count's two widths, when the card carries it. */
	queued: { label: number; count: number } | null;
}): ControlsPlan => {
	const { touchFloor, gap, queued } = input;
	const settle = (
		folder: boolean,
		settings: boolean,
		form: "label" | "count",
	): ControlsPlan => {
		const displaced = (input.folder && !folder) || !settings;
		return {
			folder,
			settings,
			trailing: input.dismiss
				? "dismiss"
				: input.moreRows || displaced
					? "more"
					: null,
			queued:
				queued === null
					? null
					: { form, width: form === "label" ? queued.label : queued.count },
		};
	};
	const fits = (plan: ControlsPlan): boolean => {
		const squares =
			Number(plan.folder) +
			Number(plan.settings) +
			Number(plan.trailing !== null);
		const members = squares + (plan.queued === null ? 0 : 1);
		const width =
			squares * touchFloor +
			(plan.queued?.width ?? 0) +
			Math.max(0, members - 1) * gap;
		return width <= input.width;
	};
	/* The common phone fits: hiding controls for the one frame before the
	 *  zone is measured would be a flicker on every mount. */
	if (!(input.width > 0)) return settle(input.folder, true, "label");
	const icons: ReadonlyArray<readonly [boolean, boolean]> = input.folder
		? [
				[true, true],
				[false, true],
				[false, false],
			]
		: [
				[false, true],
				[false, false],
			];
	for (const [folder, settings] of icons)
		for (const form of ["label", "count"] as const) {
			const plan = settle(folder, settings, form);
			if (fits(plan)) return plan;
		}
	/* Below even that, the zone's own floor (one square and the count) is what
	 *  the row guarantees, and its clip is the last line of defence. */
	return settle(false, false, "count");
};

/**
 * The run-settings control: one icon for the two run parameters the relay
 * accepts — the model and the effort (`cwd`/`provider`/`model_id`/`effort` at
 * start; `set_model`/`set_effort` in a session).
 *
 * The spoken name is the two chips' own spoken names, model first, so it says
 * exactly what the chips said and keeps their wording for each state (chosen,
 * default, loading, unavailable). Disabled only while NOTHING is known — a
 * model still loading, or a route with nothing to show. A known value that
 * cannot change (an ended session, a remote owner's model) still opens the
 * sheet, read-only: with the chips gone it is the only place a sighted reader
 * sees the value.
 */
export const runSettingsControl = (
	model: ComposerChip,
	effort: ComposerChip | null,
): {
	accessibilityLabel: string;
	accessibilityHint: string | undefined;
	disabled: boolean;
} => {
	const accessibilityLabel =
		effort === null
			? model.accessibilityLabel
			: t("mobile.chrome.composer.run_settings", {
					model: model.accessibilityLabel,
					effort: effort.accessibilityLabel,
				});
	if (model.kind === "loading")
		return { accessibilityLabel, accessibilityHint: undefined, disabled: true };
	if (model.kind === "unavailable")
		return {
			accessibilityLabel,
			accessibilityHint: model.accessibilityHint,
			disabled: model.text === UNAVAILABLE_TEXT && effort?.kind !== "value",
		};
	return {
		accessibilityLabel,
		accessibilityHint: t("mobile.chrome.composer.run_settings_hint"),
		disabled: false,
	};
};

/** Where the folder a conversation starts in comes from: the reader's pick, the
 *  computer's own default, or `null` when there is nothing to compare with (a
 *  running conversation, or a folder read that has not answered). */
export type FolderSource = "chosen" | "default" | null;

export const folderSource = (
	current: string,
	defaultFolder: string | null,
): FolderSource =>
	defaultFolder === null
		? null
		: current === defaultFolder
			? "default"
			: "chosen";

/** The folder control's spoken name: the folder's own name and its source, in
 *  the model control's wording ("…, chosen for this conversation"). The full
 *  path is the sheet's header. */
export const folderControlLabel = (
	name: string,
	source: FolderSource,
): string =>
	t("mobile.chrome.composer.folder", {
		folder: name,
		source: source ?? "none",
	});

/** A run setting the sheet can show but not change here, and why. */
export type RunSettingLock = { reason: string; value: string | null };

/**
 * The run-settings sheet's read-only form for one setting, from its chip: an
 * unavailable chip keeps its reason (an ended session says to resume; a remote
 * owner's relay does not forward the op) and its last-known value, never the
 * bare dash; a value still loading says so. A changeable value is `null`.
 */
export const settingLock = (chip: ComposerChip): RunSettingLock | null => {
	if (chip.kind === "value") return null;
	if (chip.kind === "loading")
		return { reason: t("mobile.home.picker.loading"), value: null };
	return {
		reason: chip.accessibilityHint,
		value: chip.text === UNAVAILABLE_TEXT ? null : chip.text,
	};
};

/** One section of the run-settings sheet: the choices, a read-only value with
 *  its reason, or the plain fact that the model has no effort control. */
export type RunSettingSection =
	| { kind: "list" }
	| { kind: "ladder"; rungs: readonly string[] }
	| { kind: "none" }
	| { kind: "locked"; lock: RunSettingLock };

/**
 * The sheet's current-value line ("Opus 5 · High") and More's run-settings row
 * value: the names the chips used to paint. `null` only while the model is
 * loading (More paints its skeleton); an unavailable model keeps its dash. An effort that says nothing — loading, the
 * rungless dash, the home's unnamed default — is left off.
 */
export const runSettingsSummary = (
	model: ComposerChip,
	effort: ComposerChip | null,
): string | null => {
	if (model.kind === "loading") return null;
	const rung =
		effort === null ||
		effort.kind === "loading" ||
		(effort.kind === "value" && effort.rowHidden) ||
		effort.text === UNAVAILABLE_TEXT
			? null
			: effort.text;
	return rung === null ? model.text : `${model.text} · ${rung}`;
};

/**
 * What the SESSION's run-settings sheet shows (round 1 R1/R3).
 *
 * A LOCKED effort is offered as a read-only value, never as "This model has no
 * effort setting": an ended session's durable fold carries `effort_ladder: []`
 * while the journal still names its rung, and before the first frame the
 * ladder is `[]` while the effort is loading. Only a LIVE session whose model
 * reports no effort (the chip hidden, `null`) has none. An ended session with
 * no recorded effort says to resume — the one thing that could change it.
 */
export const sessionRunSettings = (input: {
	chips: { model: ComposerChip; effort: ComposerChip | null };
	ladder: readonly string[];
	ended: boolean;
}): {
	model: RunSettingSection;
	effort: RunSettingSection;
	summary: string | null;
} => {
	const modelLock = settingLock(input.chips.model);
	const effortChip = input.chips.effort;
	const effortLock =
		effortChip === null
			? input.ended
				? {
						reason: t("mobile.session.chip.effort_resume_hint"),
						value: null,
					}
				: null
			: settingLock(effortChip);
	return {
		model:
			modelLock === null
				? { kind: "list" }
				: { kind: "locked", lock: modelLock },
		effort:
			effortLock !== null
				? { kind: "locked", lock: effortLock }
				: input.ladder.length > 0
					? { kind: "ladder", rungs: input.ladder }
					: { kind: "none" },
		summary: runSettingsSummary(input.chips.model, effortChip),
	};
};

/** Trailing path separators, hoisted so the pattern compiles once. */
const TRAILING_SEPARATORS = /[/\\]+$/;

/**
 * The session's folder control: the folder's own name, never editable — the
 * relay accepts a folder only when a conversation starts
 * (`StartSessionRequest.cwd`); no in-session op changes it. The name is the
 * last path segment, as `folderName` reads it with no home to shorten against
 * (kept local: `picker-model` imports this module).
 */
export const sessionFolderControl = (
	cwd: string,
): {
	name: string;
	path: string;
	source: FolderSource;
	editable: boolean;
} | null => {
	if (cwd.length === 0) return null;
	const trimmed = cwd.length > 1 ? cwd.replace(TRAILING_SEPARATORS, "") : cwd;
	const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	const name = at < 0 || trimmed === "/" ? trimmed : trimmed.slice(at + 1);
	return { name, path: cwd, source: null, editable: false };
};

/** The command route `applyRunSetting` needs: the relay endpoints' own shape,
 *  narrowed so a test can fake it. */
type CommandRoute = {
	command: (sessionId: string, body: CommandBody) => Promise<unknown>;
};

/**
 * Apply a run setting to a live session (`set_model` / `set_effort`) and report
 * a refusal in the caller's words (round 1 R2). The previous error is cleared
 * first; a refusal (409 on a session that ended under the sheet, a dropped
 * route) or a missing route sets it. The run-settings sheet shows the error
 * while it stays open, so a refused tap is never silent.
 */
export const applyRunSetting = async (input: {
	endpoints: CommandRoute | null | undefined;
	sessionId: string;
	body: CommandBody;
	failure: string;
	onError: (error: string | null) => void;
}): Promise<void> => {
	input.onError(null);
	if (!input.endpoints) {
		input.onError(input.failure);
		return;
	}
	try {
		await input.endpoints.command(input.sessionId, input.body);
	} catch {
		input.onError(input.failure);
	}
};

/**
 * The non-default dot's insets from the control's top and trailing edges, pt:
 * centred on the glyph's top-end corner. `IconButton` draws its visual box
 * (`h-11 w-11`, 44 pt) at the TOP-START of a touch-floor pressable and centres
 * the glyph in THAT box, so the glyph sits at `(box − glyph) / 2` from the top
 * and the start on every floor; only the trailing inset grows with the floor
 * (design round 2, D3: on 48 dp a centred-in-the-floor inset left the dot 2 pt
 * off the corner).
 */
export const customMarkInset = (input: {
	floor: number;
	box: number;
	glyph: number;
	mark: number;
}): { top: number; end: number } => {
	const glyphInset = (input.box - input.glyph) / 2;
	const top = glyphInset - input.mark / 2;
	return { top, end: input.floor - input.box + top };
};
