/** One retained ORIGINAL-app seed experiment, NOT the strict six-phase proof.
 * Every preparatory operation shares 300s; only owned cleanup may use the next
 * 120s. No app build, provider/token service, arbitrary device or retry route. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import { type CaptureResult, captureOwned } from "./auth-retirement-capture.ts";
import { parseSchemeLogs } from "./auth-retirement-scheme-observation.ts";
import {
	type CreationIntent,
	createFromIntent,
	prepareCreation,
	type Run,
	recoverCreation,
} from "./auth-retirement-simulator.ts";
import {
	download,
	metadata,
	originalArchive,
	productManifest,
	unpackZip,
	verifyModes,
} from "./retirement-replay-artifacts.ts";
import {
	Deadline,
	fingerprint,
	GrantSession,
	type Observation,
	ReplayRefused,
	replayMode,
} from "./retirement-replay-core.ts";
import {
	type ExportSummary,
	exportWorkEvidence,
	finishCleanupEvidence,
	safeSummary,
} from "./retirement-replay-evidence.ts";
import {
	bootPhase,
	boundedWait,
	cleanupBudget,
	FirstFailure,
	managedRunner,
	PhaseLog,
	REPLAY_BOOT_BUDGET_MS,
	type RunnerHandle,
} from "./retirement-replay-lifecycle.ts";
import {
	boundedNative,
	NativeScope,
	type SampleContext,
	sampleOwnedProof,
	signalBootWindow,
} from "./retirement-replay-native.ts";
import { deferred, ReplayTransport } from "./retirement-replay-transport.ts";
import {
	inspectTarBytes,
	RETAINED,
	verifyExtractedRetained,
} from "./retirement-ui-guards.ts";

const PYTHON = "/usr/bin/python3";
export interface ReplayOptions {
	root: string;
	runnerSource: string;
	compileRun: number;
	runnerArtifact: number;
	artifactCredential: string;
	mode: "observe-only" | "seed-replay";
}
export function assertReplayOptions(o: ReplayOptions) {
	if (
		!/^[a-f0-9]{40}$/.test(o.runnerSource) ||
		!Number.isSafeInteger(o.compileRun) ||
		o.compileRun <= 0 ||
		!Number.isSafeInteger(o.runnerArtifact) ||
		o.runnerArtifact <= 0 ||
		!o.artifactCredential ||
		!o.root ||
		!(o.mode === "observe-only" || o.mode === "seed-replay")
	)
		throw new ReplayRefused("inputs");
}
export async function within<T>(
	promise: Promise<T>,
	deadline: Deadline,
	cap: number,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	void promise.catch(() => undefined);
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, no) => {
				timer = setTimeout(
					() => no(new ReplayRefused("deadline")),
					deadline.cap(cap),
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
export interface SeedInput {
	root: string;
	source: SampleContext["source"];
	refreshArtifacts: () => Promise<void>;
	sample: () => ReturnType<typeof sampleOwnedProof>;
	setPID: (pid: number) => void;
	udid: string;
	executable: string;
	runnerSource: string;
	expiry: () => number;
	startRunner: (control: string, session: GrantSession) => RunnerHandle;
	run: Run;
	deadline: Deadline;
	mode: "observe-only" | "seed-replay";
	stopNative?: (deadline: Deadline) => Promise<void>;
	capture?: (point: "after-openurl" | "after-tap") => Promise<CaptureResult>;
	closeTransport?: (transport: ReplayTransport) => Promise<void>;
	/** Diagnostic phase timings; absent in unit fixtures that don't assert them. */
	phases?: PhaseLog;
}
/** Real coordinator with injected native/runner boundaries, not canned HTTP.
 * The original receipt clock is armed ONCE before openURL and never at tap. */
