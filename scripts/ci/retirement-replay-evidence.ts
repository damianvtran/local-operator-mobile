/** Fixed sensitive one-day export. NEVER enumerate/copy the private root:
 * bearer env, xctestrun, identity JSON, raw logs and xcresult stay private. */
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type CaptureResult, validatePng } from "./auth-retirement-capture.ts";
import {
	type Deadline,
	type Observation,
	ReplayRefused,
	validateObservation,
} from "./retirement-replay-core.ts";
import {
	coarseCause,
	type PhaseRecord,
	REPLAY_PHASES,
	type ReplayPhase,
} from "./retirement-replay-lifecycle.ts";
import {
	type RunnerFailure,
	safeRunnerFailure,
} from "./retirement-replay-runner-tail.ts";
export const MAX_REPLAY_EVIDENCE_BYTES = 16 * 1024 * 1024;
const JSON_RESERVE = 256 * 1024;
export interface ExportSummary {
	phase: "seed";
	mode: "observe-only" | "seed-replay";
	seedPersisted: boolean;
	acceptanceComplete: boolean;
	cause: string | null;
	runnerReportedTap: boolean;
	urlProgress: string;
	refused: Record<string, number>;
	observation: Observation | null;
	fingerprint: string | null;
	querySample: unknown;
	tapSample: unknown;
	captures: CaptureResult[];
	observations: unknown;
	secondary: string[];
	/** Diagnostic pre-openurl phase timings; never part of acceptance. */
	phases?: PhaseRecord[];
	failedPhase?: ReplayPhase | null;
	/** Closed XCTest runner failure record; see retirement-replay-runner-tail.ts. */
	runnerFailure?: RunnerFailure | null;
}
/** Keep only allowlisted phase names, finite non-negative integer timings and
 * known statuses, so the export can never carry a command line or path. */
