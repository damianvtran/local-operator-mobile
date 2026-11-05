/** Actual XCTest launch diagnostic, never a replay or acceptance lane. The
 * compiled runner source is fixed independently of this reviewed controller.
 * Keep the original replay's source-equality and app-authority guards intact. */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createFromIntent,
	prepareCreation,
	type Run,
} from "./auth-retirement-simulator.ts";
import { Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import {
	boundedWait,
	cleanupBudget,
	PhaseLog,
	type RunnerHandle,
} from "./retirement-replay-lifecycle.ts";
import { NativeScope, signalBootWindow } from "./retirement-replay-native.ts";
import { safeRunnerFailure } from "./retirement-replay-runner-tail.ts";
import {
	type HostReceipt,
	LaunchOnlyTransport,
} from "./retirement-runner-launch-only-transport.ts";
import {
	cleanupReplay,
	launchRunner,
	runBootWindow,
} from "./retirement-ui-replay.ts";

export const COMPILED_RUNNER_SOURCE =
	"4fff5e12296c3b6bd4ce3663988b9da8ca383227";
/**
 * One accepted 300s work window, rebalanced after run 42095351919 stopped at a
 * 30s ownership clip.
 *
 * The sibling iOS lane on the SAME runner image and head runs the identical
 * `xcrun simctl list devices available --json` inside its "Resolve the
 * simulator" step, which measured 32s (18:17:55→18:18:27Z, run 42080472137). So
 * the first CoreSimulator interaction routinely exceeds 30s on this image, and
 * the old per-command clip was below the observed cost of the command itself.
 * Acquisition and prepare released headroom: measured 2065ms and 2393ms here.
 * Sum of ceilings + the 10s refresh stays inside 300s (45+15+30+120+40+30+10).
 */
export const LAUNCH_LIMITS = Object.freeze({
	work: 300000,
	acquisition: 45000,
	toolchain: 15000,
	prepare: 30000,
	ownership: 120000,
	/** Per-command ceiling inside ownership; the cold simctl call may take 32s. */
	ownershipCommand: 60000,
	ready: 40000,
	postDenial: 30000,
	boot: 300000,
	cleanup: 120000,
});
/** Closed substep names: a receipt can only ever name one of these. */
export type StepName = "inventory" | "create";
export const STEP_NAMES: readonly StepName[] = ["inventory", "create"];
/** Closed substep failure classes; no free text from a child ever lands here. */
export type StepClass = "timeout" | "refused" | "mismatch";
export interface StepRecord {
	name: StepName;
	elapsedMs: number;
	ok: boolean;
	class?: StepClass;
}
export interface StageRecord {
	name: string;
	elapsedMs: number;
	ok: boolean;
	steps?: StepRecord[];
}
export type Step = <T>(name: StepName, action: () => Promise<T>) => Promise<T>;

/**
 * Refusal codes that mean OUR clock spent the budget, not that a tool declined.
 *
 * A closed Set of string literals rather than a regex literal: the `scripts/`
 * browser-global scan strips comments and string literals but not regex
 * literals, and the Deadline's `insufficient-window` code would otherwise be
 * read as a bare browser global in this file.
 */
const TIMEOUT_REFUSALS: ReadonlySet<string> = new Set([
	"command-timeout",
	"deadline",
	"insufficient-window",
]);

/**
 * Classify a substep failure without exporting anything the child said.
 *
 * `ReplayRefused` is our own closed refusal vocabulary; a created-device
 * mismatch is raised as a plain Error by `createFromIntent`. Anything else is
 * either a command deadline (the executor's own timeout) or a refusal we cannot
 * name — both fail closed to `timeout`/`refused` rather than leaking a message.
 */
export function closedStepClass(error: unknown): StepClass {
	// ReplayRefused carries a CLOSED code and always the same message, so the
	// message can never say "timeout". The executor signals a spent command clip
	// as code `command-timeout` (retirement-replay-native.ts) and a spent stage
	// budget as the Deadline's `deadline` and `insufficient-window` codes
	// (retirement-replay-core.ts); those ARE our clock, so they must not be
	// recorded as a refusal by xcrun.
	if (error instanceof ReplayRefused)
		return TIMEOUT_REFUSALS.has(error.code) ? "timeout" : "refused";
	const message = error instanceof Error ? error.message : "";
	return /timeout|timed out|deadline/i.test(message) ? "timeout" : "mismatch";
}

export type StopOutcome =
	| "not-launched"
	| "early-exit"
	| "expected-test-failure"
	| "unexpected-zero"
	| "unrelated-failure"
	| "forced-stop"
	| "runner-start-timeout"
	| "post-denial-timeout"
	| "protocol-failure";

/** Fake children exercise this bookkeeping only; production's sole producer is
 * the inbound HTTP listener. Sending denial does not prove its consumption. */
export async function observeLaunch(
	transport: LaunchOnlyTransport,
	runner: RunnerHandle,
	deadline: Deadline,
	limits: { ready: number; postDenial: number } = LAUNCH_LIMITS,
) {
	const exit = runner.completion.then(
		() => "zero" as const,
		() => "nonzero" as const,
	);
	let outcome: StopOutcome = "runner-start-timeout";
	try {
		const boundary = await boundedWait(
			Promise.race([
				transport.denied.promise.then(() => "denied" as const),
				transport.failed.promise.then(() => "protocol" as const),
				exit,
			]),
			deadline,
			limits.ready,
		);
		if (boundary === "protocol") return "protocol-failure";
		if (boundary !== "denied") return "early-exit";
		outcome = "post-denial-timeout";
		const ended = await boundedWait(
			Promise.race([
				exit,
				transport.failed.promise.then(() => "protocol" as const),
			]),
			deadline,
			limits.postDenial,
		);
		if (ended === "protocol") return "protocol-failure";
		if (ended === "zero") return "unexpected-zero";
		const record = safeRunnerFailure(runner.failureRecord?.(true));
		outcome =
			record?.exitCode !== null &&
			record?.errorClass === "test_failed" &&
			record.failingTest ===
				"RetirementSystemAlert.RetainedReplayTests.testSingleSeedReplay" &&
			record.failureCount > 0
				? "expected-test-failure"
				: "unrelated-failure";
	} catch {
		/* The caller must reap and record a forced stop, never a pass. */
	}
	return outcome;
}

/** Bounded shutdown in the exact-owned order: stop the listener, then the owned
 * process groups, then only the journaled simulator. A failed reap is never
 * suppressed; `cleanupReplay` re-verifies ownership and inventory absence. */
async function reap(
	receipt: {
		failure: string;
		protocol: HostReceipt;
		stopOutcome: StopOutcome;
		cleanupComplete: boolean;
		inventoryAbsent: boolean;
		runnerFailure: unknown;
	},
	owned: {
		root: string;
		runner?: RunnerHandle;
		work: NativeScope;
		boot?: NativeScope;
		listener: LaunchOnlyTransport;
	},
) {
	receipt.runnerFailure = safeRunnerFailure(
		owned.runner?.failureRecord?.(true),
	);
	// One persisted 120s allowance shared with the always() fallback step; this
	// never renews it.
	const budget = cleanupBudget(owned.root);
	try {
		await owned.listener.close();
	} catch {
		receipt.failure = "cleanup";
	}
	const stops = await Promise.allSettled([
		owned.runner?.stop(budget),
		owned.work.stop(budget),
		owned.boot?.stop(budget),
	]);
	if (stops.some((stopped) => stopped.status === "rejected"))
		receipt.failure = "cleanup";
	receipt.protocol = owned.listener.receipt();
	if (receipt.protocol.protocolFailed) {
		receipt.stopOutcome = "protocol-failure";
		if (receipt.failure === "none") receipt.failure = "launch";
	}
	const cleanup = await cleanupReplay(owned.root);
	receipt.cleanupComplete =
		cleanup.cleanupComplete && receipt.failure !== "cleanup";
	receipt.inventoryAbsent = cleanup.inventoryAbsent === true;
	if (!receipt.cleanupComplete) receipt.failure = "cleanup";
}

export async function runLaunchOnly(root: string) {
	if (
		!process.env.LO_REPLAY_SUPERVISOR_FD ||
		!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
	)
		throw new ReplayRefused("inputs");
	const clock = JSON.parse(readFileSync(join(root, "work-clock.json"), "utf8"));
	const elapsed = Date.now() - clock.jobStart * 1000;
	if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= LAUNCH_LIMITS.work)
		throw new ReplayRefused("deadline");
	const deadline = new Deadline(LAUNCH_LIMITS.work - elapsed);
	const work = new NativeScope(deadline);
	// Private credentials are never exposed by receipt() or the public exporter.
	const session = randomBytes(24).toString("hex"),
		bearer = randomBytes(32).toString("hex");
	const listener = new LaunchOnlyTransport({ session, bearer });
	const receipt = {
		schemaVersion: 1,
		scope: "runner-launch-only-diagnostic",
		compiledRunnerSource: COMPILED_RUNNER_SOURCE,
		controllerSource: process.env.GITHUB_SHA ?? "",
		sourceMatched: false,
		versionMatched: false,
		sdkMatched: false,
		staticMatched: false,
		testExecutionAttempted: false,
		appBuildAttempted: false,
		mobileAcceptanceComplete: false,
		stages: [
			{ name: "acquisition", elapsedMs: clock.acquisitionMs, ok: true },
		] as StageRecord[],
		protocol: listener.receipt(),
		runnerFailure: null as ReturnType<typeof safeRunnerFailure>,
		stopOutcome: "not-launched" as StopOutcome,
		cleanupComplete: false,
		inventoryAbsent: false,
		failure: "none" as "none" | "preflight" | "launch" | "cleanup",
	};
	let runner: RunnerHandle | undefined;
	// Recorded here and pushed only after reap: a protocol failure discovered during
	// cleanup must not leave an earlier `ok: true` beside stopOutcome=protocol-failure.
	let observationStarted: number | undefined;
	let boot: NativeScope | undefined;
	const currentRun: Run = work.run;
	async function stage<T>(
		name: string,
		cap: number,
		action: (run: Run, step: Step) => Promise<T>,
		commandCap = 30000,
	): Promise<T> {
		const began = performance.now();
		const stageDeadline = new Deadline(deadline.cap(cap));
		const run: Run = (exe, args, limit = commandCap, before) =>
			currentRun(
				exe,
				args,
				stageDeadline.cap(Math.min(limit, commandCap)),
				before,
			);
		// Substep records make a preflight stop self-describing: run 42095351919
		// reported only `ownership ok:false 30009ms`, which named neither the
		// command nor why it stopped, so the cause could not be read from the
		// artifact. Names are a closed set; the class is a closed enum.
		const steps: StepRecord[] = [];
		const step: Step = (stepName, action) => {
			const start = performance.now();
			// Wrapped: `run` can throw synchronously (Deadline.cap -> ReplayRefused),
			// and a silent hole in "every failure names a substep" would defeat the
			// point of the records.
			return Promise.resolve()
				.then(action)
				.then(
					(value) => {
						steps.push({
							name: stepName,
							elapsedMs: Math.round(performance.now() - start),
							ok: true,
						});
						return value;
					},
					(error: unknown) => {
						steps.push({
							name: stepName,
							elapsedMs: Math.round(performance.now() - start),
							ok: false,
							class: closedStepClass(error),
						});
						throw error;
					},
				);
		};
		try {
			const result = await action(run, step);
			stageDeadline.cap(1);
			receipt.stages.push({
				name,
				elapsedMs: Math.round(performance.now() - began),
				ok: true,
				steps,
			});
			return result;
		} catch (error) {
			receipt.stages.push({
				name,
				elapsedMs: Math.round(performance.now() - began),
				ok: false,
				steps,
			});
			throw error;
		}
	}
	try {
		if (
			!process.env.LO_REPLAY_SUPERVISOR_FD ||
			!/^[a-f0-9]{40}$/.test(receipt.controllerSource)
		)
			throw new ReplayRefused("inputs");
		await stage("toolchain", LAUNCH_LIMITS.toolchain, async (run) => {
			if (
				(await run("git", ["rev-parse", "HEAD"])) !== receipt.controllerSource
			)
				throw new ReplayRefused("runner-source");
			receipt.sourceMatched = true;
			if (
				(await run("/usr/bin/xcodebuild", ["-version"])) !==
				"Xcode 26.6\nBuild version 17F113"
			)
				throw new ReplayRefused("inputs");
			receipt.versionMatched = true;
			if (
				(await run("xcrun", [
					"--sdk",
					"iphonesimulator",
					"--show-sdk-version",
				])) !== "26.5"
			)
				throw new ReplayRefused("inputs");
			receipt.sdkMatched = true;
		});
		const endpoint = await listener.listen();
		const environment = join(root, "launch-environment.json");
		writeFileSync(
			environment,
			JSON.stringify({
				LO_REPLAY_MODE: "observe-only",
				LO_REPLAY_CONTROL: endpoint,
				LO_REPLAY_SESSION: session,
				LO_REPLAY_BEARER: bearer,
				LO_REPLAY_RUNNER_SOURCE: COMPILED_RUNNER_SOURCE,
			}),
			{ mode: 0o600, flag: "wx" },
		);
		await stage("static-prepare", LAUNCH_LIMITS.prepare, async () => {
			// This single command gets the full aggregate static/prepare cap.
			await work.run(
				"/usr/bin/python3",
				[
					join(import.meta.dirname, "retirement-runner-launch-only-inputs.py"),
					"prepare",
					root,
					environment,
				],
				deadline.cap(LAUNCH_LIMITS.prepare),
			);
			receipt.staticMatched = true;
		});
		const lease = await stage(
			"ownership",
			LAUNCH_LIMITS.ownership,
			async (run, step) => {
				const inventory = JSON.parse(
					await step("inventory", () =>
						run("xcrun", ["simctl", "list", "devices", "available", "--json"]),
					),
				);
				const templates = Object.entries(
					inventory.devices as Record<
						string,
						Array<{ name: string; udid: string; deviceTypeIdentifier: string }>
					>,
				).flatMap(([runtime, devices]) =>
					devices.map((d) => ({ ...d, runtime })),
				);
				const template = templates.find(
					(d) =>
						d.name === "iPhone 17" &&
						d.deviceTypeIdentifier ===
							"com.apple.CoreSimulator.SimDeviceType.iPhone-17",
				);
				if (!template) throw new ReplayRefused("template");
				const intent = prepareCreation(root, {
					nonce: randomBytes(16).toString("hex"),
					runId: process.env.GITHUB_RUN_ID ?? "",
					hostPid: process.pid,
					runtime: template.runtime,
					deviceType: template.deviceTypeIdentifier,
					templateUdid: template.udid,
				});
				return step("create", () => createFromIntent(root, intent, run));
			},
			LAUNCH_LIMITS.ownershipCommand,
		);
		const bootPhases = new PhaseLog();
		try {
			await runBootWindow({
				deadline,
				udid: lease.udid,
				phases: bootPhases,
				open: () => {
					boot = new NativeScope(new Deadline(LAUNCH_LIMITS.boot));
					return boot;
				},
				signal: signalBootWindow,
			});
		} finally {
			receipt.stages.push(
				...bootPhases.phases.map((phase) => ({
					name: phase.name,
					elapsedMs: phase.elapsedMs,
					ok: phase.status === "ok",
				})),
			);
		}
		await work.run(
			"/usr/bin/python3",
			[
				join(import.meta.dirname, "retirement-runner-launch-only-inputs.py"),
				"refresh",
				root,
			],
			deadline.cap(10000),
		);
		receipt.testExecutionAttempted = true;
		// SIGKILL bypasses finally: persist the attempted boundary before spawn,
		// so fallback cannot rewrite an attempted XCTest command as NO-TEST.
		writeFileSync(join(root, "launch-receipt.json"), JSON.stringify(receipt), {
			mode: 0o600,
			flush: true,
		});
		runner = launchRunner(
			join(root, "runner/Products/private.xctestrun"),
			lease.udid,
			root,
			work,
		);
		observationStarted = performance.now();
		receipt.stopOutcome = await observeLaunch(listener, runner, deadline);
		if (receipt.stopOutcome !== "expected-test-failure")
			receipt.failure = "launch";
	} catch {
		// No runner handle means no command existed, so the attempted-XCTest flag
		// stays false; a handle that failed to spawn is still an attempt.
		receipt.testExecutionAttempted &&= runner !== undefined;
		receipt.failure = receipt.testExecutionAttempted ? "launch" : "preflight";
	} finally {
		try {
			await reap(receipt, { root, runner, work, boot, listener });
		} catch {
			// Unknown reap state is explicit failure; the supervisor's always()
			// step owns the remaining persisted cleanup allowance.
			receipt.failure = "cleanup";
		}
		if (observationStarted !== undefined)
			receipt.stages.push({
				name: "runner-observation",
				elapsedMs: Math.round(performance.now() - observationStarted),
				ok:
					receipt.stopOutcome === "expected-test-failure" &&
					receipt.failure === "none",
			});
		try {
			// Best-effort second write: a SIGKILL bypasses this, which is why the
			// attempted boundary was persisted before the spawn.
			writeFileSync(
				join(root, "launch-receipt.json"),
				JSON.stringify(receipt),
				{
					mode: 0o600,
					flush: true,
				},
			);
		} catch {
			receipt.failure = "cleanup";
		}
	}
	return receipt;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		const [mode, root, ...extra] = process.argv.slice(2);
		if (!root || extra.length || !process.env.LO_REPLAY_SUPERVISOR_FD)
			throw new ReplayRefused("inputs");
		if (mode === "--cleanup") {
			if (!(await cleanupReplay(resolve(root))).cleanupComplete)
				process.exitCode = 1;
		} else if (mode === "--run") {
			if ((await runLaunchOnly(resolve(root))).failure !== "none")
				process.exitCode = 1;
		} else process.exitCode = 1;
	} catch {
		process.exitCode = 1;
	}
}
