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
 *
 * The scan is heuristic — `scan-strings.ts` states exactly which three rules it
 * applies and what it cannot see. A finding is a prompt to look, not proof of a
 * defect; the baseline makes that judgement once, in review.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type BaselineEntry, buildBaseline, ratchet } from "./ratchet.ts";
import { scanTree } from "./scan-strings.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = join(ROOT, "scripts", "i18n", "strings-baseline.json");

const NOTE =
	"Existing user-facing literals, recorded once so the checker can fail on NEW ones. " +
	"Shrink-only: `node scripts/i18n/check-strings.ts --update` removes entries that are gone " +
	"and refuses to add any. Keying a literal is the only way to remove one.";

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
		const next = buildBaseline(findings);
		writeBaseline(next);
		console.log(
			created
				? `Baseline created: ${next.length} entries`
				: `Baseline updated: ${baseline.length - next.length} removed, 0 added (${next.length} remain)`,
		);
		return;
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
		`check-strings: ${findings.length} finding(s), all baselined; 0 new`,
	);
}

main();
