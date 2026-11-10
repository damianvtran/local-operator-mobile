#!/usr/bin/env node
/**
 * Provenance gate for an ALREADY-BUILT `ios-simulator` artifact that a targeted
 * native proof is about to install (today: `chrome-ios-proof` in e2e.yml).
 *
 *     node scripts/ci/native-artifact-provenance.ts inputs  <flags>   # shape only
 *     node scripts/ci/native-artifact-provenance.ts verify  <flags>   # + API metadata
 *
 * WHY THIS EXISTS. Chrome-proof run 42789156345 was dispatched on workflow head
 * b67f4f54 to prove PR #216, and passed its digest check — yet it installed
 * build 348 from run 41506698136, an unrelated `feat/i18n-project-create` build
 * of 91a3cbca (Nov 2). The run id and digest it used were the workflow inputs'
 * DEFAULTS, pinned for `projects-create-ios-proof`, and nothing related the
 * artifact to the revision under proof. A DIGEST AUTHENTICATES BYTES, NOT A
 * REVISION: it proves the zip is the one somebody named, and says nothing about
 * which commit those bytes were compiled from. A stale default with its own
 * matching digest passes a digest check perfectly. So this gate requires the
 * revision to be named explicitly (`native_source_sha`) and checks it against
 * the GitHub run and artifact metadata BEFORE a macOS runner or simulator is
 * spent on the wrong binary.
 *
 * WHAT "COMPILED FROM" CAN AND CANNOT MEAN HERE. ios.yml's checkout takes no
 * `ref`, so it compiles `GITHUB_SHA`: for `push` and `workflow_dispatch` runs
 * that is the run's `head_sha` exactly; for `pull_request` runs it is the
 * synthetic `refs/pull/<n>/merge` commit (head merged into the base AT RUN
 * TIME), whose SHA the runs API does not expose. The artifact carries no source
 * manifest of its own, so this gate reuses what GitHub already records — the
 * run's `head_sha`/`event`/`path` and the artifact's own `workflow_run` block —
 * and the receipt names the merge-ref case as such instead of claiming
 * literal-head provenance (the same honesty docs/ci.md asks of the
 * project-create proof's caveat).
 *
 * CONSTRAINTS. Pure and credential-free: the workflow fetches the metadata with
 * its token in a separate step and hands this script files. Nothing here
 * downloads, prints a token, or reads the network, so the negative controls in
 * `native-artifact-provenance.test.ts` run the real CLI on captured metadata.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** The workflow whose `ios-simulator` artifact is a real simulator build. Any
 * other workflow uploading an artifact of the same name is not one. */
export const BUILD_WORKFLOW_PATH = ".github/workflows/ios.yml";
const COMPILED_HEAD_EVENTS = new Set(["push", "workflow_dispatch"]);

const DIGITS = /^[0-9]+$/;
const NAME = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export type Role = "after" | "before";

/** What the dispatcher asked for. Every field is required: an empty one means
 * the workflow would fall back to a default, which is exactly the failure. */
export type Intended = {
	runId: string;
	artifactName: string;
	sha256: string;
	sourceSha: string;
};

export type RunMeta = {
	id?: number;
	path?: string;
	event?: string;
	status?: string;
	conclusion?: string | null;
	head_sha?: string;
	head_branch?: string | null;
	run_attempt?: number;
	repository?: { full_name?: string };
	head_repository?: { full_name?: string } | null;
	pull_requests?: { number?: number; head?: { sha?: string } }[];
};

export type ArtifactMeta = {
	id?: number;
	name?: string;
	expired?: boolean;
	digest?: string | null;
	workflow_run?: { id?: number; head_sha?: string } | null;
};

export type Compiled =
	| { kind: "head"; sha: string }
	| {
			kind: "pull_request-merge";
			headSha: string;
			ref: string;
			note: string;
	  };

export type Provenance = {
	role: Role;
	intended: Intended;
	actual: {
		runId: string;
		workflowPath: string;
		event: string;
		headBranch: string | null;
		headSha: string;
		runAttempt: number | null;
		conclusion: string | null;
		artifactId: number;
		artifactDigest: string;
		compiled: Compiled;
	};
};

export class ProvenanceError extends Error {}
const fail = (message: string): never => {
	throw new ProvenanceError(message);
};

