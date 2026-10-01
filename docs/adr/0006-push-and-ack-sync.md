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

**Ref markers, and what the checkers actually check** (round 8 Q-F26/Q-F27 — the claim must not be
wider than the run). Every citation is resolved at the ref it names: **`(#1864)`** = PR #1864's head
above, **`(pin)`** = the pinned commit above. A citation into a file that exists at **both** refs
(`daemon.py`, `cli.py`) must carry one of the two — the two trees put different code on the same line
numbers, so an unmarked one is a **failure, not a default**; `push_devices.py` needs no marker
because it exists only in #1864. A **bare continuation** (`:3382-3388`) inherits the file *and the
ref* of the citation it follows, which is how the prose reads. The three scripts in
[`docs/adr/0006-verification/`](0006-verification/) are this paragraph's checkable form; each exits 2
rather than pretending when `$LOCAL_OPERATOR_REPO` is unusable, and
[their README](0006-verification/README.md) states exactly what each proves **and does not**.
**What they do not check, so no reader has to guess the denominator:** `.md`/`.ts`/`.tsx` citations
(they resolve at the mobile repository's pin), a file named with no line, a line number written as
prose, and — the one no script can close — whether a cited line **supports** the claim beside it.

**Provenance of code citations.** Every `file:line` below is stated at a named revision and
was resolved with `git show <ref>:<path>` — never read from a working tree, because the
shared checkouts carry other sessions' staged work. **Every citation here has been re-resolved
at the pin — lines *and* paths — and the one that was wrong is named rather than counted fixed.**
**The method, so anyone can re-derive it without quoting a number:** for every mapping the table
declares, resolve the **path first** (`git cat-file -e <pin>:<path>`), then check the cited line
(or range) against that file's length; the counting rule is **distinct `(path, line-range)` pairs**,
which is why two people counting by table row get different totals, and why this document quotes
the property — *every mapped path exists at the pin and every cited line resolves* — rather than a
census (round 5 Nit-N1). **What that check cannot prove, stated because it was wrong once:**
resolution is not *support*. `attention.py:1611` resolved for a long time while the kind vocabulary
it was cited for lives at `:2047` (QA round 5 Q-F6); that class is caught only by reading the line,
which is why the facts sampled in round 5 are named in the PR thread's remediation comment rather
than asserted here.
QA round 1's **Q7** reported line drift and **Q8** three unsourced assertions (the review round
running beside it found none of its own: "~20 citations spot-checked, all resolve"); rounds 1 and
3 re-resolved the **line numbers** at the same pin. **QA round 4's Q-F1 then found what those
passes could not**: the table mapped `resume.py` to `local_operator/session/resume.py`, a path
that **does not exist at the pin** — the *lines* were right (`local_operator/resume.py`:169,
:1715) and the *path* was never exercised, so "re-resolved" was true of the lines and false of
the path. It is fixed in this pass. **Corrections live in two places, by kind: this document's §9 citation
list** — the reader's record of what moved, kept current through round 6 — **and the PR's
remediation comments**, the reviewer's record of who found it. (The round-5 draft said corrections
were *not* in §9 while §9 listed them; round 6 caught that contradiction, and this is the sentence
that had to become true.)

| Repository | Revision | How paths are cited |
|---|---|---|
| **local-operator** | `40ca7910e49a` — **a pinned SHA, and *not* `origin/main`**: it *was* `origin/main` when this document was written and is **16 commits behind** it as measured on **2026-09-30** (`origin/main` = `d5346e173`; it was twelve behind when review round 2 read it, at `061ede7` — the distance moves with the branch, so it is always dated). **Every line number below is stated at `40ca7910e49a`**; re-derive at that ref and expect an offset at a newer one: `app.py`'s `_cmd_notifications` is app.py 40600 on current main against 40562 here   <!-- not citations: line drift, described in prose -->, and `session_sidebar.py`'s "45%" line `:800` against `:704` | `local_operator/mobile/daemon.py` → `daemon.py`; `local_operator/session/attention.py` → `attention.py`; `local_operator/session/runtime/presence.py` → `presence.py`; `local_operator/session/runtime/viewers.py` → `viewers.py`; `local_operator/server/utils/desktop_feed.py` → `desktop_feed.py`; `local_operator/server/utils/desktop_presence.py` → `desktop_presence.py`; `local_operator/notifications/compose.py` → `compose.py`; `local_operator/tui/app.py` → `app.py`; `local_operator/tui/notify.py` → `notify.py`; `local_operator/tui/widgets/session_sidebar.py` → `session_sidebar.py`; `local_operator/operator/devices.py` → `devices.py`; `local_operator/tunnels/api.py` → `tunnels/api.py`; `local_operator/tunnels/service.py` → `tunnels/service.py`, `local_operator/tunnels/gateway.py` → `gateway.py`, `local_operator/cli.py` → `cli.py`, `local_operator/session/runtime/registry.py` → `registry.py`, `local_operator/mobile/attach_client.py` → `attach_client.py`, `local_operator/mobile/tui_handle.py` → `tui_handle.py`, `local_operator/mcp/grants.py` → `mcp/grants.py`, `local_operator/mobile/auth.py` → `mobile/auth.py`, `local_operator/mobile/peer_client.py` → `mobile/peer_client.py`, `local_operator/session/runtime/server.py` → `session/runtime/server.py`, `local_operator/info/render.py` → `info/render.py`, `local_operator/network/dial.py` → `network/dial.py`, `local_operator/operator/devices.py` → `operator/devices.py`; `local_operator/session/session.py` → `session.py`; `local_operator/resume.py` → `resume.py`; `local_operator/server/models/desktop_sessions.py` → `models/desktop_sessions.py`; `local_operator/server/routes/desktop_sessions.py` → `routes/desktop_sessions.py`; `local_operator/server/utils/desktop_sessions.py` → `utils/desktop_sessions.py`; `local_operator/mobile/web/src/store.ts` → `web/src/store.ts`; `local_operator/mobile/install.py` → `mobile/install.py`; `docs/*.md` by full path |
| **damianvtran/local-operator PR #1864** | `d089f7e0fc0a324c38d6499290c27b2569714549` — **a PR head, not `main` and not a tag**, which is a different kind of pin from the mobile repository's: it can move, and a reader must re-read it rather than assume. Head at the time of writing; **open, not merged** — the implementation this ADR adopts for the device lifecycle and the operators-only un-revoke route. Its citations carry the marker **`(#1864)`** after the range (`daemon.py`:4730-4770 (#1864)), and `push_devices.py` is cited without one because the file exists only there. Read with `gh pr diff 1864 --repo damianvtran/local-operator` | same rule: `git show d089f7e0f:<path>`, never a working tree |
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
(`daemon.py:1051` (pin); `_is_unseen` at `:1099`).

**Pending gates are a fourth, separate thing.** A parked `ask`/`approval` has its own
lifecycle and is *never* answered or removed by a completion receipt (`docs/ATTENTION.md`
§"Identity and durability"); the phone sees it as `needs_attention` + `pending_kind`
(`daemon.py:991-992` (pin)), and the desktop machine-wide feed deliberately does not carry gates at
all (`BRIDGE_NOTIFIABLE_KINDS = {"complete", "error", "retired"}`,
`utils/desktop_sessions.py:368`). §1.4 keeps that boundary, and §2.4's Settings
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
- the **mobile daemon** acks with `POST /api/sessions/{id}/seen` (`daemon.py:3642-3696` (pin),
  route registered at `:4701`) and then invalidates its summaries cache and wakes the list
  SSE (`:3694-3695`), and every 2 s (`SCAN_INTERVAL_S = 2.0`, `daemon.py:92` (pin)) re-reads the
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
build does not have it" (`daemon.py:3528-3530` (pin), `docs/relay/contract.md`:203-204):

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
(`daemon.py:1194-1207` (pin)), which additionally requires a `transcript.jsonl` and a well-formed
name and would put a durable-but-detail-less row in one set and not the other. Everything below
is that one set, in the listing's snapshot:

