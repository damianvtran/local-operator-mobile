/**
 * TypeScript declarations for the `lop mobile` relay wire.
 *
 * A DRAFT for the native client: the shapes here are the relay's own, with the
 * field names, optionality and defaults taken from the Python source of truth
 * and checked against real captured responses.
 *
 * Sources, in the order a disagreement should be resolved:
 *   1. `local_operator/mobile/types.py`      — the dataclasses the projection is
 *                                              serialized from (`asdict`, so
 *                                              every field below is present).
 *   2. `local_operator/mobile/daemon.py`     — the route payloads (list frame,
 *                                              history, models, commands, …).
 *   3. `local_operator/mobile/projection.py` — the caps and the `details` shapes.
 *   4. `local_operator/mobile/web/src/types.ts` — the existing web client's
 *                                              reading of the same wire, which is
 *                                              where "absent means X" is spelled.
 *   5. `fixtures/relay/*.json`               — captured responses from an
 *                                              isolated daemon (see README).
 *
 * Citations are `file:line` against local-operator **`fc851a94e`** — read them with
 * `git show fc851a94e:<path>`, never from the shared checkout's working tree,
 * which carries another session's staged, partially-reverted
 * `local_operator/mobile/daemon.py` (3,696 lines in the tree vs 5,381 at HEAD),
 * so tree line numbers are wrong for every daemon citation here.
 *
 * TWO RULES THAT APPLY TO EVERY DECLARATION BELOW:
 *
 * - **A field marked `?` is one an old relay may omit, and the client MUST have
 *   a defensible reading of absence.** The relay's compatibility mechanism is
 *   "additive fields", not a versioned schema; the only version marker on the
 *   wire is `/healthz`'s `version` (=5) and the per-op protocol comments in
 *   `types.py:428-512`. Where the Python dataclass always emits a field (it is
 *   serialized with `asdict`), the field is declared required here even though
 *   a *durable* rebuild or an older relay could in principle omit it.
 * - **`null` is never `0` and never `""`.** Several fields carry a nullable
 *   number precisely because the difference is a fact: `activity_started_s`
 *   (`null` = withhold the digits, `0` = a known zero), `elapsed_s` on a
 *   subagent, `subagents_running` (`null` = "the relay cannot vouch for this
 *   row", never "no subagents"), `cumulative_parent_cost` (`null` = money we
 *   cannot state). See `types.py:637-668, 779-800, 871-897`.
 */

/* ---------------------------------------------------------------- primitives */

/** `types.py:523-542`. The unknown-kind path is deliberate: a client that does
 *  not know a newer kind must render it as *something* (the web client renders
 *  `reasoning` and unknown kinds as nothing — `web/src/transcript.tsx:259-260`),
 *  never crash. */
export type EntryKind =
  | "user"
  | "assistant"
  | "tool"
  | "notice"
  | "steer"
  | "compaction"
  | "parent_message"
  | "subagent_message"
  /** An inbound `lop send` from another local session — a distinct card, never
   *  the user's own turn. `types.py:532-534` */
  | "peer_message"
  /** The model's PRIVATE reasoning; transient by construction and never part of
   *  the durable transcript. `types.py:537-541` */
  | "reasoning"
  /** A queued ask SETTLING (design `docs/design/ask-nonblocking.md` §4): one row
   *  per answer, late answer or decline — `details.status` says which — plus a
   *  sibling kind for the deadline itself. Distinct kinds rather than a generic
   *  notice because a client must be able to key an affordance on them (the
   *  timed-out ask stays answerable) and because the shared row text already
   *  distinguishes them (`types.py:577-588`). */
  | "ask_response"
  /** A queued ask's deadline passing with nobody answering; the ask stays
   *  answerable late until `expires_at + 7 d` (`types.py:583-588`). */
  | "ask_timeout";

/** `types.py:544`. `queued` is not a synonym for `composing` or `running`:
 *  the model finished writing the call and nothing has started it yet
 *  (`types.py:566-576`). */
export type ToolState =
  | "composing"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "interrupted";

export type TodoStatus = "pending" | "done" | "blocked" | "dropped"; // types.py:548

/** `types.py:546`. `queued` = parked for a capacity slot; `parked` = paused on a
 *  gate; both are real states a phone must render. */
export type SubagentStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "parked"
  | "queued";

/* ------------------------------------------------------------------- content */

/** One image attachment on a user turn, as a REFERENCE, never bytes
 *  (`types.py:585-592`). Fetch the pixels from
 *  `GET /api/sessions/{id}/image?entry={entryId}&i={index}`.
 *  `index` counts IMAGE blocks only — a text caption does not shift it
 *  (`projection.py:416-439`). */