/** Shape check of the explicit inputs, before any metadata is fetched. */
export function checkIntended(
	role: Role,
	intended: Partial<Intended>,
): Intended {
	const input = role === "after" ? "native" : "base";
	const {
		runId = "",
		artifactName = "",
		sha256 = "",
		sourceSha = "",
	} = intended;
	if (!runId || !sha256 || !sourceSha)
		fail(
			`${role} artifact: ${input}_run_id, ${input}_artifact_sha256 and ${input}_source_sha must all be given explicitly (got run=${runId || "<empty>"}, sha256=${sha256 || "<empty>"}, source=${sourceSha || "<empty>"}); a digest alone authenticates bytes, not the revision they were built from`,
		);
	if (!DIGITS.test(runId)) fail(`${role} artifact: run id must be digits`);
	if (!NAME.test(artifactName)) fail(`${role} artifact: bad artifact name`);
	if (!SHA256.test(sha256))
		fail(`${role} artifact: sha256 must be 64 lowercase hex characters`);
	if (!COMMIT.test(sourceSha))
		fail(
			`${role} artifact: source sha must be a full 40-character lowercase commit SHA`,
		);
	return { runId, artifactName, sha256, sourceSha };
}

/** A before/after pair must be two different builds of two different
 * revisions; the same build twice would make every "change" a no-op that
 * still looks like a pair. A half-specified before build is refused rather
 * than silently dropped. */
export function checkPair(
	after: Intended,
	before: Partial<Intended> | undefined,
): Intended | undefined {
	if (!before || (!before.runId && !before.sha256 && !before.sourceSha))
		return undefined;
	const base = checkIntended("before", before);
	if (base.runId === after.runId)
		fail("before and after artifacts name the same run");
	if (base.sha256 === after.sha256)
		fail("before and after artifacts have the same digest");
	if (base.sourceSha === after.sourceSha)
		fail("before and after artifacts name the same source revision");
	return base;
}

export function verifyArtifact(options: {
	role: Role;
	repository: string;
	intended: Intended;
	run: RunMeta;
	artifacts: { artifacts?: ArtifactMeta[] };
}): Provenance {
	const { role, repository, intended, run } = options;
	const where = `${role} artifact (run ${intended.runId})`;
	if (String(run.id ?? "") !== intended.runId)
		fail(`${where}: metadata is for run ${run.id ?? "<missing>"}`);
	if (run.repository?.full_name !== repository)
		fail(
			`${where}: run belongs to ${run.repository?.full_name ?? "<missing>"}, not ${repository}`,
		);
	// Same-repository builds only: a fork's head is code this repository never
	// reviewed, and its checkout resolves against a repository we do not pin.
	if (run.head_repository?.full_name !== repository)
		fail(
			`${where}: run was built from ${run.head_repository?.full_name ?? "<missing>"}, not ${repository}`,
		);
	if (run.path !== BUILD_WORKFLOW_PATH)
		fail(
			`${where}: built by ${run.path ?? "<missing>"}, not ${BUILD_WORKFLOW_PATH}`,
		);
	if (run.status !== "completed" || run.conclusion !== "success")
		fail(
			`${where}: build run is ${run.status ?? "?"}/${run.conclusion ?? "?"}, not completed/success`,
		);
	if (!run.head_sha || !COMMIT.test(run.head_sha))
		fail(
			`${where}: run metadata carries no head_sha, so the compiled revision is unknown`,
		);
	if (run.head_sha !== intended.sourceSha)
		fail(
			`${where}: STALE OR UNRELATED BUILD — run built ${run.head_branch ?? "<unknown branch>"}@${run.head_sha}, expected source ${intended.sourceSha}`,
		);
	const live = (options.artifacts.artifacts ?? []).filter(
		(a) => a.name === intended.artifactName && a.expired === false,
	);
	if (live.length !== 1)
		fail(
			`${where}: expected exactly one live artifact named ${intended.artifactName}, found ${live.length}`,
		);
	const artifact = live[0] as ArtifactMeta;
	if (String(artifact.workflow_run?.id ?? "") !== intended.runId)
		fail(
			`${where}: artifact records run ${artifact.workflow_run?.id ?? "<missing>"}`,
		);
	if (artifact.workflow_run?.head_sha !== intended.sourceSha)
		fail(
			`${where}: artifact records source ${artifact.workflow_run?.head_sha ?? "<missing>"}, expected ${intended.sourceSha}`,
		);
	if (artifact.digest !== `sha256:${intended.sha256}`)
		fail(
			`${where}: artifact digest ${artifact.digest ?? "<missing>"} differs from sha256:${intended.sha256}`,
		);
	if (typeof artifact.id !== "number") fail(`${where}: artifact has no id`);
	// Every field below was checked above; `fail` returning `never` from a const
	// arrow does not narrow, so the checked values are named once here.
	const headSha = run.head_sha as string;
	const event = run.event ?? "";
	let compiled: Compiled;
	if (COMPILED_HEAD_EVENTS.has(event))
		compiled = { kind: "head", sha: headSha };
	else if (event === "pull_request") {
		const pr = (run.pull_requests ?? []).find(
			(p) => p.head?.sha === run.head_sha,
		);
		compiled = {
			kind: "pull_request-merge",
			headSha,
			ref: pr?.number ? `refs/pull/${pr.number}/merge` : "refs/pull/<n>/merge",
			note: "ios.yml compiled the pull_request merge ref: this head merged into the base at run time; the merge commit SHA is not in the runs API",
		};
	} else
		return fail(
			`${where}: build event ${event || "<missing>"} has no known compiled-source relation`,
		);
	return {
		role,
		intended,
		actual: {
			runId: intended.runId,
			workflowPath: BUILD_WORKFLOW_PATH,
			event,
			headBranch: run.head_branch ?? null,
			headSha,
			runAttempt: run.run_attempt ?? null,
			conclusion: run.conclusion ?? null,
			artifactId: artifact.id as number,
			artifactDigest: `sha256:${intended.sha256}`,
			compiled,
		},
	};
}

