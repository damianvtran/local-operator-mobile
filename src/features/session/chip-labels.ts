/**
 * What the composer's two chips say, as a pure function — because getting this
 * wrong is invisible in a screenshot and was wrong twice.
 *
 * The chips are the reader's two levers on the turn, and their state has three
 * cases that look alike and mean different things:
 *
 * - **loading** — no projection has arrived and one is still expected. Shows the
 *   kit's skeleton (§ 19), never a noun: a chip labelled `model` is a control that
 *   names nothing, which reads as broken rather than as coming (design round 1,
 *   D6).
 * - **unavailable** — the value is KNOWN to be absent: a model with no effort
 *   control, or a session whose route is refused so nothing is coming. Shows a
 *   muted `—` (once `n/a`, retired on TestFlight 578 feedback) and stays
 *   disabled. The distinction from `loading` is the whole reason this is a
 *   function and not an expression in JSX: the first cut of the D6 fix treated
 *   "no effort ladder" as loading and put a skeleton that never resolved on every
 *   rungless model (caught by QA round 4 Q1), and a refused route had the same
 *   shape — a pulse that outlives the connection (review round 4 R8).
 * - **value** — the wire reported one, OR the reader's own choice makes it known
 *   without the wire (`ModelReading`'s `default` and `selector` cases).
 *
 * The model slot takes a READING rather than a nullable selector because "nothing
 * was chosen, so the computer's configured default applies" and "the catalogue
 * could not be read" are different facts, and neither is `n/a` — the fallback that
 * rendered a silent failure as a connected session that had reported no model.
 *
 * The accessible name is never the raw value: `n/a` alone tells a screen reader
 * nothing about which chip it is, so every case names the field and its state
 * (design round 2, D14). The accessible names stay ENGLISH here, as they always
 * have in this module; the one word a reader SEES in the two new cases is
 * catalogue copy, so a translator owns it.
 */

import { t } from "@/i18n";
export type ComposerChip =
	| { kind: "loading"; accessibilityLabel: string }
	| {
			kind: "unavailable";
			text: string;
			accessibilityLabel: string;
			/** WHY it is unavailable, in the kit's own words for the case: a rungless
			 *  model and a refused route are different facts and must not share a
			 *  sentence that is false about one of them. */
			accessibilityHint: string;
	  }
	| { kind: "value"; text: string; accessibilityLabel: string };

/** What the connection can say about a value. Not a boolean, because "no value
 *  yet, still coming" and "no value, and nothing is coming" are the two states a
 *  single `loading` flag kept conflating. */
export type ChipConnection = "loading" | "connected" | "unreachable";

/**
 * What is known about the MODEL the next start will use.
 *
 * `default` and `unknown` are not variations on "absent": `absent` is a connected
 * session that reported no model, while `default` is a known, working state (the
 * reader chose nothing, so the computer's own default applies) and `unknown` is a
 * read that failed. Collapsing them into one `null` is what let a silent catalogue
 * failure render as `n/a` under a chip that still declared itself connected.
 */
export type ModelReading =
	| { kind: "selector"; selector: string }
	/** Nothing was chosen: the computer's configured default is what a start uses. */
	| { kind: "default" }
	/** The catalogue could not be read, so nothing can be offered or named. */
	| { kind: "unknown" }
	/** A connected session that reported no model at all. */
	| { kind: "absent" }
	| { kind: "loading" };

/** What a session's OWN projection says about its model. A session cannot be in the
 *  `default` or `unknown` cases — those are the home's, where no session exists yet
 *  and the reader's choice (or the catalogue) is what is known. */
export const reportedModel = (
	label: string | null | undefined,
): ModelReading =>
	label === null || label === undefined || label.length === 0
		? { kind: "absent" }
		: { kind: "selector", selector: label };

/** The two chips, in the order they render. */
export interface ComposerChipLabels {
	model: ComposerChip;
	effort: ComposerChip;
}

/**
 * The model's own name: the relay's `model_label` is often the raw
 * `provider/model_id` selector (`anthropic/claude-opus-5`), and at 390 pt that
 * string alone pushed the effort chip against the screen edge. The provider is the
 * model SHEET's grouping, where there is room to read it; the chip only has to say
 * which model is on.
 */
export const modelChipText = (label: string): string | null => {
	if (label.length === 0) return null;
	const slash = label.lastIndexOf("/");
	return slash >= 0 && slash < label.length - 1
		? label.slice(slash + 1)
		: label;
};

