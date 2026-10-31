#!/usr/bin/env node
/** Bounded native primitive proof host. Never run implicitly: workflow opt-in,
 * reviewed exact ref and dedicated unsigned artifact are prerequisites. No SDK
 * installation, device erase, credential file, keychain dump or provider claim. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertInstalledArtifact,
	assertOwnedLease,
	assertProofBuild,
	assertRestartIdentity,
	assertRetiredRestore,
	classifyVerifierResult,
	type ProofBuildIdentity,
	type ProofProcessIdentity,
} from "./auth-retirement-proof-contract.ts";

import {
	createFromIntent,
	prepareCreation,
	type Run,
	recoverCreation,
} from "./auth-retirement-simulator.ts";

const PROOF_ID = "com.localoperator.mobile.retirementproof";
const FLAVOR = "auth-retirement-proof";
/** Deliberately non-rotating synthetic protocol. Returned values are never
 * redacted in transport; only the evidence boundary omits token-shaped fields. */
export function syntheticTokenReply(refresh: string): Record<string, unknown> {
	if (refresh !== "synthetic-proof-refresh")
		throw new Error("Unexpected synthetic grant");
	return {
		access_token: `proof.${Buffer.from(JSON.stringify({ sub: "native-proof-account" })).toString("base64url")}.unsigned-synthetic`,
		refresh_token: refresh,
		expires_in: 3600,
		token_type: "Bearer",
		scope: "openid",
	};
}
/** Hash immutable .app content, not the simulator's mutable data container.
 * Canonical relative names and symlink targets are included, never followed. */
export function immutableBundleDigest(app: string): string {
	const hash = createHash("sha256");
	function walk(dir: string, prefix: string) {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name),
				relative = prefix + name,
				stat = lstatSync(path);
			if (stat.isSymbolicLink())
				hash.update(JSON.stringify(["link", relative, readlinkSync(path)]));
			else if (stat.isDirectory()) walk(path, relative + "/");
			else if (stat.isFile())
				hash.update(
					JSON.stringify([
						"file",
						relative,
						createHash("sha256").update(readFileSync(path)).digest("hex"),
					]),
				);
			else throw new Error("Unknown artifact entry");
		}
	}
	walk(app, "");
	return hash.digest("hex");
}
export function assertFrozenContent(
	app: string,
	frozen: ProofBuildIdentity,
): void {
	assertInstalledArtifact(
		{ ...frozen, bundleSha256: immutableBundleDigest(app) },
		frozen,
	);
}
async function measureArtifact(app: string): Promise<ProofBuildIdentity> {
	const info = JSON.parse(
		await command("plutil", [
			"-convert",
			"json",
			"-o",
			"-",
			join(app, "Info.plist"),
		]),
	) as Record<string, string>;
	return {
		flavor: info.LORetirementProofFlavor!,
		bundleId: info.CFBundleIdentifier!,
		nonce: info.LORetirementProofNonce!,
		sourceSha: info.LORetirementProofSource!,
		bundleSha256: immutableBundleDigest(app),
	};
}
export async function freezeArtifact(app: string, root: string): Promise<void> {
	requireManualProof();
	const expected = JSON.parse(
		readFileSync(join(root, "build-identity.json"), "utf8"),
	);
	const actual = await measureArtifact(app);
	// Build identity had no compiled digest. Freeze once BEFORE installation;
	// every subsequent admission uses this independent immutable receipt.
	assertProofBuild(actual, { ...expected, bundleSha256: actual.bundleSha256 });
	writeFileSync(
		join(root, "frozen-artifact.json"),
		JSON.stringify({ ...actual, appPath: realpathSync(app) }),
		{ flag: "wx" },
	);
}
function requireManualProof(): void {
	if (
		process.env.GITHUB_ACTIONS !== "true" ||
		!/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") ||
		process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
		process.env.RETIREMENT_PROOF !== "true"
	)
		throw new Error("Manual proof opt-in required");
}
export function verifierProcess(
	file: string,
	options: { executable?: string; prefix?: string[]; timeout?: number } = {},
): ReturnType<typeof classifyVerifierResult> {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([k]) => !k.startsWith("CMUX_") && k !== "XPC_FLAGS",
		),
	);
	const result = spawnSync(
		options.executable ?? process.execPath,
		[
			...(options.prefix ?? []),
			fileURLToPath(import.meta.url),
			"--assert-retired",
			file,
		],
		{
			env: { ...env, NODE_ENV: process.env.NODE_ENV ?? "test" },
			encoding: "utf8",
			timeout: options.timeout ?? 10000,
			killSignal: "SIGKILL",
		},
	);
	return classifyVerifierResult({
		status: result.status,
		signal: result.signal,
		error: !!result.error,
		stdout: result.stdout ?? "",
	});
}
export async function command(
	executable: string,
	args: string[],
	timeout = 30000,
	beforeStart?: (pid: number) => void,
): Promise<string> {
	return new Promise((yes, no) => {
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([k]) => !k.startsWith("CMUX_") && k !== "XPC_FLAGS",
			),
		);
		// A create client cannot issue its service request until its group PID
		// is durably journaled. Host death before release leaves an inert wrapper;
		// EOF exits it, and timeout still reaps this exact owned process group.
		const gateCode = `const {spawn}=require('node:child_process');let released=false;process.stdin.once('data',()=>{released=true;const c=spawn(${JSON.stringify(executable)},${JSON.stringify(args)},{stdio:['ignore','pipe','pipe']});c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);c.on('error',()=>process.exit(125));c.on('exit',(code)=>process.exit(code??125));});process.stdin.on('end',()=>{if(!released)process.exit(125);});`;
		const child = spawn(
			beforeStart ? process.execPath : executable,
			beforeStart ? ["-e", gateCode] : args,
			{
				env: { ...env, NODE_ENV: process.env.NODE_ENV ?? "test" },
				detached: true,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		let output = "",
			timedOut = false,
			done = false;
		const kill = () => {
			if (child.pid)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					/* already exited */
				}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeout);
		child.stdout.on("data", (b) => {
			output += b;
			if (output.length > 1024 * 1024) kill();
		});
		// Errors deliberately exclude command output/args: no accidental native log
		// or controlled token response may enter uploaded evidence.
		child.stderr.resume();
		child.on("error", () => {
			clearTimeout(timer);
			kill();
			if (!done) {
				done = true;
				no(new Error("Proof subprocess could not start"));
			}
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			kill();
			if (done) return;
			done = true;
			if (code !== 0 || timedOut)
				no(new Error("Proof subprocess failed or timed out"));
			else yes(output.trim());
		});
		if (beforeStart) {
			try {
				if (!child.pid) throw new Error("No gated client PID");
				beforeStart(child.pid);
				child.stdin.end("go");
			} catch {
				kill();
				clearTimeout(timer);
				done = true;
				no(new Error("Creation PID journal failed before native request"));
			}
		} else child.stdin.end();
	});
}

