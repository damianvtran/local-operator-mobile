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