- the listing's rows (`recent_session_rows(directory, 100, strict=True)`, `daemon.py:665` (pin), plus
  live entries) — the same identity set the attention decoration is already built for
  (`daemon.py:778-782` (pin)), so this is one pass over data already in hand, not a second scan;
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
| **Mobile app** | `POST /api/sessions/{id}/seen` with `{completion_token}` (`daemon.py:3642-3696` (pin)) | the list SSE (`/api/sessions/events`, woken by the daemon on its own ack, `:3694-3695`) while foregrounded, and **push** while backgrounded (new, §2) |

**The rule the three surfaces share, stated once:** *an acknowledgement is
`(conversation, completion_token)`, it is idempotent, it is refused when the token is not the
conversation's current completion (`superseded_completion_token`, `attention.py:185`;
`daemon.py:3676-3690` (pin)), and **no automatic path may acknowledge anything** — only a gesture,
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
  (`daemon.py:739` (pin), `docs/relay/contract.md`:196-200). A store that could not be read is not
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
  same daemon, and every ack wakes the list SSE (`daemon.py:3694-3695` (pin)). A device that is not
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
  │  every 2 s (SCAN_INTERVAL_S, daemon.py:92 (pin)) — the loop that already       │
  │  reads AttentionStore.revision() (daemon.py:2499-2535 (pin)):                  │
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
| **Device** | `device_id`, `platform`, the push token, `environment` (`sandbox`/`production` — only the app knows which build it is), app build, `created_at`, `last_seen_at`, and the state markers **`revoked_at` / `unpaired_at` / `expired_at`** — **not** `credential_live`, which lives in the Credential row below (`n3`, so one fact has one home) | token rotation and revocation are the whole of device management; **the markers are the states §4 defines, and §4's precedence (revoked > unpaired > expired) is what every reader of the row — the register route, `list`, the delivery gate — resolves, so one row cannot be read two ways** |
| **Account → devices** | account id → the account's registered device ids (what may *receive* is decided by the state marker, §4) | routing; the account already exists (`GET /v1/me`, `tunnels/api.py`:144-170) |
| **Computer → devices** | the connector's tunnel identity → the devices registered for *that* machine | a user with three machines must not be pushed about machine C's work while paired to A |
| **Delivery** | `(device_id, conversation_handle, emit_id)` → sent/attempted, provider id, response code, **kept 14 days** | the record of what was pushed: it is what makes re-delivery idempotent, a revocation testable and the cloud's own alerts meaningful. **It is not returned to the machine** (§3.1) |
| **Credential (per device)** — **the machine's own record** | `credential_live`, `last_authenticated_at`, **`credential_expires_at`** *(new — the **expiry the phone's cookie itself presented**, recorded at register time and refreshed on any authenticated request that names its device; `sign_cookie` puts the expiry in the cookie's value, `mobile/auth.py`:465-469`, so no clock arithmetic and no login-route writer is needed — §4 rule 2 / Q-F15 / R8-m1)*, and the **per-device key** (`device_key`): **minted by the machine at every registration and stored as the key ITSELF in the machine's 0600 record** (`push_devices.py`:194 field, `:510` written, `:946` the atomic 0600 write — core's shape, PR #1864, **the key itself, not a hash** — a hash could not be returned per call, and the per-call return is what makes registration the key's delivery path; **divergence for core, listed in the plan**: a hash would require a one-time return plus a re-register refusal, and #1864 does not do that), and held by the phone in the keystore keyed by its `install_id`. **The store's custody is the same rule the discovery records use — 0600 under 0700 (`registry.py`:5)** | the second limb of §4 rule 2, and the only place the flag lives. **The machine owns it**: the relay's routes write it as they see the cookie and the emit worker (the same process) reads it, so there is no second copy to disagree with and **no epoch to compare** (round 4 `m1`, QA Q-F3). **The key never goes to the cloud** — round 5 M3 caught the earlier sentence "never leaves the machine", which was wrong: the *phone* presents it, as `X-Lop-Device-Key` (§3.1). **A rotation happens on registration**: every `register` re-mints the key and returns it in that response (§3.1), so the owner's lever is a fresh registration (a reinstall, or the device's next authenticated register) and the account console's revoke of the account's access — **not** the device's own initiative; an offline device resumes only by re-registering with its current relay credential, and a device the machine has marked is refused at registration before any key is minted. What the cloud holds is the **coalesced** copy of the two flag values, never per-request traffic (`m5`) |
| **Credentials** | the APNs `.p8` key id + team id; the FCM service account | the reason the cloud has to exist at all |
| **Grant (per device)** *(cloud, proposal)* | `grant_id`, `device_id`, the computer it belongs to, `minted_at`, `last_refused_at` — the **shape is the cloud lane's** ([`docs/push-cloud-ops.md`](push-cloud-ops.md)); this ADR fixes only the two properties rule 2 depends on | **the enforceable half of §4 rule 2 on the Radient route** (round 5 Q-F8): it is *minted* at registration against an `install_id` the machine's record carries, *required* for delivery (fan-out refuses without it), and *refused* for a row whose marker forbids it. The one property that cannot be verified from this repository — a mint refused while the account has revoked that computer's access — is stated as a **cloud-side requirement** in §4 rule 2 and in §7, not assumed here. **Its life — storage, refresh, rotation** (round 6 QA Q-F8, which caught that a record with no life cannot be implemented): it **lives in the cloud's own store** beside the device row *(proposal)*; it is **refreshed** from the machine's next `credential_live` report rather than from a clock, so the cloud re-arms it from evidence; it is **rotated** — invalidated and re-minted at the next registration — when an **owner** revokes it, or when the device re-registers (which re-mints the key, §3.1); and a **mint is refused outright** while the account's access for that computer is revoked. "The machine never refreshes a grant" in rule 2 means *the machine*, not the cloud |
**What the cloud must NOT hold:** transcripts, conversation names, session ids, working
directories, model names, prompt text, **read state or read history**, and **no unread
count** (§1.5). §4 says what it does learn, honestly, including the residue.

**Two retention rules this ADR adopts, and one honest gap** (designed in the cloud ops note,
[`docs/push-cloud-ops.md`](../push-cloud-ops.md), PR #15 — the note stays the operational
runbook; the rules are the ADR's, and the note's text is being aligned to them): delivery records
are kept **14 days**, and a device with **no authenticated request for 60 days has its row
dropped entirely — no marker.** It is **deliberately not a tombstone**: a tombstone refuses
re-registration, and this drop is explicitly "rather than a ban", so the app re-registers on the
next launch (§9 lists the correction). So it is §4's **absent** state: the app re-registers on
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
4. the account has at least one **registered device whose credential is live** — i.e. no
   `revoked_at` and no `unpaired_at`, and **not** `expired_at` (§4's states, not the pre-state
   word "live device"): this is the gate the emit-side skip belongs to, and **the worker skips
   such a device entirely** — no emit is attempted for it, while the event still goes to every
   other live device of that computer.

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
JSON, and **the auth model is per route** (round 5 m8; §4 rule 2): on the **direct** route every
relay route is auth-gated by the `lop_mobile` cookie the app holds, whose key is the relay
password (ADR 0002 §6, `docs/relay/contract.md`:48-52); on the **Radient** route the edge strips
that cookie and the local gateway injects a per-request one (`docs/relay/tunnel-edge.md`:59-76,
`gateway.py`:545-548), so there the cookie proves *the computer* and not the device —
which is exactly why rule 2's device limb is a key, and why the grant exists at all.

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
→ {"ok": true, "device_id": "…", "device_key": "<opaque, minted per registration>", "registered_at": 1759…}

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
// compute, because the cookie is the relay's to see. The relay RECOMPUTES it on every
// authenticated request that names its device (`X-Lop-Device: <install_id>`, attribution only)
// and **SENDS it COALESCED**: change-triggered, piggybacked on the next register or emit for this
// computer, at most once per device per 5 minutes, one credential-change event per rotation
// (round 5 Q-F7). The flag is `credential_live` +
// `last_authenticated_at`, held by the RELAY — the only component that sees the cookie — and read
// by the emit worker in the same process; there is no separate "credential epoch" (§4 rule 2,
// round 4 m1 / QA Q-F3).
//
// THE KEY A REQUEST PRESENTS, AND HOW A ROTATED ONE REACHES THE DEVICE (round 5 M3 / Q-F10;
// round 6 m1 / round 7 R7-m2). **The key is minted and returned by EVERY register call** — core's
// implementation, adopted here verbatim: `record["device_key"] = device_key` and the response
// carrying it (`push_devices.py`:510, `:522-527`, PR #1864). So:
//   · first registration          → {"ok": true, "device_id", "device_key", "registered_at"}
//   · ANY later registration      → the same shape, with a NEW key: a re-register re-mints it, so
//     the delivery path for a rotated key is **the device's next authenticated register** (the
//     phone stores what the response carries, keyed by `install_id` in the keystore). There is no
//     separate rotate delivery and no `409`: a one-time return plus a `409 device_key_required` for
//     a re-register would be the shape **if** the machine stored only a hash — it stores the key
//     itself in its own 0600 store (`push_devices.py`:194 field, `:946`), which is what makes the
//     per-call return possible. §2.2 records the trade and the divergence for core.
//   · a device whose row is revoked or unpaired never gets here at all: registration is refused
//     `403 device_revoked` / `403 device_unpaired` first (the two codes above), which is what makes
//     those markers stick against the device's own next launch.
// `GET /api/push/devices` never carries the key (`push_devices.py`:543-546), exactly as it does not
// carry the token. The phone presents it as `X-Lop-Device-Key: <device_key>` (a header, never a
// query parameter); `X-Lop-Device` names the `install_id` and the relay resolves it to the
// `device_id` the key belongs to (round 5 Nit-N2), compared constant-time (`device_key_matches`,
// `push_devices.py`:359-375). A valid key for a tombstoned device is still refused by the state
// rules above: **the key proves IDENTITY, never PERMISSION** — and, honestly, it proves only
// possession of a registration path a live credential can re-run, which is exactly why the state
// marker (not this key) is what stops a revoked device, and why `unrevoke` does not rest on it.
//
// The two state refusal codes above, `X-Lop-Device: <install_id>` and `X-Lop-Device-Key:
// <device_key>` — a request that moves a device's state presents the key, so a device can move only
// its own — are DECIDED relay shapes, not proposals: S3 freezes them and rule 2's enforcement rests
// on them (round 4 m3, round 6 m1).
// A rotation sets `expired_at`, NOT `revoked_at` — see §4: the two states are deliberately
// different.
```

**List this computer's devices** *(new)* — what the phone's Settings renders:

```jsonc
GET /api/push/devices → {"devices": [{"device_id":"…","platform":"ios","app_version":"1.0.0 (12)",
                                       "registered_at":…,"last_seen_at":…,
                                       "state":"live|expired|unpaired|revoked",
                                       "name":"…",                    // only when a registration gave one
                                       "credential_live":true,        // only once the machine holds it
                                       "last_authenticated_at":…}],   // same rule
                        "precedence":"revoked > unpaired > expired"}    // §4's one vocabulary
// Every always-present key is one the RECORD holds, and the three optional ones are present only when
// it carries them — absence is the truth rather than a null (`push_devices.py`:553-571 (#1864)):
//   · "name"                    — only when a registration supplied one (`:564-565`)
//   · "credential_live"         — only once the machine holds a credential fact (`:566-567`)
//   · "last_authenticated_at"   — same rule, same reason (`:568-569`)
// **`environment` is deliberately NOT here** (R8-m2): the record carries it for the cloud's routing,
// the phone renders it nowhere, and the wire is a contract, not the store's dump
// (`push_devices.py`:534-546 (#1864)). `install_id` and `device_key` are absent for the same reason.
```

**Revoke / deregister** *(new)*. This is the **revoke** path of §4: it drops the cloud's token
and **tombstones the row** (`revoked_at`), so the device cannot silently re-register itself.
`device_id` may be the caller's own or **another device in this computer's registry** (the
stolen-phone case, §4). **Self-targeting is deliberate on this route and only on this route**: a
device that revokes itself can only reduce its own access, which is safe for anyone holding a
cookie to do:

```jsonc
DELETE /api/push/devices/{device_id}   → {"ok": true}          // revoke: token dropped, row tombstoned

// THE WAY BACK IS AN OPERATOR-ONLY ROUTE, AND A MACHINE-MINTED KEY IS THE PREDICATE (round 7 —
// the design is core's, adopted from damianvtran/local-operator PR #1864 at head `d089f7e0f`,
// which implements it; not merged at the time of writing). The refusal is `403 machine_only` and it
// means exactly one thing: **the request did not present this machine's operator key.** It is NOT a
// locality test, and it must not be described as one — the relay authenticates `/api/` with ONE cookie
// check (`authed` → `verify_cookie`, `daemon.py`:3377-3380 (pin)) inside `gate()` (`:3401-3411`, which also
// refuses a cross-origin mutation), so a phone and the CLI look identical to it: an origin guard is
// not an identity either. (Nit from QA round 7: "the whole of `/api/` auth" overstated `:3377-3380`.)
POST /api/push/devices/{device_id}/unrevoke → {"ok": true, "device_id": "…"}
   // 403 {"code": "machine_only",
   //      "error": "a device cannot restore itself — use the computer or your account"}
   //      when the header is absent or wrong (`daemon.py`:4764-4770 (#1864));
   // 404 {"code": "device_absent"} for an id with no row; 500 when the store cannot be read — a
   // fault, never rendered as the device's own failure (`daemon.py`:4757-4761 (#1864)).
```

**The operator key** *(adopted from core PR #1864; the file and line numbers below are that head)*:

- **Minted by the daemon on this machine, inside a write it was already making**: the first
  `POST /api/push/register` mints it under the store lock (`push_devices.py`:518-519,
  `secrets.token_urlsafe(32)`), so the normal path never has two writers of the store.
- **Stored beside the records in the machine's own 0600 store** (`push_devices.py`:194 the field,
  `:946` the atomic 0600 write), read only — `operator_key()` (`:378`) never mints, because a
  verifier that minted would hand the first caller the key it just failed to present — and compared
  constant-time by `verify_operator_key()` (`:407-423`).
- **The route sits behind the usual cookie gate AND the key** — `POST
  /api/push/devices/{device_id}/unrevoke` is registered beside its siblings (`daemon.py`:4909-4910
  (#1864)) and calls the API's own `gate()` first, so the operator key is a **second** requirement
  after the `lop_mobile` cookie (which the CLI also presents). Success is `200 {"ok": true,
  "device_id": "…"}` (`push_devices.py`:611-645 (#1864)); it **deletes every marker the row carries** —
  both `revoked_at` and `unpaired_at` if it has both (`:638-644` (#1864): `for marker in
  ("revoked_at", "unpaired_at")`), which is the one-marker case in practice because §4's precedence
  stops a row from reaching here with two — and **restores no token and no credential**: they are
  left as the last authenticated request wrote them (`:620-626` (#1864)), so the device must register
  again. A row with no marker is a **no-op that still answers `ok`** (`:624-626`).
- **Presented as the header `X-Lop-Operator-Key`** (`push_devices.py`:193 (#1864)) on
  `POST /api/push/devices/{id}/unrevoke` (`daemon.py`:4826-4853 (#1864), registered at `:4909-4910`), whose
  gate is the single place the distinction is made (`_push_operator_gate`, `daemon.py`:4730-4770 (#1864)).
- **The CLI is the operator surface**: `lop mobile devices unrevoke <device_id>` calls that route
  **over loopback** with the session cookie *and* the key header (`cli.py`:7704-7752 (#1864), `:7836-7862`).
  It therefore **needs the mobile daemon running**, and the honest answers when it is not are the
  CLI's own: `daemon_unreachable` — "the mobile daemon on port N did not answer" (`:7745-7747`);
  `credential_missing` — "no mobile password is set on this computer — run `lop mobile install`"
  (`:7730-7733`); `operator_key_missing` — "no operator key yet — the daemon mints it when a device
  registers" (`:7851-7855`) — and each of those is **exit 1 with no fallback and no write**: a store
  with no key stays byte-identical, because the CLI never mints (`cli.py`:7846-7856 (#1864)). A
  **wrong** key is reported with the machine-side remedy, not the device's sentence — the device's
  copy tells a reader to "use the computer" they are already using, so the CLI renders the fact that
  can be acted on: `error: machine_only: this computer's operator key does not match the daemon's
  registry — check --port or restart the daemon` (`cli.py`:7866-7877 (#1864)), exit 1. The account
  console keeps the device-facing sentence.
- **The tunnel gateway cannot carry the header, and must never learn to**: it REBUILDS the request
  headers from its allowlist (`gateway.py`:310-319, applied at `:537`), so the key does not survive
  the Radient hop — and a phone that somehow sent one would not have the value, because the key is
  minted on this machine (`daemon.py`:4736-4741 (#1864)). **`X-Lop-Operator-Key` must NEVER be added to that
  allowlist**, whose entries are lowercase — a mixed-case literal entry would silently do nothing.
  A QA row (**Q31**) asserts a request through the gateway carrying the header is refused — on the
  HTTP path **and** the WebSocket handshake (`gateway.py`:719 applies the same `headers()` filter).
- **Why the daemon's route and not the session runtime's control socket**: the control socket is a
  **per-live-session-runtime** listener whose auth is a per-session key
  (`session/runtime/server.py`:10-11), while the device registry belongs to the **mobile daemon**
  and must answer with **no session attached at all** — and the runtime's own model treats anything
  that is not exactly `locality == "local"` as remote (`session/runtime/server.py`:1304-1307, whose gates read
  `locality == "remote"`; the two-valued type is `attach_client.py`:889-895, "a local socket is not
  proof"), which is what
  the daemon's relayed phone frames are. A machine secret on the daemon's own route has neither
  problem. *(The store is a **0600 FILE** whose write is atomic and chmods before the replace
  (`push_devices.py`:926-946 (#1864)); the **directory's** mode is not asserted there, so this
  document claims 0600 and nothing about 0700 — the discovery records' 0600-under-0700 pattern
  (`registry.py`:5) is a different store.)*
- **The honest limit, adopted from core's own module docstring rather than softened**
  (`push_devices.py`:88-93 (#1864)): **the key file is readable by any process running as the same user**,
  including model-authored `bash`. So "operator surface" means **same-user**, not *human*, and the
  key is **not** a boundary against another local process — such a process could as well rewrite the
  store file directly. What it closes is the direction that matters: **a device cannot restore its
  own revoked state**, because a device never has the key. For the stolen-phone threat that is the
  whole point — a phone has no way to present the header, on either route; and the case where that
  is NOT enough is stated once, in §4's residual (a cookie-holding phone can drive an agent); against
  a malicious same-user process, protection is
  **out of this ADR's threat model**, stated rather than implied.
- **The paired-device certificate is not the discriminator, and must not be used as one** (round 5
  M5, restated): it is public data that *declares* authority and "grants nothing" by itself
  (`daemon.py`:1626-1641 (pin)), which is why `/approvals` can offer the phone a command without that
  amounting to the operator's credential. The route checks the **key**, nothing else.
- **What a phone gets instead of a 404**: the ordinary `403 machine_only` body above — a route the
  app can render — and the account console remains the second path, authenticated as the account
  owner (§2.4) and the one that works with the machine offline.
- **`revoke` stays device-callable and self-targetable; `unrevoke` does not**: a device that revokes
  *itself* only reduces its own access, which is safe for anyone holding a cookie to do — §4 rule 1's
  invariant ("neither marker is cleared by the device itself") is what the operator key makes
  structural.

**Fetch unread** *(new, §1.1)*: `GET /api/attention/unread` → the aggregate above. This one
route is what the in-app count, the icon badge and every resync read.

**Resolve a handle** *(new, §4)*: `GET /api/push/conversation/{handle}` → `{"session_id": "…"}`
or `404` when the handle is unknown (a rotated key, or a conversation that no longer exists).
This is what makes a cold tap landable when the conversation is not in the unread set.

**Ack a conversation** *(exists, unchanged, plus one additive field)*:
`POST /api/sessions/{id}/seen` with `{"completion_token": "…", "device_id": "…"}`. The
`device_id` is **additive and optional**: it is how a self-correcting attention push skips
the device that just acted (§3.3). 200 `{ok, attention}`; 422 missing token
(`daemon.py:3667-3671` (pin)); 409 `{"code": "superseded_completion_token"}` when a newer
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
itself, and `revision()` is the detector it already reads (`daemon.py:2499-2535` (pin)):

1. **on a tick**, the worker compares the `revision()` triple with the one it holds — an
   **equality** check used as the trigger — and, when it differs, asks the two reads which
   conversation actually moved: `acknowledgement_map()` diffed against the previous tick (an ack
   landed) and the supersede cursor (§2.1; a heal landed). It emits **per changed conversation**,
   never on a derived count (round 2 M1: a tick where a publish and an ack coincide leaves the
   count equal, so a count rule would miss the correction entirely);
2. the relay's `/seen` handler additionally nudges the in-process worker with the acking
   `device_id`. **The nudge consumes the change** (round 2 m3; the state defined in round 3 Q3): it advances
   the worker's stored **detector state — the `revision()` triple *and* the
   `acknowledgement_map()` snapshot**, which are the two things an acknowledgement moves — so the same ack
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
| `kind` | the title/body differ per outcome; the app must not re-derive it. It is the **store's** vocabulary (`complete, error, interrupted, closed, retired` — `attention.py:2047`), not the composer's: `compose.NotificationKind` lists `retired` and the gate kinds but **not `closed`** (`compose.py:60`), so a push builder keyed to the composer's literal set would silently drop a real outcome |
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

**The machine→cloud frames, as literals** *(round 7 Q-F16: round 6 put the `devices` block in
§4 prose only, and this section is the freeze point S3 reads; the cloud contract is
`extra="forbid"`, so a prose hint cannot be the contract). These are what the **machine** sends —
not what a phone receives, which is the APNs payload above. The block is **NEW on calls that
already exist**; every cloud-side shape is *(proposal)*.*

```jsonc
// 1. THE REGISTRATION FORWARD (S7) — sent when a device registers. `devices` is NEW here. The route
//    is the forward §3.1's register step names; the body below is what it carries.
POST <cloud>/v1/push/register
{ "computer": "<opaque per-account computer handle>",
  "device": { "device_id": "<opaque>", "platform": "ios|android",
              "environment": "sandbox|production", "app_version": "1.0.0 (12)",
              "push_token": "<platform token>", "registered_at": 1759… },
  "devices": [ { "device_id": "<opaque>", "credential_live": true,
                 "credential_expires_at": 1759…, "last_authenticated_at": 1759… } ] }

// 2. THE EMIT — the same block rides the next emit for this computer. `devices` is NEW here too.
//    THE ROUTE IS THE ONE §3.1 AND THE OPS NOTE ALREADY FREEZE (`POST /v1/tunnels/{id}/push/events`,
//    with the machine's `Idempotency-Key`), not a second spelling — S3 must not freeze two.
POST /v1/tunnels/{tunnel_id}/push/events        Idempotency-Key: <emit key, §3.4>
{ "v": 1,
  "emit_id": "<uuid>", "type": "completion|attention", "computer": "<handle>",
  "conversation": "<handle>", "completion_token": "<uuid>", "kind": "complete|error|…",
  "count": 2, "exclude": ["<device_id>"],              // attention only
  "devices": [ …the same block… ] }

// 3. THE HEARTBEAT — the block and nothing else, sent when neither of the above has happened for
//    15 minutes. This is the only call that can report a lapse to an app that is closed.
POST <cloud>/v1/push/credentials
{ "computer": "<handle>", "devices": [ …the same block… ] }
```

| Field | Type | Why it is the minimum |
|---|---|---|
| `devices[].device_id` | string | the cloud's routing key; the same identity §2.2's Device row carries |
| `devices[].credential_live` | bool | the only fact the delivery gate needs (rule 2) |
| `computer` | string | the routing key every machine→cloud call carries; `extra="forbid"` means it needs a row (§2.3's per-computer rule) |
| `device` | object | the registration forward's own device body — `device_id`, `platform`, `environment`, `app_version`, `push_token`, `registered_at`; §2.2's Device row is the custody statement |
| `devices[].credential_expires_at` | int, unix seconds | **NEW, and the reason the lapse is computable at all**: the cookie's own value is `<expiry>.<hmac>` (`mobile/auth.py`:465-469, signed once at login and never renewed), so the machine records **the expiry the phone presented** and the lapse is `expires_at <= now` — no clock arithmetic and no login-route writer (Q-F15 / R8-m1) |
| `devices[].last_authenticated_at` | int, unix seconds | what the machine last observed — **never** the basis of the lapse |
| `push_token` | string | the machine validates it and drops it (`daemon.py`:4776-4778 (#1864), PR #1864); the cloud's registry is where tokens live (§2.2) |
| ~~conversation name, snippet, transcript, `aps.badge`~~ | — | **never** (P2 and §1.5) |

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
handle, the completion's kind, the completion token, the emit id, the unread count — and, per
**device**, whether its credential is live and when it last authenticated (§4 rule 2, QA round 4
Q-F4). That last one is **delivery state, not read state**: it says when a device *talked to the
machine*, never what it read or whether it read anything, which is why it is not the read-history
stream §2.2 prohibits. **No conversation name, no transcript, no snippet, no failure text, no
prompt, no working directory, no file path, no model name, no tool output, and no read
history.**

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
   the cookie key is derived from the password (`docs/relay/contract.md`:48-52, ADR 0002 §6) — and
   the marker it writes is **`expired_at`**, never `revoked_at`, reported as one credential-change
   event so fan-out pauses until each device authenticates again (rule 2). **But its reach differs
   by route, and the copy must say which one the user is on** (round 6 M3/Q3):
   - **Direct route — a real lever.** The app holds that cookie, so the rotation invalidates the
     thief's copy immediately: it cuts the device off from the relay, stops **push delivery** to it,
     and the device only returns if it can authenticate with the new password.
   - **Radient route — not a lever.** The gateway **mints** the cookie from the machine's own
     password on every request (`gateway.py`:545-548), so the app never needs the password and a
     rotation does not lock the thief out. Its actual effect there is the connector outage described
     in rule 2: the gateway signs with a **stale** password until it is restarted, every device of
     that computer stops working, and the restart heals all of them — a thief included. The lever on
     that route is the **account side** (path 2).
   **It is not a revoke on either route**, which is why (1)/(2) are still required for a stolen
   phone; the app's copy must not conflate the two, and must not promise a route's lever on the
   other route.
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
| **Live** | none | present | — (it is registered) | `POST /api/push/register` on an authenticated session; **the relay mints that device's per-device key here** (§2.2), which is what later lets it move its own state and no other's |
| **Expired** | `expired_at` | kept | **yes**, by authenticating again | the **credential lapses**: a relay-password rotation (path 3) or the `lop_mobile` cookie's own TTL — **evaluated by the relay** (rule 2), the only component that sees the cookie |
| **Unpaired** | `unpaired_at` | dropped | **no**, until that computer is paired again | unpairing the **computer** (path 5): the devices bound to it go with it |
| **Revoked** | `revoked_at` | dropped | **no**, until it is un-revoked | an explicit revoke of *this device*: path 1 or path 2 |
| **Absent** | — (no row at all) | dropped with the row | **yes** | a provider dead-token (path 4) or the 60-day idle drop (§2.2) |

**The precedence is `revoked` > `unpaired` > `expired`** — the register route (§3.1),
`GET /api/push/devices` (`list`) and the delivery gate all resolve the *same* precedence on the
*same* markers, so no two surfaces can read one row as two different states. A row may carry more
than one marker (a device revoked, and then its computer unpaired); the winner decides both what
the route answers and what the user is told.

**The names, and the note's tense — checked at the note's head, not asserted** (round 4 M1; the
agreement is a reading, never an assertion). As of **`30a0f4d`** — `docs/push-cloud-ops.md` (PR #15), read 2026-09-30 — the note
carries the same five states, the same three markers, the same precedence, `expired_at` for the
credential lapse including a rotation, tombstoning for revoke *and* unpair, and the absent state
for the provider dead-token and the 60-day drop: the four divergences the round named are closed.
**Three remain, and round 5 M6 / QA Q-F11 caught that "one" understated them — the count and the
items both matter, because each is a thing a cloud implementer would build wrongly:**
1. **The rate.** The note still says the relay reports `credential_live` "on each authenticated
   request", where rule 2 specifies a **coalesced, change-triggered** report (round 4 `m5`). This
   ADR is the authority on the rate; the note is the authority on the cloud's handling of it.
2. **The credential epoch.** The note's credential paragraph still has the machine "check the
   credential epoch" — the exact counter rule 2 **deleted** (`docs/push-cloud-ops.md`:1115, round 4 `m1` / QA Q-F3). A
   reader of the note would build a check the machine will never send.
3. **The single-route claim.** The same paragraph says delivery "resumes at each device's next
   authenticated request, **which a stolen phone, lacking the new password, cannot make**" — the
   pre-Q-F2 model: on the Radient route the gateway injects the cookie and the phone never needs
   the password, which is precisely why rule 2 had to move that route's lock to the cloud grant.

4. **Four things this ADR has that the note does not carry at all** (round 6 QA Q-F8; a note that
   is the cloud lane's runbook would otherwise omit them): the **grant** (its record, mint,
   refusal, refresh and rotation), the **heartbeat** call and its cadence, **`device_key`** with
   `X-Lop-Device-Key`, and the **`devices` report block**. These are *owed to the note* rather than
   divergences of it, and they are on the list the note's author has.

   The note's author has been asked to re-align the three and add the four; **this ADR is the
   authority until the note matches it, and the note is not edited from this branch** (round 4
   M1's rule, kept). This paragraph is where the two documents are checked against each other.

Three rules follow, and together they are the whole of the revocation semantics:

1. **A revoke TOMBSTONES.** The token goes (there is nothing left to deliver to) and the row stays
   with `revoked_at` set. **`POST /api/push/register` refuses a device whose row carries
   `revoked_at`** (`403 {"code": "device_revoked"}`) — that refusal is what makes a revoke stick
   for the same `install_id` instead of being undone by the next app launch. **An unpair is
   durable in the same way, under its own marker**: the device's row carries `unpaired_at`, the
   register route answers `403 {"code": "device_unpaired"}`, and the app says *which computer*
   left instead of claiming a revoke nobody performed. Neither marker is cleared by the device
   itself; both are cleared by a deliberate act (below).
2. **Delivery requires BOTH a registered device AND a live credential for it — and *which*
   credential decides depends on the route the phone is on** (QA round 4 Q-F2; the routes are this
   repository's own `docs/relay/tunnel-edge.md`:59-76, which must not be read as one route).
   - **Direct route.** The app holds the `lop_mobile` cookie, whose key is derived from the relay
     password (`docs/relay/contract.md`:48-52). The relay is the only component that sees it, so
     the relay **evaluates** the flag and reports it; the cloud enforces what it is told.
   - **Radient route.** The edge **strips** `lop_mobile` and the local gateway **injects** it on
     every request, and the app never sees the password (`tunnel-edge.md`:59-76). The injected
     cookie is therefore minted per request, carries no per-device secret, and **cannot tell device
     A from device B**. Here the enforceable half is the **cloud-issued per-device grant**
     *(cloud, proposal — its record is §2.2's Grant row and its shape is the cloud lane's,
     [`docs/push-cloud-ops.md`](push-cloud-ops.md); round 5 Q-F8 found the load-bearing half of this
     route living in a sentence with no record, no route and no proposal marker)*, **minted at
     registration** against an `install_id` the machine's record carries and **required for
     delivery**: a revoked or unpaired device's grant is refused cloud-side, and the relay's report
     is an *auxiliary* signal rather than the lock.
   **Which protection holds where — and the fresh-install case** (round 5 M4; S4a asserts "a fresh `install_id` is refused on nothing", so the
   two statements could not both stand):
   - **Direct route, fresh install:** stopped by the **password**. The app must present the relay
     password to get a cookie at all, and a re-installed app does not have it; this is the route
     where "revoke AND rotate" is a real lever, because rotating invalidates the cookie the thief
     holds.
   - **Radient route, fresh install: NOT stopped by the grant, and this ADR will not pretend
     otherwise.** There the gateway **injects** `lop_mobile` from the machine's own password
     (`gateway.py`:545-548), so the phone never needs that password — and the grant is
     *minted at registration*, while a fresh `install_id` carries no marker for the state rules to
     refuse. A re-installed app that can still reach the tunnel therefore **registers, is minted a
     grant and receives pushes**. The tombstone stops the *known* row and the key stops a device
     acting for *another* device; neither binds a new identity.
   - **What actually binds it there is the account side, and that is a cloud-side requirement, not
     a property of this document** *(proposal, §7)*: the mint and the fan-out must be refused while
     the account's own access for that computer (or that device) is revoked, so the user's lever is
     **revoking the phone's access in the Radient account and re-pairing** — not this computer's
     password. **The remedy is route-dependent: rotation is a device-facing lever on the direct route only.** On the Radient route
     the gateway reads the password **once, when the `Gateway` is constructed** — `self.mobile_password
     = mobile_password` (`gateway.py`:449), built from config at `tunnels/service.py`:527-533 — and
     nothing in the connector's poller reloads it. So a rotation does not lock the thief out; it
     makes the gateway sign with a **stale** password until the connector is restarted, which locks
     out **every** device of that computer (the owner's own phone included) and then **heals itself
     at that restart**, because the restarted gateway signs with the current password. That is an
     outage, not a revocation — the lever there is the account side.
   **The honest limit:** on the Radient route the cloud both mints and refuses the grant, so a
   cloud that ignored its own record could still fan out. What the machine contributes is real but
   partial — it never emits for a device it has marked, never refreshes a grant for one, and
   pauses that computer's fan-out with one credential-change event — and the last word is
   Radient's, which is the price of buying the last mile from whoever holds the APNs/FCM
   credentials (§2.4's bargain, stated rather than implied).
   **The report, its carrier, and how a lapse is derived** (round 4 `m5`; round 5 Q-F9, which
   caught that "piggybacked" named no field; round 6 Q-F13, which caught that §3.2 forbids unknown
   fields and this block had no named home). The carrier is named, and every addition below is
   **NEW**:
   - **The registration forward** (the machine→cloud call that forwards a registration, §3.1/§7
     *(proposal)*) carries `devices: [{device_id: str, credential_live: bool,
     last_authenticated_at: int, unix seconds}]` — the exactly-typed block, not a prose hint.
   - **The next emit** (§3.2's attention/completion body) carries the **same block**, added to
     §3.2's allow-list as a *machine→cloud* field: the app-facing payload table is unchanged, and
     nothing new reaches the phone.
   - **A heartbeat of its own** — `POST <cloud>/v1/push/credentials` *(cloud, proposal)* — carrying
     that block and nothing else, sent when neither of the above has happened for **15 minutes**.
     Both bounds are ceilings: change-triggered, **at most once per device per 5 minutes**, batched
     for all of the computer's devices, **one** credential-change event per rotation.
   **The lapse is DERIVED, and it is derived from the cookie's ISSUE time, not from the last
   request** (round 7 Q-F15 / R7-m1 — the round-6 draft said `last_authenticated_at` + TTL, which
   over-reports: the cookie is signed **once at login** and never renewed, `sign_cookie` puts only
   an expiry in it (`mobile/auth.py`:465-469`, `<expiry>.<hmac>`), the expiry is `now +
   COOKIE_TTL_S` at that moment (`COOKIE_TTL_S = 30 * 24 * 3600`, `:99`), and nothing refreshes it
   (`:29-33`, "there is no session table") — so a phone whose last request was on day 29 would
   derive a lapse on day 59 while its cookie really died on day 30.
   **The machine therefore records the expiry the phone actually presented**, and the field is new:
   `credential_expires_at` (unix seconds), **read out of the presented cookie and written at register
   time** (and refreshed by any later authenticated request that names its device) — **not** by the
   login route, which knows no device and, on a first install, has no record to write to (R8-m1). It
   lives on the device's Credential record (§2.2) beside `last_authenticated_at` and is reported in
   the `devices` block (§3.2), so the direct route's lapse is `credential_expires_at <= now` — the
   cookie's own death, with no arithmetic and no second clock.
   **On the Radient route the TTL does not govern at all**: the gateway mints a **fresh** cookie for
   every request it forwards (`gateway.py`:545-548`), so no phone cookie there is ever 29 days old
   and the device's liveness is the **grant's**, which the cloud owns (§2.2) — which is why that
   route's lock is the account side and not a clock. A device whose credential lapsed while the app
   was shut is reported not-live **at the next heartbeat** (≤15 min) with the same derivation, and
   fan-out pauses for it then. The cloud sees **O(devices) state, never O(requests) traffic.**
   **What writes what — the relay's routes are the only writer of markers, and the operator
   surface is the only thing that ever *clears* one** (`m1`, Q-F3; round 5 m9, which caught that
   "writer" alone read as exhaustive and left the clearing transitions unstated): set —
   `expired_at` when a rotation kills the cookies (one machine-side action, §4 path 3) or when a
   request arrives carrying a stale cookie (attribution is bound, see the next paragraph),
   `unpaired_at` on an unpair, `revoked_at` on a revoke; cleared — re-registering clears
   `expired_at`, and `unrevoke` (owner-only, §3.1) clears `revoked_at` and `unpaired_at`.
   **The emit worker writes no marker at all**: it reads the flag and the markers, skips a device,
   and emits the event.
   **Attribution is bound, not asserted** (`m3`): `X-Lop-Device` alone is a *claim*, so a request
   that moves a device's state must also present the **per-device key minted for it at
   registration** (machine-side, never sent to the cloud), and a request without it **moves no
   device's state**. That is what stops a stolen cookie from vouching for another device — and
   every self-reported action here can only *pause* its own delivery, never restore it, which is
   why accepting such a report is safe by construction.
   **AND THE HEADERS MUST REACH THE RELAY AT ALL** (round 6 M1 — the hole that made this whole limb
   inert on the route the app actually uses). The tunnel gateway forwards only its allowlist:
   `headers = {k: v for k, v in incoming.items() if k in _REQUEST_HEADERS}` (`gateway.py`:537),
   where `_REQUEST_HEADERS` (`gateway.py`:310-319) is accept / accept-language / content-type /
   range / if-none-match / if-modified-since / last-event-id / origin. **`X-Lop-Device` and
   `X-Lop-Device-Key` are stripped today**, so "no key, no state change" would mean *nothing moves
   state* there. The fix is named and additive: **add both headers to `_REQUEST_HEADERS`
   (`gateway.py`:310-319)`*(NEW)* — never the cookie, which the gateway *injects* rather than
   forwards (`:545-548`), and nothing the edge is meant to rewrite (`docs/relay/tunnel-edge.md`:59-76).
   §7 carries it as its own row and a QA row asserts a registration through the gateway arrives
   with its key end to end.
   **There is no credential "epoch"** (`m1`, Q-F3): the relay and the emit worker are the same process, so the flag **is** the machine-side fact
   and a second counter would be a copy that can disagree with its source.
   **Rotation sets `expired_at`, never `revoked_at`**: it is not a decision about the device, the
   token is kept, and the device is welcome back the moment it authenticates — which clears
   `expired_at` and restores `credential_live`.
3. **Dead-token deletion is a DIFFERENT state (path 4), not a revoke.** APNs `410` / FCM
   `UNREGISTERED` is a *provider signal* about a token (uninstalled app, rotated token), not a
   decision by the user: the row is deleted, **no marker is written**, and re-registration is
   allowed and expected. The 60-day idle drop (§2.2) is this same state for the same reason.
   Conflating either with a revoke would refuse a legitimate reinstall; conflating a revoke with
   them would let a stolen device back in.

**How a device comes back — and none of it is the device's own doing** (round 4 B1; round 6 made
it structural, §3.1 — the route is operators-only and a device has no way to present the key). By an explicit act, on a surface the device
does not control — **the operator surface** (the `lop mobile devices` verbs, which call the
daemon's operators-only route over loopback with the machine's `operator_key`, §3.1)
**or the account console**: the second path, and the one that works with the machine offline, which
is why the account-side revoke/un-revoke surface is a slice of its own in §7. Per marker:
`revoked_at` → `lop mobile devices unrevoke <device_id>` *(new — §3.1)*; `unpaired_at` → pair that
computer again (the pairing flow clears it for every device bound to it), or un-revoke that device;
`expired_at` → nothing to clear: authenticate with the current credential and re-register. In every
case **the marker's clearing restores no token** — the app must register again, and registering
needs a live credential (direct route) or a mint the account has not revoked (Radient route, rule
2). Settings shows each row with its state and the action that clears it ("re-pair this device",
"pair this computer again", "sign in again to resume") rather than hiding a device the user cannot
see or un-revoke.

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
freshly installed app mints a **new** one — so what binds a re-install depends on the route (rule
2), and the two answers are different facts, not one sentence with a footnote:
- **Direct route: the credential binds it.** To register at all the app must authenticate with the
  relay password (`/login`; the cookie key is derived from it, `docs/relay/contract.md`:48-52), and
  a re-installed app does not have it — so here **revoke AND rotate** is the honest remedy, and the
  revoke may offer "also change this computer's password to cut it off completely".
