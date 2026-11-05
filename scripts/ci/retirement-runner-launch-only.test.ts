import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LaunchOnlyTransport } from "./retirement-runner-launch-only-transport.ts";

function credentials() {
	return {
		session: randomBytes(24).toString("hex"),
		bearer: randomBytes(32).toString("hex"),
	};
}

describe("accepted bounds are pinned, not merely documented", () => {
	it("keeps every launch-only limit exact", async () => {
		const { LAUNCH_LIMITS } = await import(
			"./retirement-runner-launch-only.ts"
		);
		// The manager accepted these numbers explicitly. Pinning them here means a
		// future edit fails a test instead of silently widening the approved lane.
		expect(LAUNCH_LIMITS).toEqual({
			work: 300_000,
			acquisition: 90_000,
			toolchain: 15_000,
			prepare: 45_000,
			ownership: 60_000,
			ready: 40_000,
			postDenial: 30_000,
			boot: 300_000,
			cleanup: 120_000,
		});
	});
});

describe("launch-only live loopback boundary (not native proof)", () => {
	type RawCase = [
		label: string,
		raw: (auth: ReturnType<typeof credentials>, challenge: string) => string,
	];
	for (const [label, raw] of [
		[
			"duplicate session key",
			(auth: ReturnType<typeof credentials>, challenge: string) =>
				`{"session":"${auth.session}","session":"${auth.session}","kind":"runner-ready","challenge":"${challenge}"}`,
		],
		[
			"escaped key",
			(auth: ReturnType<typeof credentials>, challenge: string) =>
				`{"\\u0073ession":"${auth.session}","kind":"runner-ready","challenge":"${challenge}"}`,
		],
	] satisfies RawCase[])
		it(`refuses a raw body with a ${label}`, async () => {
			const auth = credentials();
			const transport = new LaunchOnlyTransport(auth);
			try {
				const endpoint = await transport.listen();
				const challenge = randomBytes(32).toString("hex");
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { authorization: `Bearer ${auth.bearer}` },
					body: raw(auth, challenge),
				});
				expect(response.status).toBe(403);
				expect(transport.receipt().protocolFailed).toBe(true);
			} finally {
				await transport.close();
			}
		});
	it("only grants ready with null identity, then denies observation", async () => {
		const auth = credentials();
		const transport = new LaunchOnlyTransport(auth);
		try {
			const endpoint = await transport.listen();
			const request = (kind: string) =>
				fetch(endpoint, {
					method: "POST",
					headers: { authorization: `Bearer ${auth.bearer}` },
					body: JSON.stringify({
						session: auth.session,
						kind,
						challenge: randomBytes(32).toString("hex"),
					}),
				});
			const ready = await request("runner-ready");
			expect(ready.status).toBe(200);
			const grant = await ready.json();
			expect(Object.keys(grant).sort()).toEqual(
				[
					"version",
					"kind",
					"session",
					"challenge",
					"phase",
					"issuedAt",
					"expiresAt",
					"openAt",
					"identity",
					"fingerprint",
				].sort(),
			);
			expect(grant).toMatchObject({
				version: 1,
				kind: "runner-ready",
				phase: "seed",
				identity: null,
				fingerprint: null,
				openAt: null,
			});
			expect(grant.expiresAt - grant.issuedAt).toBe(1000);
			expect((await request("before-observe")).status).toBe(403);
			expect(transport.receipt()).toEqual({
				readyReceived: true,
				readyReplySent: true,
				beforeObserveReceived: true,
				denialSent: true,
				protocolFailed: false,
			});
			expect((await request("authorize-tap")).status).not.toBe(200);
			expect(transport.receipt().protocolFailed).toBe(true);
		} finally {
			await transport.close();
		}
	});
	it.each([
		"bearer",
		"session",
		"challenge",
		"order",
		"extra",
		"oversize",
		// A replayed challenge, not a duplicate JSON key: raw framing has its own
		// cases below because JSON.stringify cannot produce them.
		"replay",
	])("fails closed on %s", async (fault) => {
		const auth = credentials();
		const transport = new LaunchOnlyTransport(auth);
		try {
			const endpoint = await transport.listen();
			const body: Record<string, unknown> = {
				session: auth.session,
				kind: "runner-ready",
				challenge: randomBytes(32).toString("hex"),
			};
			if (fault === "session") body.session = "0".repeat(48);
			if (fault === "challenge") body.challenge = "short";
			if (fault === "order") body.kind = "before-observe";
			if (fault === "extra") body.identity = {};
			if (fault === "oversize") body.challenge = "x".repeat(8193);
			const send = () =>
				fetch(endpoint, {
					method: "POST",
					headers: {
						authorization: `Bearer ${fault === "bearer" ? "wrong" : auth.bearer}`,
					},
					body: JSON.stringify(body),
				});
			if (fault === "replay") expect((await send()).status).toBe(200);
			expect((await send()).status).not.toBe(200);
			expect(transport.receipt().protocolFailed).toBe(true);
		} finally {
			await transport.close();
		}
	});
});

