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

import { relative } from "node:path";

import { describe, expect, it } from "vitest";
import {
	FIXTURE_ROOT,
	listFixtureJsonFiles,
	loadFixture,
} from "../../testing/fixtures";
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

	/* --- A row sample inside a response envelope (see the note in the block). --- */
	if (rel === "http/list_row_live.json" || rel === "http/list_row_ended.json") {
		/* The file records ONE summary row (its provenance says so) inside an
		 * `/api/sessions` body, and the body's required `capabilities`/`degraded`
		 * fields are simply not part of the excerpt. They stay required in the
		 * schema — the contract declares them and three other captures at the same
		 * refs carry them — so the excerpt is read for the row it is about rather
		 * than treated as licence to loosen the list payload. */
		const sessions = (body as { sessions?: unknown[] } | null)?.sessions;
		if (!Array.isArray(sessions) || sessions.length !== 1) {
			throw new Error(`${rel}: expected exactly one row under \`sessions\``);
		}
		return { kind: "schema", schema: "sessionSummary", value: sessions[0] };
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
			/* The payload is the `models` array, not the file: the wrapper carries the
			 * provenance marker, and the README is explicit that the array's ORDER is
			 * the ranking — a client that re-sorts it presents a different model list
			 * than the relay chose, so `synthetic-models.test`-style ordering is
			 * asserted next to this classification. */
			const ranked = (value as { models?: unknown }).models;
			if (!Array.isArray(ranked)) {
				throw new Error(`${rel}: expected the models array under \`models\``);
			}
			return { kind: "schema-list", schema: "modelEntry", values: ranked };
		}
	}

	if (rel === "gateway/gateway-refusal-constants.json") {
		return {
			kind: "skip",
			reason:
				"module constants, not a payload; asserted by the gateway-copy test below",
		};
	}
	if (rel === "sse/sse-keepalive.json") {
		return {
			kind: "skip",
			reason:
				"the captured keep-alive bytes, fed to the framer by relay/__tests__/sse.test.ts",
		};
	}
	if (rel.startsWith("probes/")) {
		return {
			kind: "skip",
			reason:
				"a probe transcript — excerpts of a row over time, not a payload frame; its rules are asserted in the probe block below",
		};
	}

	throw new Error(
		`${rel}: unclassified fixture. Add it to classifyFixture with a schema or an explicit skip reason.`,
	);
}

