import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { stageBDiagnosticText } from "../../src/testing/stage-b-draft-transport.ts";

export const STAGE_B_MEDIA_SAMPLE_AT_MS = 120_000;
export const STAGE_B_MEDIA_SAMPLE_CAP_SECONDS = 20;
export const STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT = 128 * 1024;
/** Omit overlong stack lines BEFORE the shared redactor: its JWT matcher can
 * be quadratic on an enormous unbroken symbol. Retain a visible omission and
 * cross-line credential redaction on the bounded text, never raw stack files. */
export function stageBMediaSampleText(raw: string): string {
	const bounded = raw
		.slice(0, STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT)
		.split("\n")
		.map((line) =>
			line.length > 1024 ? "[overlong diagnostic line omitted]" : line,
		)
		.join("\n");
	return stageBDiagnosticText(bounded).slice(
		0,
		STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT,
	);
}
export type MediaSampleRun = (
	name: string,
	command: string,
	args: string[],
	seconds: number,
	signal: AbortSignal,
) => Promise<string>;
const LABELS = {
	CoreSimulatorBridge: "com.apple.CoreSimulator.bridge",
	assetsd: "com.apple.assetsd",
} as const;
const PID = /^[1-9][0-9]*$/;
const LINES = /\r?\n/;
const WORDS = /\s+/;
const EXIT_STATUS = /^-?[0-9]+$/;
const PROCESS = /^\s*([0-9]+)\s+([0-9]+)\s+(.+?)\s*$/;
const OWNED_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const pid = (text: string): number => {
	if (
		!PID.test(text) ||
		!Number.isSafeInteger(Number(text)) ||
		Number(text) <= 1 ||
		Number(text) > 2147483647
	)
		throw new Error("owned service PID unavailable");
	return Number(text);
};
/** Never use a global name/pgrep match. Both services must occur exactly once
 * in THIS simulator's launchctl namespace; '-' (on-demand) is not a live PID. */
export function stageBOwnedMediaPids(
	services: string,
): Record<keyof typeof LABELS, number> {
	const result = {} as Record<keyof typeof LABELS, number>;
	for (const name of Object.keys(LABELS) as (keyof typeof LABELS)[]) {
		const matches = services
			.split(LINES)
			.map((line) => line.trim().split(WORDS))
			.filter((fields) => fields.at(-1) === LABELS[name]);
		const fields = matches[0];
		if (
			matches.length !== 1 ||
			!fields ||
			fields.length !== 3 ||
			!EXIT_STATUS.test(fields[1] ?? "")
		)
			throw new Error("ambiguous owned media service");
		result[name] = pid(fields[0] ?? "");
	}
	if (result.CoreSimulatorBridge === result.assetsd)
		throw new Error("ambiguous owned media PIDs");
	return result;
}
/** Fresh host process identity must agree with the simulator namespace: the
 * exact executables must be direct children of its own launchd_sim, not a
 * recycled PID, another simulator, or an arbitrary operator process. */
export function assertStageBMediaParents(
	text: string,
	manager: number,
	pids: Record<keyof typeof LABELS, number>,
): void {
	const expected = new Map([
		[manager, "launchd_sim"],
		[pids.CoreSimulatorBridge, "CoreSimulatorBridge"],
		[pids.assetsd, "assetsd"],
	]);
	if (expected.size !== 3) throw new Error("ambiguous simulator manager PID");
	const seen = new Set<number>();
	for (const line of text.trim().split(LINES)) {
		const match = PROCESS.exec(line);
		if (!match) throw new Error("owned process identity unavailable");
		const child = pid(match[1] ?? ""),
			parent = Number(match[2]);
		if (
			seen.has(child) ||
			!expected.has(child) ||
			basename(match[3] ?? "") !== expected.get(child) ||
			(child !== manager && parent !== manager)
		)
			throw new Error("owned process identity mismatch");
		seen.add(child);
	}
	if (seen.size !== 3) throw new Error("owned process identity incomplete");
}