export interface TranscriptImageRef {
  index: number;
  mime_type: string;
}

/** Sender identity on a `peer_message` entry; all fields advisory.
 *  `web/src/types.ts:85-91`. */
export interface PeerSender {
  pid?: number;
  session_id?: string;
  conversation_name?: string;
  model_label?: string;
  cwd?: string;
}

/** `peer_send.DeliveryOutcome.details` — see `TranscriptEntryDetails.delivery`. */
export interface SendDeliveryDetails {
  state?: string;
  message_id?: string;
  wake?: boolean | string;
  attempts?: number;
  cause?: string;
  route?: string;
  reason?: string;
}

/** The expand-on-tap payload of a settled tool row.
 *
 *  NOT ALWAYS STRINGS: `args` rides through as an object and `diff` as a list of
 *  unified-diff lines (`web/src/types.ts:54-59`; `projection.py:441-462`). A
 *  client that assumes `.split()` exists on them throws at render time.
 *
 *  Caps (`projection.py:144-147, 199`): args 4 000 chars per value, output the
 *  last 8 000 chars — a readable window, not a log file. `partial` is the
 *  in-flight output tail; `severity` tints a notice; `user_run` marks bang-mode
 *  (the user ran the command themselves, so the card opens expanded). */
export interface TranscriptEntryDetails {
  args?: string | Record<string, unknown>;
  output?: string;
  diff?: string | string[];
  partial?: string;
  sender?: PeerSender;
  severity?: "info" | "warning" | "error";
  notice_kind?: "wake";
  user_run?: boolean;
  /** Bytes the model has written for this call so far (`projection.py:1895`). */
  argument_bytes?: number;
  /** The `send` tool's settled delivery state, `details.delivery`
   *  (local-operator PR #1855; the desktop tool row renders it since
   *  local-operator-ui #719). Keys: `state` (`delivered | mailbox |
   *  unconfirmed | failed`), `message_id`, `wake`, `attempts`, `cause`,
   *  `route`, `reason` (`peer_send.DeliveryOutcome.details`,
   *  `local_operator/mobile/peer_send.py`). The app reads it through
   *  `src/features/session/delivery.ts` and treats an absent or unknown
   *  `state` as "no state" — never as a failure claim.
   *
   *  CARRIAGE, as of local-operator `1d88f3466`: the core attaches this
   *  object to the tool result's persist payload (`tools/builtin.py`
   *  execute_send) but the mobile fold does NOT copy it onto the phone's
   *  row yet (`mobile/projection.py` `_tool_row_details` copies diff keys
   *  only). The app is built to this shape and the mock relay serves it;
   *  lighting it up end-to-end needs the one-line core change named in
   *  the mobile PR that added this field. */
  delivery?: SendDeliveryDetails;
  /* --- the queued-ask rows (design §4): attached to `ask_response` /
   *  `ask_timeout` entries by the fold (`projection.py`, the ask branches). --- */
  ask_id?: string;
  /** `timed_out` on `ask_timeout`; `answered` | `late` | `declined` on
   *  `ask_response`. Rendered verbatim through the shared copy table. */
  status?: string;
  /** The full question list — no surface re-derives Q&A from a sentence. */
  questions?: AskQuestion[];
  /** Secret answers hold the KEY ONLY (`[<key>]`), never a value. */
  answers?: Record<string, string[]>;
  /** Epoch milliseconds the response landed. */
  at?: number;
  /** `ask_timeout` only: how long the ask waited, in seconds. */
  waited_s?: number;
  /** `ask_timeout` only: whether the deadline was short enough to be urgent. */
  urgent?: boolean;
  /** `ask_timeout` only: the notice the MODEL was given, under it as "what the
   *  agent was told". */
  text?: string;
}

/** `types.py:551-600`. One renderable row, pre-folded by the relay. */
export interface TranscriptEntry {
  /** A message uuid for messages, and derived ids for synthetic rows
   *  (`tc-<call_id>` for a live tool row, `<message-id>:<call-id>` for a folded
   *  one — live fixtures show both forms). Also the key the image endpoint
   *  resolves against. */
  id: string;
  kind: EntryKind;
  text: string;
  /* tool rows */
  tool_call_id: string;
  tool_name: string;
  /** Defaults to `interrupted`, never `done`: a row whose state nobody set is a
   *  call nobody saw return (`types.py:566-577`). */
  tool_state: ToolState;
  summary: string;
  intent: string;
  diff_added: number;
  diff_removed: number;
  elapsed_s: number;
  error: string;
  details: TranscriptEntryDetails;
  /** `[]` when the turn carried no images — including when an image was
   *  silently dropped at ingest (see `contract.md` §8.9). */
  images: TranscriptImageRef[];
  /** Assistant rows stream: flips true on message end (`types.py:593`). */
  final: boolean;
  /** Settled streaming is not complete representation: transport caps can
   *  replace a row with a prefix while keeping its id (`types.py:595-597`). */
  text_complete: boolean;
}

