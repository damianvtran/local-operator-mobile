# Push — cloud slice ops note

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md) (binding, not re-argued here) and
[push-plan.md](push-plan.md) slices **S7** (cloud), **S10** (deregistration) and **S11**
(store-submission inputs) and **S4c** (credential-live reporting). **Owner decisions of 2026-09-30
are folded in below, marked *Decided*; the sizing stays *Est.*, and Radient's own queue and rate
behaviour stays "expected, confirm", for the cloud lane to measure.** This note carries its own copy
of the decided shapes on purpose, because the cloud lane reads it alone; where the two could be read
differently, ADR 0006 governs the wire and this note governs the runbook.

**The decided set, in one read.**
- **Hosting:** the Radient control plane; a standalone Worker is considered and rejected (§2).
- **Launch limits:** 14-day delivery records; the 60-day drop of a silent device; 60 events/hour per
  computer, the excess re-delivered as one **visible digest alert** — a machine-composed frame, the
  cloud's ceiling composing nothing (§3).
- **Delivery promise:** a nudge, never a guarantee; delivery needs a registered device *and* a live
  credential (States and markers).
- **On-call:** alert-only to `support@radienthq.com`, no paging; a key rejection must be seen within
  the hour (§4).
- **Keys:** yearly rotation, a named break-glass holder, and the team-wide APNs blast radius
  standing, with a separate developer team the only real isolation (§5).
