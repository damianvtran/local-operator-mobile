#!/usr/bin/env node
/**
 * Targeted NATIVE iOS proof for the 2026-11-04 chrome pass (decision record
 * `mobile-design-direction` §7): the composer's concentric geometry, the session
 * header, the above-composer chips and the conversations-first sidebar, on the
 * record's device classes, in Local Operator Dark and Light, with Liquid Glass
 * on iOS 26 and the solid fallback (iOS 18 where the runner has it, and Reduce
 * Transparency on iOS 26 everywhere).
 *
 *     node scripts/ci/chrome-ios-proof.ts   (hosted macOS only; see e2e.yml)
 *
 * WHY THIS EXISTS. The development host has no simulator (AGENTS.md "Build host
 * assumptions"), and the web export renders `expo-glass-effect`'s plain-View
 * fallback, so neither the glass material nor the real safe-area/corner
 * geometry of a device can be seen anywhere but here.
 *
 * CONSTRAINTS THAT SHAPE THE CODE — the same ones `projects-create-ios-proof.ts`
 * holds, and this file follows its patterns rather than inventing new ones:
 *  - It never builds. The workflow downloads the `ios-simulator` artifact the
 *    PR's own iOS run built, verified by digest; the token is used by that
 *    download step alone and this process runs with an allowlisted environment.
 *  - The relay is the mock (`createRelay`), reached through a unique `.local`
 *    Bonjour name because the app's ATS admits local networking, not 127/8.
 *    The password is a run-only random value, redacted from every log.
 *  - Every simulator is CREATED fresh and owned, every operation has a deadline
 *    in its own process group, and everything owned is reaped in `finally`.
 *  - Frames, hierarchy dumps (for the geometry numbers) and a receipt survive a
 *    failure. Assertions prove elements are present; the reviewer measures and
 *    views the PNGs.
 *
 * A pass is iOS SIMULATOR evidence. It says nothing about a physical device's
 * display corner (simulator screenshots are rectangular), Android, or glass
 * contrast over real content beyond what these frames show.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import {
	activityWaitProjection,
	chromeProofPlan,
	collectChromeFrames,
} from "./chrome-ios-proof-contract.ts";
import {
	nativeConnectionPrerequisiteFailed,
	probeNativeRelay,
} from "./native-relay-preflight.ts";

const env = process.env;
const activityOnly = env.PROOF_ACTIVITY_ONLY === "true";
const plan = chromeProofPlan(activityOnly);
const need = (name: string): string => {
	const value = env[name];
	if (!value) throw new Error(`missing ${name}`);
	return value;
};
const RUNNER_TEMP = need("RUNNER_TEMP");
const ROOT = join(RUNNER_TEMP, "chrome-ios-proof");
const ZIP = need("PROOF_ARTIFACT_ZIP");
/* The BEFORE build (main's own `ios-simulator` artifact), optional: present,
 * the lanes marked `before` run the same flows on it first, so each changed
 * screen has a before/after pair from one runner and one simulator image. */
const BASE_ZIP = env.PROOF_BASE_ARTIFACT_ZIP ?? "";
const PASSWORD_FILE = need("PROOF_PASSWORD_FILE");
const BUDGET_SECONDS = 90 * 60;
const started = Date.now();

if (
	env.GITHUB_ACTIONS !== "true" ||
	env.RUNNER_OS !== "macOS" ||
	env.RUNNER_ENVIRONMENT !== "github-hosted" ||
	env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
	env.PROOF_MODE !== "chrome-ios-proof"
)
	throw new Error("this proof runs only on a hosted macOS manual dispatch");

const password = readFileSync(PASSWORD_FILE, "utf8").trim();
if (password.length < 24) throw new Error("run-only password file is empty");

// Allowlisted child environment: no GH_TOKEN/GITHUB_TOKEN, no inherited HOME.
const childEnv: NodeJS.ProcessEnv = {
	NODE_ENV: "production",
	PATH: env.PATH,
	DEVELOPER_DIR: env.DEVELOPER_DIR,
	JAVA_HOME: env.JAVA_HOME,
	LANG: env.LANG ?? "en_US.UTF-8",
	HOME: join(ROOT, "home"),
	TMPDIR: join(ROOT, "tmp"),
};
for (const dir of ["home", "tmp", "frames", "hierarchies", "commands"])
	mkdirSync(join(ROOT, dir), { recursive: true, mode: 0o700 });

