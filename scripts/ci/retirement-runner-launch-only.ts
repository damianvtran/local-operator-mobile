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
export const LAUNCH_LIMITS = Object.freeze({
	work: 300000,
	acquisition: 90000,
	toolchain: 15000,
	prepare: 45000,
	ownership: 60000,
	ready: 40000,
	postDenial: 30000,
	boot: 300000,
	cleanup: 120000,
});
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
		] as Array<{ name: string; elapsedMs: number; ok: boolean }>,
		protocol: listener.receipt(),
		runnerFailure: null as ReturnType<typeof safeRunnerFailure>,
		stopOutcome: "not-launched" as StopOutcome,
		cleanupComplete: false,
		inventoryAbsent: false,
		failure: "none" as "none" | "preflight" | "launch" | "cleanup",
	};
	let runner: RunnerHandle | undefined;
	let boot: NativeScope | undefined;
	const currentRun: Run = work.run;
	async function stage<T>(
		name: string,
		cap: number,
		action: (run: Run) => Promise<T>,
	): Promise<T> {
		const began = performance.now();
		const stageDeadline = new Deadline(deadline.cap(cap));
		const run: Run = (exe, args, limit = 30000, before) =>
			currentRun(exe, args, stageDeadline.cap(Math.min(limit, 30000)), before);
		try {
			const result = await action(run);
			stageDeadline.cap(1);
			receipt.stages.push({
				name,
				elapsedMs: Math.round(performance.now() - began),
				ok: true,
			});
			return result;
		} catch (error) {
			receipt.stages.push({
				name,
				elapsedMs: Math.round(performance.now() - began),
				ok: false,
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
			async (run) => {
				const inventory = JSON.parse(
					await run("xcrun", [
						"simctl",
						"list",
						"devices",
						"available",
						"--json",
					]),
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
				return createFromIntent(root, intent, run);
			},
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
		const observationStarted = performance.now();
		receipt.stopOutcome = await observeLaunch(listener, runner, deadline);
		receipt.stages.push({
			name: "runner-observation",
			elapsedMs: Math.round(performance.now() - observationStarted),
			ok: receipt.stopOutcome === "expected-test-failure",
		});
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
