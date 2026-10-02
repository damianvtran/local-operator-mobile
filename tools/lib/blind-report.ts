/**
 * Deciding whether a blinded canary passed, and describing it when it did not.
 *
 * Two properties this file exists to hold, both learned the hard way on this branch:
 *
 * 1. **A HEALTHY blinded run is `ok: false`.** Blinding removes one rule, the audit then
 *    misses exactly that defect, and the canary exits 1 by design (`missedDefects.length >
 *    0` → `failedTerms = ["missed"]` → `ok = false`). So `verdict.ok === true` can never
 *    hold for the case under test, and requiring it turned every blind into a failure:
 *    every tree kept (the footprint this harness spent rounds removing) and the shared
 *    capture never reaped. The permitted failure set is therefore *the expected miss and
 *    nothing else* — any second term is a real failure of the run.
 * 2. **The canary is still the authority.** The predicate reads the canary's own verdict
 *    rather than re-deriving one of its five terms, because a re-derivation shipped a
 *    FALSE PASS: `cleanFails`, `cleanStatus` and `vacuous` failures were masked.
 *
 * An absent, malformed or non-object verdict is a FINDING, never health.
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

const asObject = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

/**
 * Does the blind PASS?
 *
 * `status === 1` and the expected single miss are the *shape of success* here, and the
 * canary's own `failedTerms` must be exactly `["missed"]` — the blinding — with no second
 * term. `vacuous`, `cleanFails`, `defectsStatus` and `cleanStatus` each therefore fail the
 * blind and are named in the diagnostic.
 */
export function blindPasses(input: {
	status: number | null;
	missed: string[];
	defect: string;
	verdict: CanaryVerdict;
}): boolean {
	const terms = input.verdict.failedTerms;
	return (
		input.status === 1 &&
		input.missed.length === 1 &&
		input.missed[0] === input.defect &&
		Array.isArray(terms) &&
		terms.length === 1 &&
		terms[0] === "missed"
	);
}

/**
 * Parse the canary's `VERDICT {...}` line.
 *
 * Returns `{}` for anything that is not a JSON object — absent, malformed, `null`, an
 * array, a string, a number. `JSON.parse("null")` returns `null`, and letting that through
 * pushed a `TypeError` out of the mutation loop into `main().catch`: exit 2 with the
 * results table lost, which is precisely the failure mode this file's callers exist to
 * close.
 */
export function parseCanaryVerdict(output: string): CanaryVerdict {
	const line = /^VERDICT (.*)$/m.exec(output)?.[1];
	if (line === undefined) return {};
	try {
		const parsed: unknown = JSON.parse(line);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		return parsed as CanaryVerdict;
	} catch {
		return {};
	}
}

/**
 * The failure text. Never throws: it feeds a `check()` message, and a diagnostic that
 * cannot be rendered is worse than a plain one, so every access is guarded and the whole
 * composition is wrapped.
 */
export function blindDiagnostic(input: {
	exitCode: number | null;
	signal: string | null;
	named: string[];
	verdict: CanaryVerdict;
	keptTree: string;
}): string {
	try {
		const verdict = asObject(input.verdict);
		const terms = Array.isArray(verdict.failedTerms)
			? (verdict.failedTerms as string[])
			: undefined;
		const cells = asObject(verdict.cells);
		const rows = asObject(verdict.rows);
		const number = (value: unknown): number | null | undefined =>
			typeof value === "number" || value === null
				? (value as number | null)
				: undefined;
		const parts = [
			`exit ${show(input.exitCode)}${input.signal === null ? "" : ` (killed by ${input.signal})`}`,
			// `none` and `not reported` are different findings: an empty list is a healthy
			// run's shape, a missing list means the canary never reached a readable verdict.
			`failed terms: ${
				terms === undefined ? "not reported" : terms.join(", ") || "none"
			}`,
			verdict.vacuous === true
				? "VACUOUS (the canary's own line): a direction produced no cells or no rows"
				: "",
			`cells defects/clean ${show(number(cells.defects))}/${show(number(cells.clean))}`,
			`rows defects/clean ${show(number(rows.defects))}/${show(number(rows.clean))}`,
			`clean-page FAIL rows ${show(number(verdict.cleanFails))}`,
			`defect-page exit ${show(number(verdict.defectsStatus))} · clean-page exit ${show(
				number(verdict.cleanStatus),
			)}`,
			`audit named: ${input.named.join(", ") || "none"}`,
			`evidence: ${input.keptTree}`,
		];
		return parts.filter((part) => part !== "").join(" · ");
	} catch (error) {
		return `unreadable verdict (${String(error)}) · exit ${show(input.exitCode)} · evidence: ${input.keptTree}`;
	}
}