- **Specified vs built**, split three ways at core's `b77fec9d4` (after #1864 and #1878 merged):
  **specified** in ADR 0006 (#14, docs) — the five states and their markers, the register refusals,
  `device_key`, the credential block, the grant and the heartbeat; **implemented** in core — a
  writer for `revoked_at` only (`push_devices.py`:606), the two register refusals, `device_key`'s
  mint and verify (`device_key_matches`, constant-time and **unconsumed**), `device_state()` with
  its precedence, and the CLI verbs, which render the API's `state` field rather than calling
  `device_state()`; **unbuilt** — any writer for `expired_at` or `unpaired_at` (S10, S4c),
  `credential_live`'s report, the heartbeat and `credential_expires_at` (S4c), the **emit-side
  skip** that reads the markers, and the `X-Lop-Device` / `X-Lop-Device-Key` attribution headers
  with the gateway allowlist extension they need. Nothing outside `push_devices.py` consumes
  `device_state()` today. Still owed to the cloud lane: `last_error` / `last_error_at` and the
  cloud's record of digest **deliveries** (§6).

**1. What it does.** A machine's daemon sends one authenticated outbound event; ingest validates it,
writes it to a **durable queue** and answers `202 {emit_id, accepted_at}` — **ADR §3.1 already
returns that shape, so this note restates it** — and a worker fans out to the devices registered for
that account and computer via APNs and FCM, recording each outcome in the delivery record rather
than the response. The daemon never blocks: it queues locally with its cursor. The service holds
device tokens, routing, delivery records, the two provider credentials, the three state markers, the
per-device grant and the credential block it is sent — and nothing else: no transcript, name,
session id, read state or unread count (ADR §2.2). The one field it **sees and does not hold** is
`count`, the unread count at composition (ADR §3.2). Ingest refuses fields outside the ADR §3.2
table (`extra="forbid"`), and the machine's builder composes only house sentences. **Proposal: the
field table is the contract; a new field is an ADR amendment.**

**2. Who hosts it.** *Decided:* the Radient control plane (agent-server behind `api.radienthq.com`),
where the connector already authenticates and `account_id` resolves. The design is ingest route →
durable queue → worker → providers: one route (`POST /v1/tunnels/{id}/push/events`) that validates
and enqueues, a queue-consuming worker doing all provider traffic — no new public host, no inbound
path to machines. The standalone alternative (a Cloudflare Worker plus Queue) is **considered and
rejected**: it would duplicate connector authentication and the account→tunnel lookup.

**3. Cost.** FCM is free and APNs rides the Apple Developer membership the App Store already needs,
so the cost is the worker's replicas and their observability — *est.* two small replicas plus a
managed queue. Three limits, *Decided* for launch: **delivery records kept 14 days**; **a device
dropped after 60 days with no authenticated request** — "last seen" is its last authenticated call
(it reads unread on launch, foreground, connect), not its last delivery; and **60 events/hour per
computer**, the excess merged into **one digest emit** — but the ceiling is a guard over frames the
cloud already holds, never a second producer, which is the distinction "The digest, exactly" draws.

**The digest, exactly — and there is one composer.** A digest is a **visible alert** and a third
emit type, `type: "digest"` (the enum is `completion | attention | digest`). **The machine mints
it** — the type, an `emit_id`, the count, and an `aps.alert` built from the house constants, once,
when a catch-up exceeds the machine's burst limit. **The cloud composes nothing**: it mints no
payload, renders no banner from `type`, `kind` or `count`, and never edits, rewords or synthesises
alert text — the same rule that keeps it blind to conversation names and content (**P2**: ADR 0006's
boundary that no conversation name, snippet or transcript reaches the cloud). Its 60/hour ceiling is
a **delivery guard over frames it already holds**: it re-delivers the most recent frame for that
computer, **whatever its type**, collapsed as `digest:<computer>` — that frame's `alert` verbatim —
and records a drop **only when it holds no frame at all**, so the 61st event never vanishes just
because it happened to be a completion. Its digest record is a record of **deliveries**, not a second
payload class, and carries no `emit_id` of its own.

Delivered verbatim, the frame is: `alert: {title, body}` — required on `completion` and `digest` and
absent on `attention` — with the body the **house constant** (the machine's fixed sentence, never
model-written text) plus the count; `aps.alert` present and **never** `content-available`; **no
conversation handle, no completion token and no `kind`**; `apns-collapse-id` / `notification.tag` =
`digest:<computer>`, so digests never stack; `aps.badge` still never sent. The **attention** form
stays silent (`content-available`, no alert) — that difference is the point of the type, since a
coalesced catch-up delivered as an attention push would be a banner no user ever sees. `exclude` is
permitted on a digest with the attention form's meaning and is **never required** there: the required
case is the ack-triggered attention emit, and a catch-up digest has no acting device. Idempotency
follows the ADR: **one `emit_id` is minted when the window closes** and persisted, the key is
`sha256("digest" ‖ emit_id ‖ computer)`, retries reuse it, and a new window gets a new key.

**States and markers.** Five states, a marker on each row except the live and absent ones;
precedence is **revoked > unpaired > expired**, and `GET /api/push/devices` renders the
highest-precedence marker a row carries. Revocation and unpair **tombstone**: the token is dropped,
the row stays.

| State | Marker | Token | Register route | Fan-out | `list` shows |
|---|---|---|---|---|---|
| Live | none set | present | replaces it on rotation | sends | "registered, and push resumes on its next authenticated read" |
| Expired — credential lapse, rotation **or** cookie TTL | `expired_at` | present | allows | **paused** | "notifications are paused for this device until you sign in again" |
| Unpaired — durable deregistration | `unpaired_at` | dropped | refuses until a deliberate re-pair | skips | "this computer is no longer paired" |
| Revoked — machine-side or account-side | `revoked_at` | dropped | refuses | skips | "this device was revoked on this computer" |
| Absent — provider dead token, per-token revocation, or 60 days silent | none, row deleted | — | allows freely | skips | "not in this computer's registry; it may register again" |

Those five `list` strings are ADR §6's `push_devices.STATE_DESCRIPTIONS` constants verbatim — module
constants, not app copy — closed by its precedence sentence, "a device can carry more than one
marker; the strongest is shown (revoked > unpaired > expired)".

The refusal is scoped to the **device row**, not to the route's own `(install_id, platform)` key, so
a re-register after an expiry is not refused. The **absent** state is shared on purpose by the two
paths nobody decides: a provider signal (an uninstall, an OS token rotation, a restore) and the
60-day drop. Conflating either with `revoked_at` is how a legitimate re-register is lost.

**The credential limb, and which credential decides.** Delivery needs a live credential as well as a
registered device, and *which* credential decides depends on the phone's route. On the **direct
route** the app holds `lop_mobile`, whose key derives from the relay password; the relay is the only
component that sees it, so the relay **evaluates** the flag and the cloud enforces what it is told.
On the **Radient route** the edge strips `lop_mobile` and the local gateway injects it per request,
so the injected cookie **cannot tell device A from device B**: there the enforceable half is the
**cloud-issued per-device grant** — minted at registration against the `install_id` the machine's
record carries, **required for delivery** (fan-out refuses without it) and refused for a row whose
marker forbids it — and the relay's report is an auxiliary signal. Its record is **this note's to
own** — *(cloud, proposal)* — and ADR §2.2 defers to it: `grant_id`, `device_id`, the computer it
belongs to, `minted_at`, `last_refused_at`, living in the cloud's store beside the device row. It is
**refreshed** from the machine's next `credential_live` report rather than from a clock, so the
cloud re-arms it from evidence, and it is **rotated** — invalidated and re-minted at the next
registration — when an owner revokes it or when the device re-registers. **Cloud-side requirement:**
a mint and a fan-out are refused while the account's access for that computer is revoked, because on
this route a fresh `install_id` carries no marker and that is the only thing that stops a
re-installed app which can still reach the tunnel.

**Undoing a marker is a separate, machine-side act.** `POST /api/push/devices/{device_id}/unrevoke`
(`lop mobile devices unrevoke <device_id>`) requires the machine-minted `X-Lop-Operator-Key` and
answers `403 {"code": "machine_only"}` without it — a device cannot restore itself — and it **clears
`revoked_at` and `unpaired_at` — never `expired_at`** (the only two markers its `unrevoke` is
written to clear, at core's `b77fec9d4`) while restoring **no token and no credential**, so the
device must register again either way. An expired row is a different act: signing in and registering
again clears it, and the CLI says so rather than implying otherwise — "nothing to clear … it is
expired, not revoked". Re-pairing is the alternative route for an `unpaired` row, the deliberate
flow that bound the phone first, not a step that follows an un-revoke.

**What the machine sends, and how often.** The report is **change-triggered and coalesced** — at
most once per device per 5 minutes, batched for the computer's devices, **one** credential-change
event per rotation — so the cloud sees O(devices) state, never O(requests) traffic. When neither a
registration nor an emit has happened for **15 minutes**, a **heartbeat** (`POST
<cloud>/v1/push/credentials`) carries the block and nothing else: the only call that can report a
lapse to an app that is closed. The block, `devices: [{device_id, credential_live,
credential_expires_at, last_authenticated_at}]`, rides the registration forward — `POST
<cloud>/v1/push/register`, body `{computer, device{…}, devices[…]}` — and the **one emit route**
`POST /v1/tunnels/{tunnel_id}/push/events` (`Idempotency-Key`, `"v": 1`) — one route and one
spelling, because the cloud contract is `extra="forbid"`. `credential_expires_at` is **read out of
the cookie the phone presented and written at register time** (refreshed by any later authenticated
request that names its device), so the direct route's lapse is `credential_expires_at <= now`, with
no clock arithmetic. `device_key` is minted machine-side at every registration, held by the phone in
its keystore, and presented as `X-Lop-Device-Key` beside `X-Lop-Device` on any request that moves a
device's state; it never goes to the cloud. On the Radient route that only works after the gateway's
allowlist is extended: `_REQUEST_HEADERS` (`gateway.py`:310-319) carries neither header today, and
its entries are lowercase, so a mix-cased literal there would silently do nothing. Until that lands
(S4c, ADR §4 rule 2), **the design puts the route's only lock in the grant — a proposal, since the
grant itself is S7 and unbuilt**: nothing enforces it today. **A rotation evicts nothing** — the
registration survives — **but delivery stops at the rotation and resumes at each device's next
authenticated request**, and the pause is bounded at both ends: the machine's **emit worker reads
the flag and the markers and skips a device**, so a lost report cannot leave fan-out live to a dead
cookie, and the 60-day drop is the terminal state — a device that never returns becomes **absent**
and the pause ends with its row. `403 {"code": "device_revoked"}` and `403 {"code":
"device_unpaired"}` are the register refusals that make the two markers stick. Plan row **S4c**.

**Nothing stops silently where the app can say so.** For the expired state the `list` string above
is what the user reads, raised by the relay's `401` on the app's next launch. The 60-day drop is the
one silence the design accepts, because there is then no row to speak for.

**4. Owner and on-call.** Owner: the Radient platform team that owns the control plane, as a role
with a rota — the only part of the programme with a runtime commitment. When it is down, pushes
stop; the app, relay and SSE keep working and the machine's unread state is untouched. Minimum
alerts, all to `support@radienthq.com` with **no paging** — *Est.* thresholds, first tuned by the
cloud lane: oldest queue message over 5 minutes; provider rejections (excluding dead tokens) over 2%
for 15 minutes; the environment-skew class (`BadDeviceToken`, `BadEnvironmentKeyInToken`, FCM
`SENDER_ID_MISMATCH`) over 5× its 7-day baseline; schema refusals sustained; and the
**key-rejection** class (`InvalidProviderToken`, `ExpiredProviderToken`; FCM 401), the credential
itself refused and every push failing. The two classes are disjoint on purpose. **Decided:
alert-only to that address, no 24×7 page, because an outage costs timeliness and not data; the
key-rejection alert must be seen within the hour.**

**5. Keys.** The APNs `.p8` and the FCM service account live in the platform's secret store,
readable only by the worker's runtime identity, with audited break-glass; the app build needs only
the client config files, so CI holds neither. An APNs `.p8` is **team-scoped by design** — one key
sends to *any* app in that Apple Developer team — so the only scoping is `apns-topic` fixed to the
bundle id (ADR §5), and the only real isolation is a separate developer team. The FCM account *is*
scopeable, to the send role only. *Decided:* yearly rotation (or on suspicion); break-glass held by
a named platform-team member, named at deploy; the team-wide blast radius stands. Leak radius: key
*and* device tokens can send pushes that look like the app (phishing); they cannot read state or
content, reach a machine, ack, or list devices.

**6. Failure and revocation.** Cloud unreachable: the daemon keeps a bounded local queue, retries
each event with the same idempotency key three times over ~2 minutes, then **drops it with one log
line**; it never blocks a session. Ingest for a computer with no live devices returns `202` and fans
out to nobody; a caller whose tunnel credential is gone fails authentication (401) first.
Worker-to-provider is a separate bound: a dead token goes to the **absent** state above; a permanent
4xx of any other class is **not** retried either — the row gains `last_error` / `last_error_at`,
fan-out still attempts it, and a later success clears the mark; `5xx` and `429` get three attempts,
then a drop. Unpair drops the token and keeps the row as `unpaired_at`; re-pairing is deliberate,
through the same flow that bound the phone first, done on the computer, never automatic from the
phone. The account-side revoke needs no machine. **Of the markers, the register refusals and
`device_key` — all specified in ADR 0006 (#14) — core has implemented the refusals, `device_key` and
a writer for `revoked_at` only (#1864, merged as `813c6bf89`; #1878, `37ab4ed`); the writers for
`expired_at` and `unpaired_at`, the credential-live report, the heartbeat, `credential_expires_at`
and the emit-side skip that reads the markers are S10/S4c and unbuilt.** What the ADR does not carry
at all — and so is this note's proposal — is `last_error` / `last_error_at` and §3's digest record.
Decided: "a nudge, never a guarantee"; both retry bounds (daemon→cloud, worker→provider) are the
launch proposal, and measuring them is the cloud lane's first task.**