export async function prepareProofBuild(root: string): Promise<void> {
	if (
		process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
		process.env.RETIREMENT_PROOF !== "true"
	)
		throw new Error("Manual proof opt-in required");
	if (await command("git", ["status", "--porcelain"]))
		throw new Error("Proof source must start clean");
	const sourceSha = await command("git", ["rev-parse", "HEAD"]);
	const nonce = randomBytes(16).toString("hex");
	mkdirSync(root, { recursive: true });
	const identity = { flavor: FLAVOR, bundleId: PROOF_ID, sourceSha, nonce };
	writeFileSync(join(root, "build-identity.json"), JSON.stringify(identity));
	/* Only this ephemeral CI worktree is rewritten. Ordinary tracked entry and
	 * config do NOT gain a flag, route, seed command or browser-auth override. */
	const entry = "auth-retirement-proof.entry.js";
	writeFileSync(
		entry,
		`import React from 'react';\nimport { registerRootComponent } from 'expo';\nimport { View } from 'react-native';\nimport { installAuthRetirementProof } from './src/testing/auth-retirement-proof';\ninstallAuthRetirementProof();\nregisterRootComponent(function RetirementProof(){return React.createElement(View,{style:{flex:1,backgroundColor:'#ffffff'}});});\n`,
	);
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	pkg.main = `./${entry}`;
	writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
	const config = readFileSync("app.config.ts", "utf8");
	const replacement = `config.ios = { ...config.ios, bundleIdentifier: ${JSON.stringify(PROOF_ID)}, infoPlist: { ...config.ios?.infoPlist, LORetirementProofFlavor: ${JSON.stringify(FLAVOR)}, LORetirementProofNonce: ${JSON.stringify(nonce)}, LORetirementProofSource: ${JSON.stringify(sourceSha)} } };\nconfig.scheme = 'loretirementproof';\nexport default config;`;
	if (!config.endsWith("export default config;\n"))
		throw new Error("Unknown app config export shape");
	writeFileSync(
		"app.config.ts",
		config.replace("export default config;", replacement),
	);
	const envFile = process.env.GITHUB_ENV;
	if (!envFile) throw new Error("CI environment output required");
	appendFileSync(
		envFile,
		`EXPO_PUBLIC_RETIREMENT_PROOF_FLAVOR=${FLAVOR}\nEXPO_PUBLIC_RETIREMENT_PROOF_NONCE=${nonce}\nEXPO_PUBLIC_RETIREMENT_PROOF_SOURCE=${sourceSha}\n`,
	);
}

