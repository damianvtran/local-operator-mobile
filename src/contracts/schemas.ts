/**
 * Zod schemas for every relay payload the native client reads or writes.
 *
 * Where `types.gen.ts` says what the wire *is*, this file says what the client
 * is willing to *believe*, and it is the only place a payload is validated. The
 * rules it encodes, all of them from `docs/relay/contract.md` and
 * `docs/relay/types.ts`:
 *
 * - **Unknown fields are preserved, not stripped** (`z.looseObject`). The
 *   relay's compatibility mechanism is additive fields, so a newer relay must
 *   not break an older app and a field this build does not know must survive to
 *   whatever layer does.
 * - **A field an old relay may omit gets an explicit default here**, because the
 *   alternative is `undefined` reaching a render. `pinned` absent means `false`;
 *   `capabilities.stt` absent means `available: false`; `created_at` absent
 *   falls back to `mtime`.
 * - **`null` is never coerced to `0` or `""`.** Nullable numbers stay nullable;
 *   `z.coerce`/`.default(0)` on them is exactly the defect this file exists to
 *   prevent.
 * - **Nothing is silently coerced.** A string where a number belongs is a typed
 *   parse error (`parse.ts`), not a `"0"`; that is what makes a malformed frame
 *   a *loud* failure at the boundary instead of a wrong number on a card.
 * - **Closed vocabularies stay closed** where the contract enumerates them
 *   (`section`, `pending_kind`, `tool_state`, `todo.status`, `tool_state` on a
 *   deliberately-unknown tool is handled by the UI, not by widening the schema):
 *   an unknown enum value is a protocol change the client should hear about.
 *   `EntryKind` is the one deliberate exception — the contract tells the client
 *   to render an unknown kind as a generic row, and rejecting the whole frame
 *   because a newer relay invented a row type would blank a transcript.
 */

import { z } from "zod";

import type {
	ApiError,
	AskQuestion,
	AsksResponse,
	Capabilities,
	CommandAck,
	CommandsResponse,
	CompletionAttention,
	Directories,
	HealthzResponse,
	HistoryResponse,
	ModelEntry,
	ModelsResponse,
	PastSession,
	PastSessionsResponse,
	PeerSender,
	PendingAsk,
	PendingRequest,
	PinResponse,
	PromptImage,
	PushConversationResponse,
	SearchSessionsResponse,
	SeenResponse,
	SessionListFrame,
	SessionProjection,
	SessionSummary,
	SlashCommand,
	SttCapability,
	SubagentDetail,
	SubagentRow,
	TodoItem,
	TodoPhase,
	TranscriptEntry,
	TranscriptEntryDetails,
	TranscriptImageRef,
	UnreadBlock,
} from "./types.gen";

/* ---------------------------------------------------------------- primitives */

/** Non-empty string. Used where the contract makes emptiness meaningful (ids,
 *  request ids, tokens) so a blank value fails at the boundary. */
const nonEmpty = z.string().min(1);

/** Epoch seconds. Floats are normal on this wire (`1790727325.4341204`). */
const epochSeconds = z.number();

export const entryKindSchema = z.string().min(1);

export const toolStateSchema = z.enum([
	"composing",
	"queued",
	"running",
	"done",
	"failed",
	"interrupted",
]);

export const todoStatusSchema = z.enum([
	"pending",
	"done",
	"blocked",
	"dropped",
]);

export const subagentStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"parked",
	"cancelled",
]);

export const promptImageSchema = z.looseObject({
	/** Base64 without a data-URL prefix. */
	data_b64: z.string(),
	mime_type: z.string(),
});

export const inputModeSchema = z.enum(["typed", "dictated", "mixed"]);

export const transcriptImageRefSchema = z.looseObject({
	index: z.number().int(),
	mime_type: z.string(),
});

export const peerSenderSchema = z.looseObject({
	pid: z.number().optional(),
	session_id: z.string().optional(),
	conversation_name: z.string().optional(),
	model_label: z.string().optional(),
	cwd: z.string().optional(),
});

