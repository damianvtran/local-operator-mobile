#!/usr/bin/env node
/**
 * Targeted NATIVE iOS proof that the project-create sheet renders in Urdu.
 *
 *     node scripts/ci/projects-create-ios-proof.ts   (hosted macOS only; see docs/ci.md)
 *
 * WHY THIS EXISTS. PR #150 localised the sheet and its web-export evidence is
 * strong, but Urdu is right-to-left, uses a script whose shaping differs on
 * native text engines, and the developer host has no simulator, so a native frame
 * was the one missing piece. This runs ONE fixed walk on a fresh iOS simulator
 * against an artifact that was ALREADY BUILT, and uploads what it saw.
 *
 * CONSTRAINTS THAT SHAPE THE CODE
 *  - It never builds. The workflow downloads the already-built `ios-simulator`
 *    artifact (the token is used by that download step only); this process runs
 *    with an allowlisted environment that carries NO GitHub token and no
 *    credential of any kind. The relay password is a run-only random value.
 *  - The app takes its language from the RELAY's config stream, not the device
 *    locale, and the stream does not push later changes: the relay therefore
 *    starts with `--language ur` BEFORE the app connects. A second relay serving
 *    `en` runs the same walk as a NEGATIVE CONTROL, so a silent English fallback
 *    (or a harness that always shows Urdu) cannot pass.
 *  - It never submits the form: nothing is written to the relay.
 *  - Every operation has a deadline and runs in its own process group; the
 *    owned simulator and relays are always torn down, and the receipt, command
 *    log, hierarchy dumps and PNGs survive a failure.
 *  - It is NOT the account-routing proof (which is pinned to another product,
 *    repository SHA and artifact) and shares only the archive-safety helper.
 *
 * A pass is native-SIMULATOR evidence for these frames. It says nothing about a
 * physical device, other locales, or the rest of the app; reviewers must view the
 * PNGs, because assertions prove strings are present, not that they look right.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const need = (name: string): string => {
	const value = env[name];
	if (!value) throw new Error(`missing ${name}`);
	return value;
};
const RUNNER_TEMP = need("RUNNER_TEMP");
const ROOT = join(RUNNER_TEMP, "projects-create-proof");
const ZIP = need("PROOF_ARTIFACT_ZIP");
const PASSWORD_FILE = need("PROOF_PASSWORD_FILE");
const BUDGET_SECONDS = 45 * 60;
const started = Date.now();

if (
	env.GITHUB_ACTIONS !== "true" ||
	env.RUNNER_OS !== "macOS" ||
	env.RUNNER_ENVIRONMENT !== "github-hosted" ||
	env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
	env.PROOF_MODE !== "projects-create-ios-proof"
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
	mode: "projects-create-ios-proof",
	sourceSha: env.GITHUB_SHA,
	runId: env.GITHUB_RUN_ID,
	artifact: {
		runId: env.PROOF_NATIVE_RUN_ID,
		name: env.PROOF_NATIVE_ARTIFACT_NAME,
		expectedSha256: env.PROOF_NATIVE_ARTIFACT_SHA256,
		// Stated by the dispatcher, NOT re-derived here: the artifact was built from
		// a merge ref whose tree equals the PR head's tree. Never read this as
		// literal-head provenance.
		provenanceNote: env.PROOF_PROVENANCE_NOTE ?? "",
	},
	scope:
		"native iOS SIMULATOR, one fixed walk, no submit, no physical device, not full E2E",
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

/** A long-lived relay in its own group; the port arrives on stdout. */
async function startRelay(
	language: string,
): Promise<{ port: number; child: ChildProcess }> {
	const child = spawn(
		"node",
		[
			"tools/mock-relay/relay.ts",
			"--scenario",
			"projects-populated",
			"--language",
			language,
			"--password",
			password,
			"--print-port",
			"--quiet",
		],
		{ env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	groups.add(child);
	let out = "";
	let err = "";
	child.stdout?.on("data", (c: Buffer) => {
		out += c.toString("utf8");
	});
	child.stderr?.on("data", (c: Buffer) => {
		err += c.toString("utf8");
	});
	for (let i = 0; i < 120; i++) {
		const port = Number(out.split("\n")[0]);
		if (Number.isInteger(port) && port > 0) return { port, child };
		await new Promise((r) => setTimeout(r, 500));
	}
	writeFileSync(join(ROOT, "commands", `relay-${language}.err`), redact(err));
	throw new Error(`relay (${language}) never printed a port`);
}

let udid: string | undefined;
const relays: ChildProcess[] = [];
let failure: string | undefined;

async function flowRun(
	label: string,
	relayPort: number,
	file: string,
	cap: number,
) {
	const shots = join(ROOT, "frames", label);
	mkdirSync(shots, { recursive: true });
	const bundle = (receipt.installed as { bundleId: string }).bundleId;
	await run(
		`maestro-${label}`,
		"maestro",
		[
			"--device",
			udid as string,
			"test",
			"--config",
			"e2e/maestro/projects-create-proof/config.yaml",
			"-e",
			`APP_ID=${bundle}`,
			"-e",
			`RELAY_URL=http://127.0.0.1:${relayPort}`,
			"-e",
			`RELAY_PASSWORD=${password}`,
			"-e",
			`SHOT_DIR=${shots}`,
			"--test-output-dir",
			join(ROOT, "maestro", label),
			`e2e/maestro/projects-create-proof/${file}`,
		],
		cap,
	);
	// The native accessibility tree of the final (open-sheet) state.
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
				`PCP-${randomBytes(6).toString("hex")}`,
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

	const ur = await startRelay("ur");
	relays.push(ur.child);
	const en = await startRelay("en");
	relays.push(en.child);
	note(`relays: ur=${ur.port} en=${en.port}`);

	// Light then dark for Urdu; the English control runs once. The first maestro
	// call also pays the cold driver start, hence its larger cap.
	await run(
		"appearance-light",
		"xcrun",
		["simctl", "ui", udid, "appearance", "light"],
		60,
	);
	await flowRun("ur-light", ur.port, "urdu-sheet.yaml", 900);
	await run(
		"appearance-dark",
		"xcrun",
		["simctl", "ui", udid, "appearance", "dark"],
		60,
	);
	await flowRun("ur-dark", ur.port, "urdu-sheet.yaml", 300);
	await run(
		"appearance-light-2",
		"xcrun",
		["simctl", "ui", udid, "appearance", "light"],
		60,
	);
	await flowRun("en-control", en.port, "english-control.yaml", 300);
	receipt.verdict = "PASS (assertions only; reviewers must view the PNGs)";
} catch (error) {
	failure = error instanceof Error ? error.message : String(error);
	receipt.verdict = `FAIL: ${failure}`;
	note(`FAIL ${failure}`);
} finally {
	const failures: string[] = [];
	for (const relay of relays) await stop(relay);
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
