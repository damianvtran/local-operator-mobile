/**
 * The SESSION screen's two composer chips: what the session's own projection
 * says, backed by the last-known values the sessions list already carries.
 *
 * WHY THIS EXISTS (TestFlight 578 feedback): "make sure that the model, dir,
 * effort, etc. are still able to be fetched even if the runtime is not
 * attached, currently shows 'n/a'". An ended or never-started conversation is
 * served a DURABLE projection — the relay folds the transcript from disk
 * (`_durable_projection` in local-operator's `mobile/daemon.py`) and that fold
 * has no runtime to ask, so it carries `model_label: ""` and `effort: ""`. The
 * kit read that as "a connected session that reported no model" and rendered
 * `n/a`, while the drawer row for the same conversation named the model: the
 * list row (`SessionSummary.model_label`) is filled from the registry record,
 * which outlives the runtime. So the projection is read first (it is the live
 * truth while a runtime is attached) and the row second.
 *
 * EFFORT HAS NO LAST-KNOWN SOURCE YET. Neither the registry record nor the list
 * row carries effort today; `SessionSummary.effort` is read when a relay sends
 * it (optional in the schema), and until then an ended session's effort is
 * genuinely unknown — the chip is HIDDEN rather than shown as a dash, because a
 * control that names nothing and does nothing is noise on a screen whose only
 * action is Resume.
 *
 * LABELS ARE THE PICKERS' OWN. The chip names the catalogue row (`modelLabel`:
 * "Opus 5.5", not `anthropic/claude-opus-5-5`) and the rung (`effortLabel`:
 * "Medium", not `medium`) so the chip and the sheet it opens never disagree
 * about what a thing is called. A model the catalogue does not list (or a
 * catalogue not read yet) falls back to the bare model id (`modelChipText`).
 *
 * TAPPING AN ENDED SESSION'S CHIP: nothing can apply. The relay's command
 * route refuses `set_model`/`set_effort` with no live entry (409; only a cold
 * `prompt` wakes a host), and `POST /api/sessions/resume` takes no model or
 * effort. So the chip shows the last-known value DISABLED, with a hint saying
 * to resume first — the honest reading of the existing resume semantics, with
 * no new wire. Once resumed the runtime's projection takes over and the chip
 * opens the picker as on any live session.
 */

import type { ModelEntry } from "@/contracts/types.gen";
import { effortLabel, modelLabel } from "@/features/home/picker-model";
import {
	type ChipConnection,
	type ComposerChip,
	type ComposerChipLabels,
	composerChipLabels,
	modelChipText,
	reportedModel,
	UNAVAILABLE_TEXT,
} from "@/features/session/chip-labels";
import { t } from "@/i18n";

/** The projection fields this reads; `null` before the first frame. */
export interface SessionChipProjection {
	model_label: string;
	model_selector: string;
	effort: string;
}

/** The list row's last-known fields. `effort` is optional: no relay sends it
 *  yet (see the header). A REMOTE row's inert defaults (`""`) read as absent. */
export interface SessionChipRow {
	model_label: string;
	effort?: string;
}

/** The first non-empty string, or `""`. */
const firstOf = (...values: (string | null | undefined)[]): string =>
	values.find((v): v is string => typeof v === "string" && v.length > 0) ?? "";

/**
 * The catalogue's reader-facing name for a model the wire names by selector
 * (`anthropic/claude-opus-5-5`) or by bare id (`claude-opus-5-5`): the selector
 * match first, the id second, the bare id when the catalogue has no row.
 */
export const friendlyModelName = (
	label: string,
	models: readonly ModelEntry[],
): string | null => {
	if (label.length === 0) return null;
	const bare = modelChipText(label);
	const row =
		models.find((m) => m.selector === label) ??
		models.find((m) => m.model_id === label || m.model_id === bare);
	return row !== undefined ? modelLabel(row) : bare;
};

export const sessionChipLabels = (input: {
	projection: SessionChipProjection | null;
	/** The sessions-list row for this conversation, when the list has it. */
	row: SessionChipRow | null;
	models: readonly ModelEntry[];
	connection: ChipConnection;
	/** No runtime can take a change (the header's `ended` verdict). */
	ended: boolean;
}): { model: ComposerChip; effort: ComposerChip | null } => {
	const p = input.projection;
	const modelSource = firstOf(
		p?.model_label,
		p?.model_selector,
		input.row?.model_label,
	);
	const effortSource = firstOf(p?.effort, input.row?.effort);

	if (input.ended) {
		const model = friendlyModelName(modelSource, input.models);
		return {
			model:
				model !== null
					? lastKnown(model, `Model, ${model}`, "model")
					: {
							kind: "unavailable",
							text: UNAVAILABLE_TEXT,
							accessibilityLabel: "Model, not recorded",
							accessibilityHint: t("mobile.session.chip.model_unrecorded_hint"),
						},
			effort:
				effortSource.length > 0
					? lastKnown(
							effortLabel(effortSource),
							`Effort, ${effortLabel(effortSource)}`,
							"effort",
						)
					: null,
		};
	}

	const base: ComposerChipLabels = composerChipLabels({
		model: reportedModel(modelSource),
		/* The PROJECTION's effort only: on an attached runtime `""` means "this
		 *  model has no ladder", and a row's older rung must not paper over that
		 *  (the row fallback is for the ended branch above, where nothing live
		 *  can contradict it). */
		effort: p?.effort ?? null,
		connection: input.connection,
	});
	return {
		model: friendlyValue(base.model, () => {
			const name = friendlyModelName(modelSource, input.models);
			return name === null ? null : { text: name, label: `Model, ${name}` };
		}),
		effort: friendlyValue(base.effort, () => {
			const name = effortLabel(p?.effort ?? "");
			return { text: name, label: `Effort, ${name}` };
		}),
	};
};

/** A value the session last ran with, which cannot be changed until it is
 *  resumed: shown, but disabled, with the reason as its hint. */
const lastKnown = (
	text: string,
	accessibilityLabel: string,
	field: "model" | "effort",
): ComposerChip => ({
	kind: "unavailable",
	text,
	accessibilityLabel,
	accessibilityHint:
		field === "model"
			? t("mobile.session.chip.model_resume_hint")
			: t("mobile.session.chip.effort_resume_hint"),
});

/** Swap a VALUE chip's raw wire text for the pickers' label; other kinds pass. */
const friendlyValue = (
	chip: ComposerChip,
	name: () => { text: string; label: string } | null,
): ComposerChip => {
	if (chip.kind !== "value") return chip;
	const friendly = name();
	return friendly === null
		? chip
		: {
				kind: "value",
				text: friendly.text,
				accessibilityLabel: friendly.label,
			};
};