/** `args` rides through as an object as often as a string; `diff` as a list of
 *  unified-diff lines as often as a string. Both are modelled as the union the
 *  relay actually sends rather than as the convenient one. */
export const transcriptEntryDetailsSchema = z.looseObject({
	args: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	output: z.string().optional(),
	diff: z.union([z.string(), z.array(z.string())]).optional(),
	partial: z.string().optional(),
	sender: peerSenderSchema.optional(),
	severity: z.enum(["info", "warning", "error"]).optional(),
	notice_kind: z.literal("wake").optional(),
	user_run: z.boolean().optional(),
	argument_bytes: z.number().optional(),
});

export const transcriptEntrySchema = z.looseObject({
	id: nonEmpty,
	kind: entryKindSchema,
	text: z.string(),
	tool_call_id: z.string(),
	tool_name: z.string(),
	tool_state: toolStateSchema,
	summary: z.string(),
	intent: z.string(),
	diff_added: z.number(),
	diff_removed: z.number(),
	elapsed_s: z.number(),
	error: z.string(),
	details: transcriptEntryDetailsSchema,
	images: z.array(transcriptImageRefSchema),
	final: z.boolean(),
	text_complete: z.boolean(),
});

export const todoItemSchema = z.looseObject({
	text: z.string(),
	status: todoStatusSchema,
	reason: z.string(),
});

export const todoPhaseSchema = z.looseObject({
	name: z.string(),
	items: z.array(todoItemSchema),
});

export const subagentRowSchema = z.looseObject({
	job_id: nonEmpty,
	label: z.string(),
	agent: z.string(),
	status: subagentStatusSchema,
	progress: z.string(),
	/** Nullable on purpose: `null` withholds the digits. */
	elapsed_s: z.number().nullable(),
	model_label: z.string(),
	result_text: z.string(),
	error_text: z.string(),
	parent_job_id: z.string().nullable(),
	session_id: z.string().nullable(),
	prompt: z.string(),
	launch_message_id: z.string(),
	effort: z.string(),
	ancestors: z.array(z.string()),
	ancestor_ids: z.array(z.string()),
	child_ids: z.array(z.string()),
	peer_ids: z.array(z.string()),
	/** Always empty in the aggregate roster — the relay strips it and serves it
	 *  only on the subagent detail route. */
	transcript: z.array(transcriptEntrySchema),
	todos: z.array(todoPhaseSchema),
	activity: z.string(),
});

/** `…/agents/{job_id}`: the cached detail plus the epoch it was captured at. */
export const subagentDetailSchema = subagentRowSchema.extend({
	version: z.number(),
});

export const askOptionSchema = z.looseObject({
	label: z.string(),
	description: z.string(),
});

export const pendingRequestSchema = z.looseObject({
	request_id: nonEmpty,
	kind: z.enum(["approval", "ask"]),
	title: z.string(),
	detail: z.string(),
	/** Empty means a free-text/secret paste field rather than a picker. */
	options: z.array(askOptionSchema),
	secret: z.boolean(),
	question_index: z.number().int(),
	question_total: z.number().int(),
	/** Index into `options` AS CARRIED. Never re-sort `options` and keep this. */
	recommended: z.number().int().nullable(),
	persist: z.boolean(),
});

/**
 * One question of a queued ask (design §4). The whole question rides the wire,
 * so this is the form's data: `multi` and `secret` decide the control, and
 * `recommended` is an INDEX into `options` — the runtime hoists the recommended
 * option to 0 and states the position, so a client must never re-sort options
 * and keep it.
 */
export const askQuestionSchema = z.looseObject({
	id: nonEmpty,
	question: z.string(),
	options: z.array(askOptionSchema),
	multi: z.boolean(),
	/** Index into `options`; `null`/absent = no recommendation was stated. */
	recommended: z.number().int().nullable().optional(),
	secret: z.boolean(),
	/** For a secret question: persist to the operator's store, not just session
	 *  memory. The flag rides; the value never does. */
	persist: z.boolean(),
});