export interface TodoItem {
  text: string;
  status: TodoStatus;
  reason: string;
}

/** Todos are phased; a single implicit `"Todos"` phase carries a flat list and
 *  renders headerless (`types.py:618-633`). */
export interface TodoPhase {
  name: string;
  items: TodoItem[];
}

/** One roster row (`types.py:636-677`). `transcript`/`todos` are ALWAYS empty in
 *  the aggregate projection — the relay strips them and serves them only for the
 *  active route (`daemon.py:2380-2390`); fetch them from the subagent detail
 *  route. */
export interface SubagentRow {
  job_id: string;
  label: string;
  agent: string;
  status: SubagentStatus;
  progress: string;
  /** The child's age — or `null` when this roster has NO age for it. `0.0` is a
   *  known zero and must be painted as `0s`; `null` withholds the digits
   *  (`types.py:644-659`). */
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
  transcript: TranscriptEntry[];
  todos: TodoPhase[];
  activity: string;
}

/** `GET /api/sessions/{id}/agents/{job_id}` returns the cached FULL detail plus
 *  the epoch it was captured at (`daemon.py:2368`, `web/src/types.ts:178-180`). */
export interface SubagentDetail extends SubagentRow {
  version: number;
}

/* ------------------------------------------------------------------- pending */

/** One choice in an ask picker, with the same consequence line the terminal
 *  shows (`types.py:680-698`). */
export interface AskOption {
  label: string;
  description: string;
}

/** The pinned card above the composer: an approval gate or an ask dialog.
 *  `types.py:701-747`. */
export interface PendingRequest {
  request_id: string;
  kind: "approval" | "ask";
  title: string;
  detail: string;
  /** Empty means a free-text/secret paste field rather than a picker. */
  options: AskOption[];
  /** The ask wants a credential: render a MASKED paste field. The relay rides
   *  only this flag — never the value (`types.py:719-724`). */
  secret: boolean;
  /** `Question 1 of 2` (`types.py:725-728`). */
  question_index: number;
  question_total: number;
  /** Index of the preselected option in the options AS CARRIED. A client must
   *  not re-sort `options` and keep this (`types.py:730-744`). */
  recommended: number | null;
  /** Save a secret answer to the encrypted store, not just session memory
   *  (`types.py:744`). */
  persist: boolean;
}

/* -------------------------------------------------------------- queued asks */

/** One question of a queued ask, as `PendingAsk.questions` carries it
 *  (`types.py:752-785`; `asks/queue._question_shape`). The FULL question rides
 *  the wire — id, options with their consequence lines, `multi`, `secret`,
 *  `persist` — so a client draws the form without re-deriving the ask. */
export interface AskQuestion {
  id: string;
  question: string;
  options: AskOption[];
  /** More than one option may be chosen; the answer map still holds a list. */
  multi: boolean;
  /** The model's recommendation, as an INDEX INTO `options` (the runtime hoists
   *  the recommended option to 0 and states the position; the harness option
   *  model carries no boolean to read). `null`/absent = no recommendation. */
  recommended?: number | null;
  /** The credential case: the answer is a masked paste field and the answer map
   *  holds the KEY the runtime stored, never the value (§4). */
  secret: boolean;
  /** For a secret question, save it to the operator's long-term store rather
   *  than only session memory. The flag rides; the value never does. */
  persist: boolean;
}

/** One queued ask on the phone wire (design §4, frozen; `types.py:752-785`).
 *
 *  PRESENCE IS THE CAPABILITY PROXY: `SessionProjection.asks` is absent while
 *  the runtime does not publish queued asks, and absence must render exactly
 *  today's view — never a zero badge or an empty list. A FIELD an old relay may
 *  omit is optional here and the client MUST have a defensible reading of
 *  absence (`docs/relay/types.ts`'s own two rules). */
