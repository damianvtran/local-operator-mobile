/**
 * Targeted NATIVE iOS proof for the theme picker and the shipped palettes.
 *
 *     node scripts/ci/theme-ios-proof.ts   (hosted macOS only; see docs/ci.md)
 *
 * WHY THIS EXISTS. The theme PR (decision record `mobile-design-direction.md`
 * § 7, PR 2) owes rendered frames: the picker in each mode, a search, the
 * selected card, and home + session in seven themes. Its runtime decision —
 * `Uniwind.updateCSSVariables` re-rendering MOUNTED styles — is read from the
 * library's source but has never been observed on a device, and the developer
 * host has no simulator. This runs ONE fixed walk on a fresh iOS simulator
 * against the artifact this PR's own iOS job ALREADY BUILT, and uploads what it
 * saw.
 *
 * A clone of `projects-create-ios-proof.ts`, with the same constraints:
 *  - It never builds. The workflow downloads the `ios-simulator` artifact by
 *    run id and digest (the token is used by that download step only); this
 *    process runs with an allowlisted environment carrying NO token.
 *  - The relay password is a run-only random value; the relay serves the
 *    `idle` scenario (one conversation), reached over a unique `.local` name.
 *  - Every operation has a deadline and its own process group; the owned
 *    simulator and relay are always torn down, and the receipt, command log,
 *    hierarchy dump and PNGs survive a failure.
 *  - Every theme is applied by TAPPING ITS CARD in the picker, so a frame proves
 *    the real path (picker -> store -> updateCSSVariables -> mounted screens),
 *    and the runner refuses an incomplete frame set.
 *
 * A pass is native-SIMULATOR evidence for these frames. Reviewers must view the
 * PNGs: assertions prove the selected state, not that a palette looks right.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSavedRouteDiagnostics } from "../../src/features/auth/saved-route-diagnostics.ts";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import { probeNativeRelay } from "./native-relay-preflight.ts";
import { collectThemeFrames, copyThemeFrames } from "./theme-proof-contract.ts";

const env = process.env;
const need = (name: string): string => {
	const value = env[name];
	if (!value) throw new Error(`missing ${name}`);
	return value;
};
const RUNNER_TEMP = need("RUNNER_TEMP");
const ROOT = join(RUNNER_TEMP, "theme-proof");
const ZIP = need("PROOF_ARTIFACT_ZIP");
const PASSWORD_FILE = need("PROOF_PASSWORD_FILE");
const BUDGET_SECONDS = 45 * 60;
const started = Date.now();

if (
	env.GITHUB_ACTIONS !== "true" ||
	env.RUNNER_OS !== "macOS" ||
	env.RUNNER_ENVIRONMENT !== "github-hosted" ||
	env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
	env.PROOF_MODE !== "theme-ios-proof"
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
	mode: "theme-ios-proof",
	sourceSha: env.GITHUB_SHA,
	runId: env.GITHUB_RUN_ID,
	artifact: {
		runId: env.PROOF_NATIVE_RUN_ID,
		name: env.PROOF_NATIVE_ARTIFACT_NAME,
		expectedSha256: env.PROOF_NATIVE_ARTIFACT_SHA256,
		// Stated by the dispatcher, NOT re-derived here (which run built it, from
		// which ref). Never read this as literal-head provenance.
		provenanceNote: env.PROOF_PROVENANCE_NOTE ?? "",
	},
	scope:
		"native iOS SIMULATOR, one fixed walk, theme picker + 7 themes, no physical device, not full E2E",
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

let sequence = 0;
/** One bounded operation in its own process group. A deadline kills the group,
 *  keeps the partial log and is recorded as a deadline, never as an exit code. */
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
	const log = join(ROOT, "commands", `${++sequence}-${name}.log`);
	let timedOut = false;
	const code = await new Promise<number | null>((resolve) => {
		const timer = setTimeout(() => {
			timedOut = true;
			void stop(child).then(() => resolve(null));
		}, cap * 1000);
		child.once("error", () => resolve(127));
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
	shutdown: () => Promise<void>;
	publisher: ChildProcess;
};

/** A relay reachable by a unique `.local` name, the SAME mechanism the
 *  account-routing iOS proof uses.
 *
 *  WHY NOT 127.0.0.1 (run 41554295782 failed there). The built app's ATS is
 *  `NSAllowsLocalNetworking` plus CIDR exceptions for 10/8, 100.64/10,
 *  169.254/16, 172.16/12 and 192.168/16 — 127.0.0.0/8 is not among them — and
 *  ADR 0002 §5/§7 records that a literal-IP exception is unsettled on iOS. A
 *  `.local` name is what `NSAllowsLocalNetworking` is documented to admit, so a
 *  Bonjour record (`dns-sd -P`) points a unique name at the loopback listener.
 *  No ATS widening, no app change. The relay admits exactly this origin on the
 *  port the kernel chose, added after `listen()` and before any client connects. */
async function startRelay(language: string): Promise<Slot> {
	const nonce = randomBytes(6).toString("hex");
	const name = `thp-${language}-${nonce}`;
	const host = `${name}.local`;
	const relay = createRelay({
		scenario: "idle",
		language,
		password,
		quiet: true,
	});
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
	const slot: Slot = {
		origin,
		publisher,
		shutdown: async () => {
			await relay.shutdown();
			writeFileSync(
				join(ROOT, `relay-${language}-requests.json`),
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
	// Auth boundary: unauthenticated GET must be refused, not served.
	const unauth = await fetch(`${origin}/api/sessions`, {
		signal: AbortSignal.timeout(5000),
	});
	await unauth.arrayBuffer();
	if (unauth.status !== 401) throw new Error("relay auth boundary failed");
	try {
		const preflight = await probeNativeRelay(
			origin,
			password,
			Object.keys(relay.state.world.projections ?? {})[0],
		);
		note(
			`relay ${language} HOST preflight: ${JSON.stringify(preflight)}; native handoff not yet proven`,
		);
	} catch (error) {
		await slot.shutdown();
		throw error;
	}
	return slot;
}

let udid: string | undefined;
const relays: Slot[] = [];
let failure: string | undefined;

/** Failure-time evidence, taken BEFORE teardown: the screen the driver was
 *  actually looking at. Best effort and bounded; it never masks the real error. */
async function captureFailure(label: string) {
	if (!udid) return;
	try {
		await run(
			`failure-screenshot-${label}`,
			"xcrun",
			[
				"simctl",
				"io",
				udid,
				"screenshot",
				join(ROOT, "frames", `failure-${label}.png`),
			],
			60,
		);
	} catch (error) {
		note(`failure screenshot unavailable: ${String(error).slice(0, 200)}`);
	}
	try {
		const tree = await run(
			`failure-hierarchy-${label}`,
			"maestro",
			["--device", udid, "hierarchy"],
			120,
		);
		writeFileSync(
			join(ROOT, "hierarchies", `failure-${label}.txt`),
			redact(tree),
		);
	} catch (error) {
		note(`failure hierarchy unavailable: ${String(error).slice(0, 200)}`);
	}
}

async function flowRun(
	label: string,
	relayOrigin: string,
	file: string,
	cap: number,
) {
	const shots = join(ROOT, "frames", label);
	mkdirSync(shots, { recursive: true });
	const bundle = (receipt.installed as { bundleId: string }).bundleId;
	// Installed React Native RCTLog.mm maps console.info to OS_LOG_TYPE_INFO,
	// which os_log may discard unless needed. Subscribe BEFORE app launch rather
	// than hoping a post-failure `log show` retained it. No log config is changed.
	const nativeTrace = spawn(
		"xcrun",
		[
			"simctl",
			"spawn",
			udid as string,
			"log",
			"stream",
			"--level",
			"info",
			"--style",
			"compact",
			"--predicate",
			'eventMessage CONTAINS "[saved-route]"',
		],
		{ env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	groups.add(nativeTrace);
	nativeTrace.stderr?.resume(); // Drain/discard; never persist unsanitized native text.
	const events: ReturnType<typeof parseSavedRouteDiagnostics> = [];
	let pending = "";
	nativeTrace.on("error", () => note("saved-route native logger unavailable"));
	nativeTrace.stdout?.on("data", (chunk: Buffer) => {
		pending += chunk.toString("utf8");
		const end = pending.lastIndexOf("\n");
		if (end >= 0) {
			// Sanitize before retention: no raw native text is written to disk.
			events.push(
				...parseSavedRouteDiagnostics(pending.slice(0, end)).slice(
					0,
					64 - events.length,
				),
			);
			pending = pending.slice(end + 1);
		}
		pending = pending.slice(-65536);
	});
	try {
		await run(
			`maestro-${label}`,
			"maestro",
			[
				"--device",
				udid as string,
				"test",
				"--config",
				"e2e/maestro/theme-proof/config.yaml",
				"-e",
				`APP_ID=${bundle}`,
				"-e",
				`RELAY_URL=${relayOrigin}`,
				"-e",
				`RELAY_PASSWORD=${password}`,
				"--test-output-dir",
				join(ROOT, "maestro", label),
				`e2e/maestro/theme-proof/${file}`,
			],
			cap,
		);
	} catch (error) {
		await captureFailure(label);
		throw error;
	} finally {
		// Maestro has already captured successful earlier steps when a later
		// prerequisite fails. Preserve them before the driver/runner is reaped;
		// the strict collector below still refuses incomplete successful walks.
		try {
			const partial = copyThemeFrames(join(ROOT, "maestro", label), shots);
			note(`preserved ${label}: ${partial.join(",")}`);
		} catch (error) {
			// An early driver failure may not create its output directory. Do not
			// replace the original failure with a secondary evidence-copy error.
			note(
				`partial frame preservation unavailable: ${String(error).slice(0, 200)}`,
			);
		}
		try {
			await stop(nativeTrace);
			events.push(
				...parseSavedRouteDiagnostics(pending).slice(0, 64 - events.length),
			);
			receipt.savedRouteDiagnostics = events;
			receipt.savedRouteDiagnosticsAvailable = events.length > 0;
			writeFileSync(
				join(ROOT, "commands", `saved-route-${label}.log`),
				JSON.stringify(events, null, 2),
			);
		} catch {
			note("saved-route diagnostic preservation unavailable");
		}
	}
	const frames = collectThemeFrames(join(ROOT, "maestro", label), shots);
	note(`collected ${label}: ${frames.join(",")}`);
	// Final picker hierarchy reads the persisted slot after the cold restart.
	const tree = await run(
		`hierarchy-${label}`,
		"maestro",
		["--device", udid as string, "hierarchy"],
		120,
	);
	writeFileSync(join(ROOT, "hierarchies", `${label}.txt`), redact(tree));
	note(`PASS ${label}`);
}

try {
	// Source and archive controls first: refuse a digest mismatch before any native work.
	const digest = (
		await run("zip-digest", "shasum", ["-a", "256", ZIP], 60)
	).split(" ")[0];
	receipt.zipSha256 = digest;
	if (digest !== env.PROOF_NATIVE_ARTIFACT_SHA256)
		throw new Error("artifact digest differs from the expected digest");
	const dest = join(ROOT, "app");
	if (existsSync(dest)) throw new Error("extraction root must be new");
	receipt.installed = JSON.parse(
		await run(
			"safe-extract",
			"python3",
			["scripts/ci/account-routing-artifact.py", "extract", ZIP, dest],
			180,
		),
	);
	const app = (receipt.installed as { app: string }).app;
	note(`extracted app ${app}`);

	const selection = await run(
		"existing-simulator-selector",
		"node",
		["scripts/ci/ios-simulator.ts", "--prefer", "iPhone 17"],
		600,
	);
	const selected = /^udid=(.+)$/m.exec(selection)?.[1];
	if (!selected) throw new Error("no existing simulator selected");
	const listing = JSON.parse(
		await run(
			"simulator-listing",
			"xcrun",
			["simctl", "list", "devices", "available", "--json"],
			120,
		),
	) as {
		devices: Record<string, { udid: string; deviceTypeIdentifier?: string }[]>;
	};
	let runtime = "";
	let deviceType = "";
	for (const [key, rows] of Object.entries(listing.devices))
		for (const row of rows)
			if (row.udid === selected && row.deviceTypeIdentifier) {
				runtime = key;
				deviceType = row.deviceTypeIdentifier;
			}
	if (!runtime) throw new Error("device runtime metadata unavailable");
	const created = (
		await run(
			"create-owned-simulator",
			"xcrun",
			[
				"simctl",
				"create",
				`THP-${randomBytes(6).toString("hex")}`,
				deviceType,
				runtime,
			],
			120,
		)
	).trim();
	if (!/^[0-9A-F-]{36}$/i.test(created)) throw new Error("unexpected UDID");
	udid = created;
	receipt.simulator = { udid, runtime, deviceType, freshOwned: true };
	await run("boot", "xcrun", ["simctl", "boot", udid], 180);
	await run("boot-ready", "xcrun", ["simctl", "bootstatus", udid, "-b"], 600);
	await run("install", "xcrun", ["simctl", "install", udid, app], 180);

	const relay = await startRelay("en");
	relays.push(relay);
	note(`relay: ${relay.origin}`);

	// The OS on LIGHT, so the System-mode frames show the light slot and every
	// dark frame is the app's own forced choice rather than the simulator's.
	// The first maestro call pays the cold driver start; one walk, so one cap.
	await run(
		"appearance-light",
		"xcrun",
		["simctl", "ui", udid, "appearance", "light"],
		60,
	);
	await flowRun("matrix", relay.origin, "theme-matrix.yaml", 2100);
	receipt.verdict = "PASS (assertions only; reviewers must view the PNGs)";
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
	if (udid) {
		for (const [name, args] of [
			["shutdown-owned-simulator", ["simctl", "shutdown", udid]],
			["delete-owned-simulator", ["simctl", "delete", udid]],
		] as const) {
			try {
				await run(name, "xcrun", [...args], 120, true);
			} catch (error) {
				// Nothing-left-to-do wording is a success; anything else is reported.
				if (
					!/Unable to find device|Invalid device|current state: Shutdown/i.test(
						String(error),
					)
				)
					failures.push(name);
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
