import { createHash, randomBytes, randomInt } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_AVATARS } from "../../tools/mock-relay/scenarios.ts";
import { type CaptureResult, captureOwned } from "./auth-retirement-capture.ts";
import { prepareCreation } from "./auth-retirement-simulator.ts";
import {
	Deadline,
	type GrantSession,
	type LiveIdentity,
	ReplayRefused,
	scalarValues,
} from "./retirement-replay-core.ts";
import {
	cleanupBudget,
	FirstFailure,
	managedRunner,
} from "./retirement-replay-lifecycle.ts";
import { NativeScope } from "./retirement-replay-native.ts";
import { classifyRunnerFailure } from "./retirement-replay-runner-tail.ts";
import { deferred } from "./retirement-replay-transport.ts";
import {
	cleanupReplay,
	executeSeed,
	type SeedInput,
} from "./retirement-ui-replay.ts";

const roots: string[] = [];
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.allSettled(stops.splice(0).map((stop) => stop()));
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function root() {
	const path = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"replay-coordinator-",
		),
	);
	roots.push(path);
	return path;
}
const exact = {
	scope: "system-open-alert-v1",
	count: 1,
	titles: [scalarValues("Open in “Local Operator”?")],
	buttons: [scalarValues("Cancel"), scalarValues("Open")],
};
const identity: LiveIdentity = {
	udid: "11111111-1111-4111-8111-111111111111",
	pid: 123,
	label: "UIKitApplication:com.localoperator.mobile.retirementproof[owned]",
	source: "78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b",
	bundle: "9c667250a1e0a8d5dc129495a8f1bd734e201ec5bfbae8bd7b863e4f951574e7",
	hostSource: "c".repeat(40),
};
function frame(
	directory: string,
	point: "after-openurl" | "after-tap",
): CaptureResult {
	const bytes = AGENT_AVATARS.researcher!;
	mkdirSync(join(directory, "captures"), { recursive: true });
	writeFileSync(join(directory, `captures/seed-${point}.png`), bytes);
	return {
		phase: "seed",
		point,
		status: "observed",
		elapsedMs: 1,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		relativePath: `captures/seed-${point}.png`,
	};
}
function fixture(
	mode: "seed-replay" | "observe-only" = "seed-replay",
	actorMode:
		| "normal"
		| "receipt-during-capture"
		| "rejected-during-capture"
		| "silent" = "normal",
) {
	const directory = root(),
		events: string[] = [],
		original = {
			flavor: "auth-retirement-proof",
			bundleId: "com.localoperator.mobile.retirementproof",
			sourceSha: identity.source,
			nonce: "a".repeat(32),
			receiverPort: randomInt(20000, 40000),
			bundleSha256: identity.bundle,
		};
	const runnerDone = deferred<void>(),
		captureEntered = deferred<void>(),
		releaseCapture = deferred<void>(),
		logEntered = deferred<void>();
	let session: GrantSession | undefined,
		pendingCapture = false,
		samples = 0;
	const tapRequests: string[] = [];
	const seed = async (path: string, body: unknown) => {
		const response = await fetch(
			`http://127.0.0.1:${original.receiverPort}${path}`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-proof-nonce": original.nonce,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(3000),
			},
		);
		await response.arrayBuffer();
		return response.status;
	};
	const receipt = (ok = true) =>
		seed("/receipt", {
			phase: "seed",
			ok,
			rawOauthPresent: true,
			flavor: original.flavor,
			sourceSha: original.sourceSha,
			...(ok ? {} : { stage: "seed-write-not-persistent" }),
		});
	const input: SeedInput = {
		root: directory,
		source: original,
		runnerSource: identity.hostSource,
		udid: identity.udid,
		executable: "FixtureExecutable",
		deadline: new Deadline(300000),
		mode,
		expiry: () => Date.now() + 300000,
		refreshArtifacts: async () => {
			expect(session?.runnerReady).toBe(true);
			events.push("runner-ready", "metadata-after-bootstrap");
		},
		sample: async () => {
			samples++;
			return { ...identity };
		},
		setPID: (pid) => {
			expect(pid).toBe(123);
			events.push("pid");
		},
		capture: async (point) => {
			events.push(`capture:${point}`);
			if (point === "after-openurl") {
				captureEntered.resolve();
				if (pendingCapture) await releaseCapture.promise;
			}
			return frame(directory, point);
		},
		run: async (_exe, args) => {
			if (args[1] === "launch") {
				events.push("launch");
				expect(
					await seed("/ready", {
						kind: "listener-ready",
						flavor: original.flavor,
						sourceSha: original.sourceSha,
					}),
				).toBe(204);
				events.push("ready-during-launch");
				return "com.localoperator.mobile.retirementproof: 123";
			}
			if (args[1] === "openurl") {
				events.push("openurl");
				if (
					actorMode === "receipt-during-capture" ||
					actorMode === "rejected-during-capture"
				) {
					void (async () => {
						await captureEntered.promise;
						expect(await receipt(actorMode !== "rejected-during-capture")).toBe(
							204,
						);
						runnerDone.resolve();
					})().catch(runnerDone.reject);
				}
				return "";
			}
			if (args.includes("log")) {
				events.push("log");
				logEntered.resolve();
				return (
					[
						"loretirementproof-native-ingress",
						"loretirementproof-native-log-ready",
						"loretirementproof-js-callback-entry",
						"loretirementproof-js-log-ready",
					]
						.map((eventMessage) =>
							JSON.stringify({
								processImagePath: "/private/FixtureExecutable",
								eventMessage,
							}),
						)
						.join("\n") + '\n{"count":4,"finished":1}'
				);
			}
			throw new ReplayRefused("other");
		},
		startRunner: (control, current) => {
			session = current;
			const rpc = async (kind: string, observation?: unknown) => {
				if (kind === "authorize-tap") tapRequests.push(kind);
				const response = await fetch(control, {
					method: "POST",
					headers: {
						authorization: `Bearer ${current.bearer}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						session: current.id,
						kind,
						challenge: randomBytes(32).toString("hex"),
						...(observation ? { observation } : {}),
					}),
					signal: AbortSignal.timeout(3000),
				});
				await response.arrayBuffer();
				expect(response.status).toBe(200);
			};
			const task = (async () => {
				events.push("bootstrap-request");
				await rpc("runner-ready");
				if (actorMode !== "normal") return;
				await rpc("before-observe");
				events.push("query");
				await rpc("observed", exact);
				if (mode === "observe-only") {
					runnerDone.resolve();
					return;
				}
				await rpc("authorize-tap", exact);
				events.push("tap");
				await rpc("after-tap");
				expect(await receipt()).toBe(204);
				runnerDone.resolve();
			})();
			void task.catch(runnerDone.reject);
			return {
				completion: runnerDone.promise,
				stop: async () => {
					events.push("runner-stop");
					releaseCapture.resolve();
					runnerDone.reject(new ReplayRefused("runner-stopped"));
					await task.catch(() => undefined);
				},
			};
		},
		stopNative: async () => {
			events.push("native-stop");
			releaseCapture.resolve();
		},
	};
	let completion: ReturnType<typeof executeSeed> | undefined;
	const start = () => {
		completion = executeSeed(input);
		return completion;
	};
	stops.push(async () => {
		runnerDone.reject(new ReplayRefused("runner-stopped"));
		releaseCapture.resolve();
		await completion?.catch(() => undefined);
	});
	return {
		directory,
		events,
		input,
		start,
		seed,
		receipt,
		captureEntered,
		releaseCapture,
		logEntered,
		setPending: () => {
			pendingCapture = true;
		},
		samples: () => samples,
		tapRequests,
	};
}
describe("real loopback coordinator at injected native/runner boundaries", () => {
	it("bootstraps, refreshes metadata, receives ready during launch, then opens once and records distinct query/tap samples", async () => {
		const f = fixture();
		const result = await f.start();
		expect(result.cause).toBeNull();
		expect(result.seedPersisted).toBe(true);
		expect(result.runnerReportedTap).toBe(true);
		expect(f.samples()).toBe(3);
		expect(result.querySample).toEqual(identity);
		expect(result.tapSample).toEqual(identity);
		expect(f.events.indexOf("metadata-after-bootstrap")).toBeLessThan(
			f.events.indexOf("launch"),
		);
		expect(f.events.indexOf("ready-during-launch")).toBeLessThan(
			f.events.indexOf("openurl"),
		);
		expect(f.events.indexOf("capture:after-openurl")).toBeLessThan(
			f.events.indexOf("query"),
		);
		expect(f.events.indexOf("tap")).toBeLessThan(
			f.events.indexOf("capture:after-tap"),
		);
		expect(f.events.filter((v) => v === "openurl")).toHaveLength(1);
		expect(readdirSync(join(f.directory, "evidence")).sort()).toEqual([
			"after.png",
			"before.png",
			"seed-replay.json",
		]);
		expect(
			existsSync(join(f.directory, "evidence", "private-runner-env.json")),
		).toBe(false);
	});
	/*
	 * Replay 41801686399: the runner exited during bootstrap and seed-replay.json
	 * said failedPhase=null (only the later cleanup.json named the phase). The
	 * work export must carry the phase receipt and the sanitized runner tail.
	 */
	it("a runner that exits during launch is named in seed-replay.json itself, with its closed failure record", async () => {
		const f = fixture();
		const secret = "b".repeat(64);
		f.input.startRunner = () => ({
			completion: Promise.reject(new ReplayRefused("command-exit")),
			stop: async () => undefined,
			prepared: Promise.resolve(),
			// A REAL record built from raw output carrying the secret, so the
			// not-contained check below can actually fail (review R23-4).
			failureRecord: () =>
				classifyRunnerFailure(
					65,
					"launch",
					Buffer.from(
						`LO_REPLAY_BEARER=${secret}\nxcodebuild: error: Failed to prepare device ${secret}`,
					),
				),
		});
		const result = await f.start();
		expect(result.cause).toBe("command-exit");
		const exported = JSON.parse(
			readFileSync(join(f.directory, "evidence", "seed-replay.json"), "utf8"),
		);
		expect(exported.failedPhase).toBe("runner-launch");
		expect(
			exported.phases.map(
				(p: { name: string; status: string }) => `${p.name}:${p.status}`,
			),
		).toEqual(["runner-prepare:ok", "runner-launch:failed"]);
		expect(exported.runnerFailure).toMatchObject({
			exitCode: 65,
			command: "launch",
			errorClass: "destination_unavailable",
			failingTest: null,
			failureCount: 0,
		});
		expect(exported.runnerFailure.tailSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(exported)).not.toContain(secret);
		expect(f.events).not.toContain("openurl");
	});
	it("a failed preparation is named runner-prepare, and no launch phase is claimed", async () => {
		const f = fixture();
		const prepared = Promise.reject(new ReplayRefused("command-exit"));
		void prepared.catch(() => undefined);
		f.input.startRunner = () => ({
			completion: prepared,
			stop: async () => undefined,
			prepared,
		});
		await f.start();
		const exported = JSON.parse(
			readFileSync(join(f.directory, "evidence", "seed-replay.json"), "utf8"),
		);
		expect(exported.failedPhase).toBe("runner-prepare");
		expect(
			exported.phases.map(
				(p: { name: string; status: string }) => `${p.name}:${p.status}`,
			),
		).toEqual(["runner-prepare:failed"]);
		expect(exported.runnerFailure).toBeNull();
	});
	it("final metadata refusal after bootstrap prevents proof launch/openURL", async () => {
		const f = fixture();
		f.input.refreshArtifacts = async () => {
			throw new ReplayRefused("artifact-expired");
		};
		const result = await f.start();
		expect(result.cause).toBe("artifact-expired");
		expect(f.events).not.toContain("launch");
		expect(f.events).not.toContain("openurl");
	});
	it("observe-only is terminal with no tap entitlement or seed-success claim", async () => {
		const f = fixture("observe-only");
		const result = await f.start();
		expect(result.cause).toBeNull();
		expect(f.tapRequests).toEqual([]);
		expect(result.runnerReportedTap).toBe(false);
		expect(result.seedPersisted).toBe(false);
		expect(result.acceptanceComplete).toBe(false);
		expect(result.tapSample).toBeNull();
		expect(f.events).not.toContain("capture:after-tap");
	});
	it("handles an admitted seed receipt DURING a pending frame instead of waiting for capture", async () => {
		const f = fixture("seed-replay", "receipt-during-capture");
		f.setPending();
		const running = f.start();
		await f.logEntered.promise;
		expect(
			JSON.parse(
				readFileSync(join(f.directory, "seed-first-failure.json"), "utf8"),
			).cause,
		).toBe("stage");
		expect(f.events).not.toContain("native-stop");
		f.releaseCapture.resolve();
		const result = await running;
		expect(result.seedPersisted).toBe(true);
		expect(result.runnerReportedTap).toBe(false);
	});
	it("preserves rejected receipt cause DURING capture and despite runner/native/server cleanup errors", async () => {
		const f = fixture("seed-replay", "rejected-during-capture");
		f.setPending();
		f.input.stopNative = async () => {
			f.releaseCapture.resolve();
			throw new Error("PRIVATE_TOKEN native stop");
		};
		f.input.closeTransport = async (transport) => {
			await transport.close();
			throw new Error("PRIVATE_TOKEN server close");
		};
		const running = f.start();
		await f.logEntered.promise;
		expect(
			JSON.parse(
				readFileSync(join(f.directory, "seed-first-failure.json"), "utf8"),
			).cause,
		).toBe("phase-rejected");
		f.releaseCapture.resolve();
		const result = await running;
		expect(result.cause).toBe("phase-rejected");
		expect(result.secondary).toEqual(
			expect.arrayContaining(["native-stop", "server-close"]),
		);
		expect(
			readFileSync(join(f.directory, "evidence", "seed-replay.json"), "utf8"),
		).not.toContain("PRIVATE_TOKEN");
	});
	it("the original 60s receipt timer expires DURING capture and never restarts at an observation", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const f = fixture("seed-replay", "silent");
		f.setPending();
		const running = f.start();
		await f.captureEntered.promise;
		await vi.advanceTimersByTimeAsync(60001);
		await f.logEntered.promise;
		expect(
			JSON.parse(
				readFileSync(join(f.directory, "seed-first-failure.json"), "utf8"),
			).cause,
		).toBe("receipt-timeout");
		f.releaseCapture.resolve();
		const result = await running;
		expect(result.cause).toBe("receipt-timeout");
		expect(f.events.filter((v) => v === "openurl")).toHaveLength(1);
	});
	it("invalid frame bytes cannot enter allowlisted evidence", async () => {
		const f = fixture();
		f.input.capture = async (point) => {
			const result = frame(f.directory, point);
			writeFileSync(
				join(f.directory, result.relativePath!),
				"PRIVATE_TOKEN not PNG",
			);
			return result;
		};
		const result = await f.start();
		expect(result.cause).toBe("capture-evidence");
		expect(readdirSync(join(f.directory, "evidence"))).not.toContain(
			"before.png",
		);
		for (const name of readdirSync(join(f.directory, "evidence")))
			expect(
				readFileSync(join(f.directory, "evidence", name)).includes(
					Buffer.from("PRIVATE_TOKEN"),
				),
			).toBe(false);
	});
});
describe("joined lifecycle and one persisted cleanup clock", () => {
	it("STOP while prepare is pending joins it and cannot launch after prepare settles", async () => {
		const prepared = deferred<void>();
		let launches = 0,
			cancelled = 0;
		const runner = managedRunner(
			() => prepared.promise,
			() => {
				launches++;
				return { completion: Promise.resolve(), stop: async () => {} };
			},
			async () => {
				cancelled++;
				prepared.resolve();
			},
		);
		await runner.stop(new Deadline(1000));
		await expect(runner.completion).rejects.toMatchObject({
			code: "runner-stopped",
		});
		expect(cancelled).toBe(1);
		expect(launches).toBe(0);
		await runner.stop(new Deadline(1000));
		expect(cancelled).toBe(1);
	});
	it("failed preparation and stop exceptions cannot permit a late launch", async () => {
		const prepared = deferred<void>();
		let launches = 0;
		const runner = managedRunner(
			() => prepared.promise,
			() => {
				launches++;
				return { completion: Promise.resolve(), stop: async () => {} };
			},
			async () => {
				prepared.reject(new Error("PRIVATE_TOKEN"));
				throw new ReplayRefused("cleanup");
			},
		);
		await expect(runner.stop(new Deadline(1000))).rejects.toMatchObject({
			code: "cleanup",
		});
		expect(launches).toBe(0);
	});
	it("fallback consumes the existing 120s allowance, not a fresh budget", () => {
		const directory = root();
		const first = cleanupBudget(directory, 1000);
		const bytes = readFileSync(join(directory, "cleanup-start.json"));
		const second = cleanupBudget(directory, 61000);
		expect(first.remaining()).toBeGreaterThan(119000);
		expect(second.remaining()).toBeLessThanOrEqual(60000);
		expect(readFileSync(join(directory, "cleanup-start.json"))).toEqual(bytes);
		expect(() => cleanupBudget(directory, 121001).cap(1)).toThrow();
	});
	it("first coarse cause survives a later cleanup failure and opaque exceptions", () => {
		const directory = root();
		const first = new FirstFailure(directory);
		first.remember(new ReplayRefused("phase-rejected"));
		new FirstFailure(directory).remember(new Error("PRIVATE_TOKEN"));
		expect(
			JSON.parse(
				readFileSync(join(directory, "seed-first-failure.json"), "utf8"),
			),
		).toEqual({ cause: "phase-rejected" });
	});
	it("an already-expired cleanup fallback starts NO native command", async () => {
		const directory = root();
		const at = Date.now() - 130000;
		writeFileSync(
			join(directory, "cleanup-start.json"),
			JSON.stringify({ at, end: at + 120000 }),
		);
		let calls = 0;
		const result = await cleanupReplay(directory, {
			run: async () => {
				calls++;
				return "";
			},
		});
		expect(result.cleanupComplete).toBe(false);
		expect(calls).toBe(0);
	});
	it.each([false, true])(
		"owned device cleanup records post-delete inventory or UNOBSERVED (%s) without replacing a seed cause",
		async (inventoryFails) => {
			const directory = root(),
				nonce = "a".repeat(32),
				runId = "12345",
				udid = identity.udid;
			const intent = prepareCreation(directory, {
				nonce,
				runId,
				hostPid: process.pid,
				runtime: "fixture-runtime",
				deviceType: "fixture-device",
				templateUdid: "22222222-2222-2222-2222-222222222222",
			});
			intent.state = "settled";
			writeFileSync(
				join(directory, "creation-intent.json"),
				JSON.stringify(intent),
			);
			writeFileSync(
				join(directory, "simulator-lease.json"),
				JSON.stringify({ udid, nonce, runId, hostPid: process.pid }),
			);
			const at = Date.now() - 100000;
			writeFileSync(
				join(directory, "cleanup-start.json"),
				JSON.stringify({ at, end: at + 120000 }),
			);
			const failure = new FirstFailure(directory);
			failure.remember(new ReplayRefused("phase-rejected"));
			const calls: string[][] = [];
			let deleted = false;
			const result = await cleanupReplay(directory, {
				isAlive: () => false,
				run: async (_exe, args, cap) => {
					calls.push(args);
					expect(cap).toBeLessThanOrEqual(20000);
					if (args[1] === "delete") {
						expect(args[2]).toBe(udid);
						deleted = true;
						return "";
					}
					if (args[1] === "shutdown") {
						expect(args[2]).toBe(udid);
						return "";
					}
					if (deleted && inventoryFails) throw new Error("PRIVATE_TOKEN");
					return JSON.stringify({
						devices: {
							"fixture-runtime": deleted
								? []
								: [
										{
											udid,
											name: intent.name,
											deviceTypeIdentifier: intent.deviceType,
											state: "Booted",
										},
									],
						},
					});
				},
			});
			expect(calls.some((args) => args[1] === "delete")).toBe(true);
			expect(result.cleanupComplete).toBe(!inventoryFails);
			expect(result.inventoryAbsent).toBe(inventoryFails ? "UNOBSERVED" : true);
			if (!result.cleanupComplete)
				failure.remember(new ReplayRefused("cleanup"));
			expect(new FirstFailure(directory).cause).toBe("phase-rejected");
			expect(
				readFileSync(join(directory, "replay-cleanup.json"), "utf8"),
			).not.toContain("PRIVATE_TOKEN");
		},
	);
	it("owned Node command gate is stopped/joined and refuses any late command", async () => {
		const scope = new NativeScope(new Deadline(1000));
		const command = scope.start(
			process.execPath,
			["-e", "setInterval(()=>{},1000)"],
			1000,
		);
		await scope.stop(new Deadline(1000));
		await expect(command.completion).rejects.toBeInstanceOf(ReplayRefused);
		expect(scope.commands.size).toBe(0);
		expect(() => scope.run(process.execPath, ["-e", ""])).toThrow();
	});
});

it("real capture helper publishes a separate closed after-tap PNG and atomic metadata, never a success receipt-timeout frame", async () => {
	const directory = root();
	const calls: string[][] = [];
	const result = await captureOwned(
		directory,
		identity.udid,
		"seed",
		"after-tap",
		async (exe, args, budget) => {
			expect(exe).toBe("xcrun");
			expect(args.slice(0, 6)).toEqual([
				"simctl",
				"io",
				identity.udid,
				"screenshot",
				"--type=png",
				args[5],
			]);
			expect(budget).toBe(5000);
			calls.push(args);
			writeFileSync(args[5]!, AGENT_AVATARS.researcher!);
		},
	);
	expect(calls).toHaveLength(1);
	expect(result.status).toBe("observed");
	expect(result.evidencePersisted).toBe(true);
	expect(result.relativePath).toBe("captures/seed-after-tap.png");
	expect(existsSync(join(directory, "seed-after-tap-capture.json"))).toBe(true);
	expect(existsSync(join(directory, "seed-receipt-timeout-capture.json"))).toBe(
		false,
	);
});
