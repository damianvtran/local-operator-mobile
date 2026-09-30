# Push and cross-surface acknowledgement — slice plan

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md), which carries the decisions and the
reasons. This file is the *work*: what is built, in which repository, by whom, in what order,
and what proves each slice done.

Owners are the three sides named in the ADR: **app** = this repository;
**daemon-core** = `damianvtran/local-operator` (`local_operator/mobile/**`,
`local_operator/session/attention.py`, `local_operator/notifications/**`); **cloud** =
Radient (control plane, gateway, console) — an interface we specify and do not implement.

Sizes: **S** ≈ a day or two, **M** ≈ a week, **L** ≈ more, with an unknown tail. They are
the ADR §7 numbers, not re-derived.

**Blocked on the operator, before any cloud work starts:**
- **A8 — Radient account deletion** (`docs/publishing/checklist.md`:33), already blocking
  store submission.
- **A2–A4 — organisation developer accounts** (D-U-N-S, Apple Developer Program as Radient
  Inc., Play organisation account).
- **New, from this plan: the push credentials and the fan-out service.** An APNs `.p8` key
  and an FCM service account, an always-on fan-out service with an owner, and a device-token
  store. This is a *runtime* commitment, unlike A8, and it is the true critical path.

---

## Slice table

| ID | Slice | Repo | Size | Depends on | Exit criteria (what proves it done) |
|---|---|---|---|---|---|
| **S1** | Aggregate unread read: `GET /api/attention/unread` returning `{count, revision, degraded, conversations[]}` | daemon-core | S | — | Route tested against a store with 0, 1 and *n* unread conversations; a conversation with 3 unread completions counts once; `degraded: ["attention"]` when the store cannot be read and `count` then absent rather than 0; no write on the read path (`mode=ro`, the store's own rule `attention.py:1541-1580`) |
| **S2** | Badge count on the listing: the existing `capabilities` block (`daemon.py:3528-3530`) gains the count so frames the app already parses carry it | daemon-core | S | S1 | The list payload carries it; absence on an older relay means "unknown", never 0 (the established absence rule, `docs/relay/contract.md`:203-204) |
| **S3** | Device registry: `POST /api/push/register`, `DELETE /api/push/devices/{id}`, durable record under the config root (0600) | daemon-core | S–M | — | Idempotent on `(install_id, platform)`; a rotated token replaces and keeps the `device_id`; deregistration removes it; a corrupt record is refused, not repaired; nothing in the store is an authority for unread state |
| **S4** | Push worker: poll the store's equality token, apply the §2.3 gates, emit outbound with `Idempotency-Key` | daemon-core | M | S1, S3 | **Tested against a stub control plane**: a completion with `unseen` + `notify` and no local presence emits exactly one event; a suppressed one emits zero *and leaves `unseen` true*; the `claim_delivery` watermark is untouched (assert `deliveries` before/after); a cloud 500/offline neither stalls a turn nor grows unbounded (bounded queue, drop, one log line) |
| **S5** | Freeze the cloud interfaces: §3.1's two routes and §3.2's payload, with refusal shapes and `extra="forbid"` | all three | S | S4 | A written contract both sides build against, with the payload field table as the allow-list; a test fixture per shape in this repository's `fixtures/` (ADR 0003's pattern) |
| **S6** | Attention-change emit: an ack on any surface calls the cloud with `type: "attention"` so the account's other devices correct their badges | daemon-core | S | S5 | A `/seen` on the relay produces exactly one attention call, keyed by the ack, and no call when the token was refused |
| **S7** | Cloud: ingest (idempotent), fan-out to APNs/FCM, per-account and per-computer routing, delivery record, revocation | cloud | **L** | S5, the operator items above | A completion event fans out to exactly the account's devices for that computer; a retried event with the same key does not double-push; a revoked device's token is deleted on `410`/`UNREGISTERED`; the record names the per-device result |
| **S8** | App: `expo-notifications` config plugin, entitlements, Android channel, permission prompt, token registration (S3), badge reconciliation, FOSS flavour gating | app | M–L | S3, S5 | Foreground/background/killed delivery each demonstrated with a real push on both platforms; the badge equals `/api/attention/unread`'s `count` after every state change; the FOSS build compiles push out and keeps SSE + local notifications |
| **S9** | App: deep-link resolution and the §6 navigation contract (composer home, cold-start override, consume-once, not-yet-connected, unknown conversation) | app | M | S8 | The six cases in ADR 0006 §6 each demonstrated on a real device or simulator, including a cold start from a killed app and a handle for a conversation the device has never seen |
| **S10** | Settings: the notification surface and the honest copy for both routes (ADR 0006 §2.4), with the toggle states and their reasons | app | S–M | S8 | Design round on rendered screens (light/dark, phone size) covering: Radient route granted, Radient route denied at OS level, no paired computer, self-hosted route, quiet hours; copy reviewed as rendered text, not as source |
| **S11** | Store-submission inputs: the push entitlement on the App ID and profile, the APNs key and FCM service account as CI/cloud secrets, no `google-services.json` in the public tree | app + cloud | S | S8 | A TestFlight build that receives a real push; CI fails loudly if the credential is absent rather than producing a build that silently cannot notify |