/** 42018221135 reached an assetsd PhotoKit insertion but never recorded its
 * completion. This is ONE diagnostic attempt, not import readiness/retry.
 * Arm at 120s inside the existing 240s import, cancel immediately on ANY import
 * settlement, and never await diagnostics before cleanup. Every spawned probe
 * is abortable/bounded; the coordinator reaps its exact child process group.
 * sample(1) defaults to a raw /tmp file: -file /dev/stdout explicitly prevents
 * that. Only centrally bounded/redacted logs and a redacted sidecar persist. */
export async function stageBImportWithSampling<T>(
	importMedia: () => Promise<T>,
	run: MediaSampleRun,
	owned: string,
	output: string,
	evidence: Record<string, unknown>,
): Promise<T> {
	const state: Record<string, unknown> = {
		status: "armed",
		atMs: STAGE_B_MEDIA_SAMPLE_AT_MS,
		capSeconds: STAGE_B_MEDIA_SAMPLE_CAP_SECONDS,
		maxOutput: STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT,
	};
	evidence.pendingSampling = state;
	let pending = true;
	const controller = new AbortController();
	const ensurePending = () => {
		if (!pending || controller.signal.aborted)
			throw new Error("media sampling cancelled");
	};
	const probe = (
		name: string,
		command: string,
		args: string[],
		seconds = 15,
	) => {
		ensurePending();
		return run(
			`media-pending-${name}`,
			command,
			args,
			seconds,
			controller.signal,
		);
	};
	const timer = setTimeout(() => {
		if (!pending) return;
		void (async () => {
			try {
				state.status = "checking-owned-pids";
				if (!OWNED_ID.test(owned))
					throw new Error("owned simulator ID invalid");
				const services = await probe("services", "xcrun", [
					"simctl",
					"spawn",
					owned,
					"launchctl",
					"list",
				]);
				const pids = stageBOwnedMediaPids(services);
				const manager = pid(
					(
						await probe("manager", "xcrun", [
							"simctl",
							"spawn",
							owned,
							"launchctl",
							"managerpid",
						])
					).trim(),
				);
				const processes = await probe(
					"identity",
					"/bin/ps",
					[
						"-p",
						[manager, pids.CoreSimulatorBridge, pids.assetsd].join(","),
						"-o",
						"pid=,ppid=,comm=",
					],
					10,
				);
				assertStageBMediaParents(processes, manager, pids);
				ensurePending();
				state.pids = pids;
				state.status = "sampling";
				const samples: Record<string, string> = {};
				state.samples = samples;
				await Promise.all(
					(Object.keys(LABELS) as (keyof typeof LABELS)[]).map(async (name) => {
						try {
							const text = await probe(
								`${name}-stack`,
								"/usr/bin/sample",
								[String(pids[name]), "3", "1", "-file", "/dev/stdout"],
								STAGE_B_MEDIA_SAMPLE_CAP_SECONDS,
							);
							ensurePending();
							writeFileSync(
								join(output, `media-pending-${name}-stack.txt`),
								stageBMediaSampleText(text),
							);
							samples[name] = "captured";
						} catch (error) {
							samples[name] = controller.signal.aborted
								? "cancelled"
								: stageBDiagnosticText(String(error)).slice(0, 300);
						}
					}),
				);
				if (pending) state.status = "finished";
			} catch (error) {
				if (pending) {
					state.status = "unavailable";
					state.error = stageBDiagnosticText(String(error)).slice(0, 300);
				}
			}
		})();
	}, STAGE_B_MEDIA_SAMPLE_AT_MS);
	try {
		return await importMedia();
	} finally {
		pending = false;
		clearTimeout(timer);
		controller.abort();
		if (state.status === "armed") state.status = "not-needed";
		else if (state.status !== "finished" && state.status !== "unavailable")
			state.status = "cancelled";
	}
}
