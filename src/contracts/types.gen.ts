/**
 * Hand-authored mirror of the `lop mobile` relay wire types.
 *
 * Source of truth: `local_operator/mobile/{types,daemon,projection}.py` in
 * `damianvtran/local-operator`, which serialises its dataclasses with `asdict`
 * (so every declared field is present in a frame this build emits). Seeded from
 * `docs/relay/types.ts`, which is the annotated reading of the same wire and
 * carries the `file:line` citations; this file is the field-for-field mirror the
 * runtime schemas are checked against.
 *
 * Committed on purpose: a contributor without a local-operator checkout can
 * still build. A generator (`scripts/gen-relay-types.mjs`) and a CI drift-check
 * are planned, not present yet (a later stream): the generator would regenerate
 * this file and CI would report drift, because the relay may legitimately move
 * ahead of the app. Until then the file is maintained by hand, and the
 * `WireConformance` assertion plus the boundary parsers in `schemas.ts` are what
 * keep it honest.
 *
 * Two rules hold for every declaration, and they are the reason for the
 * nullability below:
 *
 * - A field an OLD relay may omit is optional here, and the client must have a
 *   defensible reading of absence (see `schemas.ts`, which encodes "absent means
 *   X" as an explicit default rather than letting `undefined` reach a screen).
 * - `null` is never `0` and never `""`. `activity_started_s: null` withholds the
 *   digits while `0` is a known zero; `subagents_running: null` means the relay
 *   cannot vouch for the row, never "no subagents". Collapsing those to zero is
 *   how a client invents a fact.
 *
 * Compatibility signal: `/healthz`'s `version` (= `PROTOCOL_VERSION`, 5). There
 * is no per-route version; additive fields are the mechanism.
 */

/* ---------------------------------------------------------------- primitives */

/** A row's kind. Open on purpose: an unknown kind must render as a generic but
 *  honest row rather than vanish (see `classifyEntryKind`). */
export type EntryKind =
	| "user"
	| "assistant"
	| "tool"
	| "notice"
	| "steer"
	| "compaction"
	| "parent_message"
	| "subagent_message"
	| "peer_message"
	| "reasoning"
	/**
	 * A queued ask SETTLING (`docs/design/ask-nonblocking.md` §4): one row per
	 * answer, late answer or decline — `details.status` says which — plus a
	 * sibling kind for the deadline itself. Distinct kinds so a client can key an
	 * affordance on them (the timed-out ask stays answerable), and an unknown-kind
	 * client renders through its generic path — exactly what it did before the
	 * queue existed.
	 */
	| "ask_response"
	/** A queued ask's deadline passing with nobody answering; answerable late
	 *  until `expires_at + 7 d`. */
	| "ask_timeout"
	| (string & {});

/** Closed: `queued` is not a synonym for `composing` or `running`. */
export type ToolState =
	| "composing"
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "interrupted";

export type TodoStatus = "pending" | "done" | "blocked" | "dropped";

export type SubagentStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "parked"
	| "cancelled";

export type PromptImage = { data_b64: string; mime_type: string };

export type InputMode = "typed" | "dictated" | "mixed";

export interface TranscriptImageRef {
	/** Image-block index only: a text caption does not shift it. */
	index: number;
	mime_type: string;
}

export interface PeerSender {
	pid?: number;
	session_id?: string;
	conversation_name?: string;
	model_label?: string;
	cwd?: string;
}

/** The `send` tool's settled delivery payload — `details.delivery`.
 *
 *  The ONE nested payload both the live tool result and the persisted row
 *  carry (local-operator PR #1855; `peer_send.DeliveryOutcome.details`,
 *  `tools/builtin.py` execute_send). `state` is the fact the app renders:
 *  `delivered | mailbox | unconfirmed | failed`, read through
 *  `features/session/delivery.ts`, which treats any other value as absent.
 *
 *  CARRIAGE: the mobile projection does not copy this object into a row's
 *  `details` yet (as of local-operator `1d88f3466`, `mobile/projection.py`
 *  `_tool_row_details` copies diff keys only), so this field is the shape the
 *  app is built to and the mock relay serves; the core change that lights it
 *  up end-to-end is tracked in the PR that added this interface. */
export interface SendDeliveryDetails {
	state?: string;
	message_id?: string;
	wake?: boolean | string;
	attempts?: number;
	cause?: string;
	route?: string;
	reason?: string;
}

export interface TranscriptEntryDetails {
	/** An object as often as a string — never assume `.split()` exists. */
	args?: string | Record<string, unknown>;
	output?: string;
	diff?: string | string[];
	partial?: string;
	sender?: PeerSender;
	severity?: "info" | "warning" | "error";
	notice_kind?: "wake";
	/** The `send` tool's settled delivery state (see `SendDeliveryDetails`). */
	delivery?: SendDeliveryDetails;
	user_run?: boolean;
	argument_bytes?: number;
	/* --- the queued-ask rows (design §4): the fold attaches these to
	 *  `ask_response` and `ask_timeout` entries so no surface re-derives Q&A from
	 *  a sentence (`local_operator/mobile/projection.py`, the ask branches). --- */
	ask_id?: string;
	/** `timed_out` on an `ask_timeout` row; `answered` | `late` | `declined` on
	 *  an `ask_response` row. Rendered VERBATIM through the shared copy table. */
	status?: string;
	/** The full question list, so `answeredPairs` needs no round trip. */
	questions?: AskQuestion[];
	/** Secret answers hold the KEY ONLY (`[<key>]`), never a value. */
	answers?: Record<string, string[]>;
	/** Epoch milliseconds the response landed. */
	at?: number;
	/** `ask_timeout` only: how long the ask waited, in seconds. */
	waited_s?: number;
	/** `ask_timeout` only: whether the deadline was short enough to be urgent. */
	urgent?: boolean;
	/** `ask_timeout` only: the notice the MODEL was given (the timeout text),
	 *  rendered under it as "what the agent was told". */
	text?: string;
}