function safePhases(value: unknown) {
	if (!Array.isArray(value)) return [];
	return (
		value
			.filter(
				(p) =>
					p &&
					typeof p === "object" &&
					(REPLAY_PHASES as readonly string[]).includes(p.name) &&
					Number.isSafeInteger(p.elapsedMs) &&
					p.elapsedMs >= 0 &&
					(p.status === "ok" || p.status === "failed"),
			)
			// Each phase runs at most once; keep the first record of any name.
			.filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)
			.slice(0, REPLAY_PHASES.length)
			.map((p) => ({ name: p.name, elapsedMs: p.elapsedMs, status: p.status }))
	);
}
export function safeSummary(summary: ExportSummary) {
	const hash = (v: unknown, length: number) =>
		typeof v === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(v)
			? v
			: "UNOBSERVED";
	const sample = (value: unknown) => {
		if (!value || typeof value !== "object") return null;
		const v = value as Record<string, unknown>;
		return {
			udid:
				typeof v.udid === "string" && /^[a-fA-F0-9-]{36}$/.test(v.udid)
					? v.udid
					: "UNOBSERVED",
			pid:
				typeof v.pid === "number" && Number.isSafeInteger(v.pid) && v.pid > 0
					? v.pid
					: "UNOBSERVED",
			source: hash(v.source, 40),
			bundle: hash(v.bundle, 64),
			hostSource: hash(v.hostSource, 40),
			labelSha256:
				typeof v.label === "string"
					? createHash("sha256").update(v.label).digest("hex")
					: "UNOBSERVED",
		};
	};
	const raw =
		summary.observations && typeof summary.observations === "object"
			? (summary.observations as Record<string, unknown>)
			: {};
	const observations: Record<string, unknown> = {};
	for (const name of [
		"schemeOpenSeenBySystem",
		"schemeOpenSeenByApp",
		"nativeIngressSeen",
		"nativeLogReadySeen",
		"jsCallbackEntrySeen",
		"jsLogReadySeen",
	])
		observations[name] =
			typeof raw[name] === "boolean" ? raw[name] : "UNOBSERVED";
	const reasons = new Set([
		"method-or-path",
		"nonce",
		"no-waiter",
		"body-cap",
		"json",
		"unknown-key",
		"phase-mismatch",
		"flavor-mismatch",
		"source-mismatch",
		"coarse-type",
		"stage-unknown",
		"progress-unknown",
		"request-count",
		"rpc-auth",
		"rpc-schema",
		"rpc-error",
		"stage",
		"challenge",
		"fingerprint",
		"prompt-mismatch",
		"closed",
		"deadline",
		"expired-window",
		"changed-process",
		"proof-process",
		"stale-sample",
		"sample",
		"intent",
		"lease",
		"inventory",
	]);
	const refused = Object.fromEntries(
		Object.entries(summary.refused).filter(
			([key, n]) => reasons.has(key) && Number.isSafeInteger(n) && n >= 0,
		),
	);
	return {
		scope: "retained-seed-only",
		fullRetirementProofComplete: false,
		phase: "seed",
		mode: summary.mode,
		seedPersisted: summary.seedPersisted === true,
		acceptanceComplete: summary.acceptanceComplete === true,
		cause:
			summary.cause === null
				? null
				: coarseCause(new ReplayRefused(summary.cause)),
		// WHERE it stopped: the first phase that threw, next to the cause.
		failedPhase:
			typeof summary.failedPhase === "string" &&
			(REPLAY_PHASES as readonly string[]).includes(summary.failedPhase)
				? summary.failedPhase
				: null,
		phases: safePhases(summary.phases),
		runnerFailure: safeRunnerFailure(summary.runnerFailure),
		runnerReportedTap: summary.runnerReportedTap === true,
		urlProgress:
			/^(admitted|none|refused:(identity|scheme|nonce|phase|callback|parse))$/.test(
				summary.urlProgress,
			)
				? summary.urlProgress
				: "none",
		refused,
		observation: summary.observation
			? validateObservation(summary.observation)
			: null,
		fingerprint: summary.fingerprint ? hash(summary.fingerprint, 64) : null,
		querySample: sample(summary.querySample),
		tapSample: sample(summary.tapSample),
		observations,
		secondary: summary.secondary.filter((v) =>
			[
				"capture",
				"log",
				"runner-stop",
				"native-stop",
				"server-close",
				"evidence",
				"cleanup",
				"phase-pending",
			].includes(v),
		),
		captures: summary.captures.map((c) => ({
			phase: "seed",
			point: ["after-openurl", "after-tap", "receipt-timeout"].includes(c.point)
				? c.point
				: "UNOBSERVED",
			status: ["observed", "timeout", "error"].includes(c.status)
				? c.status
				: "error",
			elapsedMs:
				Number.isFinite(c.elapsedMs) && c.elapsedMs >= 0
					? Math.round(c.elapsedMs)
					: 0,
			sha256: c.sha256 ? hash(c.sha256, 64) : null,
		})),
	};
}
function safeBytes(value: unknown) {
	const bytes = Buffer.from(JSON.stringify(value));
	if (bytes.length > JSON_RESERVE) throw new ReplayRefused("capture-evidence");
	return bytes;
}
export function exportWorkEvidence(
	root: string,
	summary: ExportSummary,
	deadline: Deadline,
) {
	deadline.cap(1);
	const directory = join(root, "evidence");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	if (summary.observation) validateObservation(summary.observation);
	let size = JSON_RESERVE;
	const exported: string[] = [];
	for (const [point, filename] of [
		["after-openurl", "before.png"],
		["after-tap", "after.png"],
	] as const) {
		deadline.cap(1);
		const frame = summary.captures.find(
			(value) =>
				value.point === point &&
				value.phase === "seed" &&
				value.status === "observed",
		);
		if (!frame || frame.relativePath !== `captures/seed-${point}.png`) continue;
		const source = join(root, frame.relativePath),
			stat = lstatSync(source);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
			throw new ReplayRefused("capture-evidence");
		const bytes = readFileSync(source);
		validatePng(bytes);
		if (
			createHash("sha256").update(bytes).digest("hex") !== frame.sha256 ||
			size + bytes.length > MAX_REPLAY_EVIDENCE_BYTES
		)
			throw new ReplayRefused("capture-evidence");
		deadline.cap(1);
		writeFileSync(join(directory, filename), bytes, {
			flag: "wx",
			mode: 0o600,
		});
		size += bytes.length;
		exported.push(filename);
	}
	deadline.cap(1);
	writeFileSync(
		join(directory, "seed-replay.json"),
		safeBytes({ ...safeSummary(summary), frames: exported }),
		{ flag: "wx", mode: 0o600 },
	);
	return { directory, frames: exported, framesComplete: exported.length === 2 };
}
/** Only tiny closure bookkeeping after work ends. The SAME cleanup allowance
 * bounds this append; no capture/log/native proof work is deferred here. */
export function finishCleanupEvidence(
	root: string,
	summary: ExportSummary,
	cleanup: unknown,
	deadline: Deadline,
) {
	deadline.cap(1);
	const directory = join(root, "evidence");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	// The work export may never have run (pre-create failure). Finalize both
	// receipts from one sanitized snapshot, retaining only its already-exported
	// frame names; cleanup must never recapture or rewrite the PNGs.
	const canonical = safeSummary(summary);
	const seedFile = join(directory, "seed-replay.json");
	const previous = existsSync(seedFile)
		? JSON.parse(readFileSync(seedFile, "utf8"))
		: null;
	const frames = Array.isArray(previous?.frames)
		? previous.frames.filter(
				(name: unknown) => name === "before.png" || name === "after.png",
			)
		: [];
	const seedBytes = safeBytes({ ...canonical, frames });
	const bytes = safeBytes({
		summary: canonical,
		cleanup:
			cleanup && typeof cleanup === "object"
				? {
						cleanupComplete:
							(cleanup as Record<string, unknown>).cleanupComplete === true,
						inventoryAbsent:
							typeof (cleanup as Record<string, unknown>).inventoryAbsent ===
							"boolean"
								? (cleanup as Record<string, unknown>).inventoryAbsent
								: "UNOBSERVED",
					}
				: { cleanupComplete: false, inventoryAbsent: "UNOBSERVED" },
	});
	const seedTemporary = join(directory, ".seed-summary.tmp");
	writeFileSync(seedTemporary, seedBytes, {
		flag: "wx",
		mode: 0o600,
		flush: true,
	});
	renameSync(seedTemporary, seedFile);
	const temporary = join(directory, ".cleanup-summary.tmp");
	writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600, flush: true });
	renameSync(temporary, join(directory, "cleanup.json"));
}
