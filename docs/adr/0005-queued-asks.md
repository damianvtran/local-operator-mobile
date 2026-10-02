# ADR 0005 — Queued asks: the app's side of non-blocking, timeout-bounded asks

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-30
- **Deciders:** mobile app maintainers
- **Depends on:** [ADR 0001 — Framework](0001-framework.md), [ADR 0002 — Connection and auth](0002-connection-and-auth.md)
- **Supersedes:** nothing at the document level. This ADR changes the app's own ask surface only. The approval-scoped statements it is read against — [`docs/architecture.md`](../architecture.md) open question 2 and [`docs/ux/current-relay-audit.md` R10](../ux/current-relay-audit.md) — are **not** superseded, stay true as written, and are reconciled in §6 rather than overridden.
- **Related:** [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md), [ADR 0004 — CI/CD](0004-ci-cd.md); the cross-repository design note `docs/design/ask-nonblocking.md` (Local Operator repository).

**Provenance of code citations.** Every `file:line` in this document is stated at a
named revision and was resolved with `git show <ref>:<path>` — never read from a
working tree, because the shared checkouts carry other sessions' staged work and
their line numbers move under you:

| Repository | Revision | How paths are cited |
|---|---|---|
| **local-operator** | `fc851a94e` (read 2026-09-30; the same pin [`contract.md`](../relay/contract.md) and [`feature-map.md`](../relay/feature-map.md) use, so a line number means the same thing in all three documents) | `local_operator/mobile/types.py` → `types.py`; `local_operator/mobile/web/src/types.ts` → `web/src/types.ts`; `docs/mobile.md` by full path |
| **local-operator-mobile** | `origin/main` @ `3e2079314205d1974ebbe5b727029bc2c642f650` (read 2026-09-30) | this repository's own paths |
| **local-operator-mobile**, unmerged | `feat/screens-session` @ `212a3fe` (PR [#12](https://github.com/damianvtran/local-operator-mobile/pull/12), open at the time of writing) | the session screen the queued-ask views extend — **not yet a fact on `main`**, cited as the branch is where it lives |

**The wire is not shipped.** The `asks` contract this ADR is written against is a
**frozen target state** in the Local Operator repository's design note
(`docs/design/ask-nonblocking.md`, §4), committed with the core's first
implementation pull request. It is **not on the relay today**, and until it is,
nothing in this document changes the app's behaviour. The `PendingAsk` shape is
restated in §1 so the app has a local statement of what it consumes; where this
document and the core's §4 could be read differently, **the core's text governs**
(`AGENTS.md`, "What this repository is" — this repository never redefines the
relay wire).

## Context

`ask` today is a **blocking** tool: the agent stops until the user answers. The
mobile web client renders that as the pinned pending card ([`current-relay-audit.md`](../ux/current-relay-audit.md)
§2.1), and the projection carries exactly **one** request — `pending: PendingRequest | None`
plus `pending_count` (`types.py:864,868`) — with the phone-facing shape at
`types.py:702` (`web/src/types.ts:190`). The card's whole design assumes a single
slot: `1 of N` counts *simultaneous approvals*, and the app's own projection,
`src/features/session/pending.ts` on `feat/screens-session` (`PendingView`; the
file is PR [#12](https://github.com/damianvtran/local-operator-mobile/pull/12)'s,
not on `main`), derives its regions from that one object.

Three things follow from the single slot, and all three are about to change:

1. **The agent is held.** It cannot continue with other work while a question is
   open, which is what makes `ask` expensive to use and why the agent-facing tool
   receipt tells it to expect a stop.
2. **Nothing survives a timeout.** There is no deadline on the wire and no
   terminal state, so "the user never answered" is not a thing the app can render.
3. **The app refuses the phone on a terminal-hosted session.** `terminalOnly` is
   derived from the session's own `kind` (`src/features/session/pending.ts` on
   `feat/screens-session`, PR #12), so a `tui` session renders no answer control at
   all and the reader "shows the wait and says so"
   ([`current-relay-audit.md`](../ux/current-relay-audit.md) R10). R10 and
   [`architecture.md`](../architecture.md) open question 2 word that boundary for
   **approvals**, while the app applies it to every pending kind. §6 says what
   changes for asks — and what does not.

Local Operator is replacing this with a **queued, timeout-bounded** ask: the tool
returns immediately, the ask is registered in a durable queue on the computer, the
user answers whenever they reach a surface, and a deadline governs whether the
answer arrives in time. That is a relay-side change; the app's job is to consume
it well.

## Decision

### 1. The wire: an additive `asks[]`, consumed not defined

Queued asks arrive as an **additive** `SessionProjection.asks: PendingAsk[]` plus
`asks_open: int`, and a per-row `SessionListRow.asks_open: int`. `pending` and
`pending_count` are **unchanged and keep meaning approvals** — a queued ask never
occupies the single blocking slot.

The app-relevant subset of the frozen contract (core `docs/design/ask-nonblocking.md`
§4 is the authority; `PROTOCOL_VERSION` is **not** bumped, because the change is
purely additive on the `peer_message` precedent — `types.py:389-391`):

```
PendingAsk
  ask_id, session_id?, created_at, expires_at, timeout_s, urgent,
  status (open|answered|declined|timed_out|late|dismissed|expired),
  answered_at?, delivered: bool,
  questions[{id, question, options[{label, description?, recommended?}],
             multi, secret, persist}],
  answers?      {qid: [str]}        // secret answers: [<key>] only, never a value
  answered_by?  {surface}

SessionProjection.asks   PendingAsk[]   (cap 20, newest first, open first)
SessionProjection.asks_open  int
SessionListRow.asks_open     int

ops   ask_respond{ask_id, answers} · ask_decline{ask_id} · ask_dismiss{ask_id}
```

Three client rules come with it, and each one is load-bearing:

- **Presence of `asks` is the capability flag.** Core publishes the field only
  while the relay's `NONBLOCKING_ASK` switch is on; with it off the keys are
  absent, exactly as on an old relay. The app therefore keys on **field presence**,
  never on a version number or a user setting, and renders nothing new when they
  are absent.
- **Once `asks` is present, ignore any `pending_gate` whose `kind == "ask"`.** For
  one release the core mirrors the head open ask into the old single slot so an
  *old* app still shows it; a *new* app that renders both would draw the same ask
  twice. Approvals (`kind != "ask"`) are unaffected and keep the single slot.
- **`delivered` is sticky and means "the rows this status requires exist"** — for
  `late` that is *both* the timeout and the response row. It drives the
  "delivering" copy, not the answer control.

Consequently the app's projection module grows a second, list-shaped view beside
`PendingView`, and `pending.ts` keeps its current job for approvals. This ADR does
not change `pending.ts`; the implementation (E2, §7) does, on top of PR #12.

### 2. Queue authority: the relay, and only the relay

**The queue's single durable authority is the relay/runtime.** The ask log and its
derived index live on the computer (core `docs/design/ask-nonblocking.md` §2.2:
`sessions/<sid>/asks.jsonl` plus a non-authoritative index); nothing about an ask
is durably stored on the phone.

- **The app caches nothing durably for asks.** No ask list, no ask body, no
  answered/declined history in `expo-file-system`, `expo-secure-store`, or
  AsyncStorage. A cold start re-reads from the relay: the SSE seed frame carries
  the full snapshot, and the aggregate route (`GET /api/asks`) exists for the
  cross-session view. **This is a deliberate departure from the transcript rule:**
  ADR 0002 §6 does keep transcripts and queued commands on device (cleared on
  logout), but an ask is a *decision surface with a deadline*, not a log — it is
  the one thing the app refuses to hold a copy of.
- **A cached ask list would be a correctness bug, not an optimisation.** The
  status fold is a function of `(events, now)` on the *computer's* clock; a phone
  that painted a stale copy would show an `open` ask that has timed out, or offer
  an answer that is `expired`. The one clock-derived thing the app renders locally
  is the countdown from `expires_at`, and that is a display of the wire's own
  deadline, not modelled state.
- **Secret asks are never persisted client-side**, at any point in their life:
  not in a draft, not in a retry envelope, not in a log or a crash report. The
  wire already carries only `[<key>]` for a secret answer, and the transcript's
  masked-field rule ([`contract.md`](../relay/contract.md) §6.7, `PendingRequest.secret`)
  extends to the queued form unchanged. A secret answer is answered and delivered
  in one pass; if the pass fails, the ask stays `open` on the relay and the user
  answers again — the app does not hold the credential to retry with.
- **This creates no store of its own.** Ask state is derived per frame and dropped
  when the session closes; nothing here is a cache that could outlive a relay's
  answer.

### 3. Terminal states, rendered from the wire and nowhere else

The app renders **`status` as it arrives**: `open`, `answered`, `declined`,
`timed_out`, `late`, `dismissed`, `expired`. It never infers a state from elapsed
time, from the absence of a field, or from the session's own status (`working` /
`idle` is activity-derived and says nothing about asks — core §4, "Backend-owned
session status").

Copy is the core's shared copy contract, quoted so the app can be built against it
(core `docs/design/ask-nonblocking.md` §5), and rendered **verbatim**:

| `status` | Copy |
|---|---|
| `open` | "Queued — the agent is continuing; expires in 42 m" |
| `answered` | "Answered — delivering" (`delivered: false`) → the response card |
| `timed_out` | "Timed out — the agent moved on; you can still answer" |
| `late` | "Answered late — the agent was told" |
| `declined` | "Declined — the agent was told" |
| `dismissed` | "Dismissed — no reply was sent" |
| `expired` | "Expired — this ask is too old to answer; ask the agent again" |

The honesty rules behind that table, in the app's terms:

- **Never claim the user was notified.** The app cannot alert a backgrounded or
  killed app (§5); "the agent is continuing" is true, "we told you" is not.
- **"Agent is working" is not "waiting for you."** An `open` ask is not a
  needs-attention badge on the session *row*: `asks_open` is what an ask badge
  counts, and the session's own state mark still ranks approvals first.
- **A timeout is not a failure.** `expired` renders with every answer control
  disabled and **no error register** — nothing went wrong, the window simply
  closed. `timed_out` keeps the control enabled.
- **A late answer is submitable until `expired`** — i.e. until `expires_at + 7 d`.
  Submitting one is a normal `ask_respond`; the relay folds it to `late` and the
  user sees "Answered late — the agent was told". The app does not warn, block, or
  soften it: the answer is genuinely useful, and saying so is the point.
- **Refusals are the relay's sentences.** When an answer is refused — `expired`,
  `declined`, or already answered by another surface — the app renders the
  sentence the relay returns rather than minting one of its own, so every surface
  says the same words about the same ask.

### 4. Answering: whole-ask, one form, both routes identical

An answer is **one `ask_respond{ask_id, answers}` for the whole ask** —
`answers` maps each question id to its selected labels, or to free text for a
question with no options. A multi-question ask is a **single form**, all questions
together, submitted once; the app does not post per-question.

- This is what fixes the shipped client's worst ask defect: the old path posts
  `values[0]` to the single slot, so a multi-select answer is **silently
  truncated** to its first value (core `docs/design/ask-nonblocking.md` §4). A
  whole-ask body cannot truncate, and an `answers` map is the reason.
- `ask_decline{ask_id}` is the explicit "no answer — decide yourself" (today's
  Esc) and `ask_dismiss{ask_id}` removes an ask the user has seen time out. The app
  offers dismiss only on a `timed_out` ask, which is what keeps it from shadowing
  an in-window answer.
- **Both auth routes behave identically.** The Radient-tunnel route and the custom
  URL + relay-password route carry the same ops with the same bodies and the same
  refusals; only the transport differs, and on the Radient route the local gateway
  injects the relay cookie ([`feature-map.md`](../relay/feature-map.md) §1.1). A
  mutation still presents the hand-set `Cookie` and the correct `Origin` with
  `credentials: 'omit'`, and still accepts no `Set-Cookie`
  ([`tunnel-edge.md`](../relay/tunnel-edge.md):135-142, ADR 0002 §4). Any new
  queue or answer call **inherits those header rules unchanged**; this ADR adds no
  second request layer.
- Route neutrality is a test obligation, not an aspiration: the E2 evidence matrix
  exercises the answer path on **both** routes against the same relay (§7).

### 5. Notifications v1: an in-app badge, and copy that tells the truth

`v1` has **no push notifications**. The relay has no push service
([`architecture.md`](../architecture.md):299 — "needs a relay-side change first,
out of scope for v1"), backgrounding is an unanswered spike question in ADR 0002
([§7 S5](0002-connection-and-auth.md):647), and the FOSS-channel constraint rules
out the obvious implementation: F-Droid forbids Firebase and Google Play Services,
and ADR 0004 records that "push notifications would pull in Google Play Services /
Firebase" ([`0004-ci-cd.md`](0004-ci-cd.md):178, [`other-channels.md`](../publishing/other-channels.md):128).

So v1 ships:

- **An in-app badge.** `asks_open` drives an ask count on the session row and,
  aggregated, on the tab/header — beside, not merged into, the existing
  needs-attention treatment ([`flows.md`](../ux/flows.md) F-5 §3).
- **A refetch on foreground.** Returning to the foreground resyncs: the SSE
  reconnect's snapshot frame is the truth, and a foregrounded app may also hit the
  aggregate route. There is no delta to miss, because the wire is snapshot-based
  by design ([`contract.md`](../relay/contract.md) §1).
- **Honest copy that the app cannot alert while backgrounded.** A screen or an
  inline note states it plainly, in the Local Operator voice: the app shows queued
  asks when it is open, and it cannot reach you when it is not. Never "you will be
  notified."

**Push notifications are a separate RFC.** They are not a scheduling choice inside
this ADR: they need a relay-side service, a credential, a privacy surface, and
they conflict with the FOSS channel as it stands. That RFC will have to settle
APNs/FCM vs a self-hosted path, and ADR 0004's F-Droid row is one of its inputs.

### 6. `tui`-hosted sessions: asks are answerable through the queue

**This is a new decision for asks, not a supersession.** Queued asks on a
**terminal-hosted** session are answerable **from the phone**, up to a
**60-second latency bound**, and the app stops applying its terminal-only rule to
asks. No approval statement changes, and nothing here overrides a document.

- **The thing being changed is a rule in the app's own code**, not a document:
  `terminalOnly: input.sessionKind === "tui"` in
  `src/features/session/pending.ts` on `feat/screens-session` — a module whose
  header records R10 verbatim — is derived from the session's `kind` and applies
  to **every** pending kind. That is **PR #12-scoped**, not yet a fact on `main`.
- **The documents the rule came from are approvals-worded, and already stale for
  both kinds.** R10 and `architecture.md` open question 2 read "**approvals**
  raised by a terminal session cannot be answered from the phone", quoting core
  `docs/mobile.md`. [`feature-map.md`](../relay/feature-map.md) §5 item 3 already
  records that boundary as stale on the relay side, because the TUI host settles
  its own prompts from the phone today — `mobile/tui_handle.py:1212`
  (`approval_answer`, "settle the host's real `ApprovalPrompt` from another front
  end") and `:1233` (`ask_answer`, "answer the CURRENT question of a live TUI ask
  picker from the phone"), both at the pin. So on a session with a **live owner**
  both kinds are already settlable from the phone; what asks lack today is a queue
  that lets an answer arriving after the picker settled still land.
- **What this ADR does not do:** it neither supersedes R10 and open question 2 nor
  settles their conflict with `feature-map.md` §5 item 3. That reconciliation —
  which is about **approvals** too — is recorded here and left to a documentation
  pass, because it depends on a relay-side answer this app cannot give.
- **The mechanism is named, not assumed.** The session's owner is the TUI process
  that adopted it, and that process reconciles the queue like any other surface:
  it picks up an answer the relay appended under its own lock, on the earliest-
  deadline tick, on becoming the active surface, and at every turn boundary —
  hence the bound.
- **With no live owner, the relay keeps the refusal.** If the TUI process is dead
  or absent there is nothing to deliver the answer to, so the relay refuses as it
  does today, with copy naming the reason. The app renders that refusal (§3). A
  queued ask is therefore never *silently* unanswerable: it is either answered by
  the owner within the bound, or refused with a sentence that says why.
- The app does **not** decide this. It sends the same `ask_respond` on every
  session kind and renders the outcome, which is what keeps the two routes and the
  two session kinds from growing divergent client logic.

### 7. Sequencing

| Step | Depends on | Where |
|---|---|---|
| **E1** — this ADR, plus the supporting doc edits | nothing; starts immediately | this repository |
| PR [#11](https://github.com/damianvtran/local-operator-mobile/pull/11) and [#12](https://github.com/damianvtran/local-operator-mobile/pull/12) merged | review | this repository |
| Core A2 — the `asks` wire published | core A1 | Local Operator |
| **E2** — the implementation | E1, #11, #12, and A2 | this repository |

E2 is deliberately **not** startable against today's relay: the app cannot consume
a field that does not exist, and building against a guessed shape is how this
repository's own rule ("never redefine the relay wire here") gets broken in
practice. E1 exists so the decision is recorded and reviewable *now*, while the
core work proceeds in parallel.

When it does start, E2 rides the harness that already exists in PR
[#8](https://github.com/damianvtran/local-operator-mobile/pull/8): the mock relay
replays wire frames, and the frame harness captures the phone-size rendered
frames. That harness carries E2's evidence. PR #8 is open at the time of
writing; if it lands in a different shape, E2 follows the harness that lands.

### 8. UX proposal (in words; frames come with E2)

No mock frames accompany this ADR — it is a decision record, and the frames belong
with the implementation that produces the screens. What the app will show:

- **Session list.** An ask count badge on a row that has open asks, from
  `asks_open`, visually distinct from the approval/danger treatment and ranked
  below the needs-a-decision mark. A header/tab count aggregates across sessions.
  Tapping the badge opens the asks list rather than the session's pending card,
  because a queue is a list and the card is a slot.
- **Asks sheet / list.** One row per open ask, newest first, each showing the
  session it belongs to, when it expires, the first question's opening words, and
  whether it is `urgent`. Open asks pin to the top; `timed_out` asks sit below them
  (still answerable); terminal ones collapse out of the way. This is the surface
  that makes a 24-hour deadline meaningful on a phone — one place to look, not a
  hunt through sessions.
- **Response card.** For each terminal ask, a card that expands to the full Q&A —
  the questions, the answers given, when, and by which surface — matching the
  shared model the agent sees, so the user and the agent read the same record.
  "Answered — delivering" shows on the collapsed form when `delivered` is still
  false.
- **Timed-out and late states.** `timed_out` keeps its answer control, with the
  countdown replaced by the honest sentence and the deadline shown as a past time.
  `late` reads as an ordinary answered ask with one extra sentence ("Answered late
  — the agent was told"). `expired` disables the control and explains itself
  without an error register.
- **Secret asks** keep the masked field and the "not stored in the transcript"
  affordance the shipped client already has, in the queued form as in the card —
  with the §2 rule that nothing about the answer is persisted on the device.

E2 will produce **light and dark frames at phone size**, before and after, through
the repository's frame harness — that is a design-round obligation
([`AGENTS.md`](../../AGENTS.md), "Commits and pull requests"), and the frames, not
this prose, are what the design round reviews.

## Consequences

- **The app gains a second shape of waiting.** `PendingView` keeps its meaning for
  approvals; the queued list is new code beside it. The one place they touch is
  the client rule that an ask arriving through the old mirror slot is ignored —
  which has to be tested explicitly, or the app draws the same ask twice.
- **The app has no offline ask story, by design.** With no durable client store, a
  phone that is offline shows the last frame it received and cannot answer. That is
  the honest behaviour: an answer written offline would have to be replayed against
  a deadline the phone cannot evaluate.
- **Push is now a named gap rather than an open question.** Anyone reading the app
  on a phone will find the asks list, not a notification; the copy says so.
- **The app's terminal-only rule now has a per-kind answer.** `pending.ts` applies
  it to every pending kind today; under this ADR it applies to approvals, and an
  ask is refused only when no live owner can receive the answer (§6). R10 and
  `architecture.md` open question 2 stay approvals-worded and unamended.
- **The app adds no dependency for any of this.** No push SDK, no storage engine —
  the whole feature is a projection, a list, a form and three ops.

## What would change this decision

- **A push service landing in the relay.** That RFC amends §5 and adds a
  notification path; it does not change §1–§4, because the wire is the same.
- **The core's §4 frozen contract changing before A2 lands.** Any change is an
  amendment to this ADR, reviewed like code — the app has no freedom to absorb it
  locally.
- **The legacy mirror being dropped in a different shape** (core F2). §1's
  double-render rule is scoped to the mirror's lifetime; if the mirror never ships,
  the rule is dead code and should be deleted with it rather than left as a
  defensive branch.
- **ADR 0004's F-Droid row resolving in favour of a FOSS notification path**, which
  would make §5's "no push" a v1-only statement rather than a standing one.
