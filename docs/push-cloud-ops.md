# Push — cloud slice ops note

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md) (binding, not re-argued here) and
[push-plan.md](push-plan.md) slices **S7** (cloud) and **S10/S11** (deregistration, credential
inputs). **Owner decisions of 2026-09-30 are folded in below, marked *Decided*; the sizing stays
*Est.* for the cloud lane to measure, and Radient-side behaviour stays "expected, confirm".**

**The decided set, in one read.** *Decided:* hosting is the Radient control plane, with a
standalone Worker considered and rejected; the launch limits are 14-day delivery records, a 60-day
expiry drop, and 60 events/hour per computer with the excess coalesced into one digest; push is a
nudge and never a guarantee, and delivery needs **both a registered device and a live credential**;
on-call is alert-only to `support@radienthq.com` with no paging, with yearly rotation and a named
break-glass holder; and **revocation tombstones the device row** while the register route consults
`revoked_at` — the ADR amendment this note owes (§6).

**1. What it does.** A machine's daemon sends one authenticated outbound event; ingest validates
it, writes it to a **durable queue** and answers `202 {emit_id, accepted_at}`; a worker fans out to
the devices registered for that account and computer via APNs and FCM, recording each outcome in
the delivery record rather than the response — **this note replaces ADR §3.1's synchronous
per-device reply on this route** — and the daemon never blocks, queueing locally with its cursor.
It holds only device tokens, routing, delivery records and two credentials — no transcript, name,
session id, read state or unread count (ADR §2.2). The one field it **sees and does not hold** is
`count`, the unread number at composition (ADR §3.2). Ingest refuses fields outside the ADR §3.2
table (`extra="forbid"`), so a daemon sending a name or a read-state field is rejected, not stored,
and the machine's builder composes only house sentences. **Proposal: the field table is the
contract; a new field is an ADR amendment.**

**2. Who hosts it.** *Decided:* the Radient control plane (agent-server behind
`api.radienthq.com`), where the connector already authenticates and `account_id` resolves. The
design is ingest route → durable queue → worker → providers: one route
(`POST /v1/tunnels/{id}/push/events`) that validates and enqueues, and a queue-consuming worker
doing all provider traffic — no new public host, no inbound path to machines. The standalone
alternative (say Cloudflare Worker plus Queue) is **considered and rejected**: it would duplicate
connector authentication and the account→tunnel lookup, a second security boundary.

**3. Cost.** FCM is free and APNs rides the Apple Developer membership the App Store already needs,
so the cost is the worker's replicas and their observability — *est.* two small replicas plus a
managed queue. Three limits, *Decided* for launch: **delivery records kept 14 days**; **a device
dropped after 60 days with no authenticated request** — "last seen" is the device's own last
authenticated call (the app reads unread on launch, foreground, connect), not its last delivery;
and **60 events/hour per computer, the excess merged into one digest emit** — the **attention
form** (`content-available`, `count` only, no conversation), the covered emit ids in a cloud-side
digest record beside the delivery rows, a second coalescer rather than a reuse of the machine's
§2.1 one.

**Revocation, in state terms, because the paths behave differently.** Delivery to a device
requires **both a registered device and a live credential for it**, so a password rotation — which
kills the relay cookie — stops delivery until that device re-authenticates under the new password,
which a stolen phone, lacking it, cannot do. Beyond that:

- **Revoked — tombstoned.** Machine-side revocation, account-side revocation and server-side
  per-token revocation set `revoked_at`, **dropping the token and keeping the row**; re-registering
  a revoked device is **refused**.
- **Dead token — cleanup, not revocation.** Dead-token deletion (APNs `410`, FCM `UNREGISTERED`),
  the server-side path's second half, fires on a **provider** signal — an uninstall, an OS token
  rotation, a restore — so it must **not** set the marker: the row goes tokenless and the device
  **may** re-register. Conflating it with the case above is how a legitimate re-register is lost.
- **Expiry drop — tombstoned, and free to re-register.** 60 days with no authenticated request
  drops the device, and only then does re-registering stand: the app says "notifications are off
  for this device" (the "turn them back on" half lands with the account-side device list ADR §7
  defers). Honest consequence: pushes stop silently until the app next opens, and Settings cannot
  show it, because pairing lives on the machine.