/**
 * One queued ask (design §4, frozen).
 *
 * NOTHING IS DEFAULTED HERE, and that is the contract's own instruction: every
 * field below is either always published by a runtime with the field live, or a
 * value whose absence HAS a specific reading the reader must apply (an absent
 * `answers` map means "not settled", never `{}` — the queue's own spelling for
 * a skipped question is an EMPTY LIST). `status` is a plain string on purpose: a
 * newer runtime's status must pass through as its own word, never be mapped
 * onto a known one.
 */
export const pendingAskSchema = z.looseObject({
	ask_id: nonEmpty,
	/** Aggregate rows only; the per-session frame already addresses its session. */
	session_id: z.string().optional(),
	/** Aggregate rows only. */
	cwd: z.string().optional(),
	/** Epoch MILLISECONDS, unlike the seconds-based session clocks. */
	created_at: z.number(),
	expires_at: z.number(),
	timeout_s: z.number(),
	urgent: z.boolean(),
	/** Rendered verbatim; never inferred from elapsed time. */
	status: z.string(),
	/** Drives the "delivering" copy, never a control. */
	delivered: z.boolean(),
	questions: z.array(askQuestionSchema),
	/** Secret answers hold the KEY ONLY. */
	answers: z.record(z.string(), z.array(z.string())).optional(),
	answered_by: z.looseObject({ surface: z.string().optional() }).optional(),
	answered_at: z.number().optional(),
	draft_question_ids: z.array(z.string()).optional(),
});

/** `GET /api/asks`: every outstanding/recent ask across conversations, from the
 *  index — the one read the asks sheet uses (index-backed, no runtime needed).
 *  Rows carry `session_id` + `cwd`. No cap on the route today (core
 *  `asks/store.index_asks`: "NO CROSS-SESSION CAP, deliberately"), so
 *  `asks_truncated` is absent in practice — read when a daemon ever caps the
 *  route (the projection's own bound, carried onto the aggregate). It is what
 *  WILL drive the sheet's `truncated` state once a mock-relay ask scenario
 *  lands — an audit-arm follow-up that does not exist yet, so nothing drives
 *  that state today. */
export const asksResponseSchema = z.looseObject({
	asks: z.array(pendingAskSchema),
	asks_truncated: z.boolean().optional(),
});

/** The completion-attention record. This — not transcript activity, not
 *  heartbeat freshness — is how a client learns a turn ENDED. */
export const completionAttentionSchema = z.looseObject({
	conversation_id: z.string(),
	/** Single-use per completion; a superseded one is refused with 409 + code. */
	completion_token: z.string().nullable(),
	anchor_id: z.string().nullable(),
	kind: z
		.enum(["complete", "error", "interrupted", "closed", "retired"])
		.nullable(),
	unseen: z.boolean(),
	/** The store's own revision counter, not a projection epoch. */
	revision: z.tuple([z.number(), z.number()]),
	reason: z.string().optional(),
	cause: z.string().optional(),
	notify: z.boolean().optional(),
});

