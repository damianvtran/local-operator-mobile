/**
 * Fail on user-facing literals that no catalogue key owns.
 *
 * WHY A BASELINE. The app shipped ~600 English literals before there was a
 * runtime; blocking all of them at once would block every pull request. The
 * baseline records the ones already shipped, so this check fails only on NEW
 * ones — and, because the ratchet is shrink-only, on entries that have been
 * keyed but not removed from the baseline.
 *
 * Usage:
 *   node scripts/i18n/check-strings.ts            # check (CI, and before a PR)
 *   node scripts/i18n/check-strings.ts --update   # drop entries that are gone
 *   node scripts/i18n/check-strings.ts --base <ref>  # compare growth against <ref>
 *
 * The scan is heuristic — `scan-strings.ts` states exactly which three rules it
 * applies and what it cannot see. A finding is a prompt to look, not proof of a
 * defect; the baseline makes that judgement once, in review.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type BaselineEntry,
	baselineGrowth,
	buildBaseline,
	entryKey,
	ratchet,
	unaccountable,
} from "./ratchet.ts";
import { findingKey, scanTree } from "./scan-strings.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = join(ROOT, "scripts", "i18n", "strings-baseline.json");

const NOTE =
	"Existing user-facing literals, recorded once so the checker can fail on NEW ones. " +
	"Shrink-only: `node scripts/i18n/check-strings.ts --update` removes entries that are gone " +
	"and refuses to add any, and the check fails when an entry appears that the merge base's copy does not have. " +
	"Every entry names an owner and the payoff that removes it. Keying a literal is the only way to remove one.";

const FULL_SHA = /^[0-9a-f]{40}$/;
const BASELINE_PATH = "scripts/i18n/strings-baseline.json";

function readBaseline(allowMissing: boolean): BaselineEntry[] {
	let raw = "";
	try {
		raw = readFileSync(BASELINE, "utf8");
	} catch {
		/* The first run creates the baseline from the tree; `--check` on a missing
		 * baseline is a genuine error, because CI without one would pass silently. */
		if (allowMissing) return [];
		console.error(
			"scripts/i18n/strings-baseline.json is missing; run --update to create it from the current tree",
		);
		process.exit(1);
	}
	const parsed: unknown = JSON.parse(raw);
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		!("findings" in parsed)
	) {
		console.error("scripts/i18n/strings-baseline.json is not a baseline");
		process.exit(1);
	}
	const findings = (parsed as { findings: unknown }).findings;
	if (!Array.isArray(findings)) {
		console.error("scripts/i18n/strings-baseline.json has no findings array");
		process.exit(1);
	}
	return findings as BaselineEntry[];
}

function git(...args: string[]): { ok: boolean; out: string } {
	const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
	return { ok: result.status === 0, out: result.stdout ?? "" };
}

interface BaseCopy {
	/** What was compared against, for the message. */
	readonly ref: string;
	readonly entries: readonly Pick<BaselineEntry, "file" | "text">[];
}

/**
 * The baseline as the pull request's BASE has it, or why there is none.
 *
 * WHY. Comparing the tree with its own baseline cannot see a hand-appended entry
 * (the entry makes its own literal "known"). Growth is only visible against a
 * copy the author did not write. Resolution order:
 *   1. `--base <ref>`;
 *   2. a GitHub pull_request run: the event's base SHA. `actions/checkout`
 *      checks out the PR *merge* commit, so base SHA..HEAD is exactly the PR's
 *      effect; the SHA is fetched because the default checkout is one commit;
 *   3. locally, `git merge-base origin/main HEAD` (falling back to origin/main).
 * In a pull_request run an unresolvable base is a FAILURE — a gate that skips
 * itself in the one place it exists to run is a described gate. Anywhere else
 * (a push to main, a tarball, a fixture with no origin) it is skipped, loudly.
 */
function resolveBase(
	explicit: string | undefined,
): { copy: BaseCopy } | { skipped: string; required: boolean } {
	let ref = explicit;
	let required = explicit !== undefined;
	if (ref === undefined && process.env.GITHUB_EVENT_NAME === "pull_request") {
		required = true;
		try {
			const event = JSON.parse(
				readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"),
			) as { pull_request?: { base?: { sha?: string } } };
			ref = event.pull_request?.base?.sha;
		} catch {
			/* falls through to the unresolvable branch below */
		}
		if (ref === undefined) {
			return { skipped: "pull_request event has no base SHA", required };
		}
	}
	if (ref === undefined) {
		const mergeBase = git("merge-base", "origin/main", "HEAD");
		ref = mergeBase.ok ? mergeBase.out.trim() : "origin/main";
	}
	let shown = git("show", `${ref}:${BASELINE_PATH}`);
	if (!shown.ok && FULL_SHA.test(ref)) {
		/* A shallow checkout does not hold the base commit. One depth-1 fetch is
		 * enough to read one file from it. */
		if (git("fetch", "--no-tags", "--depth=1", "origin", ref).ok) {
			shown = git("show", `FETCH_HEAD:${BASELINE_PATH}`);
		}
	}
	if (!shown.ok) {
		return { skipped: `cannot read ${BASELINE_PATH} at ${ref}`, required };
	}
	try {
		const parsed = JSON.parse(shown.out) as { findings?: unknown };
		if (!Array.isArray(parsed.findings)) throw new Error("no findings array");
		return { copy: { ref, entries: parsed.findings as BaselineEntry[] } };
	} catch (error) {
		return {
			skipped: `${BASELINE_PATH} at ${ref} is unreadable (${(error as Error).message})`,
			required,
		};
	}
}

