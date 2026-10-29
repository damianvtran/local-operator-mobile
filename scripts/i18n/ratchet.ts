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

/**
 * One recorded exemption. `owner` and `payoff` are REQUIRED fields, not prose in
 * a pull request description: an exemption nobody owns and nothing will remove is
 * how a "temporary" baseline becomes permanent (core's `i18n/allowlist` entries
 * carry the same two facts, for the same reason). `check-strings.ts` refuses a
 * baseline entry without both.
 */
export interface BaselineEntry {
	readonly file: string;
	readonly text: string;
	/** Who is accountable for removing this literal. */
	readonly owner: string;
	/** The condition that removes it (what keying it needs, or what retires it). */
	readonly payoff: string;
}

export interface RatchetResult {
	/** Findings present now but absent from the baseline. Key these. */
	readonly added: readonly Finding[];
	/** Baseline entries that no longer exist. `--update` may drop them. */
	readonly stale: readonly BaselineEntry[];
}

/** The identity of an entry — the same `file` + `text` key a finding uses. */
export function entryKey(entry: Pick<BaselineEntry, "file" | "text">): string {
	return `${entry.file}\u0000${entry.text}`;
}

/**
 * Rebuild the baseline from the current findings. `accountable` supplies the
 * `owner`/`payoff` for an entry; a surviving entry keeps the values already
 * recorded, so `--update` never rewrites who owns what.
 */
export function buildBaseline(
	findings: readonly Finding[],
	accountable: (finding: Finding) => Pick<BaselineEntry, "owner" | "payoff">,
): BaselineEntry[] {
	const seen = new Map<string, BaselineEntry>();
	for (const finding of findings) {
		const key = findingKey(finding);
		if (!seen.has(key)) {
			seen.set(key, {
				file: finding.file,
				text: finding.text,
				...accountable(finding),
			});
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
	const baselineKeys = new Set(baseline.map(entryKey));
	const findingKeys = new Set(findings.map(findingKey));
	const added = findings.filter(
		(finding) => !baselineKeys.has(findingKey(finding)),
	);
	const stale = baseline.filter((entry) => !findingKeys.has(entryKey(entry)));
	return { added, stale };
}

/**
 * Entries in `head` that `base` (the merge base's baseline) does not have.
 *
 * WHY THIS EXISTS. `ratchet()` compares the tree against the working-tree
 * baseline, so a hand-appended entry makes its own literal "baselined" and the
 * check goes green. Only a comparison with the merge base's copy sees growth:
 * the baseline may lose entries in a pull request and may never gain one.
 * Identity is `file` + `text` — editing an entry's owner or payoff is not growth.
 */
export function baselineGrowth(
	base: readonly Pick<BaselineEntry, "file" | "text">[],
	head: readonly BaselineEntry[],
): BaselineEntry[] {
	const known = new Set(base.map(entryKey));
	return head.filter((entry) => !known.has(entryKey(entry)));
}

/** Entries missing a non-blank `owner` or `payoff`. */
export function unaccountable(
	entries: readonly Partial<BaselineEntry>[],
): Partial<BaselineEntry>[] {
	const blank = (value: unknown): boolean =>
		typeof value !== "string" || value.trim() === "";
	return entries.filter((entry) => blank(entry.owner) || blank(entry.payoff));
}