export interface PendingAsk {
  ask_id: string;
  /** The conversation the ask belongs to. Absent on the per-session projection
   *  (the frame already addresses it); PRESENT on every row of the aggregate
   *  (`GET /api/asks`), and rows of the aggregate additionally carry `cwd`. */
  session_id?: string;
  /** The owning conversation's working directory — aggregate rows only
   *  (`asks/store.index_asks`). */
  cwd?: string;
  /** Epoch MILLISECONDS (`now_ms()`), unlike the seconds-based session clocks. */
  created_at: number;
  /** Epoch milliseconds; the countdown is rendered from it on the CLIENT clock
   *  (§5 — the wire carries no second countdown). */
  expires_at: number;
  timeout_s: number;
  /** The deadline is short enough that the ask should read as urgent. */
  urgent: boolean;
  /** The frozen status set, rendered VERBATIM — a client never infers a state
   *  from elapsed time (`types.py:479-485`). Open vocabularies are deliberately
   *  NOT closed here: a newer runtime's status passes through as its own word. */
  status: string;
  /** The runtime's statement that the response rows this status requires exist
   *  in the transcript. Drives the "delivering" copy, never a control. */
  delivered: boolean;
  questions: AskQuestion[];
  /** Secret answers hold the KEY ONLY (`[<key>]`), never a value. Absent until
   *  the ask settles (a draft map may exist on the legacy incremental path). */
  answers?: Record<string, string[]>;
  /** Which surface settled it, when another one beat this phone to the answer
   *  (§4 single-winner: the loser is told `already answered by <surface>`). */
  answered_by?: { surface?: string } & Record<string, unknown>;
  answered_at?: number;
  /** Question ids the LEGACY incremental path (design §4, A2 addendum) has
   *  already taken in this runtime for a still-open ask. They are drafts, not
   *  settled answers; absent on every ask answered the atomic way. */
  draft_question_ids?: string[];
}

/* ----------------------------------------------------------------- attention */

/** The completion-attention record, read from the shared `AttentionStore` and
 *  attached to every projection frame (`daemon.py:1825`; `web/src/types.ts:206-213`).
 *
 *  This is how a client learns a turn ENDED and whether it was seen — transcript
 *  activity and heartbeat freshness are explicitly NOT the signal
 *  (`daemon.py:1034-1037`). */
export interface CompletionAttention {
  /** `session/<session_id>`. */
  conversation_id: string;
  /** The token `POST /seen` acknowledges. Single-use per completion; a
   *  superseded one is refused with `409` + `code` (`contract.md` §4.6). */
  completion_token: string | null;
  anchor_id: string | null;
  kind: "complete" | "error" | "interrupted" | "closed" | "retired" | null;
  unseen: boolean;
  /** `[revision, ...]` — the store's own revision counter; not a projection
   *  epoch. */
  revision: [number, number];
  /** Present on captured frames: `reason`, `cause`, `notify` (`daemon.py:1857-1890`).
   *  `cause` is what `is_deliberate_cause` reads to tell a deliberate stop from a
   *  cut-off (`daemon.py:1870-1872`). */
  reason?: string;
  cause?: string;
  notify?: boolean;
}

/* --------------------------------------------------------------- the session */

/** The projection (`types.py:798-897`) — the ONLY push form on the session
 *  stream. Full snapshots, never deltas. */