export async function executeSeed(input: SeedInput): Promise<ExportSummary> {
	const { root, source, udid, deadline, run } = input;
	const phases = input.phases ?? new PhaseLog();
	const failure = new FirstFailure(root);
	let runner: RunnerHandle | undefined,
		opened = false,
		seedPersisted = false,
		runnerReportedTap = false,
		before: Promise<CaptureResult> | undefined;
	// GrantSession reserves its one-use entitlement BEFORE awaiting this shared
	// frame fence or measuring identity. No query/tap can race past a pending frame.
	const session = new GrantSession(
		input.mode,
		deadline,
		async () => {
			if (!before) throw new ReplayRefused("stage");
			const frame = await boundedWait(before, deadline, 5000);
			if (frame.status !== "observed")
				throw new ReplayRefused("capture-evidence");
			return input.sample();
		},
		input.expiry,
	);
	const transport = new ReplayTransport(source, session, deadline);
	const captures: CaptureResult[] = [],
		secondary: string[] = [];
	let observations: unknown = {};
	const pending: Promise<unknown>[] = [];
	const record = (error: unknown, stage?: string) => {
		failure.remember(error);
		if (stage) secondary.push(stage);
	};
	const capture = (point: "after-openurl" | "after-tap") => {
		const operation = (async () => {
			try {
				deadline.cap(1);
				const result = await (input.capture
					? input.capture(point)
					: captureOwned(
							root,
							udid,
							"seed",
							point,
							async (exe, args, budget) => {
								await run(exe, args, deadline.cap(budget));
							},
						));
				captures.push(result);
				if (result.status !== "observed")
					record(new ReplayRefused("capture-evidence"), "capture");
				return result;
			} catch {
				record(new ReplayRefused("capture-evidence"), "capture");
				const result: CaptureResult = {
					phase: "seed",
					point,
					status: "error",
					elapsedMs: 0,
				};
				captures.push(result);
				return result;
			}
		})();
		void operation.catch(() => undefined);
		pending.push(operation);
		return operation;
	};
	const summary: ExportSummary = {
		phase: "seed",
		mode: input.mode,
		seedPersisted: false,
		acceptanceComplete: false,
		cause: null,
		runnerReportedTap: false,
		urlProgress: "none",
		refused: {},
		observation: null,
		fingerprint: null,
		querySample: null,
		tapSample: null,
		captures,
		observations,
		secondary,
	};
	try {
		const control = await transport.listen();
		// Assigned OUTSIDE the phase closure so `runner` stays narrowed below, and
		// is set before any await so cleanup always sees a started runner.
		const started = input.startRunner(control, session);
		runner = started;
		void started.completion.catch(() => undefined);
		await phases.step("runner-bootstrap", async () => {
			await boundedWait(
				Promise.race([
					transport.runner.promise,
					started.completion.then(() => {
						throw new ReplayRefused("runner-early-exit");
					}),
				]),
				deadline,
				40000,
			);
		});
		// This is the FINAL server expiry refresh, after XCTest actually bootstrapped.
		await boundedWait(input.refreshArtifacts(), deadline, deadline.cap(20000));
		transport.armReady();
		const launch = await phases.step("launch", () =>
			run(
				"xcrun",
				["simctl", "launch", udid, source.bundleId],
				deadline.cap(60000),
			),
		);
		const pid = Number(/:\s*(\d+)\s*$/.exec(launch)?.[1]);
		if (!Number.isSafeInteger(pid) || pid <= 0)
			throw new ReplayRefused("launch");
		input.setPID(pid);
		await phases.step("ready", () =>
			boundedWait(transport.ready.promise, deadline, 75000),
		);
		await input.sample();
		deadline.require(70000);
		transport.open();
		opened = true;
		const url = new URL("loretirementproof://run");
		url.searchParams.set("nonce", source.nonce);
		url.searchParams.set("phase", "seed");
		url.searchParams.set(
			"callback",
			`http://127.0.0.1:${source.receiverPort}/receipt`,
		);
		const answer = boundedWait(
			transport.receipt.promise,
			deadline,
			60000,
		).catch((error) => {
			throw error instanceof ReplayRefused && error.code === "deadline"
				? new ReplayRefused("receipt-timeout")
				: error;
		});
		void answer.catch(() => undefined);
		// Recorded as a phase so a receipt shows openurl was REACHED; the link's
		// outcome is still judged only by the receipt/observations below.
		const opening = phases.step("openurl", () =>
			run(
				"xcrun",
				["simctl", "openurl", udid, url.toString()],
				deadline.cap(30000),
			),
		);
		void opening.catch(() => undefined);
		pending.push(opening);
		before = capture("after-openurl");
		if (input.mode === "observe-only") {
			await boundedWait(
				Promise.race([
					runner.completion,
					opening.then(() => runner!.completion),
				]),
				deadline,
				60000,
			);
			if (session.stage !== "terminal" || session.tapIssued)
				throw new ReplayRefused("stage");
			// Observing is a terminal diagnostic, not seed or tap success.
		} else {
			await Promise.race([
				answer,
				opening.then(() => answer),
				runner.completion.then(() => answer),
			]);
			seedPersisted = true;
			await opening;
			await boundedWait(runner.completion, deadline, 10000);
			runnerReportedTap = session.stage === "terminal" && session.tapIssued;
			if (!runnerReportedTap) throw new ReplayRefused("stage");
			await boundedWait(capture("after-tap"), deadline, 5000);
		}
		await opening;
		await boundedWait(before, deadline, 5000);
	} catch (error) {
		record(error);
	}
	// Every proof observation is finished or abandoned before cleanup begins.
	if (opened)
		try {
			const output = await run(
				"xcrun",
				[
					"simctl",
					"spawn",
					udid,
					"log",
					"show",
					"--info",
					"--last",
					"3m",
					"--style",
					"ndjson",
					"--predicate",
					'eventMessage CONTAINS "loretirementproof"',
				],
				deadline.cap(30000),
			);
			observations = parseSchemeLogs(output, input.executable);
		} catch {
			secondary.push("log");
			observations = {
				nativeIngressSeen: "UNOBSERVED",
				nativeLogReadySeen: "UNOBSERVED",
				jsCallbackEntrySeen: "UNOBSERVED",
				jsLogReadySeen: "UNOBSERVED",
			};
		}
	Object.assign(summary, {
		seedPersisted,
		runnerReportedTap,
		urlProgress: transport.urlProgress,
		refused: { ...transport.refused },
		observation: session.observed ?? null,
		fingerprint: session.observed ? fingerprint(session.observed) : null,
		querySample: session.queryIdentity ?? null,
		tapSample: session.tapIdentity ?? null,
		observations,
		cause: failure.cause,
	});
	try {
		const exported = exportWorkEvidence(root, summary, deadline);
		if (input.mode === "seed-replay" && !exported.framesComplete)
			record(new ReplayRefused("capture-evidence"), "evidence");
	} catch (error) {
		record(
			error instanceof ReplayRefused
				? error
				: new ReplayRefused("capture-evidence"),
			"evidence",
		);
	}
	// One persisted cleanup clock begins BEFORE the first runner/command/server
	// stop, and is reused by device cleanup and the workflow always fallback.
	const cleanup = cleanupBudget(root);
	for (const [stage, operation] of [
		["runner-stop", () => runner?.stop(cleanup) ?? Promise.resolve()],
		["native-stop", () => input.stopNative?.(cleanup) ?? Promise.resolve()],
		[
			"server-close",
			() =>
				input.closeTransport
					? input.closeTransport(transport)
					: transport.close(),
		],
	] as const) {
		try {
			await boundedWait(operation(), cleanup, cleanup.cap(120000));
		} catch (error) {
			record(error, stage);
		}
	}
	try {
		await boundedWait(
			Promise.allSettled(pending),
			cleanup,
			cleanup.cap(120000),
		);
	} catch (error) {
		record(error, "cleanup");
	}
	summary.cause = failure.cause;
	return summary;
}
export function launchRunner(
	runFile: string,
	udid: string,
	root: string,
	scope: NativeScope,
): RunnerHandle {
	const command = scope.start(
		"xcodebuild",
		[
			"test-without-building",
			"-xctestrun",
			runFile,
			"-destination",
			`platform=iOS Simulator,id=${udid}`,
			"-parallel-testing-enabled",
			"NO",
			"-maximum-concurrent-test-simulator-destinations",
			"1",
			"-only-testing:RetirementSystemAlert/RetainedReplayTests/testSingleSeedReplay",
			"-test-iterations",
			"1",
			"-resultBundlePath",
			join(root, "private.xcresult"),
		],
		300000,
		undefined,
		false,
	);
	return {
		completion: command.completion.then(() => undefined),
		stop: (deadline) => command.stop(deadline),
	};
}
export async function cleanupReplay(
	root: string,
	deps: { run?: Run; isAlive?: (pid: number) => boolean } = {},
) {
	let result: {
		cleanupComplete: boolean;
		inventoryAbsent: boolean | "UNOBSERVED";
	} = { cleanupComplete: false, inventoryAbsent: "UNOBSERVED" };
	const budget = cleanupBudget(root),
		scope = new NativeScope(budget);
	const run: Run = (exe, args, cap = 30000, beforeStart) =>
		deps.run
			? deps.run(exe, args, budget.cap(cap), beforeStart)
			: scope.run(exe, args, cap, beforeStart);
	try {
		budget.cap(1);
		if (!existsSync(join(root, "creation-intent.json")))
			result = { cleanupComplete: true, inventoryAbsent: true };
		else {
			const intent = JSON.parse(
				readFileSync(join(root, "creation-intent.json"), "utf8"),
			) as CreationIntent;
			await recoverCreation(root, intent.nonce, intent.runId, run, (pid) => {
				budget.cap(1);
				if (deps.isAlive) return deps.isAlive(pid);
				try {
					process.kill(pid, 0);
					return true;
				} catch {
					return false;
				}
			});
			const list = JSON.parse(
				await run(
					"xcrun",
					["simctl", "list", "devices", "--json"],
					budget.cap(30000),
				),
			);
			const lease = existsSync(join(root, "simulator-lease.json"))
				? JSON.parse(readFileSync(join(root, "simulator-lease.json"), "utf8"))
				: null;
			const absent = Object.values(
				list.devices as Record<string, Array<{ udid: string; name: string }>>,
			)
				.flat()
				.every(
					(device) =>
						device.name !== intent.name && device.udid !== lease?.udid,
				);
			result = { cleanupComplete: absent, inventoryAbsent: absent };
		}
	} catch {
		/* Unknown inventory/timeout is explicitly incomplete, never absence. */
	} finally {
		try {
			await scope.stop(budget);
		} catch {
			result.cleanupComplete = false;
		}
		writeFileSync(join(root, "replay-cleanup.json"), JSON.stringify(result), {
			mode: 0o600,
			flush: true,
		});
	}
	return result;
}
export async function runSeedReplay(options: ReplayOptions) {
	assertReplayOptions(options);
	if (!process.env.LO_REPLAY_SUPERVISOR_FD) throw new ReplayRefused("inputs");
	const root = resolve(options.root);
	mkdirSync(root, { recursive: false });
	const deadline = new Deadline(300000),
		workScope = new NativeScope(deadline),
		run = workScope.run,
		// Separate clock for boot + readiness only; see REPLAY_BOOT_BUDGET_MS.
		bootScope = new NativeScope(new Deadline(REPLAY_BOOT_BUDGET_MS)),
		phases = new PhaseLog();
	let context: SampleContext | undefined;
	let result: Awaited<ReturnType<typeof executeSeed>> | undefined;
	try {
		const actualSource = await run("git", ["rev-parse", "HEAD"]);
		if (actualSource !== options.runnerSource)
			throw new ReplayRefused("runner-source");
		const original = await originalArchive(
			options.artifactCredential,
			deadline,
		);
		const appTar = join(root, "original.tar.gz");
		writeFileSync(appTar, original.tar, { flag: "wx" });
		const appRoot = join(root, "original");
		mkdirSync(appRoot);
		await run("tar", ["-xzpf", appTar, "-C", appRoot], deadline.cap(30000));
		verifyModes(
			appRoot,
			gunzipSync(original.tar, { maxOutputLength: 1024 ** 3 + 32 * 1024 ** 2 }),
		);
		const retained = verifyExtractedRetained(appRoot);
		const frozen = JSON.parse(
			readFileSync(join(appRoot, "frozen-artifact.json"), "utf8"),
		);
		const runnerMeta = await metadata(
			options.runnerArtifact,
			options.compileRun,
			options.runnerSource,
			options.artifactCredential,
			deadline,
		);
		const wrapper = unpackZip(
			await download(
				options.runnerArtifact,
				options.artifactCredential,
				deadline,
			),
			["runner-products.tar.gz", "setup-receipt.json"],
		);
		const receipt = JSON.parse(wrapper["setup-receipt.json"]!.toString("utf8"));
		const runnerTar = wrapper["runner-products.tar.gz"]!;
		if (
			receipt.runnerSourceSHA !== options.runnerSource ||
			receipt.compileOutcome !== "passed" ||
			receipt.mode !== "setup-only" ||
			receipt.testExecutionAttempted !== false ||
			receipt.appBuildAttempted !== false ||
			receipt.runnerTarSHA256 !==
				createHash("sha256").update(runnerTar).digest("hex") ||
			receipt.localNetworkingOnly !== true
		)
			throw new ReplayRefused("runner-artifact");
		const runnerBytes = gunzipSync(runnerTar, {
			maxOutputLength: 1024 ** 3 + 32 * 1024 ** 2,
		});
		inspectTarBytes(runnerBytes);
		const runnerRoot = join(root, "runner");
		mkdirSync(runnerRoot);
		const tarFile = join(root, "runner.tar.gz");
		writeFileSync(tarFile, runnerTar, { flag: "wx" });
		await run("tar", ["-xzpf", tarFile, "-C", runnerRoot]);
		verifyModes(runnerRoot, runnerBytes);
		const manifest = JSON.parse(
			readFileSync(join(runnerRoot, "runner-manifest.json"), "utf8"),
		);
		if (
			manifest.source !== options.runnerSource ||
			!isDeepStrictEqual(
				productManifest(join(runnerRoot, "Products")),
				manifest.products,
			)
		)
			throw new ReplayRefused("runner-products");
		const inventory = JSON.parse(
			await run("xcrun", ["simctl", "list", "devices", "available", "--json"]),
		);
		const template = Object.entries(
			inventory.devices as Record<
				string,
				Array<{ udid: string; name: string; deviceTypeIdentifier: string }>
			>,
		)
			.flatMap(([runtime, devices]) => devices.map((d) => ({ ...d, runtime })))
			.find((d) => d.name === "iPhone 17");
		if (!template) throw new ReplayRefused("template");
		const intent = prepareCreation(root, {
			nonce: frozen.nonce,
			runId: process.env.GITHUB_RUN_ID!,
			hostPid: process.pid,
			runtime: template.runtime,
			deviceType: template.deviceTypeIdentifier,
			templateUdid: template.udid,
		});
		const lease = await phases.step("create", () =>
			createFromIntent(root, intent, run),
		);
		// Boot + readiness run on their OWN clock (REPLAY_BOOT_BUDGET_MS, mirrors
		// the proof harness's BOOT_READY_BUDGET_MS) with the 300s work clock
		// stopped, so a cold simulator cannot eat the experiment's budget. The
		// boot scope's groups register with the same watchdog pipe; it is stopped
		// in `finally` beside the work scope.
		await deadline.excluding(() =>
			bootPhase(async () => {
				signalBootWindow("start");
				try {
					await phases.step("boot", () =>
						bootScope.run("xcrun", ["simctl", "boot", lease.udid], 60000),
					);
					await phases.step("bootstatus", () =>
						bootScope.run(
							"xcrun",
							["simctl", "bootstatus", lease.udid, "-b"],
							REPLAY_BOOT_BUDGET_MS,
						),
					);
				} finally {
					signalBootWindow("end");
				}
			}),
		);
		await phases.step("install", () =>
			run(
				"xcrun",
				["simctl", "install", lease.udid, retained.app],
				deadline.cap(120000),
			),
		);
		const info = JSON.parse(
			await run("plutil", [
				"-convert",
				"json",
				"-o",
				"-",
				join(retained.app, "Info.plist"),
			]),
		);
		const executable = info.CFBundleExecutable;
		if (typeof executable !== "string" || !executable)
			throw new ReplayRefused("executable");
		const script = readFileSync(join(retained.app, "main.jsbundle"));
		for (const marker of [
			frozen.nonce,
			frozen.sourceSha,
			"auth-retirement-proof",
		])
			if (!script.includes(Buffer.from(marker)))
				throw new ReplayRefused("compiled-identity");
		// Recheck BOTH artifacts after install, before URL authority can be granted.
		const appFresh = await metadata(
			RETAINED.artifactID,
			RETAINED.runID,
			RETAINED.sourceSHA,
			options.artifactCredential,
			deadline,
		);
		const runnerFresh = await metadata(
			options.runnerArtifact,
			options.compileRun,
			options.runnerSource,
			options.artifactCredential,
			deadline,
		);
		let expiry = Math.min(
			Date.parse(appFresh.expires_at),
			Date.parse(runnerFresh.expires_at),
		);
		context = {
			root,
			intent,
			lease,
			proofPID: 0,
			source: frozen,
			runnerSource: options.runnerSource,
			executable,
		};
		const sample = () => sampleOwnedProof(context!, run, expiry);
		result = await executeSeed({
			root,
			source: frozen,
			refreshArtifacts: async () => {
				const latestApp = await metadata(
					RETAINED.artifactID,
					RETAINED.runID,
					RETAINED.sourceSHA,
					options.artifactCredential,
					deadline,
				);
				const latestRunner = await metadata(
					options.runnerArtifact,
					options.compileRun,
					options.runnerSource,
					options.artifactCredential,
					deadline,
				);
				expiry = Math.min(
					Date.parse(latestApp.expires_at),
					Date.parse(latestRunner.expires_at),
				);
			},
			stopNative: (cleanup) => workScope.stop(cleanup),
			sample,
			setPID: (pid) => {
				context!.proofPID = pid;
			},
			udid: lease.udid,
			executable,
			runnerSource: options.runnerSource,
			expiry: () => expiry,
			run,
			deadline,
			mode: options.mode,
			phases,
			startRunner: (control, session) => {
				const envPath = join(root, "private-runner-env.json");
				writeFileSync(
					envPath,
					JSON.stringify({
						LO_REPLAY_MODE: options.mode,
						LO_REPLAY_CONTROL: control,
						LO_REPLAY_SESSION: session.id,
						LO_REPLAY_BEARER: session.bearer,
						LO_REPLAY_RUNNER_SOURCE: options.runnerSource,
					}),
					{ flag: "wx", mode: 0o600 },
				);
				const privateRun = join(runnerRoot, "Products/private.xctestrun");
				const prepareScope = new NativeScope(deadline),
					runnerScope = new NativeScope(deadline);
				return managedRunner(
					async () => {
						await prepareScope.run(
							PYTHON,
							[
								join(import.meta.dirname, "retirement-replay-products.py"),
								"prepare",
								runnerRoot,
								"--environment",
								envPath,
								"--output",
								privateRun,
							],
							deadline.cap(10000),
						);
					},
					() => launchRunner(privateRun, lease.udid, root, runnerScope),
					() => prepareScope.stop(cleanupBudget(root)),
				);
			},
		});
	} catch (error) {
		new FirstFailure(root).remember(error);
	} finally {
		const cleanup = cleanupBudget(root);
		try {
			// Both scopes share the ONE persisted cleanup allowance; no renewal.
			await Promise.all([workScope.stop(cleanup), bootScope.stop(cleanup)]);
		} catch (error) {
			new FirstFailure(root).remember(error);
		}
		const device = await cleanupReplay(root);
		const failure = new FirstFailure(root);
		if (!device.cleanupComplete) failure.remember(new ReplayRefused("cleanup"));
		if (result) {
			const logs = result.observations as Record<string, unknown>;
			result.cause = failure.cause;
			result.acceptanceComplete = !!(
				options.mode === "seed-replay" &&
				!result.cause &&
				result.seedPersisted &&
				result.runnerReportedTap &&
				result.querySample &&
				result.tapSample &&
				result.captures.some(
					(frame) =>
						frame.point === "after-openurl" && frame.status === "observed",
				) &&
				result.captures.some(
					(frame) => frame.point === "after-tap" && frame.status === "observed",
				) &&
				logs.nativeIngressSeen === true &&
				logs.nativeLogReadySeen === true &&
				logs.jsCallbackEntrySeen === true &&
				logs.jsLogReadySeen === true &&
				device.cleanupComplete
			);
		} else
			result = {
				phase: "seed",
				mode: options.mode,
				seedPersisted: false,
				acceptanceComplete: false,
				cause: failure.cause ?? "other",
				runnerReportedTap: false,
				urlProgress: "none",
				refused: {},
				observation: null,
				fingerprint: null,
				querySample: null,
				tapSample: null,
				captures: [],
				observations: {},
				secondary: [],
			};
		try {
			result.phases = phases.phases;
			result.failedPhase = phases.failed;
			finishCleanupEvidence(root, result, device, cleanup);
		} catch {
			result.acceptanceComplete = false;
			const failure = new FirstFailure(root);
			failure.remember(new ReplayRefused("capture-evidence"));
			result.cause = failure.cause;
		}
	}

	return result;
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [mode, root] = process.argv.slice(2);
	try {
		if (!root || !process.env.LO_REPLAY_SUPERVISOR_FD)
			throw new ReplayRefused("inputs");
		if (mode === "--cleanup") {
			const result = await cleanupReplay(resolve(root));
			if (!result.cleanupComplete) process.exitCode = 1;
		} else if (mode === "--run") {
			const result = await runSeedReplay({
				root,
				runnerSource: process.env.REPLAY_RUNNER_SOURCE ?? "",
				compileRun: Number(process.env.REPLAY_COMPILE_RUN),
				runnerArtifact: Number(process.env.REPLAY_RUNNER_ARTIFACT),
				artifactCredential: process.env.GITHUB_TOKEN ?? "",
				mode: replayMode(process.env.REPLAY_MODE),
			});
			if (
				!result ||
				result.cause ||
				(result.mode === "seed-replay"
					? !result.acceptanceComplete
					: result.runnerReportedTap)
			)
				process.exitCode = 1;
		} else throw new ReplayRefused("inputs");
	} catch {
		process.exitCode = 1;
		console.error("Retained seed replay refused; inspect sanitized evidence");
	}
}
