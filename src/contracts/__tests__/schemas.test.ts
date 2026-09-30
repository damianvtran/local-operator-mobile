// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The schemas against the real wire.
 *
 * Two halves, and both matter:
 *
 * 1. **Every committed fixture must parse.** The fixtures in `fixtures/relay/`
 *    were captured from a live isolated relay (or built from the dataclasses and
 *    cross-checked against the web client's own fixtures), so they are the only
 *    evidence in this repository that the client's reading of the wire matches
 *    the wire. The test walks the whole fixture tree and *fails* on any file it
 *    has not classified — a new fixture cannot slip through unvalidated by being
 *    forgotten, which is how a schema quietly stops covering a route.
 * 2. **Deliberately malformed frames must be REJECTED, not coerced.** An unknown
 *    enum, a string where a number belongs, a missing required field, and a
 *    `null` that a careless schema would turn into `0`. This is the half that
 *    keeps a wrong number off a card; a schema that coerces is worse than no
 *    schema, because the screen looks confident.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	completionAttentionSchema,
	gatewayRefusalReasonSchema,
	gatewayRefusalSchema,
	parseJsonPayload,
	parsePayload,
	RelayFrameError,
	type SchemaName,
	safeParsePayload,
} from "../index";

const FIXTURE_ROOT = fileURLToPath(
	new URL("../../../fixtures/relay", import.meta.url),
);

function listJsonFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listJsonFiles(full));
		/* Only `.json`: the corpus also holds a README and the raw `: keepalive`
		 * bytes, and neither is a JSON payload. `sse-keepalive.txt` is exercised by
		 * the SSE framer test, which is the only thing that can read it correctly. */ else if (
			entry.isFile() &&
			entry.name.endsWith(".json") &&
			statSync(full).isFile()
		)
			out.push(full);
	}
	return out;
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** A fixture is either validated against a named schema or explicitly excluded
 *  with the reason it is not a JSON payload this stream reads. */
type Classification =
	| { kind: "schema"; schema: SchemaName; value: unknown }
	| { kind: "schema-list"; schema: SchemaName; values: unknown[] }
	| { kind: "skip"; reason: string };

const HTTP_STATUS_OK = 200;

/** `{request, status, headers, body}` is the shape of an http fixture; a few
 *  were captured as raw curl output and carry the body as JSON-in-a-string with
 *  no status, which is normalised here rather than worked around per file. */
interface HttpFixture {
	request?: { method?: string; path?: string };
	status?: number;
	headers?: Record<string, string>;
	body?: unknown;
}

function normaliseHttpBody(fixture: HttpFixture): unknown {
	const body = fixture.body;
	if (typeof body !== "string") return body;
	const trimmed = body.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return body;
	}
}

function hasErrorKey(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		!("ok" in value)
	);
}

