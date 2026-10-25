/** Content-identity admission for the U-08 proofs.
 *
 * WHY NOT PATH DIFFS. Both proofs used to admit themselves with `git diff`
 * rules: "every path between REPAIR_BASE/ORIGINAL_HEAD and HEAD is in a fixed
 * allowlist", and "nothing under app/src/assets/design/config differs from
 * ORIGINAL_HEAD at all". Both ask "has anything changed since a fixed commit?",
 * which is not the question a proof asks, and both go stale the moment
 * unrelated work merges. Measured: hosted run 40179237342 died in preflight with
 * "Source differs outside the reviewed diagnostic-only scope" before it launched
 * a browser, because PR #109 added a test file and touched the instrument while
 * PR #110 added listing frames under design/store-screenshots. Neither changes a
 * measured pixel, and both are permanently outside such an allowlist.
 *
 * THE QUESTION WORTH ASKING is "does this binary still measure what the baseline
 * measured?". Two content identities answer it and nothing else:
 *
 *  - INSTRUMENT_PINS: the exact files whose bytes define the measurement — the
 *    in-page probe, the canonical checks and U-08 policy, the paint math those
 *    call, the colour math behind the floors, the cell extractor that produces
 *    every field a check reads, and both drivers. A change here changes what the
 *    proof means, so it needs a deliberate re-pin rather than a silent re-run.
 *  - RENDER_TREE_PINS / RENDER_FILE_PINS: the app the proof was authored
 *    against — the source that builds the bundle, the design tokens and vendored
 *    faces the styling layer is generated from, the web shell and its fonts, and
 *    dependency identity. Anything that can move a line box belongs here.
 *
 * OUT OF SCOPE BY CONSTRUCTION, not by exclusion list: design/store-screenshots
 * (documentation captures), design/preview (the design kit's own preview page),
 * design/app-icon, plugins/ (native config plugins), docs, tests and fixtures are
 * simply not listed, so adding or editing them cannot refuse a run.
 *
 * GRANULARITY. Render inputs are one digest per root: pinning ~400 files by hand
 * is not reviewable, so a mismatch names the root and `--print` yields the new
 * value. Instrument pins are per-file so a refusal names the exact file and both
 * hashes, which is the whole point of pinning them.
 *
 * TRUST ROOT. These tables are it: editing them is how a re-pin happens and it
 * is visible in review like any other source change. The ORIGINAL_* constants in
 * u08-geometry-proof.ts are a different thing and are never re-pinned — they
 * identify the captured historical packet, not the instrument that runs today.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

const sha256 = (content: string | Uint8Array) =>
	createHash("sha256").update(content).digest("hex");

/** Per-file pins: the measurement's definition. Keys are repo-relative paths.
 * audit.ts is here because auditCell() is what fills the AuditState every check
 * reads; a change in extraction changes the measurement as surely as a policy
 * edit does. */
export const INSTRUMENT_PINS: Readonly<Record<string, string>> = {
	"tools/audit/audit.ts":
		"a6d619015bc78c7e5f753f452e326a722b172c18150371c3414c77fd8b4b2ebf",
	"tools/audit/checks.ts":
		"061e0c2aa32ed792aa707733e515f82dc84754526e0b5c97290d215b60bf8984",
	"tools/audit/color.ts":
		"a005d29b4eca066a0f4418e4ef66cdbed471898a2307c76a6ccfe83e7dded0ef",
	"tools/audit/paint-fragments.ts":
		"d65894ba1fb463eaad8c7e66b4145378f13316d707436d3eec2594cc1224d42a",
	"tools/audit/probe.ts":
		"ec9ba1291093e87094ea677d69f05de2f0019dd8d4fa12fbc49f19e390ddf5f1",
	"tools/audit/u08-fragment-verification.ts":
		"bcec0b75b00bbeeb51c1b8a989086c922072a64635a92ff6972a782f18b37908",
	"tools/audit/u08-geometry-proof.ts":
		"59358b798485dcb7662cd52a952bf988f24bd90fc5fb522d70f790260c326d00",
};

/** One digest per render root: source, tokens, vendor fonts, web shell. */
export const RENDER_TREE_PINS: Readonly<Record<string, string>> = {
	app: "0b3b61aa1c024867e2a1331c206e93fd758f7a8e0a3f7c7c2418757876a6dc8d",
	src: "c74f3eeb6a48c496758582ccc795731588082017020c1dd0319e94d59277f712",
	assets: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	public: "fffab05c9f1bcb5a820ec6fc62f853d005db87e152bca97fe3e22337aa85851b",
	"design/tokens":
		"404b34cfbc35fadd1513bfd13312f1ea978d4c7b16cdbcd0ecae8771a967b8c5",
	"design/fonts":
		"4d6a0f23c57ed6adff8ef353abe22c2208e802b70a961d4c8996aff3bae6b2fb",
};

