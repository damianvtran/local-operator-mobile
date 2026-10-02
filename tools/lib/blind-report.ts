/**
 * The failure text for a blinded canary, composed from the canary's own verdict.
 *
 * Why this exists: `verify` used to hand the check only the parsed `missed` ledger, so a
 * failing blind printed `got []` and nothing else — and at `d5b3960` that was
 * uninterpretable, because an empty ledger is the *correct* answer when the capture
 * produced nothing to find a defect in. "The audit found no defect" and "the capture
 * produced nothing to find a defect in" are different faults in different files, and the
 * old message could not tell them apart. The canary now prints a `VERDICT` line
 * (`run-canary.ts`, the five terms of its `ok` expression), and this turns it into one
 * sentence a reader can act on without re-running anything.
 */
export interface CanaryVerdict {
	ok?: boolean;
	failedTerms?: string[];
	vacuous?: boolean;
	missed?: string[];
	cleanFails?: number;
	defectsStatus?: number | null;
	cleanStatus?: number | null;
	cells?: { defects?: number; clean?: number };
	rows?: { defects?: number; clean?: number };
}

/** `unknown` rather than a blank: an unparsed verdict is itself a finding. */
const show = (value: number | null | undefined): string =>
	value === undefined || value === null ? "unknown" : String(value);

export function blindDiagnostic(input: {
	exitCode: number | null;
	signal: string | null;
	named: string[];
	verdict: CanaryVerdict;
	keptTree: string;
}): string {
	const { verdict } = input;
	const parts = [
		`exit ${show(input.exitCode)}${input.signal === null ? "" : ` (killed by ${input.signal})`}`,
		// `none` and `not reported` are different findings: an empty list is a healthy run,
		// a missing list means the canary never printed a verdict.
		`failed terms: ${
			verdict.failedTerms === undefined
				? "not reported"
				: verdict.failedTerms.join(", ") || "none"
		}`,
		// Named in the canary's own words, so a capture that produced nothing can never
		// read as a passing blank (run-canary prints the same sentence above its verdict).
		verdict.vacuous ? "VACUOUS: a direction produced no cells or no rows" : "",
		`cells defects/clean ${show(verdict.cells?.defects)}/${show(verdict.cells?.clean)}`,
		`rows defects/clean ${show(verdict.rows?.defects)}/${show(verdict.rows?.clean)}`,
		`clean-page FAIL rows ${show(verdict.cleanFails)}`,
		`defect-page exit ${show(verdict.defectsStatus)} · clean-page exit ${show(verdict.cleanStatus)}`,
		`audit named: ${input.named.join(", ") || "none"}`,
		`evidence: ${input.keptTree}`,
	];
	return parts.filter((part) => part !== "").join(" · ");
}

/**
 * Parse the canary's `VERDICT {...}` line. Returns `{}` when the line is absent or
 * malformed, and the diagnostic then says "failed terms: not reported" rather than
 * inventing a term — an unparsed verdict is a finding about the canary, not about the
 * blinding.
 */
export function parseCanaryVerdict(output: string): CanaryVerdict {
	const line = /^VERDICT (.*)$/m.exec(output)?.[1];
	if (line === undefined) return {};
	try {
		return JSON.parse(line) as CanaryVerdict;
	} catch {
		return {};
	}
}