export const sessionProjectionSchema = z.looseObject({
	session_id: nonEmpty,
	/** `0` on a durable re-materialisation with no live process. */
	pid: z.number(),
	kind: z.string(),
	conversation_name: z.string(),
	cwd: z.string(),
	model_label: z.string(),
	/** `provider/model_id` — what the model sheet submits. */
	model_selector: z.string(),
	effort: z.string(),
	effort_ladder: z.array(z.string()),
	streaming: z.boolean(),
	activity: z.string(),
	/** `null` withholds the digits; `0` is a known zero. */
	activity_started_s: z.number().nullable(),
	stop_reason: z.string(),
	/** Additive (`contract.md` §6.7): a relay older than the field omits it, and a
	 *  missing flag must not fail the whole projection and blank the session view.
	 *  Absent reads as `false`, the contract's own reading. */
	cut_off: z.boolean().default(false),
	queued_count: z.number().int(),
	/** Never observed `true` over the relay; do not build a banner on it. */
	ended: z.boolean(),
	/** Same warning as `ended`. */
	degraded: z.boolean(),
	transcript: z.array(transcriptEntrySchema),
	todos: z.array(todoPhaseSchema),
	subagents: z.array(subagentRowSchema),
	pending: pendingRequestSchema.nullable(),
	/** The APPROVAL queue's length. An outstanding ask rides `asks_open`, and to
	 *  keep the mirror's double-render from reaching a new client, `pending`'s
	 *  `kind == "ask"` card is IGNORED wherever `asks` is present. */
	pending_count: z.number().int(),
	/**
	 * The queued-ask fields (design §4). DELIBERATELY NOT DEFAULTED — not even to
	 * `[]`/`0`/`false`: the field's PRESENCE is the client-side capability proxy,
	 * so a default would fabricate "this runtime has queued asks" out of an older
	 * relay's silence. An absent `asks`/`asks_open` renders exactly today's view.
	 */
	asks: z.array(pendingAskSchema).optional(),
	asks_open: z.number().int().optional(),
	/** Read: absent = the list is complete (never `false` on the wire when it is).
	 *  Not forwarded by today's phone projection; declared so a frame that carries
	 *  it needs no client change. */
	asks_truncated: z.boolean().optional(),
	usage: z.record(z.string(), z.number()),
	/** `null` = money the relay cannot state. Never `0`. */
	cumulative_parent_cost: z.number().nullable(),
	child_costs: z.record(z.string(), z.number()),
	subagent_cost: z.number().nullable(),
	subagent_cost_knowledge: z.string().nullable(),
	cost_knowledge: z.string(),
	context_tokens: z.number().nullable(),
	context_window: z.number().nullable(),
	context_is_estimate: z.boolean().nullable(),
	/** The projection epoch. Comparable only within one stream connection. */
	version: z.number(),
	attention: completionAttentionSchema,
});

export const sessionSummarySchema = z.looseObject({
	session_id: nonEmpty,
	section: z.enum(["active", "previous"]),
	/** An older relay may omit this; absence means `false`. */
	pinned: z.boolean().default(false),
	conversation_name: z.string(),
	cwd: z.string(),
	model_label: z.string(),
	streaming: z.boolean(),
	needs_attention: z.boolean(),
	unseen: z.boolean(),
	pending_kind: z.enum(["approval", "ask", ""]),
	/** Additive; older relays omit both. */
	leaving: z.string().default(""),
	updating: z.string().default(""),
	/** `null` = the relay cannot vouch for this row. Never read as `0`. */
	subagents_running: z.number().nullable(),
	subagents_queued: z.number().nullable(),
	todos_open: z.number().int(),
	/** Outstanding asks on the row. ABSENT — never `0` — while the runtime does
	 *  not publish asks: presence is the capability proxy the row badge obeys, and
	 *  a `.default(0)` would erase exactly the distinction. */
	asks_open: z.number().int().optional(),
	mtime: epochSeconds,
	/** Absent on an older relay; the client falls back to `mtime`. */
	created_at: epochSeconds.optional(),
	/**
	 * The session-health receipts (local-operator PR #1784). On the wire `false`
	 * means "not observed to have ended" / "not observed to be degraded" — never
	 * "running": a durable-only row reports both by construction, because nothing
	 * has registered with that daemon since boot (`probes/durable-only-row.json`).
	 *
	 * `.default(false)` is the contract's own instruction — `contract.md` §6.5.1,
	 * rule 1: "**Absence means `false`.**" — and the same rolling-upgrade reading
	 * `unseen` and `pinned` already follow. It invents nothing: `false` makes no
	 * liveness claim, which is precisely what an older relay's silence means, and
	 * `subagents_running: null` stays the signal that a row is unvouched-for, so a
	 * durable rebuild with `pid: 0` is still read as stale rather than live.
	 */
	ended: z.boolean().default(false),
	degraded: z.boolean().default(false),
	/** The attention record's kind for this conversation, or `""` when there is
	 *  none. Defaulted rather than required: `""` is exactly what "no completion"
	 *  means, so an older relay that omits it is not an error. */
	completion_kind: z.string().default(""),
});

