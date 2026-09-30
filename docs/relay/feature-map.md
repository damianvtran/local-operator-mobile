# Feature map: what the native client must cover, and at what priority

The feature inventory for `v1` of the native app, built from the existing mobile
web client (the behaviour baseline), the TUI parity audit in
[damianvtran/local-operator#1598](https://github.com/damianvtran/local-operator/issues/1598),
and the relay contract in [`contract.md`](contract.md).

Priority is scoped to the program's own bar — *"every key relay feature"* for a
native v1:

- **P0** — the v1 bar. Without it the app is not a working relay client.
- **P1** — parity wins that a phone user will feel immediately, still v1-sized.
- **P2** — deliberately after v1 (matches #1598's phase 5 and its non-goals).

Citations: `web/src/…` is `local_operator/mobile/web/src/…` in local-operator
@ `52c1df35`; `daemon.py` is `local_operator/mobile/daemon.py`. The web client's
feature inventory below was audited file-by-file; where the shipped client and
the docs disagree, the code wins and the disagreement is recorded in §5.

---

## 1. Screen and feature inventory

### 1.1 Auth and connection (`P0`)

| Feature | Behaviour to port | Routes | Edge cases to keep |
| --- | --- | --- | --- |
| First run | Ask for the relay password (or a tunnel URL) and establish the session | `GET /login` (detect the form), `POST /login` form body `password` → `303` + `Set-Cookie` | Wrong password = `401` **HTML**, not JSON (`daemon.py:3355-3361`). `Secure` is set only over TLS (`daemon.py:3362-3371`), so the client needs two cookie policies: loopback plain HTTP vs tunnel HTTPS |
| Session loss | Any `/api/*` answering `401` clears private state and returns to the unlock screen | any `/api/*` | The web client's rule (`web/src/api.ts:64-70,77-81`): clear private storage, then reload. **A native client must also detect `401` on the SSE streams** — an `EventSource`-shaped client cannot see the status and retries forever (`web/src/store.ts:174-184` is exactly that bug) |
| Health | Cheap reachability probe that needs no auth | `GET /healthz` | `{ok, version, sessions, dist}` — `dist:false` means the relay has no web bundle, which does not affect the native client |
| Logout | Clear the cookie and all local private state | `GET /logout` → `303` + `Set-Cookie` deletion + `Clear-Site-Data: "storage"` | The relay clears *all* browser storage; a native client must clear drafts, envelopes and device keys itself (native has no `Clear-Site-Data`) |
| Tunnel mode | Reach the same relay through a Radient tunnel, with no relay password on the phone | see [`tunnel-edge.md`](tunnel-edge.md) | The local gateway injects the relay cookie itself (`local_operator/tunnels/gateway.py:545-548`), so the app must NOT expect to log in when it is on the Radient route. Decide the auth mode from the reachability probe, not from a user setting |

### 1.2 Session list (`P0`)

| Feature | Behaviour | Routes | Edge cases |
| --- | --- | --- | --- |
| Live list | Fully repainted list, no polling | SSE `GET /api/sessions/events`, event `sessions` | The very first frame is a full snapshot, so a cold start can render from SSE alone |
| Rows | One card per conversation: name, cwd, model label, streaming shimmer, attention badge, unread mark, subagent chip | same stream; fields in §3 | `conversation_name` empty → render "untitled" (`web/src/screens/session-list.tsx:357-364`) |
| Sections | `★ Pinned`, `Active Sessions`, `Previous Sessions`, in the relay's own order | row `pinned` + `section` | The client must NOT re-sort or re-rank: the relay sorts on the shared catalogue key so the phone, TUI and desktop agree (`daemon.py:351-464, 1016-1017`) |
| Search the loaded list | Case-insensitive substring over name/id/cwd | local | The web client does this locally; the server-side search route is for *past* sessions |
| Pin / unpin | Long-press a row, or the ☆/★ in the session header | `POST /api/sessions/{id}/pin` `{pinned: bool}` | Desired state, not a toggle (`daemon.py:3606-3611`). `409` when the conversation has no saved folder yet; the body is `{"error": "no saved messages yet — pin it after you send one"}`. The optimistic star must not reorder the row — only the daemon's confirmed frame moves it (`web/src/store.ts:60-79`) |
| Unread mark | An outcome arrived while nothing was viewing the session | row `unseen` | Cleared by the seen handshake, not by opening the screen |
| Needs-attention badge | An approval or ask is waiting | row `needs_attention`, `pending_kind` | `pending_kind` is `"approval" | "ask" | ""` |
| New session | cwd picker (home, recent, tmp) + optional provider/model | `GET /api/directories`, `POST /api/sessions/start` | `400` outside home/tmp; the relay spawns a supervised child and returns `{ok, pid, session_id}` |
| Past sessions | Resumable conversations | `GET /api/sessions/past` | `degraded: ["sessions"]` means the store could not be walked — **not** "there are none". Rows carry `forked` for a fork still wearing its parent's title |
| Search past conversations | Full-text-ish search including message bodies | `GET /api/sessions/search?q=&limit=` | `body_match` marks a hit made on what was said rather than the title. Empty `q` returns the recent rows |
| Resume | Open a past conversation and continue it | `POST /api/sessions/resume` | `404` `no such past session`; the resume spawns the runtime **with the account home as cwd** (`daemon.py:4230-4231`) — see §5 |
| Theme | Dark/light (31 palettes in the web client) | local | The native app should carry the Local Operator palette contract, not invent one (design stream owns the token set) |

### 1.3 Session view (`P0`)

| Feature | Behaviour | Routes | Edge cases |
| --- | --- | --- | --- |
| Projection | Full snapshot repaints of transcript, todos, subagents, pending, spend, context | SSE `GET /api/sessions/{id}/events`, event `projection` | Frames are repaints, never deltas; the client renders the newest frame it holds |
| Transcript rows | user / assistant markdown / one-line tool rows / steer / notice / compaction / parent / subagent / peer cards | projection `transcript` | Unknown `kind` → render nothing rather than crash (`web/src/transcript.tsx:258-259`); each row is wrapped in a boundary so one bad row cannot unmount the screen (`web/src/components/row-boundary.tsx:26-31`) |
| Tool row expand | Tap to expand args + output + error + diff counts | projection `details` | The payload is a **bounded window** (8 000-char output tail, 4 000-char args, `projection.py:144-147`); args are hidden when a diff exists; `details.args` may be a dict and `details.diff` a list, so a client must normalize (`web/src/types.ts:54-60`) |
| Working line | What the turn is doing now + a clock | projection `streaming`, `activity`, `activity_started_s` | `activity_started_s === null` means **withhold the digits**; `0.0` is a known zero (`types.py:818-834`) |
| History paging | Scroll up to back-fill older rows | `GET /api/sessions/{id}/history?before=&limit=` | `limit` clamps to 1..200; an unknown `before` returns an empty page with `has_more:false`; a relay-side fold failure returns an empty page, not a `500` (`daemon.py:1904-1906`) |
| Image attachments | Render user-turn images lazily | projection `transcript[].images` + `GET /api/sessions/{id}/image?entry=&i=` | Needs a **live** generation: for a previous conversation the route 404s (`daemon.py:3782-3784`), so previous-chat images cannot render — a real limitation to design around |
| Todos panel | Phased task list, held shut while a request is pending | projection `todos` | A single implicit phase named `Todos` renders headerless (`types.py:618`) |
| Subagents panel | Direct children with status + elapsed | projection `subagents` | Only direct children (`parent_job_id === null`); `elapsed_s === null` = withhold; the failed count stays visible while held shut |
| Subagent drill-down | A child's own transcript, todos and lineage | `GET /api/sessions/{id}/agents/{job}` (+ `…/history`) | Detail is served from the relay's cache; a miss triggers a durable fold then a `404` (`daemon.py:3671-3688`). The aggregate roster row carries **no** prompt/result/transcript (`daemon.py:2298-2310`), so the drill-in must fetch |
| Pending card | The approval or ask is the most prominent thing on screen | projection `pending`, `pending_count` | Two kinds with different answers; multi-question asks need "Question 1 of 2" and a masked field when `secret` |
| Composer | Send / steer / stop / resume, model + effort chips, slash sheet | `POST …/command` + `GET /api/commands` + `GET /api/models` | `op` is `prompt` when idle, `steer` while streaming (`web/src/components/composer.tsx:756-757`) |
| Pending echo row | Paint the message immediately, reconcile by `command_id` | local + `command_id` | Never resolves twice; withdrawn on failure; the retained-envelope retry is a different affordance (§4) |
| Stop | `abort` while streaming | `{op:"abort"}` | On an idle session it answers `200 "no turn was running"` (live) |
| Resume affordance | After an interrupted turn | `stop_reason`, `cut_off` | `stop_reason === "aborted"` gates the whole affordance; `cut_off:true` says the harness cut the turn rather than the user. Copy must be "turn cut off" vs "interrupted" |
| Seen handshake | Opening a conversation clears its unread mark, but only once the completion row is genuinely visible | `POST /api/sessions/{id}/seen` `{completion_token}` | The token comes off `attention.completion_token`. `409` + `code: "superseded"` when a newer completion has replaced it (live `seen-real-token.json`). The web client refuses to acknowledge until the anchor row is on screen and the app has focus (`web/src/use-completion-view.ts:48-62`) |
| Pin from the header | Same store as the list long-press | `POST …/pin` | Both surfaces read the same optimistic mark so the ☆ and the section cannot disagree |

### 1.4 Composer detail (`P0` unless noted)

| Feature | Behaviour | Edge cases |
| --- | --- | --- |
| Draft persistence | Keep an unsent draft per conversation across launches | The web client uses `localStorage`; a native client should use encrypted storage, because a draft is private content |
| Slash commands | `/` opens the sheet; `GET /api/commands` supplies name, description, aliases, `arguments` (`none`/`optional`/`required`) | `exit`, `quit`, `clear` are excluded as TUI chrome (`daemon.py:3235`) |
| Routed slash | Prefer `slash_result` for anything authority-bearing; `slash` covers only the off-terminal subset | `slash` answers `422 "/<name> is terminal-only here"` (live). `/approvals auto` is the dead end this exists to remove (`web/src/types.ts:456-463`) |
| Model sheet | Ranked model list, `connected` marks | **The array order IS the ranking** — never re-sort or regroup (`web/src/types.ts:352-359`). `502` when the catalogue cannot be built |
| Effort | One rung from the model's ladder | `422 "mock has no reasoning-effort levels; drop --effort"` when the model has none (live) |
| Image attachments (`P1` on native gestalt, `P0` for parity) | Attach from the picker/camera; send as `{data_b64, mime_type}` | Relay refits to fit one socket line; ingest silently drops an undecodable image (`contract.md` §8.9-8.10) |
| Voice input (`P1`) | Record and transcribe | `POST /api/transcribe` multipart `audio`; 20 MB cap (`daemon.py:156`); allowlist of 7 mime types; `503 {"code":"stt_unavailable"}` when the machine cannot transcribe; the relay's own copy is surfaced verbatim for 402/413/422/503 (`web/src/components/composer.tsx:117-122`) |
| Bang-mode | Rows the user ran themselves open expanded | projection `details.user_run` (`web/src/types.ts:79-82`) |
| Queued count | "N queued" while steers wait | projection `queued_count` |

### 1.5 Subagent (agent) view (`P1`)

| Feature | Behaviour | Edge cases |
| --- | --- | --- |
| Detail poll | Re-fetch on every projection `version` change and on reconnect | One request in flight, coalesce catch-up (`web/src/detail-loader.ts:10-72`); a lower `version` never replaces a higher one |
| Child transcript | Lazy page of the child's own transcript | `before`/`limit`; polled while running in the web client (1.5 s) |
| Outcome block | completed / failed / queued / cancelled / parked each get their own copy | `error_text` is the only copy of a parent-side failure (it is never in the child transcript, `projection.py:170-181`) |
| Read-only rule | Steering happens in the parent's composer | A child view must offer "Open parent to steer" rather than a composer |
| Lineage sheet | Root, ancestors, current, peers, children | Missing roster ids are skipped |

### 1.6 Parity gaps from #1598 (TUI features with no mobile equivalent)

Priority follows #1598's own suggested order, adjusted for what a phone can show.

| Area | TUI | Priority | Notes for v1 |
| --- | --- | --- | --- |
| Spend + context glance | status band, `/context` | **shipped** (phase 1, PR #1758) | Already on the phone; the native app should port the same Python spellings and ship the same parity fixtures rather than re-deriving them |
| Provider quota (`/usage`) | `usage_panel` | `P1` | Needs a relay-side fetch + cache, not just a render |
| Tool-card detail + copy actions | `tool_card`, `copy_picker` | `P1` | The expand payload exists but is bounded; copy actions are net-new (native gives a system share/copy sheet cheaply) |
| Session info / report | `info_panel`, `report_view`, `session_panel` | `P1` | A sheet off the session header |
| Sidebar: pins, subagent layer | `session_sidebar` | `P0` for pins (already a route), `P1` for the layer view | Pins are the one sidebar feature with a relay route today |
| Wakes / schedules | `wake_panel` | `P2` | No relay route; needs control-plane work first |
| Settings | `settings_view` | `P2` | `capabilities.features.settings` exists on the relay but no phone route consumes it |
| Move session | `move_picker` | `P2` | No relay route |
| Org chart / team view | `org_chart_view` | `P2` | No relay route |
| Analytics | `analytics_panel` | `P2` | No relay route |
| Aside panel | `aside_panel` | `P2` | No relay route |
| Parity guard | new TUI panel with no mobile counterpart is flagged | `P1` (cross-cutting) | Still open upstream; the native repo should carry its own version of the check once the feature set settles |

Also worth knowing: the relay already exposes a feature-flag map
(`capabilities.features`, live `fixtures/relay/http/sessions-empty.json`) and the web
client reads none of it — a native client can use it to gate Phase-N surfaces by
relay build rather than by app version.

---

## 2. Every session state, how it is derived, and what to render

Two relays concepts are easy to conflate and must not be: the **list row**
(`SessionSummary`, one per conversation) and the **projection** (`SessionProjection`,
one per open conversation).

| # | State | Derived from | What the user sees (baseline: web client) |
| --- | --- | --- | --- |
| 1 | **Loading (cold)** | SSE not yet connected, no frame | The list screen shows an empty-state message; the session screen shows a placeholder. There is no spinner contract |
| 2 | **Empty** | `sessions: []` and the stream is connected | "No sessions yet" style empty state |
| 3 | **Error / offline** | SSE `onerror` or a failed fetch | The web client keeps the last good snapshot and only flips a `connected` flag; it shows no banner on the list. A native client should do better — this is one of the two places the web client is visibly thin |
| 4 | **Degraded listing** | `degraded: ["sessions"]` / `["attention"]` | **Nothing renders this today.** The client must at minimum not present an empty list as "you have no conversations" when the store could not be read |
| 5 | **Unread** | row `unseen: true` (+ `completion_kind`) | Calm accent "new" mark; cleared by the seen handshake |
| 6 | **Needs attention** | `needs_attention: true`, `pending_kind: "approval"|"ask"` | Badge on the row; the pending card pinned above the composer |
| 7 | **Streaming / working** | `streaming: true`, `activity`, `activity_started_s` | Shimmer on the row; the working line on the session screen |
| 8 | **Queued steer** | `queued_count > 0` | "N queued" near the composer; the pending echo says "queued — sends when this step finishes" |
| 9 | **Pending approval** | `pending.kind === "approval"`, `pending_count` | Card above the composer: title (`bash`), `detail` (`run: sleep 20`), approve/deny, `remember`; "1 of N" when `pending_count > 1` (live `sse-projection-pending-approval.json`) |
| 10 | **Pending ask** | `pending.kind === "ask"` | Question, options with their consequence lines, "Question 1 of 2", masked paste field when `secret` and the "not stored in transcript" affordance; `persist` is the save intent |
| 11 | **Subagent running** | roster `status: "running"|"queued"|"parked"`; row `subagents_running`/`subagents_queued` | Chip on the row and the panel; `null` counts mean "not reported" — hide the chip, never show 0 |
| 12 | **Leaving** | row `leaving` (a phrase) | A signalled runtime finishing in-flight work. The web client uses it only to suppress the subagent chip; a phone row should say "Leaving…" |
| 13 | **Updating** | row `updating` (a build pair) | An idle runtime moving to the build on disk — **it still accepts messages**; the row must not look idle |
| 14 | **Wedged** | heartbeat older than 45 s (`session/runtime/types.py:416-417`) | **Not observable through the relay** — see §5.2. Treat as "stopped responding" after SSE silence |
| 15 | **Ended** | runtime reaped; the row moves to `section: "previous"`, one final durable frame is published | Offer resume. **`ended` is `false` even in that final frame** (live `sse-projection-durable-after-death.json`), and the web client renders nothing at all — a native client should key on `section` and offer resume from the durable transcript |
| 16 | **Aborted / interrupted** | `stop_reason === "aborted"`, `cut_off` | "interrupted — tap to resume" / "turn cut off — tap to resume" |
| 17 | **Completed turn** | `stop_reason === "completed"`, `attention.kind === "complete"` | No affordance; the completion notice row appears in the transcript |
| 18 | **Attention kinds beyond complete** | `attention.kind ∈ {error, interrupted, closed, retired}` | The relay appends a `notice` row whose text and severity come from `harness/rows.py` (`daemon.py:1838-1863`); `error`/`retired` also set `stop_reason: "aborted"` and `cut_off` |
| 19 | **Provisional wake** | a prompt accepted on a durable-only conversation | The row moves to Active at once and the conversation is re-materialised; the relay spawns a host process (live `command-prompt-wake-durable.json`) |
| 20 | **Degraded session (socket unreachable, record fresh)** | `entry.degraded` — **never published** | Not observable; see §5.2 |
| 21 | **Unauthenticated** | `401` on any `/api/*` | Return to the unlock screen after clearing private state |
| 22 | **Command refused** | `422` (prose, sometimes + `code`), `409` not connected, `502`/`504` ambiguous | The web client's ladder: retry-and-keep-the-text on 502/504/408, hand the text back on a pre-admission 4xx, and name the retained instruction |
| 23 | **Wake window / provisional active** | relay-internal; appears as a normal `active` row | Nothing special to render |

---

## 3. The row and projection fields a state machine reads

`SessionSummary` (live `fixtures/relay/sse/sse-list-frame.json`):

```
session_id, section ("active"|"previous"), pinned, conversation_name, cwd,
model_label, streaming, leaving, updating, needs_attention, pending_kind,
subagents_running (number|null), subagents_queued (number|null), todos_open,
mtime, created_at, completion_kind, unseen
```

`SessionProjection` (live `fixtures/relay/sse/sse-projection-seed.json`):

```
session_id, pid, kind, conversation_name, cwd, model_label, model_selector,
effort, effort_ladder, streaming, activity, activity_started_s (number|null),
stop_reason, cut_off, queued_count, ended, degraded, transcript[], todos[],
subagents[], pending (object|null), pending_count, usage{}, attention{},
cumulative_parent_cost (number|null), child_costs{}, subagent_cost,
subagent_cost_knowledge, cost_knowledge, context_tokens, context_window,
context_is_estimate, version
```

`attention` (live `fixtures/relay/sse/sse-attention-complete.json`):

```
conversation_id, completion_token (string|null), anchor_id (string|null),
kind ("complete"|"error"|"interrupted"|"closed"|"retired"|null), reason, cause,
notify, unseen, revision [number, number]
```

---

## 4. The retry envelope (a correctness requirement, not polish)

The relay de-duplicates an instruction by `command_id` (a UUID). The client's
side of that contract (`contract.md` §5, `docs/mobile.md` §Retry-envelope):

- Keep the envelope when the outcome is **unknown**: transport failure,
  HTTP `502`/`504`/`408`, page reload, SSE reconnect, navigating between the
  user's own conversations.
- Clear it on a **definitive** end of that ambiguity: a definitive ack, a
  pre-admission rejection (any 4xx/5xx except 408/502/504), 24 h TTL, explicit
  discard, or logout / identity change / `401`.
- Envelopes are scoped **per conversation** and bounded by **count** (oldest
  evicted, never the active route) — a conversation switch must never silently
  drop the recovery affordance.
- A retry replays the **same UUID**, and the relay answers
  `200 {"ok": true, "detail": "already admitted"}` (live
  `fixtures/relay/http/command-prompt-duplicate.json`).
- A retained envelope must be **surfaced**: the web client shows the retained
  instruction's first line and a "Retry earlier instruction" action, and blocks
  a new send while one is unresolved.

`new_conversation` and `resume_session` exist in `ControlOp` but are **refused**
over the phone-facing relay route (live `op-new-conversation.json`,
`op-resume-session.json`) — the app uses `POST /api/sessions/start` and
`POST /api/sessions/resume` instead.

---

## 5. Where the shipped web client and the relay/docs disagree

Recorded because a native client should not inherit a bug as a spec.

1. **`ended` and `degraded` are declared but never rendered, and (for
   `degraded`) never even set.** `SessionProjection.degraded`
   (`types.py:857`) is forced to `false` on every path the relay writes
   (`daemon.py:1301,1633,3902`), and the "wedged" branch sets it on the *entry*,
   not the projection (`daemon.py:2554`). A wedged runtime is therefore
   invisible to a phone **as a flag** — but its one real signal was measured:
   the listing row's `subagents_running` flips `0` → `null` at the 45 s
   heartbeat timeout while `section` stays `active`
   (`fixtures/relay/probes/wedged-row-signal.json`, [`contract.md`](contract.md)
   §6.5). `ended` likewise arrives `false` in the final durable
   frame published after a death (live `sse-projection-durable-after-death.json`).
   **A native client must derive "gone" from `section: "previous"` plus silence,
   and should say so in its own copy.** `docs/mobile.md`'s claim that "the phone
   card flips to *ended*, offering resume" describes behaviour that does not
   exist.
2. **A `401` on an SSE stream is invisible** to an `EventSource`-shaped client,
   which retries forever with backoff (`web/src/store.ts:174-184`).
3. **The "answer it at the terminal" boundary is stale.** `docs/mobile.md`
   says a TUI-mounted approval is answered at the terminal and the phone only
   shows the wait; `mobile/tui_handle.py:1212-1231` settles the TUI's prompt
   from the phone. The pending card's approve/deny is real on both session kinds.
4. **`/api/sessions/past` takes no `limit`** (`daemon.py:4273-4283`), so a
   client cannot page the history list.
5. **`resume` and a phone-started session run in the account home**
   (`daemon.py:4230-4231`, `4164`) — a resumed conversation does not return to
   its own cwd, so the row's `cwd` can change under the user.
6. **Pin refusal copy is asymmetric.** The list's long-press reports the reason;
   the session header's ☆/★ is silent (`web/src/screens/session-list.tsx:614-616`).
7. **`clearSessionUnseen` is dead code** — the optimistic unread clear is never
   called from production (`web/src/store.ts:330-337`); the mark clears only when
   the relay repaints.
8. **Fork has no action.** A forked conversation only gets a `[fork]` tag in the
   past list; there is no fork gesture (`web/src/screens/past-sessions.tsx:127-131`).
9. **Pairing is unreachable from the UI** except through an authority refusal or
   a hand-typed route (`web/src/screens/pair.tsx:295-321`); the footer has no
   entry point.

---

## 6. Traceability table for the QA stream

One row per testable surface. `Relay route` is what the test must exercise; the
`State` column names the fixture/state a case should reproduce. Every route
below has a captured sample in `fixtures/relay/`, so a test can assert against
the real wire rather than a hand-written mock.

| ID | Surface | Relay route | State / case | Priority | Fixture |
| --- | --- | --- | --- | --- | --- |
| T-01 | Health probe | `GET /healthz` | reachable, no cookie | P0 | `healthz.json` |
| T-02 | Auth gate | `GET /api/sessions` | anonymous → `401` JSON | P0 | `unauth-api-sessions.json` |
| T-03 | Browser gate | `GET /` | anonymous → `303 /login` | P0 | `unauth-index.json` |
| T-04 | Login | `POST /login` | wrong password → `401` HTML | P0 | `login-wrong-password.json` |
| T-05 | Login | `POST /login` | success → `303` + cookie attrs | P0 | `login-success.json` |
| T-06 | Same-origin rule | any mutation | foreign `Origin` → `403` | P0 | `mutation-cross-origin.json` |
| T-07 | Same-origin rule | any mutation | no `Origin` → allowed (native path) | P0 | `command-no-origin-post.json` |
| T-08 | List stream | SSE `/api/sessions/events` | seed frame + empty list | P0 | `sse-list-frame.json`, `sessions-empty.json` |
| T-09 | List stream | SSE | keep-alive after 25 s quiet | P0 | `sse-keepalive.txt` |
| T-10 | List rows | SSE | degraded listing marker | P1 | `past-empty.json` (`degraded: []`) |
| T-11 | Session stream | SSE `/{id}/events` | seed frame on open | P0 | `sse-projection-seed.json` |
| T-12 | Session stream | SSE | live idle frame | P0 | `sse-projection-live-idle.json` |
| T-13 | Command: prompt | `POST /command` | admitted | P0 | `command-prompt-ok.json` |
| T-14 | Command: prompt | `POST /command` | retry with same UUID → `already admitted` | P0 | `command-prompt-duplicate.json` |
| T-15 | Command: prompt | `POST /command` | unknown session → `409` | P0 | `command-unknown-session.json` |
| T-16 | Command: steer | `POST /command` | queued steer, `queued_count` rises | P0 | `command-steer-queued.json` |
| T-17 | Approval | `POST /command` | pending card reaches the client | P0 | `sse-projection-pending-approval.json` |
| T-18 | Approval answer | `POST /command` | bad shape → `422` | P0 | `command-approval-bad-shape.json` |
| T-19 | Ask answer | `POST /command` | bad shape → `422` | P0 | `op-steer-bad-input-mode.json` (shape-422 shape) |
| T-20 | Abort | `POST /command` | idle → `200 no turn was running` | P0 | `command-abort.json` |
| T-21 | Resume affordance | SSE | `stop_reason: aborted` + `cut_off` | P0 | `sse-projection-durable-after-death.json` |
| T-22 | Seen handshake | `POST /{id}/seen` | real token → `200` | P0 | `seen-real-token.json` |
| T-23 | Seen handshake | `POST /{id}/seen` | missing token → `422` | P0 | `seen-missing-token.json` |
| T-24 | Seen handshake | `POST /{id}/seen` | unknown session → `404` | P0 | `seen-unknown-session.json` |
| T-25 | Pin | `POST /{id}/pin` | `{pinned:true}` → `200` read-back | P0 | `pin-true.json` |
| T-26 | Pin | `POST /{id}/pin` | truthy non-bool → `422` | P0 | `pin-not-bool.json` |
| T-27 | Pin | `POST /{id}/pin` | unknown session → `404` | P0 | `pin-unknown.json` |
| T-28 | History | `GET /{id}/history` | page + `has_more` | P0 | `history-ok.json` |
| T-29 | History | `GET /{id}/history` | unknown session → `404` | P0 | `history-unknown.json` |
| T-30 | Images | `GET /{id}/image` | real attachment → bytes, immutable | P1 | `image-ok.json` |
| T-31 | Images | `GET /{id}/image` | bad index → `404`; missing `entry` → `400` | P1 | `image-bad-index.json`, `image-missing-entry-param.json` |
| T-32 | Subagents | `GET /{id}/agents/{job}` | unknown job → `404` | P1 | `subagent-unknown.json` |
| T-33 | Subagents | `GET …/agents/{job}/history` | unknown → `404` | P1 | `subagent-history-unknown.json` |
| T-34 | Slash list | `GET /api/commands` | non-empty, `arguments` enum | P0 | `commands.json` |
| T-35 | Models | `GET /api/models` | success (may be `[]` without credentials) and `502` | P0 | `models.json` |
| T-36 | Directories | `GET /api/directories` | home + recent + tmp | P0 | `directories.json` |
| T-37 | New session | `POST /api/sessions/start` | allowed cwd → `{ok,pid,session_id}` | P0 | `start-session.json` |
| T-38 | New session | `POST /api/sessions/start` | outside home/tmp → `400` | P0 | `start-bad-cwd.json` |
| T-39 | Resume | `POST /api/sessions/resume` | unknown id → `404`; missing id → `400` | P0 | `resume-unknown.json`, `resume-no-id.json` |
| T-40 | Search | `GET /api/sessions/search` | hit + `body_match` | P1 | `search-hit.json` |
| T-41 | Past list | `GET /api/sessions/past` | rows + `forked` | P0 | `past-with-rows.json` |
| T-42 | Projections | `GET /api/projects` | empty and populated | P2 | `projects-empty.json` |
| T-43 | Voice input | `POST /api/transcribe` | missing audio → `422`; bad mime → `422`; too large → `413` | P1 | `transcribe-missing-audio.json`, `transcribe-bad-mime.json`, `transcribe-413-declared.json` |
| T-44 | Signing flow | `POST /{id}/operator/challenge` | bad action → `422`; no session → `409` | P1 | `operator-challenge-bad-action.json`, `operator-challenge-unknown-session.json` |
| T-45 | Pairing | `POST /api/pair`, `GET /api/pair/{id}` | bad code → `403`; unknown device → `paired:false` | P1 | `pair-no-code.json`, `pair-status-unknown-device.json` |
| T-46 | Logout | `GET /logout` | `303` + cookie cleared + `Clear-Site-Data` | P0 | `logout.json` |
| T-47 | Wake | `POST /command` on a durable-only conversation | `200 prompt admitted`, row returns to Active | P1 | `command-prompt-wake-durable.json`, `list-after-wake.json` |
| T-48 | Refused ops | `POST /command` | `new_conversation` / `resume_session` refused; `422` shape validation set | P1 | `op-new-conversation.json`, `op-resume-session.json`, `command-unknown-op.json` |
| T-49 | Tunnel edge | gateway + edge | 401/403/413/502/503 shapes and the 60 s stream cut | P0 | see [`tunnel-edge.md`](tunnel-edge.md) — needs a tunnel, not covered by the daemon fixtures |

### How to build more fixtures

Any state not captured here can be reproduced from the daemon alone, with no
provider credentials: run an isolated daemon against a config whose
`values.hosting: test` / `model_name: mock` serve a deterministic provider whose
last user message triggers tools (`[tool]`, `[bash:N]`, `[refuse]` —
`local_operator/providers/clients.py:4602-4680`). That is how the tool-call,
approval, steer and completion states in `fixtures/relay/` were produced.