- **Unpair — durable, and not a revocation.** Unpairing must **tombstone** the affected rows
  rather than delete them, or the device's next authenticated request silently re-registers it.
  Re-pairing is deliberate, and the app says "this computer is no longer paired" — not "revoke
  pending", which belongs to the two marker-setting paths.

Neither rotation nor unpair sets `revoked_at`, because both must stay recoverable without the
account console — but neither is an eviction: rotation leaves delivery live until a real revoke
runs, and unpair stops delivery durably by the tombstone above. **The register route must
consult `revoked_at`, and the row must persist for there to be anything to consult** — the refusal
is scoped to the device row, not to the register route's own `(install_id, platform)` key.

**4. Owner and on-call.** Owner: the Radient platform team that owns the control plane, as a role
with a rota, not a person — the only part of the programme with a runtime commitment. When it is
down, pushes stop; the app, relay and SSE keep working and the machine's unread state is untouched.
Minimum alerts, all to `support@radienthq.com` with **no paging** — *Est.* thresholds, first tuned
by the cloud lane: oldest queue message over 5 minutes; provider rejections (excluding dead tokens)
over 2% for 15 minutes; the environment-skew class (`BadDeviceToken`, `BadEnvironmentKeyInToken`,
FCM `SENDER_ID_MISMATCH`) over 5× its 7-day baseline — what a sandbox/production mix-up produces;
any sustained schema refusals; and the **key-rejection** class (`InvalidProviderToken`,
`ExpiredProviderToken`; FCM 401), where the credential itself is refused and every push is failing.
The environment-skew class and the key-rejection class are disjoint on purpose: a key rejection is
never folded into the mix-up rate. **Decided: alert-only to that address for now, no 24×7 page,
because an outage costs timeliness and not data; the key-rejection alert must be seen within the
hour.**

**5. Keys.** The APNs `.p8` and the FCM service account live in the platform's secret store,
readable only by the worker's runtime identity, with audited break-glass. The app build needs only
the client config files, so CI holds neither. Scoping: an APNs `.p8` is **team-scoped by design** —
one key sends to *any* app in that Apple Developer team — so the only scoping is `apns-topic` fixed
to the bundle id (ADR §5), and the only real isolation is a separate developer team. The FCM
account *is* scopeable, to the send role only. *Decided:* yearly rotation (or on suspicion);
break-glass held by a named platform-team member, named at deploy; the team-wide blast radius
stands, with a separate developer team as the escape hatch. Leak radius: key *and* device tokens
can send pushes that look like the app (phishing); they cannot read state or content, reach a
machine, ack, or list devices.

**6. Failure and revocation.** Cloud unreachable: the daemon keeps a bounded local queue, retries
each event with the same idempotency key a bounded number of times (three, over ~2 minutes), then
**drops it with one log line**; it never blocks a session, and the badge is right on the app's next
read. Ingest for a computer with no live devices — the reachable form of "unknown" — returns `202`
and fans out to nobody; a caller whose tunnel credential is gone fails authentication (401) first,
so there is no `200`-to-nobody branch. Worker-to-provider is a separate bound: a dead token (APNs
`410`, FCM `UNREGISTERED`) drops the token and leaves the row tokenless — the cleanup state above,
where re-registering is allowed; a permanent 4xx of any other class (`BadDeviceToken`,
`BadEnvironmentKeyInToken`, `SENDER_ID_MISMATCH`) is **not** retried either: the row gains
`last_error` / `last_error_at`, fan-out still attempts it, and a later success clears the mark — a
misconfigured environment is not a dead token; `5xx` and `429` get three attempts over ~2 minutes,
then a drop. Unpair: the relay tombstones that computer's devices, the cloud drops their tokens and
keeps their rows, the app shows "this computer is no longer paired", and **the account-side revoke
needs no machine**, which is why it is the remedy for a phone that is gone. **The `last_error`
fields, §3's digest record, revocation-as-tombstone and the register route's `revoked_at` check are
this note's additions to ADR §2.2's record set and its register contract, to land as one ADR
amendment.** **Proposal: "a nudge, never a guarantee"; both retry bounds (daemon→cloud,
worker→provider) are the launch proposal, and measuring them is the cloud lane's first task.**