export interface TranscriptEntry {
	id: string;
	kind: EntryKind;
	text: string;
	tool_call_id: string;
	tool_name: string;
	tool_state: ToolState;
	summary: string;
	intent: string;
	diff_added: number;
	diff_removed: number;
	elapsed_s: number;
	error: string;
	details: TranscriptEntryDetails;
	images: TranscriptImageRef[];
	final: boolean;
	text_complete: boolean;
}

export interface TodoItem {
	text: string;
	status: TodoStatus;
	reason: string;
}

export interface TodoPhase {
	name: string;
	items: TodoItem[];
}

export interface SubagentRow {
	job_id: string;
	label: string;
	agent: string;
	status: SubagentStatus;
	progress: string;
	/** `null` withholds the digits; `0` is a known zero. */
	elapsed_s: number | null;
	model_label: string;
	result_text: string;
	error_text: string;
	parent_job_id: string | null;
	session_id: string | null;
	prompt: string;
	launch_message_id: string;
	effort: string;
	ancestors: string[];
	ancestor_ids: string[];
	child_ids: string[];
	peer_ids: string[];
	/** Always empty in the aggregate projection; the detail route carries it. */
	transcript: TranscriptEntry[];
	todos: TodoPhase[];
	activity: string;
}

export interface SubagentDetail extends SubagentRow {
	version: number;
}

/* ------------------------------------------------------------------- pending */

export interface AskOption {
	label: string;
	description: string;
}

export interface PendingRequest {
	request_id: string;
	kind: "approval" | "ask";
	title: string;
	detail: string;
	/** Empty means free-text (or a masked secret paste) rather than a picker. */
	options: AskOption[];
	secret: boolean;
	question_index: number;
	question_total: number;
	/** Index into `options` AS CARRIED — never re-sort `options` and keep this. */
	recommended: number | null;
	persist: boolean;
}

/* -------------------------------------------------------------- queued asks */

/** One question of a queued ask, as `PendingAsk.questions` carries it. The FULL
 *  question rides the wire — options with their consequence lines, `multi`,
 *  `secret`, `persist` — so the form needs no re-derivation of the ask. */
export interface AskQuestion {
	id: string;
	question: string;
	options: AskOption[];
	/** More than one option may be chosen; the answer map still holds a list. */
	multi: boolean;
	/** The model's recommendation, as an INDEX INTO `options` (the runtime hoists
	 *  the recommended option to 0 and states the position; `null`/absent = no
	 *  recommendation was stated). */
	recommended?: number | null;
	/** The credential case: the answer is a masked paste field, and the answer
	 *  map holds the KEY the runtime stored, never the value (§4). */
	secret: boolean;
	/** For a secret question, save it to the operator's long-term store rather
	 *  than only session memory. The flag rides; the value never does. */
	persist: boolean;
}

/** One queued ask on the phone wire (design §4, frozen).
 *
 *  PRESENCE IS THE CAPABILITY PROXY: `SessionProjection.asks` is absent while
 *  the runtime does not publish queued asks and absence must render exactly
 *  today's view — never a zero badge. A field an old relay may omit is optional
 *  here with an explicit reading in `schemas.ts` rather than `undefined`
 *  reaching a screen. */
export interface PendingAsk {
	ask_id: string;
	/** Absent on the per-session projection; PRESENT on every aggregate row
	 *  (`GET /api/asks`), which additionally carries `cwd`. */
	session_id?: string;
	/** The owning conversation's working directory — aggregate rows only. */
	cwd?: string;
	/** Epoch MILLISECONDS (`now_ms()`), unlike the seconds-based session clocks. */
	created_at: number;
	/** Epoch milliseconds; the countdown renders from it on the CLIENT clock. */
	expires_at: number;
	timeout_s: number;
	urgent: boolean;
	/** The status set, rendered VERBATIM — never inferred from elapsed time. */
	status: string;
	/** The runtime's statement that this status's response rows exist in the
	 *  transcript; drives the "delivering" copy, never a control. */
	delivered: boolean;
	questions: AskQuestion[];
	/** Secret answers hold the KEY ONLY (`[<key>]`), never a value. */
	answers?: Record<string, string[]>;
	/** Which surface settled it when another beat this phone to the answer. */
	answered_by?: { surface?: string } & Record<string, unknown>;
	answered_at?: number;
	/** Question ids the legacy incremental path already took in this runtime;
	 *  drafts, not settled answers. Absent on atomically answered asks. */
	draft_question_ids?: string[];
}

/* ----------------------------------------------------------------- attention */

export interface CompletionAttention {
	conversation_id: string;
	completion_token: string | null;
	anchor_id: string | null;
	kind: "complete" | "error" | "interrupted" | "closed" | "retired" | null;
	unseen: boolean;
	revision: [number, number];
	/** Open vocabulary: an unrecognised `reason` renders generically. */
	reason?: string;
	cause?: string;
	notify?: boolean;
}

/**
 * The attention block when the conversation has NO folded attention yet: the
 * EXACTLY-EMPTY object, not a record with null fields.
 *
 * `_projection_frame` writes `projection.attention` verbatim, and a durable
 * rebuild of a conversation nothing has completed in carries `{}` — captured
 * live at `ae6c9eb6` (`fixtures/relay/sse/sse-projection-checkpoints-empty
 * .json`). It reads as "no record": every consumer reads the record's FIELDS
 * (`attentionRecord()` narrows it in one place), and nothing may be defaulted
 * from an absent record — a fabricated `unseen: false` would be a claim the
 * relay never made. */
export type EmptyAttention = Record<never, never>;

/* --------------------------------------------------------------- the session */

