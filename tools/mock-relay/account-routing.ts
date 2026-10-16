import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

const CORE_HEAD = "c1b7083a5371d60aa4ad58dbb54fd30d1a25857c";
const CORE_BLOB = "b08458247ac5babb43acd696c44bc3630e01d787";
const FIXTURE_SHA256 =
	"ff4f4b39f7f12cf8fa8bf546f0ef4aa7c91b3bd2e4ad63ce48cafbb22b8297a0";
const MARKER = "loh12-canonical-account-routing-v1\n";
const COOKIE_NAME = /^loh12_fixture_[a-f0-9]{32}_[ab]$/;
const HOST_NAME = /^loh12-[a-f0-9]{32}-[ab]\.localhost$/;
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

/** Exported for a discriminating future-misconfiguration negative control.
 * Production cookie names and shared localhost/IP origins must fail BEFORE any
 * server is started; a unique port alone does not isolate a real browser jar. */
export function assertPolicyFixtureIdentity(
	hostname: string,
	cookieName: string,
) {
	if (!HOST_NAME.test(hostname) || !COOKIE_NAME.test(cookieName))
		throw new Error(
			"canonical fixture requires a unique per-run .localhost host and cookie namespace",
		);
}

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
	const hostname = `loh12-${nonce}-${options.profile}.localhost`;
	const cookieName = `loh12_fixture_${nonce}_${options.profile}`;
	assertPolicyFixtureIdentity(hostname, cookieName);
	const controls = {
		mode: "normal" as PolicyFixtureMode,
		readDelayMs: 0,
		writeDelayMs: 0,
	};
	const trace: { method: string; status: number; profile: string }[] = [];
	return {
		cookieName,
		hostname,
		identity: {
			hostname,
			cookieName,
			path: "/",
			domain: null,
			createdAt: new Date().toISOString(),
			coreHead: CORE_HEAD,
			coreBlob: CORE_BLOB,
			fixtureSha256: FIXTURE_SHA256,
		},
		controls,
		trace,
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
			trace.push({ method, status: reply.status, profile: options.profile });
			return reply;
		},
	};
}
export type CanonicalPolicyFixture = ReturnType<
	typeof createCanonicalPolicyFixture
>;