type Record_ = {
	name: string;
	rc: number | null;
	elapsedMs: number;
	deadlineExceeded?: boolean;
	capSeconds: number;
};
const records: Record_[] = [];
const groups = new Set<ChildProcess>();
const receipt: Record<string, unknown> = {
	mode: "chrome-ios-proof",
	sourceSha: env.GITHUB_SHA,
	runId: env.GITHUB_RUN_ID,
	artifact: {
		runId: env.PROOF_NATIVE_RUN_ID,
		name: env.PROOF_NATIVE_ARTIFACT_NAME,
		expectedSha256: env.PROOF_NATIVE_ARTIFACT_SHA256,
	},
	scope:
		"native iOS SIMULATOR frames for the chrome pass; no physical device, not full E2E",
	lanes: [] as unknown[],
	steps: [] as string[],
};
const note = (line: string) => {
	(receipt.steps as string[]).push(line);
	console.log(line);
};
const redact = (text: string) =>
	text.replaceAll(password, "<run-only-redacted>");
const save = () => {
	writeFileSync(join(ROOT, "receipt.json"), JSON.stringify(receipt, null, 2));
	writeFileSync(join(ROOT, "commands.json"), JSON.stringify(records, null, 2));
};

function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, signal);
	} catch {
		/* group already gone */
	}
}
async function stop(child: ChildProcess) {
	signalGroup(child, "SIGTERM");
	await new Promise<void>((done) => {
		const t = setTimeout(done, 1500);
		child.once("close", () => {
			clearTimeout(t);
			done();
		});
	});
	signalGroup(child, "SIGKILL");
	groups.delete(child);
}

/** `lane/build` names a nested frame dir; logs and hierarchies are flat files. */
const flat = (name: string) => name.replaceAll("/", "--");

let sequence = 0;
/** One bounded operation in its own process group (see the module comment). */
async function run(
	name: string,
	command: string,
	args: string[],
	capSeconds: number,
	cleanup = false,
): Promise<string> {
	const remaining = BUDGET_SECONDS - (Date.now() - started) / 1000;
	if (!cleanup && remaining <= 0) throw new Error("overall budget exhausted");
	const cap = cleanup ? capSeconds : Math.min(capSeconds, remaining);
	const t0 = Date.now();
	const child = spawn(command, args, {
		env: childEnv,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	groups.add(child);
	let output = "";
	child.stdout?.on("data", (c: Buffer) => {
		output += c.toString("utf8");
	});
	child.stderr?.on("data", (c: Buffer) => {
		output += c.toString("utf8");
	});
	const log = join(ROOT, "commands", `${++sequence}-${flat(name)}.log`);
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		signalGroup(child, "SIGKILL");
	}, cap * 1000);
	const code = await new Promise<number | null>((resolve) => {
		child.once("close", (rc) => {
			clearTimeout(timer);
			resolve(rc);
		});
	});
	await stop(child);
	writeFileSync(log, redact(output));
	records.push({
		name,
		rc: code,
		elapsedMs: Date.now() - t0,
		...(timedOut ? { deadlineExceeded: true } : {}),
		capSeconds: cap,
	});
	save();
	if (timedOut) throw new Error(`deadline exceeded (${name}, cap=${cap}s)`);
	if (code !== 0)
		throw new Error(
			`${name} failed rc=${code}: ${redact(output).trim().split("\n").at(-1)?.slice(0, 300)}`,
		);
	return output;
}

type Slot = {
	origin: string;
	scenario: string;
	sessionId: string;
	shutdown: () => Promise<void>;
	publisher: ChildProcess;
};

/** A mock relay on a unique `.local` name — `projects-create-ios-proof.ts`'s
 *  mechanism, for the same ATS reason (run 41554295782). */