export interface SessionProjection {
	session_id: string;
	/** `0` on a durable re-materialisation with no live process. */
	pid: number;
	kind: string;
	conversation_name: string;
	cwd: string;
	model_label: string;
	model_selector: string;
	effort: string;
	effort_ladder: string[];
	streaming: boolean;
	activity: string;
	activity_started_s: number | null;
	stop_reason: string;
	cut_off: boolean;
	queued_count: number;
	/** Never observed `true` over the relay; derive liveness from the list row. */
	ended: boolean;
	degraded: boolean;
	transcript: TranscriptEntry[];
	todos: TodoPhase[];
	subagents: SubagentRow[];
	pending: PendingRequest | null;
	/** The APPROVAL queue's length (`>= 1` while `pending` is set). An outstanding
	 *  ASK is counted by `asks_open` instead — while the one-release legacy mirror
	 *  is live, `pending` may also carry a queued ask's synthetic card and this
	 *  count deliberately does not include it. */
	pending_count: number;
	/** The session's queued asks (design §4), newest first with the OPEN ones in
	 *  front. PRESENCE IS THE CAPABILITY PROXY: this and `asks_open` are ABSENT
	 *  (not `[]`/`0`) unless the runtime publishes queued asks, and absence must
	 *  render exactly today's view. Once present, IGNORE any `pending` card whose
	 *  `kind == "ask"` — the legacy mirror of one of these rows. */
	asks?: PendingAsk[];
	/** The session's OUTSTANDING tally — open plus timed-out-and-answerable asks,
	 *  passed through verbatim. Never `rows.length`: the frame's list can be a
	 *  prefix of the tally. */
	asks_open?: number;
	/** True only when the frame's byte bound dropped ask rows (core
	 *  `session/frontend_state.py` `bound_ask_rows`). Absent when complete — read
	 *  absence as complete. Not forwarded by today's phone projection; declared
	 *  so the client reacts the day it is. */
	asks_truncated?: boolean;
	usage: Record<string, number>;
	cumulative_parent_cost: number | null;
	child_costs: Record<string, number>;
	subagent_cost: number | null;
	subagent_cost_knowledge: string | null;
	cost_knowledge: string;
	context_tokens: number | null;
	context_window: number | null;
	context_is_estimate: boolean | null;
	/** Epoch, not a per-process counter: compare only within one connection. */
	version: number;
	attention?: CompletionAttention | EmptyAttention;
}

/* --------------------------------------------------------------- session list */

/**
 * One session-list row: a LOCAL conversation (this device's) or a REMOTE one
 * (another device's, appended only when the client asked `include_peers`).
 *
 * THE TWO ROW KINDS, stated once because every field below is read against it
 * (`local-operator` docs/mobile.md §"The peers' rows"):
 *
 * - a LOCAL row carries the whole shape below (id, section, name, cwd, model,
 *   the live marks, the counts, the clocks);
 * - a REMOTE row carries `session_id`/`section`/`pinned`/`conversation_name`/
 *   `mtime`/`created_at` PLUS the flat locality fields and the transport's
 *   `live_state`/`pending` at the bottom of this interface — and OMITS the
 *   local-only fields (no cwd, no model, no streaming/unseen/pending_kind, no
 *   counts). `locality` is the discriminator: a row without it is local. The
 *   nested transport `peer` block is deliberately NOT published and must never
 *   be read.
 *
 * The boundary (`schemas.sessionSummarySchema`) resolves each omitted
 * local-only field to an INERT default (false/""/null/0) so no `undefined`
 * reaches a render; a remote row's live facts are read from `live_state`/
 * `pending` alone (`features/sessions/session-projection.ts`), never through
 * those defaults.
 */
export interface SessionSummary {
	session_id: string;
	section: "active" | "previous";
	pinned: boolean;
	conversation_name: string;
	cwd: string;
	model_label: string;
	streaming: boolean;
	needs_attention: boolean;
	unseen: boolean;
	pending_kind: "approval" | "ask" | "";
	leaving: string;
	updating: string;
	/**
	 * The session-health receipts (local-operator PR #1784, mobile UX batch 2, U7).
	 * Additive and defaulted: an OLDER relay omits both, which is why they are
	 * optional, and absence reads exactly like `false`.
	 *
	 * They exist because the phone used to render an ended or degraded session
	 * exactly like a live one. `ended` is a receipt of a death THIS daemon
	 * observed — a purely durable row (nothing registered since boot) reports
	 * false, because claiming otherwise would be guessing. `degraded` means the
	 * record is fresh but the entry's control socket is unreachable. Neither is an
	 * error state: a row carrying both false — or carrying neither, on an older
	 * relay — is an ordinary session and must render as one.
	 */
	ended?: boolean;
	degraded?: boolean;
	/** `null` = not reported. Never read as `0`. */
	subagents_running: number | null;
	subagents_queued: number | null;
	todos_open: number;
	/** Outstanding queued asks on this row (design §4/§5.0), from the runtime's
	 *  own count. ABSENT — never `0` — while the runtime does not publish asks:
	 *  presence is the capability proxy. Distinct from `pending_kind`, which
	 *  stays the APPROVAL signal. */
	asks_open?: number;
	mtime: number;
	/** Absent on an older relay; `createdAt()` falls back to `mtime`.
	 *  A non-number or `<= 0` stamp is the relay's NO CLAIM: a remote row's
	 *  old-build peer sends `0.0` here, and the row must paint NO label and sort
	 *  last rather than render it as an ancient date (the desktop sidebar's rule,
	 *  #903). */
	created_at?: number;
	completion_kind: string;
	/* ------------------------------------------------ the remote row's own
	 *
	 * ABSENT ON A LOCAL ROW; present with real values on every remote one — the
	 * desktop row's flat locality fields field for field (Addendum 2 B). */
	/** The discriminator: `"remote"` on another device's row; absent on a local
	 *  one. Present-with-`"local"` is tolerated for a future relay that stamps
	 *  every row, and reads exactly like absence. */
	locality?: "local" | "remote";
	/** The owning device's id; `""` when the transport did not name one. */
	owner_device?: string;
	/** The owner's display name, or `""` — the row falls back to the id's TAIL,
	 *  never the id whole. */
	owner_device_name?: string;
	/** Whether the mesh currently reaches the owner. Absent only on a local row. */
	reachable?: boolean;
	/** One sentence when `reachable` is false, already glossed at the relay's
	 *  boundary so this client keeps no glossary; `""` when reachable. */
	unreachable_reason?: string;
	/** The transport's own state token, VERBATIM — `busy`, `idle`, `attached`,
	 *  `wedged`, or `""` for a stored row with no runtime behind it. The row's
	 *  mark and bin are read from exactly these words; never a third spelling. */
	live_state?: "busy" | "idle" | "attached" | "wedged" | "";
	/** The gate kind, verbatim — an OPEN string, not a closed union (round 1,
	 *  R1-1): `approval` / `ask` today, any future word tomorrow; only `approval`
	 *  spells approval and every other non-empty word is the answer family
	 *  (`remoteAttention`). `null` is no gate. */
	pending?: string | null;
	/** Declared for the mirror only — never read by this client. A null is no
	 *  claim: the federated row carries no owner's stamp, so nothing may be
	 *  derived from these three. */
	placement?: Record<string, unknown> | null;
	origin?: Record<string, unknown> | null;
	last_synced_at?: number | null;
}