describe("the fixture corpus is fully classified", () => {
	const files = listFixtureJsonFiles().map((path) =>
		relative(FIXTURE_ROOT, path),
	);
	const classified = files.map((rel) => ({
		rel,
		result: classifyFixture(rel, loadFixture(rel)),
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
		const attention = loadFixture("sse/sse-attention-complete.json");
		const parsed = completionAttentionSchema.safeParse(attention);
		expect(parsed.success).toBe(true);
	});

	it("keeps every gateway reason the constants file names inside the enum", () => {
		const constants = loadFixture("gateway/gateway-refusal-constants.json") as {
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
	const frame = loadFixture("sse/sse-projection-live-idle.json") as {
		data: unknown;
	};
	return frame.data as Record<string, unknown>;
})();

function projectionWith(overrides: Record<string, unknown>): unknown {
	return { ...VALID_PROJECTION, ...overrides };
}

/** One queued-ask row as the wire carries it (design §4, frozen). */
const askRow = (
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	ask_id: "ask-1",
	created_at: 1_790_727_000_000,
	expires_at: 1_790_727_900_000,
	timeout_s: 900,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "q1",
			question: "which one?",
			options: [{ label: "a", description: "the first" }],
			multi: false,
			recommended: 0,
			secret: false,
			persist: false,
		},
	],
	...overrides,
});

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
			loadFixture("sse/sse-list-frame.json"),
		],
		[
			"a sessions frame carrying projection data",
			"sessionsStreamFrame",
			loadFixture("sse/sse-projection-live-idle.json"),
		],
		[
			"an ask whose questions is an object",
			"sessionProjection",
			projectionWith({
				asks: [{ ...askRow(), questions: {} }],
				asks_open: 1,
			}),
		],
		[
			"an ask missing its status",
			"sessionProjection",
			projectionWith({ asks: [askRow({ status: undefined })], asks_open: 1 }),
		],
		[
			"an aggregate asks response whose asks is an object",
			"asks",
			{ asks: {} },
		],
		[
			"an ask_respond with no answers map",
			"commandOp",
			{ op: "ask_respond", ask_id: "ask-1" },
		],
		[
			"an ask_respond whose answers hold strings, not lists",
			"commandOp",
			{ op: "ask_respond", ask_id: "ask-1", answers: { q1: "yes" } },
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
			loadFixture("http/sessions-empty.json") as {
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
describe("the receipts read absence as false and never invent a state", () => {
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

	it("reads a row with no receipt as not-ended and not-degraded, per the contract", () => {
		const frame = parsePayload("sessionListFrame", {
			sessions: [durableOnlyRow],
			degraded: [],
			capabilities: {},
		});
		const row = frame.sessions[0];
		expect(row?.session_id).toBe("6714def86197");
		/* Absence means `false` (contract.md §6.5.1, rule 1: "**Absence means
		 * `false`.**"), the rolling-upgrade rule `unseen` and `pinned` already
		 * follow — so the reading is settled here rather than left as `undefined` for
		 * every screen to interpret. `false` claims nothing: it is "not observed to
		 * have ended", and a durable-only row is exactly that. */
		expect(row?.ended).toBe(false);
		expect(row?.degraded).toBe(false);
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
		const projection = loadFixture("sse/sse-projection-live-idle.json") as {
			data: Record<string, unknown>;
		};
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

/* ---------------------------------------------------- the corpus's own rules */

/** Reads a fixture. Every file carries its payload at the top level beside the
 *  `provenance` marker, so nothing is unwrapped here — the two files whose
 *  payload is a named field are read through that field where they are used. */
function fixture<T>(rel: string): T {
	return loadFixture<T>(rel);
}

/** A probe transcript's samples, keyed by its own `columns` list. The probes are
 *  captures of a row changing over time, which is why they are read as data here
 *  rather than being forced through a payload schema. */
function probeRows(rel: string): Record<string, unknown>[] {
	const probe = fixture<{ columns: string[]; samples: unknown[][] }>(rel);
	return probe.samples.map((sample) => {
		const row: Record<string, unknown> = {};
		probe.columns.forEach((column, index) => {
			row[column] = sample[index];
		});
		return row;
	});
}

describe("every fixture names its own origin", () => {
	const files = listFixtureJsonFiles().map((path) =>
		relative(FIXTURE_ROOT, path),
	);

	it("marks provenance in the file, which outranks the directory it sits in", () => {
		for (const rel of files) {
			const provenance = (
				fixture(rel) as { provenance?: Record<string, unknown> }
			).provenance;
			if (provenance === undefined) {
				throw new Error(`${rel}: no provenance marker`);
			}
			const kind = provenance.kind;
			if (kind !== "live" && kind !== "synthetic") {
				throw new Error(`${rel}: provenance.kind is ${String(kind)}`);
			}
			if (
				typeof provenance.relay_ref !== "string" ||
				provenance.relay_ref === ""
			) {
				throw new Error(`${rel}: provenance.relay_ref is missing`);
			}
			/* The marker is the authority, so the two disagreeing is a defect in the
			 * tree rather than a licence to trust the path: a hand-built sample sitting
			 * in a capture's directory is the failure this field exists for. */
			const implied = rel.startsWith("synthetic/") ? "synthetic" : "live";
			if (kind !== implied) {
				throw new Error(
					`${rel}: provenance.kind is ${kind}, its directory implies ${implied}`,
				);
			}
			/* And each kind declares its own evidence: a capture names when and how it
			 * was taken, a built sample names what it was modelled on and why. */
			const declared = Object.keys(provenance);
			const required =
				kind === "live" ? ["captured_at", "how"] : ["modelled_on", "why"];
			for (const field of required) {
				if (!declared.includes(field)) {
					throw new Error(`${rel}: a ${kind} fixture must declare ${field}`);
				}
			}
		}
	});

	it("spans the two relay refs the receipts arrived between", () => {
		/* The receipts (`ended`, `degraded`) were added after the bulk of the captures,
		 * so the corpus deliberately holds both refs and each file names its own. A
		 * suite reading a receipt-bearing fixture has to know which wire it is on. */
		const refs = new Set(
			files.map(
				(rel) =>
					(fixture(rel) as { provenance: { relay_ref: string } }).provenance
						.relay_ref,
			),
		);
		expect(refs.size).toBeGreaterThan(1);
		for (const ref of refs)
			expect(ref).toMatch(/^local-operator [0-9a-f]{7,9}$/);
	});

	it("leaves the ranked model list in the order the relay ranked it", () => {
		/* `models.ranked.json` wraps the array (`{"provenance", "models"}`) and its
		 * README entry is explicit that the order IS the ranking. Parsing must not
		 * reorder, and neither may anything downstream: a client that sorts by label
		 * shows a different top model than the relay chose. */
		const ranked = fixture<{ models: { selector: string }[] }>(
			"synthetic/models.ranked.json",
		).models;
		const parsed = ranked.map((entry) => parsePayload("modelEntry", entry));
		expect(parsed.map((entry) => entry.selector)).toEqual(
			ranked.map((entry) => entry.selector),
		);
		expect(parsed.length).toBeGreaterThan(10);
	});
});

describe("the probes record what the session receipts mean", () => {
	it("fires `degraded` after the counts go unknown, and never clears it on a timer", () => {
		const probe = fixture<{ heartbeat_timeout_s: number }>(
			"probes/degraded-row-signal.json",
		);
		const rows = probeRows("probes/degraded-row-signal.json");
		expect(rows.length).toBeGreaterThan(20);
		const vouched = rows.filter((row) => row.subagents_running === 0);
		const unknown = rows.filter((row) => row.subagents_running === null);
		expect(vouched.length).toBeGreaterThan(0);
		expect(unknown.length).toBeGreaterThan(0);
		/* The counts change first and they change at the timeout — the field is what a
		 * client on an older relay has to watch. */
		expect(Number(vouched.at(-1)?.t)).toBeLessThan(probe.heartbeat_timeout_s);
		expect(Number(unknown[0]?.t)).toBeGreaterThanOrEqual(
			probe.heartbeat_timeout_s,
		);
		for (const row of vouched) expect(row.degraded).toBe(false);
		const firstNull = rows.findIndex((row) => row.subagents_running === null);
		const firstDegraded = rows.findIndex((row) => row.degraded === true);
		expect(firstDegraded).toBeGreaterThan(firstNull);
		/* Once true it stays true for the rest of the capture, including the samples
		 * taken after the runtime was resumed: the flag clears by being *observed*
		 * false, never by a timer, so a screen must not time the badge out itself. */
		expect(
			rows.filter((row) => row.phase === "resumed").length,
		).toBeGreaterThan(0);
		expect(rows.at(-1)?.degraded).toBe(true);
		for (const row of rows.slice(firstDegraded))
			expect(row.degraded).toBe(true);
		/* A wedged runtime has not ended, and its row does not leave `active`. */
		for (const row of rows) {
			expect(row.ended).toBe(false);
			expect(row.section).toBe("active");
		}
	});

	it("does not read `degraded: false` beside unknown counts as healthy", () => {
		const probe = fixture<{ heartbeat_timeout_s: number }>(
			"probes/degraded-never-fires-unstamped.json",
		);
		const rows = probeRows("probes/degraded-never-fires-unstamped.json");
		/* The negative result is only a result because it outlasts the timeout: a
		 * runtime frozen before it ever reported a beat never reaches the wedged
		 * state, so the receipt never fires while the counts are already unknown. */
		expect(Number(rows.at(-1)?.t)).toBeGreaterThan(probe.heartbeat_timeout_s);
		for (const row of rows) {
			expect(row.subagents_running).toBeNull();
			expect(row.degraded).toBe(false);
			expect(row.ended).toBe(false);
		}
		/* The distinction the probe exists to protect: unknown (`null`) has to stay
		 * distinguishable from the healthy `0`, or a stalled conversation renders as
		 * a quiet one. This is the rule behind the nullable number in the schema. */
		expect(
			probeRows("probes/degraded-row-signal.json")[0]?.subagents_running,
		).toBe(0);
	});

	it("detects a stalled conversation on a relay that has no receipt at all", () => {
		const probe = fixture<{
			heartbeat_timeout_s: number;
			samples: {
				t: number;
				subagents_running: number | null;
				section: string;
			}[];
		}>("probes/wedged-row-signal.json");
		const live = probe.samples.filter(
			(sample) => sample.subagents_running === 0,
		);
		const stale = probe.samples.filter(
			(sample) => sample.subagents_running === null,
		);
		expect(live.length).toBeGreaterThan(0);
		expect(stale.length).toBeGreaterThan(0);
		expect(live.at(-1)?.t).toBeLessThan(probe.heartbeat_timeout_s);
		expect(stale[0]?.t).toBeLessThanOrEqual(probe.heartbeat_timeout_s);
		/* Still `active`, still not ended, and this ref's samples carry neither
		 * receipt — so the field change is the only signal available. */
		for (const sample of probe.samples) expect(sample.section).toBe("active");
		expect(probe.samples.some((sample) => "degraded" in sample)).toBe(false);
	});

	it("keeps a durable-only row ordinary, and an older relay's row parseable", () => {
		const probe = fixture<{
			row_before_restart: Record<string, unknown>;
			row_after_restart: Record<string, unknown>;
		}>("probes/durable-only-row.json");
		/* Before: the daemon that ran the conversation vouches for it. After: a second
		 * daemon on the same home, with nothing registered — so the counts are
		 * unknown and the relay refuses to infer an end it did not observe. */
		expect(probe.row_before_restart.subagents_running).toBe(0);
		expect(probe.row_after_restart.subagents_running).toBeNull();
		expect(probe.row_after_restart.ended).toBe(false);
		expect(probe.row_after_restart.degraded).toBe(false);
		expect(probe.row_after_restart.model_label).toBe("");
		/* And the row a relay older than the receipts sends still parses. Absence
		 * reads as `false` — the contract's rolling-upgrade rule — so the check is
		 * that the reading is settled rather than left `undefined`; the probe's own
		 * rows cannot serve here, because they are EXCERPTS carrying only the fields
		 * the receipt touches (no `conversation_name`, `cwd`, `todos_open`, `mtime`),
		 * so this uses a whole row from the http capture. */
		const whole = fixture<{ body: { sessions: Record<string, unknown>[] } }>(
			"http/list_row_live.json",
		).body.sessions[0];
		const older = { ...whole };
		delete older.ended;
		delete older.degraded;
		const parsed = safeParsePayload("sessionSummary", older);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.data.ended).toBe(false);
		expect(parsed.data.degraded).toBe(false);
		/* The same row with the receipts is read as the relay's own statement, so the
		 * two cases are distinguishable rather than merged into "probably fine". */
		const stated = safeParsePayload("sessionSummary", whole);
		expect(stated.ok).toBe(true);
		if (!stated.ok) return;
		expect(stated.data.ended).toBe(false);
		expect(stated.data.degraded).toBe(false);
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
		const fixture = loadFixture("http/healthz.json") as {
			body: unknown;
		};
		const parsed = parseJsonPayload("healthz", JSON.stringify(fixture.body));
		expect(parsed.version).toBe(5);
	});
});

describe("a projection from a relay that predates an additive field", () => {
	it("still parses, and reads the missing cut_off flag as false", () => {
		/* `cut_off` is additive (`contract.md` §6.7). Requiring it made a relay one
		 * release behind blank the whole session view over one absent flag. */
		const captured = loadFixture("sse/sse-projection-live-idle.json") as {
			data: Record<string, unknown>;
		};
		const { cut_off: _dropped, ...older } = captured.data;
		const parsed = safeParsePayload("sessionProjection", older);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.data.cut_off).toBe(false);
	});
});

/* --------------------------------------------------------------- queued asks */

/**
 * The queued-ask fields are the client-side capability proxy (design §4, the N2
 * rule): the field's PRESENCE means "this runtime publishes asks" and its
 * ABSENCE must render exactly today's view. A schema that defaults `asks` to `[]`
 * or `asks_open` to `0` would fabricate that capability out of an older relay's
 * silence — the one failure this half of the contract exists to prevent.
 */
describe("the queued-ask fields are read by presence, never defaulted", () => {
	it("leaves an absent asks field absent — not an empty list, not a zero", () => {
		const parsed = parsePayload("sessionProjection", projectionWith({}));
		expect(parsed.asks).toBeUndefined();
		expect(parsed.asks_open).toBeUndefined();
	});

	it("keeps a zero the wire states as a zero, never as absence", () => {
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({ asks_open: 0 }),
		);
		expect(parsed.asks_open).toBe(0);
	});

	it("accepts the ask row whole, including the frozen question shape", () => {
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({ asks: [askRow()], asks_open: 1 }),
		);
		const row = parsed.asks?.[0];
		expect(row?.ask_id).toBe("ask-1");
		expect(row?.questions[0]?.options[0]?.description).toBe("the first");
		expect(row?.questions[0]?.recommended).toBe(0);
	});

	it("carries session_id and cwd on aggregate rows, so a foreign row is answerable", () => {
		const parsed = parsePayload("asks", {
			asks: [{ ...askRow(), session_id: "6714def86197", cwd: "~/work" }],
		});
		expect(parsed.asks[0]?.session_id).toBe("6714def86197");
		expect(parsed.asks[0]?.cwd).toBe("~/work");
	});

	it("passes an unknown status through as its own word, never onto a known one", () => {
		const parsed = parsePayload(
			"sessionProjection",
			projectionWith({
				asks: [askRow({ status: "escalated_to_human" })],
				asks_open: 1,
			}),
		);
		expect(parsed.asks?.[0]?.status).toBe("escalated_to_human");
	});

	it("reads asks_truncated as absent unless the frame states it — absence means complete", () => {
		const plain = parsePayload("sessionProjection", projectionWith({}));
		expect(plain.asks_truncated).toBeUndefined();
		const cut = parsePayload(
			"sessionProjection",
			projectionWith({ asks: [askRow()], asks_open: 21, asks_truncated: true }),
		);
		expect(cut.asks_truncated).toBe(true);
	});

	it("parses the ask-family command bodies the sheet sends", () => {
		const respond = parsePayload("commandOp", {
			op: "ask_respond",
			ask_id: "ask-1",
			answers: { q1: ["a"], q2: [] },
		});
		expect(respond.op).toBe("ask_respond");
		const decline = parsePayload("commandOp", {
			op: "ask_decline",
			ask_id: "ask-1",
		});
		expect(decline.op).toBe("ask_decline");
		const dismiss = parsePayload("commandOp", {
			op: "ask_dismiss",
			ask_id: "ask-1",
		});
		expect(dismiss.op).toBe("ask_dismiss");
	});
});
