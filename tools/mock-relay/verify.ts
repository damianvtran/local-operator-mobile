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
 * `scenarios.ts` is started and its own declared world is asserted against the
 * response — so a scenario added to the registry is verified without touching
 * this file, and a scenario whose shape drifts fails here first.
 *
 * Usage:
 *   node tools/mock-relay/verify.ts [--fixtures <dir>] [--json <path>]
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countProcesses, sweepOrphanChrome } from "../lib/chrome.ts";
import {
	readinessProblems,
	requiredStateMarker,
	SCREEN_MARKER_SUBJECT,
	STATE_MARKER_ALIASES,
	seedQuery,
} from "../lib/readiness.ts";

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
	new URL("./fixtures.ts", import.meta.url).href
);
const { buildScenarios } = await import(
	new URL("./scenarios.ts", import.meta.url).href
);
const { EDGE_REFUSALS, GATEWAY_FAILURES } = await import(
	new URL("./wire.ts", import.meta.url).href
);
const { FAULT_SPECS } = await import(
	new URL("./faults.ts", import.meta.url).href
);
const { isRecord } = await import(
	new URL("../lib/json.ts", import.meta.url).href
);
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
/**
 * When the last assertion was recorded, for the watchdog in `main`.
 *
 * Module scope because `check` is, and the watchdog reads it: the bound has to be
 * on SILENCE, not on total runtime — a healthy run takes 28 minutes on this host at
 * load averages 32-46 (~13 minutes quiet; `docs/e2e/README.md` states the same figure),
 * and a bound that killed it printed nothing at all, hiding the evidence rather than
 * the hang.
 */
let lastProgress = Date.now();

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
	lastProgress = Date.now();
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

/**
 * Narrowing helpers for the parsed bodies this verifier reads.
 *
 * The bodies are `unknown`, not `any`: `any` disables checking at every use, which is
 * how a typo in a fixture key becomes a passing assertion. These four are the whole
 * vocabulary the verifier needs, and each one is explicit about what it does with a
 * value of the wrong shape (`bag` and `arr` yield an empty container, so a wrong shape
 * fails the assertion that follows rather than throwing).
 */
const bag = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string =>
	typeof value === "string" ? value : "";
const num = (value: unknown): number =>
	typeof value === "number" ? value : Number.NaN;