- **Radient route: only the account binds it.** The gateway injects the cookie from the machine's
  password, so a re-install registers and a rotation is that outage-and-heal above — **the honest
  remedy is revoking the phone's access in the Radient account** (path 2), and the copy must say
  **exactly that, never the password sentence**. Promising rotation there would be the ADR's own
  named failure — a user told they are protected while the device keeps receiving.
Neither route may claim a revoked device is unreachable while it still holds a live cookie, and no
surface may offer a lever the user's route does not have.

**The residual the operator key does NOT close — stated once, here** (round 8 M1 / Q-F23, accepted):
the key is a boundary at the **HTTP layer of the un-revoke route**, and only there. **A phone holding
a valid `lop_mobile` cookie can drive this machine's agent** — it can start a session
(`daemon.py`:4253` (pin) is `api_start_session`) and send a prompt through the command frame (`:3964-3972`)
— and that agent runs as the **same user** as the daemon, so it can read the registry file that holds
`operator_key` (`push_devices.py`:88-93 (#1864) says the same thing from the other side). **Whether
that path is actually walkable is UNTESTED** — neither review round demonstrated an exploit, and the
agent's tool-approval policy is the thing that would have to be passed: `tool_approval_mode` in
`config.yml`, `--yolo`, or the in-session `/approvals` command — **and `tool_approval_mode: auto`
installs no gate at all** (`docs/CONSOLE.md`:53), so a machine configured that way has no second line
here. The mitigations that do hold are the ones §4 already lists: the password rotation on the
**direct** route (which invalidates the cookie) and the account-side revocation on the **Radient**
route. Nothing in this ADR should be read as "a revoked phone cannot reach the machine" — it says
precisely: a revoked phone cannot **un-revoke itself over HTTP**, and everything else is the agent's
own policy.

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

**The device-state vocabulary — one source, three surfaces** *(core's `lop mobile devices` renders
it today; the app's Settings must mirror it, and this is the user-facing half of §4's state machine)*:

| State | The sentence (a module constant, not app copy) |
|---|---|
| `live` | "registered, and push resumes on its next authenticated read" |
| `expired` | "notifications are paused for this device until you sign in again" |
| `unpaired` | "this computer is no longer paired" |
| `revoked` | "this device was revoked on this computer" |
| `absent` | "not in this computer's registry; it may register again" |

- The five rows are `push_devices.STATE_DESCRIPTIONS` (`:159-165` (#1864)), rendered in
  `DESCRIBED_STATES` order (`:166-169` (#1864)) and closed by `PRECEDENCE_SENTENCE` — "a device can
  carry more than one marker; the strongest is shown (revoked > unpaired > expired)"
  (`:175-177` (#1864)). **The app consumes the same strings**: they are module constants precisely so
  the CLI's legend, the app's Settings and the wire cannot describe one state three ways. `absent` is
  not a row state — it is what a read-back says when the row is gone, which is also how the 60-day
  drop surfaces with no local marker (§2.2).
- A row renders its **label** first, then `registered <when> · last authenticated <when>` — or
  `last seen <when>` for a row an earlier build wrote, because naming a field the row does not carry
  "starts lying the moment they diverge" (`cli.py`:7981-7986 (#1864) for the rationale, `:7988-7992`
  for the renderer) — then the id on its own
  indented line (what `revoke` needs, not what a reader recognises).
- **The unrevoke results, exactly as rendered** (`cli.py`:7888-7898 (#1864)): revoked →
  `unrevoked <label>`; unpaired → `cleared the unpaired marker on <label>`; expired → `nothing to
  clear on <label>` plus "it is expired, not revoked — signing in again is what resumes push"; live →
  `nothing to clear on <label>`. All four then print "no token or credential was restored: it must
  register again, which needs a live credential (sign in with the portal password)." **The app must
  not invent a fifth wording**, and the legend only appears when there are rows to explain
  (`cli.py`:8026-8029 (#1864)).
- The legend carries the cloud gap too: "the cloud also drops a device after 60 days with no
  authenticated request, and this computer cannot see that drop — a row here can read live while push
  has already stopped" (`cli.py`:8068-8071 (#1864), from `CLOUD_IDLE_DROP_DAYS`).

### 7. Cost, effort, and the critical path

Sizes in the scale this repository uses elsewhere (S ≈ a day or two of focused work, M ≈ a
week, L ≈ more, with an unknown tail):

| Slice group | Owner | Size | Why |
|---|---|---|---|
| **Aggregate read, population, list field** (§1.1-§1.2, plan S1) | daemon-core | **S** | one pass over identities the listing already has, one route, one field. ~150 lines plus the two equality tests |
| **Conversation handle + resolve route** (§4, S2 — the per-row **listing field was rejected**, plan S2/§4) | daemon-core | **S** | an HMAC mint, one field on the aggregate, one resolve route |
| **Interface freeze** (§3, S3) | all three | **S** | the §3 shapes, refusal shapes, fixtures in this repo's `fixtures/` (ADR 0003's pattern) |
| **Device registry, register/list/deregister routes, no token stored** (§3.1, S4) | daemon-core | **S–M** | durable record, cloud id, Settings list, the generic deregister |
| **Device lifecycle: live / expired (`expired_at`) / unpaired (`unpaired_at`) / revoked (`revoked_at`) / absent (no row), the shared precedence revoked > unpaired > expired, the register route's two refusals, the emit-side skip, the per-device key minted and returned by **every** register call (so a register **is** the rotation's delivery path, round 7 R7-m2), and **`POST /api/push/devices/{id}/unrevoke` gated by the machine-minted `X-Lop-Operator-Key`, answering `403 machine_only` without it** — core PR #1864's shape, adopted in round 7** (§3.1, §4, S4a) | daemon-core | **S–M** | the states are one table in code, not five booleans read ad hoc, and the register route, `list` and the emit path resolve the **same** precedence (asserted); `403 device_revoked` on a tombstone and `403 device_unpaired` on an unpaired row, while `expired_at` re-registers; a worker **skips** a device marked or `expired_at` (asserted by observing no emit); a dead token or the 60-day drop deletes the row with **no** marker and re-registers cleanly; **a device's own session gets `403 machine_only` on its own un-revoke** (B1, asserted) while the machine surface and the account console both succeed; a request without the device's key moves no device's state |
| **Credential-live evaluation and the credential-change event** (the relay evaluates per route — cookie vs cloud grant — the cloud enforces, `X-Lop-Device` **plus the per-device key** on identifying requests, the report **coalesced** with a named carrier and a heartbeat, one event per rotation, fan-out paused until each device's next authenticated request, **and the two device headers added to the gateway's `_REQUEST_HEADERS` allowlist (`gateway.py`:310-319, NEW) so they survive the Radient hop at all**) (§3.1, §4 rule 2, S4c) | daemon-core + Radient-cloud | **S–M** | after a rotation **no** device of that computer is delivered to (observed at the provider stub) while the machine also refuses to emit for it — and each resumes on its own next authenticated request, not on the rotation's; a device that never authenticates again stays paused, which is the point; **the cloud's seen traffic is bounded by devices, not requests** (asserted: N authenticated requests in a window produce at most one report per device, and none at all when the state did not change); on the Radient route the refusal is observed at the cloud, and on the direct route at the relay |
| **Push worker: two cursors + baseline, acknowledgement-map diff, gates, presence deferral, catch-up, bounded queue that advances only on the cloud's `202`** (§2.1-§2.3, S5) | daemon-core | **M** | the store is done; the risk is the gates and the cursor, not the volume |
| **Attention emit: structural detection (`revision()` equality as the trigger, then the acknowledgement map and the supersede cursor say which conversation moved), `/seen` nudge that consumes the change, `exclude` on the wire** (§3.1, S6) | daemon-core | **S** | reuses the loop that already reads `revision()` |
| **App: notifications module, permissions, channels, badge management, handle resolution, `+native-intent` + route, unpair UI, Settings copy, FOSS gating** (§5-§6, S8/S9/S11) | app | **M–L** | a new native module, a new lifecycle path, a new route, a new settings surface, and a build-flavour story: the largest single diff |
| **Cloud: registration forward, ingest with idempotency, fan-out, delivery record, routing, revocation and unpair **tombstones**, the **account-side revoke/un-revoke surface** (works with the machine offline), the per-device grant and its refusal** (§2.2, §3.1, §4) | Radient-cloud | **L, and outside our control** | two credentials' worth of setup, a new always-on service, token lifecycle, retry/coalescing, an operational surface, and the device list a stolen-phone revoke needs |

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
| **A re-install outrunning the tombstone on the Radient route** (round 5 M4, stated rather than smoothed) | a fresh `install_id` carries no marker, the gateway injects the cookie from the machine's own password, and the grant is minted at registration — so a re-installed app that can still reach the tunnel registers and is pushed to | the **cloud's mint-refusal log** (a mint while the account's access for that computer is revoked must be refused, §4 rule 2) and QA **Q25**: the case passes only when the account-side revoke stops delivery — never because the tombstone did |
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
it was round 2's Q12): `daemon.py:3689-3691` (pin) → **`:3694-3695`** (the SSE wake; `:3689-3691` is
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
`local_operator/session/resume.py` → **`local_operator/resume.py`** (QA round 4 Q-F1: the mapped
path did not exist at the pin — the lines were right and the path was never exercised);
`attention.py:1611` → **`:2047`** for the store's kind vocabulary (QA round 5 Q-F6: `:1611` is the
`notify` line, so the citation *resolved* and the **fact** was elsewhere — found by reading the
line); `daemon.py:777-813` (pin) → **`:778-782`** (round 6: the range started on a blank line and missed
the set literal at `:778`); and the table now also maps `gateway.py`,
`attach_client.py`, `tui_handle.py` and `mcp/grants.py` (QA round 6, row 7). **Only `gateway.py` and
`attach_client.py` are cited since round 7** — the round-6 control-socket design that used the other
two is retired (§3.1) — and they stay mapped on purpose: a mapping that is stale is harmless, while a
citation that resolves to nothing is silently skipped by a naive checker, which is the failure this
whole block exists to prevent (QA round 7, row 3). **Round 7 — the reversal, and the two refs.**
The HTTP `unrevoke` route and the `403 machine_only` refusal were **removed in round 6**, on the
finding that a restriction could not be implemented from a request; **round 7 reversed that**, and
the reason matters more than the outcome: the predicate is a **machine-minted secret presented as a
header** (`X-Lop-Operator-Key`), not a locality claim, so the route is back as the operators-only
shape core implemented in PR #1864 (§3.1). The round-6 control-socket framing (`control_key`) is
retired with it — the registry belongs to the daemon, which answers with no session attached, while
the control socket is a per-live-runtime listener. Two citation fixes came with it: the
0600-under-0700 fact is **`registry.py`:5**, not `info/render.py`:15-17 (R7-n1), and the document now
cites **two trees** — the pin, and PR #1864's head `d089f7e0f` for the code it adopts, marked
`(#1864)` after each range — which is what the provenance table's second row declares and what
`docs/adr/0006-verification/resolve-citations.py` resolves separately.
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