function classifyHttp(rel: string, fixture: HttpFixture): Classification {
	const path = fixture.request?.path ?? "";
	const body = normaliseHttpBody(fixture);
	const status = fixture.status;

	/* --- Not JSON payloads: excluded with the reason, never silently. --- */
	if (rel === "http/login-wrong-password.json") {
		return {
			kind: "skip",
			reason:
				"a wrong password answers 401 HTML, not JSON; the http layer's status mapping is tested in relay/http.test.ts",
		};
	}
	if (rel === "http/login-success.json" || rel === "http/logout.json") {
		return {
			kind: "skip",
			reason:
				"a 303 with an empty body and Set-Cookie; the cookie policy is tested in relay/http.test.ts",
		};
	}
	if (
		rel === "http/mark-png.json" ||
		rel === "http/unauth-index.json" ||
		rel === "http/index-authed-no-dist.json"
	) {
		return {
			kind: "skip",
			reason:
				"a native client never calls the browser routes; body is a mark or the SPA shell",
		};
	}
	if (path.includes("/image?") && status === HTTP_STATUS_OK) {
		return {
			kind: "skip",
			reason:
				"raw image bytes, not JSON; the placeholder string records the byte count",
		};
	}

	/* --- Out of this stream's slice, listed so the omission is visible. --- */
	if (path.startsWith("/api/pair")) {
		return {
			kind: "skip",
			reason: "device pairing is a later stream; no schema in this slice",
		};
	}
	if (path.startsWith("/api/projects")) {
		return {
			kind: "skip",
			reason: "project routes are not in this stream's endpoint list",
		};
	}
	if (path.startsWith("/api/transcribe")) {
		return {
			kind: "skip",
			reason: "voice input is a later stream; no schema in this slice",
		};
	}
	if (path.includes("/operator/challenge")) {
		return {
			kind: "skip",
			reason:
				"the signing flow needs the operator key; no schema in this slice",
		};
	}

	/* --- Every failure body on a route this stream reads is the API error. ---
	 * Keyed on the body's shape rather than the status, because a few fixtures were
	 * captured as raw output and carry no status — and because "which schema reads
	 * this" is answerable from the body in both cases. */
	if (hasErrorKey(body)) {
		return { kind: "schema", schema: "apiError", value: body };
	}
	if (status !== undefined && status >= 400) {
		throw new Error(
			`${rel}: a ${status} body that is not an API error — classify it explicitly`,
		);
	}

	const route = path.split("?")[0] ?? "";
	const idThen = (suffix: string) => route.endsWith(suffix);

	if (route === "/healthz")
		return { kind: "schema", schema: "healthz", value: body };
	if (route === "/api/sessions")
		return { kind: "schema", schema: "sessionListFrame", value: body };
	if (route === "/api/sessions/past")
		return { kind: "schema", schema: "pastSessions", value: body };
	if (route === "/api/sessions/search")
		return { kind: "schema", schema: "searchSessions", value: body };
	if (route === "/api/sessions/start")
		return { kind: "schema", schema: "startSession", value: body };
	if (route === "/api/sessions/resume")
		return { kind: "schema", schema: "resumeSession", value: body };
	if (route === "/api/commands")
		return { kind: "schema", schema: "commands", value: body };
	if (route === "/api/models")
		return { kind: "schema", schema: "models", value: body };
	if (route === "/api/directories")
		return { kind: "schema", schema: "directories", value: body };
	if (idThen("/history"))
		return { kind: "schema", schema: "history", value: body };
	if (idThen("/command"))
		return { kind: "schema", schema: "commandAck", value: body };
	if (idThen("/seen")) return { kind: "schema", schema: "seen", value: body };
	if (idThen("/pin")) return { kind: "schema", schema: "pin", value: body };
	if (/\/api\/sessions\/[^/]+\/agents\/[^/]+$/.test(route)) {
		return { kind: "schema", schema: "subagentDetail", value: body };
	}

	throw new Error(
		`${rel}: unclassified http fixture (${fixture.request?.method ?? "?"} ${path} -> ${String(status)}). ` +
			"Add it to classifyHttp with a schema or an explicit skip reason.",
	);
}

function classifyFixture(rel: string, value: unknown): Classification {
	if (rel.startsWith("http/")) return classifyHttp(rel, value as HttpFixture);

	if (rel.startsWith("sse/") || rel.startsWith("synthetic/")) {
		const frame = value as { event?: string; data?: unknown };
		if (frame.event === "sessions") {
			return { kind: "schema", schema: "sessionsStreamFrame", value: frame };
		}
		if (frame.event === "projection") {
			return { kind: "schema", schema: "projectionStreamFrame", value: frame };
		}
		if (rel === "sse/sse-attention-complete.json") {
			// The attention record has no `event` of its own; it is only ever read as
			// a field of a projection frame. Validated directly above instead.
			return {
				kind: "skip",
				reason:
					"the attention record is a field of a projection, not a payload of its own",
			};
		}
		if (rel === "synthetic/models.ranked.json") {
			return {
				kind: "schema-list",
				schema: "modelEntry",
				values: value as unknown[],
			};
		}
	}

	if (rel === "gateway/gateway-refusal-constants.json") {
		return {
			kind: "skip",
			reason:
				"module constants, not a payload; asserted by the gateway-copy test below",
		};
	}
	if (rel === "probes/wedged-row-signal.json") {
		return {
			kind: "skip",
			reason: "a probe record (samples over time), not a payload frame",
		};
	}

	throw new Error(
		`${rel}: unclassified fixture. Add it to classifyFixture with a schema or an explicit skip reason.`,
	);
}

