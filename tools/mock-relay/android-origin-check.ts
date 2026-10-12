/**
 * The native custom-route client sends its URL's Origin even though the socket
 * reaches a loopback mock. Exercise that real policy, including the CLI seam;
 * an Origin-less login would miss the emulator admission failure entirely.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	requestAuthFor,
	validateCustomBaseUrl,
} from "../../src/connection/profile.ts";
import { createRelay } from "./relay.ts";

const nativeOrigin = (port: number) => {
	const validated = validateCustomBaseUrl(`http://10.0.2.2:${port}`, {
		allowInsecure: true,
	});
	assert(validated.ok);
	const auth = requestAuthFor(validated.route);
	assert.equal(auth.origin, `http://10.0.2.2:${port}`);
	return auth.origin;
};

async function login(base: string, password: string, origin: string) {
	return fetch(`${base}/login`, {
		method: "POST",
		headers: new Headers([["Origin", origin]]),
		body: new URLSearchParams({ password }),
		redirect: "manual",
		signal: AbortSignal.timeout(5000),
	});
}

const report = (line: string) => {
	if (import.meta.main) console.log(line);
};

function signalGroup(pid: number, signal: NodeJS.Signals) {
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
			throw error;
	}
}

async function refused(base: string, password: string, origin: string) {
	const response = await login(base, password, origin);
	assert.equal(response.status, 403);
	assert.equal(response.headers.get("set-cookie"), null);
	assert.deepEqual(await response.json(), {
		error: "same-origin request required",
	});
	report(`POST /login Origin=${origin} → ${response.status}, cookie absent`);
}

async function admissionMatrix(base: string, port: number, password: string) {
	const origin = nativeOrigin(port);
	const unauthorized = await fetch(`${base}/api/sessions`, {
		signal: AbortSignal.timeout(5000),
	});
	assert.equal(unauthorized.status, 401);
	report(`GET /api/sessions without cookie → ${unauthorized.status}`);
	const wrong = await login(base, "synthetic-wrong-password", origin);
	assert.equal(wrong.status, 401);
	assert.equal(wrong.headers.get("set-cookie"), null);
	report(
		`POST /login actual native Origin, wrong synthetic password → ${wrong.status}, cookie absent`,
	);
	const admitted = await login(base, password, origin);
	assert.equal(admitted.status, 303);
	const sessionCookie = admitted.headers.get("set-cookie")?.split(";")[0];
	assert(sessionCookie);
	report(
		`POST /login Origin=${origin} → ${admitted.status}, cookie issued (redacted)`,
	);
	const sessions = await fetch(`${base}/api/sessions`, {
		headers: new Headers([
			["Origin", origin],
			["Cookie", sessionCookie],
		]),
		signal: AbortSignal.timeout(5000),
	});
	assert.equal(sessions.status, 200);
	const frame: unknown = await sessions.json();
	assert(frame !== null && typeof frame === "object" && "sessions" in frame);
	assert(Array.isArray(frame.sessions));
	assert.equal(frame.sessions.length, 1);
	assert.equal(frame.sessions[0].session_id, "6714def86197");
	report(
		`GET /api/sessions with cookie → ${sessions.status}, sessions.length=${frame.sessions.length}`,
	);
	await refused(base, password, "https://unrelated.example.invalid");
	await refused(
		base,
		password,
		nativeOrigin(port === 65535 ? port - 1 : port + 1),
	);
	const loopback = await login(base, password, base);
	assert.equal(loopback.status, 303);
	assert(loopback.headers.get("set-cookie"));
	report(
		`POST /login loopback Origin → ${loopback.status}, cookie issued (redacted)`,
	);
}

export const androidOriginChecks: [string, () => Promise<void>][] = [
	[
		"default mock refuses the actual native alias but preserves loopback",
		async () => {
			const password = randomBytes(24).toString("base64url");
			const relay = createRelay({ scenario: "idle", password, quiet: true });
			const handle = await relay.listen();
			try {
				await refused(handle.url, password, nativeOrigin(handle.port));
				const loopback = await login(handle.url, password, handle.url);
				assert.equal(loopback.status, 303);
				assert(loopback.headers.get("set-cookie"));
				report(
					`POST /login loopback Origin → ${loopback.status}, cookie issued (redacted)`,
				);
			} finally {
				await relay.shutdown();
			}
		},
	],
	[
		"explicit emulator opt-in admits only its exact bound-port origin",
		async () => {
			const password = randomBytes(24).toString("base64url");
			const relay = createRelay({
				scenario: "idle",
				password,
				quiet: true,
				allowAndroidEmulatorOrigin: true,
			});
			const handle = await relay.listen();
			try {
				await admissionMatrix(handle.url, handle.port, password);
			} finally {
				await relay.shutdown();
			}
		},
	],
	[
		"native CLI publishes readiness only after exact-origin admission is configured",
		async () => {
			const password = randomBytes(24).toString("base64url");
			const child = spawn(
				process.execPath,
				[
					"--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
					fileURLToPath(new URL("./relay.ts", import.meta.url)),
					"--scenario",
					"idle",
					"--password",
					password,
					"--allow-android-emulator-origin",
					"--print-port",
					"--quiet",
				],
				{
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
					env: Object.fromEntries(
						Object.entries(process.env).filter(
							([key]) => !key.startsWith("CMUX_"),
						),
					),
				},
			);
			const exited = new Promise<void>((resolve) =>
				child.once("close", () => resolve()),
			);
			let boundPort: number | undefined;
			try {
				boundPort = await new Promise<number>((resolve, reject) => {
					let output = "";
					const timer = setTimeout(
						() => reject(new Error("mock CLI readiness exceeded 5s")),
						5000,
					);
					child.once("error", (error) => {
						clearTimeout(timer);
						reject(error);
					});
					child.stdout?.on("data", (chunk) => {
						output += String(chunk);
						if (!output.includes("\n")) return;
						clearTimeout(timer);
						const port = Number(output.trim());
						if (!Number.isInteger(port) || port <= 0 || port > 65535)
							reject(new Error("mock CLI did not print a port"));
						else resolve(port);
					});
				});
				await admissionMatrix(
					`http://127.0.0.1:${boundPort}`,
					boundPort,
					password,
				);
			} finally {
				// The CLI owns a process group: reap that exact group even after a failed
				// assertion/readiness timeout, never kill a different lane's Node by name.
				const pid = child.pid;
				if (pid !== undefined) {
					signalGroup(pid, "SIGTERM");
					const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), 3000);
					try {
						await exited;
					} finally {
						clearTimeout(timer);
					}
				}
				if (boundPort !== undefined) {
					await assert.rejects(
						fetch(`http://127.0.0.1:${boundPort}`, {
							signal: AbortSignal.timeout(2000),
						}),
					);
					report("CLI process group reaped; bound port refuses connection");
				}
			}
		},
	],
];

if (import.meta.main) {
	for (const [name, run] of androidOriginChecks) test(name, run);
}