async function startRelay(scenario: string): Promise<Slot> {
	const nonce = randomBytes(6).toString("hex");
	const name = `ccp-${scenario.replace(/[^a-z]/g, "")}-${nonce}`.slice(0, 40);
	const host = `${name}.local`;
	const relay = createRelay({ scenario, password, quiet: true });
	if (activityOnly && scenario === "subagent-running") {
		// A silent wait is the reported failure, not a missing activity field:
		// keep the producer-shaped frame busy and age the phase, so a blank
		// status cannot be mistaken for a legitimate unnamed/clockless phase.
		const projections = relay.state.world.projections ?? {};
		for (const [id, projection] of Object.entries(projections)) {
			projections[id] = activityWaitProjection(projection);
		}
	}
	// The historical run omitted the request ledger, so "Connected" followed
	// by an empty saved route could not be separated into auth vs transport.
	// The mock records only cookie presence, never its value.
	relay.state.journalAll = true;
	const handle = await relay.listen();
	const origin = `http://${host}:${handle.port}`;
	relay.state.allowedOrigins = [...(relay.state.allowedOrigins ?? []), origin];
	const publisher = spawn(
		"/usr/bin/dns-sd",
		[
			"-P",
			name,
			"_http._tcp",
			"local.",
			String(handle.port),
			host,
			"127.0.0.1",
		],
		{ env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	groups.add(publisher);
	// The scenario's own session id, read from the world rather than repeated
	// here, so a fixture change cannot leave the flow tapping a row that is gone.
	const sessionId = Object.keys(relay.state.world.projections ?? {})[0] ?? "";
	const slot: Slot = {
		origin,
		scenario,
		sessionId,
		publisher,
		shutdown: async () => {
			await relay.shutdown();
			writeFileSync(
				join(ROOT, `relay-${scenario}-requests.json`),
				JSON.stringify(
					relay.state.recorded.map(
						({ method, path, status, cookie, origin, note }) => ({
							method,
							path,
							status,
							cookie,
							origin,
							note,
						}),
					),
					null,
					2,
				),
			);
		},
	};
	let resolved = false;
	for (let i = 0; i < 30 && !resolved; i++) {
		try {
			const rows = await Promise.race([
				lookup(host, { all: true }),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("dns deadline")), 2000),
				),
			]);
			if (
				rows.length > 0 &&
				rows.every((r) => r.address === "127.0.0.1" || r.address === "::1")
			)
				resolved = true;
		} catch {
			await new Promise((r) => setTimeout(r, 250));
		}
	}
	if (!resolved) {
		await slot.shutdown();
		throw new Error(`owned ${host} did not resolve to loopback`);
	}
	const unauth = await fetch(`${origin}/api/sessions`, {
		signal: AbortSignal.timeout(5000),
	});
	await unauth.arrayBuffer();
	if (unauth.status !== 401) throw new Error("relay auth boundary failed");
	try {
		const preflight = await probeNativeRelay(origin, password, sessionId);
		note(
			`relay ${scenario} HOST preflight: ${JSON.stringify(preflight)}; native handoff not yet proven`,
		);
	} catch (error) {
		await slot.shutdown();
		throw error;
	}
	return slot;
}

/** Verify a zip's digest, then extract it with the shared archive-safety
 *  helper (no links, no traversal). Refuses before any native work. */
async function extract(
	zip: string,
	expected: string | undefined,
	into: string,
): Promise<{ app: string; bundleId: string }> {
	const digest = (
		await run(`zip-digest-${into}`, "shasum", ["-a", "256", zip], 60)
	).split(" ")[0];
	if (!expected || digest !== expected)
		throw new Error(
			`${into}: artifact digest differs from the expected digest`,
		);
	const dest = join(ROOT, into);
	if (existsSync(dest)) throw new Error("extraction root must be new");
	return JSON.parse(
		await run(
			`safe-extract-${into}`,
			"python3",
			["scripts/ci/account-routing-artifact.py", "extract", zip, dest],
			180,
		),
	) as { app: string; bundleId: string };
}

const owned: string[] = [];
const laneFailures: string[] = [];
const relays: Slot[] = [];
let failure: string | undefined;

type Listing = {
	runtimes: { identifier: string; version: string; isAvailable: boolean }[];
	devicetypes: { identifier: string; name: string }[];
};

/** The newest available iOS runtime whose major version is `major`. */
function runtimeFor(listing: Listing, major: number): string | null {
	const rows = listing.runtimes
		.filter(
			(r) =>
				r.isAvailable &&
				r.identifier.includes(".iOS-") &&
				Number(r.version.split(".")[0]) === major,
		)
		.sort((a, b) =>
			b.version.localeCompare(a.version, undefined, { numeric: true }),
		);
	return rows[0]?.identifier ?? null;
}

async function shot(udid: string, lane: string, name: string) {
	await run(
		`shot-${lane}-${name}`,
		"xcrun",
		[
			"simctl",
			"io",
			udid,
			"screenshot",
			join(ROOT, "frames", lane, `${name}.png`),
		],
		60,
	);
}