describe("the fixture corpus is fully classified", () => {
	const files = listJsonFiles(FIXTURE_ROOT).map((path) =>
		relative(FIXTURE_ROOT, path),
	);
	const classified = files.map((rel) => ({
		rel,
		result: classifyFixture(rel, readJson(join(FIXTURE_ROOT, rel))),
	}));

	it("classifies every committed fixture exactly once", () => {
		// The failure mode this guards is a fixture added later being ignored by
		// being unlisted: `classifyFixture` throws on an unclassified file, so the
		// construction of `classified` above is itself the assertion.
		expect(classified).toHaveLength(files.length);
		expect(files.length).toBeGreaterThan(60);
	});

	const validated = classified.filter((entry) => entry.result.kind !== "skip");
	const skipped = classified.filter((entry) => entry.result.kind === "skip");

	it("validates the fixtures this stream reads", () => {
		expect(validated.length).toBeGreaterThan(50);
	});

	it.each(validated.map((entry) => [entry.rel, entry] as const))(
		"%s parses",
		(rel, entry) => {
			expect(entry.result.kind).not.toBe("skip");
			const result = entry.result;
			if (result.kind === "schema-list") {
				expect(Array.isArray(result.values)).toBe(true);
				for (const item of result.values) {
					const parsed = safeParsePayload(result.schema, item);
					expect(parsed.ok, `${rel} element rejected`).toBe(true);
				}
				return;
			}
			if (result.kind !== "schema")
				throw new Error(`${rel}: not a schema classification`);
			const parsed = safeParsePayload(result.schema, result.value);
			if (!parsed.ok) {
				throw new Error(
					`${rel}: rejected by ${result.schema} — ${parsed.error.issues.map((i) => `${i.path}:${i.code}`).join(", ")}`,
				);
			}
			expect(parsed.ok).toBe(true);
		},
	);

	it("reports what it skipped, with a reason for each", () => {
		for (const entry of skipped) {
			const result = entry.result;
			if (result.kind !== "skip" || result.reason.trim().length === 0) {
				throw new Error(`${entry.rel}: every skip needs a reason`);
			}
		}
	});
});

describe("payloads the fixtures cannot reach", () => {
	it("parses the attention record on its own", () => {
		const attention = readJson(
			join(FIXTURE_ROOT, "sse/sse-attention-complete.json"),
		);
		const parsed = completionAttentionSchema.safeParse(attention);
		expect(parsed.success).toBe(true);
	});

	it("keeps every gateway reason the constants file names inside the enum", () => {
		const constants = readJson(
			join(FIXTURE_ROOT, "gateway/gateway-refusal-constants.json"),
		) as {
			relay_detail: Record<string, string>;
		};
		const reasons = Object.keys(constants.relay_detail);
		expect(reasons.length).toBeGreaterThan(0);
		for (const reason of reasons) {
			expect(gatewayRefusalReasonSchema.safeParse(reason).success, reason).toBe(
				true,
			);
		}
	});

	it("accepts a gateway refusal whose reason is one a future gateway added", () => {
		// The contract says: switch on `reason`, fall back to `detail`. A reason the
		// enum does not know must therefore still PARSE rather than blank the screen.
		const parsed = gatewayRefusalSchema.safeParse({
			detail: "Something new happened.",
			reason: "a_reason_invented_after_this_build",
			error: "tunnel authorization unavailable",
		});
		expect(parsed.success).toBe(true);
	});
});

/* ------------------------------------------------------------------ malformed */

const VALID_PROJECTION = (() => {
	const frame = readJson(
		join(FIXTURE_ROOT, "sse/sse-projection-live-idle.json"),
	) as { data: unknown };
	return frame.data as Record<string, unknown>;
})();

function projectionWith(overrides: Record<string, unknown>): unknown {
	return { ...VALID_PROJECTION, ...overrides };
}