export interface SessionProjection {
  session_id: string;
  /** The runtime's pid, or **0** on a durable rebuild with no live process
   *  (observed live: `fixtures/relay/sse/sse-projection-durable-after-death.json`). */
  pid: number;
  kind: string;
  conversation_name: string;
  cwd: string;
  model_label: string;
  /** `provider/model_id` — the value the model sheet submits. */
  model_selector: string;
  /** Current rung; `""` when the model has no ladder. */
  effort: string;
  effort_ladder: string[];
  streaming: boolean;
  /** What the turn is doing right now: `"thinking"`, `"responding"`, or the
   *  running tool's intent. Empty when idle — never invent a label
   *  (`types.py:820-826`). */
  activity: string;
  /** `null` = withhold the digits (no instant this fold can honestly date the
   *  phase from); `0` = a known zero painted as `0s` (`types.py:827-846`). */
  activity_started_s: number | null;
  /** Why streaming last stopped: `"completed"` or `"aborted"`. The resume
   *  affordance reads THIS, never an inference from `streaming` flipping —
   *  a finished turn flips that too (`types.py:847-858`). */
  stop_reason: string;
  /** Whether the turn `stop_reason` describes was CUT OFF rather than stopped
   *  on purpose; the composer's word follows it (`types.py:849-854`). */
  cut_off: boolean;
  /** User messages waiting for the turn boundary (`types.py:855`). */
  queued_count: number;
  /** Process gone; history still resumable. **Round 1 of this draft said this
   *  was never published `true` — that was correct at `52c1df35` and is wrong
   *  now.** #1784 (`fc851a94e`) sets it on the durable rebuild a caller built
   *  from a PROVED death (`daemon.py:2603,2647,2773`), and every live frame
   *  clears it (`daemon.py:1668`). `fixtures/relay/sse/sse_projection_ended.json`
   *  is a captured `ended: true` frame with `pid: 0`;
   *  `sse-projection-durable-after-death.json` is the same event at the old ref,
   *  where it read `false`. */
  ended: boolean;
  /** Record fresh but the control socket is unreachable. Mirrored from the
   *  entry onto the payload peers are served (`_mirror_dial_health`,
   *  `daemon.py:2030`, called on a failed dial and on a dropped reader), and
   *  cleared by the next live frame (`daemon.py:1667`). The `wedged` scan
   *  branch raises it on the *entry* (`daemon.py:2619-2620`), which is what the
   *  summary row reads; the payload mirror follows a dial/reader failure. */
  degraded: boolean;
  /** The render tail: at most `PROJECTION_TRANSCRIPT_LIMIT = 80` entries, with
   *  the conversation's opening user message pinned at the head
   *  (`types.py:980`, `projection.py:3127-3153`). Older rows page in from
   *  `/history`. */
  transcript: TranscriptEntry[];
  todos: TodoPhase[];
  subagents: SubagentRow[];
  /** The FRONT waiting request; `null` when nothing is waiting. */
  pending: PendingRequest | null;
  /** Total waiting (`>= 1` while `pending` is set): a parallel tool batch can
   *  open several approvals, so a card may need `1 of N`. The APPROVAL queue's
   *  length; an outstanding ASK is counted by `asks_open` instead — while the
   *  one-release legacy mirror is live, `pending` may also carry a queued ask's
   *  synthetic card and this count deliberately does not include it
   *  (`types.py:987-996`). */
  pending_count: number;
  /** The session's queued asks (design §4), newest first with the OPEN ones in
   *  front. PRESENCE IS THE CAPABILITY PROXY: this field and `asks_open` are
   *  ABSENT (not `[]`/`0`) unless the runtime publishes queued asks, and absence
   *  must render exactly today's view (`types.py:998-1015`). Once present,
   *  IGNORE any `pending` card whose `kind == "ask"` — it is the legacy mirror
   *  of one of these rows, and honouring both paints one ask twice. */
  asks?: PendingAsk[];
  /** The session's OUTSTANDING tally — open plus timed-out-and-answerable asks
   *  (`asks.store.OUTSTANDING_STATUSES`), passed through verbatim. Never
   *  `rows.length`: the frame's list can be a prefix of the tally. */
  asks_open?: number;
  /** True only when the frame's byte bound dropped ask rows, so the list is a
   *  PREFIX of the session's asks rather than all of them (core
   *  `session/frontend_state.py:2975-2980` `bound_ask_rows`). Absent — never
   *  `false` — when the list is complete: read absence as complete, and never
   *  compare a count against the rows drawn. NOTE: today's phone projection
   *  (`local_operator/mobile/types.py` `SessionProjection`) does not forward
   *  this flag; the field is declared so the client reacts the day it does. */
  asks_truncated?: boolean;
  usage: Record<string, number>;
  /** The spend ledger, raw. `null` = money we cannot state (never `0.0`);
   *  `child_costs` empty = no children, never "children cost nothing"
   *  (`types.py:871-887`). */
  cumulative_parent_cost: number | null;
  child_costs: Record<string, number>;
  subagent_cost: number | null;
  subagent_cost_knowledge: string | null;
  /** `unknown | exact | partial | floor` — the rung for the parent figure. */
  cost_knowledge: string;
  /** The context reading; `null`/`0` window = unknown, so no percentage is
   *  possible and the client spells `12.4k/—` (`types.py:888-897`). */
  context_tokens: number | null;
  context_window: number | null;
  context_is_estimate: boolean | null;
  /** The projection epoch. Drop a repaint whose `version` is lower inside one
   *  fenced source; re-seed without comparison on reconnect (`contract.md` §6.5). */
  version: number;
  /** Attached by the relay on every published frame (`daemon.py:1825`). */
  attention: CompletionAttention;
}

/* --------------------------------------------------------------- session list */