/** Receiver keeps credential bodies in memory only, returns coarse observations.
 * It binds loopback, validates nonce, caps input, and never logs request bodies. */
export async function runNativeProof(
	app: string,
	root: string,
	templateUdid: string,
): Promise<void> {
	requireManualProof();
	if (process.platform !== "darwin")
		throw new Error("Native CI runner required");
	const frozen = JSON.parse(
		readFileSync(join(root, "frozen-artifact.json"), "utf8"),
	) as ProofBuildIdentity & { appPath: string };
	if (realpathSync(app) !== frozen.appPath)
		throw new Error("Candidate path differs from frozen build");
	assertFrozenContent(app, frozen);
	assertInstalledArtifact(await measureArtifact(app), frozen);
	if ((await command("git", ["rev-parse", "HEAD"])) !== frozen.sourceSha)
		throw new Error("Source revision mismatch");
	const bundle = readFileSync(join(app, "main.jsbundle"));
	for (const marker of [frozen.nonce, frozen.sourceSha, FLAVOR])
		if (!bundle.includes(Buffer.from(marker)))
			throw new Error("Compiled proof marker absent");
	// The incoming UDID is read-only template metadata, NEVER execution/cleanup
	// authority. Create a new device and keep the resulting lease private to us.
	const devices = JSON.parse(
		await command("xcrun", [
			"simctl",
			"list",
			"devices",
			"available",
			"--json",
		]),
	) as { devices: Record<string, Array<{ udid: string; name: string }>> };
	const template = Object.entries(devices.devices).flatMap(
		([runtime, values]) =>
			values
				.filter((d) => d.udid === templateUdid)
				.map((d) => ({ ...d, runtime })),
	)[0];
	if (!template) throw new Error("Device template unavailable");
	const types = JSON.parse(
		await command("xcrun", ["simctl", "list", "devicetypes", "--json"]),
	) as { devicetypes: Array<{ name: string; identifier: string }> };
	const type = types.devicetypes.find((d) => d.name === template.name);
	if (!type) throw new Error("Template device type unavailable");
	const intent = prepareCreation(root, {
		nonce: frozen.nonce,
		runId: process.env.GITHUB_RUN_ID!,
		hostPid: process.pid,
		runtime: template.runtime,
		deviceType: type.identifier,
		templateUdid,
	});
	let udid = "";
	let owned: { udid: string; hostPid: number; nonce: string; runId: string };

	const actual = frozen;
	// All cleanup after lease creation lives under finally, including setup
	// failure. No arbitrary persisted lease is ever loaded as deletion authority.
	let cleanupFailed = false;
	let phaseFailed: unknown;
	try {
		owned = await createFromIntent(root, intent, command);
		udid = owned.udid;
		await command("xcrun", ["simctl", "boot", udid]);
		await command("xcrun", ["simctl", "bootstatus", udid, "-b"], 90000);
		assertInstalledArtifact(await measureArtifact(frozen.appPath), frozen);
		await command("xcrun", ["simctl", "install", udid, frozen.appPath]);
		async function installedIdentity(): Promise<ProofBuildIdentity> {
			assertOwnedLease(owned, owned);
			const installed = await command("xcrun", [
				"simctl",
				"get_app_container",
				udid,
				PROOF_ID,
				"app",
			]);
			if (!installed.endsWith(".app") || !installed.startsWith("/"))
				throw new Error("Invalid installed app container");
			assertFrozenContent(installed, frozen);
			const measured = await measureArtifact(installed);
			assertInstalledArtifact(measured, frozen);
			return measured;
		}

		let waiting: ((r: Record<string, unknown>) => void) | null = null;
		let phase = "",
			tokenRequests = 0;
		const server = createServer(async (req, res) => {
			try {
				let body = "";
				for await (const chunk of req) {
					body += chunk;
					if (body.length > 8192) throw new Error("body cap");
				}
				if (req.method === "POST" && req.url === "/token") {
					const value = JSON.parse(body);
					if (
						value.grant_type !== "refresh_token" ||
						value.refresh_token !== "synthetic-proof-refresh"
					)
						throw new Error("Unexpected synthetic token request");
					tokenRequests += 1;
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(syntheticTokenReply(value.refresh_token)));
					return;
				}
				if (
					req.method !== "POST" ||
					req.url !== "/receipt" ||
					req.headers["x-proof-nonce"] !== actual.nonce ||
					!waiting
				)
					throw new Error("Invalid receipt");
				const r = JSON.parse(body) as Record<string, unknown>;
				const allowed = new Set([
					"phase",
					"ok",
					"flavor",
					"sourceSha",
					"rawOauthPresent",
					"durableRetired",
					"restored",
					"refreshes",
					"publishes",
					"deletes",
				]);
				if (
					Object.keys(r).some((k) => !allowed.has(k)) ||
					r.phase !== phase ||
					r.flavor !== FLAVOR ||
					r.sourceSha !== actual.sourceSha
				)
					throw new Error("Receipt identity refused");
				for (const k of ["rawOauthPresent", "durableRetired", "restored"])
					if (k in r && typeof r[k] !== "boolean")
						throw new Error("Invalid coarse state");
				for (const k of ["refreshes", "publishes", "deletes"])
					if (
						k in r &&
						(!Number.isSafeInteger(r[k]) ||
							Number(r[k]) < 0 ||
							Number(r[k]) > 8)
					)
						throw new Error("Invalid coarse count");
				const receive = waiting;
				waiting = null;
				res.writeHead(204);
				res.end();
				receive(r);
			} catch {
				res.writeHead(400);
				res.end();
			}
		});
		await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No owned receiver port");
		let negativeControlPassed = false;
		const evidence: Record<string, unknown>[] = [];
		let previous: ProofProcessIdentity | null = null;
		try {
			// Install happened once in the existing unsigned simulator workflow. Never
			// install, erase or seed again after retirement; launch only a new process.
			for (const name of [
				"seed",
				"persist-control",
				"retire",
				"retired-restore",
				"fresh-replace",
				"fresh-restore",
			]) {
				phase = name;
				const beforeTokens = tokenRequests;
				await installedIdentity();
				const launch = await command("xcrun", [
					"simctl",
					"launch",
					"--terminate-running-process",
					udid,
					PROOF_ID,
				]);
				const pid = Number(/:\s*(\d+)\s*$/.exec(launch)?.[1]);
				const identity = { ...(await installedIdentity()), udid, pid };
				if (previous) assertRestartIdentity(previous, identity);
				previous = identity;
				let timer: ReturnType<typeof setTimeout>;
				const answer = new Promise<Record<string, unknown>>((yes, no) => {
					waiting = yes;
					timer = setTimeout(() => {
						waiting = null;
						no(new Error("Native phase receipt timed out"));
					}, 60000);
				});
				// Attach rejection handling before the process-launch operation can fail.
				void answer.catch(() => undefined);
				try {
					const url = new URL("loretirementproof://run");
					url.searchParams.set("nonce", actual.nonce);
					url.searchParams.set("phase", name);
					url.searchParams.set(
						"callback",
						`http://127.0.0.1:${address.port}/receipt`,
					);
					await command("xcrun", ["simctl", "openurl", udid, url.toString()]);
					const receipt = await answer;
					if (receipt.ok !== true) throw new Error("Native phase rejected");
					const outbound = tokenRequests - beforeTokens;
					if (
						(name === "persist-control" && outbound !== 1) ||
						(name === "retire" && outbound !== 1) ||
						(!["persist-control", "retire"].includes(name) && outbound !== 0)
					)
						throw new Error("Unexpected native auth transport count");
					if (name === "seed" || name === "fresh-replace")
						if (receipt.rawOauthPresent !== true)
							throw new Error("Persistence control absent");
					if (
						name === "retire" &&
						(receipt.durableRetired !== true ||
							receipt.rawOauthPresent !== false)
					)
						throw new Error("Durable retirement unconfirmed");
					if (name === "persist-control") {
						const negative = join(root, "negative-control.json");
						writeFileSync(
							negative,
							JSON.stringify({ ...receipt, phase: "retired-restore" }),
						);
						if (verifierProcess(negative) !== "expected-rejection")
							throw new Error(
								"Negative verifier BLOCKED or accepted authorized state",
							);
						negativeControlPassed = true;
					}
					if (name === "retired-restore") {
						const positive = join(root, "positive-control.json");
						writeFileSync(positive, JSON.stringify(receipt));
						if (verifierProcess(positive) !== "accepted")
							throw new Error(
								"Positive verifier BLOCKED or rejected retired state",
							);
					}

					evidence.push({
						phase: name,
						pid,
						udid,
						sourceSha: actual.sourceSha,
						bundleSha256: identity.bundleSha256,
						...receipt,
						authTransportRequests: outbound,
					});
				} finally {
					clearTimeout(timer!);
					waiting = null;
				}
			}
		} finally {
			server.closeAllConnections();
			await new Promise<void>((yes) => server.close(() => yes()));
			mkdirSync(root, { recursive: true });
			writeFileSync(
				join(root, "proof.json"),
				JSON.stringify(
					{
						kind: "ios-native-durable-retirement-restore-primitives-only",
						negativeControlPassed,
						complete: evidence.length === 6 && negativeControlPassed,
						phases: evidence,
						notProved: [
							"native-provider-or-Settings-UI",
							"browser-authentication",
							"provider-refresh-concurrency",
							"push-removal-or-delivery",
							"Android",
							"mid-retirement-crash",
						],
					},
					null,
					2,
				),
			);
		}
	} catch (error) {
		phaseFailed = error;
	} finally {
		try {
			await recoverCreation(
				root,
				frozen.nonce,
				process.env.GITHUB_RUN_ID!,
				command,
			);
		} catch {
			cleanupFailed = true;
		}

		if (cleanupFailed && existsSync(join(root, "proof.json"))) {
			const receipt = JSON.parse(
				readFileSync(join(root, "proof.json"), "utf8"),
			);
			receipt.complete = false;
			receipt.cleanupFailed = true;
			writeFileSync(join(root, "proof.json"), JSON.stringify(receipt, null, 2));
		}
	}
	if (phaseFailed) throw phaseFailed;
	if (cleanupFailed) throw new Error("Owned simulator cleanup failed");
}