async function hierarchy(udid: string, lane: string, name: string) {
	const tree = await run(
		`hierarchy-${lane}-${name}`,
		"maestro",
		["--device", udid, "hierarchy"],
		120,
	);
	writeFileSync(
		join(ROOT, "hierarchies", `${flat(lane)}-${name}.json`),
		redact(tree),
	);
}

async function flow(
	udid: string,
	lane: string,
	bundle: string,
	relay: Slot,
	file: string,
	cap: number,
) {
	const flowLog = join(
		ROOT,
		"commands",
		`${sequence + 1}-${flat(`maestro-${lane}-${file}`)}.log`,
	);
	try {
		await run(
			`maestro-${lane}-${file}`,
			"maestro",
			[
				"--device",
				udid,
				"test",
				"-e",
				`APP_ID=${bundle}`,
				"-e",
				`RELAY_URL=${relay.origin}`,
				"-e",
				`RELAY_PASSWORD=${password}`,
				"-e",
				`SESSION_ID=${relay.sessionId}`,
				"--test-output-dir",
				join(ROOT, "maestro", lane, file),
				`e2e/maestro/chrome-proof/${file}`,
			],
			cap,
		);
	} catch (error) {
		try {
			await shot(udid, lane, `failure-${file.replace(".yaml", "")}`);
			await hierarchy(udid, lane, `failure-${file.replace(".yaml", "")}`);
		} catch {
			/* best effort; never masks the real error */
		}
		if (
			existsSync(flowLog) &&
			nativeConnectionPrerequisiteFailed(readFileSync(flowLog, "utf8"))
		)
			throw new Error(
				`native connection prerequisite failed: ${String(error)}`,
			);
		throw error;
	}
}