/** One row of the list. Section is the SHARED `active` rule, not "a live entry
 *  exists" — a durable-only conversation with an unseen completion is Active on
 *  every surface (`daemon.py:958-964`, `daemon.py:351-463`). */
export interface SessionSummary {
  session_id: string;
  section: "active" | "previous";
  /** The shared durable pin store (`sidebar-pins.json`) — the same state the
   *  TUI's F10 writes (`daemon.py:834-867`). */
  pinned: boolean;
  conversation_name: string;
  cwd: string;
  model_label: string;
  streaming: boolean;
  needs_attention: boolean;
  /** A turn finished while nobody was viewing the session and it has not been
   *  opened since. Cleared by `POST /seen` (`daemon.py:1037`). */
  unseen: boolean;
  pending_kind: "approval" | "ask" | "";
  /** The runtime's own phrase while it is draining after a signal. RANKED, not
   *  drawn: mark from this rather than from the counts (`daemon.py:973-982`). */
  leaving: string;
  /** The build pair while an idle runtime swaps to the build on disk — alive and
   *  accepting messages that will run (`daemon.py:984-990`). */
  updating: string;
  /** **`null` = "not reported", never `0`.** The relay reports `null` for a row
   *  it cannot vouch for (degraded dial, stale heartbeat, leaving runtime) — so
   *  a client hides both marks on `null` (`daemon.py:1003-1020`). */
  subagents_running: number | null;
  subagents_queued: number | null;
  /** The daemon's receipt that this session's PROCESS IS GONE: the conversation
   *  is over and its history stays resumable (`daemon.py:906-914,1021`). True
   *  only for an end THIS daemon observed — a durable-only row reports `false`,
   *  measured in `fixtures/relay/probes/durable-only-row.json`, and that `false`
   *  is "not observed to end", never "running". Absent on a relay older than
   *  `fc851a94e`; read absence exactly like `unseen`'s — as `false`. */
  ended?: boolean;
  /** The relay's own dial to this session is down: record fresh, socket
   *  unreachable, so nothing the row shows is being confirmed right now
   *  (`daemon.py:906-914,1022`). Measured to fire ~48 s into a frozen runtime
   *  (`fixtures/relay/probes/degraded-row-signal.json`); it is cleared by the
   *  next live frame, so clear the affordance on the flag, not on a timer. */
  degraded?: boolean;
  /** Open todos: `pending` + `blocked` (`daemon.py:1023-1028`). */
  todos_open: number;
  /** Outstanding queued asks on this row (design §4/§5.0), from the runtime's
   *  own count (`daemon.py:1288-1310`). ABSENT — never `0` — while the runtime
   *  does not publish asks: presence is the capability proxy, and a badge may
   *  not count a list the relay cannot vouch for. Distinct from `pending_kind`,
   *  which stays the APPROVAL signal. */
  asks_open?: number;
  mtime: number;
  /** The same value the rank used, so wire and order cannot disagree about a
   *  row's birth (`daemon.py:1029-1033`). */
  created_at: number;
  /** The attention record's `kind` for this conversation (`""` when none). */
  completion_kind: string;
}

/** Capabilities ride the SAME list frames (`daemon.py:3485-3518`): one answer,
 *  two transports. `features` is the lifted feature-flag dict; an absent key
 *  means "this build does not have it", never an error. `stt` decides whether a
 *  phone shows a mic — an OLD relay omits the whole object, and absence reads
 *  exactly like `available: false` (`web/src/types.ts:437-451`). */
export interface SttCapability {
  available: boolean;
  path: string | null;
  reason?: string;
}

export interface Capabilities {
  features?: Record<string, unknown>;
  stt?: SttCapability;
}

/** The payload of `GET /api/sessions` and of every `sessions` SSE frame —
 *  byte-identical by construction (`daemon.py:3485-3518`). */
export interface SessionListFrame {
  sessions: SessionSummary[];
  /** Degradation markers for the DURABLE half of the listing, not for a
   *  session: `["sessions"]` (the store could not be walked) and/or
   *  `"attention"` (the attention store could not be read). Empty = healthy
   *  (`daemon.py:717-743`, `daemon.py:146`). */
  degraded: string[];
  capabilities: Capabilities;
  /** The machine's unread aggregate, a TOP-LEVEL sibling of `degraded` — not
   *  a `capabilities` flag, where a missing key means "this build does not have
   *  it" (ADR 0006 §1.1, `daemon.py` `unread_block()`). Additive: an older
   *  relay omits the block, and **absence means "unknown", never 0**. `count`
   *  is absent when `degraded` is non-empty. */
  unread?: UnreadBlock;
}