describe("malformed frames are rejected, never coerced", () => {
	const cases: [string, SchemaName, unknown][] = [
		[
			"a projection missing its session id",
			"sessionProjection",
			projectionWith({ session_id: undefined }),
		],
		[
			"a blank session id",
			"sessionProjection",
			projectionWith({ session_id: "" }),
		],
		[
			'streaming as the string "true"',
			"sessionProjection",
			projectionWith({ streaming: "true" }),
		],
		["pid as a string", "sessionProjection", projectionWith({ pid: "17" })],
		[
			"activity_started_s as a string",
			"sessionProjection",
			projectionWith({ activity_started_s: "5" }),
		],
		[
			"transcript as an object",
			"sessionProjection",
			projectionWith({ transcript: {} }),
		],
		[
			"a tool row with an unknown tool_state",
			"sessionProjection",
			projectionWith({
				transcript: [
					{
						...(VALID_PROJECTION.transcript as Record<string, unknown>[])[0],
						tool_state: "finished",
					},
				],
			}),
		],
		[
			"an attention revision that is not a pair",
			"sessionProjection",
			projectionWith({
				attention: {
					conversation_id: "session/x",
					completion_token: null,
					anchor_id: null,
					kind: null,
					unseen: false,
					revision: [1],
				},
			}),
		],
		[
			"an attention kind outside the vocabulary",
			"sessionProjection",
			projectionWith({
				attention: {
					conversation_id: "session/x",
					completion_token: null,
					anchor_id: null,
					kind: "exploded",
					unseen: false,
					revision: [1, 2],
				},
			}),
		],
		[
			"a pending request of an unknown kind",
			"sessionProjection",
			projectionWith({
				pending: {
					request_id: "r1",
					kind: "confirm",
					title: "t",
					detail: "d",
					options: [],
					secret: false,
					question_index: 0,
					question_total: 1,
					recommended: null,
					persist: false,
				},
			}),
		],
		[
			"a todo item with an unknown status",
			"sessionProjection",
			projectionWith({
				todos: [
					{
						name: "Todos",
						items: [{ text: "x", status: "cancelled", reason: "" }],
					},
				],
			}),
		],
		[
			"an image ref whose index is a string",
			"sessionProjection",
			projectionWith({
				transcript: [
					{
						...(VALID_PROJECTION.transcript as Record<string, unknown>[])[0],
						images: [{ index: "0", mime_type: "image/png" }],
					},
				],
			}),
		],
		[
			"a section outside active|previous",
			"sessionListFrame",
			{
				sessions: [
					{
						session_id: "abc",
						section: "archived",
						conversation_name: "",
						cwd: "",
						model_label: "",
						streaming: false,
						needs_attention: false,
						unseen: false,
						pending_kind: "",
						leaving: "",
						updating: "",
						subagents_running: null,
						subagents_queued: null,
						todos_open: 0,
						mtime: 1,
					},
				],
				degraded: [],
				capabilities: {},
			},
		],
		[
			"a list frame whose sessions is an object",
			"sessionListFrame",
			{
				sessions: {},
				degraded: [],
				capabilities: {},
			},
		],
		[
			"a list frame missing degraded",
			"sessionListFrame",
			{ sessions: [], capabilities: {} },
		],
		["an error body with no error field", "apiError", { code: "something" }],
		["an ack that is not ok", "commandAck", { ok: false, detail: "" }],
		["an ack with no detail", "commandAck", { ok: true }],
		[
			"a history page whose has_more is a string",
			"history",
			{ entries: [], has_more: "true" },
		],
		[
			"a models entry with no selector",
			"models",
			{ models: [{ provider: "p", model_id: "m", name: "n" }] },
		],
		[
			"directories whose recent is a string",
			"directories",
			{ home: "~", recent: "~/work" },
		],
		[
			"a healthz whose version is a string",
			"healthz",
			{ ok: true, version: "5", sessions: 0, dist: false },
		],
		["a pin response whose pinned is 1", "pin", { ok: true, pinned: 1 }],
		[
			"a projection frame carrying the sessions event name",
			"projectionStreamFrame",
			readJson(join(FIXTURE_ROOT, "sse/sse-list-frame.json")),
		],
		[
			"a sessions frame carrying projection data",
			"sessionsStreamFrame",
			readJson(join(FIXTURE_ROOT, "sse/sse-projection-live-idle.json")),
		],
	];

	it.each(cases)("rejects %s", (_label, schema, value) => {
		const result = safeParsePayload(schema, value);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBeInstanceOf(RelayFrameError);
		expect(result.error.payload).toBe(schema);
		expect(result.error.issues.length).toBeGreaterThan(0);
		// The summary is loggable and carries no payload content.
		expect(result.error.summary).toContain(schema);
	});
});

describe("absence and null carry the contract's meaning", () => {
	it("keeps a null nullable number null instead of turning it into zero", () => {
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({ activity_started_s: null, subagent_cost: null }),
		);
		expect(parsed.activity_started_s).toBeNull();
		expect(parsed.subagent_cost).toBeNull();
	});

	it("keeps zero as a known zero, distinct from null", () => {
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({ activity_started_s: 0 }),
		);
		expect(parsed.activity_started_s).toBe(0);
	});

	it("defaults an absent pin to the state that cannot reorder a row", () => {
		const summary = (
			readJson(join(FIXTURE_ROOT, "http/sessions-empty.json")) as {
				body: { sessions: unknown[] };
			}
		).body;
		const frame = parsePayload("sessionListFrame", {
			sessions: [
				{
					session_id: "abc",
					section: "active",
					conversation_name: "",
					cwd: "",
					model_label: "",
					streaming: false,
					needs_attention: false,
					unseen: false,
					pending_kind: "",
					leaving: "",
					updating: "",
					subagents_running: null,
					subagents_queued: null,
					todos_open: 0,
					mtime: 1,
				},
			],
			degraded: [],
			capabilities: {},
		});
		expect(frame.sessions[0]?.pinned).toBe(false);
		expect(frame.sessions[0]?.created_at).toBeUndefined();
		expect(summary).toBeDefined();
	});

	it("reads an absent stt capability as unavailable rather than as an error", () => {
		const frame = parsePayload("sessionListFrame", {
			sessions: [],
			degraded: [],
			capabilities: { features: { auth: 1 } },
		});
		expect(frame.capabilities.stt?.available).toBe(false);
	});

	it("preserves fields a newer relay added", () => {
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({ a_field_from_the_future: { nested: true } }),
		);
		expect((parsed as Record<string, unknown>).a_field_from_the_future).toEqual(
			{ nested: true },
		);
	});

	it("keeps an entry kind this build does not know, so a newer row still renders", () => {
		const entry =
			(VALID_PROJECTION.transcript as Record<string, unknown>[])[0] ?? {};
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({
				transcript: [{ ...entry, kind: "a_kind_invented_later" }],
			}),
		);
		expect(parsed.transcript[0]?.kind).toBe("a_kind_invented_later");
	});
});

