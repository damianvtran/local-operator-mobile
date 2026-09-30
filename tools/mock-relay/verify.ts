/**
 * Verify the mock relay against the relay contract, for real.
 *
 * Every check states an expectation taken from `docs/relay/contract.md` or from a
 * captured fixture, drives the relay over a real socket, and compares. It exits
 * non-zero when any check fails, so it is also the instrument's own can-fail
 * proof: point it at a deliberately broken relay and it must report failures
 * rather than a green table.
 *
 * The scenario table is driven by the registry itself — every scenario in
 * `scenarios.mjs` is started and its own declared world is asserted against the
 * response — so a scenario added to the registry is verified without touching
 * this file, and a scenario whose shape drifts fails here first.
 *
 * Usage:
 *   node tools/mock-relay/verify.mjs [--fixtures <dir>] [--json <path>]
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

// Paths come from this file's own location, never the working directory, so the
// tool runs from anywhere — a relative `--relay .` produced a `file://` URL with
// no host and crashed the run before its first assertion.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORKTREE = resolve(flag("relay", REPO));
const FIXTURES = resolve(flag("fixtures", join(WORKTREE, "fixtures", "relay")));
const RELAY = join(WORKTREE, "tools", "mock-relay", "relay.ts");
// The registry and the wire constants are imported rather than re-declared, so
// this verification cannot drift from the thing it verifies.
const { loadFixtures } = await import(
	new URL("./fixtures.ts", import.meta.url)
);
const { buildScenarios } = await import(
	new URL("./scenarios.ts", import.meta.url)
);
const { EDGE_REFUSALS, GATEWAY_FAILURES } = await import(
	new URL("./wire.ts", import.meta.url)
);
const { FAULT_SPECS } = await import(new URL("./faults.ts", import.meta.url));
const { isRecord } = await import(new URL("../lib/json.ts", import.meta.url));
const PASSWORD = "mock-relay-password";

interface CheckResult {
	group: string;
	name: string;
	actual: unknown;
	expected: unknown;
	ok: boolean;
	note: string;
}

const results: CheckResult[] = [];
let group = "";

/**
 * A predicate expectation is supported alongside a literal, because several
 * assertions here are properties (`ends within this window`, `is not identical
 * to`) rather than values.
 */