/* ---------------------------------------------------------------- transfer */

/**
 * A finished move, in the backend's own words — the answer to
 * `POST /api/sessions/{id}/transfer`.
 *
 * THE RECEIPT IS THE ONLY THING THAT MAY CLAIM WHERE A CONVERSATION LIVES: the
 * move may hold the request for minutes and may still be refused after it
 * started, so no client may paint an ownership it was not handed. The refusal
 * shapes (a refusal, an unconfirmed outcome, a same-id/different-body conflict)
 * arrive as the plane's `{error, code}` bodies, never as this type.
 */
export interface TransferReceipt {
	/** The phases the move reached, in order, as the backend recorded them. */
	phases: TransferReceiptPhase[];
	/** Where the session ended up: `local` means it landed on this device. */
	locality: "local" | "remote";
	/** The device that holds it now; `""` when the transport named none. */
	owner_device: string;
	/** True when the source's copy is gone (a `move`); a `keep` never retires it. */
	source_retired: boolean;
	session_id: string;
	/** The id to open: equal to `session_id` for a move, freshly minted for a
	 *  `keep` copy. */
	new_session_id: string;
	mode: "move" | "keep";
	/** The at-most-once journal's mark: `true` means this answer replayed a
	 *  recorded outcome and dialled no second move. */
	replayed: boolean;
}

/** One phase stamp of a transfer receipt (`TransferReceipt.phases`). `phase` is
 *  open (`prepared`/`handing_off`/`committed`/`done` today) because a newer
 *  backend's phase word must reach the surface verbatim rather than fail the
 *  receipt; `progress` is the step on the monotone list, `0` for an unknown
 *  phase. */
export interface TransferReceiptPhase {
	phase: string;
	peer: string;
	progress: number;
}

export interface SttCapability {
	available: boolean;
	path: string | null;
	reason?: string;
}

export interface Capabilities {
	features?: Record<string, unknown>;
	/** An older relay omits this whole object; absence reads as `available:false`. */
	stt?: SttCapability;
}

export interface SessionListFrame {
	sessions: SessionSummary[];
	/** Degradation markers for the durable listing: `"sessions"` and/or `"attention"`. */
	degraded: string[];
	capabilities: Capabilities;
	/**
	 * Push/ack-sync S1 [ADR 0006 §1.1]: the machine's own unread aggregate, a
	 * TOP-LEVEL sibling of `degraded` — deliberately not inside `capabilities`,
	 * where a missing key means "this build does not have it". Additive: an
	 * OLDER relay omits the whole block, and **absence means "unknown", never
	 * 0** — a client must not touch a count it cannot read.
	 *
	 * `count` is absent (`degraded` non-empty) when the attention store could
	 * not be read: a store that could not be read is not an empty pile. The
	 * population is the listing's own snapshot — one conversation with three
	 * unread completions counts once.
	 */
	unread?: UnreadBlock;
}

/** The frame-level unread aggregate (`SessionListFrame.unread`). */
export interface UnreadBlock {
	/** The badge number: conversations with unread notifications. Absent when
	 *  `degraded` is non-empty. Never read absence as `0`. */
	count?: number;
	/** `AttentionStore.revision()` — an **equality token, never an order**: it
	 *  moves on a publish, on a read and `supersedes` moves on a heal. A client
	 *  compares it for change, it does not sort by it. */
	revision: [number, number, number];
	/** The daemon's own marker for "could not be read" (`["attention"]`). */
	degraded: string[];
}

/* ------------------------------------------------------------- side payloads */

export interface PastSession {
	id: string;
	name: string;
	mtime: number;
	forked: boolean;
	/** Present only on search results that matched what was said. */
	body_match?: boolean;
}

export interface PastSessionsResponse {
	sessions: PastSession[];
	degraded: string[];
}

export interface SearchSessionsResponse extends PastSessionsResponse {
	query: string;
}

export interface HistoryResponse {
	entries: TranscriptEntry[];
	has_more: boolean;
}

export interface SlashCommand {
	name: string;
	description: string;
	aliases: string[];
	arguments: "none" | "optional" | "required";
}

export interface CommandsResponse {
	commands: SlashCommand[];
}

export interface ModelEntry {
	selector: string;
	provider: string;
	model_id: string;
	name: string;
	label?: string;
	connected?: boolean;
	aggregated?: boolean;
}

export interface ModelsResponse {
	models: ModelEntry[];
}

export interface Directories {
	home: string;
	recent: string[];
	tmp?: string;
}

/* --------------------------------------------------------------- command ops */