/* ------------------------------------------------------------------ receipts */

/**
 * The session-health receipts (local-operator PR #1784).
 *
 * The rule the wire change asks a client to honour is asymmetric: a row that
 * CARRIES a receipt must be believed, and a row that carries NONE must still be a
 * real session. The second half is the one that breaks a naive schema — a
 * `.default(false)` or a required boolean turns every durable-only row either into
 * an error or into a session the app claims it watched die.
 */
describe("the session-health receipts are optional and never invent a state", () => {
	const durableOnlyRow = {
		session_id: "6714def86197",
		section: "previous",
		conversation_name: "A conversation from before this boot",
		cwd: "~/work",
		model_label: "test/mock",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: null,
		subagents_queued: null,
		todos_open: 0,
		mtime: 1_790_727_370.33,
	};

	it("parses a durable-only row that carries NO receipt, as an ordinary session", () => {
		const frame = parsePayload("sessionListFrame", {
			sessions: [durableOnlyRow],
			degraded: [],
			capabilities: {},
		});
		const row = frame.sessions[0];
		expect(row?.session_id).toBe("6714def86197");
		/* Absent must stay absent — not `false` — so "the relay did not observe this
		 * conversation end" remains distinguishable from "it told us it ended". */
		expect(row?.ended).toBeUndefined();
		expect(row?.degraded).toBeUndefined();
		expect(row?.completion_kind).toBe("");
	});

	it("believes a receipt when the relay sends one", () => {
		const frame = parsePayload("sessionListFrame", {
			sessions: [
				{
					...durableOnlyRow,
					ended: true,
					degraded: true,
					completion_kind: "complete",
				},
			],
			degraded: [],
			capabilities: {},
		});
		expect(frame.sessions[0]?.ended).toBe(true);
		expect(frame.sessions[0]?.degraded).toBe(true);
	});

	it("reads a false receipt as a live session rather than as an absence", () => {
		const frame = parsePayload("sessionListFrame", {
			sessions: [{ ...durableOnlyRow, ended: false, degraded: false }],
			degraded: [],
			capabilities: {},
		});
		expect(frame.sessions[0]?.ended).toBe(false);
		expect(frame.sessions[0]?.degraded).toBe(false);
	});

	it("rejects a receipt that is not a boolean rather than coercing it", () => {
		for (const bad of ["true", 1, {}, null]) {
			const result = safeParsePayload("sessionListFrame", {
				sessions: [{ ...durableOnlyRow, ended: bad }],
				degraded: [],
				capabilities: {},
			});
			expect(result.ok, `ended=${JSON.stringify(bad)}`).toBe(false);
		}
	});

	it("accepts the receipts on a projection frame, where they are the fresher source", () => {
		const projection = readJson(
			join(FIXTURE_ROOT, "sse/sse-projection-live-idle.json"),
		) as { data: Record<string, unknown> };
		const degraded = parsePayload("sessionProjection", {
			...projection.data,
			degraded: true,
		});
		expect(degraded.degraded).toBe(true);
		const ended = parsePayload("sessionProjection", {
			...projection.data,
			ended: true,
		});
		expect(ended.ended).toBe(true);
	});
});

describe("the json boundary", () => {
	it("reports invalid JSON as an invalid_json issue rather than a crash", () => {
		let caught: unknown;
		try {
			parseJsonPayload("healthz", "<html>not json</html>");
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(RelayFrameError);
		expect((caught as RelayFrameError).issues[0]?.code).toBe("invalid_json");
	});

	it("parses a real healthz body", () => {
		const fixture = readJson(join(FIXTURE_ROOT, "http/healthz.json")) as {
			body: unknown;
		};
		const parsed = parseJsonPayload("healthz", JSON.stringify(fixture.body));
		expect(parsed.version).toBe(5);
	});
});
