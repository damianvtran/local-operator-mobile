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

import { mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type {
	CompletionAttention,
	SessionListFrame,
	SessionProjection,
	SessionSummary,
} from "../../docs/relay/types.ts";
import { bool, list, num, parseArgs, str } from "../lib/args.ts";
import type { Json } from "../lib/json.ts";
import { asString, isRecord } from "../lib/json.ts";
import type { FaultSet } from "./faults.ts";
import { FAULT_NAMES, parseFaults, summariseFaults } from "./faults.ts";
import type { FixtureResponseOverride } from "./fixtures.ts";
import { defaultFixturesDir, loadFixtures, textOf } from "./fixtures.ts";
import type { ScenarioWorld, StreamSpec } from "./scenarios.ts";
import {
	buildScenarios,
	resolveScenarioName,
	rowFrom,
	scenarioNames,
} from "./scenarios.ts";
import {
	authVerdict,
	COOKIE_NAME,
	EDGE_REFUSALS,
	errorBody,
	GATEWAY_FAILURES,
	gatewayUnavailable,
	issueCookie,
	MAX_BODY_BYTES,
	originVerdict,
	readCookie,
	SSE_HEADERS,
	SSE_KEEPALIVE,
	SSE_KEEPALIVE_S,
	setCookieHeader,
	sseFrame,
	verifyCookie,
} from "./wire.ts";

export const DEFAULT_PASSWORD = "mock-relay-password";

/** A real 1×1 PNG, so `<Image>` has something decodable to render for `/image`. */
const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
);

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One event the stream writes: the SSE event name and its payload. */
export interface StreamFrame {
	event: string;
	data: unknown;
}

/**
 * One request the mock served, as `--record` writes it and `/__mock/record`
 * returns. The index signature is deliberate: the record keeps whatever each
 * route decided was worth asserting on, so the shape is open at the edges while
 * the fields every row carries are named.
 */
export interface RecordedRequest {
	seq: number;
	at: string;
	[key: string]: Json | undefined;
}

/** Everything `createRelay` accepts. */
export interface RelayOptions {
	fixturesDir?: string;
	password?: string;
	maxBodyBytes?: number;
	/** `false`, or a directory to write the request transcript into on shutdown. */
	record?: false | { dir: string };
	scenario?: string;
	faults?: string[];
	quiet?: boolean;
}

/** A listening socket, closable and counted for teardown. */
export interface RelayListener {
	port: number;
	close: (done: () => void) => void;
	connections: () => void;
}

/**
 * What `openStream` needs to open a stream.
 *
 * `frames` is called once per tick and returns the next event, `"end"` for a
 * clean end-of-body, or null when there is nothing more to send. `duplicate` is
 * the fault layer's hook: it produces the frame a duplicated delivery repeats,
 * and is only called while `state.duplicateFramePending` is set.
 */
interface StreamOptions {
	kind: string;
	frames: (tick: number) => StreamFrame | "end" | null;
	seed: StreamFrame | null;
	/** Called once the stream is up, with the handles a caller needs to drive it. */
	onTick?: (handles: {
		cleanup: () => void;
		write: (chunk: string) => void;
	}) => void;
	duplicate?: () => StreamFrame | null;
}

/** The mock's mutable state: everything a request handler reads. */
export interface RelayState {
	scenario: string;
	world: ScenarioWorld;
	faults: FaultSet;
	startedAt: number;
	seq: number;
	requests: RecordedRequest[];
	/** Command ids that have been admitted: what `already admitted` is about. */
	admitted: Map<string, { op: string; at: number }>;
	seenTokens: Set<string>;
	pins: Map<string, boolean>;
	/** Origins a mutation may come from; unset means the same-origin rule is off. */
	allowedOrigins?: string[];
	submittedAt: number | null;
	/** Frames the transport delivered twice, as an observation the control surface reports. */
	duplicateDelivered: number;
	/** Set when a command was admitted under `duplicate-delivery`; cleared by the stream. */
	duplicateFramePending: boolean;
	/** True once an edge 401 has been injected mid-session, so every later request is refused. */
	expired: boolean;
	scenarioStartedAt: number;
	servers: RelayListener[];
	record: false | { dir: string };
}

/**
 * Build a mock relay without listening. `start()` returns the handle, so a test
 * can drive it in-process as well as over a socket.
 */
