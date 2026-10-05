/**
 * The deterministic mock relay.
 *
 * Implements the relay's documented routes (`docs/relay/contract.md`) and the
 * tunnel edge/gateway refusals (`docs/relay/tunnel-edge.md`) with:
 *
 *   --scenario <name>   pin any state without a real agent (see scenarios.ts)
 *   --fault <name>      inject a real adversity deterministically (faults.ts)
 *   --record <dir>      write every request+response for assertions
 *
 * Three properties it is built to keep, because a harness without them is worse
 * than no harness:
 *
 * 1. **It answers what the real relay answers.** Bodies come from the captured
 *    corpus, not from shapes re-typed here; the auth gate, the cookie format and
 *    the SSE framing are the relay's own (wire.ts). So the *client's* header,
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
	capabilityBlock,
	resolveScenarioName,
	rowFrom,
	scenarioNames,
} from "./scenarios.ts";
import { declaredLengthOf, transcribeResponse } from "./transcribe.ts";
import {
	authVerdict,
	COOKIE_NAME,
	EDGE_REFUSALS,
	errorBody,
	GATEWAY_FAILURES,
	gatewayUnavailable,
	issueCookie,
	originVerdict,
	readCookie,
	SSE_HEADERS,
	SSE_KEEPALIVE,
	SSE_KEEPALIVE_S,
	setCookieHeader,
	sseFrame,
	verifyCookie,
} from "./wire.ts";

/**
 * The op vocabulary the contract lists (`docs/relay/contract.md` §4.2), used ONLY for the
 * live-session fall-through at the end of `handleCommand`: an op the mock has no branch for
 * is answered `command-unknown-op` there, which is where the relay's registrant answers it
 * too. It is deliberately NOT used as a shape gate — see `shapeRefusal`.
 */