export type CommandOp =
	| {
			op: "prompt";
			command_id: string;
			text: string;
			images?: PromptImage[];
			input_mode?: InputMode;
			input_path?: string;
	  }
	| {
			op: "steer";
			command_id: string;
			text: string;
			images?: PromptImage[];
			input_mode?: InputMode;
			input_path?: string;
	  }
	| { op: "abort" }
	| { op: "cancel"; mode?: "graceful" | "immediate" }
	| { op: "set_model"; provider: string; model_id: string }
	| { op: "set_effort"; effort: string }
	| { op: "slash"; command: string; args: string }
	| {
			op: "slash_result";
			command: string;
			args: string;
			images?: PromptImage[];
	  }
	| { op: "new_conversation" }
	| { op: "resume_session"; session_id: string }
	| {
			op: "approval_answer";
			request_id: string;
			approved: boolean;
			remember: boolean;
	  }
	| {
			op: "ask_answer";
			request_id: string;
			value: string;
			question_index: number;
	  }
	| { op: "recall_steer"; command_id: string }
	| { op: "ping" }
	| { op: "snapshot" };

export interface CommandAck {
	ok: true;
	/** Prose from the owning runtime; display verbatim, never parse. */
	detail: string;
}

export interface ApiError {
	error: string;
	code?: string;
}

/* --------------------------------------------------------------- read shapes */

export interface HealthzResponse {
	ok: boolean;
	version: number;
	/** Live registrations, not conversations. */
	sessions: number;
	/** Whether the web bundle is present; irrelevant to a native client. */
	dist: boolean;
}

export interface SeenResponse {
	ok: true;
	attention: CompletionAttention;
}

/** `GET /api/asks` — every outstanding/recent queued ask across conversations,
 *  straight off the derived index (no runtime and no session open needed). Rows
 *  are the frozen `PendingAsk` shape PLUS `session_id` + `cwd`, which is why a
 *  row drawn under another conversation's name can be answered against that
 *  conversation's own route. */
export interface AsksResponse {
	asks: PendingAsk[];
	/** True only when a wire bound dropped rows — a prefix is never drawn beside
	 *  a full count and read as complete. Absent while the route is uncapped. */
	asks_truncated?: boolean;
}

/** `GET /api/push/conversation/{handle}` — a push tap's opaque handle resolved to
 *  its conversation. A handle this machine cannot mint for a conversation it
 *  still offers is a clean 404, never a 500 (local-operator `daemon.py`
 *  `api_push_conversation`, ADR 0006 §3.1/§6.7). */
export interface PushConversationResponse {
	session_id: string;
}

/** `POST /api/push/register` — one device recorded, idempotent on identity
 *  (local-operator `push_devices.register`, ADR 0006 §3.1). `device_key` is
 *  returned ONCE, in this response only: the Settings surface stores it in the
 *  keystore and no route ever echoes it again. `registered_at` is the RECORD's
 *  own stamp, not the request's clock — a re-register keeps it. */
export interface PushRegisterResponse {
	ok: true;
	device_id: string;
	device_key: string;
	registered_at: number;
}

/** One row of `GET /api/push/devices` (local-operator `push_devices.list_devices`).
 *  Exactly the ADR's shape: `environment` and `install_id` are excluded by the
 *  core on purpose, and `name` / `credential_live` / `last_authenticated_at`
 *  are absent on rows an earlier build wrote — absence is the truth, never a
 *  null to special-case. `state` is the core's vocabulary: `live | expired |
 *  unpaired | revoked` (the descriptions are the product's own words,
 *  `push_devices.STATE_DESCRIPTIONS`). */
export interface PushDeviceRow {
	device_id: string;
	platform: string;
	app_version: string;
	registered_at: number;
	last_seen_at: number;
	state: string;
	name?: string;
	credential_live?: boolean;
	last_authenticated_at?: number;
}

/** `GET /api/push/devices` — the Settings list. `precedence` is the resolver's
 *  own string (`"revoked > unpaired > expired"`), rendered from the table the
 *  state resolver walks, so a legend cannot drift from the rows. */
export interface PushDevicesResponse {
	devices: PushDeviceRow[];
	precedence: string;
}

/** `DELETE /api/push/devices/{device_id}` — revokes the device and answers
 *  `{"ok": true}`. A TOMBSTONE, not a row removal: the row stays with
 *  `revoked_at` set (`push_devices.revoke` — that is what makes a revoke stick
 *  for the same `install_id` instead of being undone by the app's next launch),
 *  and the route is idempotent: an unknown or already-revoked id answers this
 *  same shape rather than refusing. ("Pinned" is not a device concept.) */
export interface PushDeviceDeleteResponse {
	ok: true;
}

export interface PinResponse {
	ok: true;
	/** The state the store read back, not the state asked for. */
	pinned: boolean;
}

export interface StartSessionResponse {
	ok: true;
	pid: number;
	session_id: string;
}

export interface ResumeSessionResponse {
	ok: true;
	pid: number;
	session_id: string;
}

/* ------------------------------------------------------------------- projects */

/**
 * One milestone, with a status the RELAY derived.
 *
 * `status` is never computed on the phone: `local_operator/projects.py`
 * `milestone_status` decides it (`completed` when `completed_at` is set, else
 * `overdue` when `target_date` has passed, else `upcoming`) and every relay
 * reader — the tool, the desktop, the phone daemon — calls that one function.
 * Re-deriving it from the dates here would let a chip in this app disagree with
 * a line in a tool result about which milestone is late, which is the exact
 * disagreement the single derivation exists to prevent.
 */
export interface ProjectMilestone {
	name: string;
	target_date: string | null;
	completed_at: string | null;
	/** Closed on purpose: the relay's own model declares this `Literal`, so an
	 *  unknown value is a protocol change the client should hear about rather
	 *  than silently render. */
	status: "completed" | "overdue" | "upcoming";
}

/** One stored attachment on a history entry. `path` is the stored copy's
 *  location and resolves on the MACHINE that serves the payload, not on the
 *  phone — this client renders its name and size and never its path. */
