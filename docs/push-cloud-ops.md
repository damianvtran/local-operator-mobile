# Push — cloud slice ops note

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md) (binding, not re-argued here) and
[push-plan.md](push-plan.md) slice S7. **Status: proposal for the programme owner.** *Est.* figures are assumptions;
Radient's code was not available, so Radient-side statements are "expected, confirm".

**1. What it does.** A machine's daemon sends one authenticated outbound event. The service
finds the devices registered for that account and computer, sends to APNs and FCM, and records
the per-device result. It holds device tokens, routing, delivery records and two credentials.
It holds no transcript, name, session id or read state (ADR §2.2). Enforced twice: the machine's push
builder composes only house sentences and opaque handles, and ingest refuses fields outside
the ADR §3.2 table (`extra="forbid"`), so a daemon sending a name is rejected, not stored. **Decision: the field table is the
contract; a new field is an ADR amendment.**

**2. Who hosts it.** Expected home: the Radient control plane (agent-server behind
`api.radienthq.com`). The connector already authenticates there and `account_id` resolves there. Ingest is one route
(`POST /v1/tunnels/{id}/push/events`) that validates, enqueues and returns `202`. A
queue-consuming worker does all APNs/FCM traffic. No new public host, no inbound path to machines. The alternative is a standalone service, for example a Cloudflare Worker
plus Queue. Quicker to stand up, but it re-implements connector authentication and the account-to-tunnel
lookup: a second copy of a security boundary. **Decision: host in
the control-plane environment; standalone only if the owner refuses the coupling.**

**3. Cost.** FCM is free. APNs rides the Apple Developer membership the App Store already
needs. The real cost is the worker's always-on replicas and their observability. *Est.:* 1,000
users × ~100 completions/day × ~2 devices is ~200k sends/day (~2-3/s, bursty): two small
replicas (0.25 vCPU / 512 MB) plus a managed queue, ~40 MB/day of delivery records. Biggest lever: **retain delivery records 14 days and drop devices unseen
for 60**. Second lever: a per-computer fan-out ceiling (proposed 60 events/hour, excess
coalesced into one digest, as the machine already does past `BURST_LIMIT`). **Decision: ship
both limits at launch; they are cheaper to loosen than to add.**

**4. Owner and on-call.** Owner: the Radient platform team that owns the control plane,
expected as a role with a rota, not a person. This is the only part of the programme with a
runtime commitment. When it is down, pushes stop. The app, relay and SSE keep working and the
machine's unread state is untouched. Minimum alerts: oldest queue message over 5 minutes; provider rejections (excluding dead
tokens) over 2% for 15 minutes; token invalidations over 5× the 7-day baseline (a
sandbox/production mix-up); sustained schema refusals (a daemon sending something forbidden). **Decision: business-hours
response, no 24×7 page, because an outage costs timeliness and not data. The exception is a
credential rejection (APNs 403 / FCM 401), which means every push is failing.**

**5. Keys.** The APNs `.p8` and the FCM service account live in the platform's existing
secret store, readable only by the worker's runtime identity, with audited break-glass.
The app build needs only the client config files, never these two, so CI holds neither. Scope them: the
APNs key to the app's bundle id, the FCM account to the send role only. Rotation, yearly
or on suspicion: create a second key, deploy the worker accepting both, confirm sends on the
new one, then revoke the old (Apple permits two active keys). Leak blast radius: a holder of
the key *and* device tokens can send pushes that look like the app, which is a phishing risk.
They cannot read state or content, reach a machine, ack, or list devices. **Decision: owner confirms the yearly cadence
and who holds break-glass.**

**6. Failure and revocation.** Cloud unreachable: the daemon keeps a bounded queue, retries
each event with the same idempotency key a bounded number of times, then **drops it with one
log line**. It never blocks a session. The badge is correct on the app's next read regardless. An event for an unregistered computer or
a computer with no devices gets `200`, an empty result, and no retry. A dead token (APNs
`410`, FCM `UNREGISTERED`) deletes the registration immediately and is never retried. `5xx`
and `429` get three attempts over ~2 minutes, then a drop. Unpair: the relay deregisters every
device bound to that computer, the cloud deletes each token and its delivery rows, and the app
shows "revoke pending" until the cloud confirms. The account-side revoke needs no machine.
**Decision: "a nudge, never a guarantee" is the delivery promise; owner confirms the retry
bound.**
