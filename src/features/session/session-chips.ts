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
 * EFFORT'S LAST-KNOWN SOURCE IS THE JOURNAL. Since local-operator v0.101.14 the
 * list row carries `effort` read from the journal, or `null` when no rung was
 * recorded (the schema reads that `null` as absence); without one an ended
 * session's effort is genuinely unknown — the chip is HIDDEN rather than shown
 * as a dash, because a control that names nothing and does nothing is noise on
 * a screen whose next send may reopen the conversation.
 *
 * LABELS ARE THE PICKERS' OWN. The chip names the catalogue row (`modelLabel`:
 * "Opus 5.5", not `anthropic/claude-opus-5-5`) and the rung (`effortLabel`:
 * "Medium", not `medium`) so the chip and the sheet it opens never disagree
 * about what a thing is called. A model the catalogue does not list (or a
 * catalogue not read yet) falls back to the bare model id (`modelChipText`).
 *
 * TAPPING AN ENDED SESSION'S CHIP selects the next run's model. There is no
 * runtime to mutate: `use-stored-model.ts` retains that intent and applies it
 * through same-session Resume → set_model → set_effort only on an explicit
 * Resume/Send. A catalogue/read failure remains reachable through the picker,
 * rather than trapping the reader behind a disabled last-known model.
 *
 * BEFORE THE FIRST FRAME nothing has said whether the session ended, so the
 * row's model is shown DISABLED too (review round 1, m1): a tap in that window
 * on a session that turns out to be ended would send a `set_model` the relay
 * refuses with 409. The first frame decides — live opens the picker, ended
 * takes the branch above.
 *
 * A LIVE SESSION WITH NO EFFORT HIDES THE CHIP, as an ended one does (design
 * round 1, D1): on an attached runtime `""` means "this model has no ladder",
 * and a muted `—` beside the model read as another `n/a`. The home composer
 * keeps its dash (`chip-labels.ts`); hiding is this screen's rule.
 */

import type { ModelEntry } from "@/contracts/types.gen";
import { effortLabel, modelLabel } from "@/features/home/picker-model";
import {
	type ChipConnection,
	type ComposerChip,
	type ComposerChipLabels,
	composerChipLabels,
	modelChipText,
	NOT_CONNECTED_HINT,
	reportedModel,
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
	/** `null` is the wire's "no rung known" (v0.101.14+); the parsed row carries
	 *  `undefined` for it, but a wire-typed row may still hold the `null`, and
	 *  `firstOf` reads both as absence. */
	effort?: string | null;
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
	/** Cold session: the host defers the choice until explicit Resume/Send. */
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
		// This is a next-send choice, not a command to a nonexistent runtime.
		// The host defers applying it until explicit Resume/Send.
		return {
			model:
				model !== null
					? {
							kind: "value",
							text: model,
							accessibilityLabel: t("mobile.session.chip.model_label", {
								model,
							}),
						}
					: {
							kind: "value",
							text: t("mobile.home.chip.model_default_short"),
							accessibilityLabel: "Model, not recorded",
						},
			effort:
				effortSource.length > 0
					? {
							kind: "value",
							text: effortLabel(effortSource),
							accessibilityLabel: t("mobile.session.chip.effort_label", {
								effort: effortLabel(effortSource),
							}),
						}
					: null,
		};
	}

	if (p === null && input.connection === "loading") {
		// The skeletons, from the one module that owns them.
		const pending = composerChipLabels({
			model: { kind: "loading" },
			effort: null,
			connection: "loading",
		});
		const name = friendlyModelName(modelSource, input.models);
		return {
			model:
				name === null
					? pending.model
					: {
							kind: "unavailable",
							text: name,
							accessibilityLabel: t("mobile.session.chip.model_label", {
								model: name,
							}),
							accessibilityHint: NOT_CONNECTED_HINT,
						},
			effort: pending.effort,
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
			return name === null
				? null
				: {
						text: name,
						label: t("mobile.session.chip.model_label", { model: name }),
					};
		}),
		effort:
			/* D1 (header): a reported-but-empty rung on a connected session hides
			 *  the chip. An unreachable route keeps its dash — that one says why
			 *  nothing shows. */
			p !== null && p.effort.length === 0
				? null
				: friendlyValue(base.effort, () => {
						const name = effortLabel(p?.effort ?? "");
						return {
							text: name,
							label: t("mobile.session.chip.effort_label", { effort: name }),
						};
					}),
	};
};

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