const KNOWN_OPS = new Set([
	"prompt",
	"steer",
	"approval_answer",
	"ask_answer",
	"snapshot",
	"ping",
	"recall_steer",
	"peer_message",
	"peer_set_model",
	"variables",
	"credential",
	"register_secret_redaction",
	"complete_aside",
	"adopt_aside",
	"stop",
	"retire_if_pristine",
	"slash",
	"slash_result",
	"cancel",
	"abort",
	"set_effort",
	"set_model",
	"new_conversation",
	"resume_session",
]);

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
	/**
	 * Extra origins a mutation may come from, on top of the relay's own origin
	 * (which `listen` always adds, because the contract makes its own origin
	 * same-origin).
	 *
	 * This is the option the harness needs and could not set: `RelayState` carried
	 * the field, but `createRelay` accepted no way to fill it, so an in-process
	 * relay — a test, or a rig serving its page from one loopback port and proxying
	 * to the relay on another — was refused on every mutation and on `POST /login`
	 * with no way to opt out. The `--allow-origin` flag is the CLI's spelling of it.
	 */
	allowedOrigins?: string[];
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
	/** The rows `--record` would write, i.e. the routes the mock records. */
	recorded: RecordedRequest[];
	/**
	 * Every request the relay SERVED, including the public ones.
	 *
	 * This is a counter of traffic, and it is exposed as `requests` because that is
	 * what a reader expects that name to mean. It used to be the TRANSCRIPT's
	 * length — the number of rows the mock records, with exactly one call site — so
	 * a probe that had fetched, streamed and screenshotted could read `requests: 0`
	 * and "prove" a recovery that never happened. A zero from a dead instrument
	 * reads exactly like evidence, and this field was one.
	 *
	 * Control routes (`/__mock/…`) are excluded: counting the reader would make the
	 * before/after comparison the capture harness makes a tautology.
	 */
	requestsServed: number;
	/** Approvals settled through `approval_answer`, so a run can assert the round trip. */
	approvalsAnswered: number;
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
	/**
	 * Which world this state describes, incremented on every pin.
	 *
	 * A timer that touches global state belongs to the world it was armed IN, not to
	 * whichever world happens to be pinned when it fires: `expireAfterS` arms its timer
	 * when a stream opens and latches `expired` seconds later, so a pin in between left
	 * the latch cleared and then re-latched by a timer nobody was waiting for — under a
	 * scenario that declares no fault at all. Comparing this counter is how a stale timer
	 * knows it is stale. It is a counter rather than the scenario NAME because a run can
	 * pin A, then B, then A again, and the third pin's timer must not be taken for the
	 * first one's.
	 */
	generation: number;
	/**
	 * The faults the INVOCATION asked for (`--fault`), kept apart from a scenario's own.
	 *
	 * The two are not the same thing and conflating them is a defect in both directions:
	 * a scenario's faults must not outlive the scenario (they model that state and no
	 * other), and `--fault` must not be cleared by a scenario that declares none — which
	 * is how every fault check in `verify.ts` starts its relay. So `state.faults` is
	 * recomputed on every pin as `baseFaults + the scenario's own`, and this field is
	 * what survives the pin. */
	baseFaults: string[];
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
	/**
	 * Handle → session id, read off the corpus's own resolve capture
	 * (`push-conversation-ok.json`): its recorded REQUEST names the handle and
	 * its body names the session, so the mock's mapping cannot drift from the
	 * wire the app tests against. Every other handle is the clean 404.
	 */
	const defaultPushHandles = (() => {
		const map = new Map<string, string>();
		const fixture = fix.http.get("push-conversation-ok");
		const request = isRecord(fixture?.request) ? fixture.request : undefined;
		const requestPath = typeof request?.path === "string" ? request.path : "";
		const match = /^\/api\/push\/conversation\/([^/?#]+)$/.exec(requestPath);
		const body = isRecord(fixture?.json) ? fixture.json : undefined;
		const sessionId = asString(body?.session_id) ?? "";
		if (match?.[1] !== undefined && sessionId !== "")
			map.set(decodeURIComponent(match[1]), sessionId);
		return map;
	})();
	const scenarios = buildScenarios(fix);
	/* The push device registry (push/ack-sync S4, ADR 0006 §3.1). The corpus
	 * holds no captures of these routes — they shipped after the last drain — so
	 * the mock models them from the core's own source (`push_devices.py`: the
	 * register upsert on `install_id`, the revoke tombstone, the state
	 * precedence) and this comment is their provenance. Rows live for the life
	 * of the process: a register upserts, a DELETE tombstones, and a list
	 * renders the state the tombstones imply. No field is invented — the shapes
	 * are the ADR's (`register` → device_id + device_key + registered_at;
	 * `list_devices` → the six base fields plus the optional name and credential
	 * facts this mock never has a reason to write). */
	const pushDevices = new Map<
		string,
		{
			device_id: string;
			platform: string;
			app_version: string;
			registered_at: number;
			last_seen_at: number;
			revoked_at?: number;
		}
	>();
	let pushDeviceSeq = 0;
	const password = options.password ?? DEFAULT_PASSWORD;
	/**
	 * The bare relay has NO body ceiling: the 10 MiB cap belongs to the gateway and
	 * the edge (`docs/relay/tunnel-edge.md`), and the real relay answers an 11 MiB
	 * command body with `409 session not connected` rather than a refusal. A mock
	 * that enforced it anyway rejected requests production accepts.
	 *
	 * `--max-body-bytes` opts in for a test that wants a ceiling on this process,
	 * and the `413-oversize` fault sets one to model the gateway.
	 */
	const maxBodyBytes =
		options.maxBodyBytes !== undefined && options.maxBodyBytes > 0
			? options.maxBodyBytes
			: null;
	const record = options.record ?? false;

	// A scenario or fault the registry does not know is a hard error: silently
	// substituting a default would make every downstream assertion meaningless.

	const state: RelayState = {
		scenario: options.scenario ?? "idle",
		world: {},
		// The registries refuse an unknown name; this refuses an unknown *reason*,
		// which is the one typo that used to survive startup.
		faults: (() => {
			const parsed = parseFaults(options.faults ?? []);
			assertCapturedFaultsExist(options.faults ?? []);
			return parsed;
		})(),
		baseFaults: options.faults ?? [],
		startedAt: Date.now(),
		seq: 0,
		recorded: [],
		requestsServed: 0,
		approvalsAnswered: 0,
		admitted: new Map(),
		seenTokens: new Set(),
		pins: new Map(),
		// Wired from the options, which it must be: this field decides whether the
		// same-origin rule can *ever* allow an origin. It was declared on
		// `RelayOptions` and never copied here, so `createRelay({ allowedOrigins })`
		// silently did nothing and every caller that configured an allowlist got a
		// relay that refused it — the option read as a setting and behaved as a no-op.
		// `listen` adds the relay's own origin to whatever arrives here.
		allowedOrigins: options.allowedOrigins,
		submittedAt: null,
		duplicateDelivered: 0,
		duplicateFramePending: false,
		expired: false,
		generation: 0,
		scenarioStartedAt: Date.now(),
		servers: [],
		record: false,
	};
	const resetWorld = (): void => {
		state.world = scenarios[state.scenario]?.world() ?? {};
		state.scenarioStartedAt = Date.now();
		/* A state's own faults are applied WITH it: `S5/error` is reachable only when the
		 * stream comes up and THEN fails, so the scenario that models it carries the fault
		 * rather than depending on the runner having passed `--fault` (review round 8).
		 *
		 * AND A STATE THAT DECLARES NO FAULTS CLEARS THE PREVIOUS STATE'S. This branch used
		 * to leave `state.faults` untouched when the incoming world declared none, so the
		 * one fault-carrying scenario in the registry (`mid-session-401`, `401-mid-session`)
		 * outlived its own cell and stayed applied to every scenario after it. Measured on
		 * 2026-10-03: with the harness pinning scenarios per cell, the `S5/error` cell
		 * poisoned `S5/pending-ask` and the twelve cells after it — their session stream
		 * was answered 401 by a fault belonging to a scenario they never named, and the app
		 * rendered its "session expired" banner with an empty transcript in place of the
		 * state each cell declares. A fault that outlives its scenario is the mock lying
		 * about the state it is serving, which is the one thing this relay must never do. */
		const declaredFaults = state.world.faults ?? [];
		if (declaredFaults.length > 0) {
			const declared = declaredFaults.map((name) => name.split("=")[0] ?? "");
			const unknown = declared.filter(
				(name) =>
					!FAULT_NAMES.some((known) =>
						known.includes("<")
							? name.startsWith(known.slice(0, known.indexOf("<")))
							: known === name,
					),
			);
			// A typo here would be a state that quietly never happens, which is the
			// failure this whole round is about; `parseFaults` drops what it cannot name.
			if (unknown.length > 0)
				throw new Error(
					`scenario '${state.scenario}' declares an unknown fault: ${unknown.join(", ")}`,
				);
		}
		state.faults = parseFaults([...state.baseFaults, ...declaredFaults]);
		/* The mid-stream 401 latch belongs to the scenario that models it, and it must
		 * clear with it for the same reason the faults do. `401-mid-session` ends the
		 * session stream after `expireAfterS` and then refuses EVERY non-public route
		 * (`state.expired`), which is the right model inside that cell and a poisoned
		 * relay outside it: measured on 2026-10-03, when the latch outlived its cell the
		 * rest of the run rendered the app's "session expired" banner instead of the
		 * state each cell declares. Clearing it here also makes the job DETERMINISTIC —
		 * whether the latch tripped at all depended on whether that one cell's stream
		 * happened to live past its own two-second grant, so the same commit could run
		 * green or red. */
		state.expired = false;
		/* The world's own identity, so a timer armed in the previous one can see that it is
		 * stale. `expireAfterS` fires seconds after a stream opens, and the pin has already
		 * cleared the latch by then: measured 2026-10-03, pinning `mid-session-401`, opening
		 * its stream and pinning `idle` 0.4 s later read `faults: []` and 200, and the SAME
		 * request read 401 three seconds later — the W3 symptom one pin later, under a
		 * scenario that declares no fault. See `state.generation`. */
		state.generation += 1;
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
	/**
	 * Fault names that name a captured body, validated at STARTUP.
	 *
	 * `--fault 503-<typo>` used to be accepted and then answer `500 no such gateway
	 * reason` on the first request — the same class of typo the scenario and fault
	 * registries refuse outright. A mock that starts and then fails per request
	 * turns a typo into a confusing client-side failure.
	 */
	// A function DECLARATION, not a const arrow: it is called while the `state`
	// object is built, which is above where the gateway helpers are defined, and a
	// const would be in its temporal dead zone at that point.
	function assertCapturedFaultsExist(faults: string[]): void {
		for (const fault of faults) {
			// The captured-body faults carry their key in the NAME (`503-<reason>`,
			// `gateway-<key>`), not after an `=`: only the timed faults (`sse-cut-after=6`)
			// use `=`.
			const name = (fault.split("=")[0] ?? "").trim();
			if (name.startsWith("503-")) {
				const value = name.slice("503-".length);
				// `gatewayReasons()` is the captured constants' own key list, so the
				// check cannot drift from the corpus.
				const reasons = fix.gatewayReasons();
				if (!reasons.includes(value)) {
					throw new Error(
						`unknown 503 reason: '${value}'. Known reasons: ${reasons.join(", ")}`,
					);
				}
				continue;
			}
			if (name.startsWith("gateway-")) {
				const value = name.slice("gateway-".length);
				if (GATEWAY_FAILURES[value] === undefined) {
					throw new Error(
						`unknown gateway failure body: '${value}'. Known keys: ${Object.keys(
							GATEWAY_FAILURES,
						)
							.sort()
							.join(", ")}`,
					);
				}
			}
		}
	}

	const gatewayBody = (key: string): Json => {
		const body = GATEWAY_FAILURES[key];
		if (body === undefined)
			throw new Error(`no such gateway failure body: ${key}`);
		return body.json;
	};

	const gatewayDetail = (reason: string): string => fix.gatewayDetail(reason);

	/**
	 * The gateway's own refusal for a scenario's or fault's failure key, or `null`
	 * when the key is not a refusal at all.
	 *
	 * ONE definition for three callers: the blanket refusal that fronts every route,
	 * the mid-session fault, and the `refused` stream mode that fails the session's
	 * event channel ALONE. A second spelling would let the same key answer different
	 * bodies depending on which path reached it, which is the divergence this file
	 * already has a note about (`503-` keys sharing a prefix across two spaces).
	 *
	 * `tag` is the label fragment the caller finishes the request with: the reason for
	 * a `<prefix>-<reason>` key, the key itself for a named body.
	 */
	const gatewayRefusalFor = (
		key: string,
	): {
		status: number;
		json: Json;
		headers?: Record<string, string>;
		tag: string;
	} | null => {
		const body = GATEWAY_FAILURES[key];
		if (body !== undefined) {
			return { status: body.status, json: body.json, tag: key };
		}
		if (!key.startsWith("503-")) return null;
		const reason = key.slice(4);
		const refusal = gatewayUnavailable(gatewayDetail(reason), reason);
		return {
			status: 503,
			json: refusal.json,
			headers: refusal.headers,
			tag: reason,
		};
	};

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
		/* Per-session overrides win over the blanket ones: `unseen` is a fact about
		 * ONE conversation, and the §1.4 equality cell needs a mix. */
		const perSession = world.rowOverridesById ?? {};
		const rows = Object.values(world.projections ?? {}).map((projection) => {
			const row = rowFrom(projection, overrides);
			const specific = perSession[projection.session_id];
			if (specific !== undefined) Object.assign(row, specific);
			return row;
		});
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
		const degraded = world.listOverrides?.degraded ?? [];
		const rows = rowsFor();
		/* The frame-level `unread` block (S1, ADR 0006 §1.1): `count` is computed
		 * from the SAME rows this frame carries, so the equality the daemon
		 * guarantees (count == unseen rows) cannot drift here either. `attention`
		 * in the listing's own `degraded` means the receipt store could not be
		 * read — and a store that could not be read is not an empty pile: `count`
		 * is ABSENT, never 0. */
		const attentionDegraded = degraded.includes("attention");
		const unread = {
			...(attentionDegraded
				? {}
				: { count: rows.filter((row) => row.unseen === true).length }),
			revision: [rows.length, state.seenTokens.size, 0] as [
				number,
				number,
				number,
			],
			degraded: attentionDegraded ? ["attention"] : [],
		};
		return {
			sessions: rows,
			degraded,
			/* The capability block rides BOTH transports off this one builder, so the
			 * REST read and the SSE frame cannot describe the mic differently — and the
			 * scenario's own `voice` override is applied here rather than to a copy of
			 * the frame, which is what lets `voice` advertise a path and
			 * `voice-absent` omit the key entirely. */
			capabilities: capabilityBlock(
				fix.list("sessions-empty").capabilities,
				world.voice,
			),
			unread,
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
		state.recorded.push(row);
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
			// The grant belongs to the world this stream was opened in. A pin re-arms the relay
			// for another scenario, and this stream's deadline must not latch a 401 onto a world
			// that never declared one — so a stale timer ends its own (now meaningless) stream
			// and stops there. See `state.generation`.
			const armedIn = state.generation;
			expireTimer = setTimeout(() => {
				if (state.generation !== armedIn) {
					cleanup();
					res.end();
					return;
				}
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

	/** A byte count as the relay's own sentence spells it (`10 MiB`, `64 KiB`). */
	const formatBytes = (bytes: number): string => {
		const mib = bytes / (1024 * 1024);
		if (mib >= 1) return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
		const kib = bytes / 1024;
		return `${Number.isInteger(kib) ? kib : kib.toFixed(1)} KiB`;
	};

	/* --------------------------------------------------------------- routing -- */

	/** Read the whole body as BYTES, refusing anything above the ceiling. */
	const readBodyBuffer = (req: IncomingMessage): Promise<Buffer> =>
		new Promise((resolvePromise, reject) => {
			const chunks: Buffer[] = [];
			let size = 0;
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				const bodyCeiling = state.faults.http.oversizeLimit ?? maxBodyBytes;
				if (bodyCeiling !== null && size > bodyCeiling) {
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
			req.on("end", () => resolvePromise(Buffer.concat(chunks)));
			req.on("error", reject);
		});

	/**
	 * The whole body as text — every route's read but the voice upload's.
	 *
	 * `/api/transcribe` reads BYTES (`readBodyBuffer`): its body is the recording
	 * itself, and a `utf8` round trip would both corrupt the part and lose the
	 * byte count the size cap is measured in. Every other route parses JSON or a
	 * form, where the string view is what the relay's own reader hands its parser.
	 */
	const readBody = async (req: IncomingMessage): Promise<string> =>
		(await readBodyBuffer(req)).toString("utf8");

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

		// The liveness check comes FIRST, and `contract.md` §4.3 is explicit that the
		// handler order is the contract: the real relay answers an unknown session
		// with `409 {"error":"session not connected"}` before it ever looks at the op.
		// The mock used to refuse the op first, so a client could read its 422 and
		// never see the 409 production sends.
		// The relay's order, and it differs by op: `prompt` checks liveness first, every
		// other op is VALIDATED first (`validate_control_frame` sits between the lookup and
		// the 409). A round-3 QA pass proved the difference live against an isolated
		// daemon: a malformed `approval_answer` or `steer` on an unknown session is `422`,
		// not `409`. An earlier revision of this block had liveness first for every op —
		// faithful for `prompt`, lenient for the rest.
		if (op !== "prompt") {
			const refusal = shapeRefusal(op, body);
			if (refusal !== null) {
				sendJson(res, refusal.status, refusal.body);
				return;
			}
		}
		if (!projectionFor(sessionId)) {
			sendFixture(res, "command-unknown-session");
			return;
		}

		// Ordering matters here and a review round caught it: the relay resolves the
		// SESSION before it looks at the op (`_entry_for_session` → `except KeyError:
		// 409`), so a live-but-unknown id is `409 session not connected` for every op.
		// With this block above the check, the mock answered
		// `200 {"ok":true,"detail":"no approval was pending"}` for the same request —
		// lenient exactly where the divergence table promises fidelity.
		// The approval round trip. Without this op the mock answered
		// `command-unknown-op`, so the pending card's approve/deny/settle path could not
		// be exercised against the mock at all — only in a stream's own rig.
		//
		// Validation is the contract's (§4.3): `request_id` a non-empty string,
		// `approved` a bool, `remember` a bool when present. The SUCCESS detail is the
		// runtime's own sentence passed through by the relay (`daemon.py:4041` returns
		// the runtime's reply), so this sentence is the mock's — the shape, not the
		// wording, is what the contract pins.
		if (op === "approval_answer") {
			// Shape was already refused above, for this op and every other non-`prompt` one:
			// one validation, one place, so the two orders cannot drift apart.
			const requestId = String(body.request_id);
			// Settling is what makes the round trip observable: the stream's next frame
			// carries the projection without the pending request, so a client that never
			// settles the card is caught by a later frame rather than by a poll.
			const live = world.projections?.[sessionId];
			const pending = live?.pending;
			if (live === undefined || pending === undefined || pending === null) {
				sendJson(res, 200, { ok: true, detail: "no approval was pending" });
				return;
			}
			if (pending.request_id !== requestId) {
				sendJson(res, 200, {
					ok: true,
					detail: "no approval was pending for that request id",
				});
				return;
			}
			// The web client also sends `question_index` for asks; the relay ignores
			// unknown fields, so they are ignored here rather than refused.
			live.pending = null;
			if ("pending_count" in live) live.pending_count = 0;
			state.approvalsAnswered += 1;
			sendJson(res, 200, { ok: true, detail: "approval recorded" });
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

		if (op === "prompt" || op === "steer") {
			if (!("command_id" in body)) {
				sendFixture(res, "command-missing-command-id");
				return;
			}
			if (!UUID_RE.test(String(body.command_id))) {
				sendFixture(res, "command-invalid-uuid");
				return;
			}
			// `prompt` reaches its text rule HERE (its liveness check comes first, so
			// `shapeRefusal` never sees it), and `steer` reaches it twice — once above for the
			// unknown-session order and once here for the live one. Same helper, same sentence.
			if (op === "prompt") {
				const textRefusal = textOrImageRefusal(body);
				if (textRefusal !== null) {
					sendJson(res, 422, errorBody(textRefusal));
					return;
				}
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

	/**
	 * `prompt`/`steer` text rule: `text` must be a non-empty string, and only then does a
	 * non-blank image rescue it (`types.py:208-424`, in that order — an image with a
	 * missing `text` key is refused, not accepted). The sentence is the pinned source's.
	 */
	function textOrImageRefusal(body: Record<string, unknown>): string | null {
		const text = body.text;
		// `isinstance(text, str)` comes FIRST in the relay: a body with images but no `text`
		// key is refused, and only a PRESENT-but-blank text can be rescued by an image. A
		// "text OR image" reading would accept the first case, which the relay does not.
		if (typeof text !== "string") return "text must be a non-empty string";
		if (text.trim() !== "") return null;
		const images = Array.isArray(body.images) ? body.images : [];
		const usable = images.some((image) => {
			const entry = (image ?? {}) as Record<string, unknown>;
			const data = entry.data_b64 ?? entry.data;
			return typeof data === "string" && data.trim() !== "";
		});
		return usable ? null : "text must be a non-empty string";
	}

	/**
	 * What the relay's frame validation refuses, for the op it is about.
	 *
	 * The contract makes the order part of the contract (`docs/relay/contract.md` §4.3,
	 * `types.validate_control_frame`): the frame is validated BETWEEN the session lookup
	 * and the `entry is None → 409`, so a MALFORMED non-`prompt` op on an unknown session
	 * is `422` and a well-formed one is `409`. `prompt` is the exception — liveness first,
	 * then admission — which is why this is asked only for the other ops. Checked against
	 * the pinned ref `fc851a94e`; QA verified the same order live against an isolated
	 * daemon at `d27e4716a`.
	 *
	 * This is a SUBSET of that chain, deliberately and by name: it covers `prompt`/`steer`
	 * (text-or-image, in the relay's order and with its sentence), `approval_answer`
	 * (`request_id`, `approved`, `remember`) and `ask_answer` (`request_id`, `value`).
	 * It does NOT replicate the checks for `cancel`'s `mode`, `slash`'s `command`/`args`,
	 * `recall_steer`'s `command_id`, `credential`, `variables`, `register_secret_redaction`,
	 * `adopt_aside`, `peer_message`/`peer_set_model`, `input_mode` membership or
	 * `input_path`'s length bound — for those ops a MALFORMED request on an unknown session
	 * is 409 here where the relay gives 422. That gap is recorded as D11 in
	 * `docs/e2e/README.md` rather than left implicit.
	 */
	function shapeRefusal(
		op: string,
		body: Record<string, unknown>,
	): { status: number; body: Record<string, unknown> } | null {
		// An UNKNOWN OP is not a shape refusal here: `validate_control_frame` is an if/elif
		// chain with no `else`, so an op it does not know passes validation and reaches the
		// liveness answer (409) — the `422 unknown op` comes later, from the registrant, and
		// only on a LIVE session (`daemon.py:3890-4015`: validation, then `entry is None` →
		// 409, then `daemon.request`). Putting an op allowlist here re-introduced, for this
		// one case, the inversion round 2 removed.
		if (op === "approval_answer" || op === "ask_answer") {
			const requestId = body.request_id;
			if (typeof requestId !== "string" || requestId.trim() === "") {
				return { status: 422, body: { error: "request_id is required" } };
			}
		}
		if (op === "approval_answer") {
			if (typeof body.approved !== "boolean") {
				// Verbatim from the captured `command-approval-bad-shape.json`.
				return { status: 422, body: { error: "approved must be a boolean" } };
			}
			if (body.remember !== undefined && typeof body.remember !== "boolean") {
				return { status: 422, body: { error: "remember must be a boolean" } };
			}
		}
		if (op === "ask_answer" && typeof body.value !== "string") {
			return { status: 422, body: { error: "value must be a string" } };
		}
		if (op === "steer") {
			// The relay's rule, in the relay's ORDER (`types.py:208-424`): `text` must be a
			// string first (`text must be a non-empty string`), and only then does a non-blank
			// image rescue it — an image with a missing `text` key is 422, not accepted. The
			// sentence is the pinned source's, not one this mock invented.
			const refusal = textOrImageRefusal(body);
			if (refusal !== null) return { status: 422, body: { error: refusal } };
		}
		return null;
	}

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
		let rawBytes: Buffer | undefined;
		try {
			if (mutation) {
				/* The voice upload is the ONE route whose body is not text: the `audio`
				 * part IS the recording, and decoding it through `utf8` would corrupt
				 * the bytes the mime and size checks read. */
				if (pathname === "/api/transcribe")
					rawBytes = await readBodyBuffer(req);
				else rawBody = await readBody(req);
			}
		} catch (error) {
			// The ceiling is signalled by a marker on the thrown error, so the marker
			// is read off the caught value rather than assumed present.
			const tooLarge = isRecord(error) && error.tooLarge === true;
			if (tooLarge) {
				// The captured gateway body names 10 MiB, which is the gateway's own
				// ceiling — correct when that ceiling is what fired, and a lie when a
				// test set a smaller one, so the sentence follows the limit in force.
				const limit = state.faults.http.oversizeLimit ?? maxBodyBytes;
				const body = gatewayBody("413-too-large");
				sendJson(
					res,
					413,
					isRecord(body) && typeof limit === "number"
						? { ...body, error: `request exceeds ${formatBytes(limit)}` }
						: body,
				);
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

		// A known path with the wrong method is a 405, checked BEFORE any handler
		// runs: doing it at the fall-through let `POST /logout` be answered by the
		// logout handler itself, so the relay's own refusal never happened.
		if (methodNotAllowed(pathname, method, res)) return;

		if (pathname === "/logout") {
			// The real relay answers this on GET only: `POST /logout` is a 405 with
			// `Allow: GET, HEAD` (contract §3.11 and the route table). The mock used
			// to accept the POST, which let a client ship a logout the relay refuses.
			//
			// `expires` is sent alongside `Max-Age=0`, as the relay does: some clients
			// read one and ignore the other, and the pair is what makes a cleared
			// cookie unambiguous.
			res.writeHead(303, {
				location: "/login",
				"set-cookie": `${COOKIE_NAME}=""; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=lax`,
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
			// The real relay parses this body as JSON and refuses an empty one with
			// `400 {"error":"invalid JSON"}`. The mock used to fabricate a start from an
			// empty body, which made it more lenient than the relay — a client that
			// sent nothing would look healthy here and fail in production.
			if (!isRecord(body)) {
				sendJson(res, 400, errorBody("invalid JSON"));
				return;
			}
			if (typeof body.cwd === "string" && body.cwd.startsWith("/etc")) {
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

		/* The push tap's handle → session id (S2, ADR 0006 §3.1/§6.7). The mapping
		 * is the corpus capture's own pair; a handle this mock cannot resolve is
		 * the daemon's clean 404 sentence, never a 500. */
		const pushMatch = /^\/api\/push\/conversation\/([^/]+)$/.exec(pathname);
		if (pushMatch && method === "GET") {
			const handle = decodeURIComponent(pushMatch[1] ?? "");
			const sessionId = defaultPushHandles.get(handle) ?? null;
			if (sessionId === null) {
				sendFixture(res, "push-conversation-unknown");
				return;
			}
			sendJson(res, 200, { session_id: sessionId });
			return;
		}

		/* The push device registry routes (ADR 0006 §3.1). Shapes and semantics
		 * from the core's `push_devices.py`; see the registry declaration's
		 * provenance note. */
		if (pathname === "/api/push/register" && method === "POST") {
			const record = isRecord(body) ? body : {};
			const platform = record.platform;
			const environment = record.environment;
			const token = record.token;
			const appVersion = record.app_version;
			const installId = record.install_id;
			if (
				(platform !== "ios" && platform !== "android") ||
				(environment !== "sandbox" && environment !== "production") ||
				typeof token !== "string" ||
				token === "" ||
				typeof appVersion !== "string" ||
				appVersion === "" ||
				typeof installId !== "string" ||
				installId === ""
			) {
				sendJson(res, 422, errorBody("invalid registration body"));
				return;
			}
			const existing = pushDevices.get(installId);
			/* A tombstoned row refuses before anything is written — the register
			 * route's own rule (a revoked device must not re-register itself). */
			if (existing?.revoked_at !== undefined) {
				sendJson(res, 403, {
					code: "device_revoked",
					error: "this device was revoked on this computer",
				});
				return;
			}
			const now = Date.now();
			const row = existing ?? {
				device_id: `dev-${(++pushDeviceSeq).toString(16).padStart(4, "0")}`,
				platform,
				app_version: appVersion,
				registered_at: now,
				last_seen_at: now,
			};
			row.platform = platform;
			row.app_version = appVersion;
			row.last_seen_at = now;
			pushDevices.set(installId, row);
			/* `device_key` is minted per accepted register and returned in this
			 * response only (the real route rotates it the same way). */
			sendJson(res, 200, {
				ok: true,
				device_id: row.device_id,
				device_key: `devkey-${(pushDeviceSeq * 2654435761).toString(16)}`,
				registered_at: row.registered_at,
			});
			return;
		}

		if (pathname === "/api/push/devices" && method === "GET") {
			const devices = [...pushDevices.values()].map((row) => ({
				device_id: row.device_id,
				platform: row.platform,
				app_version: row.app_version,
				registered_at: row.registered_at,
				last_seen_at: row.last_seen_at,
				state: row.revoked_at === undefined ? "live" : "revoked",
			}));
			sendJson(res, 200, {
				devices,
				/* The core's own precedence string, rendered there from the table
				 * the state resolver walks (`push_devices.PRECEDENCE`). */
				precedence: "revoked > unpaired > expired",
			});
			return;
		}

		const pushDelete = /^\/api\/push\/devices\/([^/]+)$/.exec(pathname);
		if (pushDelete && method === "DELETE") {
			const deviceId = decodeURIComponent(pushDelete[1] ?? "");
			for (const row of pushDevices.values()) {
				if (row.device_id === deviceId && row.revoked_at === undefined) {
					row.revoked_at = Date.now();
				}
			}
			/* Idempotent in both directions: an id the registry does not hold is
			 * still `{"ok": true}` — the app retries this on sign-out. */
			sendJson(res, 200, { ok: true });
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
			/* The contract's whole table, in the daemon's own order. `transcribe.ts`
			 * owns the mapping, so this route is only the wire: read the declared
			 * length, the bytes and the media type off the request, hand them the
			 * ONE availability read the pinned world advertises, and serve the
			 * captured fixture when the answer has one (the corpus is the source of
			 * a sentence) or the built body otherwise. */
			const result = transcribeResponse({
				declaredLength: declaredLengthOf(req.headers["content-length"]),
				body: rawBytes ?? Buffer.alloc(0),
				contentType: String(req.headers["content-type"] ?? ""),
				available: world.voice?.capability?.available === true,
				answer: world.voice?.answer,
			});
			if (result.fixture !== undefined) sendFixture(res, result.fixture);
			else sendJson(res, result.status, result.body);
			return;
		}

		/* --------------------------------------------------- api: session-scoped -- */

		const sessionMatch = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(pathname);
		if (sessionMatch) {
			const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
			const rest = sessionMatch[2] ?? "";
			const projection = projectionFor(sessionId);

			if (rest === "/events" && method === "GET") {
				const stream: StreamSpec = world.stream ?? { mode: "idle" };
				if (stream.mode === "refused") {
					/* The session's OWN channel fails while the catalogue and the health
					 * route answer: the client holds a projection and its stream is refused,
					 * which is the only shape the session view's error state is reached from
					 * (`S5/error`). A blanket `failure` refuses `/api/sessions` too, so no
					 * projection ever arrives and `session-error` is not rendered however
					 * true the failure is — measured, and the reason this mode exists. */
					const key = stream.refusalKey ?? "[redacted]";
					const refusal = gatewayRefusalFor(key);
					if (refusal === null)
						throw new Error(`no such gateway refusal: ${key}`);
					if (state.record) {
						recordRequest({
							method,
							path: pathname + (url.search || ""),
							status: refusal.status,
							note: `stream:gateway:${refusal.tag}`,
						});
					}
					return sendJson(res, refusal.status, refusal.json, refusal.headers);
				}
				if (!projection) {
					// The real relay does NOT refuse an unknown session here: it opens a
					// 200 event stream that stays open and sends no frame (measured on a
					// live relay: 12 s, zero frames, no terminator). A client written
					// against a 404 would special-case the mock and hang in production,
					// so the refusal the mock used to invent is gone.
					// An empty frame SOURCE, not an empty array: `frames` is the pump's
					// callback, and passing the wrong shape here crashed the relay the
					// moment a client opened this stream.
					return openStream(req, res, {
						kind: "projection",
						seed: null,
						frames: () => null,
					});
				}
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
				// The session is resolved FIRST, as the real relay does: an unknown
				// session is `404 unknown session` even with the parameter missing, and
				// the mock's opposite order answered `400 entry id is required`.
				//
				// "Resolved" here means the session is one this world can serve at all —
				// a live projection, or the session the fixture corpus captured an image
				// for. A live projection alone was too narrow: the captured triple is
				// served from the corpus, so requiring a projection turned the corpus's
				// own image into a 404 that no client would ever see.
				const imageSessionKnown =
					projection !== undefined || sessionId === capturedImage?.sessionId;
				if (!imageSessionKnown) {
					sendJson(res, 404, errorBody("unknown session"));
					return;
				}
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
				const posted = String(body.completion_token);
				/* A REAL token a newer completion replaced is refused `409` with the
				 * machine code; the app's remedy is to re-read the projection and try
				 * the token it now names (contract §4.6, ADR Q11). The mock refuses
				 * exactly the discrimination the app exercises: token ≠ the session's
				 * CURRENT one. (The success capture is the corpus's own response for
				 * session 6714def86197's token — replayed verbatim, like every other
				 * route here.) */
				const current = projection.attention?.completion_token ?? null;
				if (
					typeof current === "string" &&
					current.length > 0 &&
					posted !== current
				) {
					sendFixture(res, "seen-superseded");
					return;
				}
				state.seenTokens.add(posted);
				/* The receipt landed: the daemon invalidates its cache and wakes the
				 * list so the next paint already shows the cleared mark. The mock
				 * mutates its copy of the projection the same way — a later
				 * `GET /api/sessions` (and the next list frame) carries `unseen: false`
				 * and a decremented count. The per-session row override is the second
				 * place a scenario can keep the SAME fact (a mixed unread/read list
				 * cannot be said with the blanket overrides), and the wake clears it
				 * where it is, so the repaint means one thing. */
				if (projection.attention) projection.attention.unseen = false;
				const rowFact = state.world.rowOverridesById?.[sessionId];
				if (rowFact !== undefined) rowFact.unseen = false;
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

		// A route the relay does not have: the real relay answers `404 text/plain
		// "Not Found"`, not JSON. A client that parsed `{error}` off this path works
		// against the mock and gets plain text in production, which is a divergence
		// that can only hide a bug.
		sendText(res, 404, "Not Found", {
			"content-type": "text/plain; charset=utf-8",
		});
		return;
	};

	/**
	 * The methods each route answers, so a wrong one is a 405 rather than a 404.
	 *
	 * The real relay emits `405 text/plain "Method Not Allowed"` with an `Allow`
	 * header (measured: `GET /command`, `DELETE /api/sessions`, `POST /logout`),
	 * and the mock previously never produced a 405 at all — so a client that
	 * mishandled a method mistmatch could not be caught here.
	 */
	const ALLOWED_METHODS: Array<{ match: RegExp; methods: string[] }> = [
		// Session sub-routes first: `/command` is a POST-only path, so a GET on it
		// is a 405 and not the generic 404 a coarser table produced.
		{ match: /^\/api\/sessions\/[^/]+\/command$/, methods: ["POST"] },
		{ match: /^\/api\/sessions\/(start|resume)$/, methods: ["POST"] },
		{
			match: /^\/api\/sessions\/[^/]+\/(events|image|history)$/,
			methods: ["GET", "HEAD"],
		},
		{
			match: /^\/api\/sessions\/[^/]+\/(pin|seen|transcribe|pair)$/,
			methods: ["POST"],
		},
		{
			match: /^\/api\/sessions\/[^/]+\/operator\/challenge$/,
			methods: ["POST"],
		},
		{ match: /^\/api\/sessions\/[^/]+$/, methods: ["GET", "HEAD"] },
		{ match: /^\/api\/sessions$/, methods: ["GET", "HEAD"] },
		{ match: /^\/api\/commands$/, methods: ["GET", "HEAD"] },
		{ match: /^\/api\/directories$/, methods: ["GET", "HEAD"] },
		{ match: /^\/api\/models$/, methods: ["GET", "HEAD"] },
		{ match: /^\/api\/projects$/, methods: ["GET", "HEAD"] },
		{ match: /^\/api\/pair$/, methods: ["POST"] },
		{ match: /^\/healthz$/, methods: ["GET", "HEAD"] },
		{ match: /^\/login$/, methods: ["GET", "POST"] },
		{ match: /^\/logout$/, methods: ["GET", "HEAD"] },
		{ match: /^\/mark\.png$/, methods: ["GET", "HEAD"] },
		{ match: /^\/$/, methods: ["GET", "HEAD"] },
		{ match: /^\/assets\/.+$/, methods: ["GET", "HEAD"] },
	];

	/** `405` with the relay's own text and `Allow` header, or null to continue. */
	const methodNotAllowed = (
		pathname: string,
		method: string,
		res: ServerResponse,
	): boolean => {
		if (method === "HEAD") return false;
		const route = ALLOWED_METHODS.find((entry) => entry.match.test(pathname));
		if (route === undefined || route.methods.includes(method)) return false;
		sendText(res, 405, "Method Not Allowed", {
			"content-type": "text/plain; charset=utf-8",
			allow: route.methods.join(", "),
		});
		return true;
	};

	/* ------------------------------------------------------------ the server -- */

	const server = createServer(async (req, res) => {
		if (!(req.url ?? "/").startsWith("/__mock")) state.requestsServed += 1;
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
						// `requests` is traffic served; `recorded` is the transcript's own
						// length, named so the two can never be confused again.
						requests: state.requestsServed,
						recorded: state.recorded.length,
						approvalsAnswered: state.approvalsAnswered,
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
					sendJson(res, 200, { requests: state.recorded });
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
					const names: string[] = JSON.parse(raw || "{}").faults ?? [];
					/* A control-surface set REPLACES the invocation's own, and then behaves like
					 * it: it is the baseline a scenario's faults are added to, so it survives a
					 * pin for the same reason `--fault` does. Setting `state.faults` alone (the
					 * old shape) would have been undone by the very next scenario switch. */
					state.baseFaults = names;
					state.faults = parseFaults([...names, ...(state.world.faults ?? [])]);
					sendJson(res, 200, { faults: state.faults.applied });
					return;
				}
				if (pathname === "/__mock/reset" && method === "POST") {
					state.recorded = [];
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
				// The key space is shared (`503-<RELAY_DETAIL reason>` is the refusal while
				// `503-relay-not-installed` is a gateway body), and `gatewayRefusalFor`
				// holds that ordering once for every caller.
				const refusal = gatewayRefusalFor(key);
				if (refusal === null)
					throw new Error(`no such gateway failure: ${key}`);
				finish(refusal.status, `gateway:${refusal.tag}`);
				sendJson(res, refusal.status, refusal.json, refusal.headers);
				return;
			}

			// A mid-session gateway refusal, from `--fault 503-<reason>`.
			if (state.faults.http.refuseWith) {
				const key = state.faults.http.refuseWith;
				// Same definition as the scenario path above.
				const refusal = gatewayRefusalFor(key);
				if (refusal === null)
					throw new Error(`no such gateway failure: ${key}`);
				finish(refusal.status, `fault:gateway:${refusal.tag}`);
				sendJson(res, refusal.status, refusal.json, refusal.headers);
				return;
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
					requests: state.recorded,
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
			// The relay's OWN origin is same-origin by the contract's own rule
			// (`docs/relay/contract.md` §1.2) — "a foreign Origin is refused; a
			// same-origin Origin is allowed" — and the mock has to know it to apply
			// that rule honestly. `--port 0` picks the port here and nowhere else, so
			// this is the only place it is knowable. Without it the allowlist is empty
			// for every CLI-started relay, and the harness's own proxied page — served
			// at a loopback origin, forwarded to the relay at a different one — is
			// refused on every mutation and on `POST /login`, so the app never
			// authenticates and a relay-backed cell renders the degraded screen.
			// Loopback aliases are included because the mock binds loopback only, and
			// a foreign (non-loopback) origin still has no way in.
			const ownHosts = new Set(
				[host, "127.0.0.1", "localhost"].filter(
					(candidate) => candidate !== "0.0.0.0" && candidate !== "::",
				),
			);
			state.allowedOrigins = [
				...(state.allowedOrigins ?? []),
				...[...ownHosts].map((own) => `http://${own}:${actual}`),
			];
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

// `import.meta.main` (Node 24+), not the basename heuristic this file used to use:
// `import.meta.url.endsWith(process.argv[1]?.split("/").pop() ?? "")` is TRUE for
// ANY url when `process.argv[1]` is absent — every string ends with "" — and `node
// -e` leaves it absent. So the documented way to read the relay's password,
//
//   PW=$(node -e "import('./tools/mock-relay/relay.ts').then(m => m.DEFAULT_PASSWORD)")
//
// did print the password and then STARTED A LISTENING RELAY, keeping the event loop
// alive forever: the command substitution never completed and the capture sat on it.
// Importing a module must have no side effects; only the entry point runs the CLI.
if (import.meta.main) {
	const { flags } = parseArgs(process.argv.slice(2));
	if (bool(flags, "help")) {
		console.log(
			[
				"usage: node tools/mock-relay/relay.ts [options]",
				"",
				"  --port <n>            listen port (default 0: the OS picks; never 4098)",
				"  --host <addr>         bind address (default 127.0.0.1)",
				"  --scenario <name>     initial scenario (default idle) — see --list",
				"  --fault <name>        inject a fault; repeatable",
				"  --record <dir>        write a request/response transcript on shutdown",
				"  --fixtures <dir>      fixture corpus root (default <repo>/fixtures/relay)",
				"  --password <value>    relay password for the login form",
				"  --max-body-bytes <n>  override the gateway's 10 MiB ceiling, for 413 tests",
				"  --allow-origin <o>    also allow this Origin on mutations; repeatable. The",
				"                        relay's own origin is always allowed once listening.",
				"  --print-port          print the chosen port alone on stdout",
				"  --print-password      print the relay password alone on stdout and exit",
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

	// A supported way to read the password, which is what the docs needed and did
	// not have: the only alternative anyone reached for was importing the module
	// from `node -e`, which used to start a relay and never return (see the note
	// on `import.meta.main` above). Nothing here holds the loop open: it exits.
	if (bool(flags, "print-password")) {
		process.stdout.write(`${DEFAULT_PASSWORD}\n`);
		process.exit(0);
	}

	const recordDir = str(flags, "record", undefined);
	const relay = createRelay({
		fixturesDir,
		scenario: str(flags, "scenario", "idle"),
		faults: list(flags, "fault"),
		password: str(flags, "password", DEFAULT_PASSWORD) ?? DEFAULT_PASSWORD,
		// 0 means "no ceiling on this process", which is the bare relay's real
		// behaviour; the gateway's cap is modelled by the `413-oversize` fault.
		maxBodyBytes: num(flags, "max-body-bytes", 0),
		allowedOrigins: list(flags, "allow-origin"),
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
