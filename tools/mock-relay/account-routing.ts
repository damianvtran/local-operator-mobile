import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createResponseGate } from "./account-routing-gate.ts";

import {
	assertDedicatedNativeCI,
	assertPolicyFixtureIdentity,
	type PolicyTransport,
	policyIdentity,
	requirePolicyTransport,
} from "./account-routing-identity.ts";

export { assertPolicyFixtureIdentity } from "./account-routing-identity.ts";

const CORE_HEAD = "c1b7083a5371d60aa4ad58dbb54fd30d1a25857c";
const CORE_BLOB = "b08458247ac5babb43acd696c44bc3630e01d787";
const FIXTURE_SHA256 =
	"ff4f4b39f7f12cf8fa8bf546f0ef4aa7c91b3bd2e4ad63ce48cafbb22b8297a0";
const MARKER = "loh12-canonical-account-routing-v1\n";
const BRIDGE = fileURLToPath(
	new URL("./core-account-routing.py", import.meta.url),
);

export type CanonicalPolicyOptions = {
	/** Existing core venv/interpreter only; no fixture-side install or resolver. */
	python: string;
	coreRoot: string;
	/** New/marked root inside the caller's scratchpad (CI: RUNNER_TEMP). */
	privateRoot: string;
	profile: "a" | "b";
	/** Explicit CI-native proof only; default/browser .localhost is unchanged. */
	transport?: PolicyTransport;
};
export type PolicyFixtureMode =
	| "normal"
	| "old-relay"
	| "malformed"
	| "forbid-write"
	| "drop-after-write";
export type PolicyFixtureReply = {
	status: number;
	body: unknown;
	drop?: boolean;
};

const inside = (base: string, path: string) => {
	const part = relative(base, path);
	return (
		part !== "" &&
		part !== ".." &&
		!part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(part)
	);
};
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** A thin AUTHENTICATED MOCK-relay adapter, not another account policy.
 *
 * Actual default/choices/coercion/save/readback come from pinned core C1's
 * policy_payload + ConfigManager in a fresh process. There is no phone enum or
 * canned success fallback. A/B are fixed private roots, never HTTP input paths.
 * Startup validates source/import/fixture identity before a socket/native rig.
 */
