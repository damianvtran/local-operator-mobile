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
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	type BaselineEntry,
	buildBaseline,
	entryKey,
	migrationCandidates,
	ratchet,
	unaccountable,
	validateGrowth,
} from "./ratchet.ts";
import { findingKey, scanTree } from "./scan-strings.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = join(ROOT, "scripts", "i18n", "strings-baseline.json");

const NOTE =
	"Existing user-facing literals, recorded once so the checker can fail on NEW ones. " +
	"Shrink-only: `node scripts/i18n/check-strings.ts --update` removes entries that are gone " +
	"and only seeds debt proven newly detected in the immutable base by a scanner rule change. " +
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
	const resolved = git("rev-parse", "--verify", `${ref}^{commit}`);
	if (!resolved.ok || !FULL_SHA.test(resolved.out.trim())) {
		return { skipped: `cannot resolve base commit ${ref}`, required: true };
	}
	ref = resolved.out.trim();
	shown = git("show", `${ref}:${BASELINE_PATH}`);
	if (!shown.ok)
		return {
			skipped: `cannot read ${BASELINE_PATH} at ${ref}`,
			required: true,
		};
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
function catalogueValues(root = ROOT): ReadonlySet<string> {
	const directory = join(root, "src", "i18n", "catalogues", "en");
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

async function historicalCandidates(base: BaseCopy) {
	// Both scans use the same immutable source and catalogues: comparing scans
	// on different trees would bless new copy as if it were historical debt.
	const snapshot = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "i18n-base-"),
	);
	try {
		const archive = spawnSync(
			"git",
			["archive", base.ref, "src", "scripts/i18n/scan-strings.ts"],
			{ cwd: ROOT, maxBuffer: 100 * 1024 * 1024 },
		);
		if (archive.status !== 0 || !archive.stdout)
			throw new Error("git archive failed");
		const extract = spawnSync("tar", ["-xf", "-", "-C", snapshot], {
			input: archive.stdout,
		});
		if (extract.status !== 0)
			throw new Error("base snapshot extraction failed");
		const owned = catalogueValues(snapshot);
		const previous = await import(
			pathToFileURL(join(snapshot, "scripts/i18n/scan-strings.ts")).href
		);
		const oldFindings = previous.scanTree(snapshot, owned);
		const newFindings = scanTree(snapshot, owned);
		if (!Array.isArray(oldFindings) || !Array.isArray(newFindings))
			throw new Error("scanner returned invalid findings");
		return migrationCandidates(oldFindings, newFindings, base.entries);
	} finally {
		rmSync(snapshot, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const findings = scanTree(ROOT, catalogueValues());
	const update = process.argv.includes("--update");
	const created = !existsSync(BASELINE);
	const baseline = readBaseline(update);
	const { added, stale } = ratchet(baseline, findings);
	const base = resolveBase(flag("--base"));
	if (!("copy" in base))
		throw new Error(`Cannot resolve base: ${base.skipped}`);
	const candidates = await historicalCandidates(base.copy);
	const allowed = new Set(candidates.map(findingKey));
	const grown = validateGrowth(base.copy.entries, baseline, candidates);
	const oldKeys = new Set(base.copy.entries.map(entryKey));
	if (
		baseline.some(
			(entry) =>
				!oldKeys.has(entryKey(entry)) && entry.ruleVersion !== "copy-props-v1",
		)
	) {
		throw new Error(
			"New historical entries must name ruleVersion copy-props-v1",
		);
	}
	if (grown.length > 0)
		throw new Error(
			`The baseline gained ${grown.length} unauthorised entr(ies):\n${grown.map((entry) => `  ${entry.file} ${JSON.stringify(entry.text)}`).join("\n")}`,
		);

	if (update) {
		/* Only previously undetected base identities may be seeded; all other
		 * additions must be keyed even if the working baseline is missing. */
		const unauthorized = added.filter(
			(finding) => !allowed.has(findingKey(finding)),
		);
		if (unauthorized.length > 0) {
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
			return { owner, payoff, ruleVersion: "copy-props-v1" };
		});
		writeBaseline(next);
		console.log(
			created
				? `Baseline created: ${next.length} entries`
				: `Baseline updated: ${stale.length} removed, ${next.length - baseline.length + stale.length} added (${next.length} remain)`,
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

	const compared = `verified historical debt vs ${base.copy.ref.slice(0, 12)}`;

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

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