/** Workflow always() fallback after timeout/cancellation. A persisted lease
 * alone is NOT delete authority: require this CI run, compiled nonce and the
 * actual simulator's unique created name. Never erase or touch the template. */
export async function cleanupLease(
	root: string,
	deps: { run?: Run; isAlive?: (pid: number) => boolean } = {},
): Promise<void> {
	requireManualProof();
	const build = JSON.parse(
		readFileSync(join(root, "build-identity.json"), "utf8"),
	);
	await recoverCreation(
		root,
		build.nonce,
		process.env.GITHUB_RUN_ID!,
		deps.run ?? command,
		deps.isAlive,
	);
}

async function main() {
	const [mode, a, b, c] = process.argv.slice(2);
	if (mode === "--cleanup" && a) await cleanupLease(resolve(a));
	else if (mode === "--prepare" && a) await prepareProofBuild(resolve(a));
	else if (mode === "--run" && a && b && c)
		await runNativeProof(resolve(a), resolve(b), c);
	else if (mode === "--freeze-artifact" && a && b)
		await freezeArtifact(resolve(a), resolve(b));
	else if (mode === "--assert-retired" && a) {
		const r = JSON.parse(readFileSync(a, "utf8")) as Record<string, unknown>;
		if (
			r.phase !== "retired-restore" ||
			r.ok !== true ||
			typeof r.restored !== "boolean" ||
			typeof r.rawOauthPresent !== "boolean" ||
			![r.refreshes, r.publishes, r.deletes].every(
				(v) => Number.isSafeInteger(v) && Number(v) >= 0,
			)
		)
			throw new Error("Malformed verifier receipt");
		if (r.restored || r.rawOauthPresent) {
			console.log(
				JSON.stringify({
					kind: "retired-restore-verdict",
					reason: "AUTHORIZED_RESTORE",
				}),
			);
			process.exitCode = 42;
		} else {
			assertRetiredRestore(r);
			console.log(
				JSON.stringify({ kind: "retired-restore-verdict", reason: "ACCEPTED" }),
			);
		}
	} else throw new Error("Explicit proof mode and arguments required");
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	void main().catch(() => {
		console.error(
			"Auth retirement primitive proof failed (no credential detail logged)",
		);
		process.exitCode = 1;
	});
