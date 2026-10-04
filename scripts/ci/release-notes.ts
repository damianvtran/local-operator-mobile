#!/usr/bin/env node
/**
 * Generate release notes from the conventional commits since the previous tag.
 *
 *     node scripts/ci/release-notes.ts --to v1.2.3
 *     node scripts/ci/release-notes.ts --from v1.2.2 --to v1.2.3
 *     node scripts/ci/release-notes.ts --to v1.2.3 --out "$RUNNER_TEMP/notes.md"
 *
 * Why not `gh release create --generate-notes`. GitHub's generator groups by
 * pull request, which reads well when every change arrived as one — but this
 * repository's history is written in conventional commits, and the squash/merge
 * boundary is not where the useful grouping is. A `feat:` in a branch that was
 * rebased three times is still a feature, and the notes should say so without a
 * human editing them afterwards.
 *
 * MERGE COMMITS ARE SKIPPED deliberately: their subject is "Merge pull request
 * #6 from …", which is neither a conventional commit nor a description of the
 * change. The commits they carry are on the first-parent path and are what the
 * notes are built from.
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/** `type(scope)!: subject` — the conventional-commit grammar, borrowed whole.
 * `!` marks a breaking change and is pulled out of `scope`. */
const COMMIT =
	/^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.+)$/;

type Section = { title: string; types: string[] };

/** Sections in the order a reader wants them, with the type each one collects. */
const SECTIONS: Section[] = [
	{ title: "Features", types: ["feat"] },
	{ title: "Fixes", types: ["fix", "revert"] },
	{ title: "Performance", types: ["perf"] },
	{ title: "Refactors", types: ["refactor"] },
	{ title: "Documentation", types: ["docs"] },
	{ title: "Tooling, CI and releases", types: ["build", "ci", "chore"] },
	{ title: "Tests", types: ["test"] },
	{ title: "Styling", types: ["style"] },
];

type Commit = {
	sha: string;
	short: string;
	type: string | null;
	scope: string | null;
	breaking: boolean;
	summary: string;
};

/** Read `--name value`, falling back to `fallback`. */
const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const git = (...args: string[]): string =>
	execFileSync("git", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

const to = arg("to", "HEAD");
let from = arg("from", "");

if (!from) {
	// The previous tag, or the whole history when this is the first release.
	// `git describe` exits non-zero when there is nothing to describe, and this
	// repository's first release is exactly that case — so an empty history is a
	// normal answer here, not an error.
	try {
		from = git(
			"describe",
			"--tags",
			"--abbrev=0",
			"--match",
			"v[0-9]*",
			`${to}^`,
		);
	} catch {
		from = "";
	}
}
const range = from ? `${from}..${to}` : to;

/* `--no-merges` (see the header) and a tab separator, because a subject can
 * contain any other character and a notes generator that mis-splits a one-line
 * commit is the kind of bug nobody reports. */
const commits: Commit[] = git("log", "--no-merges", "--pretty=%H%x09%s", range)
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const tab = line.indexOf("\t");
		const sha = tab === -1 ? line : line.slice(0, tab);
		const subject = tab === -1 ? "" : line.slice(tab + 1);
		const groups = COMMIT.exec(subject)?.groups;
		return {
			sha,
			short: sha.slice(0, 7),
			type: groups?.type ?? null,
			scope: groups?.scope ?? null,
			breaking: Boolean(groups?.bang),
			summary: groups?.subject ?? subject,
		};
	});

const known = new Set(SECTIONS.flatMap((section) => section.types));
const unreleased = commits.filter(
	(commit) => commit.type === null || !known.has(commit.type),
);

const bullet = (commit: Commit): string => {
	const scope = commit.scope ? `**${commit.scope}:** ` : "";
	return `- ${scope}${commit.summary} (${commit.short})`;
};

const lines: string[] = [];
if (from) lines.push(`Changes since ${from}.`, "");
else lines.push("First release.", "");

const breaking = commits.filter((commit) => commit.breaking);
if (breaking.length > 0) {
	lines.push("## Breaking changes", "");
	for (const commit of breaking) lines.push(bullet(commit));
	lines.push("");
}

for (const section of SECTIONS) {
	const items = commits.filter(
		(commit) => commit.type !== null && section.types.includes(commit.type),
	);
	if (items.length === 0) continue;
	lines.push(`## ${section.title}`, "");
	for (const commit of items) lines.push(bullet(commit));
	lines.push("");
}

if (unreleased.length > 0) {
	// Not an error: a commit that is not conventional is still a change, and
	// dropping it from the notes is how a release silently omits something real.
	lines.push("## Other changes", "");
	for (const commit of unreleased) lines.push(bullet(commit));
	lines.push("");
}

lines.push(
	`${commits.length} commit(s) in ${range}.`,
	"",
	"Built by GitHub Actions from the tag; see the run's artefacts for the " +
		"APK, AAB and IPA. Install on Android from the APK attached here, or from " +
		"the Play internal track; iOS builds go to TestFlight.",
	"",
);

const notes = lines.join("\n");
const out = arg("out", "");
if (out) writeFileSync(out, notes);
else process.stdout.write(notes);
