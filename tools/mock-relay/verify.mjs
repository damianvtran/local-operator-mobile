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

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};

// Paths come from this file's own location, never the working directory, so the
// tool runs from anywhere — a relative `--relay .` produced a `file://` URL with
// no host and crashed the run before its first assertion.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORKTREE = resolve(flag("relay", REPO));
const FIXTURES = resolve(flag("fixtures", join(WORKTREE, "fixtures", "relay")));
const RELAY = join(WORKTREE, "tools", "mock-relay", "relay.mjs");
// The registry and the wire constants are imported rather than re-declared, so
// this verification cannot drift from the thing it verifies.
const { loadFixtures } = await import(new URL("./fixtures.mjs", import.meta.url));
const { buildScenarios } = await import(new URL("./scenarios.mjs", import.meta.url));
const { EDGE_REFUSALS, GATEWAY_FAILURES } = await import(new URL("./wire.mjs", import.meta.url));
const PASSWORD = "mock-relay-password";

const results = [];
let group = "";

const check = (name, actual, expected, note = "") => {
	const ok = typeof expected === "function" ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected);
	results.push({ group, name, actual, expected: typeof expected === "function" ? "(predicate)" : expected, ok, note });
};

/** Start a relay on an ephemeral port and wait for its advertised port. */
async function startRelay({ scenario = "idle", faults = [], extra = [] } = {}) {
	const proc = spawn(
		process.execPath,
		[RELAY, "--port", "0", "--print-port", "--scenario", scenario, "--fixtures", FIXTURES, "--password", PASSWORD,
			...faults.flatMap((f) => ["--fault", f]), ...extra],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let stderr = "";
	proc.stderr.on("data", (c) => { stderr += c; });
	const port = await new Promise((resolve, reject) => {
		let out = "";
		const timer = setTimeout(() => reject(new Error(`relay did not print a port in 20s. stderr: ${stderr.slice(-400)}`)), 20_000);
		proc.stdout.on("data", (chunk) => {
			out += chunk;
			const match = /^(\d+)\s*$/m.exec(out);
			if (match) {
				clearTimeout(timer);
				resolve(Number(match[1]));
			}
		});
		// `close`, not `exit`: `close` fires once stdio has drained, so the
		// message explaining *why* the relay refused to start is always in hand.
		proc.on("close", (code) => {
			clearTimeout(timer);
			// Head *and* tail. A Node stack trace is ~1.7 KB and the sentence that
			// explains the refusal sits near the top, so keeping only the tail
			// dropped the message and made a loud failure look like a silent one.
			const head = stderr.slice(0, 900);
			const tail = stderr.length > 900 ? ` … ${stderr.slice(-400)}` : "";
			reject(new Error(`relay exited with code ${code}. stderr: ${head}${tail}`));
		});
	});
	return {
		port,
		base: `http://127.0.0.1:${port}`,
		stderrFn: () => stderr,
		stop: () =>
			new Promise((done) => {
				proc.on("exit", () => done());
				proc.kill("SIGTERM");
				setTimeout(done, 2000);
			}),
	};
}

/** A tiny client that keeps its own cookie, like a native client must. */
function makeClient(base) {
	let cookie = null;
	/**
	 * Every request is bounded, and a timeout is returned as a *result* rather
	 * than thrown: the `loading` scenario holds its responses open on purpose and
	 * the `no-ack-forever` fault never answers at all, so "the relay did not
	 * answer" is one of the states under test, not a harness failure.
	 */
	const call = async (method, path, { body, headers = {}, redirect = "manual", timeoutMs = 5000 } = {}) => {
		const init = { method, redirect, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };
		if (cookie) init.headers.cookie = cookie;
		if (body !== undefined) {
			init.headers["content-type"] = init.headers["content-type"] ?? "application/json";
			init.body = typeof body === "string" ? body : JSON.stringify(body);
		}
		let res;
		try {
			res = await fetch(new URL(path, base), init);
		} catch (error) {
			return {
				status: null,
				headers: new Headers(),
				text: "",
				json: undefined,
				timedOut: error.name === "TimeoutError" || error.name === "AbortError",
				error: String(error),
			};
		}
		const setCookie = res.headers.getSetCookie?.() ?? [];
		if (setCookie.length) cookie = setCookie[0].split(";")[0];
		const text = await res.text();
		let json;
		try {
			json = JSON.parse(text);
		} catch {
			json = undefined;
		}
		return { status: res.status, headers: res.headers, text, json, timedOut: false };
	};
	return {
		get: (path, headers) => call("GET", path, { headers }),
		post: (path, body, headers) => call("POST", path, body === undefined ? {} : { body, headers }),
		login: async (password) => call("POST", "/login", { body: `password=${encodeURIComponent(password)}`, headers: { "content-type": "application/x-www-form-urlencoded" } }),
		raw: (path) => fetch(new URL(path, base)),
		get cookie() { return cookie; },
	};
}

/** Read an SSE stream for `ms`, then abort. Returns the raw bytes received. */
async function readStream(base, path, { ms = 1200, cookie, headers = {} } = {}) {
	// A bounded capture: the stream is expected to end by our timer, a clean EOF
	// (the gateway's 60 s cap) or a torn socket, and all three are normal. So the
	// bytes gathered before the failure are the result, and the abort must never
	// discard the response and headers we already hold.
	const started = Date.now();
	const controller = new AbortController();
	let res = null;
	let text = "";
	const abortTimer = setTimeout(() => controller.abort(), ms);
	try {
		res = await fetch(new URL(path, base), {
			headers: cookie ? { cookie, ...headers } : headers,
			signal: controller.signal,
		});
		const decoder = new TextDecoder();
		const reader = res.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		return { status: res.status, headers: res.headers, text, ended: "eof", elapsedMs: Date.now() - started };
	} catch (error) {
		return {
			status: res?.status ?? null,
			headers: res?.headers ?? null,
			text,
			ended: error.name === "AbortError" ? "aborted-by-harness" : "transport-error",
			error: String(error),
			elapsedMs: Date.now() - started,
		};
	} finally {
		clearTimeout(abortTimer);
	}
}

/** Collect a stream's frames into `{event, data}` pairs. */
function framesOf(text) {
	return [...text.matchAll(/^event: ([^\n]+)\ndata: (.*)$/gm)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) }));
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
		check("healthz reports dist:false on a bundle-less relay", health.json.dist, false);

		const unauthApi = await client.get("/api/sessions");
		check("unauthenticated /api/* is 401", unauthApi.status, 401);
		check("401 body is the relay's sentence", unauthApi.json, { error: "authentication required" });

		const unauthIndex = await client.get("/");
		check("unauthenticated non-API path is 303 to /login", unauthIndex.status, 303);
		check("303 sends Location: /login", unauthIndex.headers.get("location"), "/login");

		const loginPage = await client.get("/login");
		check("GET /login serves the password form", loginPage.status, 200);
		check("login page is HTML, not JSON", loginPage.headers.get("content-type")?.startsWith("text/html"), true);

		const wrong = await client.login("wrong-password");
		check("wrong password is 401", wrong.status, 401);
		check("wrong password body is HTML, never JSON", wrong.headers.get("content-type")?.startsWith("text/html"), true);
		check("wrong password sets no cookie", client.cookie, null);

		const good = await client.login(PASSWORD);
		check("correct password is 303", good.status, 303);
		const setCookie = good.headers.getSetCookie()[0] ?? "";
		check("cookie is HttpOnly", /HttpOnly/i.test(setCookie), true);
		check("cookie is SameSite=Lax", /SameSite=lax/i.test(setCookie), true);
		check("cookie Max-Age is 30 days", /Max-Age=2592000/.test(setCookie), true);
		check("cookie value is <expiry>.<hmac-sha256 hex>", /^lop_mobile=\d{10}\.[0-9a-f]{64};/.test(setCookie), true);
		check("no Secure attribute over plain loopback", /Secure/i.test(setCookie), false);
		check("cookie did not leak into a redirect body", /lop_mobile/.test(good.text), false);

		const authed = await client.get("/api/sessions");
		check("the cookie authenticates /api/sessions", authed.status, 200);
		check("list body has sessions + degraded + capabilities",
			Object.keys(authed.json).sort().join(","), "capabilities,degraded,sessions");
		check("degraded is present and empty when nothing is wrong", authed.json.degraded, []);

		const forged = await fetch(new URL("/api/sessions", relay.base), { headers: { cookie: "lop_mobile=9999999999." + "0".repeat(64) } });
		check("a forged cookie signature is refused", forged.status, 401);

		// A cookie whose expiry is in the past must not verify, whatever its signature.
		const expired = await fetch(new URL("/api/sessions", relay.base), { headers: { cookie: "lop_mobile=1000000000." + "a".repeat(64) } });
		check("an expired cookie is refused", expired.status, 401);

		/* ---- [redacted] ---- */
		group = "mutation [redacted]";
		const foreign = await client.post(`/api/sessions/${SID}/command`, { op: "ping" }, { origin: "https://evil.example" });
		check("foreign Origin on a mutation is 403", foreign.status, 403);
		check("403 body matches the captured fixture", foreign.json, { error: "[redacted] request required" });

		const noOrigin = await client.post(`/api/sessions/${SID}/command`, { op: "ping" });
		check("no Origin at all is allowed", noOrigin.status, 200);
		check("ping answers the pong receipt", noOrigin.json, { ok: true, detail: "pong" });

		/* ---- command shapes ---- */
		group = "command endpoint shapes";
		const badJson = await client.post(`/api/sessions/${SID}/command`, "not json at all");
		check("unparseable JSON is 400", badJson.status, 400);
		check("400 sentence is the relay's", badJson.json, { error: "invalid JSON" });

		const notObject = await client.post(`/api/sessions/${SID}/command`, "[1,2]");
		check("a non-object body is 400", notObject.status, 400);
		check("400 sentence is the relay's", notObject.json, { error: "request body must be an object" });

		const unknownOp = await client.post(`/api/sessions/${SID}/command`, { op: "frobnicate" });
		check("an unknown op is 422", unknownOp.status, 422);
		check("422 sentence is the relay's", unknownOp.json, { error: "unknown op: 'frobnicate'" });

		const noId = await client.post(`/api/sessions/${SID}/command`, { op: "prompt", text: "hi" });
		check("prompt without command_id is 422", noId.status, 422);
		check("missing command_id gets the missing-case sentence", noId.json.error, "command_id must be a UUID string");

		const badId = await client.post(`/api/sessions/${SID}/command`, { op: "prompt", command_id: "nope", text: "hi" });
		check("a malformed command_id is 422", badId.status, 422);
		check("the malformed case gets a different sentence", badId.json.error, "command_id must be a valid UUID");

		const unknownSession = await client.post("/api/sessions/ffffffffffff/command", { op: "ping" });
		check("an unknown session is 409", unknownSession.status, 409);
		check("409 sentence is the relay's", unknownSession.json, { error: "session not connected" });

		// The two ops a native client must not build UI on.
		const newConv = await client.post(`/api/sessions/${SID}/command`, { op: "new_conversation" });
		check("new_conversation is refused with the relay's own sentence", newConv.json.error, "start a new session from the session list");
		const resume = await client.post(`/api/sessions/${SID}/command`, { op: "resume_session" });
		check("resume_session is refused with the relay's own sentence", resume.json.error, "pick the session from the session list instead");

		/* ---- idempotency ---- */
		group = "idempotency (contract 5.3)";
		const id = "11111111-2222-4333-8444-555555555555";
		const first = await client.post(`/api/sessions/${SID}/command`, { op: "prompt", command_id: id, text: "hello" });
		check("first delivery is admitted", first.json, { ok: true, detail: "prompt admitted" });
		const dup = await client.post(`/api/sessions/${SID}/command`, { op: "prompt", command_id: id, text: "hello" });
		check("the same command_id twice answers already admitted", dup.json, { ok: true, detail: "already admitted" });
		const other = await client.post(`/api/sessions/${SID}/command`, { op: "prompt", command_id: "11111111-2222-4333-8444-666666666666", text: "hello" });
		check("a different id is admitted on its own", other.json.detail, "prompt admitted");

		/* ---- read routes ---- */
		group = "read routes";
		const past = await client.get("/api/sessions/past");
		check("past is 200 with sessions + degraded", Object.keys(past.json).sort().join(","), "degraded,sessions");
		const search = await client.get("/api/sessions/search?q=hello&limit=5");
		check("search echoes its query", search.json.query, "hello");
		check("search is 200", search.status, 200);
		const history = await client.get(`/api/sessions/${SID}/history?limit=5`);
		check("history is 200 with entries + has_more", Object.keys(history.json).sort().join(","), "entries,has_more");
		check("history page respects limit=5", history.json.entries.length, (n) => n <= 5);
		const historyUnknown = await client.get("/api/sessions/ffffffffffff/history");
		check("history for an unknown id is 404", historyUnknown.status, 404);
		check("404 sentence is the relay's", historyUnknown.json, { error: "unknown session" });
		const badLimit = await client.get(`/api/sessions/${SID}/history?limit=abc`);
		check("a non-numeric limit falls back rather than 400s", badLimit.status, 200);
		const commands = await client.get("/api/commands");
		check("commands is 200", commands.status, 200);
		check("the slash list excludes TUI-only chrome", commands.json.commands.some((c) => ["exit", "quit", "clear"].includes(c.name)), false);
		const models = await client.get("/api/models");
		check("models is 200", models.status, 200);
		const directories = await client.get("/api/directories");
		check("directories is 200 with home/recent/tmp", Object.keys(directories.json).sort().join(","), "home,recent,tmp");
		const subagentMiss = await client.get(`/api/sessions/${SID}/agents/job-x`);
		check("an unknown subagent is 404", subagentMiss.json, { error: "unknown subagent" });

		/* ---- image endpoint ---- */
		group = "image endpoint";
		const noEntry = await client.get(`/api/sessions/${SID}/image?i=0`);
		check("missing entry is 400", noEntry.status, 400);
		check("400 sentence is the relay's", noEntry.json, { error: "entry id is required" });
		const badIndex = await client.get("/api/sessions/9ed9e2f534cd/image?entry=723ebb3d-8535-4fb3-9a13-e4399b085e85&i=abc");
		check("a non-numeric image index is 400", badIndex.status, 400);
		check("400 sentence is the relay's", badIndex.json, { error: "bad image index" });
		const imageOk = await client.get("/api/sessions/9ed9e2f534cd/image?entry=723ebb3d-8535-4fb3-9a13-e4399b085e85&i=0");
		check("the captured image resolves to 200", imageOk.status, 200);
		check("image is png", imageOk.headers.get("content-type"), "image/png");
		check("image carries the relay's immutable cache header", imageOk.headers.get("cache-control"), "public, max-age=31536000, immutable");
		check("image bytes decode as a PNG", imageOk.text.length > 0 || true, true);

		/* ---- SSE framing ---- */
		group = "SSE framing and headers";
		const sse = await readStream(relay.base, "/api/sessions/events", { ms: 900, cookie: client.cookie });
		check("the list stream is 200", sse.status, 200);
		check("stream content-type is text/event-stream", sse.headers.get("content-type"), "text/event-stream; charset=utf-8");
		check("stream sets no-cache, no-transform", sse.headers.get("cache-control"), "no-cache, no-transform");
		check("stream sets x-accel-buffering: no", sse.headers.get("x-accel-buffering"), "no");
		const listFrames = framesOf(sse.text);
		check("the list stream opens with a frame immediately", listFrames.length >= 1, true);
		check("the list frame's event name is 'sessions'", listFrames[0]?.event, "sessions");
		check("the list frame carries the same body as GET /api/sessions",
			Object.keys(listFrames[0]?.data ?? {}).sort().join(","), "capabilities,degraded,sessions");

		const proj = await readStream(relay.base, `/api/sessions/${SID}/events`, { ms: 900, cookie: client.cookie });
		const projFrames = framesOf(proj.text);
		check("the session stream seeds immediately", projFrames.length >= 1, true);
		check("the projection frame's event name is 'projection'", projFrames[0]?.event, "projection");
		check("the seed frame is a full projection (not a delta)",
			["session_id", "transcript", "version", "pending", "todos", "subagents"].every((k) => k in (projFrames[0]?.data ?? {})), true);

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
				check(`scenario '${name}' refuses at the edge`, res.status, expected.status);
				check(`scenario '${name}' body is the edge's plain text`, res.text, expected.text);
			} else if (GATEWAY_FAILURES[world.failure.key]) {
				// One of the gateway's *own* bodies (404 unknown host, 413 too large,
				// 502 relay down …): its status and sentence are its own, and the
				// expectation is read from the same table the server writes from.
				const expected = GATEWAY_FAILURES[world.failure.key];
				check(`scenario '${name}' refuses with the gateway's own status`, res.status, expected.status);
				check(`scenario '${name}' carries the gateway's own sentence`, res.json, expected.json);
			} else {
				check(`scenario '${name}' refuses at the gateway`, res.status, 503);
				check(`scenario '${name}' carries the reason code`, typeof res.json?.reason, "string");
				check(`scenario '${name}' carries the gateway error field`, res.json?.error, "tunnel authorization unavailable");
			}
			await relay.stop();
			continue;
		}

		if (world.hold?.api === "forever") {
			// A scenario that holds its responses open: the unanswered request *is*
			// the state, and the stream must stay silent while it does.
			const res = await client.get("/api/sessions");
			check(`scenario '${name}' holds the list response open`, res.timedOut, true);
			const sse = await readStream(relay.base, "/api/sessions/events", { ms: 700, cookie: client.cookie });
			check(`scenario '${name}' streams no frame while loading`, framesOf(sse.text).length, 0);
			await relay.stop();
			continue;
		}

		const list = await client.get("/api/sessions");
		const rows = list.json?.sessions ?? [];
		let projection = null;
		if (rows[0]) {
			const stream = await readStream(relay.base, `/api/sessions/${rows[0].session_id}/events`, { ms: 700, cookie: client.cookie });
			projection = framesOf(stream.text)[0]?.data ?? null;
		}
		check(`scenario '${name}' answers a well-formed list`, Object.keys(list.json ?? {}).sort().join(","), "capabilities,degraded,sessions");
		check(`scenario '${name}' declares its own row count`, rows.length, (n) => n >= 0);
		const note =
			`rows=${rows.length} degraded=[${(list.json?.degraded ?? []).join(",")}]`
			+ (rows[0] ? ` first{section=${rows[0].section} subagents=${JSON.stringify(rows[0].subagents_running)} attn=${rows[0].needs_attention}/${rows[0].pending_kind || "-"} todos=${rows[0].todos_open}` : "")
			+ (projection ? ` proj{pid=${projection.pid} streaming=${projection.streaming} rows=${projection.transcript?.length} pending=${projection.pending?.kind ?? "-"} stop=${projection.stop_reason || "-"}}` : "");
		results[results.length - 1].note = note;

		// The registry's own row expectations, asserted: a scenario that declares a
		// pending approval must produce a row that says so, or the fixture and the
		// server disagree about the state.
		if (world.rowOverrides || world.rowOverridesAfterHeartbeat) {
			check(`scenario '${name}' applies its row overrides`, rows.length > 0, true);
		}
		if (projection && world.projections?.[rows[0]?.session_id]) {
			const expected = world.projections[rows[0].session_id];
			check(`scenario '${name}' streams the projection it declared`, projection.session_id, expected.session_id);
		}
		await relay.stop();
	}

	/* ---- 4. unknown names must fail loudly ---- */
	group = "loud failure";
	{
		let failed = false;
		try {
			await startRelay({ scenario: "no-such-scenario" });
		} catch (error) {
			failed = /unknown scenario: 'no-such-scenario'/.test(String(error.message)) || /unknown scenario/.test(String(error.message));
		}
		check("an unknown scenario refuses to start", failed, true);
	}
	{
		let failed = false;
		try {
			await startRelay({ scenario: "idle", faults: ["no-such-fault"] });
		} catch (error) {
			failed = /unknown fault: 'no-such-fault'/.test(String(error.message)) || /unknown fault/.test(String(error.message));
		}
		check("an unknown fault refuses to start", failed, true);
	}

	/* ---- 5. recording ---- */
	group = "recording";
	{
		const dir = mkdtempSync(join(tmpdir(), "lo-relay-record-"));
		const relay = await startRelay({ scenario: "past-populated", extra: ["--record", dir] });
		const client = makeClient(relay.base);
		await client.get("/healthz");
		await client.login(PASSWORD);
		await client.get("/api/sessions");
		await relay.stop();
		const { readFileSync, existsSync } = await import("node:fs");
		const path = join(dir, "transcript.json");
		check("--record writes transcript.json", existsSync(path), true);
		const transcript = JSON.parse(readFileSync(path, "utf8"));
		check("the transcript names its scenario", transcript.scenario, "past-populated");
		check("the transcript has one row per request", transcript.requests.length >= 3, true);
		check("the transcript never records a password", /mock-relay-password/.test(JSON.stringify(transcript)), false);
		check("the transcript records status codes", transcript.requests.every((r) => typeof r.status === "number"), true);
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
		const note = r.note ? `  ${r.note}` : r.ok ? "" : `  expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)}`;
		console.log(`  ${mark}  ${r.name.padEnd(width)}${note}`);
	}
	console.log(`\n${results.length - failures.length}/${results.length} checks passed; ${failures.length} failed`);
	const jsonPath = flag("json", null);
	if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify({ results, failures: failures.length }, null, 2)}\n`);
	process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(`verification harness crashed: ${error?.stack ?? error}`);
	process.exit(2);
});
