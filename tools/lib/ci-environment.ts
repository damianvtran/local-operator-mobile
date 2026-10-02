/**
 * What this environment can actually run, decided once and named everywhere.
 *
 * CI is the first place these self-checks ever ran, and it reported five failures. Three
 * of them had the same shape: a check that needs something the job does not have — the
 * app's name-contract source, a browser for the capture — reported a **data failure**
 * ("no manifest path was printed", `expected [] got [...three real names...]`) for an
 * environment that could not produce the data. Worse, one shape could only ever fail:
 * comparing emitted names against an EMPTY expectation list.
 *
 * The rule here: a check that cannot run is a NAMED SKIP that says which environment it
 * needs. It is never a pass, and it is never a failure for a reason that belongs to the
 * job rather than the code.
 */
export const NEEDS_BROWSER =
	"needs a browser (Google Chrome): this job has none — the frames/audit job is the one that captures";
export const NEEDS_HOOK_PARSE =
	"needs the connection provider's own hook to parse: the file is readable but no `lo-*` name came out of it, so there is no expectation list to compare against — an empty parse must never read as a mismatch";
export const NEEDS_NAME_CONTRACT =
	"needs the app's connection provider to be readable, which the check above explains";

/** A candidate source for the name contract, in priority order. */
export interface SourceCandidate {
	readonly label: string;
	readonly read: () => string;
}

/**
 * Read the name contract's source from the FIRST readable candidate, and say which one
 * was used. The pre-merge branch ref is a fallback only: `actions/checkout` is depth-1,
 * so a ref-first read has nothing to read there, and the empty result then poisoned the
 * checks that consume it. When nothing is readable the caller fails the readability check
 * and SKIPS the derived ones — it never compares against an empty list.
 */
export function readFirstAvailable(candidates: readonly SourceCandidate[]): {
	source: string;
	from: string;
	tried: string[];
} {
	const tried: string[] = [];
	for (const candidate of candidates) {
		tried.push(candidate.label);
		let text = "";
		try {
			text = candidate.read();
		} catch {
			continue;
		}
		if (text !== "") return { source: text, from: candidate.label, tried };
	}
	return { source: "", from: "", tried };
}

/**
 * Can the capture-dependent checks run here? They need a browser; when there is none the
 * caller reports named skips rather than letting a missing browser read as a data failure.
 * Returned as a value so the decision itself is testable without a runner.
 */
export function captureChecksRunnable(chrome: { path: string } | null): {
	runnable: boolean;
	reason: string;
} {
	return chrome === null
		? { runnable: false, reason: NEEDS_BROWSER }
		: { runnable: true, reason: "" };
}

/**
 * What the capture said, in its own words.
 *
 * `captureManifest` returns the manifest path or `""`, and the check then printed "no
 * manifest path was printed" — which named the symptom and discarded the cause. CI proved
 * that costs a round: the contract job ships Chrome 154, so a browser-presence guard
 * decided "runnable", the checks failed anyway, and the note said nothing about why. This
 * returns the exit status and the child's own stderr tail, so the next reader is one line
 * from the truth.
 */
export function captureDiagnostic(result: {
	status: number | null;
	signal?: NodeJS.Signals | null;
	stdout?: string | null;
	stderr?: string | null;
}): string {
	const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	const tail = out.length > 800 ? `… ${out.slice(-800)}` : out;
	const signal =
		result.signal === null || result.signal === undefined
			? ""
			: ` (killed by ${String(result.signal)})`;
	return `the capture produced no manifest path: exit ${String(result.status)}${signal}${
		tail === ""
			? "; the capture printed nothing at all"
			: `; the capture said: ${tail}`
	}`;
}

/**
 * Is a capture failure an ENVIRONMENT limit or a real failure? Decided on the capture's own
 * output, never on whether a browser merely looked present — the guard that shipped keyed
 * on `resolveChrome()`, chose "runnable" on a runner that does have Chrome, and left the
 * checks failing with a note nobody could read.
 */
export function captureFailureIsEnvironmental(diagnostic: string): boolean {
	return /no (?:browser|chrome)|chrome (?:was )?not found|ENOENT|executable doesn't exist|no such file or directory.*chrome/i.test(
		diagnostic,
	);
}
