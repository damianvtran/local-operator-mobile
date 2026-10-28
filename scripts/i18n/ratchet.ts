/**
 * The shrink-only baseline rule, as data rather than as prose in a review.
 *
 * A ratchet that can grow is not a ratchet: it just moves the day the work gets
 * done. So the only update this module permits is one that REMOVES entries. A
 * new literal must be keyed (or the rule relaxed deliberately, which is a
 * conversation and a diff, not a flag).
 *
 * Identity is `file` + the literal's text, not its line: moving code down a file
 * must not look like a removal plus an addition.
 */

import type { Finding } from "./scan-strings.ts";
import { findingKey } from "./scan-strings.ts";

export interface BaselineEntry {
	readonly file: string;
	readonly text: string;
}

export interface RatchetResult {
	/** Findings present now but absent from the baseline. Key these. */
	readonly added: readonly Finding[];
	/** Baseline entries that no longer exist. `--update` may drop them. */
	readonly stale: readonly BaselineEntry[];
}

export function buildBaseline(findings: readonly Finding[]): BaselineEntry[] {
	const seen = new Map<string, BaselineEntry>();
	for (const finding of findings) {
		const key = findingKey(finding);
		if (!seen.has(key)) {
			seen.set(key, { file: finding.file, text: finding.text });
		}
	}
	return [...seen.values()].sort((left, right) => {
		if (left.file !== right.file) return left.file < right.file ? -1 : 1;
		return left.text < right.text ? -1 : 1;
	});
}

export function ratchet(
	baseline: readonly BaselineEntry[],
	findings: readonly Finding[],
): RatchetResult {
	const baselineKeys = new Set(
		baseline.map((entry) => `${entry.file}\u0000${entry.text}`),
	);
	const findingKeys = new Set(findings.map(findingKey));
	const added = findings.filter(
		(finding) => !baselineKeys.has(findingKey(finding)),
	);
	const stale = baseline.filter(
		(entry) => !findingKeys.has(`${entry.file}\u0000${entry.text}`),
	);
	return { added, stale };
}