export interface ProjectAttachment {
	name: string;
	kind: string;
	path: string;
	bytes: number;
	added_at: string;
}

/** One append-only history entry, newest last (the store's own order). */
export interface ProjectUpdate {
	at: string;
	text: string;
	by: string;
	attachments: ProjectAttachment[];
}

/**
 * One row of `GET /api/projects` (local-operator
 * `server/models/desktop_projects.py` `ProjectSummary`, field for field).
 *
 * Two fields are the relay's arithmetic, never the client's:
 * `milestones_completed`/`milestones_total` are counted server-side, and
 * `live_sessions` comes from ONE machine-wide runtime scan per listing call —
 * so the board's count and the detail view's per-session dots read the same
 * number. `coordination_sessions` is a "filed by" count only; it is never added
 * to `sessions` (which IS the work set) and a renderer must not paint it as a
 * worker count.
 *
 * `description` is clamped by the relay to the listing row's own cell budget —
 * the full text is `ProjectView.description`, which the detail route serves and
 * which is NOT clamped.
 */
export interface ProjectSummary {
	id: string;
	name: string;
	description: string;
	owner: string | null;
	team: string | null;
	title: string | null;
	/** Open on purpose: a status a newer relay invented must still render (its
	 *  own trailing section) rather than vanish or crash a section sort. */
	status: string;
	tags: string[];
	start_date: string | null;
	target_date: string | null;
	completed_at: string | null;
	estimate: number | null;
	estimate_unit: string;
	milestones_completed: number;
	milestones_total: number;
	sessions: number;
	live_sessions: number;
	coordination_sessions: number;
	/** The relay's staleness verdict, computed from the configured window — the
	 *  client never compares `progress_updated_at` against its own clock. */
	progress_stale: boolean;
	progress_updated_at: number | null;
	progress_refreshed_at: number | null;
	progress_refreshed_by: string;
	updated_at: number;
}

/**
 * The full record — `GET /api/projects/{key}` and every write's own answer.
 *
 * `sessions` here is the work set (session ids); `coordination_sessions` is the
 * filing provenance list and is never a working link. Unlike the summary,
 * `description` carries the store's full text.
 */
export interface ProjectView {
	id: string;
	name: string;
	description: string;
	owner: string | null;
	team: string | null;
	title: string | null;
	status: string;
	progress: string;
	progress_updated_at: number | null;
	progress_reported_by: string;
	progress_refreshed_at: number | null;
	progress_refreshed_by: string;
	progress_stale: boolean;
	tags: string[];
	sessions: string[];
	coordination_sessions: string[];
	created_at: number;
	updated_at: number;
	start_date: string | null;
	target_date: string | null;
	completed_at: string | null;
	estimate: number | null;
	estimate_unit: string;
	milestones: ProjectMilestone[];
	updates: ProjectUpdate[];
}

/**
 * One linked session row of the composed detail view.
 *
 * `role` separates the two sets: a `work` row carries every liveness fact, while
 * a `coordination` row ("filed by") carries NONE — no `runtime`, no `subagents`,
 * no `todos` — so a renderer that gates its liveness chrome on those fields
 * cannot paint a filing as a worker. `runtime: null` is therefore the WIRED
 * shape of a coordination row, not an error.
 *
 * For `subagents` and `todos`, `null` means UNKNOWN and must never be rendered
 * as `0` (no roster sidecar, no persisted snapshot). `runtime.state` is one of
 * `live` / `wedged` / `stale` / `stopped`, and `stopped` means no runtime record
 * at all — the ordinary state of a session the operator finished with.
 */
export interface LinkedSession {
	session_id: string;
	role: "work" | "coordination";
	exists: boolean;
	title: string | null;
	created_at: number | null;
	archived: boolean;
	runtime: Record<string, unknown> | null;
	subagents: Record<string, unknown> | null;
	todos: Record<string, unknown> | null;
}

/** `GET /api/projects` — the listing, in the relay's board order. */
export interface ProjectsResponse {
	projects: ProjectSummary[];
}

/** `GET /api/projects/{key}` — one row plus its linked sessions. */
export interface ProjectDetailResponse {
	project: ProjectView;
	links: LinkedSession[];
}

/**
 * A project write that answers with the row's SUMMARY — `POST /api/projects`
 * today (and `PATCH`/`links` when a later slice adds them).
 *
 * The answer is a summary rather than the view for the same reason the listing
 * is: the write changed the row, not the row's milestones or links, and a
 * caller that needs those re-reads the detail. `ok: true` is the relay's own
 * literal (`create_payload` returns `{"ok": True, …}`) and is checked rather
 * than assumed, so a refusal body can never be read as a success.
 */
export interface ProjectWriteResponse {
	ok: true;
	project: ProjectSummary;
}

/**
 * `DELETE /api/projects/{key}` — the delete's answer.
 *
 * `deleted` is the relay's own field rather than something inferred from the
 * status: the route answers `{"ok": True, "deleted": True}` and this client
 * renders its outcome from what the relay said, not from a 2xx it hopes means
 * the row is gone.
 */
export interface ProjectDeleteResponse {
	ok: true;
	deleted: boolean;
}

/**
 * A milestone write's answer — `POST /api/projects/{key}/milestones` (add or
 * update, keyed by name) and `DELETE …/milestones/{name}`.
 *
 * The whole `ProjectView`, not the milestone: the route's answer is what the
 * milestone list re-renders from, and it carries the relay's derived statuses
 * (`milestone_status`) for every milestone, so a client that patched its own
 * copy from the request would be the second derivation this app has none of.
 */
export interface ProjectMilestoneResponse {
	ok: true;
	project: ProjectView;
}

/* ------------------------------------------------------------- schedules --- */