function flag(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

function writeBaseline(entries: readonly BaselineEntry[]): void {
	const payload = {
		$comment: NOTE,
		findings: entries,
	};
	writeFileSync(BASELINE, `${JSON.stringify(payload, null, "\t")}\n`);
}

function describe(file: string, line: number, text: string): string {
	return `  ${file}:${line}  ${JSON.stringify(text)}`;
}

/**
 * Every string the English catalogues already define — messages AND their
 * translator notes.
 *
 * A copy module literal that matches one is a MIRROR of a keyed message rather
 * than an omission: `account-routing-copy.ts` keeps its table because a plain-`node`
 * CI entry imports it and cannot follow `src/`'s extensionless imports, and
 * `catalogues.test.ts` proves the mirror is exact. Without this set the checker
 * would demand the same sentence be keyed twice.
 */
function catalogueValues(): ReadonlySet<string> {
	const directory = join(ROOT, "src", "i18n", "catalogues", "en");
	const owned = new Set<string>();
	for (const name of readdirSync(directory)) {
		if (!name.endsWith(".json")) continue;
		const parsed = JSON.parse(
			readFileSync(join(directory, name), "utf8"),
		) as Record<string, unknown>;
		for (const value of Object.values(parsed)) {
			if (typeof value === "string") {
				owned.add(value.trim());
			} else if (
				value !== null &&
				typeof value === "object" &&
				"note" in value
			) {
				const note = (value as { note?: unknown }).note;
				if (typeof note === "string") owned.add(note.trim());
			}
		}
	}
	return owned;
}

function main(): void {
	const findings = scanTree(ROOT, catalogueValues());
	const update = process.argv.includes("--update");
	const created = !existsSync(BASELINE);
	const baseline = readBaseline(update);
	const { added, stale } = ratchet(baseline, findings);

	if (update) {
		/* CREATING the baseline is the one non-shrinking write, because there is no
		 * prior state to grow from — it records the tree as it stands once. Every
		 * later `--update` may only remove. */
		if (added.length > 0 && !created) {
			console.error(
				`Refusing to update: ${added.length} literal(s) are not in the baseline. Key them, or extend a rule in scan-strings.ts deliberately.\n${added
					.map((finding) => describe(finding.file, finding.line, finding.text))
					.join("\n")}`,
			);
			process.exit(1);
		}
		/* A surviving entry keeps the owner/payoff it already has; only CREATING a
		 * baseline has none to keep, and then the caller must say who owns it. */
		const known = new Map(baseline.map((entry) => [entryKey(entry), entry]));
		const owner = flag("--owner");
		const payoff = flag("--payoff");
		const next = buildBaseline(findings, (finding) => {
			const kept = known.get(findingKey(finding));
			if (kept !== undefined) return kept;
			if (owner === undefined || payoff === undefined) {
				console.error(
					"Creating a baseline needs --owner <who> --payoff <what removes each entry>.",
				);
				process.exit(1);
			}
			return { owner, payoff };
		});
		writeBaseline(next);
		console.log(
			created
				? `Baseline created: ${next.length} entries`
				: `Baseline updated: ${baseline.length - next.length} removed, 0 added (${next.length} remain)`,
		);
		return;
	}

	const unowned = unaccountable(baseline);
	if (unowned.length > 0) {
		console.error(
			`${unowned.length} baseline entr(ies) lack an owner or payoff; every exemption names who removes it and what removes it.\n${unowned
				.map((entry) => `  ${entry.file}  ${JSON.stringify(entry.text)}`)
				.join("\n")}`,
		);
		process.exit(1);
	}

	const base = resolveBase(flag("--base"));
	let compared = "growth check SKIPPED";
	if ("copy" in base) {
		const grown = baselineGrowth(base.copy.entries, baseline);
		if (grown.length > 0) {
			console.error(
				`The baseline gained ${grown.length} entr(ies) relative to ${base.copy.ref}. It may only shrink: key the literal instead of exempting it.\n${grown
					.map(
						(entry) => `  added: ${entry.file}  ${JSON.stringify(entry.text)}`,
					)
					.join("\n")}`,
			);
			process.exit(1);
		}
		compared = `no growth vs ${base.copy.ref.slice(0, 12)}`;
	} else if (base.required) {
		console.error(
			`Cannot prove the baseline did not grow: ${base.skipped}. Failing closed, because this run is the pull request's gate.`,
		);
		process.exit(1);
	} else {
		compared = `growth check SKIPPED (${base.skipped})`;
	}

	if (added.length > 0) {
		console.error(
			`${added.length} un-keyed user-facing literal(s). Move each into a catalogue under src/i18n/catalogues/en/ and call t().\n${added
				.map((finding) => describe(finding.file, finding.line, finding.text))
				.join("\n")}`,
		);
		process.exit(1);
	}

	if (stale.length > 0) {
		console.error(
			`${stale.length} baseline entr(ies) no longer exist. The baseline must only shrink: run \`node scripts/i18n/check-strings.ts --update\`.\n${stale
				.map((entry) => `  ${entry.file}  ${JSON.stringify(entry.text)}`)
				.join("\n")}`,
		);
		process.exit(1);
	}

	console.log(
		`check-strings: ${findings.length} finding(s), all baselined; 0 new; ${compared}`,
	);
}

main();