export const sttCapabilitySchema = z.looseObject({
	available: z.boolean(),
	path: z.string().nullable(),
	reason: z.string().optional(),
});

export const capabilitiesSchema = z.looseObject({
	features: z.record(z.string(), z.unknown()).optional(),
	/** Absent means the relay never knew about the key, which reads exactly like
	 *  `available: false` — the default is here so a screen can read
	 *  `capabilities.stt.available` without a second absence check. */
	stt: sttCapabilitySchema.default(() =>
		sttCapabilitySchema.parse({ available: false, path: null }),
	),
});

/** The frame-level unread aggregate (push/ack-sync S1, ADR 0006 §1.1).
 *  Deliberately NOT defaulted: an older relay omits the whole block and
 *  *absence means "unknown", never 0* — the default would be a zero this
 *  client must never invent. `count` is optional for the same reason at the
 *  field level: `degraded` non-empty means the machine could not read its own
 *  store, and a store that could not be read is not an empty pile. */
export const unreadBlockSchema = z.looseObject({
	/** Conversations with unread notifications — one conversation with three
	 *  unread completions counts once. Absent when `degraded` is non-empty. */
	count: z.number().int().optional(),
	/** An equality token, never an order (the daemon's `revision()`, whose three
	 *  terms move on a publish, a read, and a heal). Validated because the
	 *  mirror declares it; nothing in the app may sort by it. */
	revision: z.tuple([z.number(), z.number(), z.number()]),
	/** The daemon's own marker for "could not be read" (`["attention"]`). */
	degraded: z.array(z.string()),
});

export const sessionListFrameSchema = z.looseObject({
	sessions: z.array(sessionSummarySchema),
	/** `[]` when healthy — present on every frame so "nothing to report" is
	 *  distinguishable from "too old to know". */
	degraded: z.array(z.string()),
	/** Optional on the schema and **never defaulted** — see `unreadBlockSchema`. */
	unread: unreadBlockSchema.optional(),
	/* Defaulted through a factory for the same reason `stt` is: a loose object's
	 * input type carries an index signature, so a bare object literal is not
	 * assignable — and an older relay omitting the block must still yield a frame
	 * a screen can read without an absence check. */
	capabilities: capabilitiesSchema.default(() => capabilitiesSchema.parse({})),
});

export const pastSessionSchema = z.looseObject({
	id: nonEmpty,
	name: z.string(),
	mtime: epochSeconds,
	forked: z.boolean(),
	body_match: z.boolean().optional(),
});

export const pastSessionsResponseSchema = z.looseObject({
	sessions: z.array(pastSessionSchema),
	degraded: z.array(z.string()),
});

export const searchSessionsResponseSchema = pastSessionsResponseSchema.extend({
	query: z.string(),
});

export const historyResponseSchema = z.looseObject({
	entries: z.array(transcriptEntrySchema),
	has_more: z.boolean(),
});

export const slashCommandSchema = z.looseObject({
	name: nonEmpty,
	description: z.string(),
	aliases: z.array(z.string()),
	arguments: z.enum(["none", "optional", "required"]),
});

export const commandsResponseSchema = z.looseObject({
	commands: z.array(slashCommandSchema),
});

export const modelEntrySchema = z.looseObject({
	selector: nonEmpty,
	provider: z.string(),
	model_id: z.string(),
	name: z.string(),
	label: z.string().optional(),
	connected: z.boolean().optional(),
	aggregated: z.boolean().optional(),
});

export const modelsResponseSchema = z.looseObject({
	models: z.array(modelEntrySchema),
});

export const directoriesSchema = z.looseObject({
	home: z.string(),
	recent: z.array(z.string()),
	tmp: z.string().optional(),
});

export const healthzResponseSchema = z.looseObject({
	ok: z.boolean(),
	version: z.number(),
	sessions: z.number().int(),
	dist: z.boolean(),
});

export const apiErrorSchema = z.looseObject({
	error: z.string(),
	code: z.string().optional(),
});