/**
 * One wake schedule row — one conversation's schedule, as the machine-wide
 * armed index sends it (`GET /api/schedules`; local-operator merge `5e59e0cd`,
 * `local_operator/mobile/schedules.py` mirroring `server/models/desktop_wakes.py`
 * field for field).
 *
 * `next_due_at` is epoch MILLISECONDS (the wire's clocks are mixed by design:
 * session clocks are seconds, every wake/monitor instant is milliseconds), and
 * the label is the client's to render — the desktop spent a measured defect on
 * a stray `× 1000`, so the unit is named here rather than inferred.
 *
 * `overdue_s` and `stale` come from the supervisor's own predicates (`wakes/
 * supervisor.py`), not from client arithmetic: a row can be overdue without
 * being stale (stale = past `STALE_AFTER_S`, the point the supervisor stops
 * engaging), and a surface that re-derived freshness said "1 armed, 10m
 * overdue" about a wake the supervisor had already given up on — the defect
 * class this field pair exists to close.
 */
export interface ScheduleWakeRow {
	id: string;
	/** The schedule's own prompt: what a delivery would carry. Empty is a real
	 *  state (a wake armed with no message), never an error. */
	message: string;
	next_due_at: number;
	every_ms: number | null;
	until_at: number | null;
	limit: number | null;
	fired_count: number;
	overdue_s: number;
	stale: boolean;
	/** Written by the session as it passes each instant; absent rather than
	 *  zeroed on an entry that predates them — a defaulted stamp is a
	 *  measurement the server never made. */
	last_fired_at: number | null;
	last_attempt_at: number | null;
}

/**
 * One wake-carrying conversation, with its schedules beneath it.
 *
 * One entry per SESSION rather than per schedule: the object a user opens is
 * the conversation, and a session may legally hold up to `MAX_WAKE_SCHEDULES`
 * (16) rows.
 */
export interface ScheduleWakeEntry {
	session_id: string;
	/** `resume.session_name`: the stored title, else the opening message, else a
	 *  floor composed of the shortened id and the cwd's basename. Never empty. */
	name: string;
	cwd: string;
	/** `""` for the user's own conversations, `"subagent"`/`"fork"`/`"team"` for
	 *  what the harness made — for grouping and labelling only, never hiding. */
	origin: string;
	updated_at: number;
	/** A conversation the operator STOPPED: its wakes stay armed but do not fire
	 *  until it is reopened. */
	dormant: boolean;
	/** The index has an entry and the session has no transcript on disk, so the
	 *  supervisor will refuse to engage it. Distinct from `dormant`: nothing is
	 *  parked here, the session is gone. */
	ghost: boolean;
	next_due_at: number | null;
	schedules: ScheduleWakeRow[];
}

/**
 * Whether anything on this machine would actually fire a cold wake.
 *
 * The index alone cannot answer that: the supervisor is a separate process
 * whose states — unsupported platform, plist written but launchd not
 * addressable, loaded-but-exited — are invisible from the files. A surface
 * that omitted this would invite a reader to trust a schedule nothing is
 * watching.
 */
export interface ScheduleSupervisorInfo {
	supported: boolean;
	running: boolean;
	/** The backend's own word for the state, shown verbatim. */
	detail: string;
	/**
	 * Whether the probe could speak about THIS store at all. A fourth field the
	 * contract names three of and the route sends anyway: on a store outside the
	 * real home (every sandboxed run) launchd cannot speak about it, and
	 * reporting `running: false` there would be a claim about someone else's
	 * domain. Optional, so a runtime that stops sending it reads as "the probe
	 * can speak" — the pre-field behaviour.
	 */
	verifiable?: boolean;
}

/** `GET /api/schedules`'s `wakes` half: every wake-carrying conversation. */
export interface ScheduleWakeListing {
	entries: ScheduleWakeEntry[];
	generated_at: number;
	/** Entries before the route's cap was applied, so a client can say "showing
	 *  200 of 205" rather than implying the store holds only what it was sent. */
	total: number;
	truncated: boolean;
	supervisor: ScheduleSupervisorInfo;
	/** The index DIRECTORY could not be listed. Distinguishable from an empty
	 *  store on purpose: "no wakes" over a store this process could not read is
	 *  a claim it has not earned, and the honest answer is that the read failed.
	 *  A surface that renders this as an empty list is the defect the field
	 *  exists to prevent. */
	read_error: boolean;
}

/**
 * One standing watch — one condition a conversation re-checks on an interval,
 * as the machine-wide armed index sends it (mirroring
 * `server/models/desktop_monitors.py`).
 *
 * The clock fields are best-effort and the contract says so: the index is only
 * rewritten on change events, not on every quiet tick, so `next_due_at`/
 * `due_in_s` are the last values a writer recorded and can be behind the live
 * schedule by up to a tick. The `state` word is what a surface leads with when
 * the two seem to disagree.
 */
export interface ScheduleMonitorRow {
	id: string;
	name: string;
	/** The session tool re-run each tick, and the exact arguments it is given. */
	tool: string;
	arguments: Record<string, unknown>;
	description: string;
	every_ms: number | null;
	until_at: number | null;
	notify: boolean;
	sort_lines: boolean;
	ignore: string[];
	cwd: string;
	created_at: number;
	next_due_at: number | null;
	last_check_at: number;
	checks: number;
	deliveries: number;
	consecutive_failures: number;
	disabled: boolean;
	disabled_reason: string;
	/** Seconds until `next_due_at` — NEGATIVE when the check is late, which is
	 *  ordinary between change events; `null` when no due time is recorded. */
	due_in_s: number | null;
	last_check_age_s: number | null;
	/** `"dormant"` | `"disabled"` | `"expired"` | `"armed"` — the CLI's
	 *  precedence (`cli._monitor_state_word`), passed through as an open string
	 *  so a newer runtime's word renders as its own, never mapped onto a known
	 *  one. */
	state: string;
	/** When an unavailable episode began (epoch ms; 0 = none). An episode is a
	 *  tool temporarily out of reach — an MCP server reconnecting — and it is
	 *  deliberately NOT a failure: the watch keeps retrying without counting
	 *  strikes. */
	unavailable_since: number;
	/** The §D6 health line every monitor surface shares (`monitors/store.py::
	 *  health_hint`), or `null` when there is nothing to say. Rendered, not
	 *  re-derived: the CLI, the agent tool and the TUI band read the same
	 *  sentence. */
	health: string | null;
}