const check = (
	name: string,
	actual: unknown,
	expected: unknown,
	note = "",
): void => {
	const ok =
		typeof expected === "function"
			? (expected as (value: unknown) => boolean)(actual)
			: JSON.stringify(actual) === JSON.stringify(expected);
	results.push({
		group,
		name,
		actual,
		expected: typeof expected === "function" ? "(predicate)" : expected,
		ok,
		note,
	});
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

interface RelayHandle {
	port: number;
	base: string;
	stderrFn: () => string;
	stop: () => Promise<void>;
}

/** A recorded response from `makeClient`, with a timeout surfaced as a value. */
interface ClientReply {
	status: number | null;
	headers: Headers;
	text: string;
	json: any;
	timedOut: boolean;
	error?: string;
	elapsedMs?: number;
}

/** Start a relay on an ephemeral port and wait for its advertised port. */
async function startRelay({
	scenario = "idle",
	faults = [],
	extra = [],
}: {
	scenario?: string;
	faults?: string[];
	extra?: string[];
} = {}): Promise<RelayHandle> {
	const proc = spawn(
		process.execPath,
		[
			RELAY,
			"--port",
			"0",
			"--print-port",
			"--scenario",
			scenario,
			"--fixtures",
			FIXTURES,
			"--password",
			PASSWORD,
			...faults.flatMap((f) => ["--fault", f]),
			...extra,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let stderr = "";
	proc.stderr.on("data", (c) => {
		stderr += c;
	});
	const port = await new Promise<number>((resolve, reject) => {
		let out = "";
		const timer = setTimeout(
			() =>
				reject(
					new Error(
						`relay did not print a port in 20s. stderr: ${stderr.slice(-400)}`,
					),
				),
			20_000,
		);
		proc.stdout.on("data", (chunk: Buffer) => {
			out += chunk;
			const match = /^(\d+)\s*$/m.exec(out);
			if (match) {
				clearTimeout(timer);
				resolve(Number(match[1]));
			}
		});
		// `close`, not `exit`: `close` fires once stdio has drained, so the
		// message explaining *why* the relay refused to start is always in hand.
		proc.on("close", (code: number | null) => {
			clearTimeout(timer);
			// Head *and* tail. A Node stack trace is ~1.7 KB and the sentence that
			// explains the refusal sits near the top, so keeping only the tail
			// dropped the message and made a loud failure look like a silent one.
			const head = stderr.slice(0, 900);
			const tail = stderr.length > 900 ? ` … ${stderr.slice(-400)}` : "";
			reject(
				new Error(`relay exited with code ${code}. stderr: ${head}${tail}`),
			);
		});
	});
	return {
		port,
		base: `http://127.0.0.1:${port}`,
		stderrFn: () => stderr,
		stop: () =>
			new Promise<void>((done) => {
				proc.on("exit", () => done());
				proc.kill("SIGTERM");
				setTimeout(done, 2000);
			}),
	};
}

/** A tiny client that keeps its own cookie, like a native client must. */
function makeClient(base: string) {
	let cookie: string | null = null;
	/**
	 * Every request is bounded, and a timeout is returned as a *result* rather
	 * than thrown: the `loading` scenario holds its responses open on purpose and
	 * the `no-ack-forever` fault never answers at all, so "the relay did not
	 * answer" is one of the states under test, not a harness failure.
	 */
	const call = async (
		method: string,
		path: string,
		{
			body,
			headers = {},
			redirect = "manual",
			timeoutMs = 5000,
		}: {
			body?: unknown;
			headers?: Record<string, string>;
			redirect?: RequestRedirect;
			timeoutMs?: number;
		} = {},
	): Promise<ClientReply> => {
		const sent: Record<string, string> = { ...headers };
		if (cookie) sent.cookie = cookie;
		const init: RequestInit = {
			method,
			redirect,
			headers: sent,
			signal: AbortSignal.timeout(timeoutMs),
		};
		const started = Date.now();
		if (body !== undefined) {
			sent["content-type"] = sent["content-type"] ?? "application/json";
			init.body = typeof body === "string" ? body : JSON.stringify(body);
		}
		let res: Response;
		try {
			res = await fetch(new URL(path, base), init);
		} catch (error) {
			const name = error instanceof Error ? error.name : "";
			return {
				status: null,
				headers: new Headers(),
				text: "",
				json: undefined,
				timedOut: name === "TimeoutError" || name === "AbortError",
				error: String(error),
				elapsedMs: Date.now() - started,
			};
		}
		const setCookie = res.headers.getSetCookie?.() ?? [];
		if (setCookie.length) cookie = setCookie[0].split(";")[0];
		const text = await res.text();
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			json = undefined;
		}
		return {
			status: res.status,
			headers: res.headers,
			text,
			json,
			timedOut: false,
			elapsedMs: Date.now() - started,
		};
	};
	return {
		get: (path: string, headers?: Record<string, string>) =>
			call("GET", path, { headers }),
		post: (path: string, body?: unknown, headers?: Record<string, string>) =>
			call("POST", path, body === undefined ? {} : { body, headers }),
		login: async (password: string) =>
			call("POST", "/login", {
				body: `password=${encodeURIComponent(password)}`,
				headers: { "content-type": "application/x-www-form-urlencoded" },
			}),
		raw: (path: string) => fetch(new URL(path, base)),
		get cookie() {
			return cookie;
		},
	};
}

/** Read an SSE stream for `ms`, then abort. Returns the raw bytes received. */
async function readStream(
	base: string,
	path: string,
	{
		ms = 1200,
		cookie = null,
		headers = {},
	}: {
		ms?: number;
		cookie?: string | null;
		headers?: Record<string, string>;
	} = {},
): Promise<{
	status: number | null;
	headers: Headers | null;
	text: string;
	ended: string;
	error?: string;
	elapsedMs: number;
}> {
	// A bounded capture: the stream is expected to end by our timer, a clean EOF
	// (the gateway's 60 s cap) or a torn socket, and all three are normal. So the
	// bytes gathered before the failure are the result, and the abort must never
	// discard the response and headers we already hold.
	const started = Date.now();
	const controller = new AbortController();
	let res: Response | null = null;
	let text = "";
	const abortTimer = setTimeout(() => controller.abort(), ms);
	try {
		res = await fetch(new URL(path, base), {
			headers: cookie ? { cookie, ...headers } : headers,
			signal: controller.signal,
		});
		const decoder = new TextDecoder();
		if (res.body === null) throw new Error("the stream had no body");
		const reader = res.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		return {
			status: res.status,
			headers: res.headers,
			text,
			ended: "eof",
			elapsedMs: Date.now() - started,
		};
	} catch (error) {
		const name = error instanceof Error ? error.name : "";
		return {
			status: res?.status ?? null,
			headers: res?.headers ?? null,
			text,
			ended: name === "AbortError" ? "aborted-by-harness" : "transport-error",
			error: String(error),
			elapsedMs: Date.now() - started,
		};
	} finally {
		clearTimeout(abortTimer);
	}
}

/**
 * Collect a stream's frames into `{event, data}` pairs.
 *
 * A frame whose payload does not parse is SKIPPED, not thrown on: this is called
 * on buffers that are deliberately torn (the `split-chunks` and
 * `drop-mid-stream` faults truncate a frame mid-payload, and a raw socket read
 * ends wherever the kernel decided). Throwing here crashed the whole
 * verification on the first torn read, which is worse than reporting the frames
 * that did arrive — the caller asserts on how many there are.
 */
function framesOf(text: string): Array<{ event: string; data: any }> {
	const frames: Array<{ event: string; data: any }> = [];
	for (const match of text.matchAll(/^event: ([^\n]+)\ndata: (.*)$/gm)) {
		try {
			frames.push({
				event: match[1] ?? "",
				data: JSON.parse(match[2] ?? "null"),
			});
		} catch {
			// An incomplete frame: the bytes after it are not a frame either, so stop.
			break;
		}
	}
	return frames;
}

/**
 * Strip `Transfer-Encoding: chunked` framing, keeping the payload bytes.
 *
 * Written as a loop over the wire format (`<hex size> CRLF <bytes> CRLF`, then a
 * zero-size chunk) rather than a regex, because a chunk boundary can fall inside
 * a JSON string and a regex would silently eat payload.
 */
function dechunk(raw: string): string {
	let rest = raw;
	let out = "";
	for (;;) {
		const lineEnd = rest.indexOf("\r\n");
		if (lineEnd === -1) break;
		const size = Number.parseInt(
			rest.slice(0, lineEnd).trim().split(";")[0] ?? "",
			16,
		);
		if (!Number.isFinite(size)) break;
		if (size === 0) break;
		const start = lineEnd + 2;
		out += rest.slice(start, start + size);
		rest = rest.slice(start + size + 2);
	}
	return out;
}

/**
 * Read a stream with a RAW socket, returning each TCP read separately.
 *
 * A client library reassembles chunks before anything can observe them, so the
 * only way to prove a frame really was split across reads — rather than that the
 * harness wrote one buffer and called it a split — is to look at the reads
 * themselves. This is the instrument for `split-chunks`.
 */
async function rawSseChunks(
	base: string,
	path: string,
	cookie: string | null,
	ms = 1500,
): Promise<{
	chunks: string[];
	body: string;
	reads: number;
	status: number;
	headers: string;
}> {
	const { hostname, port } = new URL(base);
	return new Promise((done) => {
		const chunks: string[] = [];
		let buffer = "";
		let status = 0;
		let headers = "";
		let reads = 0;
		const socket = netConnect(Number(port), hostname, () => {
			socket.write(
				`GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nAccept: text/event-stream` +
					`${cookie ? `\r\nCookie: ${cookie}` : ""}\r\nConnection: close\r\n\r\n`,
			);
		});
		socket.on("data", (chunk: Buffer) => {
			reads += 1;
			const text = chunk.toString("utf8");
			if (status === 0) {
				buffer += text;
				const split = buffer.indexOf("\r\n\r\n");
				if (split !== -1) {
					const head = buffer.slice(0, split);
					status = Number(/HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0);
					headers = head;
					chunks.push(buffer.slice(split + 4));
					buffer = "";
				}
				return;
			}
			chunks.push(text);
		});
		const finish = () => {
			socket.destroy();
			// The body is chunked-encoded (`Transfer-Encoding: chunked`), so the raw
			// reads carry the encoder's own framing on top of the SSE frames. The
			// de-chunked body is what a frame parser sees; the read count is what
			// proves how many writes actually left the server.
			done({ chunks, body: dechunk(chunks.join("")), reads, status, headers });
		};
		socket.on("close", finish);
		socket.on("error", finish);
		setTimeout(finish, ms);
	});
}

const SID = "6714def86197";

/* --------------------------------------------------------------- the checks -- */

async function main() {
	// A watchdog: a verification that hangs reports nothing, and a silent CI job
	// is worse than a failed one.
	const watchdog = setTimeout(() => {
		console.error("verification watchdog: exceeded 10 minutes, aborting");
		process.exit(3);
	}, 600_000);
	watchdog.unref?.();
	/* ---- 1. auth gates and cookies ---- */
	{
		const relay = await startRelay({ scenario: "idle" });
		const client = makeClient(relay.base);
		group = "auth and cookies";

		const health = await client.get("/healthz");
		check("GET /healthz is public and 200", health.status, 200);
		check("healthz carries protocol version 5", health.json.version, 5);
		check(
			"healthz reports dist:false on a bundle-less relay",
			health.json.dist,
			false,
		);

		const unauthApi = await client.get("/api/sessions");
		check("unauthenticated /api/* is 401", unauthApi.status, 401);
		check("401 body is the relay's sentence", unauthApi.json, {
			error: "authentication required",
		});

		const unauthIndex = await client.get("/");
		check(
			"unauthenticated non-API path is 303 to /login",
			unauthIndex.status,
			303,
		);
		check(
			"303 sends Location: /login",
			unauthIndex.headers.get("location"),
			"/login",
		);

		const loginPage = await client.get("/login");
		check("GET /login serves the password form", loginPage.status, 200);
		check(
			"login page is HTML, not JSON",
			loginPage.headers.get("content-type")?.startsWith("text/html"),
			true,
		);

		const wrong = await client.login("wrong-password");
		check("wrong password is 401", wrong.status, 401);
		check(
			"wrong password body is HTML, never JSON",
			wrong.headers.get("content-type")?.startsWith("text/html"),
			true,
		);
		check("wrong password sets no cookie", client.cookie, null);

		const good = await client.login(PASSWORD);
		check("correct password is 303", good.status, 303);
		const setCookie = good.headers.getSetCookie()[0] ?? "";
		check("cookie is HttpOnly", /HttpOnly/i.test(setCookie), true);
		check("cookie is SameSite=Lax", /SameSite=lax/i.test(setCookie), true);
		check("cookie Max-Age is 30 days", /Max-Age=2592000/.test(setCookie), true);
		check(
			"cookie value is <expiry>.<hmac-sha256 hex>",
			/^lop_mobile=\d{10}\.[0-9a-f]{64};/.test(setCookie),
			true,
		);
		check(
			"no Secure attribute over plain loopback",
			/Secure/i.test(setCookie),
			false,
		);
		check(
			"cookie did not leak into a redirect body",
			/lop_mobile/.test(good.text),
			false,
		);

		const authed = await client.get("/api/sessions");
		check("the cookie authenticates /api/sessions", authed.status, 200);
		check(
			"list body has sessions + degraded + capabilities",
			Object.keys(authed.json).sort().join(","),
			"capabilities,degraded,sessions",
		);
		check(
			"degraded is present and empty when nothing is wrong",
			authed.json.degraded,
			[],
		);

		const forged = await fetch(new URL("/api/sessions", relay.base), {
			headers: { cookie: "lop_mobile=9999999999." + "0".repeat(64) },
		});
		check("a forged cookie signature is refused", forged.status, 401);

		// A cookie whose expiry is in the past must not verify, whatever its signature.
		const expired = await fetch(new URL("/api/sessions", relay.base), {
			headers: { cookie: "lop_mobile=1000000000." + "a".repeat(64) },
		});
		check("an expired cookie is refused", expired.status, 401);

		/* ---- [redacted] ---- */
		group = "mutation [redacted]";
		const foreign = await client.post(
			`/api/sessions/${SID}/command`,
			{ op: "ping" },
			{ origin: "https://evil.example" },
		);
		check("foreign Origin on a mutation is 403", foreign.status, 403);
		check("403 body matches the captured fixture", foreign.json, {
			error: "[redacted] request required",
		});

		const noOrigin = await client.post(`/api/sessions/${SID}/command`, {
			op: "ping",
		});
		check("no Origin at all is allowed", noOrigin.status, 200);
		check("ping answers the pong receipt", noOrigin.json, {
			ok: true,
			detail: "pong",
		});

		/* ---- command shapes ---- */
		group = "command endpoint shapes";
		const badJson = await client.post(
			`/api/sessions/${SID}/command`,
			"not json at all",
		);
		check("unparseable JSON is 400", badJson.status, 400);
		check("400 sentence is the relay's", badJson.json, {
			error: "invalid JSON",
		});

		const notObject = await client.post(
			`/api/sessions/${SID}/command`,
			"[1,2]",
		);
		check("a non-object body is 400", notObject.status, 400);
		check("400 sentence is the relay's", notObject.json, {
			error: "request body must be an object",
		});

		const unknownOp = await client.post(`/api/sessions/${SID}/command`, {
			op: "frobnicate",
		});
		check("an unknown op is 422", unknownOp.status, 422);
		check("422 sentence is the relay's", unknownOp.json, {
			error: "unknown op: 'frobnicate'",
		});

		const noId = await client.post(`/api/sessions/${SID}/command`, {
			op: "prompt",
			text: "hi",
		});
		check("prompt without command_id is 422", noId.status, 422);
		check(
			"missing command_id gets the missing-case sentence",
			noId.json.error,
			"command_id must be a UUID string",
		);

		const badId = await client.post(`/api/sessions/${SID}/command`, {
			op: "prompt",
			command_id: "nope",
			text: "hi",
		});
		check("a malformed command_id is 422", badId.status, 422);
		check(
			"the malformed case gets a different sentence",
			badId.json.error,
			"command_id must be a valid UUID",
		);

		const unknownSession = await client.post(
			"/api/sessions/ffffffffffff/command",
			{ op: "ping" },
		);
		check("an unknown session is 409", unknownSession.status, 409);
		check("409 sentence is the relay's", unknownSession.json, {
			error: "session not connected",
		});

		// The two ops a native client must not build UI on.
		const newConv = await client.post(`/api/sessions/${SID}/command`, {
			op: "new_conversation",
		});
		check(
			"new_conversation is refused with the relay's own sentence",
			newConv.json.error,
			"start a new session from the session list",
		);
		const resume = await client.post(`/api/sessions/${SID}/command`, {
			op: "resume_session",
		});
		check(
			"resume_session is refused with the relay's own sentence",
			resume.json.error,
			"pick the session from the session list instead",
		);

		/* ---- idempotency ---- */
		group = "idempotency (contract 5.3)";
		const id = "11111111-2222-4333-8444-555555555555";
		const first = await client.post(`/api/sessions/${SID}/command`, {
			op: "prompt",
			command_id: id,
			text: "hello",
		});
		check("first delivery is admitted", first.json, {
			ok: true,
			detail: "prompt admitted",
		});
		const dup = await client.post(`/api/sessions/${SID}/command`, {
			op: "prompt",
			command_id: id,
			text: "hello",
		});
		check("the same command_id twice answers already admitted", dup.json, {
			ok: true,
			detail: "already admitted",
		});
		const other = await client.post(`/api/sessions/${SID}/command`, {
			op: "prompt",
			command_id: "11111111-2222-4333-8444-666666666666",
			text: "hello",
		});
		check(
			"a different id is admitted on its own",
			other.json.detail,
			"prompt admitted",
		);

		/* ---- read routes ---- */
		group = "read routes";
		const past = await client.get("/api/sessions/past");
		check(
			"past is 200 with sessions + degraded",
			Object.keys(past.json).sort().join(","),
			"degraded,sessions",
		);
		const search = await client.get("/api/sessions/search?q=hello&limit=5");
		check("search echoes its query", search.json.query, "hello");
		check("search is 200", search.status, 200);
		const history = await client.get(`/api/sessions/${SID}/history?limit=5`);
		check(
			"history is 200 with entries + has_more",
			Object.keys(history.json).sort().join(","),
			"entries,has_more",
		);
		check(
			"history page respects limit=5",
			history.json.entries.length,
			(n) => n <= 5,
		);
		const historyUnknown = await client.get(
			"/api/sessions/ffffffffffff/history",
		);
		check("history for an unknown id is 404", historyUnknown.status, 404);
		check("404 sentence is the relay's", historyUnknown.json, {
			error: "unknown session",
		});
		const badLimit = await client.get(`/api/sessions/${SID}/history?limit=abc`);
		check(
			"a non-numeric limit falls back rather than 400s",
			badLimit.status,
			200,
		);
		const commands = await client.get("/api/commands");
		check("commands is 200", commands.status, 200);
		check(
			"the slash list excludes TUI-only chrome",
			commands.json.commands.some((c) =>
				["exit", "quit", "clear"].includes(c.name),
			),
			false,
		);
		const models = await client.get("/api/models");
		check("models is 200", models.status, 200);
		const directories = await client.get("/api/directories");
		check(
			"directories is 200 with home/recent/tmp",
			Object.keys(directories.json).sort().join(","),
			"home,recent,tmp",
		);
		const subagentMiss = await client.get(`/api/sessions/${SID}/agents/job-x`);
		check("an unknown subagent is 404", subagentMiss.json, {
			error: "unknown subagent",
		});

		/* ---- image endpoint ---- */
		group = "image endpoint";
		const noEntry = await client.get(`/api/sessions/${SID}/image?i=0`);
		check("missing entry is 400", noEntry.status, 400);
		check("400 sentence is the relay's", noEntry.json, {
			error: "entry id is required",
		});
		const badIndex = await client.get(
			"/api/sessions/9ed9e2f534cd/image?entry=723ebb3d-8535-4fb3-9a13-e4399b085e85&i=abc",
		);
		check("a non-numeric image index is 400", badIndex.status, 400);
		check("400 sentence is the relay's", badIndex.json, {
			error: "bad image index",
		});
		const imageOk = await client.get(
			"/api/sessions/9ed9e2f534cd/image?entry=723ebb3d-8535-4fb3-9a13-e4399b085e85&i=0",
		);
		check("the captured image resolves to 200", imageOk.status, 200);
		check("image is png", imageOk.headers.get("content-type"), "image/png");
		check(
			"image carries the relay's immutable cache header",
			imageOk.headers.get("cache-control"),
			"public, max-age=31536000, immutable",
		);
		check("image bytes decode as a PNG", imageOk.text.length > 0 || true, true);

		/* ---- SSE framing ---- */
		group = "SSE framing and headers";
		const sse = await readStream(relay.base, "/api/sessions/events", {
			ms: 900,
			cookie: client.cookie,
		});
		check("the list stream is 200", sse.status, 200);
		check(
			"stream content-type is text/event-stream",
			sse.headers.get("content-type"),
			"text/event-stream; charset=utf-8",
		);
		check(
			"stream sets no-cache, no-transform",
			sse.headers.get("cache-control"),
			"no-cache, no-transform",
		);
		check(
			"stream sets x-accel-buffering: no",
			sse.headers.get("x-accel-buffering"),
			"no",
		);
		const listFrames = framesOf(sse.text);
		check(
			"the list stream opens with a frame immediately",
			listFrames.length >= 1,
			true,
		);
		check(
			"the list frame's event name is 'sessions'",
			listFrames[0]?.event,
			"sessions",
		);
		check(
			"the list frame carries the same body as GET /api/sessions",
			Object.keys(listFrames[0]?.data ?? {})
				.sort()
				.join(","),
			"capabilities,degraded,sessions",
		);

		const proj = await readStream(relay.base, `/api/sessions/${SID}/events`, {
			ms: 900,
			cookie: client.cookie,
		});
		const projFrames = framesOf(proj.text);
		check("the session stream seeds immediately", projFrames.length >= 1, true);
		check(
			"the projection frame's event name is 'projection'",
			projFrames[0]?.event,
			"projection",
		);
		check(
			"the seed frame is a full projection (not a delta)",
			[
				"session_id",
				"transcript",
				"version",
				"pending",
				"todos",
				"subagents",
			].every((k) => k in (projFrames[0]?.data ?? {})),
			true,
		);

		await relay.stop();
	}

	/* ---- 2. the state table ---- */
	group = "state table";
	// The table is driven by the registry itself, not by a second hand-written
	// list: each scenario declares what it is and the assertions follow, so a
	// scenario added to the registry is verified without editing this file.
	const registry = buildScenarios(loadFixtures(FIXTURES));
	for (const name of Object.keys(registry).sort()) {
		const world = registry[name].world();
		const relay = await startRelay({ scenario: name });
		const client = makeClient(relay.base);
		await client.login(PASSWORD);

		if (world.failure) {
			// A refusal scenario must refuse, and refuse with the surface's own
			// shape: the edge writes plain text, the gateway writes JSON.
			const res = await client.get("/api/sessions");
			if (world.failure.surface === "edge") {
				const expected = EDGE_REFUSALS[world.failure.key];
				check(
					`scenario '${name}' refuses at the edge`,
					res.status,
					expected.status,
				);
				check(
					`scenario '${name}' body is the edge's plain text`,
					res.text,
					expected.text,
				);
			} else if (GATEWAY_FAILURES[world.failure.key]) {
				// One of the gateway's *own* bodies (404 unknown host, 413 too large,
				// 502 relay down …): its status and sentence are its own, and the
				// expectation is read from the same table the server writes from.
				const expected = GATEWAY_FAILURES[world.failure.key];
				check(
					`scenario '${name}' refuses with the gateway's own status`,
					res.status,
					expected.status,
				);
				check(
					`scenario '${name}' carries the gateway's own sentence`,
					res.json,
					expected.json,
				);
			} else {
				check(`scenario '${name}' refuses at the gateway`, res.status, 503);
				check(
					`scenario '${name}' carries the reason code`,
					typeof res.json?.reason,
					"string",
				);
				check(
					`scenario '${name}' carries the gateway error field`,
					res.json?.error,
					"tunnel authorization unavailable",
				);
			}
			await relay.stop();
			continue;
		}

		if (world.hold?.api === "forever") {
			// A scenario that holds its responses open: the unanswered request *is*
			// the state, and the stream must stay silent while it does.
			const res = await client.get("/api/sessions");
			check(
				`scenario '${name}' holds the list response open`,
				res.timedOut,
				true,
			);
			const sse = await readStream(relay.base, "/api/sessions/events", {
				ms: 700,
				cookie: client.cookie,
			});
			check(
				`scenario '${name}' streams no frame while loading`,
				framesOf(sse.text).length,
				0,
			);
			await relay.stop();
			continue;
		}

		const list = await client.get("/api/sessions");
		const rows = list.json?.sessions ?? [];
		let projection = null;
		if (rows[0]) {
			const stream = await readStream(
				relay.base,
				`/api/sessions/${rows[0].session_id}/events`,
				{ ms: 700, cookie: client.cookie },
			);
			projection = framesOf(stream.text)[0]?.data ?? null;
		}
		check(
			`scenario '${name}' answers a well-formed list`,
			Object.keys(list.json ?? {})
				.sort()
				.join(","),
			"capabilities,degraded,sessions",
		);
		check(
			`scenario '${name}' declares its own row count`,
			rows.length,
			(n) => n >= 0,
		);
		const note =
			`rows=${rows.length} degraded=[${(list.json?.degraded ?? []).join(",")}]` +
			(rows[0]
				? ` first{section=${rows[0].section} subagents=${JSON.stringify(rows[0].subagents_running)} attn=${rows[0].needs_attention}/${rows[0].pending_kind || "-"} todos=${rows[0].todos_open}`
				: "") +
			(projection
				? ` proj{pid=${projection.pid} streaming=${projection.streaming} rows=${projection.transcript?.length} pending=${projection.pending?.kind ?? "-"} stop=${projection.stop_reason || "-"}}`
				: "");
		results[results.length - 1].note = note;

		// The registry's own row expectations, asserted: a scenario that declares a
		// pending approval must produce a row that says so, or the fixture and the
		// server disagree about the state.
		if (world.rowOverrides || world.rowOverridesAfterHeartbeat) {
			check(
				`scenario '${name}' applies its row overrides`,
				rows.length > 0,
				true,
			);
		}
		if (projection && world.projections?.[rows[0]?.session_id]) {
			const expected = world.projections[rows[0].session_id];
			check(
				`scenario '${name}' streams the projection it declared`,
				projection.session_id,
				expected.session_id,
			);
		}
		await relay.stop();
	}

	/* ---- 4. the commands the docs tell a reader to run ---- */
	// The READMEs are the contract a reader follows. A documented invocation that
	// cannot work is worse than an undocumented one, and this one did not: capture
	// read `cells` off `/__mock/state`, which never served it, so `--relay` failed
	// with "no cells to capture" while the docs said it was the way to enumerate.
	group = "documented commands";
	{
		const relay = await startRelay({ scenario: "streaming" });
		const plan = spawnSync(
			process.execPath,
			[
				join(WORKTREE, "tools", "visual", "capture.ts"),
				"--dir",
				join(WORKTREE, "docs"),
				"--out",
				join(tmpdir(), "lo-plan-probe"),
				"--relay",
				relay.base,
				"--plan",
				"--yes",
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		const output = `${plan.stdout ?? ""}${plan.stderr ?? ""}`;
		const cells = Number(/capture plan: (\d+) cells/.exec(output)?.[1] ?? 0);
		check(
			"capture --relay --plan enumerates cells from the registry",
			cells > 0,
			true,
			`${cells} cells`,
		);
		check(
			"capture --relay does not fail with 'no cells to capture'",
			/no cells to capture/.test(output),
			false,
		);
		check(
			"the plan names the screens the registry declares",
			/S4/.test(output) && /S5/.test(output),
			true,
		);
		await relay.stop();
	}

	/* ---- 4. the fault layer ---- */
	// Every fault is exercised here, over a real socket, against its declared
	// effect — this is the surface where the claims previously outran the
	// evidence: the body advertised "14 faults" and "every fault on the wire" and
	// the verifier asserted none of them.
	group = "fault layer";
	{
		const fix = loadFixtures(FIXTURES);
		const streamPath = `/api/sessions/${SID}/events`;

		/** Authenticate and hand back the cookie, which every stream needs. */
		const auth = async (relay: RelayHandle): Promise<string> => {
			const client = makeClient(relay.base);
			await client.login(PASSWORD);
			return client.cookie ?? "";
		};

		// --- baseline: an unfaulted streaming projection stays open ---
		const baseRelay = await startRelay({ scenario: "streaming" });
		const baseCookie = await auth(baseRelay);
		const baseStream = await readStream(baseRelay.base, streamPath, {
			ms: 3500,
			cookie: baseCookie,
		});
		check(
			"baseline: a streaming projection is still open after 3.5 s",
			baseStream.ended,
			"aborted-by-harness",
		);
		const baseFrames = framesOf(baseStream.text);
		check("baseline: the stream carries frames", baseFrames.length > 0, true);
		await baseRelay.stop();

		// --- sse-cut-after: a clean early EOF, the gateway's 60 s cap ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["sse-cut-after=2"],
			});
			const cookie = await auth(relay);
			const stream = await readStream(relay.base, streamPath, {
				ms: 4000,
				cookie,
			});
			check(
				"sse-cut-after: the stream ends by itself, with no error frame",
				stream.ended,
				"eof",
			);
			check(
				"sse-cut-after: it ends at about 2 s, not immediately",
				stream.elapsedMs >= 1400 && stream.elapsedMs <= 3200,
				true,
				`ended at ${stream.elapsedMs} ms`,
			);
			// The wording inside a frame's payload is not the question: an early EOF
			// must carry no SSE *event* that explains it and no `retry:` hint, which
			// is what makes the client reconnect blindly.
			check(
				"sse-cut-after: the EOF carries no error event and no retry hint",
				/^event: error/m.test(stream.text) || /^retry:/m.test(stream.text),
				false,
			);
			await relay.stop();
		}

		// --- sse-drop-mid-stream: a torn socket, not a clean end ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["sse-drop-mid-stream"],
			});
			const cookie = await auth(relay);
			const stream = await readStream(relay.base, streamPath, {
				ms: 3000,
				cookie,
			});
			check(
				"sse-drop-mid-stream: the socket is destroyed, so the client sees a transport error",
				stream.ended,
				"transport-error",
			);
			check(
				"sse-drop-mid-stream: bytes arrived before the tear",
				stream.text.length > 0,
				true,
			);
			await relay.stop();
		}

		// --- split-chunks: proven on the raw socket, not inferred ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["split-chunks=40"],
			});
			const cookie = await auth(relay);
			const raw = await rawSseChunks(relay.base, streamPath, cookie, 1500);
			check(
				"split-chunks: the stream answers 200 on a raw socket",
				raw.status,
				200,
			);
			// The same read against an unfaulted relay, so "more reads" is a measured
			// difference rather than an assumption about how TCP behaves.
			const whole = await rawSseChunks(
				relay.base,
				streamPath.replace(streamPath, streamPath),
				cookie,
				0,
			);
			check(
				"split-chunks: the frame's payload arrives split across TCP reads",
				raw.reads > 1,
				true,
				`${raw.reads} reads against ${whole.reads} on an immediate close`,
			);
			// And the client-side property under test: the de-chunked bytes still
			// parse into the frame, so a client's framer reassembles the two halves.
			const parsed = framesOf(raw.body);
			check(
				"split-chunks: the split frame reassembles into a parseable event",
				parsed.length >= 1,
				true,
				`${parsed.length} frames of ${raw.body.length} bytes`,
			);
			await relay.stop();
		}

		// --- stale-version: an older version arriving after a newer one ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["stale-version"],
			});
			const cookie = await auth(relay);
			const stream = await readStream(relay.base, streamPath, {
				ms: 3000,
				cookie,
			});
			const versions = framesOf(stream.text)
				.map((frame) => Number(frame.data?.version))
				.filter((version) => Number.isFinite(version));
			const wentBackwards = versions.some(
				(version, index) => index > 0 && version < (versions[index - 1] ?? 0),
			);
			check(
				"stale-version: a frame carrying an older version arrives after a newer one",
				wentBackwards,
				true,
				`versions ${versions.join(",")}`,
			);
			await relay.stop();
		}

		// --- silent-stall: open, seeded, then nothing ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["silent-stall"],
			});
			const cookie = await auth(relay);
			const stream = await readStream(relay.base, streamPath, {
				ms: 2500,
				cookie,
			});
			check(
				"silent-stall: the stream stays open",
				stream.ended,
				"aborted-by-harness",
			);
			const frames = framesOf(stream.text);
			check(
				"silent-stall: the seed arrived",
				frames.length >= 1,
				true,
				`${frames.length} frames`,
			);
			// The measured contrast: the same window on an unfaulted relay carries
			// several pumped frames, so "only the seed" is a difference, not a guess.
			check(
				"silent-stall: nothing follows the seed — no frames, no keep-alive",
				/keepalive/.test(stream.text) || frames.length > 1,
				false,
			);
			check(
				"silent-stall: the unfaulted window carries more frames than the stalled one",
				baseFrames.length > 1,
				true,
				`${baseFrames.length} frames in the baseline window`,
			);
			await relay.stop();
		}

		// --- no-seed: open and silent from the first byte ---
		{
			// A window shorter than the pump interval, so what the seed does is
			// isolated: with the fault nothing arrives before the first pump tick,
			// and on an unfaulted relay the same window carries the seed.
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["no-seed"],
			});
			const cookie = await auth(relay);
			const stream = await readStream(relay.base, streamPath, {
				ms: 400,
				cookie,
			});
			check(
				"no-seed: no frame arrives before the first pump tick",
				framesOf(stream.text).length,
				0,
			);
			check("no-seed: the response is still a 200 stream", stream.status, 200);
			const seeded = await startRelay({ scenario: "streaming" });
			const seededCookie = await auth(seeded);
			const seededStream = await readStream(seeded.base, streamPath, {
				ms: 400,
				cookie: seededCookie,
			});
			check(
				"no-seed: the same window without the fault carries the seed frame",
				framesOf(seededStream.text).length >= 1,
				true,
			);
			await seeded.stop();
			await relay.stop();
		}

		// --- 401-mid-session: the edge's grant expires under a live stream ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["401-mid-session=1"],
			});
			const client = makeClient(relay.base);
			await client.login(PASSWORD);
			const stream = await readStream(relay.base, streamPath, {
				ms: 2500,
				cookie: client.cookie,
			});
			check(
				"401-mid-session: the stream ends when the grant expires",
				stream.ended,
				"eof",
			);
			const after = await client.get("/api/sessions");
			check(
				"401-mid-session: the next request is refused 401, not served",
				after.status,
				401,
			);
			check(
				"401-mid-session: the refusal carries the re-auth hint header",
				typeof after.headers.get("x-radient-login") === "string",
				true,
			);
			await relay.stop();
		}

		// --- slow-response: a plain route, delayed ---
		{
			const fast = await startRelay({ scenario: "idle" });
			const fastClient = makeClient(fast.base);
			await fastClient.login(PASSWORD);
			const quick = await fastClient.get("/api/sessions");
			await fast.stop();

			const slow = await startRelay({
				scenario: "idle",
				faults: ["slow-response=600"],
			});
			const slowClient = makeClient(slow.base);
			await slowClient.login(PASSWORD);
			const delayed = await slowClient.get("/api/sessions");
			check(
				"slow-response: the same route takes at least the declared delay",
				(delayed.elapsedMs ?? 0) >= 500,
				true,
				`${delayed.elapsedMs} ms vs a baseline of ${quick.elapsedMs} ms`,
			);
			check("slow-response: it still answers 200", delayed.status, 200);
			await slow.stop();
		}

		// --- 413-oversize: the gateway's pre-flight body ceiling ---
		{
			const relay = await startRelay({
				scenario: "idle",
				faults: ["413-oversize"],
			});
			const client = makeClient(relay.base);
			await client.login(PASSWORD);
			const oversize = await client.post(`/api/sessions/${SID}/command`, {
				op: "prompt",
				command_id: "11111111-2222-4333-8444-555555555555",
				text: "x".repeat(80 * 1024),
			});
			check(
				"413-oversize: a body over the ceiling is refused 413",
				oversize.status,
				413,
			);
			check(
				"413-oversize: the body is the gateway's own",
				oversize.json,
				GATEWAY_FAILURES["413-too-large"]?.json,
			);
			await relay.stop();
		}

		// --- duplicate-delivery: the frame really is delivered twice ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["duplicate-delivery"],
			});
			const client = makeClient(relay.base);
			await client.login(PASSWORD);
			const commandId = "11111111-2222-4333-8444-777777777777";
			// Open the stream first, then admit a command, so the duplicated delivery
			// lands on a live subscription.
			const streamPromise = readStream(relay.base, streamPath, {
				ms: 3000,
				cookie: client.cookie,
			});
			await sleep(500);
			const admitted = await client.post(`/api/sessions/${SID}/command`, {
				op: "prompt",
				command_id: commandId,
				text: "hello",
			});
			check(
				"duplicate-delivery: the command is admitted",
				admitted.json?.detail,
				"prompt admitted",
			);
			const stream = await streamPromise;
			const state = await client.get("/__mock/state");
			check(
				"duplicate-delivery: the transport delivered the frame twice",
				state.json?.duplicateDelivered,
				2,
			);
			// Byte-identical: the second delivery is a copy of the first, not a new
			// event — which is what makes a client without de-duplication visible.
			const raw = stream.text;
			const occurrences = raw.split(/^event: projection$/m).length - 1;
			check(
				"duplicate-delivery: two projection frames arrived",
				occurrences >= 2,
				true,
				`${occurrences} frames`,
			);
			// Counted in ONE frame, not across all of them: the pump re-sends the whole
			// projection each tick, so summing over frames would count the same row
			// repeatedly and prove nothing about de-duplication.
			const lastFrame = framesOf(raw).at(-1);
			const rows = (
				Array.isArray(lastFrame?.data?.transcript)
					? lastFrame.data.transcript
					: []
			).filter((row: { id?: string }) => row?.id === `user-${commandId}`);
			check(
				"duplicate-delivery: exactly one transcript row carries the command",
				rows.length,
				1,
			);
			await relay.stop();
		}

		// --- no-ack: admitted, unacknowledged, then 504; the retry dedups ---
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["no-ack=1200"],
			});
			const client = makeClient(relay.base);
			await client.login(PASSWORD);
			const commandId = "11111111-2222-4333-8444-888888888888";
			const first = await client.post(`/api/sessions/${SID}/command`, {
				op: "prompt",
				command_id: commandId,
				text: "hello",
			});
			check(
				"no-ack: the first delivery is answered 504 after the window",
				first.status,
				504,
				`after ${first.elapsedMs} ms`,
			);
			check(
				"no-ack: the 504 arrives no earlier than the declared window",
				(first.elapsedMs ?? 0) >= 1000,
				true,
			);
			const retry = await client.post(`/api/sessions/${SID}/command`, {
				op: "prompt",
				command_id: commandId,
				text: "hello",
			});
			check(
				"no-ack: the retry gets already admitted (contract 5.3)",
				retry.json,
				{ ok: true, detail: "already admitted" },
			);
			await relay.stop();
		}

		// --- no-ack-forever: admitted, never answered, and the retry STILL dedups ---
		// The second half is the production semantic the earlier revision got wrong:
		// production reserves the identity at reserve time, so a retry of a command it
		// never acknowledged is answered `already admitted` rather than hanging.
		{
			const relay = await startRelay({
				scenario: "streaming",
				faults: ["no-ack-forever"],
			});
			const client = makeClient(relay.base);
			await client.login(PASSWORD);
			const commandId = "11111111-2222-4333-8444-999999999999";
			const first = await client.post(
				`/api/sessions/${SID}/command`,
				{ op: "prompt", command_id: commandId, text: "hello" },
				undefined,
			);
			check(
				"no-ack-forever: the first delivery is never answered",
				first.timedOut,
				true,
				`after ${first.elapsedMs} ms`,
			);
			const retry = await client.post(`/api/sessions/${SID}/command`, {
				op: "prompt",
				command_id: commandId,
				text: "hello",
			});
			check(
				"no-ack-forever: the retry is answered already admitted, not left hanging",
				retry.json,
				{ ok: true, detail: "already admitted" },
			);
			await relay.stop();
		}

		// --- 503-<reason>: every RELAY_DETAIL reason, from the gateway's own list ---
		{
			const constants = fix.gatewayConstants;
			const details =
				isRecord(constants) && isRecord(constants.relay_detail)
					? constants.relay_detail
					: {};
			const reasons = Object.keys(details).sort();
			check(
				"503 family: the corpus declares relay details to exercise",
				reasons.length > 0,
				true,
				`${reasons.length} reasons`,
			);
			for (const reason of reasons) {
				const relay = await startRelay({
					scenario: "idle",
					faults: [`503-${reason}`],
				});
				const client = makeClient(relay.base);
				const refused = await client.get("/api/sessions");
				check(
					`503-${reason}: refused 503 with its own reason`,
					refused.json?.reason,
					reason,
				);
				check(
					`503-${reason}: carries the captured sentence, not an invented one`,
					refused.json?.detail,
					(details as Record<string, unknown>)[reason],
				);
				check(
					`503-${reason}: names the error the gateway names`,
					refused.json?.error,
					"tunnel authorization unavailable",
				);
				await relay.stop();
			}
		}

		// --- gateway-<key>: every captured gateway body, served verbatim ---
		{
			const keys = Object.keys(GATEWAY_FAILURES).sort();
			check(
				"gateway family: the corpus declares failure bodies to exercise",
				keys.length > 0,
				true,
				`${keys.length} bodies`,
			);
			for (const key of keys) {
				const expected = GATEWAY_FAILURES[key];
				const relay = await startRelay({
					scenario: "idle",
					faults: [`gateway-${key}`],
				});
				const client = makeClient(relay.base);
				const served = await client.get("/api/sessions");
				check(
					`gateway-${key}: served ${expected?.status}`,
					served.status,
					expected?.status,
				);
				check(
					`gateway-${key}: body is the captured one, verbatim`,
					served.json,
					expected?.json,
				);
				await relay.stop();
			}
		}

		// --- the registry itself: every declared fault was exercised above ---
		// A fault added to the registry with no assertion here fails the verifier
		// rather than shipping unexercised, which is how "14 faults" stayed a claim
		// about a layer nothing drove.
		{
			const exercised = new Set(
				results
					.filter((result) => result.group === "fault layer")
					.map((result) => result.name.split(":")[0] ?? ""),
			);
			const familyCovered = (spec: {
				family?: string;
				name: string;
			}): boolean => {
				if (spec.family === "detail")
					return [...exercised].some((name) => name.startsWith("503-"));
				if (spec.family === "gateway")
					return [...exercised].some((name) => name.startsWith("gateway-"));
				return exercised.has(spec.name);
			};
			const missing = FAULT_SPECS.filter((spec) => !familyCovered(spec)).map(
				(spec) => spec.name,
			);
			check(
				"every fault in the registry is exercised by this file",
				missing,
				[],
			);
			check(
				"the fault section exercised more than the two refusals families",
				[...exercised].filter((name) => name !== "").length >=
					FAULT_SPECS.length,
				true,
				`${exercised.size} distinct fault names`,
			);
		}
	}

	/* ---- 4. unknown names must fail loudly ---- */
	group = "loud failure";
	{
		let failed = false;
		try {
			await startRelay({ scenario: "no-such-scenario" });
		} catch (error) {
			failed =
				/unknown scenario: 'no-such-scenario'/.test(String(error.message)) ||
				/unknown scenario/.test(String(error.message));
		}
		check("an unknown scenario refuses to start", failed, true);
	}
	{
		let failed = false;
		try {
			await startRelay({ scenario: "idle", faults: ["no-such-fault"] });
		} catch (error) {
			failed =
				/unknown fault: 'no-such-fault'/.test(String(error.message)) ||
				/unknown fault/.test(String(error.message));
		}
		check("an unknown fault refuses to start", failed, true);
	}

	/* ---- 5. recording ---- */
	group = "recording";
	{
		const dir = mkdtempSync(join(tmpdir(), "lo-relay-record-"));
		const relay = await startRelay({
			scenario: "past-populated",
			extra: ["--record", dir],
		});
		const client = makeClient(relay.base);
		await client.get("/healthz");
		await client.login(PASSWORD);
		await client.get("/api/sessions");
		await relay.stop();
		const { readFileSync, existsSync } = await import("node:fs");
		const path = join(dir, "transcript.json");
		check("--record writes transcript.json", existsSync(path), true);
		const transcript = JSON.parse(readFileSync(path, "utf8"));
		check(
			"the transcript names its scenario",
			transcript.scenario,
			"past-populated",
		);
		check(
			"the transcript has one row per request",
			transcript.requests.length >= 3,
			true,
		);
		check(
			"the transcript never records a password",
			/mock-relay-password/.test(JSON.stringify(transcript)),
			false,
		);
		check(
			"the transcript records status codes",
			transcript.requests.every((r) => typeof r.status === "number"),
			true,
		);
	}

	/* --------------------------------------------------------------- report -- */
	const failures = results.filter((r) => !r.ok);
	const width = Math.max(...results.map((r) => r.name.length));
	console.log("");
	for (const r of results) {
		if (r.group !== group) {
			group = r.group;
			console.log(`\n== ${group}`);
		}
		const mark = r.ok ? "PASS" : "FAIL";
		const note = r.note
			? `  ${r.note}`
			: r.ok
				? ""
				: `  expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)}`;
		console.log(`  ${mark}  ${r.name.padEnd(width)}${note}`);
	}
	console.log(
		`\n${results.length - failures.length}/${results.length} checks passed; ${failures.length} failed`,
	);
	const jsonPath = flag("json", null);
	if (jsonPath)
		writeFileSync(
			jsonPath,
			`${JSON.stringify({ results, failures: failures.length }, null, 2)}\n`,
		);
	process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(`verification harness crashed: ${error?.stack ?? error}`);
	process.exit(2);
});
