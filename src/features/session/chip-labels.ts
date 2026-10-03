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
 *   control, or a session whose route is refused so nothing is coming. Shows `n/a`
 *   and stays disabled. The distinction from `loading` is the whole reason this is
 *   a function and not an expression in JSX: the first cut of the D6 fix treated
 *   "no effort ladder" as loading and put a skeleton that never resolved on every
 *   rungless model (caught by QA round 4 Q1), and a refused route had the same
 *   shape — a pulse that outlives the connection (review round 4 R8).
 * - **value** — the wire reported one.
 *
 * The accessible name is never the raw value: `n/a` alone tells a screen reader
 * nothing about which chip it is, so every case names the field and its state
 * (design round 2, D14).
 */
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

const RUNG_LESS_HINT = "This model has no effort control";
const UNREPORTED_HINT = "The session has not reported a model";
const NOT_CONNECTED_HINT = "Nothing is connected yet";

/** Both chips, for a connection that will never deliver: no pulse, and a hint that
 *  says why rather than a skeleton that outlives the route (review round 4, R8). */
const unreachable = (): ComposerChipLabels => ({
	model: {
		kind: "unavailable",
		text: "n/a",
		accessibilityLabel: "Model, not available",
		accessibilityHint: NOT_CONNECTED_HINT,
	},
	effort: {
		kind: "unavailable",
		text: "n/a",
		accessibilityLabel: "Effort, not available",
		accessibilityHint: NOT_CONNECTED_HINT,
	},
});

export const composerChipLabels = (input: {
	/** The projection's model selector, or `null` when there is no projection. */
	model: string | null;
	/** The projection's effort rung; `""` means the model has no ladder. */
	effort: string | null;
	/** What the connection knows. `"connected"` means a projection has arrived —
	 *  STALE INCLUDED, because a value that was reported is still the truth about
	 *  the session, and replacing a real value with `n/a` because the stream later
	 *  dropped would be the blank-where-stale-belongs failure this app avoids. */
	connection: ChipConnection;
}): ComposerChipLabels => {
	if (input.connection === "loading")
		return { model: LOADING.model, effort: LOADING.effort };
	if (input.connection === "unreachable") return unreachable();

	const model = input.model === null ? null : modelChipText(input.model);
	const effort =
		input.effort === null || input.effort.length === 0 ? null : input.effort;

	return {
		model:
			model === null
				? {
						kind: "unavailable",
						text: "n/a",
						accessibilityLabel: "Model, not available",
						accessibilityHint: UNREPORTED_HINT,
					}
				: {
						kind: "value",
						text: model,
						accessibilityLabel: `Model, ${model}`,
					},
		effort:
			effort === null
				? {
						kind: "unavailable",
						text: "n/a",
						accessibilityLabel: "Effort, not available",
						accessibilityHint: RUNG_LESS_HINT,
					}
				: {
						kind: "value",
						text: effort,
						accessibilityLabel: `Effort, ${effort}`,
					},
	};
};
