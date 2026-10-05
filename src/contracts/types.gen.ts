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
	attention?: CompletionAttention;
}

/* --------------------------------------------------------------- session list */

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
	/** Absent on an older relay; `createdAt()` falls back to `mtime`. */
	created_at?: number;
	completion_kind: string;
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
