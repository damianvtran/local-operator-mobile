# ADR 0006 — Push notifications and cross-surface acknowledgement

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-30
- **Deciders:** the maintaining team (manager call, 2026-09-30, on the product questions
  listed below) **and** Local Operator (core) maintainers — this record is deliberately
  cross-repository, because most of its decisions land in the core and in Radient, not in
  this app
- **Depends on:** [ADR 0001 — Framework](0001-framework.md), [ADR 0002 — Connection and auth](0002-connection-and-auth.md), [ADR 0004 — CI/CD](0004-ci-cd.md)
- **Amends** — the complete list, because this ADR changes what a badge *means*:
  - [ADR 0005](0005-queued-asks.md) §5 — its "`v1` has **no push notifications**" and its
    pointer ("Push notifications are a separate RFC") are the RFC it predicted, now
    written. Its in-app `asks_open` badge and its honest-copy rule stand unchanged.
  - [`docs/ux/principles.md`](../ux/principles.md) **P-3**, lines 60-61 — **both halves of the
    sentence move**, and the Amends block has to say so or it is quoting a line it contradicts.
    "the app badge counts sessions waiting on a decision" is **replaced**: the app badge counts
    conversations with unread notifications (§1.4). "a notification names the session and the
    kind of decision" holds **for local banners only** — never for a push, which carries no name
    (P2) and no session id (§3.2). P-3's remaining consequence — rows carry state in words — is
    untouched.
  - [`docs/ux/flows.md`](../ux/flows.md) §301 (F-5 §3, "Attention badges … as the app icon
    badge"): the header badge and the ask badge stay; the **icon** badge changes meaning.
  - [`docs/ux/flows.md`](../ux/flows.md) §570 (the Settings table's **Notifications** row) —
    a *specification to build*, not a description: **no Settings → Notifications surface exists
    on `main`, #11 or #12** — verified on all three trees. Their sections differ and the claim is
    scoped to what each actually has: **#11** ships Connection / Appearance / Diagnostics / About,
    while **`main` and #12** ship Appearance + Connection; *none* of the three has a Notifications
    section (QA round 3 Q4). Two of its four promised rows are **not shipped in v1**
    — quiet hours and "when a session needs a decision" — and the route/master rows are replaced
    by §2.4's per-computer statement.
  - **#11's `attentionCount`** (`feat/screens-lists:src/features/sessions/session-projection.ts:56-70`,
    open PR): it counts `needs_attention` only and says so. It must become the §1.4 count,
    or the row it feeds is a fourth opinion. **Coordination item — #11 is open and this
    document cannot change it** (see `docs/push-plan.md`).
  - [`docs/ux/flows.md`](../ux/flows.md) §12 **D-1** — the v1 disposition was option (c)
    ("deferred to v1.1, with (a) only"); this ADR decides (b) under a constraint (a) did
    not have (see §2.4, which narrows what (b) can promise).
- **Related:** [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md); this
  repository's [`docs/relay/`](../relay/README.md) contract map; the core's
  [`docs/ATTENTION.md`](https://github.com/damianvtran/local-operator/blob/main/docs/ATTENTION.md),
  [`docs/DESKTOP_API.md`](https://github.com/damianvtran/local-operator/blob/main/docs/DESKTOP_API.md),
  [`docs/design/notification-feed.md`](https://github.com/damianvtran/local-operator/blob/main/docs/design/notification-feed.md);
  the slice plan in [`docs/push-plan.md`](../push-plan.md)

## Product questions decided elsewhere, and recorded here

Review round 1 and QA round 1 on PR [#14](https://github.com/damianvtran/local-operator-mobile/pull/14)
raised product questions a design document cannot settle by itself. The maintaining team
decided them on 2026-09-30; they are implemented as stated below, and each site says so:

| # | Decision | Where it lands |
|---|---|---|
| **P1** | **The badge population is the app's own list**, not the store's census: user-facing sessions, excluding agent/subagent and scheduled origins and deleted sessions. The aggregate must return that population, and a test asserts the aggregate equals the in-app count. | §1.2, §1.4 |
| **P2** | **No conversation name ever reaches the cloud**, regardless of the machine's local `session_names_in_notifications()` flag. | §3.2, §4 |
| **P3** | **The cloud never sets `aps.badge`.** The badge is app-managed from the daemon's count on connect/foreground, cleared on ack; a push may carry the count for the notification's *body*. | §1.5, §3.2 |
| **P4** | **Registration and revocation go through the machine**, with an account-side revocation path that does not need the machine, and Settings showing the devices paired to that computer with a working unpair. | §3.1, §4 |
| **P5** | **A heal is a distinct delivery**: the emit key carries the record's content, so idempotency cannot swallow a correction. | §3.4 |
| **P6** | **The deep link must exist as code**, named to a slice, or be described as unimplemented — never asserted as an existing tier. | §6 |

**Why 0006 and not 0005.** The request that produced this note named
`docs/adr/0005-push-and-ack-sync.md`. That number is taken: ADR 0005 (queued asks) was
merged as PR [#13](https://github.com/damianvtran/local-operator-mobile/pull/13) earlier
the same day. Two records sharing a number is the one thing an ADR index cannot survive, so
this is 0006.

**Provenance of code citations.** Every `file:line` below is stated at a named revision and
was resolved with `git show <ref>:<path>` — never read from a working tree, because the
shared checkouts carry other sessions' staged work. **Every citation in this document was
re-resolved at the pin in remediation round 1**, after **QA round 1's Q7** reported line drift
and **Q8** reported three unsourced assertions (the review round running beside it found no
drift of its own: "~20 citations spot-checked, all resolve"). Round 3 re-resolved them again at
the same pin; the corrections are named in §9 so a reader can see what moved.

| Repository | Revision | How paths are cited |
|---|---|---|
| **local-operator** | `40ca7910e49a` — **a pinned SHA, and *not* `origin/main`**: it *was* `origin/main` when this document was written and is **16 commits behind** it as measured on **2026-09-30** (`origin/main` = `d5346e173`; it was twelve behind when review round 2 read it, at `061ede7` — the distance moves with the branch, so it is always dated). **Every line number below is stated at `40ca7910e49a`**; re-derive at that ref and expect an offset at a newer one: `app.py`'s `_cmd_notifications` is `:40600` on current main against `:40562` here, and `session_sidebar.py`'s "45%" line `:800` against `:704` | `local_operator/mobile/daemon.py` → `daemon.py`; `local_operator/session/attention.py` → `attention.py`; `local_operator/session/runtime/presence.py` → `presence.py`; `local_operator/session/runtime/viewers.py` → `viewers.py`; `local_operator/server/utils/desktop_feed.py` → `desktop_feed.py`; `local_operator/server/utils/desktop_presence.py` → `desktop_presence.py`; `local_operator/notifications/compose.py` → `compose.py`; `local_operator/tui/app.py` → `app.py`; `local_operator/tui/notify.py` → `notify.py`; `local_operator/tui/widgets/session_sidebar.py` → `session_sidebar.py`; `local_operator/operator/devices.py` → `devices.py`; `local_operator/tunnels/api.py` → `tunnels/api.py`; `local_operator/tunnels/service.py` → `tunnels/service.py`; `local_operator/session/session.py` → `session.py`; `local_operator/session/resume.py` → `resume.py`; `local_operator/server/models/desktop_sessions.py` → `models/desktop_sessions.py`; `local_operator/server/routes/desktop_sessions.py` → `routes/desktop_sessions.py`; `local_operator/server/utils/desktop_sessions.py` → `utils/desktop_sessions.py`; `local_operator/mobile/web/src/store.ts` → `web/src/store.ts`; `local_operator/mobile/install.py` → `mobile/install.py`; `docs/*.md` by full path |
| **local-operator-mobile** | `origin/main` @ `d5bb850fccac4dcfdd80f2e3b352a51107a955bc` (read 2026-09-30) | this repository's own paths; unmerged work named by branch and SHA |
| **Radient** (control plane, edge, console) | **no code access** — specified here as an *interface*, never as a change to existing code | every cloud route in §3.1 is marked **proposal** |
| **Apple / Google / Expo platform docs** | read 2026-09-30, cited by URL | vendor behaviour, quoted with the page it came from |
| **`docs/push-cloud-ops.md`** — this repository, **cross-PR** | PR [#15](https://github.com/damianvtran/local-operator-mobile/pull/15) (`docs/push-cloud-ops`, **open — not on `main` yet**, so the link above resolves only once it merges) | the cloud slice's own ops note, *proposal*. This ADR defers cloud-side operations to it and **the two are reconciled on the ingest shape**: `202 {emit_id, accepted_at}`, accepted and queued (§3.1). Where they could be read differently, §3.1 here governs the wire and the note governs the runbook |

**What is shipped, what is proposed — stated once and used everywhere.** `attention.db` and
its routes exist and are cited (`attention.py`, `daemon.py`). The three relay routes this
ADR adds are marked **(new)** and do not exist yet. The cloud routes are marked
**(proposal)**; there is no Radient repository to read, so they are an interface this
document specifies, not a description of anything shipped. Vendor behaviour is marked
**(quoted)** with its URL. Nothing below claims an unshipped thing is shipped.

---

## Context

### 1. What a "notification" already is on this machine

The word is overloaded, so this ADR fixes it before deciding anything else. On this machine
there are **three** distinct things, and only one of them is what a push may carry:

| Thing | Where it lives | Lifecycle |
|---|---|---|
| A **completion** | `attention.db`'s `completions` table — one row per settled turn, keyed by a UUID `token`, with `anchor`, `kind`, `reason`, `cause`, `notify`, and an `AUTOINCREMENT` `sequence` (`attention.py:1412-1419`) | published at turn settle, durable, superseded **in place** by a heal (never renumbered — `attention.py:2000-2010`) |
| A **read receipt** | `attention.db`'s `receipts` — `conversation → acknowledged`, the highwater mark of the completions a human has *seen* (`attention.py:1421-1424`) | moved only by `acknowledge`/`acknowledge_many`, token-bound (`attention.py:2175`, `:2224-2252`) |
| A **delivery** | `attention.db`'s `deliveries` — `conversation → delivered`, claimed atomically by `claim_delivery` (`attention.py:349-353`, `:2379-2460`) | "somebody was told", deliberately **not** "somebody read it" (`attention.py:12`; `:2391-2393`) |

`unseen` is *derived*, never stored: a conversation is unread when
`MAX(completions.sequence) > receipts.acknowledged` (`attention.py:1588-1612`), surfaced as
`AttentionState.unseen` and mirrored into the relay's `SessionSummary.unseen`
(`daemon.py:1051`; `_is_unseen` at `:1099`).

**Pending gates are a fourth, separate thing.** A parked `ask`/`approval` has its own
lifecycle and is *never* answered or removed by a completion receipt (`docs/ATTENTION.md`
§"Identity and durability"); the phone sees it as `needs_attention` + `pending_kind`
(`daemon.py:991-992`), and the desktop machine-wide feed deliberately does not carry gates at
all (`BRIDGE_NOTIFIABLE_KINDS = {"complete", "error", "retired"}`,
`server/utils/desktop_sessions.py:368`). §1.4 keeps that boundary, and §2.4's Settings
statement is honest about it.

**Two facts about the store that decide §2 and §3**, both the store's own words:

- **`unseen` is a LEVEL, not an edge.** "without this, the first observer to upgrade would
  claim every historical completion still unread and fire a banner for each one (measured on
  the maintainer's live store: 171 unseen conversations out of 332 completions)"
  (`attention.py:1481-1486`). Any push design that reads `unseen` as its trigger will push
  history; §2.1 therefore adds a **cursor**, and the store already ships the click-free read
  it needs (`published_since`, `attention.py:1684`).
- **`revision()` is an equality token, not an order**: "Callers compare the tuple for
  equality and never interpret the terms" (`attention.py:2129-2149`), and the desktop model
  adds "NOT a merge key … a heal republishes under the SAME pair … an equal pair [is]
  'possibly changed', never … stale" (`models/desktop_sessions.py:1163-1172`). §3.3 obeys
  that: **nothing in this design drops a push or a frame on the basis of a revision
  comparison.**

### 2. Surfaces already share the read state — that part is done

**The TUI, the desktop app and the mobile daemon all read and write the same `attention.db`
under the config root, through the same `AttentionStore`:**

- the **TUI** lists the completions its sidebar is painting and clears exactly that set —
  `/notifications` (`app.py:40563-40590`), the write being
  `AttentionStore(root / "attention.db").acknowledge_many(items)` (`app.py:40741`),
  token-bound on the pairs it listed;
- the **desktop app** acks per session (`POST /v1/desktop/sessions/{id}/seen`,
  `routes/desktop_sessions.py:3428`) and in bulk (`POST /v1/desktop/attention/seen`, 1..500
  items, `:3462`) and learns about every change within ~100 ms from the machine-wide feed
  (`GET /v1/desktop/events`; one `os.stat` doorbell per tick, `docs/design/notification-feed.md`);
- the **mobile daemon** acks with `POST /api/sessions/{id}/seen` (`daemon.py:3642-3696`,
  route registered at `:4701`) and then invalidates its summaries cache and wakes the list
  SSE (`:3694-3695`), and every 2 s (`SCAN_INTERVAL_S = 2.0`, `daemon.py:92`) re-reads the
  store's own change detector and repaints every watched session (`:2499-2535`).

So **"an ack on one surface clears it on the others" is already true for surfaces attached to
the same machine**, at the store level, with no cloud involved. What does *not* exist is (a)
any aggregate of the unread state, (b) any mechanism by which a device that is not currently
connected learns that something changed, and (c) any emission of "the read state moved" that
covers acks made by the **TUI and the desktop** — the relay only sees its own `/seen`. Those
three are what §1, §2 and §3 add.

### 3. The badge means something else today, and this ADR changes that

Not a footnote: the icon badge is currently specified and implemented as a **decision**
count, and the ADR below makes it an **unread** count. The reader should not discover that
from a diff:

- `docs/ux/principles.md:60-61` (P-3) — **the whole line**, because both halves move: "the app
  badge counts sessions waiting on a decision; **a notification names the session and the kind
  of decision**." The badge half is replaced by §1.4. The notification half holds **for local
  banners only** and never for a push: P2 sends no name, and no session id rides the wire at all
  (§3.2), so a push can never name the session — corrected here rather than left standing;
- `docs/ux/flows.md:301` (F-5 §3): "count of sessions needing a decision … as the app icon
  badge";
- #11's `attentionCount` (`origin/feat/screens-lists:src/features/sessions/session-projection.ts:56-70`):
  `session.needs_attention ? total + 1 : total`, with a comment saying it is counted "from
  `needs_attention` and never from `unseen`";
- the live web client does the same arithmetic client-side:
  `sessions.filter((s) => s.unseen || s.needs_attention).length`
  (`web/src/store.ts:407`, whose own comment at `:385` calls it "THE LIST owns the
  attention aggregate").

Three more sites say the same thing, and **all three are in the Amends list**: the relay's own
`docs/mobile.md`:295-298 ("push notifications … not in this pass"), the publishing guide's
`docs/publishing/other-channels.md`:172-174 ("Push is a v1 non-goal for the relay" — the twin of
the ADR 0005 §5 sentence that *is* amended), and `docs/ux/current-relay-audit.md`:220-222 (push
as a non-goal, "use the app icon badge instead"). This repository's own `docs/architecture.md`:299
is the same claim in the same words and is amended in place — open question 1 now points at this
ADR.

The operator's rule (§1.4) is "conversations with unread notifications", which is the second
half of that expression and not the first. **Consequence, stated plainly: a parked approval
or ask raises no icon badge after this ADR.** It keeps its row mark, its in-app badge and its
local banner exactly as today (the eligibility ladder is untouched, §2.3), and §1.4 records
the one-line alternative and what it would cost. **All seven of the sites above** — P-3, F-5
§3, #11's `attentionCount`, `web/src/store.ts:407`, `docs/mobile.md`:295-298,
`other-channels.md`:172-174 and `current-relay-audit.md`:220-222 — are named in the **Amends**
list at the top of this document.

### 4. What the operator asked for

Proper push; **cross-surface, cross-device acks** with no double badges; **badge count = the
number of conversations with unread notifications**; a push tap that opens a killed app and
deep-links to the notifying conversation; QA permutations across app open / backgrounded /
killed, several devices on one machine and devices on different machines, and an ack racing
an in-flight push.

Four requirements are restated here because they are answered point by point below: the
desktop UI and TUI are clients of the **same** ack contract (§2.2); the badge rule is exact
and must agree with the in-app count (§1.2, §1.4); the self-hosted path degrades to the
foreground SSE stream with honest copy (§2.4); and no transcript content leaves the machine
in any payload (§3.2, §4).

### 5. Two constraints that decide most of what follows

- **The machine is the source of truth, and the app must work without Radient.** The
  architecture principle is already written down — "the relay is the source of truth; the app
  is a projection cache" (`docs/architecture.md`:35) — and the app runs against a
  self-hosted tunnel or any custom URL with a relay password (ADR 0002 §5). Any design in
  which the cloud becomes the authority for unread state is not merely a privacy question; it
  breaks the app's reason to exist.
- **One machine, one daemon, one store — but many devices.** The daemon is the only always-on
  process (`RunAtLoad` + `KeepAlive{SuccessfulExit:false}` LaunchAgent,
  `mobile/install.py:1696-1701`; `Restart=on-failure` on Linux, `:1947`), it binds loopback
  and is reached through the tunnel, and it owns the store. *N* devices is the normal case,
  *N* computers is a first-class case (ADR 0002 §"per-computer caches, per-computer
  credentials"), and the app's answer to the second must not be a cloud account.

---

## Decision

### 1. The source of truth for "unread", and the exact badge rule

**`attention.db` on the machine stays the only authority for unread state.** Everything below
is derived from it, on the machine, and pushed; nothing in the cloud is ever authoritative,
and no client may compute the badge from its own local list of notifications.

#### 1.1 The model expresses "conversations with unread notifications"; one read is missing

The per-conversation state already carries exactly what the badge rule needs (`unseen`), and
the machine-wide change detector already exists in the shape that makes an aggregate cheap:

```
AttentionStore.revision() -> (MAX(sequence), SUM(acknowledged), supersedes)   attention.py:2129-2149
```

The three terms are deliberate: the first moves on a publish, the second on a read, and the
third on a **heal** that deliberately moves neither (`attention.py:2000-2010`, `:2129-2149`).
Its contract is equality-only — see Context §1.

**What is missing is one read over the right population.** No route anywhere on the machine
returns a count (verified by `git grep` across `server/routes/` and `mobile/daemon.py`; the
desktop listing's `counts` is a per-scope **row census**, a different fact —
`models/desktop_sessions.py:235-250`), and no `AttentionStore` method is a census (its public
API is `acknowledge, acknowledge_many, acknowledgement_map, claim_delivery, publish,
published_since, release_delivery, revision, state, state_many, superseded_since`).

**Decision: add one additive aggregate read, and one additive field on the list payload, both
computed by ONE implementation.**

```jsonc
GET /api/attention/unread                                       // (new) auth-gated like /api/sessions

{ "count": 2,                    // the badge number; absent when `degraded` is non-empty
  "revision": [1043, 1041, 7],   // AttentionStore.revision(): an EQUALITY token, never an order
  "degraded": [],                // ["attention"] when the store could not be read
  "conversations": [             // the SAME population as the listing (§1.2), unread ones only
    {"session_id": "…", "push_handle": "…", "completion_token": "…", "kind": "complete",
     "revision": [1043, 1041]}   // the row's existing pair (attention.py:1588-1612), unchanged
  ]}
```

and, on the list payload the app already subscribes to, a **top-level sibling of `degraded`**
— *not* inside `capabilities`, which is a feature-flag dict where "a missing key means this
build does not have it" (`daemon.py:3528-3530`, `docs/relay/contract.md`:203-204):

```jsonc
{"sessions": [...], "degraded": [...], "unread": {"count": 2, "revision": [1043, 1041, 7], "degraded": []}}
```

The app therefore needs no new stream, and an older relay's absence of `unread` means
"unknown", never 0. **The same `degraded` rule applies to this payload, not only to the route**
(review m4): when `unread.degraded` is non-empty, `unread.count` is **absent** — an app reading
the field off the stream it already subscribes to is the likelier consumer, so the rule is
stated where the payload is defined, not only in the route's section.

#### 1.2 The population, decided (P1): the listing's rows, in the listing's snapshot

This is the finding that most needed a decision, because the two obvious definitions give
different numbers on a real machine.

**The store is NOT the population.** It holds identities the app never shows:
`conversation_identity()` namespaces both `session/<id>` and `agent/<id>`
(`attention.py:428-431`); `session_sidebar.py:704` records that "45% of [subagent ids] carry
an unseen receipt"; and `app.py:40571-40578` records the operator's own store as **6,392
unread conversations, 4,659 of which still have a directory**, "none of which this app
renders" — against the store's own 171-unseen measurement used as a different example
(`attention.py:1481-1486`). A store-wide count would make the icon disagree with the list,
which §1.4 forbids.

**Decision — one predicate, named once (review QA Q14): the population is the identity set the
listing's own scan produces, with `is_user_session` applied inside that scan.** It is *not*
re-derived afterwards from `_durable_user_session_dir`, the per-id detail check
(`daemon.py:1194-1207`), which additionally requires a `transcript.jsonl` and a well-formed
name and would put a durable-but-detail-less row in one set and not the other. Everything below
is that one set, in the listing's snapshot:

- the listing's rows (`recent_session_rows(directory, 100, strict=True)`, `daemon.py:665`, plus
  live entries) — the same identity set the attention decoration is already built for
  (`daemon.py:777-813`), so this is one pass over data already in hand, not a second scan;
- **user-facing sessions only** — the listing's own origin filter, `USER_ORIGINS`
  (`resume.py:169`) and `_is_hidden_origin` (`resume.py:1715`), applied inside that scan, which
  excludes `agent/<id>` identities, subagent-only rows and scheduled origins;
- **excluding deleted conversations** — a conversation with no directory is not a row, so it
  is not a count (and its receipt, if any, is a receipt for something that no longer exists);
- **bounded by the listing's own bound** (100 recent durable rows + live sessions). An unread
  conversation older than that does not raise the badge; it is still in Past, with its own
  mark, and this is stated rather than hidden.

**The consequence to accept, written down:** the badge is bounded by the listing, so the
day-one badge on a machine with a large historical backlog is bounded too (≤ the listing's
100 + live), instead of the 171/6,392 figures a store-wide count would produce.

**"The two numbers are equal" is a test, not a claim:** one assertion that
`GET /api/attention/unread → count` equals the number of `unseen: true` rows in the
`GET /api/sessions` body captured in the same pass. A second assertion that the top-level
`unread.count` on the list payload equals the route's count. (Review round 1's M8 and QA's
Q1 are the same finding, and this is its remedy.)

#### 1.3 Where each surface attaches — the shared contract, named

**There is no new per-surface protocol: one store, one token-bound ack operation, one
subscription per surface.**

| Surface | Acks with | Learns about a change through |
|---|---|---|
| **TUI** | `/notifications read` → `acknowledge_many` over the rows its sidebar painted (`app.py:40563-40590`, write at `:40741`) | its catalogue poll (`app.py:27291-27348`, which reads `AttentionStore.revision()` and the attention state) |
| **Desktop** | `POST /v1/desktop/sessions/{id}/seen` (`routes/desktop_sessions.py:3428`), and `POST /v1/desktop/attention/seen` for a clear-all (`:3462`) | `GET /v1/desktop/events` — 100 ms doorbell; `attention` frames per changed session; `acknowledgement_map()` is its delta read (`desktop_feed.py:931,1188`) |
| **Mobile app** | `POST /api/sessions/{id}/seen` with `{completion_token}` (`daemon.py:3642-3696`) | the list SSE (`/api/sessions/events`, woken by the daemon on its own ack, `:3694-3695`) while foregrounded, and **push** while backgrounded (new, §2) |

**The rule the three surfaces share, stated once:** *an acknowledgement is
`(conversation, completion_token)`, it is idempotent, it is refused when the token is not the
conversation's current completion (`superseded_completion_token`, `attention.py:185`;
`daemon.py:3676-3690`), and **no automatic path may acknowledge anything** — only a gesture,
or a result a human actually rendered* (`docs/ATTENTION.md` §"What a frontend can
acknowledge" and R10). Nothing in the push work relaxes that: **arriving, tapping, or being
woken by a push is not a read.**

#### 1.4 The badge rule, exactly

> **The app icon badge = the number of conversations with unread notifications, over the
> population in §1.2, as read from the machine the app is connected to. The in-app count is
> the same number from the same read. The badge is set by the APP (on connect, on foreground,
> and on an ack); the push never sets it (§1.5).**

Consequences, all deliberate:

- A **conversation with three unread completions counts once.**
- **`notify = 0` completions still count.** They are visibly unread in-app (`unseen` is
  computed without consulting `notify`, `attention.py:1611`), and the badge must equal what
  the rows show. They never push (§2.3). Note the producers are real and ordinary: `closed`
  completions are written `notify=False` (`session.py:10635`), and so are quiet wake/monitor
  rows. The residue — a quiet completion that nobody is looking at raises a badge without a
  push — is the correct reading of the two facts the store keeps apart (`attention.py:12`,
  `:2391-2393`).
- **Pending gates are not in the number** (the P-3 inversion in Context §3). The one-line
  alternative — count rows where `needs_attention`, from the same listing snapshot — is
  recorded as a **cheap, re-openable** decision: it is one predicate in the aggregate, and it
  would restore the old icon meaning at the cost of the operator's stated rule. This ADR
  takes the operator's rule as given.
- **The count is never derived from pushes received.** A device that missed ten pushes shows
  the true badge the next time it can read the machine; a device that received ten pushes for
  one conversation shows 1.
- **`count = 0` clears the badge** (`setBadgeCountAsync(0)`; on Android launcher badge
  support varies — §5).
- **When the machine cannot be read, the badge is not updated** and the app says so: `count`
  is **absent** and `degraded` is `["attention"]`, mirroring the listing's existing contract
  (`daemon.py:739`, `docs/relay/contract.md`:196-200). A store that could not be read is not
  an empty pile (`docs/ATTENTION.md`).
- **The badge is cleared on sign-out and on route removal**, and a route with no push at all
  (§2.4) keeps only the number its last connection read — the app must not leave a stale
  badge behind claiming work it can no longer see. (Review m1.)

#### 1.5 The cloud never sets `aps.badge` (P3)

**Decision: no `aps.badge` field is ever sent.** The icon badge is app-managed: set from the
§1.1 read on connect and on foreground, cleared on ack, and refreshed by a silent wake (§2.3)
when the OS grants one.

Why this beats the alternative, and it is not a detail:

- `aps.badge` is applied by the OS **with no app code running**, from **whichever push arrived
  last**. With two machines (the operator's own permutation) the icon would show machine A's
  count until machine B pushed, then B's — a badge that is never the sum, never the
  connected computer's, and not reconcilable by any rule this document could state. (Review
  M1; it is exactly why "per computer" cannot be expressed in an OS-applied integer.)
- The store's `revision` is equality-only (Context §1), so there is no ordering the cloud
  could use to drop a stale badge — and inventing one (a cloud-side per-device sequence) is a
  new cloud-side authority over a machine-owned number.
- The badge must equal what the in-app list shows (P1). Only the app, holding the list, can
  guarantee that.

**The tradeoff, stated rather than implied:** a backgrounded — and *especially* a force-quit
— app cannot set the badge, so the icon shows the count from its **last connection**, and on
iOS nothing can improve that while the app is not running. A user with two computers will see
the icon of the computer they last opened. The banner is still fresh: it carries the current
count in its **body** (§3.2), so the notification itself is never stale even when the icon is.

**What would fix the icon** (and what would change this decision): the OS's own badge is the
only surface an unused app can update, so any fix means letting a *server* own the number —
either `aps.badge` from a single account-wide count (which requires uploading, and summing,
two computers' unread state — the inversion Context §5 forbids), or an iOS Notification
Service Extension rewriting the number the app last set (it can, but only on an arriving
push, and only for a device that receives one). Recorded, not chosen.

#### 1.6 Cross-*device* is solved here; cross-*machine* is explicitly not

- **Several devices, one machine — covered.** Every device reads the same store through the
  same daemon, and every ack wakes the list SSE (`daemon.py:3694-3695`). A device that is not
  connected is corrected by the attention push (§2.3, §3.3). No double badge: a device's badge
  is the machine's number, and an ack on device A makes device B's next read (or wake) return
  the new number.
- **Several machines — *not* merged, by decision.** Two computers are two `attention.db`
  files, two counts and no shared conversation identity (`conversation_identity()` is
  directory-derived, `attention.py:428-431`, and a conversation id is meaningful only on the
  machine that owns it). **Acknowledging a conversation on machine A will not clear it on
  machine B.** The badge is therefore **per computer**: the icon shows the count of the
  computer the app is currently connected to (§1.5 says so explicitly), and the honest way to
  show the others is a per-computer count in the app's computer switcher (D-3's surface).
- **Why not merge them in the cloud.** It requires uploading `(conversation, read-at)` state
  for every conversation on every machine to Radient — the authority inversion Context §5
  forbids — plus a per-account read history worth more to an attacker than anything else this
  feature touches. **What would change this decision:** an explicit operator decision to
  accept that upload, at which point it is a new ADR and not a patch to this one.

### 2. The delivery path

#### 2.1 The chain, the owning process, and the cursors

```
  ┌─ the machine ───────────────────────────────────────────────────────────┐
  │  turn settles → AttentionStore.publish()            attention.py:1959    │
  │    → a row in attention.db (+ notify flag)                              │
  │                                                                        │
  │  THE PUSH WORKER LIVES IN THE MOBILE DAEMON (`lop mobile serve`)        │
  │  — the always-on process that owns the store and serves the phone       │
  │  (mobile/install.py:1696-1701, :1947). It is NOT the tunnel service:    │
  │  that is a separate LaunchAgent whose 10 s control-plane poll           │
  │  (tunnels/service.py:47) exists for the relay's reachability, and       │
  │  coupling push to it would mean "stop the tunnel, stop the pushes".     │
  │                                                                        │
  │  every 2 s (SCAN_INTERVAL_S, daemon.py:92) — the loop that already       │
  │  reads AttentionStore.revision() (daemon.py:2499-2535):                  │
  │    read NEW publications AND new heals — two cursors:                   │
  │    published_since / superseded_since(cursor)  attention.py:1684/:1740   │
  │    diff acknowledgement_map() (attention.py:1780) for acks               │
  │    → OUTBOUND POST to Radient, authenticated as the connector's          │
  │      credential, Idempotency-Key = emit key (§3.4)                       │
  │      tunnels/api.py:70-125 (the shape already in use)                    │
  └───────────────────────────────────┬─────────────────────────────────────┘
                                      ▼
  ┌─ Radient (proposal — no repository access) ─────────────────────────────┐
  │  route per (account → computer → device) · fan out to APNs / FCM         │
  │  record what was pushed (§2.2) · delete tokens on revocation             │
  └───────────────────────────────────┬─────────────────────────────────────┘
                                      ▼
                            APNs / FCM → the device
```

**The cursors, and why the alternative was rejected (round 1 M2; corrected here by round 2's
M1/M2 and QA Q9).** `unseen` is a LEVEL (Context §1), so a worker with no cursor either
re-pushes everything after a restart or silently drops what arrived while it was down. The
desktop feed solved the identical problem, and this ADR reuses its shape exactly (baseline at
`revision()[0]` on subscribe, `desktop_feed.py:718`; its **three** delta reads,
`:931,1186-1190` — published, acknowledgements, superseded):

| Cursor | Read it with | Holds | Why it is needed |
|---|---|---|---|
| **publication cursor** | `AttentionStore.published_since(cursor)` (`attention.py:1684`) | the highest `completions.sequence` already **emitted** | new completions |
| **supersede cursor** | `AttentionStore.superseded_since(cursor)` (`attention.py:1740`) — the **sequel read** `seq > cursor` (`:1775`), like its siblings, not an equality check | the highest `supersede_log.seq` already **emitted** | **heals**: an in-place correction moves neither `MAX(sequence)` nor `SUM(acknowledged)`, so the publication cursor can never see it — the store's own docstring says so (`attention.py:1743-1744`) and this is QA round 2's Q9. It is the only read that **names** the healed conversation: `revision()`'s third term says only *that* a heal happened (`:2129-2149`, `:2020-2024`), which is why the trigger and the naming are two different reads (QA round 3 Q5) |
| **acknowledgement map** | `AttentionStore.acknowledgement_map()` (`attention.py:1780`), diffed against the previous tick | `{conversation: acknowledged}` | the other half of a change: an ack that arrived since the last tick |

**Detection is structural, never a count (round 2 M1).** The previous draft said the worker
emits "when the count moves down", and that rule cannot see the case it exists for: a tick in
which a publish and an ack land together leaves the derived count *equal*, so nothing is emitted
and the phone keeps a stale badge until its next connect — the exact failure the attention emit
exists to prevent. `revision()` is an **equality** token (Context §1) used as the *trigger* —
"something durable changed, go and look" — while the two cursors and the map say **which**
conversation moved. This is why the heal is delivered on the supersede cursor and not on the
publication cursor (Q9), and why §3.4's content-derived key has something to mint it.

- **A cursor advances only on emit, and "emit" means the cloud's accept (§3.1).** It never
  advances on consideration. This is what makes a deferred or refused push survive a restart:
  an item the presence gate deferred (§2.3) is still ahead of its cursor when the daemon comes
  back and is re-considered rather than lost (round 2 M2).
- **A cursor never advances past an unemitted item.** The pending backlog *is* the region behind
  the cursor. It is bounded on both sides: presence-deferred items by the deferral window
  (5 minutes, §2.3), cloud-refused items by three attempts over ~2 minutes (below); an item that
  exhausts either bound is dropped with one log line, so the cursor can never be blocked forever
  by one undeliverable item.
- **Restart** is therefore a bounded catch-up: everything emitted-but-unaccepted, and everything
  never emitted, is still ahead of its cursor — and nothing already accepted is re-emitted.
  **The supersede cursor is the one read with a floor**: the store prunes `supersede_log` to its
  newest **256** rows in the same transaction as the heal that writes them
  (`_SUPERSEDE_LOG_RETENTION = 256`, `attention.py:421`; the prune statement `:423-425`, executed
  at `:2113`), so a downtime spanning more heals than that loses their identity to the cursor even
  though `revision()[2]` still reports that heals happened (QA round 3 Q2, measured: 300 heals →
  `superseded_since(0)` returns 256, `revision()[2]` = 300). **What the worker does when it is
  exceeded, explicitly: it re-baselines and says so.** The condition is computable from the read
  itself — if the newest returned `seq` is more than `len(entries)` past the cursor, entries were
  pruned — and the response is to set the supersede cursor to that newest `seq` and log one line
  naming the count it could not carry. It does not sweep and it does not block: a lost heal
  identity means one *push correction* is missed, and the badge, which the app reads from the
  machine, is right on the next connect.
- **Catch-up is bounded and coalesced.** More than `BURST_LIMIT`-worth of eligible rows in one
  catch-up emits **one digest push naming the count**, mirroring the TUI/desktop burst rule
  (`docs/design/notification-feed.md`, `BURST_LIMIT = 3`). The cloud has its own guard at a
  different scale — a per-computer ceiling of 60 events/hour, the excess merged into one digest
  emit rather than dropped — and the two are independent by design: the machine coalesces what
  it *holds*, the cloud what it *receives* (`docs/push-cloud-ops.md` §3).
- **Two retry policies, deliberately not folded into one (round 2 m1).** *(a) The presence
  deferral* is machine-local: a timer bounded at 5 minutes and terminated early by a real read,
  so it never leaves the machine at all. *(b) A cloud refusal or timeout* is a wire retry of the
  **same** idempotency key: three attempts over ~2 minutes, then a drop with one log line
  (`docs/push-cloud-ops.md` §6). **A daemon restart interrupts (a) and abandons (b)**: (a) is
  re-considered from the cursor; (b) is given up because the accept-or-not state lives in the
  cloud, and the machine's only correct move after a restart is to re-emit with the same key —
  which the cloud's `Idempotency-Key` turns into a duplicate `202`, not a duplicate push.
- **The considered alternative, and why it is not chosen:** a per-surface watermark in
  `attention.db` itself (`push_delivered`, mirroring `deliveries`, keyed by conversation or
  by device). It is what a naive design reaches for, and it is *defensible* — the argument
  that killed "the phone as a fifth rung" (a lease needs a clock two observers may disagree
  on, `attention.py:2403-2415`) does not apply, because the worker is a single claimant. It
  is rejected for a smaller reason than that: the cursor plus the cloud's own per-device
  delivery record (§2.2) already cover both failure modes, and a second writer inside the
  machine-global store buys nothing except a new table to migrate, bound and prune. Recorded
  here so a future reader does not have to rediscover it.

#### 2.2 What the cloud holds, and what it must not

| Record | Fields | Why it is the minimum |
|---|---|---|
| **Device** | `device_id`, `platform`, the push token, `environment` (`sandbox`/`production` — only the app knows which build it is), app build, `created_at`, `last_seen_at`, **`credential_live`**, and the state markers **`revoked_at` / `unpaired_at` / `expired_at`** | token rotation and revocation are the whole of device management; **the markers are the states §4 defines, and §4's precedence (revoked > unpaired > expired) is what every reader of the row — the register route, `list`, the delivery gate — resolves, so one row cannot be read two ways** |
| **Account → devices** | account id → live device ids | routing; the account already exists (`GET /v1/me`, `tunnels/api.py:144-170`) |
| **Computer → devices** | the connector's tunnel identity → the devices registered for *that* machine | a user with three machines must not be pushed about machine C's work while paired to A |
| **Delivery** | `(device_id, conversation_handle, emit_id)` → sent/attempted, provider id, response code, **kept 14 days** | the record of what was pushed: it is what makes re-delivery idempotent, a revocation testable and the cloud's own alerts meaningful. **It is not returned to the machine** (§3.1) |
| **Credential (per device)** | `credential_live` + `last_authenticated_at`, **reported by the relay** on every authenticated request that names its device (`X-Lop-Device`, §3.1/§4) | the second limb of §4 rule 2: **the cookie is the relay's to see and nobody else's**, so the relay *evaluates* and the cloud *enforces*. The cloud cannot compute this from a registration, and without the report the rule would be unenforceable exactly where it is asserted |
| **Credentials** | the APNs `.p8` key id + team id; the FCM service account | the reason the cloud has to exist at all |

**What the cloud must NOT hold:** transcripts, conversation names, session ids, working
directories, model names, prompt text, **read state or read history**, and **no unread
count** (§1.5). §4 says what it does learn, honestly, including the residue.

**Two retention rules this ADR adopts, and one honest gap** (designed in the cloud ops note,
[`docs/push-cloud-ops.md`](../push-cloud-ops.md), PR #15 — the note stays the operational
runbook; the rules are the ADR's, and the note's text is being aligned to them): delivery records
are kept **14 days**, and a device with **no authenticated request for 60 days has its row
dropped entirely — no marker** *(corrected in this pass: the earlier draft called this a
tombstone, which is the one thing it must not be — a tombstone refuses re-registration, and this
drop is explicitly "rather than a ban")*. So it is §4's **absent** state: the app re-registers on
its next launch, which that state allows by definition. Last-seen is the device's last
*authenticated* call — the app reading unread on launch, foreground or connect — not its last
delivery; the 60/hour per-computer ceiling stays the note's operational limit, not a state rule.
**The gap, stated rather than discovered later:** the machine's registry (§3.1) does not see that
drop, so a device can appear paired in the app's Settings while push is paused for it, until it
next opens the app. Settings must not claim otherwise, and §4's "notifications never stop
silently" is the rule that closes it: every stop — the drop, a rotation, a lapsed cookie — is
either repaired (the drop, by re-registering) or reported (the suspension) the next time the
device reaches the relay, and none is left silent.

**The attention push is not "the same route with a flag" for idempotency purposes** (review
M4): a completion event and a correction are different deliveries with different keys (§3.4).

#### 2.3 Who decides that a push may be raised

The core has an **eligibility ladder** for OS banners and behind it a machine-wide
arbitration watermark: a watching surface suppresses the banner (rung 1); otherwise a
notify-capable desktop app claims the completion (rung 2); otherwise a running TUI (rung 3);
otherwise the runtime itself (rung 4). The claim is `claim_delivery`, one durable `deliveries`
watermark **per conversation**, and **exactly one** surface ever wins (`attention.py:2379-2460`;
`docs/ATTENTION.md` §"Who raises the banner").

**Decision 1: the phone is not a rung, and `claim_delivery` is untouched.**

- The watermark is per conversation, so a push that claimed would silence the desktop banner
  on the same machine — and a *desktop* claim would silence the phone for a user who is not at
  their computer at all. The two audiences are different devices in different places; they are
  not competing for one screen the way rungs 1–4 are.
- It cannot be fixed by ordering: whichever claim wins, the loser is silenced **for that
  completion** with no lease and no expiry (`attention.py:2403-2420`; QA's probe confirms the
  compare is per sequence, so a *newer* completion in the same conversation is claimable
  again). A coin-flip between "the banner you needed" and "the phone you needed" is worse than
  either.
- It would break the claim's own invariant that the claimant **is** the deliverer
  (`docs/ATTENTION.md`:148-156).

**Decision 2: the presence gate is a DEFERRAL, not a suppression — and the TUI viewer record
is not consulted (review M3).**

The gate is the user's own promise in Settings ("don't notify while I'm at the computer",
`docs/ux/flows.md`:570, and principle **P-8**, `docs/ux/principles.md:135`) — implemented from
the presences that already exist, not from a new clock:

- **The signal is the desktop presence only**: a window that is focused AND visible AND not
  minimised (`desktop_presence.py:84-86`), fresh within its TTL
  (`PRESENCE_TTL_S = 45.0`, `presence.py:83`). **The TUI viewer record (`viewers.py`) is not
  consulted**, because the phone is elsewhere: "a TUI is running on this machine" says nothing
  about whether a *phone in a pocket* should be told, and consulting it is what made this
  ADR's own "a TUI at the terminal and a phone in a pocket both get told" impossible to hold.
  The TUI viewer record keeps its existing job — rung 3 of the local banner ladder.
- **A suppressed push is deferred, not dropped**: the worker re-checks after
  `PRESENCE_TTL_S` (45 s) while the completion is still `unseen` and still within a bounded
  window (5 minutes), then emits. The deferral terminates early on an ack, because reading the
  conversation in the app is exactly what makes `unseen` false. There is no idle or lock
  signal anywhere in these modules, which is precisely why the gate cannot be a hard
  suppression: a window left focused would otherwise silence the phone for good — the same
  failure this ADR uses to reject the claim rung.
- **The Settings toggle upgrades the deferral to a suppression.** With "don't notify while I'm
  at the computer" ON, a fresh presence suppresses **outright** (bounded by the window, then
  dropped). That is the user's own instruction, stated in their own words, and it is the only
  form in which this design silences a phone.

**The user-visible consequence, stated plainly:** by default, if you are looking at the
desktop app when a turn finishes, your phone buzzes **45 seconds later** unless you read the
completion in the app first. With the toggle on, it does not buzz at all while you are there.
That is the tradeoff between P-8 ("do not interrupt a user who is already looking at the
work") and never missing a completion, and it is the user's switch to move.

**Decision 3: the remaining gates**, in order, all machine-local reads:

1. `unseen` for the completion, still true at send time (§3.3's anti-race guard);
2. `notify` (§1.4; `attention.py:2026-2033` computes it, the store never derives it);
3. the presence rule above;
4. the account has at least one live device registered for this computer.

**And the ordering property this preserves:** a TUI at the terminal *and* a phone in a pocket
both get told. Nothing is silenced by the other — and now nothing in this document says
otherwise (review M3's second half).

#### 2.4 Which machines can push at all, and the copy for the ones that cannot

The deciding fact is **the machine's Radient login**, not the app's route (review Q6). A push
is delivered by a *server* holding the app's credentials; the machine reaches that server with
the connector's credential; **whether the phone reached the relay over a Radient tunnel or a
custom URL does not enter the chain at all** — the cloud delivers to APNs/FCM, which is
outbound from the cloud to the device, and needs no tunnel.

| Machine's Radient login | Push | What the app shows |
|---|---|---|
| present | **works** — including for a phone on a custom route or Tailscale, and even with the tunnel stopped | the normal notification settings |
| absent (the fully self-hosted case: no Radient account anywhere) | **no push, and no design here can add one** — there is no server that may hold APNs/FCM credentials for this app | the honest statement below |
| present, but the connector's login is dead | pushes stop until it is renewed (`docs/tunnels.md` "A dead Radient login"); the machine says so in `lop tunnel status` | the app cannot see this state today; the Settings line is written for the login case, and the plan carries the "connector parked" row as a follow-up |

**Plainly, because the operator asked for it plainly:** a user who runs no Radient account
gets **no push at all**, in this design and in any design that uses APNs or FCM, because APNs
and FCM both require a server holding the app's credentials and that server is Radient. There
is no self-hosted iOS wake mechanism to substitute. (A self-built push gateway the user runs
against their own Apple/Google developer credentials is a product of its own; §9 records it
and this ADR does not design it.)

What the app does instead, and what it must say:

- **While foregrounded**: the SSE list and per-session streams are live
  (`/api/sessions/events`, `/api/sessions/{id}/events`), the marks and the in-app count are
  correct, and the icon badge is set directly from the §1.1 read. No push is involved in any
  of it.
- **A local notification while the app is running** is a legitimate addition and is a slice of
  its own (`docs/push-plan.md` S9), for foreground arrivals and for every route. It is *not* a
  substitute and must not be described as one.
- **On foreground/resume, a full resync**: the SSE reconnect's snapshot plus a
  `/api/attention/unread` read reconcile the badge and the rows. There is no delta to miss,
  because the wire is snapshot-based by design (ADR 0002 principle 1).
- **The icon badge is not left stale by the route**: it is cleared on sign-out and on route
  removal (§1.4), and on a machine that cannot push it reflects the last connection only —
  which §1.5 already discloses.
- **In Settings the truth is stated once, where the toggle is**, in the Local Operator voice,
  naming the *remedy*, not the limitation. Proposed copy for the designer to review in the app
  slice:

  > **Notifications** — *This computer is not signed in to Radient, so pushes have no way to
  > reach your phone. Sign in on that computer to get alerts while the app is closed; until
  > then alerts work only while Local Operator is open.*

  and, in the same slot with the machine signed in but notifications denied at the OS level
  or no device registered, the matching sentence for that state. Never "you will be notified"
  when the state cannot deliver one — the rule ADR 0005 §5 already set.

**Two Settings rows are not shipped in v1, and the copy must not promise them** (review Q5b):
**quiet hours** (there is no quiet-hours concept in the core; the platforms' own Focus /
Do Not Disturb already suppress banners and they are the right owner of it) and **"when a
session needs a decision"** (gates do not push — §1.4, and the plan's follow-up). Both rows
are listed in the **Amends** block at the top so the flows document is not left claiming
otherwise.

### 3. The ack-sync contract

All operations are on the **mobile relay** unless marked *(cloud, proposal)*. Shapes are
JSON; every relay route is auth-gated by the existing `lop_mobile` cookie with its 30-day TTL
(ADR 0002 §6, `docs/relay/contract.md`:48-52).

#### 3.1 The operations

**Register a device** *(new)*. The app posts the token it got from the platform; the **relay**
is where it lands, and the relay forwards it, because the machine holds the credential and the
pairing (P4).

```jsonc
POST /api/push/register
{"platform": "ios" | "android",
 "token": "<opaque platform token>",
 "environment": "sandbox" | "production",     // only the app knows which build it is
 "app_version": "1.0.0 (12)",
 "install_id": "<uuid, minted once and kept in the keystore>"}
→ {"ok": true, "device_id": "…", "registered_at": 1759…}

// Idempotent on (install_id, platform): re-registering with a rotated token REPLACES the
// token and keeps the device_id, so a device that rotates its push token cannot accumulate
// rows. THE TOKEN IS FORWARDED AND NOT STORED ON THE MACHINE — the relay keeps the cloud's
// device_id and the metadata a Settings list needs.
//
// REFUSED when this `install_id`'s row carries a marker that forbids registering (§4, and the
// precedence there is revoked > unpaired > expired):
//   403 {"code": "device_revoked",  "error": "this device was revoked on this computer"}
//   403 {"code": "device_unpaired", "error": "this computer is no longer paired"}
// `expired_at` does NOT refuse — re-registering IS the act that clears it (authenticate, then
// register). Silence would be worse than any of the three: the app must be able to say which
// state it is in instead of showing a registered device that never receives anything.
//
// AND REGISTRATION IS ONLY HALF OF DELIVERY (§4 rule 2): the cloud delivers to a device only
// while its registration is backed by a live credential — and that flag is the RELAY's to
// compute, because the cookie is the relay's to see. Every authenticated request that names its
// device (`X-Lop-Device: <install_id>`, additive) reports `credential_live` +
// `last_authenticated_at` to the cloud (§2.2); a rotation emits one credential-change event and
// the cloud pauses fan-out for that computer's devices until each device's next authenticated
// request. Registering records the credential epoch, and the machine compares it on every emit.
// A rotation sets `expired_at`, NOT `revoked_at` — see §4: the two states are deliberately
// different.
```

**List this computer's devices** *(new)* — what the phone's Settings renders:

```jsonc
GET /api/push/devices → {"devices": [{"device_id":"…","platform":"ios","name":"…",
                                       "app_version":"…","registered_at":…,"last_seen_at":…,
                                       "state":"live|expired|unpaired|revoked"}],
                        "precedence":"revoked > unpaired > expired"}    // §4's one vocabulary
```

**Revoke / deregister** *(new)*. This is the **revoke** path of §4: it drops the cloud's token
and **tombstones the row** (`revoked_at`), so the device cannot silently re-register itself.
`device_id` may be the caller's own or **another device in this computer's registry** (the
stolen-phone case, §4):

```jsonc
DELETE /api/push/devices/{device_id}   → {"ok": true}          // revoke: token dropped, row tombstoned

// The way back, and the reason it is explicit rather than automatic (§4, "How a device comes
// back"): the tombstone is cleared only by a deliberate act, and the token is NOT restored with
// it — the device must register again, which needs a live credential.
POST /api/push/devices/{device_id}/unrevoke → {"ok": true, "device_id": "…"}
```

**Fetch unread** *(new, §1.1)*: `GET /api/attention/unread` → the aggregate above. This one
route is what the in-app count, the icon badge and every resync read.

**Resolve a handle** *(new, §4)*: `GET /api/push/conversation/{handle}` → `{"session_id": "…"}`
or `404` when the handle is unknown (a rotated key, or a conversation that no longer exists).
This is what makes a cold tap landable when the conversation is not in the unread set.

**Ack a conversation** *(exists, unchanged, plus one additive field)*:
`POST /api/sessions/{id}/seen` with `{"completion_token": "…", "device_id": "…"}`. The
`device_id` is **additive and optional**: it is how a self-correcting attention push skips
the device that just acted (§3.3). 200 `{ok, attention}`; 422 missing token
(`daemon.py:3667-3671`); 409 `{"code": "superseded_completion_token"}` when a newer
completion replaced it (`:3676-3690`); 404 unknown session; 401 unauthenticated. **The app
re-reads the projection and retries with the token it now names** — the refusal carries no
state on purpose (`attention.py:2175-2240`).

**Emit a completion event** *(cloud, proposal)*: `POST /v1/tunnels/{tunnel_id}/push/events`,
`Idempotency-Key: <emit key, §3.4>`, body = §3.2's `data` (with `emit_id` as the machine's own
identity for the emit), and the answer is **`202 {emit_id, accepted_at}` — accepted and queued**:

```jsonc
POST /v1/tunnels/{tunnel_id}/push/events      (Idempotency-Key: <emit key>)
→ 202 {"emit_id": "<uuid>", "accepted_at": 1759…}
```

**The response is an acknowledgement, not a delivery report — and this replaces the previous
draft's synchronous per-device result** (reconciled with the cloud ops note,
[`docs/push-cloud-ops.md`](../push-cloud-ops.md) §1, which specifies the same shape and says so
explicitly). The reasons, so the choice is not just a fit to the note:

- **The outcome is not actionable on the machine.** A device may be offline for hours; "device B
  did not accept" tells the worker nothing it can *do*, and the badge is right on the app's next
  read regardless.
- **A synchronous fan-out would put APNs/FCM latency inside the daemon's 2 s tick**, and would
  couple the worker's pacing and restart behaviour to a remote call's duration — for information
  nothing consumes.
- **The delivery record already exists** (§2.2) and is a cloud-side fact kept for the cloud's own
  dedupe, revocation and alerts. It is **not part of the machine's contract**: the machine never
  reads it, and adding that read later is a new route and an ADR amendment (the ops note's own
  rule — the field table *is* the contract).
- **What the machine does instead** is what §2.1 specifies: it queues locally against its cursor,
  treats **2xx as accept** and advances the cursor, retries the same key three times over ~2
  minutes on a non-2xx or timeout (a retry the cloud dedupes into a duplicate `202`, not a
  duplicate push), and drops with one log line after that. Push remains a nudge.

**Emit an attention change** *(cloud, proposal)*: the same route, the same `202`, with
`type: "attention"`, **its own key** (a machine-minted emit sequence, §3.4) — never the
completion's key, or the cloud treats the correction as a replay and drops it — and an explicit
**`exclude`** list naming the device that just acted (below).

**Emitted where the read state actually moves (review M4).** The relay sees only its own
`POST /seen`; acks from the TUI and the desktop are written by other processes straight into
`attention.db` (`app.py:40741`, `routes/desktop_sessions.py:3428,3462`) and are visible only
through the store. So attention events are emitted by the **worker**, on a change it detects
itself, and `revision()` is the detector it already reads (`daemon.py:2499-2535`):

1. **on a tick**, the worker compares the `revision()` triple with the one it holds — an
   **equality** check used as the trigger — and, when it differs, asks the two reads which
   conversation actually moved: `acknowledgement_map()` diffed against the previous tick (an ack
   landed) and the supersede cursor (§2.1; a heal landed). It emits **per changed conversation**,
   never on a derived count (round 2 M1: a tick where a publish and an ack coincide leaves the
   count equal, so a count rule would miss the correction entirely);
2. the relay's `/seen` handler additionally nudges the in-process worker with the acking
   `device_id`. **The nudge consumes the change** (round 2 m3; the state defined in round 3 Q3): it advances
   the worker's stored **detector state — the `revision()` triple *and* the
   `acknowledgement_map()` snapshot**, which are the two things the tick consults — so the same ack
   cannot be emitted twice, once immediately and once on the next tick — and the emit body carries `"exclude": ["<device_id>"]` so the acting
   device is skipped while every other device is still corrected. **The bound, stated exactly: at
   most one emit per change.** A duplicate is possible only inside one race window — a tick that
   has already read the store before the nudge consumes the change — and it is benign rather than
   harmful, because a correction only asks a device to re-read state it can already see. The
   slice's exit criterion is therefore "one emit per change — the nudge consumes both halves of
   the detector state — and a race-window duplicate leaves every device correct", not an absolute
   this paragraph would then have to take back.

That is the slice that makes the headline scenario — *clear a completion on the desktop and
the phone's number drops* — actually exist, which no slice did before.

#### 3.2 The push payload, and what it deliberately does not carry

```jsonc
{ "aps": { "alert": {"title": "Local Operator",
                     "body": "Task complete · 2 conversations need you"},
           "thread-id": "<conversation handle>",
           "interruption-level": "active" },
  "data": { "v": 1,
            "type": "completion",                       // "completion" | "attention"
            "computer": "<opaque per-account computer handle>",
            "conversation": "<opaque conversation handle>",
            "completion_token": "<uuid>",
            "kind": "complete|error|interrupted|closed|retired",
            "emit_id": "<uuid, minted by the machine per emit>",
            "count": 2 } }
```

The attention form carries `{v, type: "attention", computer, count, emit_id, exclude: ["<device_id>"]}`
and
`aps: {"content-available": 1}` — a **silent, best-effort wake** (§5). One term is used for it
throughout: **the attention push**.

| Field | Why it cannot be dropped — or why it is not there |
|---|---|
| `type` | a tap on an attention push must not deep-link anywhere; it is a badge correction |
| `conversation` (handle) | the tap must resolve to a conversation and `apns-collapse-id`/`notification.tag` must collapse per conversation — without the raw session id (§4) |
| `completion_token` | the tap's ack is token-bound, and §3.3's guard compares it |
| `kind` | the title/body differ per outcome; the app must not re-derive it. It is the **store's** vocabulary (`complete, error, interrupted, closed, retired` — `attention.py:1611`), not the composer's: `compose.NotificationKind` lists `retired` and the gate kinds but **not `closed`** (`compose.py:60`), so a push builder keyed to the composer's literal set would silently drop a real outcome |
| `emit_id` | the machine's own identity for one emit, for dedupe and for the cloud's delivery record. **It replaces the `revision` counters that the previous draft carried** (review M7): an opaque UUID per emit cannot be read as activity volume |
| `exclude` *(attention only)* | the device that just acted, so the self-correcting push skips it — the one field that makes §3.1's exclusion representable at all (round 2 M3: the claim had no wire field). Absent means "exclude nobody", which is what a tick-detected change sends because it never knows who acked. `(proposal)` like the rest of the attention form |
| `count` | the number in the notification's **body**, so a user can judge whether to look now. **Deliberate, disclosed leak**: it is the machine's unread count at composition time, and the cloud sees it. (The alternative — body says "A turn finished" and nothing else — is a one-line change; recorded, not chosen) |
| ~~`aps.badge`~~ | **not sent, ever** (§1.5) |
| ~~conversation name~~ | **never sent** (P2). Not in the title, not in the body, not in any field. §2.2 says the cloud must not hold it, and `session_names_in_notifications()` gates *local* notifications on the machine (`notify.py:802-820`, **default `True`** at `:820`) — it is not a cloud-facing consent, and it must never be read as one |
| ~~`revision`~~ | dropped (M7). The badge comes from a read, not from a push |
| ~~snippets, error text~~ | **never sent.** The push body is composed from the house constants only (`notify.py:183-192`, `BODY_COMPLETE`/`BODY_ERROR`/…), through a **push-specific builder** — never through the desktop composer's body path (`compose.py:93-113`, whose `body` is a last-assistant-line snippet when the privacy flag allows and whose `body_is_failure` text "may name a provider, a model or a quota"). A builder that reuses `notification_payload()` with its defaults would put model-written text into an APNs payload, so the builder is named as a slice deliverable and asserted against in a test |

**What the notification shows before the app has ever connected** (P2's corollary, and the
question review M6 asked): the title is `APP_NAME` (`notify.py` uses it when the name is
unavailable) and the body is the house sentence plus the count. **A conversation name cannot
appear in a banner on this design** — the machine does not send one and the app has no name
for a conversation it has never fetched. The name appears the moment the app connects and
renders the conversation, in the app. This is a real loss against a hypothetical design that
sends the name, and it is the price of P2.

#### 3.3 Ordering and the race rules, per permutation

| Permutation | What happens | The rule that makes it safe |
|---|---|---|
| **App foregrounded, watching that conversation** | the completion is in band: the machine suppresses the push by the presence rule (§2.3) and rung 1 suppresses the banner | no notification is raised for a conversation already on screen; the app's own SSE frame carries the new state |
| **App foregrounded, another conversation** | the app receives the push and `setNotificationHandler` **suppresses the OS banner**, surfacing it in-app instead | one decision, stated: the in-app surface is authoritative while the app runs (review M11's Q2 choice) |
| **App backgrounded** | an alert push names the kind and the count. A tap wakes the app, resolves the handle (§6), opens the conversation, and the ack fires **only after the completion row is genuinely rendered** | the same rule the desktop states as a foreground-receipt guard, in the app's own terms (`docs/ATTENTION.md` §"What a frontend can acknowledge") |
| **App killed (iOS force-quit)** | the alert push still arrives and a tap cold-starts the app; **no silent wake is delivered to a force-quit app**, so nothing may depend on one | the design never assumes a background wake on iOS; the badge is corrected on the next connection (§1.5) |
| **Several devices, one machine** | device A acks → the receipt is written → the worker emits an attention push (excluding A when the nudge path is used) → B wakes, re-reads the count, sets its badge | B is corrected even though B never saw the completion; a wake that never arrives leaves B stale only until its next connect (§1.5) |
| **Devices on different machines** | each device shows the badge of the computer it is connected to; nothing merges | §1.6's per-computer rule, and §1.5's explicit staleness window — **not** "harmless" |
| **An ack races an in-flight push** | the worker re-checks `unseen` for that completion immediately before emitting, so an ack landing first suppresses the send. If the push is already at APNs it still arrives; the tap lands on the conversation, which renders **already read**: the app does not re-ack, does not change the badge, does not show an unread mark | the second check is a read, not a claim, so it cannot perturb the claim's clock-free predicate |
| **A push arrives for a conversation acked seconds ago on another surface** | the app reconciles against the machine: `unseen` is false, so nothing is marked, nothing is acked, and the badge keeps the value the machine returns | the tap is authoritative over the push — a push is a doorbell, not a record |
| **A heal: a provisional outcome is corrected** (`interrupted` → `complete`) | the *completion push* may already have been sent with the provisional kind; the corrected record is a **new delivery**, because the emit key carries the record's content (§3.4) | the app never trusts a push for state: the conversation it opens shows the machine's current record. The correction exists so the *notification* is not permanently wrong |
| **A push is reordered or coalesced by APNs/FCM** | the badge is not carried, so ordering cannot corrupt it; a stale banner says only "a turn finished", which is true | §1.5's decision removes the class of bug rather than defending against it |

**Three rules that carry the whole table:**

- **The badge is never incremented and never read from a push.** It is the number the machine
  returns when the app reads it (§1.4) — so a missed, duplicated, reordered or coalesced push
  cannot drift the count. The increment design is rejected by name.
- **The tap is authoritative over the push, and the machine is authoritative over both.**
- **Nothing drops state on a revision comparison** (Context §1): an equal `revision` means
  "possibly changed — go and look", never "stale, discard" (review QA Q2's contradiction is
  resolved here, and in §1.1).

#### 3.4 Idempotency and keys, stated once

| Operation | Key / idempotency | Heals |
|---|---|---|
| `POST /api/push/register` | `(install_id, platform)`; the token is replaced, `device_id` stable | n/a |
| `POST /api/sessions/{id}/seen` | `completion_token`; a duplicate or delayed receipt converges upward (`MAX(receipts.acknowledged, excluded.acknowledged)`, `attention.py:2247-2249`); a receipt for a superseded token is **refused, not recorded** | a heal keeps the token; the refusal is the app's cue to re-read |
| completion emit *(cloud, proposal)* | **`sha256(completion_token ‖ anchor_id ‖ kind)`** — the record's *content*, which is exactly what `publish`'s supersede rewrites (`attention.py:2094-2100`); the cloud answers `202 {emit_id, accepted_at}` (§3.1) | **a heal changes the key, so the correction is a new delivery and idempotency cannot swallow it** (P5) — **and the key is actually minted, because a heal is read on the supersede cursor** (`superseded_since`, `attention.py:1740`; §2.1). QA round 2's Q9 was exactly this: the distinct key existed in this table while no cursor in §2.1 could see the heal that mints it |
| attention emit *(cloud, proposal)* | a machine-minted monotone **emit sequence**, persisted with the cursor — never the completion's key | n/a (an ack is not a heal) |
| the supersede cursor | `superseded_since(seq)` (`attention.py:1740`) — the **sequel read** `seq > cursor` (`:1775`), like its siblings | it is the only read that **names** the healed conversation: a heal moves neither `MAX(sequence)` nor `SUM(acknowledged)`, and `revision()`'s third term says only *that* a heal happened (`:1743-1744`, `:2129-2149`) |
| the badge | **not a wire field at all** (§1.5); it is the machine's count at read time | n/a |
| `AttentionStore.revision()` | equality only, and it is the machine's own change detector — it never reaches the wire | the heal moves its third term |

### 4. Privacy and security boundaries

**What leaves the machine, exhaustively:** an opaque conversation handle, an opaque computer
handle, the completion's kind, the completion token, the emit id, and the unread count. **No
conversation name, no transcript, no snippet, no failure text, no prompt, no working
directory, no file path, no model name, no tool output, and no read history.**

**The conversation handle: mint, scope, and resolve** (review M10 — this was too vague to
implement from):

- **Mint**: `handle = base64url(HMAC-SHA256(key, conversation_identity))[:22]`, where `key` is
  32 random bytes in `<config root>/push-handle.key` (0600), minted on first use. The mapping
  is a **machine-local HMAC, not a stored table**: nothing to migrate, nothing to prune, and
  `conversation_identity()` (`attention.py:428-431`) is already the stable input.
- **Scope**: **per machine**, deliberately not per account. Two machines therefore produce
  different handles for what a user thinks of as "the same conversation" — which is correct,
  because §1.6 says they are different conversations.
- **Where the app gets it**: the aggregate's `conversations[].push_handle` (§1.1) — bounded to
  the unread rows, so ~22 bytes × the unread count rather than 22 bytes on every list row
  (the per-row alternative was rejected on frame size, recorded here).
- **Resolve**: `GET /api/push/conversation/{handle}` (§3.1) for the cold-tap case where the
  conversation is not unread any more.
- **Rotation**: deleting the key changes every handle; pending pushes then resolve to 404 and
  the app falls back to the list (§6 item 5). That is the recovery path, and it is also the
  only way to break the correlation below.

**What the cloud does learn — the honest version** (review M7; the previous draft claimed the
cloud "cannot count, correlate or name a conversation", which was false by construction):

- **The cloud can build a per-computer activity timeline**: when a conversation finished, its
  outcome class, and how often. A stable per-conversation handle is what `thread-id` and
  collapse require, and it is stable *by design*.
- **It cannot read or name anything**: no content, no title, no session id, no path.
- **It cannot correlate across machines or with any Radient-side identity**, because the
  handle is an HMAC under a machine-local key that never leaves the machine (§4 above) — that
  is a derived property of the mint, not a promise.
- **No counters ride the wire**, so it cannot infer how much *unpushed* activity happened
  (the previous draft's `revision` fields did exactly that — `MAX(sequence)`'s gaps reveal
  volume and `SUM(acknowledged)` is a timestamped read-history stream; both are gone).
- **The one disclosed aggregate** is `count` (§3.2): the number of unread conversations on the
  machine at that moment. It is enough to see "busy day / quiet day" for a computer.

**Token handling.** Device tokens are opaque strings; **the machine never stores them**
(P4 — the relay forwards the token to the cloud and keeps only the cloud's `device_id` and the
metadata a Settings list needs: platform, app version, registered/last-seen). The cloud stores
tokens encrypted at rest, keyed to the account and the computer. The APNs `.p8` and the FCM
service account live in the cloud's secret store and never in the app or the repository; per
this repository's rules, `google-services.json` / `GoogleService-Info.plist` are **build inputs
injected from CI secrets**, never committed (the repo is public; `AGENTS.md`: "Never commit
tokens, … certificates").

**Revocation, and the stolen phone (P4, and review M9's question answered explicitly).** Five
paths, and the honest limits of each:

1. **From the machine** — `lop mobile devices revoke <id>` or the phone's own Settings
   unpair → `DELETE /api/push/devices/{id}` → the cloud **drops the token and tombstones the
   row** (rule 1 below). **Requires the machine to be reachable**, which is exactly the case a
   stolen phone makes unreliable.
2. **From the Radient account, with no machine involved** — the account's console/API revokes
   the device: the same tombstone, applied cloud-side. **This is the primary remedy for a
   stolen device**, and it needs a Radient-side device list: a **new cloud-side surface of the
   same class as the blocked account-deletion item** (§7).
3. **Rotating the relay password** invalidates every device's `lop_mobile` cookie at once —
   the cookie key is derived from the password (`docs/relay/contract.md`:48-52, ADR 0002 §6) —
   so it cuts a stolen device off from the relay immediately, and (with rule 2 below) it stops
   **push delivery** to that device too, without revoking anything, and the marker it writes is
   **`expired_at`** — never `revoked_at` — reported to the cloud as one credential-change event so
   fan-out pauses until each device authenticates again (rule 2). **It is not a revoke**, which
   is why (1)/(2) are still required for a stolen phone: the device returns the moment it can
   authenticate, and so would a thief who learned the new password. The app's copy must not
   conflate the two.
4. **Server-side per-token revocation** and **dead-token deletion** (APNs `410 Unregistered` /
   FCM `UNREGISTERED`) — deletion is not optional: an accumulating token table is a privacy
   liability and a cost. **This is the *absent* state below, never a tombstone** (rule 3): the row
   goes, no marker is written, and re-registration is allowed and expected.
5. **Unpairing a computer** cuts off every device bound to it — one **`unpaired_at`** marker
   each: durable like a tombstone, but *named for what actually happened* (rule 1) — because a
   device paired only to A has no business being pushed about B, and because a deregistration the
   user was told about must not be reversible by the device itself. The app's copy distinguishes
   the two: a revoke says the **device** was revoked, this says the **computer** left.

**The five device states, and the rule that closes the stolen-phone gap (P4; the ops note's
round-4 finding, which read the register route as consulting nothing).** A device is in exactly
one of these states, and the state decides *both* whether it receives anything *and* whether its
row may be registered again:

| State | Marker | Token | May register again? | Entered by |
|---|---|---|---|---|
| **Live** | none | present | — (it is registered) | `POST /api/push/register` on an authenticated session, recording the credential epoch it was made under |
| **Expired** | `expired_at` | kept | **yes**, by authenticating again | the **credential lapses**: a relay-password rotation (path 3) or the `lop_mobile` cookie's own TTL — **evaluated by the relay** (rule 2), the only component that sees the cookie |
| **Unpaired** | `unpaired_at` | dropped | **no**, until that computer is paired again | unpairing the **computer** (path 5): the devices bound to it go with it |
| **Revoked** | `revoked_at` | dropped | **no**, until it is un-revoked | an explicit revoke of *this device*: path 1 or path 2 |
| **Absent** | — (no row at all) | dropped with the row | **yes** | a provider dead-token (path 4) or the 60-day idle drop (§2.2) |

**The precedence is `revoked` > `unpaired` > `expired`, and the names are shared vocabulary with
the cloud ops note** — the register route (§3.1), `GET /api/push/devices` (`list`) and the
delivery gate all resolve the *same* precedence on the *same* markers, so no two surfaces can read
one row as two different states. A row may carry more than one marker (a device revoked, and then
its computer unpaired); the winner decides both what the route answers and what the user is told.

Three rules follow, and together they are the whole of the revocation semantics:

1. **A revoke TOMBSTONES.** The token goes (there is nothing left to deliver to) and the row stays
   with `revoked_at` set. **`POST /api/push/register` refuses a device whose row carries
   `revoked_at`** (`403 {"code": "device_revoked"}`) — that refusal is what makes a revoke stick
   for the same `install_id` instead of being undone by the next app launch. **An unpair is
   durable in the same way, under its own marker**: the device's row carries `unpaired_at`, the
   register route answers `403 {"code": "device_unpaired"}`, and the app says *which computer*
   left instead of claiming a revoke nobody performed. Neither marker is cleared by the device
   itself; both are cleared by a deliberate act (below).
2. **Delivery requires BOTH a registered device AND a live credential for it — and the evaluator
   is the relay.** The registration is only half. The relay is the only component that ever sees
   the `lop_mobile` cookie, so it *evaluates* the second half and *reports* it; the cloud holds the
   flag and *enforces* it, because it cannot compute it. Concretely: every authenticated relay
   request that names its device (`X-Lop-Device: <install_id>`, additive) marks that device live
   and reports `credential_live` + `last_authenticated_at` to the cloud (§2.2); **a rotation emits
   one credential-change event** — observable machine-side, which is what makes it reliable — and
   the cloud **pauses fan-out for that computer's devices until each device's next authenticated
   relay request**. The machine's emit path checks the credential epoch as the second lock, so a
   single lost call cannot open the gap. **Rotation sets `expired_at`, never `revoked_at`**: it is
   not a decision about the device, the token is kept, and the device is welcome back the moment
   it authenticates — which clears `expired_at` and restores `credential_live`.
3. **Dead-token deletion is a DIFFERENT state (path 4), not a revoke.** APNs `410` / FCM
   `UNREGISTERED` is a *provider signal* about a token (uninstalled app, rotated token), not a
   decision by the user: the row is deleted, **no marker is written**, and re-registration is
   allowed and expected. The 60-day idle drop (§2.2) is this same state for the same reason.
   Conflating either with a revoke would refuse a legitimate reinstall; conflating a revoke with
   them would let a stolen device back in.

**How a device comes back.** By an explicit act, and *which* act depends on the marker —
`revoked_at` → `POST /api/push/devices/{id}/unrevoke` *(new — §3.1)* on the machine, or the same
action from the Radient account; `unpaired_at` → pair that computer again (the pairing flow clears
it for every device that was bound to it), or `unrevoke` that device explicitly; `expired_at` →
nothing to clear: authenticate to the relay with the current password and re-register. In every
case **the marker's clearing restores no token** — the app must register again, and registering
needs a live credential. Settings shows each row with its state and the action that clears it
("re-pair this device", "pair this computer again", "sign in again to resume") rather than hiding
a device the user cannot see or un-revoke.

**Notifications never stop silently (this pass's second half).** All three ways delivery stops —
a rotation, a lapsed cookie, the 60-day drop — are invisible from the app's side until it next
reaches the relay, which is exactly why the trigger is the relay's own `401`: on the next launch,
foreground or connect, the app learns the state from the failed call and says so in the state's
own words — "notifications are paused for this device until you sign in again" (expired), "this
device was revoked on <computer>" (revoked), "this computer is no longer paired" (unpaired) — and
for a dropped row, where re-registration is allowed, the honest sentence is the ops note's own:
"push may resume the next time this device opens the app". **No surface may report a device as
receiving pushes while any of these markers is set**, the mirror of the rule below about never
claiming notifications stopped everywhere while a revoke is pending.

**The residual, stated rather than implied.** The tombstone is indexed by `install_id`, and a
freshly installed app mints a **new** one — so what stops a re-installed stolen device is the
*credential* rule — **evaluated by the relay and enforced by the cloud** (rule 2) — not the
tombstone: to register at all it must authenticate to the machine with
the relay password (`/login`; the cookie key is derived from that password,
`docs/relay/contract.md`:48-52). **The honest remedy is revoke AND rotate**, which is why the
app's Settings copy says so — a revoke offers "also change this computer's password to cut it off
completely" — and why no surface may claim a revoked device is unreachable while it still holds a
live cookie.

**What a revoked device keeps**: whatever it already cached locally — projections and
transcripts (ADR 0002 §6) and its `lop_mobile` cookie until the TTL or a password rotation.
Revocation stops *delivery*; it does not erase the device. The app must never claim
"notifications stopped everywhere" while a revoke is pending — the same rule ADR 0002 §6 sets
for the tunnel session.

**When the cloud is unreachable, the machine does nothing dramatic.** The worker queues a
bounded number of undelivered events, retries each with the *same* idempotency key a bounded
number of times, then **drops** it with one log line; it never blocks a turn, never retries
forever, and never *needs* to succeed, because unread state is durable on the machine and the
badge is correct the moment the app can read it. A push is a nudge; the machine's own state is
the product. The connector's own reauthorization machinery already handles the
dead-login/refused/unreachable cases for the machine's control-plane access as a whole
(`docs/tunnels.md` "A dead Radient login"), and the worker rides on that rather than inventing
a second policy.

### 5. Platform constraints, and what each one forces

**APNs (quoted, read 2026-09-30)**

- HTTP/2 + token-based auth (a `.p8` key with its key id and team id); `apns-topic` = the
  bundle id ([Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)).
- **Alert pushes trigger interaction; background pushes do not.** The push-type table lists
  `alert` as "notifications that trigger a user interaction — for example, an alert, **badge**,
  or sound", while `background` "must not contain any keys that would trigger user
  interactions" and a background notification "doesn't display an alert, play a sound, or badge
  your app's icon" ([push types](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns#Know-when-to-use-push-types),
  [background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)).
  **Forces:** the completion push is an `alert` push; the attention push is a
  `content-available` background push, and its correction reaches the icon only through the
  app, which is exactly what §1.5 decided.
- **Silent wakes are best-effort and cannot be relied on**: background notifications are low
  priority, "the system may hold and delay" them, "if something force quits or kills the app,
  the system discards the held notification", and Apple advises "don't try to send more than
  two or three per hour" (same page). **Forces:** §3.3's killed-app row and §1.5's staleness
  window; both are statements about what the app can and cannot guarantee while backgrounded
  or killed, which review M5 asked for.
- **APNs stores only one notification per bundle id**, may reorder, and may coalesce
  (same page). **Forces:** per-conversation coalescing with `apns-collapse-id` (≤ 64 bytes) is
  the right behaviour, and a burst may legitimately arrive as a subset — harmless, because the
  badge is not carried (§1.5).
- Payload limit 4 KB; `apns-expiration` decides how long an undelivered push is retained. The
  payload above is ~300 bytes, so there is no reason to compress content into it.

**FCM HTTP v1 (quoted)**

- `notification.tag` replaces an existing notification ("Identifier used to replace existing
  notifications in the notification drawer"), `notification_count` sets a count, and
  `channel_id` **must name a channel the app has already created** or the message falls back to
  a default channel ([AndroidNotification](https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.androidnotification);
  [REST projects.messages](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)).
  **Forces:** the app creates its channels at first run and the cloud's payload differs per
  platform — a field FCM needs and APNs does not is transport, not leak.
- **Data-only messages are throttled in Doze and dropped after a force-stop** — Android's
  analogue of the iOS silent-push caveat.
- **Launcher badge support varies**: "Not all Android launchers support application badges. If
  the launcher does not support icon badges, the method will always resolve to 0"
  ([Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)). **Forces:**
  the Android icon badge is best-effort while the **in-app** count is always exact — which is
  why the in-app count is the contract and the icon is a courtesy.

**Capability and account work, per store**

- **iOS**: the APNs entitlement and the Push Notifications capability on the App ID and
  provisioning profile; an App Store Connect `.p8` key held by the cloud. The Expo config
  plugin sets the APNs entitlement to `development` and Xcode flips it to `production` in an
  archive ("The iOS APNs entitlement is always set to 'development'. Xcode automatically
  changes this to 'production' in the archive generated by a release build." — same page). A
  background wake additionally needs `UIBackgroundModes: remote-notification`, which the same
  plugin exposes as `enableBackgroundRemoteNotifications`
  ([configurable properties](https://docs.expo.dev/versions/latest/sdk/notifications/#configurable-properties)).
- **Android**: the `google-services.json` build input (from a CI secret — never committed), a
  service account for the v1 send API **held by the cloud and never by the app**, an
  application channel per notification class, and the `POST_NOTIFICATIONS` runtime permission.
- **Both**: an Expo config-plugin block, and a **development build** — "push notifications
  (remote notifications) functionality provided by `expo-notifications` is unavailable in Expo
  Go on Android from SDK 53", so the app's local iteration story changes with this feature
  (same page). ADR 0004's job graph gains a notifications-capable build profile.
- **F-Droid / FOSS channel**: ADR 0004's F-Droid row is **parked** and says F-Droid "requires
  FOSS-only dependencies and builds from source: React Native's Android build resolves Maven
  artefacts and ships prebuilt native libraries (Hermes/JSI), and **push notifications would
  pull in Google Play Services / Firebase**" (`docs/adr/0004-ci-cd.md`:178) and the FOSS rule
  itself is the first row of `docs/publishing/other-channels.md`:128 ("Google Play Services and
  Firebase … are strictly forbidden"). **Forces:** a `foss` product flavour that omits the
  notifications module and keeps the SSE + local-notification path, and a documented reason
  the row is parked until that flavour exists. (The previous draft attributed the "revisit when
  notifications land" phrasing to `other-channels.md`; it is ADR 0004's row, and it is cited
  there now — QA round 1 Q8a.)
- **The app's own Settings and permission flow is a new requirement, not an existing rule.**
  The previous draft implied the design kit already forbade a bare OS permission prompt; no
  such rule exists in `docs/design`, `docs/ux`, `docs/adr` or `AGENTS.md` (QA round 1 Q8b). It is
  a requirement this ADR sets: the permission is requested in context, with the §2.4 copy
  already on screen, reviewed by the designer in the app slice.

### 6. Navigation contract: the composer home, the cold-start override, and the deep link that must exist

The operator's navigation requirement is recorded here as a contract, not as a UI slice detail,
because a push tap's correctness depends on it.

1. **The default destination is a new-chat composer**, with conversations behind a sidebar.
   This comes from the operator, not from this ADR.
2. **A push cold-start deep link overrides the default destination.** Precedence, as an order
   because `app/`'s routing makes it a real question: *(a)* a notification response present at
   launch wins; *(b)* then an inbound `localoperator://s/<id>` link; *(c)* then the default
   (composer home). Nothing else may consume a cold-start destination first — in particular
   the auth/connection flow must **carry** it, not drop it.
3. **The response is consumed exactly once.** `expo-notifications` exposes the launch response
   through `getLastNotificationResponse()` / `useLastNotificationResponse()` and a foreground
   listener, and `clearLastNotificationResponse()` exists for exactly this ("May be used when
   an app selects a route based on the notification response, and it is undesirable to
   continue selecting the route after the response has already been handled",
   [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)). A
   re-render, a theme change or a re-auth must not re-navigate the user into the same
   conversation.
4. **The destination survives a not-yet-connected app**, and it has a failure path (review
   m5b): a cold start after a tap usually arrives before any session exists (a tunnel session
   may need minting, ADR 0002 §3). The pending destination is held in connection-adjacent
   state and consumed when the connection reaches `live`. If it never does — the computer is
   offline, the route was removed, sign-in fails — the app lands on the computer list after a
   bounded wait and says so in one sentence; it must not spin, and it must not silently drop
   the user on the composer as if nothing had happened.
5. **A tap for a computer the app is not on switches route — and that clears state.** A route
   switch aborts in-flight requests, closes streams and clears the projections, because they
   belong to a different computer (`docs/architecture.md` "Route switch"). The contract:
   switch first, **then** resolve the handle, and never resolve against the old computer's
   cache (review m5a).
6. **A conversation the device has never seen.** The push carries an opaque handle, so the app
   resolves it: if it is in the current aggregate (§1.1), open it; else
   `GET /api/push/conversation/{handle}` (§3.1); if the computer does not know it at all — the
   conversation was deleted, or the handle predates a key rotation — **land on the
   conversations sidebar with one honest sentence** ("That conversation isn't on \<computer\>
   any more.") and no error state. A cold tap never dead-ends and never fabricates an empty
   transcript screen for a conversation that does not exist.
7. **The deep link must exist as code — it does not today** (P6, review QA's "a proposal in
   disguise"). `localoperator://` resolves as a scheme

   (`app.config.ts:52-54`), but **there is no `s/<id>` route on `main` and none on #11 or
   #12**; the only session route is `session/[id]`, and `app/(app)/_layout.tsx:5` calls
   `localoperator://s/<id>` "a future deep link". So this ADR specifies both halves and names
   the slice that ships them (`docs/push-plan.md` S8):
   - a `+native-intent.tsx` at the app root rewriting `localoperator://s/<id>` to
     `/session/<id>` (the Expo Router hook for exactly this,
     [Customizing links](https://docs.expo.dev/router/advanced/native-intent/)), for links
     that carry a session id (shared links, QA fixtures);
   - and, because a push carries a **handle**, a resolver: handle → session id (§3.1) →
     `router.push`, with the route switch of item 5 applied first.
   Until S8 lands, the honest statement is: **the push tap deep link is unimplemented.**
8. **Notifying conversation ≠ current screen.** Tapping a push for conversation B while the
   app sits on A navigates to B, and the back affordance returns to the composer home. The
   sidebar's unread marks are the machine's, so B's row clears when the ack lands — not on
   navigation.

**Out of scope, explicitly:** the composer's data path (sending, queuing, steering) is
untouched by this ADR, and in particular **the STT composer readout is not part of this
work**. STT is being built against the real provider cascade (tunnel-aware, bring-your-own
providers) in a parallel workstream; this ADR neither designs it nor blocks on it, and the
navigation change in item 1 must not be used as a vehicle for it.

### 7. Cost, effort, and the critical path

Sizes in the scale this repository uses elsewhere (S ≈ a day or two of focused work, M ≈ a
week, L ≈ more, with an unknown tail):

| Slice group | Owner | Size | Why |
|---|---|---|---|
| **Aggregate read, population, list field** (§1.1-§1.2, plan S1) | daemon-core | **S** | one pass over identities the listing already has, one route, one field. ~150 lines plus the two equality tests |
| **Conversation handle + listing field + resolve route** (§4, S2) | daemon-core | **S** | an HMAC mint, one field on the aggregate, one resolve route |
| **Interface freeze** (§3, S3) | all three | **S** | the §3 shapes, refusal shapes, fixtures in this repo's `fixtures/` (ADR 0003's pattern) |
| **Device registry, register/list/deregister routes, no token stored** (§3.1, S4) | daemon-core | **S–M** | durable record, cloud id, Settings list, the generic deregister |
| **Device lifecycle: live / expired (`expired_at`) / unpaired (`unpaired_at`) / revoked (`revoked_at`) / absent (no row), the shared precedence revoked > unpaired > expired, the register route's two refusals, the emit-side epoch check, un-revoke** (§3.1, §4, S4a) | daemon-core | **S–M** | the states are one table in code, not five booleans read ad hoc, and the register route, `list` and the emit path resolve the **same** precedence (asserted); `403 device_revoked` on a tombstone and `403 device_unpaired` on an unpaired row, while `expired_at` re-registers; a dead token or the 60-day drop deletes the row with **no** marker and re-registers cleanly; `unrevoke` clears the tombstone and leaves the token absent |
| **Credential-live evaluation and the credential-change event** (the relay evaluates, the cloud enforces, `X-Lop-Device` on authenticated requests, one event per rotation, fan-out paused until each device's next authenticated request) (§3.1, §4 rule 2, S4c) | daemon-core + Radient-cloud | **S–M** | after a rotation **no** device of that computer is delivered to (observed at the provider stub) while the machine also refuses to emit for it — and each resumes on its own next authenticated request, not on the rotation's; a device that never authenticates again stays paused, which is the point |
| **Push worker: two cursors + baseline, acknowledgement-map diff, gates, presence deferral, catch-up, bounded queue that advances only on the cloud's `202`** (§2.1-§2.3, S5) | daemon-core | **M** | the store is done; the risk is the gates and the cursor, not the volume |
| **Attention emit: structural detection (`revision()` equality as the trigger, then the acknowledgement map and the supersede cursor say which conversation moved), `/seen` nudge that consumes the change, `exclude` on the wire** (§3.1, S6) | daemon-core | **S** | reuses the loop that already reads `revision()` |
| **App: notifications module, permissions, channels, badge management, handle resolution, `+native-intent` + route, unpair UI, Settings copy, FOSS gating** (§5-§6, S8/S9/S11) | app | **M–L** | a new native module, a new lifecycle path, a new route, a new settings surface, and a build-flavour story: the largest single diff |
| **Cloud: registration forward, ingest with idempotency, fan-out, delivery record, routing, revocation, unpair removal** (§2.2, §3.1, §4) | Radient-cloud | **L, and outside our control** | two credentials' worth of setup, a new always-on service, token lifecycle, retry/coalescing, an operational surface |

**The critical path is the cloud-side fan-out**, and it is the only piece we cannot build.
The **interface freeze (S3) depends only on S1 and S2** — a correction review M11 asked for:
the previous draft sequenced the freeze behind the worker, which would have put the cloud
team behind the daemon's M-sized slice for no reason. The core worker and the app can then be
built in parallel against frozen shapes and a stub control plane.

**One correction to the expectation that "the unread model in core" is the hard half:** the
store already implements the model; the aggregate over it is S. The genuinely hard halves are
(i) the **cloud**, new, always-on and not ours, and (ii) the **eligibility and cursor work in
the worker** (§2.1, §2.3) — a design trap rather than a volume of work, and the one thing in
this ADR I would want a second reviewer to attack.

**On the blocked operator items.** Two are already recorded: Radient-side **account deletion**
(checklist A8, a store-submission blocker, `docs/publishing/checklist.md`:33) and the
**organisation developer accounts** (A2–A4: D-U-N-S, Apple Developer Program as the
organisation, Play organisation account). **Push adds three more of the same kind:**

- an **APNs key** and an **FCM service account** held by Radient — a new credential
  dependency whose loss breaks a user-visible feature rather than a submission;
- **and a console-side device list**, so a user whose phone is stolen can revoke it without the
  machine (§4 path 2). Same class as A8: a Radient console feature this app cannot ship.
- **and, unlike A8, the fan-out service is a runtime dependency**: it must be up, it costs
  money, it holds device tokens and a delivery log, and it needs an owner, a deploy story and
  an on-call story. That is a commitment about Radient the platform, not a feature of this app,
  and it belongs in the same conversation as A8 rather than beside it.

### 8. Sequencing

Full slice table, owners and exit criteria are in [`docs/push-plan.md`](../push-plan.md). The
order this ADR *decides*, and the reason:

1. **The aggregate read and the population rule (S1).** Nothing else can be specified against
   a shape that does not exist, and it is independently useful — the app's in-app count and the
   §1.4 badge work with no push at all. **Ships alone, benefits users immediately, needs no
   cloud.**
2. **The handle (S2) and the interface freeze (S3)**, in parallel with the device registry
   (S4). The freeze depends on S1 and S2 only.
3. **The push worker (S5) and the attention emit (S6)** behind a feature flag, tested against
   a **stub** control plane, so the whole path is exercisable with no Radient dependency.
4. **The cloud (S7)** against the frozen shapes — blocked on the operator items in §7.
5. **The app (S8-S11)**: module, badge, deep link, Settings, FOSS flavour, and the store inputs
   (entitlements, CI secrets) — the last mile, and the part with the longest external latency.

### 9. Risks to watch during rollout, and what would change this decision

| Risk | Why it is real | The signal to watch |
|---|---|---|
| **The seen-vs-claimed confusion** (the single most likely regression) | this ADR adds a second, independent notification channel next to the claim ladder; a future change that reads `deliveries` as "the phone was told" would silently break the banner arbitration | `claim_delivery` and `deliveries` are untouched by every slice; a test that the push path never writes them |
| **The presence gate silencing a phone for good** | a focused window left behind is the failure mode that killed the claim rung (M3) | the deferral window is bounded and asserted; a test that a suppressed push is emitted after the TTL while `unseen` holds |
| **Badge drift from the in-app count** | two implementation sites are the classic way this happens | the §1.2 equality test, on the same snapshot, is a gate not a nicety |
| **A store-wide population creeping back in** | it is the natural way to write the read, and it is wrong by a factor of ~35 on the operator's own machine (6,392 vs the listing) | the population is one function with the listing's identity set as its input; a test with `agent/` identities and no directories present |
| **Reordered/duplicated pushes** | APNs may reorder and coalesce; Android may drop in Doze | the badge is never carried (§1.5) — the class is removed, not defended |
| **A heal swallowed by idempotency** | same token, new content, and a naive key drops the correction | **two** things: the emit key carries the record's content (§3.4), **and** a heal is read on the supersede cursor (`superseded_since`) rather than on the publication cursor (§2.1), so the key is actually minted. A test that a heal produces a distinct key *and* that it is emitted |
| **Privacy regression by drift** (someone adds a field) | the payload table is the allow-list, and the tempting additions are the leaky ones (a name, a snippet, a counter) | the cloud contract rejects unknown fields (`extra="forbid"`, the house pattern in `docs/design/descriptive-notifications.md`); a test asserting the builder never reads `body_is_snippet`/`body_is_failure` inputs |
| **Revocation that does not revoke** | a stolen phone that keeps buzzing is the worst user-visible failure here | all five paths in §4 exercised **against the five states, the shared precedence and the three rules**: a register refused on `revoked_at` and on `unpaired_at` with both codes, an `expired_at` row allowed to re-register, a provider dead-token and a 60-day drop deleting their rows with **no** marker, a rotation that pauses delivery on both sides **without** setting `revoked_at` (S4c, asserted in both directions), and the account-side path exercised with the machine offline |
| **Acknowledge-by-accident** (a new automatic path clearing marks) | the rule is one sentence in §1.3 and easy to violate | a delivered push, a wake and a foreground change all leave `unseen` untouched; `claim_delivery` never advances the read watermark (`attention.py:2391-2393`) |
| **Cloud outage** | a machine whose pushes fail must not stall or retry forever | bounded queue, same-key retries, drop with one log line; the machine's state is unaffected |
| **The licence/FOSS promise** | shipping Firebase linkage into the default flavour is a real constraint, not a formality | the `foss` flavour is a slice with its own build, and CI proves the default flavour is the only one with the module |

**What would change this decision:**

- **Merging unread state across computers** (§1.6) — needs an explicit operator decision to
  upload read state; a new ADR, not a patch.
- **An account-wide `aps.badge`** — the only way an unused app's icon can be fresh (§1.5);
  requires uploading counts and letting a server own a machine-owned number.
- **Counting pending gates toward the icon badge** (§1.4) — one predicate, and it would restore
  P-3's old meaning.
- **A BYO push gateway for the fully self-hosted user** (§2.4) — a product of its own; the
  honest answer today is "no push on that machine", and this ADR is amended rather than
  stretched if that changes.
- **Radient declining the fan-out service** — then push does not ship on any machine, and
  §2.4's degradation becomes the whole product. That is a legitimate outcome, and it is why
  S1-S2 and the worker's stub path are designed to be useful without it.
- **A per-surface `push_delivered` watermark** (§2.1) — re-openable if the cursor + cloud
  delivery record prove insufficient in practice; the reasons it was not chosen are recorded
  there rather than left for the next reader to rediscover.

**Citation corrections made across both remediation rounds, listed so the next reader can see
what moved.** Round 1's were found by **QA round 1 Q7/Q8** (the review round running beside it
found no drift of its own — "~20 citations spot-checked, all resolve" — and attributing them to
it was round 2's Q12): `daemon.py:3689-3691` → **`:3694-3695`** (the SSE wake; `:3689-3691` is
the 409 body); the superseded 409 → **`:3676-3690`**; `compose.py:84-105` →
**`:93-113`** (the `body_is_snippet`/`body_is_failure` fields); "a delivered banner does not
mark anything read" → **`attention.py:2391-2393`**; the TUI's change detection →
**`app.py:27291-27348`** (it reads `revision()`; `acknowledgement_map()` is the *desktop
feed's* delta read, `desktop_feed.py:931,1188`); the TUI viewer record is
**`session/runtime/viewers.py`**, not `desktop_presence.py`; and the "revisit when
notifications land" sentence is **ADR 0004:178**, not `other-channels.md` (QA round 1 Q8a).

Round 2's corrections, from the review and QA rounds on `22e2cce`: the pin is labelled **a
pinned SHA ("`40ca7910e49a`"), not `origin/main`** (QA round 2 Q11 — **16 commits behind** as
measured 2026-09-30, `origin/main` = `d5346e173`, and `app.py`/`session_sidebar.py` line numbers
shift under it); the citation table now maps
`models/desktop_sessions.py`, `routes/desktop_sessions.py`, `utils/desktop_sessions.py`,
`session.py` and `web/src/store.ts`, which were cited without a rule (Q13 / review m2);
`attention.py:2129-2150` → **`:2129-2149`**, the method's real end (review n1); #11's
`session-projection.ts:61-66` → **`:56-70`**, the function plus its rationale (review n2); and the
`scaffold`'s own provenance sentence now attributes the drift to **QA round 1 Q7/Q8**, where it
belongs (QA round 2 Q12).

---

## Consequences

### Positive

- **The hard half is already built.** Cross-surface acknowledgement, once-only arbitration,
  token-bound idempotent receipts, a durable store that survives restarts and upgrades, and a
  three-term change detector that survives in-place heals: all of it exists and is shared by
  three surfaces today. This ADR adds one read, one handle, one registry and one worker — no
  new semantics in the store.
- **The badge becomes a number nobody can disagree about**, with an equality test rather than
  a claim, and with a population that is the app's own list.
- **The cloud is a dumb pipe with a memory.** It holds no authority, no content and no read
  state, and its learned surface is stated honestly rather than denied.
- **The design survives its worst platform behaviour**: a force-quit app, a throttled wake, a
  reordered push, a coalesced burst and an offline machine all leave the *user-visible truth*
  correct as soon as the app can read the machine.

### Negative, accepted

- **No push on a machine with no Radient login** (§2.4), stated plainly in the ADR and in
  Settings.
- **No cross-machine unread merge** (§1.6).
- **The icon badge is only as fresh as the app's last connection** (§1.5). The banner carries
  the fresh number; the icon does not.
- **The badge changes meaning** (Context §3): a parked approval raises no icon badge, and four
  existing documents and one open PR must move with it.
- **No conversation name in a notification** (P2) — the banner is generic until the app opens.
- **A new always-on Radient service**, a new console surface (device revocation) and two new
  cloud credentials (§7).
- **A new product flavour**: the FOSS build compiles push out (§5).
- **Two Settings rows are not shipped in v1** (quiet hours, decision notifications) and the
  copy must say so (§2.4).

### Neutral

- Nothing in `attention.db` changes shape. The additive `notify` column already set the
  precedent (`attention.py:1538-1539`), and the worker's cursor is a file of its own rather
  than a column.
- Nothing in this ADR changes ADR 0005's in-app ask badge, its queue authority, or its
  absence-based capability rule.
- The legacy `mobile-seen.json` store (`mobile/seen.py`) is untouched: it is a one-shot import
  reader today (`attention.py:1206-1210`) and this ADR neither revives nor removes it.