/** The frame-level unread aggregate. `count` is the §1.4 badge number:
 *  conversations with unread notifications, over the listing's own snapshot —
 *  a conversation with three unread completions counts once. */
export interface UnreadBlock {
  /** Absent when `degraded` is non-empty. Never read absence as `0`. */
  count?: number;
  /** `AttentionStore.revision()` — an EQUALITY token, never an order: compare
   *  it for change; never sort by it (`daemon.py` `unread_block()`). */
  revision: [number, number, number];
  /** `["attention"]` when the completion-receipt store could not be read. */
  degraded: string[];
}

/* ------------------------------------------------------------- side payloads */

/** `GET /api/sessions/past`. `forked` marks a fork still wearing its parent's
 *  title — otherwise byte-identical to the parent row (`daemon.py:4756-4790`). */
export interface PastSession {
  id: string;
  name: string;
  mtime: number;
  forked: boolean;
  /** Present only on search results: the row matched on what was SAID, not on
   *  its name/id (`daemon.py:4793-4839`). */
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
  /** The page immediately OLDER than `before`, chronological within the page. */
  entries: TranscriptEntry[];
  has_more: boolean;
}

/** `GET /api/commands` (`daemon.py:3303-3325`). TUI chrome (`exit`, `quit`,
 *  `clear`) is excluded because it is meaningless on a phone. */
export interface SlashCommand {
  name: string;
  description: string;
  aliases: string[];
  arguments: "none" | "optional" | "required";
}

/** One row of `GET /api/models`. **The array order IS the ranking** (direct
 *  providers first, newest version first, aggregators last) — re-sorting or
 *  regrouping throws that away (`daemon.py:5046-5087`,
 *  `web/src/types.ts:364-399`). */
export interface ModelEntry {
  selector: string;
  provider: string;
  model_id: string;
  name: string;
  /** The picker's resolved label exactly as the desktop spells it — a parity
   *  contract, not a display string. Render `name`. */
  label?: string;
  /** Whether a credential exists that can run this model now. */
  connected?: boolean;
  /** The provider RESELLS the model rather than serving it. */
  aggregated?: boolean;
}

/** `GET /api/directories` (`daemon.py:4350-4359`). `tmp` is the RESOLVED temp
 *  dir, which the start gate also compares against (`daemon.py:4842-4862`). */
export interface Directories {
  home: string;
  recent: string[];
  tmp?: string;
}

/* --------------------------------------------------------------- command ops */

/** A pasted/dropped image on the wire (`web/src/types.ts:424-428`). */
export interface PromptImage {
  data_b64: string;
  mime_type: string;
}

/** How a message was produced (mobile STT). Sent explicitly by clients that
 *  compute it; ABSENT is the legacy reading — a producer that did not know the
 *  vocabulary. The relay forwards it only to an owner that advertised the
 *  capability (`daemon.py:2861-2868`, `types.py:82-107`). */
export type InputMode = "typed" | "dictated" | "mixed";

/** The body of `POST /api/sessions/{id}/command`. The `op` field is popped and
 *  validated first; everything else is validated per op by
 *  `validate_control_frame` (`types.py:208-426`).
 *
 *  Ops the relay accepts from HTTP and their exact required fields: */