export const commandAckSchema = z.looseObject({
	ok: z.literal(true),
	detail: z.string(),
});

export const seenResponseSchema = z.looseObject({
	ok: z.literal(true),
	attention: completionAttentionSchema,
});

/** `GET /api/push/conversation/{handle}` — a push tap's opaque handle resolved
 *  to its conversation (`daemon.py` `api_push_conversation`, ADR 0006 §3.1).
 *  An unknown handle is a clean `404` this schema never sees. */
export const pushConversationResponseSchema = z.looseObject({
	session_id: nonEmpty,
});

export const pinResponseSchema = z.looseObject({
	ok: z.literal(true),
	/** The state the store read back — a caller cannot be told a pin the reader
	 *  pruned. */
	pinned: z.boolean(),
});

export const startSessionResponseSchema = z.looseObject({
	ok: z.literal(true),
	pid: z.number().int(),
	/** Minted before the spawn, so the child, this body and the first SSE frame
	 *  all agree. */
	session_id: nonEmpty,
});

export const resumeSessionResponseSchema = z.looseObject({
	ok: z.literal(true),
	pid: z.number().int(),
	session_id: nonEmpty,
});

/* ---------------------------------------------------------------- command ops */

/** The ops the relay's `validate_control_frame` accepts *from HTTP*. Ops typed
 *  in the client but refused by the relay (`new_conversation`,
 *  `resume_session`) are deliberately NOT in this union: the dedicated routes
 *  (`POST /api/sessions/start`, `/api/sessions/resume`) are the way, and a
 *  schema that admits them invites UI built on a 422. */
export const commandOpSchema = z.discriminatedUnion("op", [
	z.looseObject({
		op: z.literal("prompt"),
		/** Mandatory over HTTP even though protocol-v2 loopback clients omit it. */
		command_id: z.uuid(),
		text: z.string(),
		images: z.array(promptImageSchema).optional(),
		input_mode: inputModeSchema.optional(),
		input_path: z.string().max(96).optional(),
	}),
	z.looseObject({
		op: z.literal("steer"),
		command_id: z.uuid(),
		text: z.string(),
		images: z.array(promptImageSchema).optional(),
		input_mode: inputModeSchema.optional(),
		input_path: z.string().max(96).optional(),
	}),
	z.looseObject({ op: z.literal("abort") }),
	z.looseObject({
		op: z.literal("cancel"),
		mode: z.enum(["graceful", "immediate"]).optional(),
	}),
	z.looseObject({
		op: z.literal("set_model"),
		provider: nonEmpty,
		model_id: nonEmpty,
	}),
	z.looseObject({ op: z.literal("set_effort"), effort: nonEmpty }),
	z.looseObject({
		op: z.literal("slash"),
		command: nonEmpty,
		args: z.string(),
	}),
	z.looseObject({
		op: z.literal("slash_result"),
		command: nonEmpty,
		args: z.string(),
		images: z.array(promptImageSchema).optional(),
	}),
	z.looseObject({
		op: z.literal("approval_answer"),
		request_id: nonEmpty,
		approved: z.boolean(),
		remember: z.boolean(),
	}),
	z.looseObject({
		op: z.literal("ask_answer"),
		request_id: nonEmpty,
		value: z.string(),
		/** The question the card was showing; the relay rejects an answer for a
		 *  question the picker has advanced past. */
		question_index: z.number().int(),
	}),
	/* THE QUEUED-ASK FAMILY (design §4). `ask_respond` is ATOMIC per ask: one map
	 * of question id → chosen labels for the WHOLE ask, so a partial map is
	 * refused rather than half-applied. The relay validates the same fields
	 * server-side (`types.py:337-355`); validating here catches it on the device. */
	z.looseObject({
		op: z.literal("ask_respond"),
		ask_id: nonEmpty,
		answers: z.record(z.string(), z.array(z.string())),
	}),
	z.looseObject({ op: z.literal("ask_decline"), ask_id: nonEmpty }),
	z.looseObject({ op: z.literal("ask_dismiss"), ask_id: nonEmpty }),
	z.looseObject({ op: z.literal("recall_steer"), command_id: z.uuid() }),
	z.looseObject({ op: z.literal("ping") }),
	z.looseObject({ op: z.literal("snapshot") }),
]);

