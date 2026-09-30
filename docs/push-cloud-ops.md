# Push — cloud slice ops note

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md) (binding, not re-argued here) and
[push-plan.md](push-plan.md) slices **S7** (cloud), **S10/S11** (deregistration, credential inputs)
and **S4c** (credential-live reporting). **Owner decisions of 2026-09-30 are folded in below, marked
*Decided*; the sizing stays *Est.* for the cloud lane to measure, and Radient-side behaviour stays
"expected, confirm".**

**The decided set, in one read.**
- **Hosting:** the Radient control plane; a standalone Worker is considered and rejected (§2).
- **Launch limits:** 14-day delivery records; a 60-day expiry drop; 60 events/hour per computer, the
  excess coalesced into one digest (§3).
- **Delivery promise:** a nudge, never a guarantee; delivery needs a registered device *and* a live
  credential (§3, §6).
- **On-call:** alert-only to `support@radienthq.com`, no paging; a key rejection must be seen within
  the hour (§4).
- **Keys:** yearly rotation, a named break-glass holder, and the team-wide APNs blast radius standing,
  with a separate developer team the only real isolation (§5).
- **Owed to ADR 0006:** the three row markers, the register check, and the two record additions (§3, §6).

**1. What it does.** A machine's daemon sends one authenticated outbound event; ingest validates it,
writes it to a **durable queue** and answers `202 {emit_id, accepted_at}` — **ADR §3.1 already
returns that shape, so this note restates it** — and a worker fans out to the devices registered for
that account and computer via APNs and FCM, recording each outcome in the delivery record rather
than the response. The daemon never blocks: it queues locally with its cursor. The service holds
device tokens, routing, delivery records and the two provider credentials, and nothing else — no
transcript, name, session id, read state or unread count (ADR §2.2); the one field it **sees and
does not hold** is `count`, the unread number at composition (ADR §3.2). Ingest refuses fields
outside the ADR §3.2 table (`extra="forbid"`), and the machine's builder composes only house
sentences. **Proposal: the field table is the contract; a new field is an ADR amendment.**

**2. Who hosts it.** *Decided:* the Radient control plane (agent-server behind `api.radienthq.com`),
where the connector already authenticates and `account_id` resolves. The design is ingest route →
durable queue → worker → providers: one route (`POST /v1/tunnels/{id}/push/events`) that validates
and enqueues, a queue-consuming worker doing all provider traffic — no new public host, no inbound
path to machines. The standalone alternative (a Cloudflare Worker plus Queue) is **considered and
rejected**: it would duplicate connector authentication and the account→tunnel lookup.

**3. Cost.** FCM is free and APNs rides the Apple Developer membership the App Store already needs,
so the cost is the worker's replicas and their observability — *est.* two small replicas plus a
managed queue. Three limits, *Decided* for launch: **delivery records kept 14 days**; **a device
dropped after 60 days with no authenticated request** — "last seen" is the device's last
authenticated call (it reads unread on launch, foreground, connect), not its last delivery; and **60
events/hour per computer**, the excess merged into **one digest emit**, the attention form
(`content-available`, `count` only, no conversation), its emit ids in a cloud-side digest record,
beside the machine's §2.1 coalescer.

**States and markers.** Each durable state carries **its own marker** on the device row; precedence
is **revoked > unpaired > expired**, and the register route, fan-out and `list` each read it.
Revocation **tombstones**: the token is dropped, the row stays.

| State | Marker | Register route | Fan-out | `list` shows |
|---|---|---|---|---|
| Revoked — machine-side, account-side, per-token | `revoked_at` | refuses | skips | "revoked" |
| Unpaired — durable deregistration | `unpaired_at` | refuses until a deliberate re-pair | skips | "this computer is no longer paired" |
| Expiry — the 60-day drop | `expired_at` | allows | skips until it re-registers | "push resumes when this device next opens the app" |
| Dead token — APNs `410`, FCM `UNREGISTERED` | none | allows | skips | "token expired — it will re-register" |

The dead-token row is **cleanup, not revocation**: it fires on a provider signal (an uninstall, an
OS token rotation, a restore) and must **not** set a refusal marker — conflating it with
`revoked_at` is how a legitimate re-register is lost.

**Delivery also needs a live credential, and the relay is what holds it.** The cloud holds no device
credential and fan-out never calls the relay, so this limb is carried by signal, not by a lookup:
the **relay**, the only component that sees the `lop_mobile` cookie, reports a per-device
**credential-live** flag on each authenticated request and the cloud row owns it, while the
machine's daemon emits a **credential-change event** when a rotation kills the cookies, which pauses
fan-out for that computer's devices. **A rotation evicts nothing** — the registration survives, no
marker is set — **but delivery stops at the rotation and resumes at each device's next authenticated
request**, which a stolen phone, lacking the new password, cannot make. Plan row **S4c**; the ADR
will carry it too.

**Nothing stops silently where the app can say so.** After credential death — a rotation, or plain
cookie TTL — the relay answers `401` on the app's next launch and the app says "notifications are
paused; sign in again to resume". After the 60-day drop it cannot be told, because pairing lives on
the machine.

**4. Owner and on-call.** Owner: the Radient platform team that owns the control plane, as a role
with a rota — the only part of the programme with a runtime commitment. When it is down, pushes
stop; the app, relay and SSE keep working and the machine's unread state is untouched. Minimum
alerts, all to `support@radienthq.com` with **no paging** — *Est.* thresholds, first tuned by the
cloud lane: oldest queue message over 5 minutes; provider rejections (excluding dead tokens) over 2%
for 15 minutes; the environment-skew class (`BadDeviceToken`, `BadEnvironmentKeyInToken`, FCM
`SENDER_ID_MISMATCH`) over 5× its 7-day baseline; schema refusals sustained; and the
**key-rejection** class (`InvalidProviderToken`, `ExpiredProviderToken`; FCM 401), where the
credential itself is refused and every push is failing. The two classes are disjoint on purpose.
**Decided: alert-only to that address, no 24×7 page, because an outage costs timeliness and not
data; the key-rejection alert must be seen within the hour.**

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
Worker-to-provider is a separate bound: a dead token goes to the dead-token state above; a permanent
4xx of any other class is **not** retried either — the row gains `last_error` / `last_error_at`,
fan-out still attempts it, and a later success clears the mark; `5xx` and `429` get three attempts,
then a drop. Unpair tombstones the rows, and re-pairing is deliberate: the phone is paired to that
computer again through the same flow that bound it first, done on the computer, never an automatic
re-registration from the phone. The account-side revoke needs no machine. **Everything here that ADR
0006 does not yet carry — the two record additions, the three markers and the register check — lands
as one ADR amendment. Decided: "a nudge, never a guarantee"; both retry bounds (daemon→cloud,
worker→provider) are the launch proposal, and measuring them is the cloud lane's first task.**