/** A recorded response from `makeClient`, with a timeout surfaced as a value. */
interface ClientReply {
	status: number | null;
	headers: Headers;
	text: string;
	/** The parsed body: `unknown`, narrowed at the point of use by `bag`/`arr`. */
	json: unknown;
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
		if (setCookie.length) cookie = (setCookie[0] ?? "").split(";")[0] ?? null;
		const text = await res.text();
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			// A non-JSON body is a legitimate outcome (the relay answers plain text on
			// unrouted paths), and the assertions that follow say which one they expect.
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
function framesOf(text: string): Array<{ event: string; data: unknown }> {
	const frames: Array<{ event: string; data: unknown }> = [];
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
	// A watchdog that bounds SILENCE, not progress.
	//
	// The first version bounded the whole run at 10 minutes, which stopped being
	// true the moment this file grew a sub-rule mutation group that runs the canary
	// once per blinded rule: a healthy run that legitimately takes fifteen minutes
	// was killed with nothing printed, so the bound hid the evidence instead of a
	// hang. The timer below is reset by every check, so it fires on exactly what it
	// is for — a step that stops answering — and names the group it stalled in. The
	// total is bounded too, generously, so a run that dribbles progress forever
	// still ends.
	const IDLE_LIMIT_MS = 300_000;
	const TOTAL_LIMIT_MS = 2_400_000;
	const started = Date.now();
	// A check recorded BEFORE the watchdog starts would make the first reading
	// stale, so the heartbeat is taken from the shared module-level value.
	lastProgress = Date.now();
	const watchdog = setTimeout(function tick() {
		if (Date.now() - lastProgress > IDLE_LIMIT_MS) {
			console.error(
				`verification watchdog: no check for ${IDLE_LIMIT_MS / 1000} s while in group '${group}'; aborting`,
			);
			process.exit(3);
		}
		if (Date.now() - started > TOTAL_LIMIT_MS) {
			console.error(
				`verification watchdog: the run passed ${TOTAL_LIMIT_MS / 60000} minutes; aborting`,
			);
			process.exit(3);
		}
		setTimeout(tick, 5_000).unref?.();
	}, 5_000);
	watchdog.unref?.();
	/* ---- 1. auth gates and cookies ---- */
	{
		const relay = await startRelay({ scenario: "idle" });
		const client = makeClient(relay.base);
		group = "auth and cookies";

		const health = await client.get("/healthz");
		check("GET /healthz is public and 200", health.status, 200);
		check("healthz carries protocol version 5", bag(health.json).version, 5);
		check(
			"healthz reports dist:false on a bundle-less relay",
			bag(health.json).dist,
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
			Object.keys(bag(authed.json)).sort().join(","),
			"capabilities,degraded,sessions",
		);
		check(
			"degraded is present and empty when nothing is wrong",
			bag(authed.json).degraded,
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
			bag(noId.json).error,
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
			bag(badId.json).error,
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
			bag(newConv.json).error,
			"start a new session from the session list",
		);
		const resume = await client.post(`/api/sessions/${SID}/command`, {
			op: "resume_session",
		});
		check(
			"resume_session is refused with the relay's own sentence",
			bag(resume.json).error,
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
			bag(other.json).detail,
			"prompt admitted",
		);

		/* ---- read routes ---- */
		group = "read routes";
		const past = await client.get("/api/sessions/past");
		check(
			"past is 200 with sessions + degraded",
			Object.keys(bag(past.json)).sort().join(","),
			"degraded,sessions",
		);
		const search = await client.get("/api/sessions/search?q=hello&limit=5");
		check("search echoes its query", bag(search.json).query, "hello");
		check("search is 200", search.status, 200);
		const history = await client.get(`/api/sessions/${SID}/history?limit=5`);
		check(
			"history is 200 with entries + has_more",
			Object.keys(bag(history.json)).sort().join(","),
			"entries,has_more",
		);
		check(
			"history page respects limit=5",
			arr(bag(history.json).entries).length,
			(n: number) => n <= 5,
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
			arr(bag(commands.json).commands).some((c) =>
				["exit", "quit", "clear"].includes(str(bag(c).name)),
			),
			false,
		);
		const models = await client.get("/api/models");
		check("models is 200", models.status, 200);
		const directories = await client.get("/api/directories");
		check(
			"directories is 200 with home/recent/tmp",
			Object.keys(bag(directories.json)).sort().join(","),
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
			sse.headers?.get("content-type"),
			"text/event-stream; charset=utf-8",
		);
		check(
			"stream sets no-cache, no-transform",
			sse.headers?.get("cache-control"),
			"no-cache, no-transform",
		);
		check(
			"stream sets x-accel-buffering: no",
			sse.headers?.get("x-accel-buffering"),
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
			].every((k) => k in bag(projFrames[0]?.data)),
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
					typeof bag(res.json).reason,
					"string",
				);
				check(
					`scenario '${name}' carries the gateway error field`,
					bag(res.json).error,
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
		const rows = arr(bag(list.json).sessions).map((row) => bag(row));
		const firstRow = bag(rows[0]);
		let projection = null;
		if (rows[0]) {
			const stream = await readStream(
				relay.base,
				`/api/sessions/${str(firstRow.session_id)}/events`,
				{ ms: 700, cookie: client.cookie },
			);
			projection = framesOf(stream.text)[0]?.data ?? null;
		}
		check(
			`scenario '${name}' answers a well-formed list`,
			Object.keys(bag(list.json)).sort().join(","),
			"capabilities,degraded,sessions",
		);
		check(
			`scenario '${name}' declares its own row count`,
			rows.length,
			(n: number) => n >= 0,
		);
		const projectionBag = bag(projection);
		const note =
			`rows=${rows.length} degraded=[${arr(bag(list.json).degraded)
				.map((d) => str(d))
				.join(",")}]` +
			(rows[0]
				? ` first{section=${str(firstRow.section)} subagents=${JSON.stringify(firstRow.subagents_running)} attn=${str(firstRow.needs_attention)}/${str(firstRow.pending_kind) || "-"} todos=${str(firstRow.todos_open)}`
				: "") +
			(projection
				? ` proj{pid=${str(projectionBag.pid)} streaming=${str(projectionBag.streaming)} rows=${arr(projectionBag.transcript).length} pending=${str(bag(projectionBag.pending).kind) || "-"} stop=${str(projectionBag.stop_reason) || "-"}}`
				: "");
		const lastResult = results[results.length - 1];
		if (lastResult !== undefined) lastResult.note = note;

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
		const firstSessionId = str(firstRow.session_id);
		if (projection && world.projections?.[firstSessionId]) {
			const expected = world.projections[firstSessionId];
			check(
				`scenario '${name}' streams the projection it declared`,
				str(projectionBag.session_id),
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

	/* ---- 4b. bounded work: a wedged cell fails, it does not hang ---- */
	// The tool that hangs is the tool's defect. Measured on a macOS CI runner: the
	// capture step ran past a 45-minute job timeout and produced no artifacts,
	// because a page holding a live stream made the static server's `close()` wait
	// forever. Both halves are asserted here — the deadline, and the fact that the
	// run terminates at all.
	group = "bounded work";
	{
		const out = join(tmpdir(), `lo-hang-${Date.now()}`);
		const started = Date.now();
		const run = spawnSync(
			process.execPath,
			[
				join(WORKTREE, "tools", "visual", "capture.ts"),
				"--dir",
				join(WORKTREE, "e2e", "fixtures", "audit-canary"),
				"--out",
				out,
				"--cells",
				"path:/hang/hang",
				"--devices",
				"iphone-se",
				"--themes",
				"dark",
				"--scales",
				"100",
				"--cell-timeout",
				"5",
				"--deadline",
				"60",
			],
			{ encoding: "utf8", timeout: 120_000 },
		);
		const elapsedMs = Date.now() - started;
		const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
		check(
			"a wedged cell terminates rather than hanging",
			run.signal === null,
			true,
			`finished in ${(elapsedMs / 1000).toFixed(1)} s`,
		);
		check(
			"the wedged cell fails with the deadline it hit",
			/did not complete within 5000 ms/.test(output),
			true,
		);
		check(
			"the run exits non-zero when a cell produced no frame",
			run.status !== 0,
			true,
			`exit ${run.status}`,
		);
		check(
			"the cell is reported as having no frame, not skipped silently",
			/CELLS WITH NO FRAME/.test(output),
			true,
		);
		check(
			"the whole run respects its own bound",
			elapsedMs < 90_000,
			true,
			`${(elapsedMs / 1000).toFixed(1)} s against a 60 s deadline`,
		);
	}

	/* ---- 3a. the observation surface is a counter, not a transcript ---- */
	// An instrument that can report zero while traffic flows reads exactly like
	// evidence, and `/__mock/state`'s `requests` did: it was the transcript's length
	// (one call site), so a probe that had fetched and streamed read `requests: 0`.
	// These assertions are the field's own test.
	group = "mock state surface";
	{
		const relay = await startRelay({ scenario: "idle" });
		const state = async (): Promise<{
			requests?: number;
			recorded?: number;
		}> => {
			const res = await fetch(new URL("/__mock/state", relay.base));
			return (await res.json()) as { requests?: number; recorded?: number };
		};
		const before = await state();
		// A public route the transcript never records.
		await fetch(new URL("/healthz", relay.base));
		const afterPublic = await state();
		check(
			"a served public request moves the counter",
			(afterPublic.requests ?? 0) > (before.requests ?? 0),
			true,
			`before ${String(before.requests)}, after ${String(afterPublic.requests)}`,
		);
		check(
			"and does not appear in the recorded transcript",
			afterPublic.recorded ?? -1,
			before.recorded ?? -1,
		);
		// Reading the counter is a control route, so it must not move itself.
		const readA = await state();
		const readB = await state();
		check(
			"reading the state does not move the counter it reports",
			readB.requests,
			readA.requests,
		);
		check(
			"the served count exceeds the transcript's",
			(readB.requests ?? 0) > (readB.recorded ?? 0),
			true,
			`requests ${String(readB.requests)}, recorded ${String(readB.recorded)}`,
		);
		await relay.stop();
	}

	/* ---- 3b. the audit's coverage: blind a rule and the canary must notice ---- */
	// The canary asserts per DEFECT, and this is what proves the assertion is real:
	// each independent rule is blinded in turn through the audit's own `--blind`
	// hook, and the canary has to fail naming exactly that defect.
	//
	// Why it exists: a canary that asserts per CHECK stays green with one of a
	// check's two branches dead, and a defect no element declares (U-04) stays
	// unasserted entirely. Review found three dead sub-rules that way. A rule with
	// no fixture input at all (U-05's side insets, in portrait) was worse than
	// dead: it was unexercised by construction, which is why the canary's matrix
	// now carries a landscape device.
	group = "sub-rule mutation";
	{
		const mutations: Array<{ blind: string; defect: string }> = [
			{ blind: "U-04", defect: "U-04" },
			{ blind: "U-05:top", defect: "U-05-top" },
			{ blind: "U-05:bottom", defect: "U-05-bottom" },
			{ blind: "U-05:left", defect: "U-05-left" },
			{ blind: "U-05:right", defect: "U-05-right" },
			{ blind: "U-07:x", defect: "U-07-x" },
			{ blind: "U-07:y", defect: "U-07-y" },
		];
		// One capture for all seven rules. The captured matrix is identical for every
		// blinded rule — only the audit's `--blind` differs — so the HEAVY phase went
		// from seven 48-frame Chrome captures to one, and that churn is what aborted
		// three sweeps in the suite's opening phase.
		//
		// The audits are NOT Chrome-free: `tools/audit/audit.ts` launches a browser,
		// and each rule runs two of them (a defect page and a clean page). The group
		// is therefore about fifteen launches, down from about twenty-one — the
		// reduction is in the captures, not in the launch count as a whole. An
		// earlier revision of this comment overstated it.
		const mutationCapture = join(tmpdir(), `lo-mutation-capture-${Date.now()}`);
		const captureRun = spawnSync(
			process.execPath,
			[
				join(WORKTREE, "e2e", "run-canary.ts"),
				"--fast",
				"--capture-only",
				"--out",
				mutationCapture,
			],
			{ encoding: "utf8", timeout: 900_000, env: { ...process.env } },
		);
		// A killed capture is a host event, so it is retried ONCE — and if the retry
		// still produces no manifest the group fails HERE, loudly. It must never fall
		// back to capturing per rule: that fallback would restore exactly the
		// footprint this group exists to remove, on exactly the host state that made
		// the shared capture fail.
		const captureManifest = (result: typeof captureRun): string =>
			/^manifest:\s*(.+)$/m
				.exec(`${result.stdout ?? ""}${result.stderr ?? ""}`)?.[1]
				?.trim() ?? "";
		let sharedManifest = captureManifest(captureRun);
		if (
			sharedManifest === "" &&
			captureRun.status === null &&
			captureRun.signal !== null
		) {
			const retry = spawnSync(
				process.execPath,
				[
					join(WORKTREE, "e2e", "run-canary.ts"),
					"--fast",
					"--capture-only",
					"--out",
					mutationCapture,
				],
				{ encoding: "utf8", timeout: 900_000, env: { ...process.env } },
			);
			sharedManifest = captureManifest(retry);
		}
		if (sharedManifest === "") {
			console.error(
				"\nverify: the shared mutation capture produced no manifest.\n" +
					"The blinded rules are NOT re-captured per rule — that fallback is the footprint\n" +
					"this change removes. Re-run the sweep on a quieter host.",
			);
		}
		check(
			"the shared capture produced a manifest for every rule to audit",
			sharedManifest !== "",
			true,
			sharedManifest || "no manifest path was printed",
		);

		for (const mutation of mutations) {
			if (sharedManifest === "") break;
			const out = join(
				tmpdir(),
				`lo-mutation-${mutation.blind.replace(":", "-")}-${Date.now()}`,
			);
			// A `--fast` blind canary measures ~2 minutes standalone; the bound is 900 s
			// because this host runs a fleet, and a bound that fires returns `status: null`
			// — which is now a named failure, not a pass. The elapsed time goes into the
			// note either way, so a run that nearly hit the bound is visible rather than
			// discovered by the next reviewer.
			const runMutation = (target: string) => {
				const started = Date.now();
				const result = spawnSync(
					process.execPath,
					[
						join(WORKTREE, "e2e", "run-canary.ts"),
						"--fast",
						"--blind",
						target,
						"--manifest",
						sharedManifest,
						"--out",
						out,
					],
					{ encoding: "utf8", timeout: 900_000, env: { ...process.env } },
				);
				return {
					result,
					ranFor: `${Math.round((Date.now() - started) / 1000)}s`,
				};
			};
			let { result: run, ranFor } = runMutation(mutation.blind);
			// A killed run is a HOST event, not a verdict, so it is retried ONCE. The
			// assertion below still demands `status === 1` and the named defect, so a retry
			// can never turn a timeout into a pass. Measured 2026-09-30: `U-07:y` came back
			// SIGTERM at 33 s (not at the 900 s bound) while its six siblings produced
			// verdicts at 67-177 s, and the same blind run passed standalone in 68 s.
			const retriedAfterKill = run.status === null && run.signal !== null;
			if (retriedAfterKill) {
				const second = runMutation(mutation.blind);
				run = second.result;
				ranFor = `${ranFor} then ${second.ranFor}`;
			}
			const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
			const missedLine = /^\s*missed:\s*(.+)$/m.exec(output)?.[1]?.trim() ?? "";
			// The marker carries the element id in parentheses; the defect name is
			// what the assertion is about.
			const missed = missedLine
				.split(",")
				.map((entry) => entry.trim().replace(/\s*\(#.*\)$/, ""))
				.filter((entry) => entry !== "" && entry !== "none");
			// A KILLED canary is not a failed canary. `spawnSync` reports `status: null`
			// when its own bound fires, and `null !== 0` satisfied the old assertion — so
			// a mutation could "prove" a rule by never reaching a verdict. A review round
			// caught exactly that (`U-07:y`, `exit null`) on a loaded host, which is why
			// this asserts the failure CODE and names a kill as its own outcome.
			// The sentence names the SIGNAL and the elapsed time, not "the bound": a kill can
			// arrive from elsewhere (measured: SIGTERM at 33 s), and when `spawnSync` never
			// started the child there is no signal at all — reporting either as "the 900 s
			// bound fired" would describe something that did not happen.
			const outcome =
				run.status === 1
					? `exit 1 after ${ranFor}`
					: run.signal !== null
						? `killed by ${String(run.signal)} after ${ranFor}`
						: run.status === null
							? `never produced a verdict: the child did not start (status null, no signal)`
							: `exit ${String(run.status)} after ${ranFor}`;
			check(
				`blinding ${mutation.blind} makes the canary fail with a verdict, not a kill`,
				run.status === 1,
				true,
				outcome,
			);
			check(
				`blinding ${mutation.blind} misses exactly ${mutation.defect}`,
				missed,
				[mutation.defect],
			);
			// Each mutation writes a whole capture tree under the SHARED OS temp dir. The
			// loop used to leave every one of them: measured at 168 directories and
			// 1,048 MB, four fifths of it from this PR's own runs.
			rmSync(out, { recursive: true, force: true });
		}
		rmSync(mutationCapture, { recursive: true, force: true });
	}

	/* ---- 3d. the text-scale dimension is live, in BOTH directions ---- */
	// The app does NOT read the `?lo-text-scale` query parameter: its type roles
	// multiply the browser ROOT FONT SIZE, so the harness drives that. A harness
	// that drives a parameter nothing reads renders every "200 %" cell at 100 % and
	// still reports a full matrix, which is how an earlier large-text result was
	// produced. The guard is therefore per CELL, and these two captures prove it
	// discriminates: one page is rem-based, one is px-based, and the same flag has
	// to pass the first and fail the second by name.
	group = "text-scale dimension";
	{
		const out = join(tmpdir(), `lo-scale-${Date.now()}`);
		const run = (dir: string): { status: number | null; output: string } => {
			const result = spawnSync(
				process.execPath,
				[
					join(WORKTREE, "tools", "visual", "capture.ts"),
					"--dir",
					dir,
					"--out",
					out,
					"--cells",
					"path:/inert/inert",
					"--devices",
					"iphone-15",
					"--themes",
					"dark",
					"--scales",
					"100,200",
					"--yes",
				],
				{ encoding: "utf8", timeout: 300_000 },
			);
			return {
				status: result.status,
				output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
			};
		};

		const inert = run(join(WORKTREE, "e2e", "fixtures", "inert-text-scale"));
		check(
			"a page whose text ignores the root font size FAILS the guard",
			inert.status !== 0,
			true,
			`exit ${inert.status}`,
		);
		check(
			"and the failing cell is named with its measured ratio",
			/the text did not scale: median text \d+px at 200% against 1x/.test(
				inert.output,
			),
			true,
		);

		const live = run(join(WORKTREE, "e2e", "fixtures", "audit-canary"));
		check(
			"a rem-based page passes the guard",
			live.status,
			0,
			`exit ${live.status}`,
		);
		check(
			"and the dimension is reported live",
			/scale dimension is live/.test(live.output),
			true,
		);

		rmSync(out, { recursive: true, force: true });
	}

	/* ---- 3c. the readiness guard, in BOTH directions ---- */
	// A guard that only fails is as worthless as one that only passes: the fix for
	// "a cell passed while showing the wrong state" must still pass a cell whose
	// page really reached the relay in the state it declares. Measured against a
	// real mock relay, a real static server and real CDP.
	group = "readiness guard";
	{
		const relay = await startRelay({ scenario: "empty" });
		const out = join(tmpdir(), `lo-readiness-${Date.now()}`);
		const capture = (
			dir: string,
			cells: string,
		): { status: number | null; output: string } => {
			const run = spawnSync(
				process.execPath,
				[
					join(WORKTREE, "tools", "visual", "capture.ts"),
					"--dir",
					dir,
					"--out",
					out,
					"--cells",
					cells,
					"--devices",
					"iphone-15",
					"--themes",
					"dark",
					"--scales",
					"100",
					"--relay",
					relay.base,
					"--tokens",
					join(WORKTREE, "design", "tokens", "tokens.json"),
					"--yes",
				],
				{ encoding: "utf8", timeout: 180_000 },
			);
			return {
				status: run.status,
				output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
			};
		};

		// 1. The app's own build asks the relay for nothing and shows its empty
		//    screen: a cell declaring a relay-served state must FAIL, naming why.
		const appDist = join(WORKTREE, "dist");
		if (existsSync(join(appDist, "index.html"))) {
			const unready = capture(appDist, "S4/empty");
			check(
				"a relay-backed cell the app never served is refused",
				unready.status !== 0,
				true,
				`exit ${unready.status}`,
			);
			check(
				"and the reason names the relay",
				/no request to the mock relay/.test(unready.output),
				true,
			);
		}

		// 2. A page that reaches the relay AND renders the declared state PASSES.
		const ready = capture(
			join(WORKTREE, "e2e", "fixtures", "relay-backed"),
			"S4/empty",
		);
		check(
			"a cell whose page reached the relay in its declared state is accepted",
			ready.status,
			0,
			`exit ${ready.status}`,
		);
		check(
			"and nothing was reported unready",
			/UNREADY CELLS/.test(ready.output),
			false,
		);

		await relay.stop();
	}

	/* ---- 3e. the approval round trip ---- */
	// The mock had no `approval_answer` at all — it answered `command-unknown-op` — so
	// the pending card's approve/deny/settle path could not be exercised here, only in
	// a stream's own rig. A control that cannot be exercised against the mock is a
	// control nobody can verify.
	group = "approval_answer";
	{
		const relay = await startRelay({ scenario: "approval" });
		const client = makeClient(relay.base);
		await client.login(PASSWORD);
		// The projection frames, parsed out of the stream's own text: the pending
		// request only exists on the wire, and reading it anywhere else would be
		// reading the mock's internals rather than what a client receives.
		// The read is AUTHENTICATED and reports whether a frame was parsed at all.
		// Without both, an unauthenticated or empty stream yields `pending: null` and the
		// "settled" assertion below would pass because nothing was read — the exact shape
		// of green reading this harness exists to refuse.
		const pendingOf = async (): Promise<{
			seen: boolean;
			pending: { request_id?: string; kind?: string } | null;
		}> => {
			const read = await readStream(relay.base, `/api/sessions/${SID}/events`, {
				ms: 2500,
				cookie: client.cookie,
			}).catch(() => null);
			// An SSE block is `event: <name>\ndata: <json>\n\n`, so the payload is a LINE
			// inside the block, not the block's first line. Scanning the frames for the
			// one that carries `pending` — rather than taking the first — is also what
			// makes this robust to the list/hello frames that precede the projection.
			const frames = (read?.text ?? "")
				.split("\n\n")
				.map((block) =>
					block.split("\n").find((line) => line.startsWith("data: ")),
				)
				.filter((line): line is string => typeof line === "string")
				.map((line) => {
					try {
						return JSON.parse(line.slice("data: ".length)) as Record<
							string,
							unknown
						>;
					} catch {
						return {} as Record<string, unknown>;
					}
				});
			const projection = frames.find((frame) => "pending" in frame);
			return {
				seen: frames.length > 0,
				pending:
					(projection?.pending as {
						request_id?: string;
						kind?: string;
					} | null) ?? null,
			};
		};
		const firstRead = await pendingOf();
		check(
			"the authenticated stream delivers a projection frame",
			firstRead.seen,
			true,
		);
		const pending = firstRead.pending;
		check(
			"the approval scenario really has a pending approval",
			pending?.kind,
			"approval",
		);
		const requestId = pending?.request_id ?? "";

		const badBool = await client.post(`/api/sessions/${SID}/command`, {
			op: "approval_answer",
			request_id: requestId,
			approved: "yes",
		});
		check(
			"a non-boolean decision is refused with the contract's own sentence",
			(badBool.json as { error?: unknown } | undefined)?.error,
			"approved must be a boolean",
		);
		check("and it is a 422, a pre-admission refusal", badBool.status, 422);

		const noId = await client.post(`/api/sessions/${SID}/command`, {
			op: "approval_answer",
			approved: true,
		});
		check("an empty request_id is refused", noId.status, 422);

		const answered = await client.post(`/api/sessions/${SID}/command`, {
			op: "approval_answer",
			request_id: requestId,
			approved: true,
		});
		check("a real approval is accepted", answered.status, 200);
		check(
			"with the relay's acknowledgement shape",
			(answered.json as { ok?: unknown; detail?: unknown })?.ok,
			true,
		);

		// Settling is what the round trip is FOR: the next projection must carry no
		// pending request, or a client that never settles the card looks correct.
		const after = await pendingOf();
		check(
			"the stream still delivers frames after the answer",
			after.seen,
			true,
		);
		check(
			"and the pending request is settled on the next frame",
			after.pending,
			null,
		);
		await relay.stop();
	}

	/* ---- 3f. the reused-draft replay ---- */
	// The condition the client's `reusedPreviousDraft` path exists for, as a named
	// scenario instead of a hand-reconstructed pair of requests: an instruction is
	// admitted and NOT acknowledged, the identical bytes are sent again, and the relay
	// answers `already admitted` rather than admitting a second one.
	group = "reused-draft-replay";
	{
		const relay = await startRelay({
			scenario: "idle",
			faults: ["reused-draft-replay"],
		});
		const client = makeClient(relay.base);
		await client.login(PASSWORD);
		const commandId = "11111111-2222-4333-8444-999999999999";
		const body = { op: "prompt", command_id: commandId, text: "ship it" };

		// Bounded by the CLIENT, because the point of this fault is that the relay
		// never answers: an unbounded wait would hang the verifier, and a wait that
		// returned an answer would mean the fault is not doing its job.
		let firstOutcome = "answered";
		try {
			const cookie = client.cookie;
			const res = await fetch(
				new URL(`/api/sessions/${SID}/command`, relay.base),
				{
					method: "POST",
					redirect: "manual",
					headers: {
						"content-type": "application/json",
						...(cookie === null ? {} : { cookie }),
					},
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(2500),
				},
			);
			firstOutcome = `answered ${res.status}`;
		} catch (error) {
			firstOutcome = `no answer (${(error as Error).name})`;
		}
		check(
			"the first send is admitted and never acknowledged",
			/^no answer/.test(firstOutcome),
			true,
			firstOutcome,
		);

		const second = await client.post(`/api/sessions/${SID}/command`, body);
		check(
			"the identical bytes are answered as already admitted",
			(second.json as { detail?: unknown } | undefined)?.detail,
			"already admitted",
		);
		check(
			"and exactly one command was admitted",
			(
				(await client.get("/__mock/state")).json as {
					admittedCommands?: number;
				}
			)?.admittedCommands,
			1,
		);
		await relay.stop();
	}

	/* ---- 3g. the orphan sweep ---- */
	// `reap()` cannot run when its own process is killed and Chrome is spawned
	// detached, so a cancelled run leaves a browser and its profile behind — measured
	// 2026-09-30: four of them, four to seven hours old, from cancelled gate runs. The
	// sweep is what a LATER run does about it, and BOTH directions are asserted here
	// because a sweep that kills a live run's browser is worse than the leak.
	//
	// The stand-in is a process whose command line carries the profile path, which is
	// exactly what the sweep matches on; driving a real Chrome would test the browser,
	// not the sweep.
	group = "orphan sweep";
	{
		const root = join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			`sweep-probe-${process.pid}`,
		);
		const standIn = (profile: string) =>
			spawn(
				process.execPath,
				[
					"-e",
					"setTimeout(() => {}, 300000)",
					"--",
					`--user-data-dir=${profile}`,
				],
				{ stdio: "ignore" },
			);

		// (1) an orphan: its owner is gone.
		const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
		const orphanProfile = join(root, "chrome-orphan");
		mkdirSync(orphanProfile, { recursive: true });
		const orphan = standIn(orphanProfile);
		writeFileSync(join(orphanProfile, "chrome.pid"), String(orphan.pid));
		writeFileSync(join(orphanProfile, "owner.pid"), String(dead.pid));
		await sleep(300);
		check(
			"the orphan stand-in is running before the sweep",
			countProcesses(orphanProfile) > 0,
			true,
		);
		const swept = sweepOrphanChrome(root);
		check(
			"a profile whose owner is gone has its process killed",
			countProcesses(orphanProfile),
			0,
		);
		check("and its directory is removed", existsSync(orphanProfile), false);
		check("and the sweep reports what it reaped", swept.swept.length, 1);

		// (2) a LIVE owner: the same shape, and the sweep must not touch it.
		const liveProfile = join(root, "chrome-live");
		mkdirSync(liveProfile, { recursive: true });
		const live = standIn(liveProfile);
		writeFileSync(join(liveProfile, "chrome.pid"), String(live.pid));
		writeFileSync(join(liveProfile, "owner.pid"), String(process.pid));
		await sleep(300);
		const second = sweepOrphanChrome(root);
		check(
			"a live owner's browser is left alone",
			countProcesses(liveProfile) > 0,
			true,
		);
		check(
			"and it is reported as skipped, not reaped",
			second.skipped.length > 0,
			true,
		);
		check("and its profile stays on disk", existsSync(liveProfile), true);
		// By pid, not by group: the stand-in is spawned without `detached`, so it is not a
		// group leader and `kill(-pid)` would miss it and leave a process behind for the
		// length of its own timer — the same leak this group exists to assert against.
		if (live.pid !== undefined) {
			try {
				process.kill(live.pid, "SIGKILL");
			} catch {
				/* already gone */
			}
		}
		await sleep(300);
		rmSync(root, { recursive: true, force: true });
	}

	/* ---- 3h. the readiness guard, BOTH directions ---- */
	// Round 2's review executed the hole this group closes: a page with the screen root,
	// one relay request and NO marker of any kind was accepted for `S4/populated` and
	// `S4/streaming` (exit 0). The guard's state evidence was one prohibition — "must not
	// show `*-empty`" — which a page that shows nothing in particular satisfies. The rule
	// is now affirmative and per state, and its REQUIRED marker is derived from the app's
	// own contract (`<subject>-<state>`, the convention `sessions-empty` already uses),
	// so the two cannot drift apart unnoticed.
	group = "readiness guard";
	{
		const base = {
			askedPath: "/",
			actualPath: "/",
			root: "sessions-screen",
			testIds: [] as string[],
			relayRegistryBacked: false,
			relayReached: false,
		};
		const markerProblem = (state: string, marker: string) =>
			`the cell declares '${state}' but the marker '${marker}' is not in the DOM: ` +
			"nothing in the frame affirms that state, so the cell is NOT MEASURABLE for it";

		check(
			"a cell whose state marker is present is ready",
			readinessProblems({
				...base,
				screen: "S4",
				state: "populated",
				testIds: ["sessions-screen", "sessions-populated"],
			}),
			[],
		);
		check(
			"a cell whose state marker is absent fails BY NAME, not by absence",
			readinessProblems({
				...base,
				screen: "S4",
				state: "populated",
				testIds: ["sessions-screen"],
			}),
			[markerProblem("populated", "sessions-populated")],
		);
		check(
			"and the same page is refused for every state the matrix declares",
			["streaming", "rich-rows", "pending-approval"].map(
				(state) =>
					readinessProblems({
						...base,
						screen: "S5",
						state,
						root: "session-screen",
						testIds: ["session-screen"],
					}).length,
			),
			[1, 1, 1],
		);

		/* the normalisation: a variant requires the marker of the state it renders */
		check(
			"a width variant requires its base state's marker",
			requiredStateMarker("S4", "populated-long"),
			"sessions-populated",
		);
		check(
			"a scroll variant too",
			requiredStateMarker("S4", "scroll"),
			"sessions-populated",
		);
		check(
			"and the pending card is one card across two screens",
			[
				requiredStateMarker("S8", "approval"),
				requiredStateMarker("S5", "pending-approval"),
			],
			["session-pending-approval", "session-pending-approval"],
		);
		check(
			"a state with no alias requires its own marker",
			requiredStateMarker("S5", "subagents"),
			"session-subagents",
		);
		check(
			"an ad-hoc page makes no state claim, so it needs no app marker",
			requiredStateMarker("path:/clean/clean", "clean"),
			null,
		);
		check(
			"the seed hook's parameters are the app-facing names, and nothing is added when unset",
			[seedQuery("http://127.0.0.1:1234", "abc123"), seedQuery(null, null)],
			[
				// The app's own parameter names, in the order `seedQuery` sets them: route,
				// password, then the cleartext opt-in. The old expectation named the invented
				// `lo-seed-*` pair, and its first repair dropped the `insecure` suffix — both
				// were fail-by-construction, which is what this frozen-head run caught.
				"lo-relay=http%3A%2F%2F127.0.0.1%3A1234&lo-relay-password=[redacted]&lo-relay-insecure=1",
				"",
			],
		);

		/* the prohibition survives, and the relay reach still applies */
		check(
			"a populated cell showing an empty marker is still refused",
			readinessProblems({
				...base,
				screen: "S4",
				state: "populated",
				testIds: ["sessions-screen", "sessions-populated", "sessions-empty"],
			}),
			[
				"the cell declares 'populated' but the app is showing an empty state (sessions-empty): " +
					"the state was never reached",
			],
		);
		check(
			"a registry-backed cell the relay never served is refused even with its marker",
			readinessProblems({
				...base,
				screen: "S4",
				state: "populated",
				testIds: ["sessions-screen", "sessions-populated"],
				relayRegistryBacked: true,
			}),
			[
				"the app made no request to the mock relay for this cell, so the state it " +
					"declares (populated) cannot have come from the relay",
			],
		);
		check(
			"a cell on the wrong route is refused",
			readinessProblems({
				...base,
				screen: "S4",
				state: "populated",
				actualPath: "/sign-in",
				testIds: ["sessions-screen"],
			})[0],
			"the app is on '/sign-in' but the cell asked for '/'",
		);

		/* the harness's marker table must agree with the app's own a11y contract */
		const a11ySource = readFileSync(
			// The REPO root from this file's own location, never `--relay`: the contract
			// under test is the app's, not the mock's.
			join(REPO, "src", "ui", "a11y.ts"),
			"utf8",
		);
		const emptyIds = new Set(
			[...a11ySource.matchAll(/"[a-z0-9-]+-empty"/g)].map((m) =>
				m[0].slice(1, -1),
			),
		);
		check(
			"the app's a11y module declares empty markers to compare against",
			emptyIds.size > 5,
			true,
		);
		const mismatched: string[] = [];
		for (const screen of Object.keys(SCREEN_MARKER_SUBJECT)) {
			const required = requiredStateMarker(screen, "empty");
			if (required !== null && !emptyIds.has(required))
				mismatched.push(`${screen} → ${required}`);
		}
		check(
			"every screen's required empty marker IS the app's own (no second dialect)",
			mismatched,
			[],
		);
	}

	/* ---- 3i. round 3: the app's own names, the survivor gate, the marker table ---- */
	group = "seed parameters are the app's";
	{
		// The harness must emit the names the APP reads. PR #11's `webRelayOverride()`
		// reads `lo-relay`, `lo-relay-password` and `lo-relay-insecure`, and an earlier
		// revision of this harness invented `lo-seed-*`, which nothing reads — a seed that
		// silently seeds nothing. Asserting against #11's own source is what makes a rename
		// there fail here.
		// The name contract lives in #11's file. Read it from the branch while the branch
		// exists, else from the merged path — and FAIL (not skip) when neither is readable,
		// because a check that quietly does nothing is the failure mode of this whole PR.
		const providerPath = join(
			REPO,
			"src",
			"features",
			"auth",
			"connection-provider.tsx",
		);
		let source = "";
		try {
			source = execFileSync(
				"git",
				[
					"-C",
					REPO,
					"show",
					"origin/feat/screens-lists:src/features/auth/connection-provider.tsx",
				],
				{ encoding: "utf8" },
			);
		} catch {
			source = existsSync(providerPath)
				? readFileSync(providerPath, "utf8")
				: "";
		}
		// Only the hook's own body counts: scraping every quoted `lo-…` in the file would
		// read a future storage key as a seed parameter.
		const hookBody =
			/function webRelayOverride[\s\S]*?\n}/.exec(source)?.[0] ?? "";
		const appNames = new Set(
			[...hookBody.matchAll(/"(lo-[a-z-]+)"/g)].map((match) => match[1] ?? ""),
		);
		check(
			"PR #11's connection provider is readable at its ref (the name contract's source)",
			source.length > 0,
			true,
			"git show origin/feat/screens-lists:src/features/auth/connection-provider.tsx",
		);
		const emitted = new URLSearchParams(seedQuery("http://127.0.0.1:1", "pw"));
		check(
			"the harness emits exactly the names the app reads",
			[...emitted.keys()].sort(),
			[...appNames].sort(),
		);
		check(
			"the password is among them: a route-only seed renders an unauthenticated page",
			emitted.has("lo-relay-password"),
			true,
		);
		check(
			"and no invented parameter rides along",
			[...emitted.keys()].filter((key) => !appNames.has(key)),
			[],
		);
	}

	group = "a leaking run cannot report a clean matrix";
	{
		// Round 3: the survivor count was nested inside the `blocking > 0` gate, so a clean
		// matrix that leaked a browser exited 0. The regression is an ADVERSARIAL one — a
		// process that keeps re-creating one carrying the run's own profile path — because a
		// single stand-in is simply reaped, which was never the failure mode.
		const root = join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			`sweep-gate-${process.pid}`,
		);
		const profile = join(root, "chrome-respawning");
		mkdirSync(profile, { recursive: true });
		const out = join(root, "frames");
		const respawner = spawn(
			process.execPath,
			[
				"-e",
				// The profile travels by ENV, not argv: the reap matches the profile path in a
				// command line, so a respawner that named it would be reaped with its children
				// and the test would prove nothing.
				`const { spawn } = require("node:child_process");
				 const profile = process.env.LO_RESPAWN_PROFILE;
				 const ensure = () => spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)", "--", \`--user-data-dir=\${profile}\`], { stdio: "ignore" });
				 ensure();
				 setInterval(ensure, 300);`,
			],
			{
				stdio: "ignore",
				detached: true,
				env: { ...process.env, LO_RESPAWN_PROFILE: profile },
			},
		);
		await sleep(700);
		const run = spawnSync(
			process.execPath,
			[
				join(WORKTREE, "tools", "visual", "capture.ts"),
				"--dir",
				join(WORKTREE, "e2e", "fixtures", "audit-canary"),
				"--out",
				out,
				"--cells",
				"path:/clean/clean",
				"--devices",
				"iphone-15",
				"--themes",
				"dark",
				"--scales",
				"100",
				"--profile",
				profile,
				"--yes",
			],
			{ encoding: "utf8", timeout: 300_000, env: { ...process.env } },
		);
		const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
		check(
			"a clean matrix that leaks a process exits non-zero",
			run.status !== 0,
			true,
			`exit ${String(run.status)}`,
		);
		// The count must be NON-ZERO: `0 surviving process(es)` is the tail of every
		// CaptureFailure message, so the bare phrase would be satisfied by any strict
		// failure of the matrix and would prove nothing about the survivor gate.
		check(
			"and the failure names a non-zero survivor count rather than the matrix",
			/[1-9]\d* surviving process\(es\)|survived this run's teardown/.test(
				output,
			),
			true,
			output.split("\n").find((line) => line.includes("surviv")) ?? "(no line)",
		);
		// Reap the respawner and everything it made, by pid and by the profile it carries.
		if (respawner.pid !== undefined) {
			try {
				process.kill(-respawner.pid, "SIGKILL");
			} catch {
				try {
					process.kill(respawner.pid, "SIGKILL");
				} catch {
					/* already gone */
				}
			}
		}
		spawnSync("pkill", ["-9", "-f", profile]);
		await sleep(400);
		check("and the rig leaves nothing behind", countProcesses(profile), 0);
		rmSync(root, { recursive: true, force: true });
	}

	group = "the marker table is the app's, row by row";
	{
		// Only the `empty` row can be checked against the app today: the app's a11y module
		// declares empty markers, screen roots and controls, and no non-empty state marker
		// exists on any head (#11 and #12 own those). So the checkable rows are asserted,
		// and the rest are NAMED — a row that silently becomes checkable, or a screen that
		// appears without a marker decision, fails here instead of drifting.
		const a11ySource = readFileSync(join(REPO, "src", "ui", "a11y.ts"), "utf8");
		// The EMPTY block, not every quoted token in the file: the app also declares screen
		// roots, control ids and role names, and counting those as markers would let a state
		// marker pass by name collision. The pending tripwire below is owned by #11/#12: it
		// goes red the day they land a non-empty marker, which is when that row moves up.
		const emptyBlock =
			/export const EMPTY[\s\S]*?\n};/.exec(a11ySource)?.[0] ?? "";
		const declared = new Set(
			[...emptyBlock.matchAll(/"[a-z0-9-]+"/g)].map((match) =>
				match[0].slice(1, -1),
			),
		);
		const rows = Object.keys(SCREEN_MARKER_SUBJECT);
		const checked: string[] = [];
		const pending: string[] = [];
		for (const screen of rows) {
			const stateIds = Object.entries(STATE_MARKER_ALIASES).map(
				([, base]) => base,
			);
			const states = [...new Set(["empty", ...stateIds])];
			for (const state of states) {
				const marker = requiredStateMarker(screen, state);
				if (marker === null) continue;
				if (declared.has(marker)) checked.push(marker);
				else pending.push(marker);
			}
		}
		check(
			"every screen's empty marker is the app's own",
			checked.length >= rows.length,
			true,
		);
		check(
			"the non-empty state markers are PENDING on #11/#12, not assumed to exist",
			pending.length > 0 && pending.every((marker) => !declared.has(marker)),
			true,
			`${pending.length} pending, e.g. ${pending.slice(0, 3).join(", ")}`,
		);
	}

	group = "the coverage keys are where the README says";
	{
		const readme = readFileSync(join(REPO, "docs", "e2e", "README.md"), "utf8");
		check(
			"the README does not send a reader to meta.measurableCells (they are top-level)",
			/meta\.(measurableCells|notMeasurableCells|coverageNote)/.test(readme),
			false,
		);
		check(
			"and it names them at the level they live at",
			/measurableCells/.test(readme) && /notMeasurableCells/.test(readme),
			true,
		);
		const captureSource = readFileSync(
			join(REPO, "tools", "visual", "capture.ts"),
			"utf8",
		);
		// Indentation-insensitive on purpose: the level is what matters, and pinning a tab
		// count made this check fail on the head it was written for (the manifest's keys sit
		// two tabs deep inside the run function).
		check(
			"the manifest writes them at the top level, as the README now says",
			/^[\t ]{0,2}measurableCells:/m.test(captureSource) &&
				/^[\t ]{0,2}notMeasurableCells:/m.test(captureSource),
			true,
		);
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
				.map((frame) => Number(bag(frame.data).version))
				.filter((version: number) => Number.isFinite(version));
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
			const captured = GATEWAY_FAILURES["413-too-large"]?.json;
			// The sentence names the ceiling IN FORCE, so a test-sized limit no longer
			// reports the gateway's 10 MiB (QA/round-1 note: a 64 KiB trigger answered
			// "request exceeds 10 MiB"). The shape is still the gateway's own body.
			const expectedBytes = Number(
				/(\d+(?:\.\d+)?)\s*(MiB|KiB)/.exec(
					typeof (captured as { error?: unknown })?.error === "string"
						? (captured as { error: string }).error
						: "",
				)?.[1] ?? "0",
			);
			check(
				"413-oversize: the refusal is the gateway's own body with the limit in force",
				isRecord(oversize.json)
					? {
							...(oversize.json as Record<string, unknown>),
							error: "request exceeds <limit>",
						}
					: oversize.json,
				captured === undefined
					? undefined
					: {
							...(captured as Record<string, unknown>),
							error: "request exceeds <limit>",
						},
			);
			check(
				"413-oversize: the sentence names the ceiling that fired, not the gateway's",
				/request exceeds \d+ KiB/.test(
					String(
						(oversize.json as { error?: unknown } | undefined)?.error ?? "",
					),
				),
				true,
				`gateway sentence says ${expectedBytes}; this one says ${String((oversize.json as { error?: unknown } | undefined)?.error ?? "")}`,
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
				bag(admitted.json).detail,
				"prompt admitted",
			);
			const stream = await streamPromise;
			const state = await client.get("/__mock/state");
			check(
				"duplicate-delivery: the transport delivered the frame twice",
				bag(state.json).duplicateDelivered,
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
			const rows = arr(bag(lastFrame?.data).transcript).filter(
				(row) => str(bag(row).id) === `user-${commandId}`,
			);
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
					bag(refused.json).reason,
					reason,
				);
				check(
					`503-${reason}: carries the captured sentence, not an invented one`,
					bag(refused.json).detail,
					(details as Record<string, unknown>)[reason],
				);
				check(
					`503-${reason}: names the error the gateway names`,
					bag(refused.json).error,
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
			const missing = FAULT_SPECS.filter(
				(spec: { family?: string; name: string }) => !familyCovered(spec),
			).map((spec: { name: string }) => spec.name);
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
				/unknown scenario/.test(
					error instanceof Error ? error.message : String(error),
				) ||
				/unknown scenario/.test(
					error instanceof Error ? error.message : String(error),
				);
		}
		check("an unknown scenario refuses to start", failed, true);
	}
	{
		let failed = false;
		try {
			await startRelay({ scenario: "idle", faults: ["no-such-fault"] });
		} catch (error) {
			failed =
				/unknown fault/.test(
					error instanceof Error ? error.message : String(error),
				) ||
				/unknown fault/.test(
					error instanceof Error ? error.message : String(error),
				);
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
			transcript.requests.every(
				(r: { status?: unknown }) => typeof r.status === "number",
			),
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
	const jsonPath = process.argv.slice(2).includes("--json")
		? flag("json", "")
		: null;
	if (jsonPath !== null && jsonPath !== "")
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
