# Push and cross-surface acknowledgement — slice plan

Companion to [ADR 0006](adr/0006-push-and-ack-sync.md), which carries the decisions and the
reasons. This file is the *work*: what is built, in which repository, by whom, in what order,
and what proves each slice done.

Owners: **app** = this repository; **daemon-core** = `damianvtran/local-operator`
(`local_operator/mobile/**`, `local_operator/session/attention.py`,
`local_operator/notifications/**`); **cloud** = Radient (control plane, gateway, console) — an
interface we specify and do not implement. Every cloud route in this plan is a **proposal**,
marked as such wherever it appears; no Radient repository was available to read. **The cloud
lane's own note is [`docs/push-cloud-ops.md`](push-cloud-ops.md)** (PR
[#15](https://github.com/damianvtran/local-operator-mobile/pull/15), open — the link resolves
once it merges), and the two documents are reconciled on the ingest shape: the machine's call
answers **`202 {emit_id, accepted_at}`**, accepted and queued, and a per-device result is never
returned to the machine (ADR §3.1).

Sizes: **S** ≈ a day or two, **S–M**/**M**/**L** as used in the ADR §7. They are those
numbers, not re-derived.

**Blocked on the operator, before any cloud work starts:**
- **A8 — Radient account deletion** (`docs/publishing/checklist.md`:33), already blocking
  store submission.
- **A2–A4 — organisation developer accounts** (D-U-N-S, Apple Developer Program as Radient
  Inc., Play organisation account).
- **New, from this plan: the push credentials, the fan-out service, and a device-revocation
  surface in the console.** An APNs `.p8` key and an FCM service account, an always-on fan-out
  service with an owner and an on-call story, and a way for a user to revoke a device without
  access to the device (ADR 0006 §4, the stolen-phone case). This is a *runtime* commitment,
  unlike A8, and it is the critical path.

---

## Slice table