---

## Order, and why

```
S1 ── S2        (useful alone: the in-app count, no push, no cloud)
S3 ── S4 ── S5 ── S6 ───────────────┐
                    │                │
                    ├── S7 (cloud, blocked on operator items)
                    └── S8 ── S9, S10, S11
```

1. **S1 and S2 ship first and alone.** They need no cloud, no credential, and no decision
   from anyone outside the core, and they improve the app the moment they land. If every
   other slice stops here, the badge rule the operator asked for is already honest.
2. **S3–S5 prove the mechanism with no Radient dependency**, because S4 is tested against a
   stub. This is the deliberate hedge against the blocked items: the design is exercised
   before the cloud exists, and if the cloud never ships, the work has still produced a
   working device registry and a measured eligibility rule rather than a plan.
3. **S7 is the only slice we cannot do ourselves**, and it is the critical path.
4. **S8–S11 are conventional but the widest diff**, and S9/S10 carry the parts a reviewer
   must actually look at (rendered frames; a real cold-start tap) rather than read.

## QA matrix this plan asks for

Written for the independent QA pass, per the operator's permutation list. Each row names
the *state of the app*, the *state of the other surfaces*, and what must be observed.

| # | App state | Other surfaces | Action | Expected |
|---|---|---|---|---|
| Q1 | foreground, SSE live | TUI running, desktop focused | a turn finishes in session B while the app shows A | no desktop banner (rung 1/2 as today), no push (presence gate), the app's own count rises from its SSE frame |
| Q2 | foreground, SSE live | desktop not running, no TUI | a turn finishes | app count rises; badge is the machine's count; **no push to this device** (it is watching nothing, but it is running — either behaviour is acceptable and must be *stated*, not discovered) |
| Q3 | backgrounded | — | a turn finishes | one alert push; badge = count; tapping deep-links to B and acks only after the row renders |
| Q4 | killed (force-quit, iOS) | — | a turn finishes, then the user taps | app cold-starts, resolves the deep link before the composer commits, opens B, renders, acks; the badge clears |
| Q5 | backgrounded | device B backgrounded on the same machine | device A acks B's conversation | B receives the silent attention push and its badge drops without a banner |
| Q6 | in flight | — | an ack lands while a push for the same completion is being sent | at most one arrives; if it arrives, tapping it changes nothing (already read) and the app does not re-ack or re-badge |
| Q7 | foreground | another surface acked seconds ago | app resumes/refetches | count and marks match the machine exactly; no ghost badge; no un-cleared mark |
| Q8 | any | machine's store unreadable | app reads unread | count is *absent*, the app says it cannot check, and the badge is left alone — never 0 |
| Q9 | self-hosted route | — | a turn finishes while the app is backgrounded | **no push, by design**; Settings states why, in the reviewed copy; on foreground the count and marks are correct |
| Q10 | ack for a superseded token | — | app acks with a stale token | 409 `superseded_completion_token`; the app re-reads and retries with the current token; the mark clears |

## Not in this plan

- **Pending `ask`/`approval` pushes.** Gates have no durable, ackable identity today, and
  the ack contract is completion-token-bound (ADR 0006 §1, §9). Follow-up, once the core's
  gate lifecycle has a durable row.
- **Cross-machine unread merge.** An explicit operator decision, then a new ADR (ADR 0006
  §1.5).
- **A BYO push gateway for self-hosted users.** Its own product (ADR 0006 §2.4, §9).
- **STT** and the composer's data path: a parallel workstream, deliberately untouched
  (ADR 0006 §6).