export type CommandOp =
  /** Durable, idempotent user turn. `command_id` must be a UUID and is
   *  MANDATORY over HTTP (`daemon.py:3952-3957`). `text` may be empty only when
   *  an image carries data. */
  | {
      op: "prompt";
      command_id: string;
      text: string;
      images?: PromptImage[];
      input_mode?: InputMode;
      input_path?: string;
    }
  /** Idempotent mid-turn injection; same identity rules as `prompt`. Answers
   *  `detail: "steering queued"` when the turn is holding it for a boundary. */
  | {
      op: "steer";
      command_id: string;
      text: string;
      images?: PromptImage[];
      input_mode?: InputMode;
      input_path?: string;
    }
  /** The stop button; never kills the session. On a mixed-version runtime it can
   *  be refused with `422` and the refusal names the op-form to use. */
  | { op: "abort" }
  /** Boundary-respecting stop for a supervising agent: lands after the in-flight
   *  tool batch, before the next model request. `immediate` is the explicit
   *  opt-in to `abort` semantics (`types.py:431-443`). */
  | { op: "cancel"; mode?: "graceful" | "immediate" }
  | { op: "set_model"; provider: string; model_id: string }
  | { op: "set_effort"; effort: string }
  /** The off-terminal subset of slash commands. Many are refused with
   *  `422 "<name> is terminal-only here"` — use `slash_result` for the routed
   *  form (`web/src/types.ts:468-475`). */
  | { op: "slash"; command: string; args: string }
  /** The ROUTED slash op (authority-bearing; may be refused with
   *  `AUTHORITY_REFUSAL_CODES`). Answers with the command's typed outcome. */
  | { op: "slash_result"; command: string; args: string; images?: PromptImage[] }
  /** REFUSED over the relay: `422 "start a new session from the session list"`
   *  (live `fixtures/relay/http/op-new-conversation.json`). Use
   *  `POST /api/sessions/start`. */
  | { op: "new_conversation" }
  /** REFUSED over the relay: `422 "pick the session from the session list
   *  instead"` (live `fixtures/relay/http/op-resume-session.json`). Use
   *  `POST /api/sessions/resume`. */
  | { op: "resume_session"; session_id: string }
  | {
      op: "approval_answer";
      request_id: string;
      approved: boolean;
      remember: boolean;
    }
  /** `question_index` is the question the card was showing; the relay rejects an
   *  answer for a question the picker has advanced past, so a tap in flight
   *  during a terminal advance is never recorded against the wrong question. */
  | {
      op: "ask_answer";
      request_id: string;
      value: string;
      question_index: number;
    }
  /** THE QUEUED-ASK FAMILY (design §4). `ask_respond` is ATOMIC per ask: one map
   *  of question id → chosen labels for the WHOLE ask — a partial map is refused
   *  rather than half-applied, so a multi-question ask settles in one write
   *  (`types.py:337-355`). */
  | { op: "ask_respond"; ask_id: string; answers: Record<string, string[]> }
  /** The explicit no — "decide yourself"; the agent is told (design §2.4). */
  | { op: "ask_decline"; ask_id: string }
  /** Dismiss is VIEW-ONLY: it removes the row from the queue's front end and
   *  injects nothing — no turn is bought. Offered only on a timed-out ask, so
   *  it cannot shadow an in-window answer. */
  | { op: "ask_dismiss"; ask_id: string }
  /** Unsend one queued steering message by identity (Esc-recall parity). */
  | { op: "recall_steer"; command_id: string }
  /** Ask for a fresh welcome-equivalent projection. */
  | { op: "snapshot" };

/** A command body plus the optional stage-D signature fields. The relay DROPS
 *  `operator_cap` from any HTTP body (it mints its own when it is the spawner),
 *  and ADMITS these three — a signature over a challenge this runtime minted for
 *  this connection, action and request id (`daemon.py:3905-3938`). */
export type SignedCommand = CommandOp & {
  operator_sig?: string;
  operator_key_id?: string;
  operator_cert?: string;
};

/** The uniform success body of the command route. `detail` is prose from the
 *  owning runtime or the relay; a client may display it verbatim but must not
 *  parse it. */
export interface CommandAck {
  ok: true;
  detail: string;
}

/* --------------------------------------------------------------------- errors */

/** Every failure body is `{ error: string }`; `code` is additive and appears
 *  only where the client must DECIDE rather than display — the authority
 *  refusals (`operator_authority_required`, `operator_authority_unconfigured`),
 *  the superseded completion token, `stt_unavailable`, and the project route's
 *  typed refusals (`daemon.py:4024-4038, 3582-3588, 4390-4394, 4441-4447`). */
export interface ApiError {
  error: string;
  code?: string;
}

/** The authority refusal codes, spelled once so two lists cannot drift
 *  (`web/src/api.ts:46-58`). */
export declare const AUTHORITY_REFUSAL_CODES: readonly [
  "operator_authority_required",
  "operator_authority_unconfigured",
];

/* --------------------------------------------------------------------- status */

export type HttpStatus =
  | 200
  | 303
  /** `/api/*` unauthenticated. On an SSE stream this status is NOT visible to
   *  an `EventSource`-shaped client. */
  | 401
  /** Cross-origin mutation; unknown tunnel host (gateway); revoked device. */
  | 403
  /** Unknown session for a read; no such past session; no such image; unknown
   *  subagent; no host route. */
  | 404
  /** No saved messages yet, so a pin is refused; session not connected; a real
   *  but superseded completion token; project status conflicts. */
  | 409
  /** Upload too large (transcribe). */
  | 413
  /** Malformed/unknown op, bad shape, refusal with prose. */
  | 422
  /** Spawn, catalogue, or a runtime that returned nothing usable. */
  | 500
  | 502
  /** Voice input unavailable; mobile bundle not built. */
  | 503
  | 504;