| ID | Slice | Repo | Size | Depends on | Exit criteria (what proves it done) |
|---|---|---|---|---|---|
| **S1** | Aggregate read + badge population + the list field: `GET /api/attention/unread` and a top-level `unread` block on the list payload, **one implementation** behind both | daemon-core | S | — | `count` equals the number of `unseen` rows in the `GET /api/sessions` body captured in the same pass (the equality test, ADR §1.2); the same assertion for the list payload's `unread.count`; population excludes `agent/<id>`, subagent-only and scheduled origins and rows with no directory; a conversation with 3 unread completions counts **once**; `degraded: ["attention"]` ⇒ `count` **absent**, never 0; the read path opens `mode=ro` and writes nothing (`attention.py:1541-1580`) |
| **S2** | Conversation handle: mint (machine-local HMAC, 0600 key), scope, `push_handle` on the aggregate's rows **and** the listing's rows, and `GET /api/push/conversation/{handle}` | daemon-core | S | — | A handle resolves to its session id; an unknown handle (stale key, deleted conversation) is a clean 404, never a 500; handles are stable across a daemon restart and differ between two config roots; a key rotation invalidates old handles and is a documented (not silent) operation |
| **S3** | **Freeze the interfaces** (§3.1 relay shapes, §3.2 payload, §3.4 keys, §4 refusals), with a fixture per shape in `fixtures/` (ADR 0003's pattern) | all three | S | **S1, S2** | A written contract both sides build against; the payload field table is the allow-list, with `extra="forbid"` on the cloud side; **it does not depend on S4/S5** (review M11) |
| **S4** | Device registry: `POST /api/push/register`, `GET /api/push/devices`, `DELETE /api/push/devices/{id}`; durable record under the config root (0600); **no push token stored on the machine** | daemon-core | S–M | — | Idempotent on `(install_id, platform)`; a rotated token keeps the `device_id`; `DELETE` works for **any** device in the registry, not only the caller (the stolen-phone case, ADR §4); the record holds no token (assert it); a corrupt record is refused, not repaired |
| **S5** | Push worker in the mobile daemon: **two durable cursors** (publications + supersedes) with a baseline at enablement, the acknowledgement-map diff, the §2.3 gates, the **presence deferral**, bounded coalesced catch-up, a bounded local queue whose **cursor advances only on the cloud's accept** (`202`) emit queue | daemon-core | M | S1–S4 (tested against a **stub** control plane) | A completion that is `unseen` + `notify` + no presence emits exactly once; a suppressed one is **deferred then emitted** (or terminated by an ack) and never dropped silently; a restart neither re-pushes the backlog nor drops what landed while down (the cursor test); a catch-up above the burst limit emits **one digest**; a cloud 5xx neither stalls a turn nor grows unbounded; `deliveries` is untouched before/after (assert it) |
| **S6** | Attention emit: **structural detection** on the existing `revision()` loop (`revision()` equality as the trigger, then `acknowledgement_map()` and the supersede cursor say which conversation moved), the `/seen` nudge path that **consumes the change**, `device_id` on the ack, and `exclude` on the attention emitking device | daemon-core | S | S5 | An ack from the **TUI** or the **desktop** (which never touch the relay) still produces exactly one attention emit — this is the "clear it on the desktop and the phone drops it" scenario (review M4); a relay `/seen` emits once and excludes the acking device; the attention key never collides with a completion key |
| **S7** | Cloud *(proposal)*, with [`docs/push-cloud-ops.md`](push-cloud-ops.md) (PR #15) as its ops note: forward-registration ingest, event ingest that validates and enqueues and answers **`202 {emit_id, accepted_at}`** (never a synchronous per-device result), the durable queue and its worker, fan-out to APNs/FCM, the delivery record kept 14 days, token deletion on revocation, removal on unpair | cloud | L, **not ours** | S3, S4; **blocked** on the operator items above | Per-device delivery recorded; a replayed completion key is a no-op; a revoked token produces a refused delivery and a deleted row; a device deleted on the machine stops receiving within one fan-out |
| **S8** | App: notifications module, permission + channels, **app-managed badge** (`setBadgeCountAsync` on connect/foreground/ack, cleared on sign-out and route removal), the **deep-link route + `+native-intent`**, tap resolution (handle → session id → `router.push`), the §6 navigation contract, Settings (device list + unpair) | app | M–L | S1–S3 | A rendered cold-start tap lands on the notifying conversation (frame evidence, before/after); a tap for a computer the app is not on switches route then resolves; an unknown handle lands on the sidebar with the one honest sentence; the badge equals the daemon's count on connect and 0 after an ack; **the route that resolves `localoperator://s/<id>` exists as code** (it does not today) |
| **S9** | App: the local foreground notification, including "not while watching *this* conversation" | app | S | S8 | A foreground arrival for another conversation surfaces in-app and raises no OS banner; the watched conversation raises nothing; on a machine with no Radient login this is the whole notification story (ADR §2.4) |
| **S10** | Unpair-driven deregistration, end to end: removing a device on the machine deletes it in the cloud; the cloud's deletion is a revocation the machine learns about | core + cloud + app | S | S4, S7 | Unpair on the machine ⇒ no further pushes to that device (observed, not asserted); the same from the account side with the machine offline |
| **S11** | FOSS flavour gating, store-submission inputs (entitlements, CI secrets per ADR 0004), and the Settings copy reviewed against ADR §2.4 | all three | S–M | S8 | The `foss` flavour builds without Google Play Services/Firebase and the app states plainly that notifications need the Radient login (ADR §5, `docs/publishing/other-channels.md`:128) |
| **S12** | **Deferred, not v1:** quiet hours, and "when a session needs a decision" as a notification | app + core | — | — | Recorded so it is not quietly shipped as promised copy: neither concept exists in the core today (`grep` finds no quiet-hours rule), and `docs/ux/flows.md`:570 promises both — the Settings row must say "not yet", or the row is dropped in v1 (ADR, Amends) |

---

## Order, and why

```
S1 ─┬─ S3 ────────────────┬─ S7 (cloud — blocked on the operator items)
S2 ─┘   (frozen first)     │
S4 ── S5 ── S6 ────────────┘
        └─ S8 ── S9, S11
S4 + S7 ── S10
```

1. **S1 and S2 ship first and alone.** No cloud, no credential, no decision from anyone
   outside the core, and useful the moment they land: the aggregate is the in-app count even
   with no push at all, and the handle is what an on-device deep link needs. If everything
   else stopped here, the badge rule the operator asked for would already be honest.
2. **S3 is frozen before the expensive work** (review M11): it needs only S1 and S2, so the
   cloud team is not made to wait on the worker. S3 freezes the relay shapes, the payload and
   the keys; the cloud route shapes inside it stay marked **proposal**.
3. **S4 → S5 → S6 prove the mechanism with no Radient dependency**, because S5 is tested
   against a stub control plane. This is the deliberate hedge: the design is exercised before
   the cloud exists, and if the cloud never ships, the work has still produced a device
   registry, a cursor and a measured eligibility rule rather than a plan.
4. **S7 is the only slice we cannot do ourselves**, and it is the critical path.
5. **S8 is the widest diff.** S9 and S11 finish it. S10 needs both a machine and a cloud, so
   it lands last.

## QA matrix this plan asks for

Written for the independent QA pass, per the operator's permutation list plus review round
1's gaps. Each row names the app's state, the other surfaces' state, the action, and what must
be observed.

| # | App state | Other surfaces | Action | Expected |
|---|---|---|---|---|
| Q1 | foreground, SSE live | TUI running, desktop focused | a turn finishes in B while the app shows A | no desktop banner change (rungs 1/2 as today); the push is **deferred** by the presence rule; if the user reads it in the app within 45 s, no push is ever sent (assert `unseen` false and no emit) |
| Q2 | foreground, SSE live | desktop not running, no TUI | a turn finishes | the app's count rises from its SSE frame; the push is sent (no presence to defer it) and the app **suppresses the OS banner** for it while it is running (the decided behaviour, review M11) |
| Q3 | backgrounded | — | a turn finishes | one alert push, no icon badge in the payload (`aps.badge` absent, assert it); the body states the kind and the count; tapping deep-links to B and acks only after the row renders |
| Q4 | killed (iOS force-quit) | — | a turn finishes, then the user taps | the app cold-starts, resolves the deep link before the composer commits, opens B, renders, acks; **no silent wake was relied on** (the iOS force-quit case) |
| Q5 | backgrounded | device B backgrounded, same machine | device A acks B's conversation | the worker detects the receipt change and emits one attention push; B (best-effort wake) re-reads and drops its badge; **A is not pushed about its own ack** when the `/seen` path was used |
| Q6 | backgrounded | an ack happens from the **TUI**, not the phone | a turn finishes; the user clears it at the terminal | the phone's badge is corrected on its next connect; the worker still emitted the attention event (§S6, review M4's core case) |
| Q7 | in flight | — | an ack lands while a push for the same completion is being sent | at most one arrives; if it arrives, tapping it changes nothing (already read): no re-ack, no badge change, no unread mark |
| Q8 | any | machine's store unreadable | the app reads unread | `count` absent, the app says it cannot check, the badge is left alone — never 0 |
| Q9 | app on a machine with **no Radient login** | — | a turn finishes while the app is backgrounded | **no push, by design**; Settings states why, in the reviewed copy; on foreground the count and marks are correct, and the badge does not stay stale-positive |
| Q10 | app on a **custom route, machine logged in to Radient** | — | a turn finishes | push **works** (ADR §2.4, review Q6) — the route does not decide it, and the tunnel can even be stopped |
| Q11 | ack for a superseded token | — | the app acks with a stale token | 409 `superseded_completion_token`; the app re-reads and retries with the current token; the mark clears |
| Q12 | a heal lands (`interrupted` → `complete`) | — | the provisional push was already sent | a **second** event is emitted for the corrected record (the key includes the record's content), and the app's next read shows the truth; no device is left holding the provisional wording as final |
| Q13 | daemon restarted with 3 unread while it was down | — | restart | exactly one catch-up (coalesced to a digest above the burst limit); no flood, no hole |
| Q14 | **two machines, one app** | — | completions on both | the icon equals the connected computer's count only; the app does not merge; the staleness window (ADR §1.5) is what is observed, and it is stated, not hidden |
| Q15 | a device is unpaired on the machine (or from the account with the machine offline) | — | after unpair, a turn finishes | no push to that device (observed); the machine's Settings list no longer shows it; the registry holds no token to leak |
| Q16 | a **publish and an ack land in the same 2 s tick** | — | the app is backgrounded; the completion is acked from the desktop in the same tick | the derived count is unchanged, so a count rule emits nothing — **the structural detector emits anyway** (`revision()` equality as the trigger, then the `acknowledgement_map()` diff says which conversation moved); the phone's badge drops on the next read/wake (round 2 M1) |
| Q17 | a heal lands and a relay `/seen` arrives in the same tick | — | clear a completion while a provisional outcome is corrected | **two** emits at most: the ack's, and the heal's (on the supersede cursor) — the nudge consumes the ack's change, so the tick does not re-emit it (round 2 m3/Q9); the phone ends on the corrected record, never on the provisional one |
| Q18 | a cloud refusal or timeout | — | the emit returns 5xx, then 202 on the third attempt | the cursor does **not** advance on the failures; the same idempotency key is retried three times over ~2 minutes; the accepted attempt advances it; a 5xx across all three drops the item with one log line and the badge is still right on the next read (round 2 M2) |

## Not in this plan

- **Pending `ask`/`approval` pushes.** Gates have no durable, ackable identity today — the ack
  contract is completion-token-bound (ADR 0006 §1, §9). Follow-up once the core's gate
  lifecycle has a durable row.
- **Quiet hours** (S12): promised in `docs/ux/flows.md`:570, absent from the core, deferred
  explicitly rather than shipped as copy.
- **Cross-machine unread merge.** An explicit operator decision, then a new ADR (ADR §1.6).
- **A BYO push gateway** for the fully self-hosted user (ADR §2.4, §9).
- **STT** and the composer's data path: a parallel workstream, deliberately untouched.

## Coordination notes (things this document cannot change)

- **#11 is open** and its `attentionCount`
  (`src/features/sessions/session-projection.ts:61-66`) counts `needs_attention` only. It must
  become the §1.4 count or the row is a fourth opinion; that change belongs to #11 or to an
  immediate follow-up, and this document only records it.
- **`docs/ux/flows.md` and `docs/README.md`** are touched by #11, so the pointers this ADR
  owes them (D-1's disposition, the ADR index entry) land after #11 merges, not in this PR.
- **`docs/push-cloud-ops.md` (PR #15)** is the cloud lane's runbook for S7. It and ADR §3.1
  must keep agreeing on the ingest shape; if either changes, both change in the same round.