/** One monitor-carrying conversation, with its monitors beneath it. */
export interface ScheduleMonitorEntry {
	session_id: string;
	name: string;
	cwd: string;
	origin: string;
	updated_at: number;
	dormant: boolean;
	ghost: boolean;
	next_due_at: number | null;
	monitors: ScheduleMonitorRow[];
}

/**
 * `GET /api/schedules`'s `monitors` half. Deliberately NO `supervisor` block:
 * monitors never engage a cold session (§10.4 — dormancy is the honest state),
 * so a supervisor-shaped field would advertise a watcher that does not exist.
 */
export interface ScheduleMonitorListing {
	entries: ScheduleMonitorEntry[];
	generated_at: number;
	total: number;
	truncated: boolean;
	read_error: boolean;
}

/**
 * `GET /api/schedules` — the machine-wide read of what is ARMED: every
 * conversation carrying wakes and monitors, in ONE answer.
 *
 * Index-backed like the asks aggregate and for the same reason — a schedule
 * outlives the runtime it was armed from, so this answers with nothing
 * running: one directory scan per store, no session opened and no owner
 * dialled. The two families share one route because they share every surface
 * they are drawn on (the TUI paints both into its single wake band), and two
 * routes would make the phone do two round trips for one screen.
 *
 * Read-only by design: arm, edit and cancel stay on the terminal/desktop plane
 * until the phone's write half ships.
 */
export interface SchedulesResponse {
	wakes: ScheduleWakeListing;
	monitors: ScheduleMonitorListing;
}

/* ------------------------------------------------------- checkpoint rail -- */

/**
 * `GET /api/sessions/{id}/checkpoints` — one conversation's rail ticks
 * (local-operator #2068, merge `ae6c9eb6`).
 *
 * The transcript rail's manifest, derived from the JOURNAL by
 * `session/transcript_index.py` — the same function the desktop rail calls —
 * and served in the desktop's own wire models (`server/models/desktop_sessions
 * .py`), so the two surfaces cannot drift. WHY A ROUTE AND NOT THE FRAMES: the
 * phone's projection is a bounded tail window, so a rail built from the
 * frames a phone happens to hold would silently mark only the tail of the
 * conversation — the manifest covers every turn, loaded or not. A conversation
 * nothing is serving still has its journal, so no runtime is needed.
 *
 * Read-only by design: the naming warm stays a desktop-plane spend, so a
 * completion's `naming` stays `pending` on this route until the desktop (or a
 * future write half) names it.
 */

/** What one rail tick is: a user message or a completed agent turn. Closed:
 *  the two shapes are the rail's whole vocabulary, and a clock on the phone
 *  cannot draw a third meaningfully. */
export type CheckpointKind = "user" | "completion";

/** A completion tick's outcome. `open` is the live tail that has no evidence
 *  of settling yet — the rail paints it as an in-progress dot rather than a
 *  tick. The other three are the attention marker's own kinds; `null` (no
 *  word on the wire) must not be read as `complete`. */
export type CheckpointOutcome = "complete" | "error" | "interrupted" | "open";

/** The manifest's own lifecycle state. `building` means a scan is in flight
 *  and `checkpoints` carries the previous scan where one exists (the client
 *  polls); `error` means the last refresh failed inside its cooldown — a
 *  journal that fails to read must never render as "no checkpoints". `stale`
 *  is reserved for a manifest deliberately served out of date (no caller emits
 *  it today; it reads like `building`); `unsupported` is the peer/remote
 *  degradation the phone route cannot produce (an unknown session is a `404`
 *  before the derivation runs). */
export type CheckpointIndexState =
	| "ready"
	| "building"
	| "stale"
	| "error"
	| "unsupported";

/** The naming overlay's state. `pending` is the pre-generation state the rail
 *  would poll on; on this route nothing warms names, so `pending` is where a
 *  completion stays until the desktop names it. */
export type CheckpointNamingState = "ready" | "pending" | "unavailable";

/** The naming overlay for one completion checkpoint. Non-ready states carry
 *  null `name`/`summary` keys — present-as-null, never absent — so a client
 *  cannot tell "not named yet" from "field this build does not know". */
export interface CheckpointNaming {
	state: CheckpointNamingState;
	name: string | null;
	summary: string | null;
}

/** One rail tick. `id` is a REAL journal entry id — the user row, or the
 *  turn's closing ANSWER row (falling back to the last message row only when
 *  the turn has no answer) — so a future click-to-jump needs no translation
 *  and forks keep their checkpoints. `seq` is the journal row ordinal (0-based),
 *  which is what places a tick proportionally in the rail WITHOUT loading the
 *  row; `turn` is 1-based. `outcome` is null unless the turn's own completion
 *  marker carried a kind, and `open` on the live unsettled tail. `naming` is
 *  present on completions only — user ticks have nothing to name (`null`, not
 *  an absent key). */
export interface CheckpointEntry {
	id: string;
	kind: CheckpointKind;
	turn: number;
	ts: number;
	seq: number;
	text: string;
	outcome: CheckpointOutcome | null;
	naming: CheckpointNaming | null;
}

/** The manifest's state block. `built_at` is the index cache file's mtime —
 *  the moment the served scan was written, not the moment this request read
 *  it. */
export interface CheckpointIndex {
	state: CheckpointIndexState;
	built_at: number | null;
}

export interface CheckpointManifest {
	session_id: string;
	index: CheckpointIndex;
	checkpoints: CheckpointEntry[];
}