const LOADING: Record<"model" | "effort", ComposerChip> = {
	model: { kind: "loading", accessibilityLabel: "Model, loading" },
	effort: { kind: "loading", accessibilityLabel: "Effort, loading" },
};

/** What an unavailable chip SHOWS: a muted em dash, never the literal `n/a`.
 *  TestFlight 578 feedback: `n/a` under a session that had simply ended read as
 *  a broken read rather than as "nothing to show". The dash is a symbol, not a
 *  word, so it needs no translation; the accessible name and hint carry the
 *  meaning (D14), and the chip stays disabled so the muted ink is the cue. */
export const UNAVAILABLE_TEXT = "\u2014";

const RUNG_LESS_HINT = "This model has no effort control";
const UNREPORTED_HINT = "The session has not reported a model";
const NOT_CONNECTED_HINT = "Nothing is connected yet";
const UNREAD_HINT = "The model list could not be read";

/** Both chips, for a connection that will never deliver: no pulse, and a hint that
 *  says why rather than a skeleton that outlives the route (review round 4, R8). */
const unreachable = (): ComposerChipLabels => ({
	model: {
		kind: "unavailable",
		text: UNAVAILABLE_TEXT,
		accessibilityLabel: "Model, not available",
		accessibilityHint: NOT_CONNECTED_HINT,
	},
	effort: {
		kind: "unavailable",
		text: UNAVAILABLE_TEXT,
		accessibilityLabel: "Effort, not available",
		accessibilityHint: NOT_CONNECTED_HINT,
	},
});

export const composerChipLabels = (input: {
	/** What is known about the model — chosen, defaulted, unread or unreported. */
	model: ModelReading;
	/** The projection's effort rung; `""` means the model has no ladder. */
	effort: string | null;
	/** What the connection knows. `"connected"` means a projection has arrived —
	 *  STALE INCLUDED, because a value that was reported is still the truth about
	 *  the session, and replacing a real value with `n/a` because the stream later
	 *  dropped would be the blank-where-stale-belongs failure this app avoids. */
	connection: ChipConnection;
}): ComposerChipLabels => {
	if (input.connection === "unreachable") return unreachable();
	return {
		model: modelChipFor(input.model, input.connection),
		effort: effortChipFor(input.effort, input.connection),
	};
};

/**
 * The model chip.
 *
 * A `selector`, `default` or `unknown` reading is KNOWN, so it is shown whatever the
 * connection is doing — a catalogue still loading must not replace a model the
 * reader picked, and it cannot un-know a failed read. Only `absent` waits: while the
 * connection is still bringing a projection it is the skeleton (D6), and once one
 * has arrived it is `n/a` (the session genuinely reported none).
 */
const modelChipFor = (
	reading: ModelReading,
	connection: ChipConnection,
): ComposerChip => {
	switch (reading.kind) {
		case "loading":
			return LOADING.model;
		case "default":
			return {
				kind: "value",
				text: t("mobile.session.chip.model_default"),
				accessibilityLabel: "Model, using this computer's default",
			};
		case "unknown":
			return {
				kind: "unavailable",
				text: t("mobile.session.chip.model_unknown"),
				accessibilityLabel: "Model, not read",
				accessibilityHint: UNREAD_HINT,
			};
		case "selector": {
			const model = modelChipText(reading.selector);
			if (model === null) return unreported();
			return {
				kind: "value",
				text: model,
				accessibilityLabel: `Model, ${model}`,
			};
		}
		case "absent":
			return connection === "loading" ? LOADING.model : unreported();
	}
};

/** The connected session that reported no model: `n/a`, said plainly, with the
 *  reason in the hint. Not the `default` case — that one knows what will run. */
const unreported = (): ComposerChip => ({
	kind: "unavailable",
	text: UNAVAILABLE_TEXT,
	accessibilityLabel: "Model, not available",
	accessibilityHint: UNREPORTED_HINT,
});

const effortChipFor = (
	effort: string | null,
	connection: ChipConnection,
): ComposerChip => {
	if (connection === "loading") return LOADING.effort;
	const rung = effort === null || effort.length === 0 ? null : effort;
	return rung === null
		? {
				kind: "unavailable",
				text: UNAVAILABLE_TEXT,
				accessibilityLabel: "Effort, not available",
				accessibilityHint: RUNG_LESS_HINT,
			}
		: {
				kind: "value",
				text: rung,
				accessibilityLabel: `Effort, ${rung}`,
			};
};