/** Dependency and build identity: exact files, each hashed on its own. */
export const RENDER_FILE_PINS: Readonly<Record<string, string>> = {
	"app.config.ts":
		"81e92f5315dbc9df56c603c4ac58b54f90f52a64d20f6c0f4f4ab8d3c7cd0332",
	"metro.config.js":
		"8969b35b1269818e746e2a8e854f94995f0adbc54b18e8e80c95e90aca1aa707",
	"pnpm-lock.yaml":
		"4e09ec8a05cdbd6c27defe1337088fd4fcc08e17ddbfc88da0d693695fe1ce05",
	"pnpm-workspace.yaml":
		"1457b9b1a5ad6f9f7adf765d6b3adbaca44c8c938f4e9ccd525579dadae34ba3",
};

export const REPIN_COMMAND = "node tools/audit/u08-content-pins.ts --print";

/** The only place pin scope is decided; the snapshot lists exactly these paths. */
export function pinnedScopes(): string[] {
	return [
		...Object.keys(INSTRUMENT_PINS),
		...Object.keys(RENDER_TREE_PINS),
		...Object.keys(RENDER_FILE_PINS),
	].sort();
}

export interface RepositoryContent {
	/** sha256 of each tracked file's bytes, keyed by repo-relative path, limited
	 * to the pinned scopes. Untracked files are absent by design: the proof runs
	 * on a CI checkout, and a scratch file is not part of the built app. */
	readonly files: ReadonlyMap<string, string>;
}

/** Read the tracked content the pins describe. `git ls-files` is the enumerator
 * so .gitignore, node_modules, dist and store builds never enter the digest. */
export function snapshotContent(root: string = REPO_ROOT): RepositoryContent {
	const listed = execFileSync(
		"git",
		["ls-files", "-z", "--", ...pinnedScopes()],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	const files = new Map<string, string>();
	for (const path of listed)
		files.set(path, sha256(readFileSync(resolve(root, path))));
	return { files };
}

/** Order-independent digest of one render root, so a checkout's directory
 * traversal order cannot change the verdict. */
export function treeDigest(content: RepositoryContent, root: string): string {
	const prefix = `${root}/`;
	return sha256(
		[...content.files]
			.filter(([path]) => path.startsWith(prefix))
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([path, digest]) => `${digest}  ${path}\n`)
			.join(""),
	);
}

export type DriftKind = "instrument" | "render-tree" | "render-file";
export interface Drift {
	kind: DriftKind;
	/** The pinned file or root that differs. */
	scope: string;
	pinned: string;
	/** Re-hashed content, or "absent" when the pinned path is gone. */
	actual: string;
}

export function contentDrift(content: RepositoryContent): Drift[] {
	const drift: Drift[] = [];
	for (const [path, pinned] of Object.entries(INSTRUMENT_PINS)) {
		const actual = content.files.get(path) ?? "absent";
		if (actual !== pinned)
			drift.push({ kind: "instrument", scope: path, pinned, actual });
	}
	for (const [root, pinned] of Object.entries(RENDER_TREE_PINS)) {
		const actual = treeDigest(content, root);
		if (actual !== pinned)
			drift.push({ kind: "render-tree", scope: root, pinned, actual });
	}
	for (const [path, pinned] of Object.entries(RENDER_FILE_PINS)) {
		const actual = content.files.get(path) ?? "absent";
		if (actual !== pinned)
			drift.push({ kind: "render-file", scope: path, pinned, actual });
	}
	return drift;
}

/** Refuse before any browser work; the message must let an operator act. */
export function assertPinnedContent(
	content: RepositoryContent = snapshotContent(),
) {
	const drift = contentDrift(content);
	if (drift.length === 0) return;
	throw new Error(
		[
			"U08 content identity differs from the pinned baseline; refusing approximate proof:",
			...drift.map(
				(entry) =>
					`  ${entry.kind} ${entry.scope} pinned=${entry.pinned} actual=${entry.actual}`,
			),
			`A deliberate re-pin is required: review that change against what the proof measures, then run \`${REPIN_COMMAND}\` and update the pin table in tools/audit/u08-content-pins.ts. Historical ORIGINAL_* incident hashes are never repinned.`,
		].join("\n"),
	);
}

if (import.meta.main) {
	const content = snapshotContent();
	if (process.argv.slice(2).includes("--print")) {
		const table = (entries: [string, string][]) =>
			entries
				.map(
					([path, digest]) =>
						`\t${JSON.stringify(path)}: ${JSON.stringify(digest)},`,
				)
				.join("\n");
		console.log(
			[
				"// INSTRUMENT_PINS",
				table(
					Object.keys(INSTRUMENT_PINS).map((path) => [
						path,
						content.files.get(path) ?? "absent",
					]),
				),
				"// RENDER_TREE_PINS",
				table(
					Object.keys(RENDER_TREE_PINS).map((root) => [
						root,
						treeDigest(content, root),
					]),
				),
				"// RENDER_FILE_PINS",
				table(
					Object.keys(RENDER_FILE_PINS).map((path) => [
						path,
						content.files.get(path) ?? "absent",
					]),
				),
			].join("\n"),
		);
	} else {
		try {
			assertPinnedContent(content);
			console.log("U08 content identity matches the pinned baseline");
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