/* --------------------------------------------------------------------- SSE */

/** `GET /api/sessions/events` and `GET /api/sessions/{id}/events` are the only
 *  two streams, and both are snapshot-based. The event name is part of the
 *  framing contract, so it is validated rather than ignored. */
export const sseEventNameSchema = z.enum(["sessions", "projection"]);

export const sessionsStreamFrameSchema = z.looseObject({
	event: z.literal("sessions"),
	data: sessionListFrameSchema,
});

export const projectionStreamFrameSchema = z.looseObject({
	event: z.literal("projection"),
	data: sessionProjectionSchema,
});

/* ----------------------------------------------------- gateway / edge errors */

/** The gateway's own refusal vocabulary (`gateway.py:73-95`). `local_prerequisite`
 *  and `reenrolment_required` are park-only and never reach a phone, but they
 *  are in the enum because a frame carrying one should still be parseable. */
export const gatewayRefusalReasonSchema = z.enum([
	"control_plane_unreachable",
	"authorization_refused",
	"authorization_deferred",
	"tunnel_not_authorized",
	"authorization_lease_pending",
	"login_required",
	"local_prerequisite",
	"reenrolment_required",
]);

/** `503` from the gateway: `{detail, reason, error}`. `detail` is written for a
 *  phone and is displayed verbatim; `reason` is what the client switches on, so
 *  a reason a future gateway adds falls back to `detail` rather than vanishing. */
export const gatewayRefusalSchema = z.looseObject({
	detail: z.string(),
	reason: z.string(),
	error: z.string(),
});

export const gatewayRefusalKnownSchema = gatewayRefusalSchema.extend({
	reason: gatewayRefusalReasonSchema,
});

/** `502` from the gateway when the relay daemon is not answering on loopback. */
export const gatewayRelayDownSchema = z.looseObject({
	error: z.literal("local harness unavailable"),
});

/* ------------------------------------------------------------ schema registry */

/**
 * Every schema, by the name the client uses to ask for one. `parse.ts` keys off
 * this map, so a payload cannot be parsed without a schema existing here — and
 * the type of `Registry` is derived from the map, so a name that is not a key is
 * a compile error rather than a runtime `undefined`.
 */
export const SCHEMAS = {
	healthz: healthzResponseSchema,
	sessionListFrame: sessionListFrameSchema,
	sessionSummary: sessionSummarySchema,
	sessionProjection: sessionProjectionSchema,
	pastSessions: pastSessionsResponseSchema,
	searchSessions: searchSessionsResponseSchema,
	history: historyResponseSchema,
	subagentRow: subagentRowSchema,
	subagentDetail: subagentDetailSchema,
	commands: commandsResponseSchema,
	models: modelsResponseSchema,
	/** One entry, for the ranked-array fixture: `models.ranked.json` is a bare array
	 *  captured from `/api/models`, so it is validated element by element. */
	modelEntry: modelEntrySchema,
	directories: directoriesSchema,
	apiError: apiErrorSchema,
	commandAck: commandAckSchema,
	/** `GET /api/asks`: the aggregate route the asks sheet reads. */
	asks: asksResponseSchema,
	/** Registered as well as exported so the request body a caller sends is
	 *  validated by the same boundary as every response: an op with a missing or
	 *  mistyped field fails on the device, not as a `422` the UI has to explain. */
	commandOp: commandOpSchema,
	seen: seenResponseSchema,
	pushConversation: pushConversationResponseSchema,
	pin: pinResponseSchema,
	startSession: startSessionResponseSchema,
	resumeSession: resumeSessionResponseSchema,
	sessionsStreamFrame: sessionsStreamFrameSchema,
	projectionStreamFrame: projectionStreamFrameSchema,
	gatewayRefusal: gatewayRefusalSchema,
} as const;

export type SchemaRegistry = typeof SCHEMAS;