// Compile only Foundation/protocol code with installed CLT. No simulator SDK,
// XCTest/UI binary, app build or hosted action is exercised by these fixtures.
//
// macOS ONLY, and skipped with a visible reason rather than quietly: the unit
// lane (`pnpm test`) runs on ubuntu-latest, where swiftc does not exist and the
// fixture would fail on a missing host tool instead of on its subject. The same
// suite runs on any macOS checkout with the CLT installed, which is where the
// compiled-runner lane lives.
const swiftToolchain =
	process.platform === "darwin" && existsSync("/usr/bin/swiftc");
describe.skipIf(!swiftToolchain)(
	"real Swift ReplayHostClient wire validation (needs installed swiftc)",
	() => {
		let root: string;
		let binary: string;
		beforeAll(() => {
			root = mkdtempSync(join(tmpdir(), "launch-only-swift-"));
			binary = join(root, "protocol-fixture");
			const project = spawnSync(
				"/usr/bin/python3",
				[
					"-c",
					"import runpy,sys;from pathlib import Path;runpy.run_path(sys.argv[1])['project'](Path(sys.argv[2]))",
					join(import.meta.dirname, "retirement-ui-setup.py"),
					join(root, "Fixture.xcodeproj"),
				],
				{ encoding: "utf8", timeout: 5000 },
			);
			expect(project.status, project.stderr).toBe(0);
			const compile = spawnSync(
				"/usr/bin/swiftc",
				[
					"-parse-as-library",
					join(root, "ReplayPolicy.swift"),
					join(import.meta.dirname, "retirement-ui/ReplayGuards.swift"),
					join(import.meta.dirname, "retirement-ui/ReplayHostClient.swift"),
					join(
						import.meta.dirname,
						"retirement-runner-launch-only-fixture.swift",
					),
					"-o",
					binary,
				],
				{ encoding: "utf8", timeout: 60000 },
			);
			expect(compile.status, compile.stderr).toBe(0);
		}, 65000);
		afterAll(() => {
			if (root) rmSync(root, { recursive: true, force: true });
		});
		async function swift(
			endpoint: string,
			auth: ReturnType<typeof credentials>,
		) {
			// Explicit ChildProcess: spawn's stdio tuple overloads collapse to `never`
			// here, and the repo typecheck must stay clean (not just the test runner).
			const child: ChildProcess = spawn(binary, [], {
				env: {
					// Expo's ProcessEnv requires NODE_ENV even for a test-child env.
					NODE_ENV: "test",
					PATH: "/usr/bin:/bin",
					LO_REPLAY_MODE: "observe-only",
					LO_REPLAY_CONTROL: endpoint,
					LO_REPLAY_SESSION: auth.session,
					LO_REPLAY_BEARER: auth.bearer,
					LO_REPLAY_RUNNER_SOURCE: "4fff5e12296c3b6bd4ce3663988b9da8ca383227",
					SIMULATOR_UDID: "fixture-not-native",
				},
				stdio: ["ignore", "pipe", "pipe"],
				detached: true,
			});
			let output = "";
			child.stdout?.on("data", (data: Buffer) => {
				output += data;
			});
			const pid = child.pid;
			if (!pid) throw new Error("fixture-start");
			let cleanupError: unknown;
			const kill = () => {
				try {
					process.kill(-pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH")
						cleanupError = error;
				}
			};
			const timeout = setTimeout(kill, 10000);
			try {
				await new Promise<void>((yes, no) => {
					child.once("error", no);
					child.once("close", (code: number | null) =>
						code === 0 ? yes() : no(new Error("fixture-exit")),
					);
				});
			} finally {
				clearTimeout(timeout);
				kill();
			}
			if (cleanupError) throw cleanupError;
			return output.trim();
		}
		it("accepts actual launch-only ready reply and refuses its observation denial", async () => {
			const auth = credentials(),
				transport = new LaunchOnlyTransport(auth);
			try {
				expect(await swift(await transport.listen(), auth)).toBe(
					"ready-accepted-observation-refused",
				);
				expect(transport.receipt()).toEqual({
					readyReceived: true,
					readyReplySent: true,
					beforeObserveReceived: true,
					denialSent: true,
					protocolFailed: false,
				});
			} finally {
				await transport.close();
			}
		});
		it.each([
			"stale",
			"session",
			"challenge",
			"kind",
			"extra",
			"status",
			"auth",
		])("real Swift refuses %s ready", async (fault) => {
			const auth = credentials();
			const transport =
				fault === "auth" ? new LaunchOnlyTransport(credentials()) : null;
			const server = createServer(async (q, s) => {
				let raw = "";
				for await (const data of q) raw += data;
				const request = JSON.parse(raw),
					now = Date.now();
				const value: Record<string, unknown> = {
					version: 1,
					kind: "runner-ready",
					session: request.session,
					challenge: request.challenge,
					phase: "seed",
					issuedAt: now,
					expiresAt: now + 1000,
					openAt: null,
					identity: null,
					fingerprint: null,
				};
				if (fault === "stale") {
					value.issuedAt = now - 3000;
					value.expiresAt = now - 1000;
				}
				if (fault === "session") value.session = "wrong";
				if (fault === "challenge") value.challenge = "wrong";
				if (fault === "kind") value.kind = "query";
				if (fault === "extra") value.extra = true;
				s.writeHead(fault === "status" ? 403 : 200, {
					"content-type": "application/json",
				});
				s.end(JSON.stringify(value));
			});
			try {
				let endpoint: string;
				if (transport) endpoint = await transport.listen();
				else {
					await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
					const address = server.address() as { port: number };
					endpoint = `http://127.0.0.1:${address.port}/rpc`;
				}
				expect(await swift(endpoint, auth)).toBe("ready-refused");
			} finally {
				if (transport) await transport.close();
				server.closeAllConnections();
				await new Promise<void>((yes) => server.close(() => yes()));
			}
		});
	},
);

describe("controller bookkeeping with fake child outcomes (not native proof)", () => {
	it.each([
		"nonzero",
		"zero",
		"unrelated",
		"hung",
		"early",
		"no-ready",
		"protocol",
	])("keeps %s separate from the inbound receipts", async (kind) => {
		const { observeLaunch } = await import(
			"./retirement-runner-launch-only.ts"
		);
		const { Deadline } = await import("./retirement-replay-core.ts");
		const auth = credentials(),
			transport = new LaunchOnlyTransport(auth);
		let resolve!: () => void, reject!: () => void;
		const completion = new Promise<void>((yes, no) => {
			resolve = yes;
			reject = () => no(new Error("fake-nonzero"));
		});
		const runner = {
			completion,
			stop: async () => undefined,
			failureRecord: () => ({
				exitCode: 65,
				command: "launch" as const,
				errorClass:
					kind === "unrelated"
						? ("unknown" as const)
						: ("test_failed" as const),
				failingTest:
					"RetirementSystemAlert.RetainedReplayTests.testSingleSeedReplay" as const,
				failureCount: 1,
				tailSha256: "a".repeat(64),
			}),
		};
		try {
			const endpoint = await transport.listen();
			const observed = observeLaunch(transport, runner, new Deadline(1000), {
				ready: 200,
				postDenial: 20,
			});
			const send = (requestKind: string) =>
				fetch(endpoint, {
					method: "POST",
					headers: { authorization: `Bearer ${auth.bearer}` },
					body: JSON.stringify({
						session: auth.session,
						kind: requestKind,
						challenge: randomBytes(32).toString("hex"),
					}),
				});
			if (kind === "early") reject();
			else if (kind === "protocol") await send("authorize-tap");
			else if (kind !== "no-ready") {
				expect((await send("runner-ready")).status).toBe(200);
				expect((await send("before-observe")).status).toBe(403);
				if (kind === "zero") resolve();
				else if (kind !== "hung") reject();
			}
			expect(await observed).toBe(
				(
					{
						nonzero: "expected-test-failure",
						zero: "unexpected-zero",
						unrelated: "unrelated-failure",
						hung: "post-denial-timeout",
						early: "early-exit",
						"no-ready": "runner-start-timeout",
						protocol: "protocol-failure",
					} as Record<string, string>
				)[kind],
			);
			expect(transport.receipt().readyReceived).toBe(
				!["early", "no-ready", "protocol"].includes(kind),
			);
		} finally {
			resolve();
			await transport.close();
		}
	});
});