try {
	const head = await extract(ZIP, env.PROOF_NATIVE_ARTIFACT_SHA256, "app");
	const base = BASE_ZIP
		? await extract(BASE_ZIP, env.PROOF_BASE_ARTIFACT_SHA256, "base-app")
		: null;
	receipt.installed = { head, base };
	note(`extracted head=${head.app} base=${base?.app ?? "none"}`);

	const listing = JSON.parse(
		await run(
			"simulator-listing",
			"xcrun",
			["simctl", "list", "runtimes", "devicetypes", "--json"],
			120,
		),
	) as Listing;
	const ios26 = runtimeFor(listing, 26);
	const ios18 = runtimeFor(listing, 18);
	receipt.runtimes = { ios26, ios18 };
	if (!ios26) throw new Error("no iOS 26 runtime on this runner");
	note(
		`runtimes: ios26=${ios26} ios18=${ios18 ?? "ABSENT (fallback lane skipped)"}`,
	);

	// Two relays for the whole run: a working session with tasks/agents and a
	// queued message (the record's "streaming" state), and the idle world whose
	// home + sidebar are the empty/populated states.
	const working = await startRelay("subagent-running");
	relays.push(working);
	const idle = await startRelay("idle");
	relays.push(idle);
	note(`relays: working=${working.origin} idle=${idle.origin}`);

	receipt.activityOnly = activityOnly;
	for (const lane of plan.lanes) {
		const runtime = lane.os === 26 ? ios26 : ios18;
		const deviceType = listing.devicetypes.find(
			(d) => d.name === lane.device,
		)?.identifier;
		const laneReceipt: Record<string, unknown> = { ...lane, runtime };
		(receipt.lanes as unknown[]).push(laneReceipt);
		if (!runtime || !deviceType) {
			laneReceipt.verdict = `SKIPPED: ${!runtime ? `no iOS ${lane.os} runtime` : `no device type "${lane.device}"`}`;
			note(`${lane.id}: ${laneReceipt.verdict as string}`);
			save();
			continue;
		}
		const created = (
			await run(
				`create-${lane.id}`,
				"xcrun",
				[
					"simctl",
					"create",
					`CCP-${lane.id}-${randomBytes(4).toString("hex")}`,
					deviceType,
					runtime,
				],
				120,
			)
		).trim();
		if (!/^[0-9A-F-]{36}$/i.test(created)) throw new Error("unexpected UDID");
		owned.push(created);
		const udid = created;
		laneReceipt.udid = udid;
		await run(`boot-${lane.id}`, "xcrun", ["simctl", "boot", udid], 180);
		await run(
			`ready-${lane.id}`,
			"xcrun",
			["simctl", "bootstatus", udid, "-b"],
			600,
		);
		await run(
			`appearance-${lane.id}`,
			"xcrun",
			["simctl", "ui", udid, "appearance", lane.theme],
			60,
		);
		if (lane.reduceTransparency) {
			/* Reduce Transparency through the simulator's accessibility domain. The
			 *  app reads it via AccessibilityInfo at mount, so it is set BEFORE the
			 *  install/launch. If the defaults key is not honoured on this runtime
			 *  the frame will still show glass — the receipt records the attempt and
			 *  the reviewer judges the pixels, never this step's exit code. */
			await run(
				`reduce-transparency-${lane.id}`,
				"xcrun",
				[
					"simctl",
					"spawn",
					udid,
					"defaults",
					"write",
					"com.apple.Accessibility",
					"EnhancedBackgroundContrastEnabled",
					"-bool",
					"true",
				],
				60,
			);
		}
		const builds = [
			...(lane.before && base ? [{ tag: "before", ...base }] : []),
			{ tag: "after", ...head },
		];
		try {
			for (const build of builds) {
				const dir = `${lane.id}/${build.tag}`;
				mkdirSync(join(ROOT, "frames", dir), { recursive: true });
				await run(
					`install-${lane.id}-${build.tag}`,
					"xcrun",
					["simctl", "install", udid, build.app],
					180,
				);
				// Session first, then the home and the sidebar on the idle relay. The
				// frame and the hierarchy are taken here, outside the flow, so a frame
				// is never Maestro's own screenshot of a transition.
				for (const [file, relay, frame, cap] of [
					["session.yaml", working, "session", 900],
					["session-keyboard.yaml", working, "session-keyboard", 300],
					["home.yaml", idle, "home", 600],
					["sidebar.yaml", idle, "sidebar", 300],
				] as const) {
					if (!plan.frames.includes(frame)) continue;
					await flow(udid, dir, build.bundleId, relay, file, cap);
					await shot(udid, dir, frame);
					await hierarchy(udid, dir, frame);
				}
				await run(
					`uninstall-${lane.id}-${build.tag}`,
					"xcrun",
					["simctl", "uninstall", udid, build.bundleId],
					120,
				);
			}
			laneReceipt.frames = collectChromeFrames(
				join(ROOT, "frames", lane.id),
				plan.frames,
			);
			laneReceipt.verdict = "CAPTURED";
		} catch (error) {
			// A failed initial session flow is failed connection/setup, NOT a
			// geometry finding. Stop before fanning the same broken prerequisite
			// out to every phone (Q163-2); finally still reaps owned resources.
			if (String(error).includes("native connection prerequisite failed"))
				throw error;
			/* One lane's failure must not cost the others their frames: the record
			 *  asks for a device matrix, and a flaky SE boot is not evidence about
			 *  the Pro Max. The run still FAILS overall (see below). */
			laneReceipt.verdict = `FAIL: ${String(error).slice(0, 300)}`;
			laneFailures.push(lane.id);
		}
		note(`${lane.id}: ${laneReceipt.verdict as string}`);
		await run(
			`shutdown-${lane.id}`,
			"xcrun",
			["simctl", "shutdown", udid],
			120,
			true,
		).catch(() => undefined);
		save();
	}
	if (laneFailures.length > 0)
		throw new Error(`lanes failed: ${laneFailures.join(",")}`);
	receipt.verdict =
		"CAPTURED (presence assertions only; geometry is measured from the hierarchies and the PNGs)";
} catch (error) {
	failure = error instanceof Error ? error.message : String(error);
	receipt.verdict = `FAIL: ${failure}`;
	note(`FAIL ${failure}`);
} finally {
	const failures: string[] = [];
	for (const relay of relays) {
		try {
			await relay.shutdown();
		} catch {
			failures.push("relay-shutdown");
		}
		await stop(relay.publisher);
	}
	for (const udid of owned) {
		for (const [name, args] of [
			["shutdown-owned-simulator", ["simctl", "shutdown", udid]],
			["delete-owned-simulator", ["simctl", "delete", udid]],
		] as const) {
			try {
				await run(name, "xcrun", [...args], 120, true);
			} catch (error) {
				if (
					!/Unable to find device|Invalid device|current state: Shutdown/i.test(
						String(error),
					)
				)
					failures.push(`${name}:${udid}`);
			}
		}
	}
	for (const child of [...groups]) await stop(child);
	receipt.cleanup = {
		failures,
		allOwnedResourcesReaped: failures.length === 0,
	};
	receipt.completedAt = new Date().toISOString();
	save();
	if (failures.length) failure ??= `cleanup incomplete: ${failures.join(",")}`;
}
process.exit(failure ? 1 : 0);