export function createRelay(options: RelayOptions = {}) {
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
		// `request` is a JSON field of the capture, so it is narrowed rather than
		// assumed; the failing alternative is a silently empty image route.
		const request = isRecord(fixture?.request) ? fixture.request : undefined;
		const requestPath = typeof request?.path === "string" ? request.path : "";
		const match =
			/^\/api\/sessions\/([0-9a-f]{12})\/image\?entry=([^&]+)&i=(\d+)$/.exec(
				requestPath,
			);
		return match
			? {
					sessionId: match[1] ?? "",
					entry: match[2] ?? "",
					index: Number(match[3] ?? 0),
					fixture,
				}
			: null;
	})();
	const scenarios = buildScenarios(fix);
	const password = options.password ?? DEFAULT_PASSWORD;
	const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
	const record = options.record ?? false;

	// A scenario or fault the registry does not know is a hard error: silently
	// substituting a default would make every downstream assertion meaningless.

	const state: RelayState = {
		scenario: options.scenario ?? "idle",
		world: {},
		faults: parseFaults(options.faults ?? []),
		startedAt: Date.now(),
		seq: 0,
		requests: [],
		admitted: new Map(),
		seenTokens: new Set(),
		pins: new Map(),
		submittedAt: null,
		duplicateDelivered: 0,
		duplicateFramePending: false,
		expired: false,
		scenarioStartedAt: Date.now(),
		servers: [],
		record: false,
	};
	const resetWorld = (): void => {
		state.world = scenarios[state.scenario]?.world() ?? {};
		state.scenarioStartedAt = Date.now();
		// Per-scenario ledgers reset with the scenario, so a duplicate-detection
		// test cannot inherit an id admitted by the previous scenario.
		state.admitted = new Map();
		state.seenTokens = new Set();
		state.pins = new Map();
		state.duplicateFramePending = false;
		state.duplicateDelivered = 0;
	};

	if (options.scenario !== undefined) {
		// Resolve through the alias table first and fail loudly on an unknown name:
		// `--scenario relay-down` is what a person types, and silently substituting
		// the default would make every downstream assertion meaningless.
		state.scenario = resolveScenarioName(options.scenario, scenarios);
		if (!scenarios[state.scenario]) {
			throw new Error(
				`unknown scenario: '${options.scenario}'.\nKnown scenarios:\n  ` +
					scenarioNames(scenarios).join("\n  "),
			);
		}
	}
	resetWorld();

	// Diagnostics go to stderr, never stdout: stdout is reserved for
	// machine-readable output (`--print-port`), and a run that mixes the two
	// reads a log line as a port number.
	const log: (...args: unknown[]) => void = options.quiet
		? () => {}
		: (...args: unknown[]) => console.error(...args);

	/**
	 * A `RELAY_DETAIL` sentence from the captured gateway constants.
	 *
	 * The constants file is a JSON capture, so its `relay_detail` map is narrowed
	 * here once rather than indexed as if it were typed; a missing reason is a
	 * hard error, since the alternative is a 503 whose body says `undefined`.
	 */
	const gatewayBody = (key: string): Json => {
		const body = GATEWAY_FAILURES[key];
		if (body === undefined)
			throw new Error(`no such gateway failure body: ${key}`);
		return body.json;
	};

	const gatewayDetail = (reason: string): string => fix.gatewayDetail(reason);

	/* --------------------------------------------------------------- helpers -- */

	/**
	 * Append the user's row to a projection, as the runtime does on admission.
	 *
	 * Both halves matter to the duplicate-delivery fault. The row is what the
	 * client must fold (two deliveries, one row); the version bump is what makes
	 * the frame admissible at all, since a frame whose version is not newer than
	 * the client's current one is discarded as stale — and then "one row" would be
	 * true for the wrong reason.
	 */
	const appendUserRow = (
		projection: SessionProjection,
		commandId: string,
		text: unknown,
	): void => {
		projection.version =
			(typeof projection.version === "number" ? projection.version : 1) + 1;
		projection.transcript = [
			...(projection.transcript ?? []),
			{
				id: `user-${commandId}`,
				kind: "user",
				text: typeof text === "string" ? text : "",
				tool_call_id: "",
				tool_name: "",
				tool_state: "interrupted",
				summary: "",
				intent: "",
				diff_added: 0,
				diff_removed: 0,
				elapsed_s: 0,
				error: "",
				details: {},
				images: [],
				final: true,
				text_complete: true,
			},
		];
	};

	const nowIso = (): string => new Date().toISOString();

	const sendJson = (
		res: ServerResponse,
		status: number,
		body: unknown,
		headers: Record<string, string> = {},
	): void => {
		const payload = JSON.stringify(body);
		// The relay gzips per-route when the client asks and the body is ≥ 1024
		// bytes — never as middleware, because middleware would buffer the SSE
		// stream. Reproducing it here means a client that forgets to decode is
		// caught locally instead of on a phone.
		const wantsGzip = /gzip/.test(
			String(res.req?.headers["accept-encoding"] ?? ""),
		);
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

	const sendText = (
		res: ServerResponse,
		status: number,
		text: string,
		headers: Record<string, string> = {},
	): void => {
		const out = Buffer.from(text, "utf8");
		res.writeHead(status, {
			"content-type": "text/plain; charset=utf-8",
			...headers,
			"content-length": out.length,
		});
		res.end(out);
	};

	/** Send a fixture's recorded response verbatim (status, headers, body). */
	const sendFixture = (
		res: ServerResponse,
		name: string,
		overrides: FixtureResponseOverride = {},
	): void => {
		const response = { ...fix.response(name), ...overrides };
		const headers = { ...response.headers, ...(overrides.headers ?? {}) };
		if (response.json !== undefined) {
			sendJson(res, response.status, response.json, headers);
			return;
		}
		if (
			typeof response.text === "string" &&
			headers["content-type"]?.includes("html")
		) {
			const out = Buffer.from(response.text, "utf8");
			res.writeHead(response.status, {
				...headers,
				"content-length": out.length,
			});
			res.end(out);
			return;
		}
		sendText(res, response.status, response.text ?? "", headers);
		return;
	};

	/** The session rows for the listing, in the relay's own rank order. */
	const rowsFor = (): SessionSummary[] => {
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
				for (const row of rows)
					Object.assign(row, world.rowOverridesAfterHeartbeat);
			}
		}
		const rank = (row: SessionSummary): number =>
			row.pinned ? 0 : row.section === "active" ? 1 : 2;
		return rows.sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
	};

	const listBody = (): SessionListFrame => {
		const world = state.world;
		return {
			sessions: rowsFor(),
			degraded: world.listOverrides?.degraded ?? [],
			capabilities: structuredClone(fix.list("sessions-empty").capabilities),
		};
	};

	/** Find a projection by session id, or by the captured id for `{id}`-less routes. */
	const projectionFor = (id: string): SessionProjection | undefined =>
		state.world.projections?.[id];

	/* -------------------------------------------------------------- recording -- */

	/** Never record a credential: the login form's password and the cookie value. */
	const redactBody = (raw: string): string =>
		typeof raw === "string"
			? raw.replace(/(^|&)password=[^&]*/gi, "$1password=<redacted>")
			: raw;

	const recordRequest = (
		entry: Record<string, Json | undefined>,
	): RecordedRequest => {
		state.seq += 1;
		const row: RecordedRequest = { seq: state.seq, at: nowIso(), ...entry };
		state.requests.push(row);
		return row;
	};

	/* ------------------------------------------------------------------- SSE -- */

	/**
	 * Open a stream, send frames, and honour the fault layer.
	 * `frames()` yields `{event, data}` synchronously or as a promise of one.
	 */
	const openStream = async (
		req: IncomingMessage,
		res: ServerResponse,
		{ kind, frames, seed, onTick, duplicate }: StreamOptions,
	): Promise<void> => {
		res.writeHead(200, SSE_HEADERS);
		res.flushHeaders?.();
		const faults = state.faults.sse;
		let closed = false;
		let tick = 0;
		let lastWrite = Date.now();
		const timers: Array<ReturnType<typeof setTimeout>> = [];
		const write = (chunk: string): void => {
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
				const t2 = setTimeout(
					() => {
						if (!closed) res.destroy();
					},
					Math.max(5, faults.chunkGapMs),
				);
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
				const source = isRecord(seed.data) ? seed.data : {};
				const older: Record<string, unknown> = { ...structuredClone(source) };
				older.version = Math.max(1, Number(source.version ?? 1) - 5);
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
			if (Date.now() - lastWrite >= SSE_KEEPALIVE_S * 1000)
				write(SSE_KEEPALIVE);
		}, 1000);

		const intervalMs = state.world.stream?.intervalMs ?? 700;
		const pump = setInterval(() => {
			if (closed) return;
			// `silent-stall` is a stream that opens, seeds, and then says nothing —
			// no frames, no keep-alives. The keep-alive interval honours this too;
			// without the guard here the fault still pumped turn frames and the
			// declared adversity did not exist.
			if (faults.silentAfterSeed) return;
			// A duplicated *transport* delivery, injected at the stream rather than at
			// the command endpoint: the fault has to be visible on the wire, because a
			// client without de-duplication is what it exists to fail. Both copies are
			// one byte string written twice — anything else (a bump between them, a
			// different event) would be a new event rather than a duplicate of one.
			if (state.duplicateFramePending) {
				const copy = duplicate?.() ?? null;
				if (copy) {
					const bytes = sseFrame(copy.event, copy.data);
					write(bytes);
					write(bytes);
					state.duplicateDelivered += 2;
				}
				state.duplicateFramePending = false;
			}
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
		let expireTimer: ReturnType<typeof setTimeout> | undefined;
		if (faults.expireAfterS !== undefined) {
			expireTimer = setTimeout(() => {
				state.expired = true;
				cleanup();
				res.end();
			}, faults.expireAfterS * 1000);
			timers.push(expireTimer);
		}

		let cutTimer: ReturnType<typeof setTimeout> | undefined;
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
	const sessionFrames = (
		projection: SessionProjection,
	): ((tick: number) => StreamFrame | "end" | null) => {
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
				// The captured `attention` block is the corpus's own `CompletionAttention`
				// (fixtures/relay/sse/sse-attention-complete.json), replayed rather than
				// re-typed; only `kind` is derived, from the stop reason this scenario
				// declared. The cast is the corpus-admission seam described in shape.ts.
				const attention = fix.frame("sse-attention-complete").data;
				if (isRecord(attention)) {
					frame.attention = {
						...structuredClone(attention),
						kind: frame.stop_reason === "aborted" ? "interrupted" : "complete",
					} as CompletionAttention;
				}
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
			if (state.faults.sse.staleVersion && tick === settleAfter - 1)
				frame.version = Math.max(1, version - 5);
			return { event: "projection", data: frame };
		};
	};

	/* --------------------------------------------------------------- routing -- */

	/** Read the whole body, refusing anything above the ceiling. */
	const readBody = (req: IncomingMessage): Promise<string> =>
		new Promise((resolvePromise, reject) => {
			const chunks: Buffer[] = [];
			let size = 0;
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				const bodyCeiling = state.faults.http.oversizeLimit ?? maxBodyBytes;
				if (size > bodyCeiling) {
					// Stop *reading* but never destroy the socket: destroying it here
					// closes the connection before the 413 can be written, and the
					// client then sees a transport error instead of the gateway's own
					// refusal — the one response a 413 check exists to observe.
					// `resume()` drains what the client is still sending so the
					// response can reach it.
					reject(
						Object.assign(new Error("request body exceeds the ceiling"), {
							tooLarge: true,
						}),
					);
					req.resume();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () =>
				resolvePromise(Buffer.concat(chunks).toString("utf8")),
			);
			req.on("error", reject);
		});

	const handleCommand = (
		req: IncomingMessage,
		res: ServerResponse,
		sessionId: string,
		body: Record<string, unknown>,
	): void => {
		const world = state.world;
		if (world.commandOverride) {
			sendFixture(res, world.commandOverride);
			return;
		}

		if (
			body === undefined ||
			typeof body !== "object" ||
			Array.isArray(body) ||
			body === null
		) {
			sendFixture(res, "command-body-not-object");
			return;
		}
		// Machine-held proof material is dropped rather than refused, so a client
		// learns nothing about its shape — the relay's own rule.
		const op = body.op;
		if (typeof op !== "string" || op === "") {
			sendFixture(res, "command-invalid-op-missing");
			return;
		}

		// Two ops the client may type but the relay refuses: a native app must not
		// build UI on them.
		if (op === "new_conversation") {
			sendFixture(res, "op-new-conversation");
			return;
		}
		if (op === "resume_session") {
			sendFixture(res, "op-resume-session");
			return;
		}

		if (!projectionFor(sessionId)) {
			sendFixture(res, "command-unknown-session");
			return;
		}

		if (op === "prompt" || op === "steer") {
			if (!("command_id" in body)) {
				sendFixture(res, "command-missing-command-id");
				return;
			}
			if (!UUID_RE.test(String(body.command_id))) {
				sendFixture(res, "command-invalid-uuid");
				return;
			}
			// Bound once, narrowed once: every later use (the ledger, the duplicate
			// row) has to agree on which identity was admitted.
			const commandId = String(body.command_id);
			const faults = state.faults.command;
			const previous = state.admitted.get(commandId);
			if (previous) {
				// A refused command is fully released, so a retry of the same id
				// really does admit it — "already admitted" means durably in the
				// transcript or live in the pending map.
				sendFixture(res, "command-prompt-duplicate");
				return;
			}
			if (faults.noAckForever) {
				// Accepted and never acknowledged — but the identity IS reserved before the
				// ack, exactly as production reserves it (`command_reservation.py:82`
				// writes `self._commands[command_id]` at reserve time, before the wait).
				// A mock that forgot the command on the way out would hang the *retry* too,
				// which models a relay that never saw it rather than the ambiguity this
				// fault exists for: admitted, unacknowledged, and a retry answered
				// `already admitted`.
				state.admitted.set(commandId, { op, at: Date.now() });
				return;
			}
			// A command to a runtime that is up but not answering (the `degraded`
			// scenario): the relay holds the request for its own reply window and then
			// answers the same 504 the timed fault does. Without this the scenario
			// declared a behaviour the mock did not have, and a client that waited
			// forever would have passed.
			const commandWindowMs = world.hold?.commands;
			if (typeof commandWindowMs === "number") {
				state.admitted.set(commandId, { op, at: Date.now() });
				setTimeout(() => {
					sendJson(res, 504, errorBody("session did not answer"));
				}, commandWindowMs);
				return;
			}
			if (faults.noAck) {
				state.admitted.set(commandId, { op, at: Date.now() });
				setTimeout(() => {
					sendJson(res, 504, errorBody("session did not answer"));
				}, faults.noAckAfterMs);
				return;
			}
			state.admitted.set(commandId, { op, at: Date.now() });
			// The runtime appends the user's row to the transcript when it admits a
			// command, so the effect of a duplicated delivery is observable as ONE row
			// after TWO identical frames — which is what makes the fault falsifiable by
			// a client rather than by this process's own counter.
			const projection = projectionFor(sessionId);
			if (projection) appendUserRow(projection, commandId, body.text);
			if (faults.duplicateDelivery) state.duplicateFramePending = true;
			if (op === "steer") sendFixture(res, "command-steer-queued");
			else sendFixture(res, "command-prompt-ok");
			return;
		}

		const byOp: Record<string, string> = {
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
		if (fixture) {
			sendFixture(res, fixture);
			return;
		}
		sendFixture(res, "command-unknown-op");
		return;
	};

	/** Every non-control route, in the relay's own order of checks. */
	const route = async (
		req: IncomingMessage,
		res: ServerResponse,
		pathname: string,
		url: URL,
	): Promise<unknown> => {
		const method = (req.method ?? "GET").toUpperCase();
		const world = state.world;
		const mutation = method !== "GET" && method !== "HEAD";

		// 1. The gateway's body ceiling, before anything is routed.
		let rawBody: string | undefined;
		try {
			if (mutation) rawBody = await readBody(req);
		} catch (error) {
			// The ceiling is signalled by a marker on the thrown error, so the marker
			// is read off the caught value rather than assumed present.
			const tooLarge = isRecord(error) && error.tooLarge === true;
			if (tooLarge) {
				sendJson(res, 413, gatewayBody("413-too-large"));
				return;
			}
			throw error;
		}

		const publicRoute =
			pathname === "/healthz" ||
			pathname === "/login" ||
			pathname === "/logout" ||
			pathname === "/mark.png" ||
			pathname === "/" ||
			pathname.startsWith("/assets/") ||
			pathname === "/robots.txt";

		// 2. An edge 401 mid-session: once the grant expired, nothing else answers.
		if (state.expired && !publicRoute) {
			const refusal = EDGE_REFUSALS["401-login-required"];
			if (!refusal)
				throw new Error("the edge 401 fixture is missing from the corpus");
			sendText(res, refusal.status, refusal.text, refusal.headers ?? {});
			return;
		}

		// 3. The auth gate, with the relay's audience split.
		if (!publicRoute) {
			const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
			const authenticated = verifyCookie(cookie, password);
			const verdict = authVerdict(pathname, { authenticated });
			if (verdict.kind !== "allow") {
				return verdict.json !== undefined
					? sendJson(res, verdict.status, verdict.json)
					: sendText(
							res,
							verdict.status,
							verdict.body ?? "",
							verdict.headers ?? {},
						);
			}
			// 4. Same-origin on mutations: a foreign Origin is refused, an absent
			//    one is allowed (which is how a native client and curl mutate).
			if (mutation) {
				const origin = originVerdict(req, state.allowedOrigins ?? []);
				if (origin.kind !== "allow") {
					sendJson(res, origin.status, origin.json);
					return;
				}
			}
		}

		let body: Record<string, unknown> | undefined;
		// `/login` is the one route whose body is a form, not JSON (`contract.md`
		// §1.1 rule 2): `password=<password>` url-encoded. Parsing it as JSON here
		// would answer the login form's own POST with `400 invalid JSON`.
		if (mutation && rawBody && pathname !== "/login") {
			try {
				body = JSON.parse(rawBody);
			} catch {
				// An unparseable body on the command route has its own sentence;
				// elsewhere a bad body is a plain 400.
				if (pathname.endsWith("/command")) {
					sendFixture(res, "command-bad-json");
					return;
				}
				sendJson(res, 400, errorBody("invalid JSON"));
				return;
			}
		}

		/* ------------------------------------------------------------- public -- */

		if (pathname === "/healthz") {
			const fixture = fix.record("healthz");
			return sendJson(res, 200, {
				...fixture,
				sessions: Object.keys(world.projections ?? {}).length,
			});
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
				const out = Buffer.from(textOf(page), "utf8");
				res.writeHead(200, { ...page.headers, "content-length": out.length });
				return res.end(out);
			}
			// A foreign Origin on the login form is refused before the password is
			// even looked at.
			if (
				req.headers.origin &&
				!(state.allowedOrigins ?? []).includes(req.headers.origin)
			) {
				sendFixture(res, "login-cross-origin");
				return;
			}
			const params = new URLSearchParams(rawBody ?? "");
			const supplied = params.get("password") ?? "";
			if (supplied !== password) {
				sendFixture(res, "login-wrong-password");
				return;
			}
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
			res.writeHead(200, {
				"content-type": "image/png",
				"cache-control": "no-store",
			});
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
			sendFixture(res, "index-authed-no-dist");
			return;
		}

		if (pathname.startsWith("/assets/")) {
			sendText(res, 404, "not found", { "cache-control": "no-store" });
			return;
		}

		/* ----------------------------------------------------------- api: list -- */

		if (pathname === "/api/sessions" && method === "GET") {
			const gzipped = sendJson(res, 200, listBody());
			return gzipped;
		}

		if (pathname === "/api/sessions/events" && method === "GET") {
			const stream: StreamSpec = world.stream ?? { mode: "idle" };
			const seed =
				stream.mode === "keepalive-only"
					? null
					: { event: "sessions", data: listBody() };
			return openStream(req, res, {
				kind: "sessions",
				seed,
				frames: () => null,
			});
		}

		if (pathname === "/api/sessions/past" && method === "GET") {
			if (Array.isArray(world.past)) {
				sendJson(res, 200, { sessions: world.past, degraded: [] });
				return;
			}
			sendFixture(res, "past-empty");
			return;
		}

		if (pathname === "/api/sessions/search" && method === "GET") {
			if (world.search) {
				const { status, headers, json, text } = world.search;
				return json !== undefined
					? sendJson(res, status, json, headers ?? {})
					: sendText(res, status, text ?? "", headers ?? {});
			}
			const body = fix.record("search-empty");
			body.query = url.searchParams.get("q") ?? "";
			sendJson(res, 200, body);
			return;
		}

		if (pathname === "/api/sessions/start" && method === "POST") {
			if (
				body &&
				typeof body === "object" &&
				typeof body.cwd === "string" &&
				body.cwd.startsWith("/etc")
			) {
				sendFixture(res, "start-bad-cwd");
				return;
			}
			const fixture = fix.record("start-session");
			const id = asString(fixture.session_id) ?? "";
			sendJson(res, 200, { ...fixture, session_id: id });
			return;
		}

		if (pathname === "/api/sessions/resume" && method === "POST") {
			if (!body || body.session_id === undefined) {
				sendFixture(res, "resume-no-id");
				return;
			}
			const known = (Array.isArray(world.past) ? world.past : []).some(
				(row) => row.id === body.session_id,
			);
			if (!known) {
				sendFixture(res, "resume-unknown");
				return;
			}
			sendFixture(res, "start-session");
			return;
		}

		if (pathname === "/api/commands" && method === "GET") {
			sendFixture(res, "commands");
			return;
		}
		if (pathname === "/api/directories" && method === "GET") {
			sendFixture(res, "directories");
			return;
		}
		if (pathname === "/api/models" && method === "GET") {
			if (Array.isArray(world.models)) {
				sendJson(res, 200, { models: world.models });
				return;
			}
			sendFixture(res, "models");
			return;
		}

		if (pathname === "/api/projects") {
			if (method === "GET") {
				sendFixture(res, "projects-empty");
				return;
			}
			if (method === "POST")
				return sendJson(res, 201, {
					key: "mock-project",
					name: body?.name ?? "Mock project",
				});
		}

		if (pathname === "/api/pair" && method === "POST") {
			sendFixture(res, "pair-no-code");
			return;
		}

		if (pathname === "/api/transcribe" && method === "POST") {
			const contentType = String(req.headers["content-type"] ?? "");
			if (contentType.includes("application/json")) {
				sendFixture(res, "transcribe-bad-mime");
				return;
			}
			if (!contentType.includes("multipart")) {
				sendFixture(res, "transcribe-missing-audio");
				return;
			}
			sendJson(res, 200, { text: "", degraded: ["stt"] });
			return;
		}

		/* --------------------------------------------------- api: session-scoped -- */

		const sessionMatch = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(pathname);
		if (sessionMatch) {
			const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
			const rest = sessionMatch[2] ?? "";
			const projection = projectionFor(sessionId);

			if (rest === "/events" && method === "GET") {
				if (!projection) {
					sendJson(res, 404, errorBody("unknown session"));
					return;
				}
				const stream: StreamSpec = world.stream ?? { mode: "idle" };
				const seedProjection = structuredClone(projection);
				return openStream(req, res, {
					kind: "projection",
					seed:
						stream.mode === "keepalive-only"
							? null
							: { event: "projection", data: seedProjection },
					frames: sessionFrames(projection),
					// The duplicate provider reads the live projection, so the second copy
					// carries the admitted command's row and the version that announces it.
					duplicate: () => ({
						event: "projection",
						data: structuredClone(projection),
					}),
				});
			}

			if (rest === "/history" && method === "GET") {
				if (!projection) {
					sendFixture(res, "history-unknown");
					return;
				}
				const limitRaw = url.searchParams.get("limit");
				const limit =
					limitRaw === null || !/^\d+$/.test(limitRaw)
						? 80
						: Math.min(200, Math.max(1, Number(limitRaw)));
				// `before` is the id of the oldest entry the client already holds;
				// the page is the entries immediately older than it.
				const all = projection.transcript ?? [];
				const before = url.searchParams.get("before");
				const end = before
					? all.findIndex((entry) => entry.id === before)
					: all.length;
				const sliceEnd = end <= 0 ? all.length : end;
				const entries = all.slice(Math.max(0, sliceEnd - limit), sliceEnd);
				sendJson(res, 200, { entries, has_more: sliceEnd - limit > 0 });
				return;
			}

			if (rest === "/image" && method === "GET") {
				const entry = url.searchParams.get("entry");
				if (!entry) {
					sendFixture(res, "image-missing-entry-param");
					return;
				}
				const index = url.searchParams.get("i");
				// A non-numeric index is a *400* (`contract.md` §3.6, `bad image
				// index`); an out-of-range one is a 404 that resolves to the same
				// shape as an unknown entry. Collapsing both into one answer would
				// hide the client bug the 400 exists to surface.
				if (index !== null && !/^\d+$/.test(index)) {
					sendJson(res, 400, errorBody("bad image index"));
					return;
				}
				// The captured (session, entry, index) triple is served from the
				// corpus, which is what makes the capture's own URL resolve. Anything
				// else needs a live generation for this session.
				const capturedHit =
					capturedImage &&
					sessionId === capturedImage.sessionId &&
					entry === capturedImage.entry &&
					(index === null || Number(index) === capturedImage.index);
				if (capturedHit && capturedImage.fixture !== undefined) {
					res.writeHead(200, {
						...capturedImage.fixture.headers,
						"content-length": TINY_PNG.length,
					});
					return res.end(TINY_PNG);
				}
				if (!projection) {
					sendJson(res, 404, errorBody("unknown session"));
					return;
				}
				const known = (projection.transcript ?? []).some(
					(row) => row.id === entry && (row.images ?? []).length > 0,
				);
				if (!known) {
					sendFixture(res, "image-unknown-entry");
					return;
				}
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
				if (!projection) {
					sendFixture(res, "seen-unknown-session");
					return;
				}
				if (
					!body ||
					typeof body !== "object" ||
					body.completion_token === undefined
				) {
					sendFixture(res, "seen-missing-token");
					return;
				}
				state.seenTokens.add(String(body.completion_token));
				sendFixture(res, "seen-real-token");
				return;
			}

			if (rest === "/pin" && method === "POST") {
				if (!projection) {
					sendFixture(res, "pin-unknown");
					return;
				}
				if (typeof body?.pinned !== "boolean") {
					sendFixture(res, "pin-not-bool");
					return;
				}
				state.pins.set(sessionId, body.pinned);
				sendFixture(res, "pin-true");
				return;
			}

			if (rest === "/operator/challenge" && method === "POST") {
				if (!projection) {
					sendFixture(res, "operator-challenge-unknown-session");
					return;
				}
				if (String(body?.action ?? "") !== "sign") {
					sendFixture(res, "operator-challenge-bad-action");
					return;
				}
				return sendJson(res, 200, {
					challenge: "mock-challenge",
					key_id: "mock-key",
				});
			}

			if (rest === "/command" && method === "POST")
				return handleCommand(req, res, sessionId, body ?? {});

			const agentMatch = /^\/agents\/([^/]+)(\/history)?$/.exec(rest);
			if (agentMatch && method === "GET") {
				if (!projection) {
					sendJson(res, 404, errorBody("unknown session"));
					return;
				}
				const jobId = decodeURIComponent(agentMatch[1] ?? "");
				const row = (projection?.subagents ?? []).find(
					(candidate) => candidate.job_id === jobId,
				);
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
					prompt:
						row.prompt ||
						"Sweep the reconciliation pipeline for retry defects.",
					result_text:
						row.result_text || "Scanned 214 files; three edits applied.",
					transcript: row.transcript ?? [],
					todos: row.todos ?? [],
					launch_message_id: row.launch_message_id || "launch-mock-1",
					version: projection.version ?? 1,
				});
			}
		}

		const pairMatch = /^\/api\/pair\/(.+)$/.exec(pathname);
		if (pairMatch && method === "GET") {
			const device = decodeURIComponent(pairMatch[1] ?? "");
			return /^[0-9a-f]{16}$/i.test(device)
				? sendFixture(res, "pair-status-unknown-device")
				: sendFixture(res, "pair-status-bad-id");
		}

		// A route the relay does not have: JSON, so a client's error path is the
		// one under test rather than a 404 HTML page.
		sendJson(res, 404, errorBody("not found"));
		return;
	};

	/* ------------------------------------------------------------ the server -- */

	const server = createServer(async (req, res) => {
		const url = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "127.0.0.1"}`,
		);
		const pathname = url.pathname;
		const method = (req.method ?? "GET").toUpperCase();
		const started = Date.now();
		res.req = req;

		const finish = (status: number, note = ""): void => {
			if (state.record) {
				recordRequest({
					method,
					path: pathname + (url.search || ""),
					status,
					note,
					cookie: req.headers.cookie?.includes(COOKIE_NAME)
						? "present"
						: "absent",
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
						duplicateDelivered: state.duplicateDelivered,
						duplicateFramePending: state.duplicateFramePending,
						requests: state.requests.length,
						uptimeS: Math.round((Date.now() - state.startedAt) / 1000),
					});
				}
				if (pathname === "/__mock/scenarios" && method === "GET") {
					return sendJson(res, 200, {
						scenarios: Object.values(scenarios).map(
							({ name, description, shows }) => ({
								name,
								description,
								shows,
							}),
						),
						faults: FAULT_NAMES,
					});
				}
				if (pathname === "/__mock/record" && method === "GET") {
					sendJson(res, 200, { requests: state.requests });
					return;
				}
				if (pathname === "/__mock/scenario" && method === "POST") {
					const raw = await readBody(req);
					const next = JSON.parse(raw || "{}").scenario;
					if (!next || !scenarios[next]) {
						sendJson(res, 400, errorBody(`unknown scenario: '${next}'`));
						return;
					}
					state.scenario = next;
					resetWorld();
					sendJson(res, 200, { scenario: next });
					return;
				}
				if (pathname === "/__mock/fault" && method === "POST") {
					const raw = await readBody(req);
					const next = parseFaults(JSON.parse(raw || "{}").faults ?? []);
					state.faults = next;
					sendJson(res, 200, { faults: next.applied });
					return;
				}
				if (pathname === "/__mock/reset" && method === "POST") {
					state.requests = [];
					state.admitted = new Map();
					state.duplicateDelivered = 0;
					state.duplicateFramePending = false;
					state.expired = false;
					resetWorld();
					sendJson(res, 200, { ok: true });
					return;
				}
				if (pathname === "/__mock/shutdown" && method === "POST") {
					sendJson(res, 200, { ok: true });
					setTimeout(() => shutdown(), 50);
					return undefined;
				}
			} catch (error) {
				const message =
					isRecord(error) && typeof error.message === "string"
						? error.message
						: String(error);
				sendJson(res, 500, errorBody(message));
				return;
			}
			sendJson(res, 404, errorBody("unknown control route"));
			return;
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
					return sendText(
						res,
						refusal.status,
						refusal.text,
						refusal.headers ?? {},
					);
				}
				// `GATEWAY_FAILURES` is consulted FIRST. Two key spaces share the
				// `503-` prefix — `503-<RELAY_DETAIL reason>` is the refusal, while
				// `503-relay-not-installed` is one of the gateway's own bodies with a
				// different shape — so testing the prefix first silently misroutes
				// that body into the reason lookup and answers a 500.
				const body = GATEWAY_FAILURES[key];
				if (body !== undefined) {
					finish(body.status, `gateway:${key}`);
					sendJson(res, body.status, body.json);
					return;
				}
				if (key.startsWith("503-")) {
					const reason = key.slice(4);
					const detail = gatewayDetail(reason);
					const refusal = gatewayUnavailable(detail, reason);
					finish(503, `gateway:${reason}`);
					sendJson(res, 503, refusal.json, refusal.headers);
					return;
				}
				throw new Error(`no such gateway failure: ${key}`);
			}

			// A mid-session gateway refusal, from `--fault 503-<reason>`.
			if (state.faults.http.refuseWith) {
				const key = state.faults.http.refuseWith;
				// Same ordering rule as the scenario path above: bodies first.
				const body = GATEWAY_FAILURES[key];
				if (body !== undefined) {
					finish(body.status, `fault:gateway:${key}`);
					sendJson(res, body.status, body.json);
					return;
				}
				if (key.startsWith("503-")) {
					const reason = key.slice(4);
					const detail = gatewayDetail(reason);
					const refusal = gatewayUnavailable(detail, reason);
					finish(503, `fault:gateway:${reason}`);
					sendJson(res, 503, refusal.json, refusal.headers);
					return;
				}
				throw new Error(`no such gateway failure: ${key}`);
			}

			// `--scenario loading` holds the API open: there is no "loading" body
			// in the contract, so the only honest way to produce that state is to
			// answer nothing, exactly as a slow relay does.
			if (
				state.world.hold?.api === "forever" &&
				pathname.startsWith("/api/") &&
				!pathname.endsWith("/events")
			) {
				finish(0, "held open (scenario loading)");
				return undefined;
			}

			if (state.faults.http.delayMs > 0) {
				await new Promise((resolvePromise) =>
					setTimeout(resolvePromise, state.faults.http.delayMs),
				);
			}

			res.on("finish", () => finish(res.statusCode));
			return await route(req, res, pathname, url);
		} catch (error) {
			const message =
				isRecord(error) && typeof error.message === "string"
					? error.message
					: String(error);
			const stack =
				isRecord(error) && typeof error.stack === "string"
					? error.stack
					: message;
			if (isRecord(error) && error.tooLarge === true) {
				finish(413, "oversize");
				sendJson(res, 413, gatewayBody("413-too-large"));
				return;
			}
			finish(500, message);
			log(`  error ${method} ${pathname}: ${stack}`);
			sendJson(res, 500, errorBody(message));
			return;
		}
	});

	// One field, read by both the request path and `shutdown`. Two names for it
	// (`recordMode` for the handler, `record` for the writer) is exactly how the
	// transcript came back empty: the writer read a field nobody had set.
	state.record = record || false;

	const shutdown = async (): Promise<void> => {
		// The record goes first. `server.close()` only calls back once every
		// connection has ended, and a client holding a keep-alive connection would
		// keep this function parked past the caller's own SIGTERM deadline — which
		// lost the transcript of the very run that was being recorded.
		if (record !== false && state.record !== false)
			writeRecord(state.record.dir);
		for (const open of state.servers) {
			open.connections?.();
			await new Promise<void>((done) => {
				const timer = setTimeout(() => done(), 2000);
				open.close(() => {
					clearTimeout(timer);
					done();
				});
			});
		}
	};

	const writeRecord = (dir: string): void => {
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
					duplicateDelivered: state.duplicateDelivered,
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
			await new Promise<void>((resolvePromise, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => resolvePromise());
			});
			const address = server.address();
			const actual =
				typeof address === "object" && address !== null ? address.port : 0;
			state.servers.push({
				port: actual,
				close: (done) => server.close(done),
				// Dropping live connections is what lets `close` call back when a
				// client is sitting on a keep-alive socket; without it a shutdown can
				// wait forever on a request that will never be made again.
				connections: () => server.closeAllConnections?.(),
			});
			log(
				`mock-relay listening http://${host}:${actual}` +
					` scenario=${state.scenario} faults=${summariseFaults(state.faults)}` +
					` fixtures=${fixturesDir}`,
			);
			return { host, port: actual, url: `http://${host}:${actual}` };
		},
	};
}

/* -------------------------------------------------------------------- CLI -- */

const isMain = import.meta.url.endsWith(
	process.argv[1]?.split("/").pop() ?? "",
);
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
			console.log(
				`${scenario.name}\n    ${scenario.description}\n    cells: ${scenario.shows.join(", ")}`,
			);
		}
		process.exit(0);
	}

	const recordDir = str(flags, "record", undefined);
	const relay = createRelay({
		fixturesDir,
		scenario: str(flags, "scenario", "idle"),
		faults: list(flags, "fault"),
		password: str(flags, "password", DEFAULT_PASSWORD) ?? DEFAULT_PASSWORD,
		maxBodyBytes: num(flags, "max-body-bytes", MAX_BODY_BYTES),
		quiet: bool(flags, "quiet"),
		record: recordDir ? { dir: recordDir } : false,
	});
	const handle = await relay.listen({
		host: str(flags, "host", "127.0.0.1") ?? "127.0.0.1",
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