const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint === undefined) {
	console.error(
		'::error::this Node does not support `import.meta.main` (needs >= 24.2), so this gate would exit 0 without judging anything. The workflows pin `NODE_VERSION: "24"`.',
	);
	process.exit(1);
}

if (isEntryPoint) {
	const arg = (name: string): string => {
		const i = process.argv.indexOf(`--${name}`);
		return i === -1 ? "" : (process.argv[i + 1] ?? "");
	};
	const intendedOf = (prefix: string, name: string): Partial<Intended> => ({
		runId: arg(`${prefix}-run-id`),
		artifactName: name,
		sha256: arg(`${prefix}-sha256`),
		sourceSha: arg(`${prefix}-source-sha`),
	});
	const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
	try {
		const command = process.argv[2];
		if (command !== "inputs" && command !== "verify")
			fail(
				"usage: native-artifact-provenance.ts inputs|verify --after-run-id … ",
			);
		const after = checkIntended(
			"after",
			intendedOf("after", arg("after-name")),
		);
		const before = checkPair(
			after,
			intendedOf("before", arg("before-name") || "ios-simulator"),
		);
		if (command === "inputs") {
			console.log(
				`inputs ok: after run ${after.runId} @ ${after.sourceSha}${before ? `; before run ${before.runId} @ ${before.sourceSha}` : "; no before build"}`,
			);
		} else {
			const repository = arg("repo") || fail("--repo is required");
			const result: Provenance[] = [
				verifyArtifact({
					role: "after",
					repository,
					intended: after,
					run: readJson(arg("after-run") || fail("--after-run is required")),
					artifacts: readJson(
						arg("after-artifacts") || fail("--after-artifacts is required"),
					),
				}),
			];
			if (before)
				result.push(
					verifyArtifact({
						role: "before",
						repository,
						intended: before,
						run: readJson(
							arg("before-run") || fail("--before-run is required"),
						),
						artifacts: readJson(
							arg("before-artifacts") || fail("--before-artifacts is required"),
						),
					}),
				);
			const out = arg("out");
			if (out) writeFileSync(out, `${JSON.stringify(result)}\n`);
			for (const p of result)
				console.log(
					`provenance ok: ${p.role} run ${p.actual.runId} ${p.actual.event} ${p.actual.headBranch}@${p.actual.headSha} artifact ${p.actual.artifactId} (${p.actual.compiled.kind})`,
				);
		}
	} catch (error) {
		console.error(
			`::error::${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}
