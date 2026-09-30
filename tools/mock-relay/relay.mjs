/**
 * The deterministic mock relay.
 *
 * Implements the relay's documented routes (`docs/relay/contract.md`) and the
 * tunnel edge/gateway refusals (`docs/relay/tunnel-edge.md`) with:
 *
 *   --scenario <name>   pin any state without a real agent (see scenarios.mjs)
 *   --fault <name>      inject a real adversity deterministically (faults.mjs)
 *   --record <dir>      write every request+response for assertions
 *
 * Three properties it is built to keep, because a harness without them is worse
 * than no harness:
 *
 * 1. **It answers what the real relay answers.** Bodies come from the captured
 *    corpus, not from shapes re-typed here; the auth gate, the cookie format and
 *    the SSE framing are the relay's own (wire.mjs). So the *client's* header,
 *    cookie and error paths are exercised rather than bypassed.
 * 2. **A typo fails loudly.** An unknown scenario or fault is an error, never a
 *    silent fallback to a default state — otherwise a harness run "passes"
 *    having tested nothing.
 * 3. **Nothing is random.** The same scenario and fault list produce the same
 *    bytes in the same order. Timing that must vary is a parameter
 *    (`--fault sse-cut-after=8`).
 *
 * Loopback only, like the relay it stands in for (`service.py:88-96`). It never
 * touches the operator's daemon: it binds its own port and its password is its
 * own, so a `lop mobile` on 4098 keeps running untouched.
 */

import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bool, list, num, parseArgs, str } from "../lib/args.mjs";
import { loadFixtures, defaultFixturesDir } from "./fixtures.mjs";
import { buildScenarios, rowFrom, scenarioNames } from "./scenarios.mjs";
import { parseFaults, FAULT_NAMES, summariseFaults } from "./faults.mjs";
import {
	EDGE_REFUSALS,
	GATEWAY_FAILURES,
	MAX_BODY_BYTES,
	SSE_HEADERS,
	SSE_KEEPALIVE,
	SSE_KEEPALIVE_S,
	authVerdict,
	errorBody,
	gatewayUnavailable,
	issueCookie,
	originVerdict,
	readCookie,
	setCookieHeader,
	sseFrame,
	verifyCookie,
	COOKIE_NAME,
} from "./wire.mjs";

export const DEFAULT_PASSWORD = "mock-relay-password";

/** A real 1×1 PNG, so `<Image>` has something decodable to render for `/image`. */
const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a mock relay without listening. `start()` returns the handle, so a test
 * can drive it in-process as well as over a socket.
 */
