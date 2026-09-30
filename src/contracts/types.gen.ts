/**
 * Generated mirror of the `lop mobile` relay wire types.
 *
 * Source of truth: `local_operator/mobile/{types,daemon,projection}.py` in
 * `damianvtran/local-operator`, which serialises its dataclasses with `asdict`
 * (so every declared field is present in a frame this build emits). Seeded from
 * `docs/relay/types.ts`, which is the annotated reading of the same wire and
 * carries the `file:line` citations; this file is the field-for-field mirror the
 * runtime schemas are checked against.
 *
 * Committed on purpose: a contributor without a local-operator checkout can
 * still build. `scripts/gen-relay-types.mjs` (a later stream) regenerates it and
 * CI reports drift, because the relay may legitimately move ahead of the app.
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

export interface TranscriptEntryDetails {
	/** An object as often as a string — never assume `.split()` exists. */
	args?: string | Record<string, unknown>;
	output?: string;
	diff?: string | string[];
	partial?: string;
	sender?: PeerSender;
	severity?: "info" | "warning" | "error";
	notice_kind?: "wake";
	user_run?: boolean;
	argument_bytes?: number;
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
	pending_count: number;
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
