# ADR 0006 — Push notifications and cross-surface acknowledgement

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-30
- **Deciders:** mobile app maintainers **and** Local Operator (core) maintainers — this
  record is deliberately cross-repository, because three of its four decisions land in
  the core, not in this app
- **Depends on:** [ADR 0001 — Framework](0001-framework.md), [ADR 0002 — Connection and auth](0002-connection-and-auth.md), [ADR 0004 — CI/CD](0004-ci-cd.md)
- **Amends:** [ADR 0005](0005-queued-asks.md) §5 — its "`v1` has **no push notifications**"
  and its forward pointer ("Push notifications are a separate RFC") are **the RFC it
  predicted, now written**; its in-app `asks_open` badge and its honest-copy rule stand
  unchanged. Also amends [`docs/ux/flows.md`](../ux/flows.md) §12 **D-1**, whose v1
  disposition was option (c) "deferred to v1.1, with (a) only"; this ADR decides (b)
  under a constraint (a) did not have — see §2.
- **Related:** [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md); this
  repository's [`docs/relay/`](../relay/README.md) contract map; the core's
  [`docs/ATTENTION.md`](https://github.com/damianvtran/local-operator/blob/main/docs/ATTENTION.md),
  [`docs/DESKTOP_API.md`](https://github.com/damianvtran/local-operator/blob/main/docs/DESKTOP_API.md),
  [`docs/design/notification-feed.md`](https://github.com/damianvtran/local-operator/blob/main/docs/design/notification-feed.md);
  the slice plan in [`docs/push-plan.md`](../push-plan.md)

**Why 0006 and not 0005.** The request that produced this note named
`docs/adr/0005-push-and-ack-sync.md`. That number is taken: ADR 0005 (queued asks) was
merged as PR [#13](https://github.com/damianvtran/local-operator-mobile/pull/13) earlier
the same day. Two records sharing a number is the one thing an ADR index cannot survive,
so this is 0006.

**Provenance of code citations.** Every `file:line` below is stated at a named revision
and was resolved with `git show <ref>:<path>` — never read from a working tree, because
the shared checkouts carry other sessions' staged work:

| Repository | Revision | How paths are cited |
|---|---|---|
| **local-operator** | `40ca7910e49a` (`origin/main`, read 2026-09-30) | `local_operator/mobile/daemon.py` → `daemon.py`; `local_operator/session/attention.py` → `attention.py`; `local_operator/notifications/compose.py` → `compose.py`; `local_operator/operator/devices.py` → `devices.py`; `local_operator/tunnels/api.py` → `tunnels/api.py`; `docs/*.md` by full path |
| **local-operator-mobile** | `origin/main` @ `d5bb850fccac4dcfdd80f2e3b352a51107a955bc` (read 2026-09-30) | this repository's own paths |
| **Radient** (control plane, edge, console) | **no code access** — specified here as an *interface*, never as a change to existing code. Where §2 cites an endpoint shape it is a **proposal**, and the shipped-vs-proposed distinction is stated at each site | `internal/…` and `edge/…` appear only where ADR 0001/0002 already pinned them |
| **Apple / Google / Expo platform docs** | read 2026-09-30, cited by URL | vendor behaviour, quoted with the page it came from |

**The wire is not shipped.** Nothing in §3 exists on a relay a client can reach today.
`attention.db` and its routes do exist and are cited; the push-specific routes, the
device registry and the aggregate read are **new**, and are proposed here so that the
core, the cloud and the app can be built against one shape.

---

## Context

### 1. What a "notification" already is on this machine

The word is overloaded, so this ADR fixes it before deciding anything else. On this
machine there are **three** distinct things, and only one of them is what a push may
carry:

| Thing | Where it lives | Lifecycle |
|---|---|---|
| A **completion** | `attention.db`'s `completions` table — one row per settled turn, keyed by a UUID `token`, with `anchor`, `kind`, `reason`, `cause`, `notify`, and an `AUTOINCREMENT` `sequence` (`attention.py:1412-1419`) | published at turn settle, durable, superseded **in place** by a heal (never renumbered) |
| A **read receipt** | `attention.db`'s `receipts` — `conversation → acknowledged`, the highwater mark of the completions a human has *seen* (`attention.py:1421-1424`) | moved only by `acknowledge`/`acknowledge_many`, token-bound |
| A **delivery** | `attention.db`'s `deliveries` — `conversation → delivered`, claimed atomically by `claim_delivery` (`attention.py:349-353`, `:2379`) | "somebody was told", which is deliberately **not** the same fact as "somebody read it" (`attention.py:12`; `docs/ATTENTION.md`:142-156) |

`unseen` is *derived*, never stored: a conversation is unread when
`MAX(completions.sequence) > receipts.acknowledged` (`attention.py:1588-1612`), surfaced
as `AttentionState.unseen` and mirrored into the relay's `SessionSummary.unseen`
(`daemon.py:1051`; `_is_unseen` at `:1099`).

**Pending gates are a fourth, separate thing.** A parked `ask`/`approval` has its own
lifecycle and is *never* answered or removed by a completion receipt (`docs/ATTENTION.md`
§"Identity and durability"); the phone sees it as `needs_attention` + `pending_kind`
(`daemon.py:991-992`), and the desktop machine-wide feed deliberately does not carry
gates at all (`BRIDGE_NOTIFIABLE_KINDS = {"complete", "error", "retired"}`,
`server/utils/desktop_sessions.py:368`). §3.2 keeps that boundary.

### 2. Surfaces already share the read state — that part is done

This is the most important thing this ADR found, and it changes the size of the work.

**The TUI, the desktop app and the mobile daemon all read and write the same
`attention.db` under the config root, through the same `AttentionStore`.** Concretely:

- the **TUI** lists the completions *its sidebar is painting* and clears exactly that set
  (`local_operator/tui/app.py:40563-40610`, `/notifications read`, token-bound and
  documented in `docs/ATTENTION.md` §"A gesture may acknowledge what a surface ENUMERATES");
- the **desktop app** acks per session (`POST /v1/desktop/sessions/{id}/seen`) and in bulk
  (`POST /v1/desktop/attention/seen`, 1..500 items, `docs/DESKTOP_API.md:570-573`) and learns
  about every change within ~100 ms from the machine-wide feed
  (`GET /v1/desktop/events`; one `os.stat` doorbell per tick, `docs/design/notification-feed.md`);
- the **mobile daemon** acks with `POST /api/sessions/{id}/seen` (`daemon.py:3642-3697`,
  route registered at `:4701`) and then invalidates its summaries cache and wakes the list
  SSE (`:3689-3691`), and every 2 s (`SCAN_INTERVAL_S = 2.0`, `daemon.py:92`) re-reads the
  store's own change detector and repaints every watched session (`:2499-2535`).

So **"an ack on one surface clears it on the others" is already true for surfaces attached
to the same machine**, at the store level, with no cloud involved. What does *not* exist
is (a) any aggregate of the unread state, and (b) any mechanism by which a *device that is
not currently connected* learns that something changed. Those are the two things §1 and §2
add.

### 3. What the operator asked for

Proper push; **cross-surface, cross-device acks** with no double badges; **badge count =
the number of conversations with unread notifications**; a push tap that opens a killed
app and deep-links to the notifying conversation; and QA across the permutations (app
open / backgrounded / killed; several devices on one machine and on different machines;
an ack racing an in-flight push).

Plus four requirements that arrived with the ask and are folded in below rather than
restated: the desktop UI and TUI are clients of the **same** ack contract (§1.3); the
badge rule is exact and must agree with the in-app count (§1.4); the self-hosted path
degrades to the foreground SSE stream with honest copy (§2.4); and no transcript content
leaves the machine in any payload (§4).

### 4. Two constraints that decide most of what follows

- **The machine is the source of truth, and the app must work without Radient.** The
  architecture principle is already written down — "the relay is the source of truth; the
  app is a projection cache" (`docs/architecture.md`:35) — and the app is explicitly
  designed to run against a self-hosted tunnel or any custom URL with a relay password
  (ADR 0002 §5). Any design in which the cloud becomes the authority for unread state is
  therefore not merely a privacy question; it breaks the app's reason to exist.
- **One machine, one daemon, one store — but many devices.** The daemon is the only
  always-on process (`RunAtLoad` + `KeepAlive{SuccessfulExit:false}` LaunchAgent,
  `mobile/install.py:1696-1701`; `Restart=on-failure` on Linux, `:1947`), it binds
  loopback and is reached through the tunnel, and it owns the store. *N* devices is the
  normal case, *N* computers is a first-class case (ADR 0002 §"per-computer caches,
  per-computer credentials"), and the app's answer to the second must not be a cloud
  account.

---

## Decision

### 1. The source of truth for "unread", and the exact badge rule

**`attention.db` on the machine stays the only authority for unread state.** Everything
below is derived from it, on the machine, and pushed; nothing in the cloud is ever
authoritative, and no client may compute the badge from its own local list of
notifications.

#### 1.1 The model can express "conversations with unread notifications" — but nothing computes it

The per-conversation state already carries exactly what the badge rule needs
(`unseen`), and the machine-wide change detector already exists in the shape that makes an
aggregate cheap:

```
AttentionStore.revision() -> (MAX(sequence), SUM(acknowledged), supersedes)   attention.py:2129-2150
```

The three terms are deliberate: the first moves on a publish, the second on a read, and
the third on a **heal** that deliberately moves neither (a supersede is an in-place
`UPDATE`, so a corrected record cannot be detected by either watermark,
`attention.py:2000-2030`). The store's own docstring states the contract: *callers compare
the tuple for equality and never interpret the terms*.

**What is missing is one read**: there is no route anywhere on the machine that returns a
count. (`grep` across `server/routes/` and `mobile/daemon.py` for an unread/unseen count
returns nothing; the desktop listing's `counts` census is a per-scope row census, a
different fact — `docs/DESKTOP_API.md`:640-660.)

**Decision: add an additive aggregate read on the mobile relay, and nothing else in the
core's semantics.**

```jsonc
GET /api/attention/unread            // new; auth-gated exactly like /api/sessions

{
  "count": 2,                        // THE badge number: conversations with unseen == true
  "revision": [1043, 1041, 7],       // AttentionStore.revision() — an EQUALITY token, not an order
  "degraded": [],                    // mirrors the listing: ["attention"] when the store could not be read
  "conversations": [                 // only unread ones; bounded, and the app never needs more than it shows
    {"session_id": "…", "completion_token": "…", "kind": "complete",
     "revision": [1043, 1041]}
  ]
}
```

Three properties are load-bearing:

- **It is additive.** No table changes, no existing semantics move, no existing route
  changes shape. An older client that never calls it is unaffected, and a newer client
  against an older relay gets a 404 and falls back to counting the rows it already holds.
- **`count` counts *conversations*, not completions and not pushes.** A conversation with
  three unread completions contributes **1** — that is the operator's rule, and it is also
  what `unseen` already means per conversation.
- **The revision triple is a change token only.** `AttentionState.revision`
  (`[sequence, acknowledged]`) is explicitly *not* a merge key: a heal republishes a
  corrected state under the **same** pair, so a client that dropped an update whose
  revision did not advance would discard exactly the correction the heal exists to deliver
  (`server/models/desktop_sessions.py:1163-1172`). Any consumer of this route — and of a
  push that carries a revision — must therefore treat **equality as "probably unchanged,
  go and look"**, never as "stale, drop it", and must never order two states by it. The
  app's own store rule already says the same thing in a different vocabulary: replace
  wholesale on each snapshot (`docs/architecture.md`:115).

#### 1.2 Eligibility is two flags, and both are the machine's

`unseen` is not the only gate a push must pass:

- **`notify`** (§14's origin-aware flag, computed *by the session* from the run's trigger
  record and carried verbatim — the store never derives it, `attention.py:2026-2031`).
  `notify = 0` means "this completion may be recorded but must not interrupt". Rows written
  before the field read as `1` through an additive column (`attention.py:1538-1539`), so an
  upgraded machine behaves exactly as it did.
- **The machine's own quiet rules** — the settings surface already promises them
  ("when a turn finishes", quiet hours, and "don't notify while I'm at the computer",
  `docs/ux/flows.md`:570). The last one has real machinery behind it: the desktop's
  machine-wide presence and the TUI's viewer records (`server/utils/desktop_presence.py`;
  `session/runtime/presence.py`).

**Decision: `notify` is respected by the push path; `unseen` is not narrowed by it.** A
`notify = 0` completion still counts toward the badge, because the badge must equal what
the in-app UI shows and the in-app mark is `unseen`, not `notify`. The residue — a quiet
completion that nobody is looking at raises a badge without a push — is the correct
reading of the two facts the store keeps apart: *notifying is cheap and reversible,
marking-read is not* (`attention.py:12`), and a delivered banner does not mark anything
read (`attention.py:2288-2300`). The alternative (badge = notifiable unread only) is
rejected because it makes the icon disagree with the row the user is looking at, which is
the one thing the operator's rule forbids.

#### 1.3 Where each surface attaches — the shared contract, named

This is the operator's first addition, answered against the code. **There is no new
per-surface protocol: there is one store, one token-bound ack operation, and one
subscription per surface.**

| Surface | Acks with | Learns about a change through |
|---|---|---|
| **TUI** | `/notifications read` → `acknowledge_many` over the rows its sidebar painted (`tui/app.py:40563-40610`) | its 1 s catalog poll and the store's `revision()`/`acknowledgement_map` deltas |
| **Desktop** | `POST /v1/desktop/sessions/{id}/seen`, and `POST /v1/desktop/attention/seen` for a clear-all (`docs/DESKTOP_API.md:570-573`, `:682`) | `GET /v1/desktop/events` — 100 ms doorbell, `attention` frames per changed session |
| **Mobile app** | `POST /api/sessions/{id}/seen` with `{completion_token}` (`daemon.py:3642-3697`) | the list SSE (`/api/sessions/events`, woken by the daemon on every ack, `:3689-3691`) while foregrounded, and **push** while backgrounded (new, §2) |

**The minimal addition to make this literally one contract** is *not* a new ack path. It
is a single shared statement of the rule these three already implement, plus two small
things: (i) the aggregate read in §1.1 so that every surface derives the same badge number
from the same read, and (ii) the badged count on the mobile list the app already
subscribes to — carried on the existing `capabilities` block rather than a new stream
(`daemon.py:3528-3530`), so it rides frames the app already parses.

**The rule the three surfaces must share, stated once:** *an acknowledgement is
`(conversation, completion_token)`, it is idempotent, it is refused when the token is not
the conversation's current completion (`superseded_completion_token`, `attention.py:185`,
`daemon.py:3691-3699`), and **no automatic path may acknowledge anything** — only a
gesture, or a result a human actually rendered* (`docs/ATTENTION.md` §"What a frontend can
acknowledge" and R10). Nothing in the push work is allowed to relax that: **arriving,
tapping, or being woken by a push is not a read.**

#### 1.4 The badge rule, exactly

> **The app icon badge = the number of conversations with unread notifications, as
> reported by the machine the app is connected to, and the in-app count is the same number
> read from the same route.**

Consequences, all deliberate:

- A **conversation with three unread completions counts once.**
- **Pending asks do not contribute to this number.** They are a different state with a
  different lifecycle (§Context 1), they are not token-bound (`acknowledge` takes a
  *completion* token), and the app already badges them in-app with their own count
  (`asks_open`, ADR 0005 §5; `docs/ux/flows.md`:301-305). *This is the one place where the
  operator may want to overrule this ADR*: a parked ask with no unread completion raises no
  icon badge. §9 records the alternative and what it would cost.
- **The count is never derived from pushes received.** A device that missed ten pushes must
  show the true badge the next time it can read the machine; a device that received ten
  pushes for one conversation must show 1.
- **`count = 0` clears the badge.** On iOS that is `aps.badge = 0` / `setBadgeCountAsync(0)`;
  on Android it is best-effort by launcher (§5).
- **When the machine cannot be read, the badge is not updated** and the app says so rather
  than guessing: a store that could not be read is not an empty pile
  (`docs/ATTENTION.md` §"Two more things this relaxation depends on"). The `degraded` array
  in §1.1 is how the app learns which of the two it is looking at — the same contract the
  listing already ships (`daemon.py:739`, `docs/relay/contract.md`:196-200).

#### 1.5 Cross-*device* is solved here; cross-*machine* is explicitly not

This is the honest scope statement the operator's QA permutation list needs.

- **Several devices, one machine — covered.** Every device reads the same store through the
  same daemon, and every ack wakes the list SSE (`daemon.py:3689-3691`). A backgrounded
  device is corrected by the silent attention push in §2.3. No double badge: a device's
  badge is always the machine's number, and an ack on device A makes device B's next read
  (or wake) return the new number.
- **Several machines — *not* merged, by decision.** Two computers are two `attention.db`
  files, two counts, and no shared identity: the app's model is already per-computer
  (ADR 0002 §"per-computer caches, per-computer credentials"; `docs/architecture.md`
  open question 3 / D-3), and a conversation id is only meaningful within the machine that
  owns it. **Acknowledging a conversation on machine A will not clear it on machine B**,
  because machine B is not showing the same conversation — it may well have an identically
  named one. The badge is therefore **per computer**: the icon shows the count of the
  computer the app is currently on, and a future per-computer badge in the switcher
  (D-3's surface) is the honest way to show the others.
- **Why not merge them in the cloud.** Merging requires uploading `(conversation,
  read-at)` state for every conversation on every machine to Radient — precisely the
  authority inversion §Context 4 forbids, plus a per-account read history that is worth
  more to an attacker than anything else this feature touches. **What would change this
  decision:** an explicit operator decision to accept that upload, at which point it is a
  new ADR and not a patch to this one.

### 2. The delivery path

#### 2.1 The chain, and the direction of every hop

```
  ┌─ the machine (the only always-on process) ─────────────────────────────┐
  │  turn settles → AttentionStore.publish()          attention.py:1959     │
  │    → new row in attention.db (+ notify flag)                            │
  │  push worker (in the daemon, ~2 s poll — daemon.py:92 — reusing the     │
  │  store's equality token as its doorbell, exactly as the desktop feed    │
  │  reuses os.stat)                                                        │
  │    gate: unseen?  (§1.1)   notify?  (§1.2)   quiet presence?  (§1.2)    │
  │    → OUTBOUND POST to Radient, authenticated as the connector,          │
  │      Idempotency-Key = the completion token    tunnels/api.py:70-125    │
  └────────────────────────────┬───────────────────────────────────────────┘
                               │  (the machine never accepts an inbound
                               │   push control path; it already talks to
                               ▼   the control plane every ~10 s)
                    Radient control plane  ← holds: the APNs key, the FCM
                               │              service account, device tokens,
                               │              per-account routing, and the
                               │              record of what was pushed
                               ▼
                        APNs  /  FCM
                               ▼
                     the device(s) of that account
```

Three properties of this chain are decisions, not accidents:

1. **Outbound-only from the machine.** The connector already reaches the control plane with
   its own Radient credential and already supports `Idempotency-Key` on every call
   (`tunnels/api.py:70-125`); the account identity it should be keyed on is already
   fetchable (`account_id()` → `GET /v1/me`, `:144-170`). Asking the *cloud* to reach into
   the machine for events instead (a pull) would make a user's laptop serve cloud traffic
   it does not serve today and would widen the machine's exposure for no gain — rejected.
2. **The cloud holds no authority and no content.** It is a *transport with a memory of
   what it sent*, which is exactly what the operator asked for ("the record of what was
   pushed"). It cannot answer "what is unread", because it cannot read `attention.db`.
3. **Push requires the Radient path, and that is a limitation of the mechanism, not a
   policy** — APNs and FCM both require a *server* holding the app's push credentials, and
   only Radient has them. §2.4 is the plain statement of what that means for a user who
   does not.

#### 2.2 What the cloud must hold, and nothing more

| Record | Fields | Why it is the minimum |
|---|---|---|
| **Device** | `device_id`, `platform` (`ios`/`android`), push token, `environment` (`sandbox`/`production` — the app cannot know which shipped), app build, `created_at`, `last_seen_at`, `revoked_at` | token rotation and revocation are the whole of device management |
| **Account → devices** | the Radient account id → its live device ids | routing; the account already exists (`GET /v1/me`) |
| **Computer → devices** | the connector's tunnel identity → the devices that paired to *that* machine | a user with three machines must not be pushed about machine C's work while only paired to A |
| **Delivery** | `(device_id, conversation_handle, completion_token)` → sent/attempted, APNs/FCM id, response code | the record of what was pushed: it is what makes a re-delivery idempotent and a revocation testable |
| **The push credentials** | APNs `.p8` key id + team id; the FCM service account | the reason the cloud has to exist at all |

**What the cloud must NOT hold:** transcripts, conversation names, session ids,
working directories, model names, prompt text, or any read-state history. §4 is how the
conversation identity is kept out too.

#### 2.3 Who decides that a push may be raised — and why the phone is not a rung

This is the subtlest decision in the ADR, and getting it wrong silently silences either the
desktop or the phone.

The core has an **eligibility ladder** for OS banners, and behind it a machine-wide
arbitration watermark: a surface that is *watching* the session suppresses the banner
(rung 1); otherwise a notify-capable desktop app claims the completion (rung 2); otherwise
a running TUI (rung 3); otherwise the runtime itself (rung 4). The claim is
`claim_delivery`, one durable `deliveries` watermark per **conversation**, and **exactly
one** surface ever wins (`attention.py:2379-2430`; `docs/ATTENTION.md` §"Who raises the
banner").

So: **should a push claim?**

**Decision: no. The phone is not a rung, and `claim_delivery` is untouched.** Reasons:

- The watermark is per conversation, so a push that claimed would silence the desktop
  banner on the same machine — and a *desktop* claim would silence the push for a user who
  is not at their computer at all. The two audiences are different devices in different
  places; they are not competing for one screen the way rungs 1–4 are.
- Making it a fifth rung cannot be fixed by ordering: whichever claim wins, the loser is
  silenced *for good* (a re-claim returns `False`; there is no lease and no expiry — the
  accepted cost documented at `attention.py:2400-2420`). A coin-flip between "the banner
  you needed" and "the phone you needed" is worse than either.
- It would also break the claim's own invariant that the claimant **is** the deliverer and
  claims immediately before raising the banner, after its focus gate
  (`docs/ATTENTION.md`:148-156).

**What the push worker consults instead**, in order, all machine-local reads:

1. `unseen` for the completion (still true at send time — this is also the anti-race guard
   in §3.3);
2. `notify` (§14's flag);
3. **the user's own quiet rules**, expressed as the existing presences rather than a new
   clock: the machine-wide desktop presence (window focused *and* visible *and* not
   minimised) and the TUI viewer record. If the user is demonstrably at this computer, the
   push is suppressed and the local banner (rungs 1–4) is free to fire — which is exactly
   the promise `docs/ux/flows.md`:570 already makes in Settings;
4. a per-account device set that is non-empty (no paired phone, no work).

**And the ordering property this preserves:** a TUI at the terminal *and* a phone in a
pocket both get told. Nothing is silenced by the other.

#### 2.4 A user with no Radient account: push does not work, and the app says so

Plainly, because the operator asked for it plainly:

> **On a self-hosted route (a custom tunnel, or any URL with a relay password) there is no
> push, at all, in this design and in any design that uses APNs or FCM.** APNs and FCM
> both require a server that holds the app's credentials; that server is Radient; a user
> with no Radient account has no such server. There is no "self-hosted push" that keeps an
> iOS phone alerted while the app is closed — iOS provides no other wake mechanism, and the
> app cannot hold a socket in the background. The one exception is a *self-built* push
> gateway that the user runs against their own Apple/Google developer credentials, which is
> a product of its own and is not this ADR (recorded in §9).

What the app does instead, and what it must say:

- **While the app is foregrounded**: the SSE list stream and the per-session stream are
  live (`/api/sessions/events`, `/api/sessions/{id}/events`), the unread marks and the
  in-app count are correct, and the icon badge is set directly from the aggregate read in
  §1.1 — no push is involved in any of it.
- **A local notification for a completion that lands while the app is running** is a
  legitimate, cheap addition (flows.md D-1 option (a)) and should ship for both routes;
  it is *not* a substitute and must not be described as one.
- **On foreground/resume, a full resync**: the SSE reconnect's snapshot plus a
  `/api/attention/unread` read reconcile the badge and the rows. There is no delta to miss,
  because the wire is snapshot-based by design (ADR 0002 architecture principle 1).
- **In Settings the truth is stated once, where the toggle is**, in the Local Operator
  voice, and it names the *remedy*, not just the limitation. Proposed copy, to be reviewed
  by the designer in the app slice:

  > **Notifications** — *Your phone can be alerted when a turn finishes, but only when this
  > app has a Radient sign-in to deliver it through. You are using a direct connection, so
  > alerts only work while Local Operator is open. Sign in to Radient to get them in the
  > background.*

  and, on the Radient route with no paired computer or notifications denied at the OS
  level, the matching sentence for that state. Never "you will be notified" when the route
  cannot deliver one — the rule ADR 0005 §5 already set.

### 3. The ack-sync contract

All operations are on the **mobile relay** unless marked *(cloud)*. Shapes are JSON; every
one is auth-gated by the existing `lop_mobile` cookie with its 30-day TTL (ADR 0002 §6,
`docs/relay/contract.md`:48-52).

#### 3.1 The operations

**Register a device** (new). The app posts the token it got from the platform; the *relay*
is where it lands, and the relay forwards it, because the relay is the only party with a
credential on both sides and the only party that can revoke.

```jsonc
POST /api/push/register
{"platform": "ios" | "android",
 "token": "<opaque platform token>",
 "environment": "sandbox" | "production",     // only the app knows which build it is
 "app_version": "1.0.0 (12)",
 "install_id": "<uuid, minted once and kept in the keystore>"}
→ {"ok": true, "device_id": "…", "registered_at": 1759…}

// Idempotent on (install_id, platform): re-registering with a rotated token REPLACES the
// token and keeps the device_id, so a device that rotates its push token nightly cannot
// accumulate rows.
```

**Deregister** (new) — the app calls it on sign-out and on "forget this computer"; the
relay also calls the cloud's delete when a paired computer is removed:

```jsonc
DELETE /api/push/devices/{device_id}   → {"ok": true}
```

**Fetch unread** (new, §1.1): `GET /api/attention/unread` → the aggregate above. This one
route is what the in-app count, the icon badge and every resync read.

**Ack a conversation** (exists, unchanged): `POST /api/sessions/{id}/seen` with
`{"completion_token": "…"}` (`daemon.py:3642-3697`). 200 `{ok, attention}`; 422 when the
token is missing; 409 `{"code": "superseded_completion_token"}` when a newer completion has
replaced it; 404 unknown session; 401 unauthenticated. **The app must re-read the projection
and retry with the token it now names** — the refusal carries no state on purpose
(`attention.py:2175-2240`).

**Emit a completion event** (cloud, proposed): `POST /v1/tunnels/{tunnel_id}/push/events`
with `Idempotency-Key: <completion token>`, body = the payload in §3.2's `data` object
minus the badge. Response names which devices it fanned out to and the per-device result.
Idempotency is required by the fan-out: a retry after a timeout must not double-push, and
the key the machine already has (the completion token, a UUID) is exactly the right one.

**Emit an attention change** (cloud, proposed): the same route with `type: "attention"`,
sent by the relay when an ack happens on *any* surface, so that the account's other devices
for that computer can correct their badges.

#### 3.2 The push payload, and why each field is the minimum

```jsonc
{ "aps": { "alert": {"title": "Local Operator", "body": "A turn finished."},
           "badge": 2,
           "thread-id": "<conversation handle>",       // iOS grouping, per conversation
           "interruption-level": "active" },
  "data": { "v": 1,
            "type": "completion",                       // "completion" | "attention"
            "computer": "<opaque per-account computer handle>",
            "conversation": "<opaque per-account conversation handle>",
            "completion_token": "<uuid>",
            "kind": "complete|error|interrupted|closed|retired",
            "revision": "1043:1041",
            "badge": 2 } }
```

Field-by-field, with the reason each is needed rather than convenient:

| Field | Why it cannot be dropped |
|---|---|
| `type` | a tap on an `attention` push must not deep-link anywhere; it is a badge correction |
| `conversation` (opaque handle) | the tap must deep-link, the collapse-id must be per conversation, and the *raw* session id must not ride (§4) |
| `completion_token` | the tap's ack is token-bound, and the guard in §3.3 compares it |
| `kind` | the title/body differ per outcome, and the app must not re-derive it |
| `revision` | lets the app ignore a push that describes a state it already holds — as an **equality** check only (§1.1) |
| `badge` | the operator's rule, computed by the machine, applied at delivery time even if the app never wakes |
| `computer` | a tap on a multi-computer account must resolve *which* machine, before any session lookup |

**What the payload carries that is deliberately NOT content:**

- **No transcript text, ever** — not a snippet, not a preview, not a tool result.
- **No model-written text** — the machine composes the push, and the composer's
  `body_is_snippet` / `body_is_failure` halves must never be sent: a failure envelope may
  name a provider, a model or a quota (`compose.py`:84-105). The push body is the **house
  sentence** only.
- **No conversation name by default.** The machine already has the flag that governs this —
  `session_names_in_notifications()` (`tui/notify.py:802-820`), whose docstring says exactly
  why it exists ("not *may we interrupt* but *may we say what about*"). It is the machine's
  setting, so it applies to every surface including this one; with it off, the title is the
  app name and the body is a house sentence.
- **No session id, no cwd, no directory, no model id** — §4.

#### 3.3 Ordering and the race rules

The four permutations the operator named, plus the two races, decided:

| Case | What happens | Why it is correct |
|---|---|---|
| **App open** | the list SSE is live; the user opens the conversation, the result is rendered, and the ack is sent token-bound. A push that arrives anyway is not suppressed by the app; it is *irrelevant*, and the icon badge was already the machine's number | no automatic path acks; the rendered-result rule governs (`docs/ATTENTION.md`) |
| **App backgrounded** | the alert push raises the badge from the machine's count. A tap wakes the app, deep-links (§6), and the ack fires **only after** the completion row is genuinely rendered | identical to the desktop's `guardForegroundReceipts` rule, in the app's own terms |
| **App killed** | same as backgrounded for delivery. The tap cold-starts the app, the deep link is resolved before the default destination commits (§6), the session is opened (resuming the runtime if needed), the row renders, the ack fires | a killed app cannot be woken silently on iOS, so nothing may depend on a background wake having happened |
| **Several devices, one machine** | device A acks → the relay writes the receipt and calls the cloud with `type: "attention"` → device B receives a **silent attention push** and re-reads the aggregate | B is corrected even though B never saw the completion |
| **An ack races an in-flight push** | the push worker re-checks `unseen` for that token immediately before emitting, so an ack landing first suppresses the send entirely. If the push is already at APNs, it still arrives — and the tap lands on the conversation, which then renders **already read**: the app must not re-ack, must not change the badge, and must not show the unread mark | the second check is a read, not a claim, so it cannot break the claim's clock-free predicate; and a push that describes read state is harmless, because the badge is a snapshot that the next read replaces |
| **A push for a conversation acked seconds earlier on another surface** | the same as above; additionally the device's `revision` equality check means the app does not repaint from the push at all, and its next `/api/attention/unread` read is authoritative | the equality rule, not an order, is what makes this converge (§1.1) |

**Two rules that make the races safe rather than merely rare:**

- **The badge is a snapshot, never an increment.** A device that applies `badge` from a push
  has taken the machine's number at composition time; nothing ever does `badge ± 1` on a
  device, so a missed or duplicated push cannot drift the count — the *increment* design is
  the one that drifts, and it is rejected here by name.
- **The tap is authoritative over the push.** Whatever the payload said, the app resolves
  the conversation from the machine and paints what the machine says now. A push is a
  doorbell, not a record.

#### 3.4 Idempotency and versions, stated once

| Operation | Idempotent? | Version / token |
|---|---|---|
| `POST /api/push/register` | yes, on `(install_id, platform)` | token replaced, `device_id` stable |
| `POST /api/sessions/{id}/seen` | **yes** — a delayed or duplicate receipt converges upward (`MAX(receipts.acknowledged, excluded)`, `attention.py:2247-2249`); a receipt for a superseded token is refused, not recorded | `completion_token`, monotone `sequence` |
| `POST …/push/events` (cloud) | yes, on `Idempotency-Key = completion_token` | the token |
| the badge | **not idempotent and not meant to be** — it is a replace-whole snapshot carrying the machine's `revision` triple | equality-checked, never ordered |
| `AttentionStore.revision()` | n/a | `(MAX(sequence), SUM(acknowledged), supersedes)` — equality only |

### 4. Privacy and security boundaries

**What leaves the machine, exhaustively:** the completion's **kind** and **token**, the
**badge count**, the `revision` pair, an opaque computer handle, an opaque conversation
handle, and (only when the machine's own flag is on) the conversation's name as the push
title. Nothing else. No transcript, no prompt, no working directory, no file path, no model
name, no tool output, no error text, no session id.

**The conversation handle, and what it buys.** The session id (`session_id`, 12 hex chars,
derived from the conversation's directory) is not a secret, but it is a *stable, guessable
in principle, globally-meaningful* identifier, and handing it to the cloud would give Radient
a per-conversation index it has no need for. So the payload carries a **per-account opaque
handle** minted by the relay (or, where the handle is minted by the cloud, derived under a
key the cloud rotates) and mapped to a session id **on the machine**. The app resolves
handle → session id by asking the machine it is already connected to (the list it fetches on
open carries both). Cost: one small mapping table and one extra read after a cold-start tap.
Benefit: the cloud cannot count, correlate or name a conversation, and a leaked push log
reveals that *something* finished on *some* computer.

**Token handling.** Device tokens are opaque strings; the cloud stores them encrypted at
rest, keyed to the account and the computer; the *machine* stores only the registration it
forwarded (or nothing but the device id — the recommended split is device registry on the
cloud, so the machine holds no token at all). The APNs `.p8` and the FCM service account
live in the cloud's secret store and never in the app or the repository — and, per this
repository's rules, `google-services.json`/`GoogleService-Info.plist` are **build inputs
injected from CI secrets**, never committed (the repo is public; `AGENTS.md`: "Never commit
tokens, … certificates", and `.env` files are already forbidden).

**Revocation, and what a revoked device stops receiving.** Four paths, all of which must
work:

1. **App-side sign-out / forget-this-computer** → `DELETE /api/push/devices/{id}` → the
   cloud deletes the token. The app also deletes its cached projections (ADR 0002 §"Logout
   is a security control").
2. **Unpairing a computer** → the relay deregisters every device bound to that computer,
   because a device paired only to A has no business being pushed about B.
3. **Server-side** → the account can revoke a device in the cloud; the next fan-out to that
   token is refused and the device is marked revoked.
4. **A dead token** → APNs `410 Unregistered` / FCM `UNREGISTERED` deletes it. Deletion is
   not optional: an accumulating token table is a privacy liability and a cost.

**Revocation is a security control, so it is stated as one**, in the vocabulary ADR 0002 §6
already set: a push token copied off a device could keep receiving payloads until the cloud
is told, and the app must never claim "notifications stopped everywhere" while a revoke is
still pending — the same rule as its tunnel-session revoke.

**When the cloud is unreachable, the machine does nothing dramatic.** The push worker
queues at most a bounded number of undelivered events with a bounded retry and then
**drops** them, logging once rather than once per tick; it never blocks a turn, never
retries forever, and never *needs* to succeed, because **unread state is durable on the
machine and the badge is correct the moment the app can read it.** A push is a nudge; the
machine's own state is the product. (The connector's own reauthorization machinery already
handles the dead-login/refused/unreachable cases for the tunnel as a whole —
`tunnels/gateway.py`:30-90, `docs/tunnels.md` §"A dead Radient login" — and the push path
must reuse those verdicts rather than inventing a second vocabulary.)

### 5. iOS and Android platform constraints

The gaps that actually matter, with the vendor statement each rests on.

**APNs**

- HTTP/2 + token-based auth (a `.p8` key with its key id and team id); `apns-topic` = the
  bundle id ([Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)).
- **A badge is delivered by an `apns-push-type: alert` push**, not a background one: Apple's
  push-type table lists `alert` as "notifications that trigger a user interaction — for
  example, an alert, **badge**, or sound", while `background` "must not contain any keys
  that would trigger user interactions" and a background notification "doesn't display an
  alert, play a sound, or badge your app's icon"
  ([push types](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns#Know-when-to-use-push-types),
  [background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)).
  **Therefore:** the completion push is an `alert` push (it carries the badge and the
  banner), and the cross-device badge correction is an `alert` push whose `aps` carries
  **only** `badge` — which shows nothing and corrects the number.
- **Silent wakes are best-effort and cannot be relied on**: background pushes are low
  priority, are discarded when the app has been force-quit, and Apple advises "don't try to
  send more than two or three per hour" (same page). **Therefore:** the badge correction is
  a badge-only alert push (§3.3), and the app *also* reconciles on every foreground/resume.
- **APNs stores only one notification per bundle id**, and may reorder or coalesce one sent
  to the same device ([same page](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)).
  **Therefore:** per-conversation coalescing with `apns-collapse-id` (≤ 64 bytes) is the
  right behaviour, and a burst of completions may legitimately arrive as a subset — the
  badge and the list are what make that harmless.
- Payload limit 4 KB; `apns-expiration` decides how long an undelivered push is retained
  (default in the FCM path: 30 days) — the payload above is ~300 bytes, so there is no
  reason to compress content into it, which is one more argument for its minimal shape.

**FCM (HTTP v1)**

- `notification.tag` replaces an existing notification ("Identifier used to replace existing
  notifications in the notification drawer"), `notification_count` sets the count, and
  `channel_id` **must name a channel the app has already created** or the message falls back
  to a default channel ([AndroidNotification](https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.androidnotification);
  [REST projects.messages](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)).
  **Therefore:** the app creates one channel per notification class at first run, and the
  cloud's per-platform payload differs (a field FCM needs and APNs does not is not a leak,
  it is the transport).
- **Data-only messages are throttled in Doze and dropped after a force-stop** — the Android
  analogue of the iOS silent-push caveat, and the reason the badge-only-in-app path exists
  on both platforms.
- **Launcher badge support varies**: "Not all Android launchers support application badges.
  If the launcher does not support icon badges, the method will always resolve to 0"
  ([Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)). The app
  must therefore treat the Android icon badge as best-effort while treating the **in-app**
  count as exact — which is why §1.4 ties the badge to one route rather than to the OS.

**Entitlements and capability work each store requires**

| Store | What must exist before the first build that contains this code |
|---|---|
| **Apple** | Push Notifications capability on the App ID; an APNs key (`.p8`) uploaded to the cloud's secret store; the `aps-environment` entitlement (Expo sets `development` and Xcode flips it to `production` in an archive build — [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)); Background Modes → *remote-notification* only if we ever need a silent wake (`enableBackgroundRemoteNotifications` in the config plugin); and a profile that includes push. Time-window: an App ID change invalidates provisioning profiles, so it lands before the first TestFlight build that carries the module |
| **Google** | A Firebase project + `google-services.json` **injected from CI**; a service-account JSON for the v1 send API held by the **cloud** only; Android 13's `POST_NOTIFICATIONS` runtime permission requested with context, not at launch |
| **Both** | the notification-permission ask has a *reason* on screen before the OS dialog (the app's design kit already forbids a bare OS prompt) |

**FOSS channels.** ADR 0004 parks F-Droid and says why: "push notifications would pull in
Google Play Services / Firebase" ([`0004-ci-cd.md`](0004-ci-cd.md):178,
[`other-channels.md`](../publishing/other-channels.md):128). **This ADR does not change
that verdict — it makes it concrete:** the FOSS product flavour must compile push out
entirely (no Firebase, no `expo-notifications` push path) and keep exactly the §2.4
degradation, where the app is a foreground SSE client with local notifications. F-Droid's
row in `other-channels.md` already says "Revisit when notifications land, not before";
this is that revisit, and its answer is "a flavour, in the app slice, later".

### 6. Navigation contract: the composer home, and the cold-start override

The operator's navigation requirement is recorded here as a contract, not as a UI slice
detail, because a push tap's correctness depends on it:

1. **The default destination is a new-chat composer**, with conversations behind a sidebar.
   This comes from the operator, not from this ADR.
2. **A push cold-start deep link overrides the default destination.** Precedence, stated as
   an order because `app/`'s routing makes it a real question: *(a)* a notification response
   present at launch wins; *(b)* then an inbound `localoperator://s/<id>` link; *(c)* then
   the default (composer home). Nothing else may consume a cold-start destination first —
   in particular the auth/connection flow must **carry it**, not drop it.
3. **The response must be consumed exactly once.** `expo-notifications` exposes the launch
   response through `getLastNotificationResponse()`/`useLastNotificationResponse()` and a
   foreground listener, and `clearLastNotificationResponse()` exists for exactly this
   ("May be used when an app selects a route based on the notification response, and it is
   undesirable to continue selecting the route after the response has already been handled",
   [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)). A
   re-render, a theme change or a re-auth must not re-navigate the user into the same
   conversation.
4. **The destination survives a not-yet-connected app.** A cold start after a tap usually
   arrives before any session exists: the credential may need a tunnel session minted
   (ADR 0002 §3). The pending destination is therefore held in `connection-store`-adjacent
   state and consumed when the connection reaches `live` — never dropped, never replaced by
   the composer.
5. **A conversation the device has never seen.** The push carries an opaque handle, so the
   app must resolve it: fetch the list; if the session is there, open it; if not, fetch the
   single session; if the computer does not know it at all — the conversation was deleted,
   or the handle belongs to another machine — **land on the conversations sidebar with one
   honest sentence** ("That conversation isn't on \<computer\> any more.") and no error
   state. A cold tap must never dead-end, and must never fabricate an empty transcript
   screen for a conversation that does not exist.
6. **Notifying conversation ≠ current screen.** When the user taps a push for conversation
   B while the app sits on A, the app navigates to B (`router.push`), and the back
   affordance returns to the composer home. The sidebar's unread marks are the machine's,
   so the row for B clears the moment the ack lands — not on navigation.

**Out of scope, explicitly:** the composer's data path (sending, queuing, steering) is
untouched by this ADR, and in particular **the STT composer readout is not part of this
work**. STT is being built against the real provider cascade (tunnel-aware, bring-your-own
providers) in a parallel workstream; this ADR neither designs it nor blocks on it, and the
navigation change in (1) must not be used as a vehicle for it.

### 7. Cost and effort, and the critical path

Honest sizes for the four pieces, on the scale this repository uses elsewhere (S = a day or
two of focused work, M = a week, L = more, with an unknown tail):

| Slice | Owner | Size | Why that size |
|---|---|---|---|
| **Core: aggregate unread read + badge on the list** | daemon-core | **S** | one read over an existing store, one additive route, one additive field on a payload the app already parses. ~150 lines of core plus tests |
| **Core: push worker, device registry, eligibility gates** | daemon-core | **M** | the store is done; this is a poll loop reusing the store's equality token, a durable registration record, the three gates in §2.3, a bounded outbound queue with idempotency, and honest logging. The risk is not size, it is the *gates* — they must reuse the presences rather than invent a new suppression rule |
| **App: notifications module, permissions, badge, deep links, settings copy, FOSS flavour gating** | app | **M–L** | a new native module, entitlements and build inputs (CI implications in ADR 0004), a new lifecycle path (cold start, listener, badge reconciliation), the navigation contract in §6, and the Settings surface. Largest single *diff*, but every piece of it is conventional |
| **Cloud: device registry, event ingest with idempotency, fan-out to APNs/FCM, delivery record, per-account routing, revocation** | Radient-cloud | **L, and outside our control** | two credentials' worth of setup, a new always-on service, token lifecycle, retry/coalescing, and an operational surface. **Cannot be started before the interfaces in §3 are frozen** |

**The critical path is: the cloud-side fan-out, gated by the two blocked operator items,
with the core's aggregate read as the piece that must land first because everything
downstream reads it.**

That is close to the operator's expectation with one correction worth stating: the *unread
model* is not the hard half — it already exists and the aggregate over it is small (S). The
two genuinely hard halves are (i) the **cloud**, which is new, always-on, and not ours to
write, and (ii) the **eligibility question in §2.3**, which is a design trap rather than a
volume of work: getting it wrong silences either the desktop banner or the phone for good,
and it is the one decision in this ADR I would want a second reviewer to attack.

**On the blocked operator items.** Two are already recorded: Radient-side **account
deletion** (checklist A8 — a store-submission blocker, `docs/publishing/checklist.md`:33)
and the **organisation developer accounts** (A2–A4: D-U-N-S, Apple Developer Program as the
organisation, Play organisation account). **Push adds a third of the same kind, and it is
worse than either:**

- an **APNs key** and an **FCM service account** must be created and held by Radient — a
  new credential dependency, and one whose loss breaks a user-visible feature rather than a
  submission;
- and, unlike A8, the fan-out service is a **runtime** dependency: it must be up, it costs
  money, it holds personal data (device tokens and a delivery log), and it needs an owner,
  a deploy story and an on-call story. That is a commitment about Radient the platform, not
  a feature of this app, and it belongs in the same conversation as A8 rather than beside it.

### 8. Sequencing

Full slice table, owners and exit criteria are in [`docs/push-plan.md`](../push-plan.md).
The order this ADR *decides*, and the reason:

1. **Core: the aggregate read (`/api/attention/unread`) and the badge field.** Nothing else
   can be specified against a shape that does not exist, and it is independently useful
   (the app's in-app count can use it with no push at all). **Ships alone, benefits users
   immediately, needs no cloud.**
2. **Core: device registry + push worker behind a feature flag**, with the §2.3 gates and
   the §3.1 emit call pointed at a **stub** control plane in tests, so the whole path is
   exercisable with no Radient dependency. **This is the slice that proves the design before
   the cloud exists.**
3. **Cloud: ingest + fan-out** against the frozen §3 interfaces. Blocked on the operator
   items in §7; the interface freeze is what the app and core can do *now*.
4. **App: everything in the app slice**, developed against a stub push (a local
   `xcrun simctl push` / an FCM test message, and the mock relay from ADR 0003).
5. **FOSS flavour gating, Settings copy, and the store-submission inputs** (entitlements,
   CI secrets) — the last mile, and the part with the longest external latency.

### 9. Risks to watch during rollout, and what would change this decision

| Risk | Watch it with | Mitigation already in the design |
|---|---|---|
| **Badge drift when wakes are throttled or the app is force-quit** | count, per platform, the deliveries where the badge differs from the machine's number at next foreground; if that is not near zero within seconds of a resume, the correction path is wrong | badge is a snapshot + reconcile-on-resume; Android icon badge labelled best-effort |
| **A push that should have been suppressed** (user at the computer) | the §2.3 gates are testable in isolation; assert the push worker does *not* emit while a focused desktop presence exists | no new clock, no new lease; reuse the existing presences |
| **The phone quietly silenced by a desktop claim** (the trap in §2.3) | one test: with a TUI running *and* a device registered, both are told; and with the desktop focused, the banner fires and the push is suppressed *by the presence gate*, not by the watermark | `claim_delivery` untouched |
| **Revocation that does not revoke** | a revoked token must produce a refused delivery and a deleted row; test all four paths in §4 | deletion on `410`/`UNREGISTERED` |
| **Acknowledge-by-accident** (a new automatic path clearing marks) | the rule is one sentence in §1.3; a test that a delivered push, a wake, and a foreground change all leave `unseen` untouched | `claim_delivery` never advances the read watermark (`attention.py:2288-2300`) |
| **Cloud outage** | turn a turn's push into a log line, never a stall; the machine's state must be unaffected | bounded queue, drop, no retry storm |
| **Privacy regression by drift** (someone adds a field) | the payload table in §3.2 is the allow-list; the cloud contract should reject unknown fields (`extra="forbid"`, the house pattern in `docs/design/descriptive-notifications.md`) | content never leaves; handles not ids |

**What would change this decision:**

- **Merging unread state across computers** (§1.5) — needs an explicit operator decision to
  upload read state; it is a new ADR, not a patch.
- **Counting pending gates toward the icon badge** (§1.4) — the alternative reading of the
  operator's rule; it needs the core to give a gate a durable, ackable identity first,
  because the current ack is completion-token-bound.
- **A BYO push gateway for self-hosted users** (§2.4) — a product of its own; the honest
  answer today is "no push on that route", and this ADR would be amended rather than
  stretched if that changes.
- **Radient declining the fan-out service** — then push does not ship on the Radient route
  either, and §2.4's degradation becomes the whole product. That is a legitimate outcome
  and it is why the app slice and the core slice are designed to be useful without it.

---

## Consequences

### Positive

- **The hard half is already built.** Cross-surface acknowledgement, once-only arbitration,
  token-bound idempotent receipts, a durable store that survives restarts and upgrades, and
  a three-term change detector that survives in-place heals: all of it exists, is tested,
  and is shared by three surfaces today. This ADR adds *one route and one field* to that,
  and no new semantics.
- **The badge becomes a number nobody can disagree about.** One read, one definition, and
  the icon and the in-app count are the same number by construction.
- **The cloud is a dumb pipe with a memory.** It holds no authority, no content, and no
  read state; the machine can be offline and the badge is still right the moment anything
  can read it.
- **The app keeps its reason to exist.** A self-hosted user loses nothing that exists
  today: they lose a feature they never had, and are told so in one sentence rather than
  promised an alert.

### Negative, accepted

- **No push on the self-hosted route, ever** (§2.4). Stated plainly, in the ADR and in
  Settings.
- **No cross-machine unread merge** (§1.5). The badge is per computer.
- **A per-account opaque handle mapping** (§4) costs a table and a lookup after a cold tap,
  in exchange for keeping conversation identity out of the cloud.
- **A new always-on Radient service** (§7), with an owner, a cost and an on-call story.
- **A new product flavour** (§5): the FOSS build must compile push out.

### Neutral

- Nothing in `attention.db` changes shape. The additive `notify` column already set the
  precedent for how this store grows (`attention.py:1538-1539`).
- Nothing in this ADR changes ADR 0005's in-app ask badge, its queue authority, or its
  absence-based capability rule.