export function createRelay(options = {}) {
	const fixturesDir = options.fixturesDir ?? defaultFixturesDir;
	const fix = loadFixtures(fixturesDir);

	/**
	 * Session ids the corpus captured a *live generation* for. The image endpoint
	 * requires one (`contract.md` §3.6) and it is independent of what a client is
	 * subscribed to, so this cannot be read off `world.projections`: a scenario
	 * may legitimately hold no projection for a session whose runtime is live.
	 * The image captures are the corpus's own statement of which ids those are.
	 */
	const capturedImage = (() => {
		const fixture = fix.http.get("image-ok");
		const match = /^\/api\/sessions\/([0-9a-f]{12})\/image\?entry=([^&]+)&i=(\d+)$/.exec(fixture?.request?.path ?? "");
		return match ? { sessionId: match[1], entry: match[2], index: Number(match[3]), fixture } : null;
	})();
	const scenarios = buildScenarios(fix);
	const password = options.password ?? DEFAULT_PASSWORD;
	const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
	const record = options.record ?? false;

	// A scenario or fault the registry does not know is a hard error: silently
	// substituting a default would make every downstream assertion meaningless.
	if (options.scenario && !scenarios[options.scenario]) {
		throw new Error(
			`unknown scenario: '${options.scenario}'.\nKnown scenarios:\n  ` 
			+ scenarioNames(scenarios).join("\n  "),
		);
	}

	const state = {
		scenario: options.scenario ?? "idle",
		world: {},
		faults: parseFaults(options.faults ?? []),
		startedAt: Date.now(),
		seq: 0,
		requests: [],
		/** Command ids that have been admitted: what `already admitted` is about. */
		admitted: new Map(),
		seenTokens: new Set(),
		pins: new Map(),
		submittedAt: null,
		duplicateSuppressed: 0,
		scenarioStartedAt: Date.now(),
		servers: [],
	};
	const resetWorld = () => {
		state.world = scenarios[state.scenario].world();
		state.scenarioStartedAt = Date.now();
		// Per-scenario ledgers reset with the scenario, so a duplicate-detection
		// test cannot inherit an id admitted by the previous scenario.
		state.admitted = new Map();
		state.seenTokens = new Set();
		state.pins = new Map();
		state.duplicateSuppressed = 0;
	};
	resetWorld();

	// Diagnostics go to stderr, never stdout: stdout is reserved for
	// machine-readable output (`--print-port`), and a run that mixes the two
	// reads a log line as a port number.
	const log = options.quiet ? () => {} : (...args) => console.error(...args);

	/* --------------------------------------------------------------- helpers -- */

	const nowIso = () => new Date().toISOString();

	const sendJson = (res, status, body, headers = {}) => {
		const payload = JSON.stringify(body);
		// The relay gzips per-route when the client asks and the body is ≥ 1024
		// bytes — never as middleware, because middleware would buffer the SSE
		// stream. Reproducing it here means a client that forgets to decode is
		// caught locally instead of on a phone.
		const wantsGzip = /gzip/.test(String(res.req?.headers["accept-encoding"] ?? ""));
		const useGzip = wantsGzip && Buffer.byteLength(payload) >= 1024;
		const out = useGzip ? gzipSync(payload) : Buffer.from(payload);
		const finalHeaders = {
			"content-type": "application/json",
			...(useGzip ? { "content-encoding": "gzip" } : {}),
			...headers,
		};
		res.writeHead(status, { ...finalHeaders, "content-length": out.length });
		res.end(out);
	};

	const sendText = (res, status, text, headers = {}) => {
		const out = Buffer.from(text, "utf8");
		res.writeHead(status, {
			"content-type": "text/plain; charset=utf-8",
			...headers,
			"content-length": out.length,
		});
		res.end(out);
	};

	/** Send a fixture's recorded response verbatim (status, headers, body). */
	const sendFixture = (res, name, overrides = {}) => {
		const response = { ...fix.response(name), ...overrides };
		const headers = { ...response.headers, ...(overrides.headers ?? {}) };
		if (response.json !== undefined) return sendJson(res, response.status, response.json, headers);
		if (typeof response.text === "string" && headers["content-type"]?.includes("html")) {
			const out = Buffer.from(response.text, "utf8");
			res.writeHead(response.status, { ...headers, "content-length": out.length });
			return res.end(out);
		}
		return sendText(res, response.status, response.text ?? "", headers);
	};

	/** The session rows for the listing, in the relay's own rank order. */
	const rowsFor = () => {
		const world = state.world;
		const overrides = world.rowOverrides ?? {};
		const rows = Object.values(world.projections ?? {}).map((projection) =>
			rowFrom(projection, overrides),
		);
		// The heartbeat flip is a *time* signal, not a flag: before
		// HEARTBEAT_TIMEOUT_S the registration is vouched for, after it the
		// counts go null while the section stays active. Reproducing the
		// transition (not just its end state) is what lets a client's two-sample
		// comparison be tested at all.
		if (world.rowOverridesAfterHeartbeat) {
			const elapsed = (Date.now() - state.scenarioStartedAt) / 1000;
			if (elapsed >= (world.heartbeatTimeoutS ?? 45)) {
				for (const row of rows) Object.assign(row, world.rowOverridesAfterHeartbeat);
			}
		}
		const rank = (row) => (row.pinned ? 0 : row.section === "active" ? 1 : 2);
		return rows.sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
	};

	const listBody = () => {
		const world = state.world;
		return {
			sessions: rowsFor(),
			degraded: world.listOverrides?.degraded ?? [],
			capabilities: structuredClone(fix.body("sessions-empty").capabilities),
		};
	};

	/** Find a projection by session id, or by the captured id for `{id}`-less routes. */
	const projectionFor = (id) => state.world.projections?.[id];

	/* -------------------------------------------------------------- recording -- */

	/** Never record a credential: the login form's password and the cookie value. */
	const redactBody = (raw) =>
		typeof raw === "string" ? raw.replace(/(^|&)password=[^&]*/gi, "$1password=<redacted>") : raw;

	const recordRequest = (entry) => {
		state.seq += 1;
		const row = { seq: state.seq, at: nowIso(), ...entry };
		state.requests.push(row);
		return row;
	};

	/* ------------------------------------------------------------------- SSE -- */

	/**
	 * Open a stream, send frames, and honour the fault layer.
	 * `frames()` yields `{event, data}` synchronously or as a promise of one.
	 */
	const openStream = async (req, res, { kind, frames, seed, onTick }) => {
		res.writeHead(200, SSE_HEADERS);
		res.flushHeaders?.();
		const faults = state.faults.sse;
		let closed = false;
		let tick = 0;
		let lastWrite = Date.now();
		const timers = [];
		const write = (chunk) => {
			if (closed || res.writableEnded) return;
			if (faults.splitChunks) {
				// A frame split across TCP chunks is what an SSE framer must
				// survive; writing half of `data:` then the rest is the real shape.
				const mid = Math.max(1, Math.floor(chunk.length / 2));
				res.write(chunk.slice(0, mid));
				const t = setTimeout(() => {
					if (!closed) res.write(chunk.slice(mid));
				}, faults.chunkGapMs);
				timers.push(t);
			} else res.write(chunk);
			lastWrite = Date.now();
		};
		const cleanup = () => {
			closed = true;
			for (const t of timers) clearTimeout(t);
			clearInterval(keepalive);
			clearInterval(pump);
			if (cutTimer) clearTimeout(cutTimer);
			if (expireTimer) clearTimeout(expireTimer);
		};
		res.on("close", cleanup);

		// The seed frame: a reconnecting client renders without waiting for a
		// change, which is why a snapshot protocol can afford reconnect-on-EOF.
		if (seed && !faults.noSeed) write(sseFrame(seed.event, seed.data));

		// Two faults need a *second* write to exist at all, and a scenario with no
		// stream mode would otherwise never reach the code that produces one. They
		// are scheduled here, off the seed, so they fire in every scenario.
		if (seed && faults.dropMidFrame) {
			// A torn frame: half of one frame, then the socket dies. The client's
			// framer holds an incomplete event with no blank-line terminator — the
			// case that must not render as a permanently stuck row.
			const torn = sseFrame(seed.event, seed.data);
			const half = Math.max(1, Math.floor(torn.length / 2));
			const t = setTimeout(() => {
				if (closed) return;
				res.write(torn.slice(0, half));
				const t2 = setTimeout(() => {
					if (!closed) res.destroy();
				}, Math.max(5, faults.chunkGapMs));
				timers.push(t2);
			}, 250);
			timers.push(t);
		}

		if (seed && faults.staleVersion) {
			// An older `version` arriving after a newer one: `contract.md` §6.5 says a
			// client drops `incoming.version < current.version`, and that the seed
			// after a reconnect is authoritative regardless. Both halves need this
			// frame to be tested at all.
			const t = setTimeout(() => {
				if (closed) return;
				const older = structuredClone(seed.data);
				older.version = Math.max(1, Number(seed.data.version ?? 1) - 5);
				write(sseFrame(seed.event, older));
			}, 600);
			timers.push(t);
		}

		// Keep-alive is an SSE *comment*, sent after 25 s of quiet, with no event
		// name. `silentAfterSeed` removes it: a stream that stalls without
		// keep-alives is the case a client must detect by itself.
		const keepalive = setInterval(() => {
			if (closed) return;
			if (faults.silentAfterSeed) return;
			if (Date.now() - lastWrite >= SSE_KEEPALIVE_S * 1000) write(SSE_KEEPALIVE);
		}, 1000);

		const intervalMs = state.world.stream?.intervalMs ?? 700;
		const pump = setInterval(() => {
			if (closed) return;
			const next = frames(tick);
			tick += 1;
			if (!next) return;
			if (next === "end") {
				// A clean end-of-body, no error frame and no status change: this is
				// exactly how the gateway's 60 s cap ends a stream, and an early EOF
				// carries no information about why it ended.
				cleanup();
				res.end();
				return;
			}
			write(sseFrame(next.event, next.data));
		}, intervalMs);
		timers.push(pump);

		// A 401 mid-stream: the edge's session grant expired. The stream ends and
		// the *next* request is refused with the re-auth hint header.
		let expireTimer;
		if (faults.expireAfterS !== undefined) {
			expireTimer = setTimeout(() => {
				state.expired = true;
				cleanup();
				res.end();
			}, faults.expireAfterS * 1000);
			timers.push(expireTimer);
		}

		let cutTimer;
		if (faults.cutAfterS !== undefined) {
			// A *clean* end-of-body: no error frame, no sentinel, no status change —
			// exactly how the gateway's `MAX_STREAM_SECONDS` cap ends a stream, which
			// is why an early EOF carries no information about why it ended.
			cutTimer = setTimeout(() => {
				cleanup();
				res.end();
			}, faults.cutAfterS * 1000);
			timers.push(cutTimer);
		}
		if (onTick) onTick({ cleanup, write });
		log(`  stream open  ${kind}`);
	};

	/**
	 * The session stream's frames for one projection: a growing assistant row,
	 * then a settle. Deterministic by tick, so "streaming then settled" is
	 * reproducible rather than flaky.
	 */
	const sessionFrames = (projection) => {
		const stream = state.world.stream ?? { mode: "idle" };
		if (stream.mode !== "streaming") return () => null;
		const settleAfter = stream.settleAfterTurns ?? 6;
		let version = projection.version ?? 1;
		let text = "";
		return (tick) => {
			if (tick > settleAfter) return null;
			version += 1;
			const settled = tick === settleAfter;
			text = settled
				? `${text}\n\nReconciliation finished: 214 files scanned, 3 edits applied.`
				: `${text}${" ".repeat(0)}${tick === 0 ? "" : "\n"}pass ${tick}: scanning shard ${tick}…`;
			const frame = structuredClone(projection);
			frame.version = version;
			frame.streaming = !settled;
			frame.activity = settled ? "" : "responding";
			frame.activity_started_s = settled ? null : tick * 0.7;
			if (settled) {
				frame.stop_reason = stream.settleStopReason ?? "completed";
				frame.cut_off = stream.settleCutOff ?? false;
				frame.attention = {
					...structuredClone(fix.frame("sse-attention-complete")),
					kind: frame.stop_reason === "aborted" ? "interrupted" : "complete",
				};
			}
			frame.transcript = [
				...projection.transcript,
				{
					id: "streaming-assistant-row",
					kind: "assistant",
					text,
					tool_call_id: "",
					tool_name: "",
					tool_state: "interrupted",
					summary: "",
					intent: "Responding",
					diff_added: 0,
					diff_removed: 0,
					elapsed_s: settled ? tick * 0.7 : 0,
					error: "",
					details: {},
					images: [],
					final: settled,
					text_complete: settled,
				},
			];
			// An out-of-order version *after* a newer one is the fencing case:
			// the client must drop `incoming.version < current.version`.
			if (state.faults.sse.staleVersion && tick === settleAfter - 1) frame.version = Math.max(1, version - 5);
			return { event: "projection", data: frame };
		};
	};

	/* --------------------------------------------------------------- routing -- */

	/** Read the whole body, refusing anything above the ceiling. */
	const readBody = (req) =>
		new Promise((resolvePromise, reject) => {
			const chunks = [];
			let size = 0;
			req.on("data", (chunk) => {
				size += chunk.length;
				const bodyCeiling = state.faults.http.oversizeLimit ?? maxBodyBytes;
				if (size > bodyCeiling) {
					// Stop *reading* but never destroy the socket: destroying it here
					// closes the connection before the 413 can be written, and the
					// client then sees a transport error instead of the gateway's own
					// refusal — the one response a 413 check exists to observe.
					// `resume()` drains what the client is still sending so the
					// response can reach it.
					reject(Object.assign(new Error("request body exceeds the ceiling"), { tooLarge: true }));
					req.resume();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});

	const handleCommand = (req, res, sessionId, body) => {
		const world = state.world;
		if (world.commandOverride) return sendFixture(res, world.commandOverride);

		if (body === undefined || typeof body !== "object" || Array.isArray(body) || body === null) {
			return sendFixture(res, "command-body-not-object");
		}
		// Machine-held proof material is dropped rather than refused, so a client
		// learns nothing about its shape — the relay's own rule.
		const op = body.op;
		if (typeof op !== "string" || op === "") return sendFixture(res, "command-invalid-op-missing");

		// Two ops the client may type but the relay refuses: a native app must not
		// build UI on them.
		if (op === "new_conversation") return sendFixture(res, "op-new-conversation");
		if (op === "resume_session") return sendFixture(res, "op-resume-session");

		if (!projectionFor(sessionId)) return sendFixture(res, "command-unknown-session");

		if (op === "prompt" || op === "steer") {
			if (!("command_id" in body)) return sendFixture(res, "command-missing-command-id");
			if (!UUID_RE.test(String(body.command_id))) return sendFixture(res, "command-invalid-uuid");
			const faults = state.faults.command;
			const previous = state.admitted.get(body.command_id);
			if (previous) {
				// A refused command is fully released, so a retry of the same id
				// really does admit it — "already admitted" means durably in the
				// transcript or live in the pending map.
				return sendFixture(res, "command-prompt-duplicate");
			}
			if (faults.noAckForever) {
				// Accepted, never acknowledged: the request simply stays open.
				return;
			}
			if (faults.noAck) {
				state.admitted.set(body.command_id, { op, at: Date.now() });
				return setTimeout(() => {
					sendJson(res, 504, errorBody("session did not answer"));
				}, faults.noAckAfterMs);
			}
			state.admitted.set(body.command_id, { op, at: Date.now() });
			if (faults.duplicateDelivery) {
				// The transport delivers the frame twice; the runtime's ledger folds
				// the second into the first, so the transcript gains ONE row. The
				// observable difference the client can assert is the suppressed
				// delivery, which /__mock/state reports.
				state.duplicateSuppressed += 1;
			}
			return op === "steer" ? sendFixture(res, "command-steer-queued") : sendFixture(res, "command-prompt-ok");
		}

		const byOp = {
			abort: "command-abort",
			cancel: "op-cancel",
			ping: "op-ping",
			snapshot: "op-snapshot",
			slash_result: "op-slash-result-goal",
			slash: "op-slash-help",
			set_effort: "op-set-effort-rung",
			recall_steer: "op-recall-steer-unknown",
		};
		const fixture = byOp[op];
		if (fixture) return sendFixture(res, fixture);
		return sendFixture(res, "command-unknown-op");
	};

	/** Every non-control route, in the relay's own order of checks. */
	const route = async (req, res, pathname, url) => {
		const method = req.method.toUpperCase();
		const world = state.world;
		const mutation = method !== "GET" && method !== "HEAD";

		// 1. The gateway's body ceiling, before anything is routed.
		let rawBody;
		try {
			if (mutation) rawBody = await readBody(req);
		} catch (error) {
			if (error.tooLarge) {
				return sendJson(res, 413, GATEWAY_FAILURES["413-too-large"].json);
			}
			throw error;
		}

		const publicRoute =
			pathname === "/healthz"
			|| pathname === "/login"
			|| pathname === "/logout"
			|| pathname === "/mark.png"
			|| pathname === "/"
			|| pathname.startsWith("/assets/")
			|| pathname === "/robots.txt";

		// 2. An edge 401 mid-session: once the grant expired, nothing else answers.
		if (state.expired && !publicRoute) {
			const refusal = EDGE_REFUSALS["401-login-required"];
			return sendText(res, refusal.status, refusal.text, refusal.headers);
		}

		// 3. The auth gate, with the relay's audience split.
		if (!publicRoute) {
			const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
			const authenticated = verifyCookie(cookie, password);
			const verdict = authVerdict(pathname, { authenticated });
			if (verdict.kind !== "allow") {
				return verdict.json
					? sendJson(res, verdict.status, verdict.json)
					: sendText(res, verdict.status, verdict.body, verdict.headers);
			}
			// 4. Same-origin on mutations: a foreign Origin is refused, an absent
			//    one is allowed (which is how a native client and curl mutate).
			if (mutation) {
				const origin = originVerdict(req, state.allowedOrigins ?? []);
				if (origin.kind !== "allow") return sendJson(res, origin.status, origin.json);
			}
		}

		let body;
		// `/login` is the one route whose body is a form, not JSON (`contract.md`
		// §1.1 rule 2): `password=<password>` url-encoded. Parsing it as JSON here
		// would answer the login form's own POST with `400 invalid JSON`.
		if (mutation && rawBody && pathname !== "/login") {
			try {
				body = JSON.parse(rawBody);
			} catch {
				// An unparseable body on the command route has its own sentence;
				// elsewhere a bad body is a plain 400.
				if (pathname.endsWith("/command")) return sendFixture(res, "command-bad-json");
				return sendJson(res, 400, errorBody("invalid JSON"));
			}
		}

		/* ------------------------------------------------------------- public -- */

		if (pathname === "/healthz") {
			const fixture = fix.body("healthz");
			return sendJson(res, 200, { ...fixture, sessions: Object.keys(world.projections ?? {}).length });
		}

		if (pathname === "/login") {
			if (method === "GET") {
				const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
				if (verifyCookie(cookie, password)) {
					res.writeHead(303, { location: "/" });
					return res.end();
				}
				// The real server-rendered page, captured in the corpus: same form,
				// same field name, same action. Status 200 here, 401 on a bad
				// password — the fixture's own status is the 401 case.
				const page = fix.response("login-wrong-password");
				const out = Buffer.from(page.text, "utf8");
				res.writeHead(200, { ...page.headers, "content-length": out.length });
				return res.end(out);
			}
			// A foreign Origin on the login form is refused before the password is
			// even looked at.
			if (req.headers.origin && !(state.allowedOrigins ?? []).includes(req.headers.origin)) {
				return sendFixture(res, "login-cross-origin");
			}
			const params = new URLSearchParams(rawBody ?? "");
			const supplied = params.get("password") ?? "";
			if (supplied !== password) return sendFixture(res, "login-wrong-password");
			const { value } = issueCookie(password);
			// `Secure` only when the request arrived over TLS: a plain-loopback
			// first run must still be able to set the cookie.
			const overTls = req.headers["x-forwarded-proto"] === "https";
			res.writeHead(303, {
				location: "/",
				"set-cookie": setCookieHeader(value, { secure: overTls }),
			});
			return res.end();
		}

		if (pathname === "/logout") {
			res.writeHead(303, {
				location: "/login",
				"set-cookie": `${COOKIE_NAME}=""; Max-Age=0; Path=/; SameSite=lax`,
				"clear-site-data": '"storage"',
			});
			return res.end();
		}

		if (pathname === "/mark.png") {
			res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
			return res.end(TINY_PNG);
		}

		if (pathname === "/") {
			const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
			if (!verifyCookie(cookie, password)) {
				res.writeHead(303, { location: "/login" });
				return res.end();
			}
			// The captured no-bundle answer: the fastest way to tell "the daemon is
			// up but has no web bundle" apart from "the daemon is down".
			return sendFixture(res, "index-authed-no-dist");
		}

		if (pathname.startsWith("/assets/")) {
			return sendText(res, 404, "not found", { "cache-control": "no-store" });
		}

		/* ----------------------------------------------------------- api: list -- */

		if (pathname === "/api/sessions" && method === "GET") {
			const gzipped = sendJson(res, 200, listBody());
			return gzipped;
		}

		if (pathname === "/api/sessions/events" && method === "GET") {
			const stream = world.stream ?? {};
			const seed = stream.mode === "keepalive-only" ? null : { event: "sessions", data: listBody() };
			return openStream(req, res, {
				kind: "sessions",
				seed,
				frames: () => null,
			});
		}

		if (pathname === "/api/sessions/past" && method === "GET") {
			if (Array.isArray(world.past)) return sendJson(res, 200, { sessions: world.past, degraded: [] });
			return sendFixture(res, "past-empty");
		}

		if (pathname === "/api/sessions/search" && method === "GET") {
			if (world.search) {
				const { status, headers, json, text } = world.search;
				return json !== undefined ? sendJson(res, status, json, headers) : sendText(res, status, text, headers);
			}
			const body = fix.body("search-empty");
			body.query = url.searchParams.get("q") ?? "";
			return sendJson(res, 200, body);
		}

		if (pathname === "/api/sessions/start" && method === "POST") {
			if (body && typeof body === "object" && typeof body.cwd === "string" && body.cwd.startsWith("/etc")) {
				return sendFixture(res, "start-bad-cwd");
			}
			const fixture = fix.body("start-session");
			const id = fixture.session_id;
			return sendJson(res, 200, fixture);
		}

		if (pathname === "/api/sessions/resume" && method === "POST") {
			if (!body || body.session_id === undefined) return sendFixture(res, "resume-no-id");
			const known = (world.past ?? []).some((row) => row.id === body.session_id);
			if (!known) return sendFixture(res, "resume-unknown");
			return sendFixture(res, "start-session");
		}

		if (pathname === "/api/commands" && method === "GET") return sendFixture(res, "commands");
		if (pathname === "/api/directories" && method === "GET") return sendFixture(res, "directories");
		if (pathname === "/api/models" && method === "GET") {
			if (Array.isArray(world.models)) return sendJson(res, 200, { models: world.models });
			return sendFixture(res, "models");
		}

		if (pathname === "/api/projects") {
			if (method === "GET") return sendFixture(res, "projects-empty");
			if (method === "POST") return sendJson(res, 201, { key: "mock-project", name: body?.name ?? "Mock project" });
		}

		if (pathname === "/api/pair" && method === "POST") return sendFixture(res, "pair-no-code");

		if (pathname === "/api/transcribe" && method === "POST") {
			const contentType = String(req.headers["content-type"] ?? "");
			if (contentType.includes("application/json")) return sendFixture(res, "transcribe-bad-mime");
			if (!contentType.includes("multipart")) return sendFixture(res, "transcribe-missing-audio");
			return sendJson(res, 200, { text: "", degraded: ["stt"] });
		}

		/* --------------------------------------------------- api: session-scoped -- */

		const sessionMatch = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(pathname);
		if (sessionMatch) {
			const sessionId = decodeURIComponent(sessionMatch[1]);
			const rest = sessionMatch[2] ?? "";
			const projection = projectionFor(sessionId);

			if (rest === "/events" && method === "GET") {
				if (!projection) return sendJson(res, 404, errorBody("unknown session"));
				const stream = world.stream ?? {};
				const seedProjection = structuredClone(projection);
				return openStream(req, res, {
					kind: "projection",
					seed: stream.mode === "keepalive-only" ? null : { event: "projection", data: seedProjection },
					frames: sessionFrames(projection),
				});
			}

			if (rest === "/history" && method === "GET") {
				if (!projection) return sendFixture(res, "history-unknown");
				const limitRaw = url.searchParams.get("limit");
				const limit = limitRaw === null || !/^\d+$/.test(limitRaw)
					? 80
					: Math.min(200, Math.max(1, Number(limitRaw)));
				// `before` is the id of the oldest entry the client already holds;
				// the page is the entries immediately older than it.
				const all = projection.transcript ?? [];
				const before = url.searchParams.get("before");
				const end = before ? all.findIndex((entry) => entry.id === before) : all.length;
				const sliceEnd = end <= 0 ? all.length : end;
				const entries = all.slice(Math.max(0, sliceEnd - limit), sliceEnd);
				return sendJson(res, 200, { entries, has_more: sliceEnd - limit > 0 });
			}

			if (rest === "/image" && method === "GET") {
				const entry = url.searchParams.get("entry");
				if (!entry) return sendFixture(res, "image-missing-entry-param");
				const index = url.searchParams.get("i");
				// A non-numeric index is a *400* (`contract.md` §3.6, `bad image
				// index`); an out-of-range one is a 404 that resolves to the same
				// shape as an unknown entry. Collapsing both into one answer would
				// hide the client bug the 400 exists to surface.
				if (index !== null && !/^\d+$/.test(index)) {
					return sendJson(res, 400, errorBody("bad image index"));
				}
				// The captured (session, entry, index) triple is served from the
				// corpus, which is what makes the capture's own URL resolve. Anything
				// else needs a live generation for this session.
				const capturedHit = capturedImage
					&& sessionId === capturedImage.sessionId
					&& entry === capturedImage.entry
					&& (index === null || Number(index) === capturedImage.index);
				if (capturedHit) {
					res.writeHead(200, { ...capturedImage.fixture.headers, "content-length": TINY_PNG.length });
					return res.end(TINY_PNG);
				}
				if (!projection) return sendJson(res, 404, errorBody("unknown session"));
				const known = (projection.transcript ?? []).some(
					(row) => row.id === entry && (row.images ?? []).length > 0,
				);
				if (!known) return sendFixture(res, "image-unknown-entry");
				// The relay's own cache header — which the tunnel gateway then
				// forces to no-store, so the client must cache images itself.
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "public, max-age=31536000, immutable",
					"content-length": TINY_PNG.length,
				});
				return res.end(TINY_PNG);
			}

			if (rest === "/seen" && method === "POST") {
				if (!projection) return sendFixture(res, "seen-unknown-session");
				if (!body || typeof body !== "object" || body.completion_token === undefined) {
					return sendFixture(res, "seen-missing-token");
				}
				state.seenTokens.add(String(body.completion_token));
				return sendFixture(res, "seen-real-token");
			}

			if (rest === "/pin" && method === "POST") {
				if (!projection) return sendFixture(res, "pin-unknown");
				if (typeof body?.pinned !== "boolean") return sendFixture(res, "pin-not-bool");
				state.pins.set(sessionId, body.pinned);
				return sendFixture(res, "pin-true");
			}

			if (rest === "/operator/challenge" && method === "POST") {
				if (!projection) return sendFixture(res, "operator-challenge-unknown-session");
				if (String(body?.action ?? "") !== "sign") return sendFixture(res, "operator-challenge-bad-action");
				return sendJson(res, 200, { challenge: "mock-challenge", key_id: "mock-key" });
			}

			if (rest === "/command" && method === "POST") return handleCommand(req, res, sessionId, body);

			const agentMatch = /^\/agents\/([^/]+)(\/history)?$/.exec(rest);
			if (agentMatch && method === "GET") {
				const jobId = decodeURIComponent(agentMatch[1]);
				const row = (projection?.subagents ?? []).find((candidate) => candidate.job_id === jobId);
				if (!row) {
					return agentMatch[2]
						? sendFixture(res, "subagent-history-unknown")
						: sendFixture(res, "subagent-unknown");
				}
				// The detail route re-materialises what the projection strips: the
				// full prompt, result, error, transcript and todos.
				if (agentMatch[2]) {
					return sendJson(res, 200, {
						entries: row.transcript ?? [],
						has_more: false,
					});
				}
				return sendJson(res, 200, {
					...row,
					prompt: row.prompt || "Sweep the reconciliation pipeline for retry defects.",
					result_text: row.result_text || "Scanned 214 files; three edits applied.",
					transcript: row.transcript ?? [],
					todos: row.todos ?? [],
					launch_message_id: row.launch_message_id || "launch-mock-1",
					version: projection.version ?? 1,
				});
			}
		}

		const pairMatch = /^\/api\/pair\/(.+)$/.exec(pathname);
		if (pairMatch && method === "GET") {
			const device = decodeURIComponent(pairMatch[1]);
			return /^[0-9a-f]{16}$/i.test(device)
				? sendFixture(res, "pair-status-unknown-device")
				: sendFixture(res, "pair-status-bad-id");
		}

		// A route the relay does not have: JSON, so a client's error path is the
		// one under test rather than a 404 HTML page.
		return sendJson(res, 404, errorBody("not found"));
	};

	/* ------------------------------------------------------------ the server -- */

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
		const pathname = url.pathname;
		const method = req.method.toUpperCase();
		const started = Date.now();
		res.req = req;

		const finish = (status, note) => {
			if (state.record) {
				recordRequest({
					method,
					path: pathname + (url.search || ""),
					status,
					note,
					cookie: req.headers.cookie?.includes(COOKIE_NAME) ? "present" : "absent",
					origin: req.headers.origin ?? null,
					ms: Date.now() - started,
				});
			}
		};

		// The mock's own control surface. Loopback-only, never part of the relay
		// contract, and namespaced so it can never shadow a real route. It is how
		// the visual harness switches scenario between frames and how a test
		// asserts what the run did.
		if (pathname.startsWith("/__mock")) {
			try {
				if (pathname === "/__mock/state" && method === "GET") {
					return sendJson(res, 200, {
						scenario: state.scenario,
						faults: state.faults.applied,
						sessions: Object.keys(state.world.projections ?? {}).length,
						admittedCommands: state.admitted.size,
						duplicateSuppressed: state.duplicateSuppressed,
						requests: state.requests.length,
						uptimeS: Math.round((Date.now() - state.startedAt) / 1000),
					});
				}
				if (pathname === "/__mock/scenarios" && method === "GET") {
					return sendJson(res, 200, {
						scenarios: Object.values(scenarios).map(({ name, description, shows }) => ({
							name,
							description,
							shows,
						})),
						faults: FAULT_NAMES,
					});
				}
				if (pathname === "/__mock/record" && method === "GET") {
					return sendJson(res, 200, { requests: state.requests });
				}
				if (pathname === "/__mock/scenario" && method === "POST") {
					const raw = await readBody(req);
					const next = JSON.parse(raw || "{}").scenario;
					if (!next || !scenarios[next]) {
						return sendJson(res, 400, errorBody(`unknown scenario: '${next}'`));
					}
					state.scenario = next;
					resetWorld();
					return sendJson(res, 200, { scenario: next });
				}
				if (pathname === "/__mock/fault" && method === "POST") {
					const raw = await readBody(req);
					const next = parseFaults(JSON.parse(raw || "{}").faults ?? []);
					state.faults = next;
					return sendJson(res, 200, { faults: next.applied });
				}
				if (pathname === "/__mock/reset" && method === "POST") {
					state.requests = [];
					state.admitted = new Map();
					state.duplicateSuppressed = 0;
					state.expired = false;
					resetWorld();
					return sendJson(res, 200, { ok: true });
				}
				if (pathname === "/__mock/shutdown" && method === "POST") {
					sendJson(res, 200, { ok: true });
					setTimeout(() => shutdown(), 50);
					return undefined;
				}
			} catch (error) {
				return sendJson(res, 500, errorBody(String(error.message ?? error)));
			}
			return sendJson(res, 404, errorBody("unknown control route"));
		}

		try {
			// The edge/gateway sits in front of the relay: when a scenario models a
			// refused path, *every* route answers the refusal, which is what a phone
			// actually sees.
			if (state.world.failure) {
				const { surface, key } = state.world.failure;
				if (surface === "edge") {
					const refusal = EDGE_REFUSALS[key];
					if (!refusal) throw new Error(`no such edge refusal: ${key}`);
					finish(refusal.status, `edge:${key}`);
					return sendText(res, refusal.status, refusal.text, refusal.headers ?? {});
				}
				// `GATEWAY_FAILURES` is consulted FIRST. Two key spaces share the
				// `503-` prefix — `503-<RELAY_DETAIL reason>` is the refusal, while
				// `503-relay-not-installed` is one of the gateway's own bodies with a
				// different shape — so testing the prefix first silently misroutes
				// that body into the reason lookup and answers a 500.
				const body = GATEWAY_FAILURES[key];
				if (body) {
					finish(body.status, `gateway:${key}`);
					return sendJson(res, body.status, body.json);
				}
				if (key.startsWith("503-")) {
					const reason = key.slice(4);
					const detail = fix.gatewayConstants.relay_detail[reason];
					if (!detail) throw new Error(`no such gateway reason: ${reason}`);
					const refusal = gatewayUnavailable(detail, reason);
					finish(503, `gateway:${reason}`);
					return sendJson(res, 503, refusal.json, refusal.headers);
				}
				throw new Error(`no such gateway failure: ${key}`);
			}

			// A mid-session gateway refusal, from `--fault 503-<reason>`.
			if (state.faults.http.refuseWith) {
				const key = state.faults.http.refuseWith;
				// Same ordering rule as the scenario path above: bodies first.
				const body = GATEWAY_FAILURES[key];
				if (body) {
					finish(body.status, `fault:gateway:${key}`);
					return sendJson(res, body.status, body.json);
				}
				if (key.startsWith("503-")) {
					const reason = key.slice(4);
					const detail = fix.gatewayConstants.relay_detail[reason];
					if (!detail) throw new Error(`no such gateway reason: ${reason}`);
					const refusal = gatewayUnavailable(detail, reason);
					finish(503, `fault:gateway:${reason}`);
					return sendJson(res, 503, refusal.json, refusal.headers);
				}
				throw new Error(`no such gateway failure: ${key}`);
				return sendJson(res, failure.status, failure.json);
			}

			// `--scenario loading` holds the API open: there is no "loading" body
			// in the contract, so the only honest way to produce that state is to
			// answer nothing, exactly as a slow relay does.
			if (state.world.hold?.api === "forever" && pathname.startsWith("/api/") && !pathname.endsWith("/events")) {
				finish(0, "held open (scenario loading)");
				return undefined;
			}

			if (state.faults.http.delayMs > 0) {
				await new Promise((resolvePromise) => setTimeout(resolvePromise, state.faults.http.delayMs));
			}

			res.on("finish", () => finish(res.statusCode));
			return await route(req, res, pathname, url);
		} catch (error) {
			if (error?.tooLarge) {
				finish(413, "oversize");
				return sendJson(res, 413, GATEWAY_FAILURES["413-too-large"].json);
			}
			finish(500, String(error?.message ?? error));
			log(`  error ${method} ${pathname}: ${error?.stack ?? error}`);
			return sendJson(res, 500, errorBody(String(error?.message ?? error)));
		}
	});

	// One field, read by both the request path and `shutdown`. Two names for it
	// (`recordMode` for the handler, `record` for the writer) is exactly how the
	// transcript came back empty: the writer read a field nobody had set.
	state.record = record || false;

	const shutdown = async () => {
		// The record goes first. `server.close()` only calls back once every
		// connection has ended, and a client holding a keep-alive connection would
		// keep this function parked past the caller's own SIGTERM deadline — which
		// lost the transcript of the very run that was being recorded.
		if (record && state.record.dir) writeRecord(record.dir);
		for (const open of state.servers) {
			open.connections?.();
			await new Promise((done) => {
				const timer = setTimeout(done, 2000);
				open.close(() => {
					clearTimeout(timer);
					done();
				});
			});
		}
	};

	const writeRecord = (dir) => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "transcript.json"),
			`${JSON.stringify(
				{
					scenario: state.scenario,
					faults: state.faults.applied,
					startedAt: new Date(state.startedAt).toISOString(),
					requests: state.requests,
					admittedCommands: [...state.admitted.keys()],
					seenTokens: [...state.seenTokens],
					duplicateSuppressed: state.duplicateSuppressed,
				},
				null,
				2,
			)}\n`,
		);
	};

	return {
		state,
		fixtures: fix,
		scenarios,
		shutdown,
		writeRecord,
		handler: server,
		/** Listen on `host:port` (port 0 picks a free one) and resolve the handle. */
		async listen({ host = "127.0.0.1", port = 0 } = {}) {
			await new Promise((resolvePromise, reject) => {
				server.once("error", reject);
				server.listen(port, host, resolvePromise);
			});
			const actual = server.address().port;
			state.servers.push({
				port: actual,
				close: (done) => server.close(done),
				// Dropping live connections is what lets `close` call back when a
				// client is sitting on a keep-alive socket; without it a shutdown can
				// wait forever on a request that will never be made again.
				connections: () => server.closeAllConnections?.(),
			});
			log(
				`mock-relay listening http://${host}:${actual}`
				+ ` scenario=${state.scenario} faults=${summariseFaults(state.faults)}`
				+ ` fixtures=${fixturesDir}`,
			);
			return { host, port: actual, url: `http://${host}:${actual}` };
		},
	};
}