export function createCanonicalPolicyFixture(options: CanonicalPolicyOptions) {
	const transport = requirePolicyTransport(options.transport);
	if (transport === "ci-native-mdns") assertDedicatedNativeCI(process.env);
	if (options.profile !== "a" && options.profile !== "b")
		throw new Error("unknown private computer profile");
	const privateRoot = resolve(options.privateRoot);
	const allowed =
		process.env.LOCAL_OPERATOR_SCRATCHPAD ??
		(process.env.GITHUB_ACTIONS === "true"
			? process.env.RUNNER_TEMP
			: undefined);
	const existed = existsSync(privateRoot);
	const actualRoot = existed
		? realpathSync(privateRoot)
		: resolve(realpathSync(dirname(privateRoot)), basename(privateRoot));
	if (!allowed || !inside(realpathSync(allowed), actualRoot))
		throw new Error(
			"fixture root must be inside owned scratch/CI temp, never a live config root",
		);
	if (!existed) mkdirSync(privateRoot, { mode: 0o700 });
	const marker = resolve(privateRoot, ".loh12-account-routing-fixture");
	if (existsSync(marker)) {
		if (readFileSync(marker, "utf8") !== MARKER)
			throw new Error("unowned fixture root");
	} else {
		// Only a just-created, empty directory may gain our ownership marker.
		// Existing unmarked directories are user work, not fixture storage.
		if (existed) throw new Error("existing unmarked fixture data");
		writeFileSync(marker, MARKER, { flag: "wx", mode: 0o600 });
	}
	const home = resolve(privateRoot, "home");
	mkdirSync(home, { mode: 0o700, recursive: true });
	const coreRoot = realpathSync(options.coreRoot);
	const env = {
		NODE_ENV: "test" as const,
		HOME: home,
		PATH: process.env.PATH ?? "",
		LOCAL_OPERATOR_CONFIG_DIR: resolve(privateRoot, options.profile),
		LOP_LANG: "en",
		PYTHONDONTWRITEBYTECODE: "1",
		GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "/bin/false",
	};
	const head = execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], {
		env,
		encoding: "utf8",
		timeout: 2000,
	}).trim();
	if (head !== CORE_HEAD)
		throw new Error("wrong core source head; no stale-source fallback");
	execFileSync(
		"git",
		["-C", coreRoot, "diff", "--quiet", "HEAD", "--", "local_operator"],
		{ env, timeout: 2000 },
	);
	const invoke = (
		method: "PROBE" | "GET" | "PATCH",
		body?: unknown,
	): PolicyFixtureReply => {
		const child = spawnSync(
			options.python,
			[
				BRIDGE,
				"--core-root",
				coreRoot,
				"--private-root",
				privateRoot,
				"--profile",
				options.profile,
			],
			{
				env,
				input: JSON.stringify({
					method,
					...(body === undefined ? {} : { body }),
				}),
				encoding: "utf8",
				timeout: 10000,
				maxBuffer: 1024 * 1024,
			},
		);
		if (child.error || child.status !== 0)
			throw new Error(
				`canonical core fixture failed: ${child.error?.message ?? child.stdout.trim() ?? "no reply"}`,
			);
		const reply: unknown = JSON.parse(child.stdout);
		if (
			!record(reply) ||
			typeof reply.status !== "number" ||
			!("body" in reply)
		)
			throw new Error("invalid canonical bridge reply");
		if (
			reply.status === 200 &&
			(!record(reply.source) ||
				reply.source.core_blob !== CORE_BLOB ||
				reply.source.fixture_sha256 !== FIXTURE_SHA256 ||
				reply.source.import_relative !==
					"local_operator/mobile/account_routing.py")
		)
			throw new Error("missing or stale canonical bridge source identity");
		return { status: reply.status, body: reply.body };
	};
	invoke("PROBE");
	const nonce = randomUUID().replaceAll("-", "");
	const { hostname, cookieName } = policyIdentity(
		nonce,
		options.profile,
		transport,
	);
	assertPolicyFixtureIdentity(hostname, cookieName, transport);
	const controls = {
		mode: "normal" as PolicyFixtureMode,
		readDelayMs: 0,
		writeDelayMs: 0,
		holdReads: false,
		holdWrites: false,
	};
	const gate = createResponseGate();
	const trace: {
		method: string;
		status: number;
		profile: string;
		value?: string;
		configSha256?: string;
	}[] = [];
	const wireTrace: {
		method: string;
		path: string;
		status: number;
		ownCookie: boolean;
		unexpectedCookieNames: string[];
	}[] = [];
	return {
		cookieName,
		hostname,
		identity: {
			hostname,
			cookieName,
			transport,
			path: "/",
			domain: null,
			createdAt: new Date().toISOString(),
			coreHead: CORE_HEAD,
			coreBlob: CORE_BLOB,
			fixtureSha256: FIXTURE_SHA256,
		},
		controls,
		releaseHeld: gate.release,
		pendingResponses: () => gate.pending,
		trace,
		wireTrace,
		observeWire: (req: IncomingMessage, status: number) => {
			// CI's fresh OS jar is observed by name/presence only, never values.
			const names = (req.headers.cookie ?? "")
				.split(";")
				.map((part) => part.split("=", 1)[0]?.trim() ?? "")
				.filter(Boolean);
			wireTrace.push({
				method: req.method ?? "GET",
				path: (req.url ?? "").split("?", 1)[0] ?? "",
				status,
				ownCookie: names.includes(cookieName),
				unexpectedCookieNames: names.filter((name) => name !== cookieName),
			});
		},
		sessionKey: (password: string) => `${password}:${cookieName}`,
		acceptHost: (req: IncomingMessage) => {
			try {
				const site = new URL(`http://${req.headers.host ?? "invalid"}`);
				return (
					site.hostname === hostname &&
					site.username === "" &&
					site.password === "" &&
					site.pathname === "/" &&
					site.search === "" &&
					site.hash === ""
				);
			} catch (error) {
				// A malformed Host is an auth-boundary refusal, not an unhandled
				// async-server rejection that leaks a fixture process or window.
				if (error instanceof TypeError) return false;
				throw error;
			}
		},
		cookieUnambiguous: (header: string | undefined) =>
			(header ?? "")
				.split(";")
				.filter((part) => part.trim().startsWith(`${cookieName}=`)).length ===
			1,
		async respond(method: string, body: unknown): Promise<PolicyFixtureReply> {
			if (method !== "GET" && method !== "PATCH")
				return { status: 405, body: { error: "Method Not Allowed" } };
			if (method === "GET" ? controls.holdReads : controls.holdWrites) {
				// Release AFTER real B is visible, not after a guessed form latency.
				if (!(await gate.wait()))
					return {
						status: 503,
						body: { error: "Owned fixture response hold expired." },
					};
			}
			const delay =
				method === "GET" ? controls.readDelayMs : controls.writeDelayMs;
			if (!Number.isFinite(delay) || delay < 0 || delay > 2000)
				throw new Error("fixture delay outside bounded range");
			if (delay) await new Promise((done) => setTimeout(done, delay));
			let reply: PolicyFixtureReply;
			if (controls.mode === "old-relay")
				reply = { status: 404, body: { error: "404: Not Found" } };
			else if (controls.mode === "forbid-write" && method === "PATCH")
				reply = { status: 403, body: { error: "Synthetic operator refusal." } };
			else {
				reply = invoke(method, body);
				if (
					controls.mode === "malformed" &&
					reply.status === 200 &&
					record(reply.body)
				)
					reply = {
						...reply,
						body: { ...reply.body, capability: "malformed-fixture-control" },
					};
				if (
					controls.mode === "drop-after-write" &&
					method === "PATCH" &&
					reply.status === 200
				)
					reply.drop = true;
			}
			const configPath = resolve(privateRoot, options.profile, "config.yml");
			const setting =
				record(reply.body) && record(reply.body.setting)
					? reply.body.setting
					: undefined;
			trace.push({
				method,
				status: reply.status,
				profile: options.profile,
				...(typeof setting?.value === "string" ? { value: setting.value } : {}),
				...(existsSync(configPath)
					? {
							configSha256: createHash("sha256")
								.update(readFileSync(configPath))
								.digest("hex"),
						}
					: {}),
			});
			return reply;
		},
	};
}
export type CanonicalPolicyFixture = ReturnType<
	typeof createCanonicalPolicyFixture
>;