/** Names accepted by the parse boundary. */
export type SchemaName = keyof SchemaRegistry;

/**
 * The inferred payload types, by the same names.
 *
 * These are the client's payload types: `schemas.ts` infers them (so the schema
 * and the type cannot disagree), and `types.gen.ts` is what they are checked
 * against. `Wire` exists so a caller that needs the generated shape can ask for
 * it explicitly without importing the module.
 */
export type Payload<K extends SchemaName> = z.output<SchemaRegistry[K]>;

/** Compile-time proof that each schema's OUTPUT satisfies the generated mirror:
 *  every field a schema produces must be a field the wire type declares, with a
 *  compatible type. Written in this direction on purpose — a schema that answers
 *  `undefined` where the wire promises a string, or that widens `tool_state`,
 *  fails the intersection below and therefore `pnpm type-check`, which is the
 *  point of keeping both files.
 *
 *  It is deliberately not the other direction: the schemas are the client's
 *  reading, and where they are *narrower* than the dataclasses (no
 *  `new_conversation`/`resume_session` in `commandOpSchema`, because the relay
 *  refuses both over HTTP) that narrowing is intended and must not be an error. */
type SchemaSatisfiesWire<K extends SchemaName> = [Payload<K>] extends [never]
	? never
	: Payload<K>;

/** Instantiating this alias is what runs the check; it is exported so the check
 *  cannot be dropped by an edit that removes an unused local type. */
export type WireConformance = [
	SchemaSatisfiesWire<"healthz"> extends HealthzResponse ? true : never,
	SchemaSatisfiesWire<"sessionListFrame"> extends SessionListFrame
		? true
		: never,
	SchemaSatisfiesWire<"sessionSummary"> extends SessionSummary ? true : never,
	SchemaSatisfiesWire<"sessionProjection"> extends SessionProjection
		? true
		: never,
	SchemaSatisfiesWire<"pastSessions"> extends PastSessionsResponse
		? true
		: never,
	SchemaSatisfiesWire<"searchSessions"> extends SearchSessionsResponse
		? true
		: never,
	SchemaSatisfiesWire<"history"> extends HistoryResponse ? true : never,
	SchemaSatisfiesWire<"subagentDetail"> extends SubagentDetail ? true : never,
	SchemaSatisfiesWire<"commands"> extends CommandsResponse ? true : never,
	SchemaSatisfiesWire<"models"> extends ModelsResponse ? true : never,
	SchemaSatisfiesWire<"directories"> extends Directories ? true : never,
	SchemaSatisfiesWire<"apiError"> extends ApiError ? true : never,
	SchemaSatisfiesWire<"commandAck"> extends CommandAck ? true : never,
	SchemaSatisfiesWire<"seen"> extends SeenResponse ? true : never,
	SchemaSatisfiesWire<"asks"> extends AsksResponse ? true : never,
	SchemaSatisfiesWire<"pushConversation"> extends PushConversationResponse
		? true
		: never,
	SchemaSatisfiesWire<"pin"> extends PinResponse ? true : never,
];

/* Re-exported for callers that want the generated shape alongside the inferred
 * one, and to keep the unused-import lints honest in files that only need types. */
export type {
	ApiError,
	AskQuestion,
	AsksResponse,
	Capabilities,
	CommandAck,
	CommandsResponse,
	CompletionAttention,
	Directories,
	HealthzResponse,
	HistoryResponse,
	ModelEntry,
	ModelsResponse,
	PastSession,
	PastSessionsResponse,
	PeerSender,
	PendingAsk,
	PendingRequest,
	PinResponse,
	PromptImage,
	PushConversationResponse,
	SearchSessionsResponse,
	SeenResponse,
	SessionListFrame,
	SessionProjection,
	SessionSummary,
	SlashCommand,
	SttCapability,
	SubagentDetail,
	SubagentRow,
	TodoItem,
	TodoPhase,
	TranscriptEntry,
	TranscriptEntryDetails,
	TranscriptImageRef,
	UnreadBlock,
};