/* -------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
	const { flags } = parseArgs(process.argv.slice(2));
	if (bool(flags, "help")) {
		console.log(
			[
				"usage: node tools/mock-relay/relay.mjs [options]",
				"",
				"  --port <n>            listen port (default 0: the OS picks; never 4098)",
				"  --host <addr>         bind address (default 127.0.0.1)",
				"  --scenario <name>     initial scenario (default idle) — see --list",
				"  --fault <name>        inject a fault; repeatable",
				"  --record <dir>        write a request/response transcript on shutdown",
				"  --fixtures <dir>      fixture corpus root (default <repo>/fixtures/relay)",
				"  --password <value>    relay password for the login form",
				"  --max-body-bytes <n>  override the gateway's 10 MiB ceiling, for 413 tests",
				"  --print-port          print the chosen port alone on stdout",
				"  --list                print every scenario and exit",
				"  --quiet               suppress the ready line",
				"",
				`faults: ${FAULT_NAMES.join(", ")}`,
			].join("\n"),
		);
		process.exit(0);
	}

	const fixturesDir = str(flags, "fixtures", defaultFixturesDir);
	if (bool(flags, "list")) {
		const scenarios = buildScenarios(loadFixtures(fixturesDir));
		for (const scenario of Object.values(scenarios)) {
			console.log(`${scenario.name}\n    ${scenario.description}\n    cells: ${scenario.shows.join(", ")}`);
		}
		process.exit(0);
	}

	const recordDir = str(flags, "record", undefined);
	const relay = createRelay({
		fixturesDir,
		scenario: str(flags, "scenario", "idle"),
		faults: list(flags, "fault"),
		password: str(flags, "password", DEFAULT_PASSWORD),
		maxBodyBytes: num(flags, "max-body-bytes", MAX_BODY_BYTES),
		quiet: bool(flags, "quiet"),
		record: recordDir ? { dir: recordDir } : false,
	});
	const handle = await relay.listen({
		host: str(flags, "host", "127.0.0.1"),
		port: num(flags, "port", 0),
	});
	if (bool(flags, "print-port")) process.stdout.write(`${handle.port}\n`);

	const stop = async () => {
		await relay.shutdown();
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}
