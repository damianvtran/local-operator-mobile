# Push — cloud slice ops note

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md) (binding, not re-argued here) and
[push-plan.md](push-plan.md) slices **S7** (cloud) and **S10/S11** (deregistration, credential
inputs). **Proposal for the programme owner.** *Est.* figures are assumptions; Radient's code
was unavailable, so its statements say "expected, confirm".

**1. What it does.** A machine's daemon sends one authenticated outbound event; ingest
validates it, writes it to a **durable queue** and answers `202 {emit_id, accepted_at}` at
once; a worker fans it out to the devices registered for that account and computer via APNs
and FCM, recording each outcome in the delivery record rather than the response — **this note
replaces ADR §3.1's synchronous per-device reply on this route** — and the daemon never blocks,
queueing locally with its cursor. It holds only device tokens, routing, delivery records and
two credentials — no transcript, name, session id or read state (ADR §2.2). The one disclosed
exception is `count`, the unread number at composition (ADR §3.2). Ingest refuses fields
outside the ADR §3.2 table (`extra="forbid"`), so a daemon sending a name or a read-state
field is rejected, not stored, and the machine's builder composes only house sentences. **Decision: the field table is the contract; a new field is an
ADR amendment.**

**2. Who hosts it.** Expected home: the Radient control plane (agent-server behind
`api.radienthq.com`), where the connector already authenticates and `account_id` resolves. The
design is ingest route → durable queue → worker → providers: one route
(`POST /v1/tunnels/{id}/push/events`) that validates and enqueues, and a queue-consuming worker
doing all provider traffic — no new public host, no inbound path to machines. A standalone service
(say Cloudflare Worker plus Queue) saves setup but re-implements connector auth and routing, a
second copy of a security boundary. **Decision: control-plane
environment; standalone only if the owner refuses the coupling.**

**3. Cost.** FCM is free and APNs rides the Apple Developer membership the App Store already
needs, so the cost is the worker's replicas and their observability — *est.* two small replicas plus a
managed queue. Two levers, both shipped at launch: **delivery records kept 14 days**, and **a device dropped after 60 days with no authenticated
request** — "last seen" is the device's last authenticated call (the app reads unread on
launch, foreground, connect), not its last delivery — a re-register being accepted, so the drop
is a tombstone, not a ban. Honest consequence: it stops receiving pushes silently until it next
opens the app, and Settings cannot show it, because pairing lives on the machine; the copy, if
we ever tell the user, is "push may resume the next time this device opens the app". Behind
that stands a per-computer ceiling of 60 events/hour, the excess **merged into one digest
emit** rather than dropped (as the machine's cursor coalesces a catch-up burst, ADR §2.1), the
digest's record naming the emits it covers.

**4. Owner and on-call.** Owner: the Radient platform team that owns the control plane, as a
role with a rota, not a person — the only part of the programme with a runtime commitment. When
it is down, pushes stop; the app, relay and SSE keep working and the machine's unread state is
untouched. Minimum alerts: oldest queue message over 5 minutes; provider rejections (excluding
dead tokens) over 2% for 15 minutes; a `BadDeviceToken` / `BadEnvironmentKeyInToken`-class (FCM
`SENDER_ID_MISMATCH`) rate over 5× its 7-day baseline — what a sandbox/production mix-up
produces, not a token invalidation; any sustained schema refusals. **Decision: business-hours
response, no 24×7 page, because an outage costs timeliness and not data; the exception is a
credential rejection (APNs 403 / FCM 401), where every push is failing.**

**5. Keys.** The APNs `.p8` and the FCM service account live in the platform's secret store,
readable only by the worker's runtime identity, with audited break-glass. The app build needs
only the client config files, so CI holds neither. Scoping, exactly: an APNs
`.p8` is **team-scoped by design** — one key sends to *any* topic (any app) in that Apple
Developer team — so the only scoping is `apns-topic` fixed to the bundle id (ADR §5), and the
only real isolation is a separate developer team for this app, the trade if team-wide blast
radius is unacceptable. The FCM account *is* scopeable, to the send role only. Rotation (yearly
or on suspicion): create a second key, deploy accepting both, confirm it sends, revoke the old
— Apple permits two. Leak radius: key *and* device tokens can send pushes that look like the
app (phishing); they cannot read state or content, reach a machine, ack, or list devices.
**Decision: owner confirms the yearly cadence, who holds break-glass, and whether the team-wide
blast radius stands.**

**6. Failure and revocation.** Cloud unreachable: the daemon keeps a bounded local queue,
retries each event with the same idempotency key a bounded number of times (three, over ~2
minutes), then **drops it with one log line**; it never blocks a session, and the badge is right
on the app's next read. Ingest for a computer with no live devices — the reachable form of
"unknown" — returns `202` and fans out to nobody; a caller whose tunnel credential is gone
fails authentication (401) before this route, so there is no `200`-to-nobody branch.
Worker-to-provider is a separate bound: a dead token (APNs `410`, FCM `UNREGISTERED`) deletes
the registration and is never retried; a permanent 4xx of any other class (`BadDeviceToken`,
`BadEnvironmentKeyInToken`, `SENDER_ID_MISMATCH`) is **not** retried either: it marks the device's
record with the refusing reason and alerts. `5xx` and `429` get three attempts over ~2 minutes,
then a drop. Unpair: the relay deregisters that computer's devices; the cloud deletes their
tokens and rows, and the app shows "revoke pending" until confirmed. **Decision: "a nudge, never a guarantee" is the delivery promise;
owner confirms both retry bounds (daemon→cloud and worker→provider).**
