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
[#15](https://github.com/damianvtran/local-operator-mobile/pull/15), **merged as
`5b760898ba5da1d65a23ce5ba999f520ec5e632c`** — the note is on `main`), and the two documents are reconciled on the ingest shape: the machine's call
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
| **S2** | Conversation handle: mint (machine-local HMAC, 0600 key), scope, `push_handle` on the **aggregate's rows only** (ADR §4: the per-row listing field was **rejected on frame size** — do not implement it), and `GET /api/push/conversation/{handle}` for the cold tap | daemon-core | S | — | A handle resolves to its session id; an unknown handle (stale key, deleted conversation) is a clean 404, never a 500; handles are stable across a daemon restart and differ between two config roots; a key rotation invalidates old handles and is a documented (not silent) operation |
| **S3** | **Freeze the interfaces** (§3.1 relay shapes — including `device_key` minted and returned by **every** register call, `X-Lop-Device-Key: <device_key>` on identifying requests, the two state `403` codes, the **operators-only `unrevoke` route with its `403 machine_only` body and the `X-Lop-Operator-Key` header**, and the machine→cloud literals now in §3.2 — §3.2 payload, §3.4 keys, §4 refusals, and the cloud-side *(proposal)* grant), with a fixture per shape in `fixtures/` (ADR 0003's pattern) | all three | S | **S1, S2** | A written contract both sides build against; the payload field table is the allow-list, with `extra="forbid"` on the cloud side; **it does not depend on S4/S5** (review M11) |
| **S4** | Device registry: `POST /api/push/register`, `GET /api/push/devices`, `DELETE /api/push/devices/{id}`; durable record under the config root (0600); **no push token stored on the machine** | daemon-core | S–M | — | Idempotent on `(install_id, platform)`; a rotated token keeps the `device_id`; `DELETE` works for **any** device in the registry, not only the caller (the stolen-phone case, ADR §4); the record holds no token (assert it); a corrupt record is refused, not repaired |
| **S4a** | **Device lifecycle states, one vocabulary** — live / expired (`expired_at`) / unpaired (`unpaired_at`) / revoked (`revoked_at`) / absent (no row), the shared precedence **revoked > unpaired > expired**, the register route's two refusals (`403 device_revoked`, `403 device_unpaired`), the **emit-side skip** (a device that is marked, or `expired_at`, gets no emit), the **per-device key** minted and returned by every register call (**a re-register IS the rotation's delivery path**), `list` returning `state` plus the response's `precedence`, and **`unrevoke` as the operators-only route gated by `X-Lop-Operator-Key`** | daemon-core | S–M | S4 | The states are one table in code and the register route, `list` and the emit path resolve the **same** precedence (asserted, not assumed); `expired_at` re-registers while the other two refuse; a **fresh `install_id` is refused on nothing** — the state rules cannot bind an identity they have never seen, and this is why §4 rule 2 scopes the fresh-install claim to the **direct** route (round 5 M4; on the Radient route the account-side revoke is the lever, and Q25 tests exactly that); a dead token and the 60-day drop both delete the row with **no** marker and the same `install_id` re-registers cleanly; an unpair writes `unpaired_at`, never `revoked_at`, and its refusal names the computer; **a phone-origin request — a valid `lop_mobile` cookie, as the phone's, and no `X-Lop-Operator-Key` — gets `403 {"code":"machine_only","error":"a device cannot restore itself — use the computer or your account"}`** (round 7, adopting core PR #1864's predicate: a machine-minted secret on the header, never a locality claim — the relay's single cookie gate cannot tell the phone from the CLI), while `lop mobile devices unrevoke <id>` over loopback (with the key read from the 0600 store) and the account console both succeed; `unrevoke` **deletes every marker the row carries** and leaves the token absent — QA **Q1, Q5, Q21–Q28, Q29, Q31** |
| **S4c** | **Credential-live evaluation and the credential-change event** (§4 rule 2) — the app names itself on authenticated relay requests (`X-Lop-Device: <install_id>`, attribution) and a request that **moves** a device's state also presents that device's **key** (`device_key_matches`, `push_devices.py`:359-375 (#1864) — written, consumed by this slice); the **relay** computes `credential_live` and reports it **coalesced** — a typed `devices` block `{device_id, credential_live, credential_expires_at, last_authenticated_at}` carried on the **registration forward** and on the **next emit**, plus a **heartbeat `POST <cloud>/v1/push/credentials` (proposal) after 15 minutes** — with **the lapse derived from the expiry the presented cookie carried** (`credential_expires_at`, recorded at register; `mobile/auth.py`:465-469), so a closed app's lapse is reported at the heartbeat rather than never; the **guard cells land here**: the gateway's `_REQUEST_HEADERS` (`gateway.py`:310-319, applied at `:537` and `:719`) **never gains `X-Lop-Operator-Key`** and the entries stay lowercase — asserted by **Q31 as a REGRESSION GUARD, not a red-until-built row: both headers are already dropped today**, so the row fails only if a future allowlist change lets them through; on the **Radient route** the enforceable half is the **cloud-issued per-device grant** *(cloud, proposal — §2.2's Grant row)* | daemon-core + Radient-cloud | **S–M** | after a rotation **no** device of that computer is delivered to while the machine also refuses to emit for it, and each resumes on its own next authenticated request; the lapse is exact (the cookie's own expiry) instead of arithmetic; the guard is asserted where a future edit could break it — QA **Q21–Q26, Q30, Q31** |
| **S5** | Push worker in the mobile daemon: **two durable cursors** (publications + supersedes) with a baseline at enablement, the acknowledgement-map diff, the §2.3 gates, the **presence deferral**, bounded coalesced catch-up, a bounded local queue whose **cursor advances only on the cloud's accept** (`202`) emit queue | daemon-core | M | S1–S4 (tested against a **stub** control plane) | A completion that is `unseen` + `notify` + no presence emits exactly once; a suppressed one is **deferred then emitted** (or terminated by an ack) and never dropped silently; a restart neither re-pushes the backlog nor drops what landed while down (the cursor test); a catch-up above the burst limit emits **one digest**; a cloud 5xx neither stalls a turn nor grows unbounded; `deliveries` is untouched before/after (assert it) — QA **Q3–Q7, Q22, Q24, Q30** |
| **S6** | Attention emit: **structural detection** on the existing `revision()` loop (`revision()` equality as the trigger, then `acknowledgement_map()` and the supersede cursor say which conversation moved), the `/seen` nudge path that **consumes the change — both halves of the detector state, the `revision()` triple *and* the `acknowledgement_map()` snapshot**, `device_id` on the ack, and `exclude` on the attention emitking device | daemon-core | S | S5 | An ack from the **TUI** or the **desktop** (which never touch the relay) still produces exactly one attention emit — this is the "clear it on the desktop and the phone drops it" scenario (review M4); a relay `/seen` emits once and excludes the acking device; the attention key never collides with a completion key |
| **S7** | Cloud *(proposal)*, with [`docs/push-cloud-ops.md`](push-cloud-ops.md) (PR #15) as its ops note: forward-registration ingest, event ingest that validates and enqueues and answers **`202 {emit_id, accepted_at}`** (never a synchronous per-device result), the durable queue and its worker, fan-out to APNs/FCM, the delivery record kept 14 days, **tombstoning on revocation (`revoked_at`) and on unpair (`unpaired_at`) — the row stays** — the **account-side revoke/un-revoke surface**, the **heartbeat route** `POST /v1/push/credentials` *(proposal)*, the **grant's life** (store, refresh from the machine's report, rotate on an owner rotation, refuse on an account revoke) *(proposal)*, the two device headers added to the gateway allowlist (`gateway.py`:310-319, NEW), and the **mint-refusal requirement** *(the grant is not minted while the account's access for that computer is revoked — §4 rule 2's Radient-route lever)* | cloud | L, **not ours** | S3, S4; **blocked** on the operator items above | Per-device delivery recorded; a replayed completion key is a no-op; a revoked device produces a refused delivery and a **tombstoned row** (a deleted row carries no marker, so the refusal rule could not hold); a device tombstoned on the machine stops receiving within one fan-out — QA **Q21–Q31** |
| **S8** | App: notifications module, permission + channels, **app-managed badge** (`setBadgeCountAsync` on connect/foreground/ack, cleared on sign-out and route removal), the **deep-link route + `+native-intent`**, tap resolution (handle → session id → `router.push`), the §6 navigation contract, Settings (device list + unpair) | app | M–L | S1–S3 | A rendered cold-start tap lands on the notifying conversation (frame evidence, before/after); a tap for a computer the app is not on switches route then resolves; an unknown handle lands on the sidebar with the one honest sentence; the badge equals the daemon's count on connect and 0 after an ack; **the route that resolves `localoperator://s/<id>` exists as code** (it does not today) |
| **S9** | App: the local foreground notification, including "not while watching *this* conversation" | app | S | S8 | A foreground arrival for another conversation surfaces in-app and raises no OS banner; the watched conversation raises nothing; on a machine with no Radient login this is the whole notification story (ADR §2.4) |
| **S10** | Unpair-driven deregistration, end to end: removing a device on the machine writes a marker the cloud mirrors (`unpaired_at`, or `revoked_at` for a revoke); an account-side revoke is the same marker, learned by the machine on its next report | core + cloud + app | S | S4, S7 | Unpair on the machine ⇒ no further pushes to that device (observed, not asserted); the same from the account side with the machine offline |
| **S11** | FOSS flavour gating, store-submission inputs (entitlements, CI secrets per ADR 0004), and the Settings copy reviewed against ADR §2.4 | all three | S–M | S8 | The `foss` flavour builds without Google Play Services/Firebase and the app states plainly that notifications need the Radient login (ADR §5, `docs/publishing/other-channels.md`:128) |
| **S12** | **Deferred, not v1:** quiet hours, and "when a session needs a decision" as a notification | app + core | — | — | Recorded so it is not quietly shipped as promised copy: neither concept exists in the core today (`grep` finds no quiet-hours rule), and `docs/ux/flows.md`:570 promises both — the Settings row must say "not yet", or the row is dropped in v1 (ADR, Amends) |

---

## S4a against core's implementation (PR #1864, head `d089f7e0f`, **merged as `813c6bf89`**; #1878 `37ab4ed`)

S4a is **already implemented** in `damianvtran/local-operator` PR #1864 — **merged as
`813c6bf89870b4772fd622246a5d5d41e4ac3f7f` and in the `v0.64.13` release**, with #1878 (`37ab4ed`)
following it to pin the every-marker `unrevoke` semantics — read as it did at that head: the
five states and their precedence resolver (`push_devices.py`:136-145, `:338-356`), the two state
refusals `403 device_revoked` / `403 device_unpaired` (`:182-185`), `expired_at` cleared by
re-register (`:505-509`), the per-device key minted and returned by every register
(`:510`, `:522-527`), the `list` shape with `state` and the response-level `precedence`
(`:556-571`), `DELETE /api/push/devices/{id}` with self-targeting, and the operators-only
`POST /api/push/devices/{id}/unrevoke` gated by `X-Lop-Operator-Key` (`daemon.py`:4730-4770 (#1864),
`:4826-4853`), driven by `lop mobile devices list|revoke|unrevoke` over loopback
(`cli.py`:7704-7752 (#1864), `:7836-7862`), on a 0600 store (`push_devices.py`:946).

**Residual differences, each an explicit item for the core lane (eight of them)** — this document is written to
match the implementation, and these are the places where it asks for more or something different:

1. **No `rotate` verb** (the CLI's choices are `list|revoke|unrevoke`) — and none is needed, because
   the key is re-minted by every register call: **the delivery path for a rotated key is the device's
   next authenticated register** (§3.1, R7-m2). An explicit `rotate` would be additive and could not
   deliver on its own — the key only ever leaves the machine in a register response.
2. **The key is stored as the key itself, not a hash** (`push_devices.py`:194, `:510`, `:946`), and
   §2.2 now says so. A hash would force a one-time return plus a `409 device_key_required` on a
   re-register without it — recorded here as the alternative, not as the rule.
3. **The credential report is unbuilt**: #1864 declares `credential_live` / `last_authenticated_at`
   and adds `device_key_matches` "nothing consumes yet" (`:359-375`), and `list` omits both fields
   when a row does not carry them (`:566-569`). **S4c's carrier, its heartbeat, and the new
   `credential_expires_at` (§4 rule 2, Q-F15) remain core work**; §3.2 now carries the literals S3 freezes.
4. **`credential_expires_at` is new here and absent there** — its writer is **register**, reading the
   expiry out of the cookie the phone presented (`mobile/auth.py`:465-469), not the login route,
   which knows no device (R8-m1). It is the one field this document adds to core's store rather than adopting.
5. **The push token is validated and dropped** (`daemon.py`:4776-4778 (#1864)) ✓ matches §2.2's custody —
   the cloud's registry holds tokens — and **the registration forward itself is S7** (cloud).
6. **No account-console path** exists in #1864 (cloud, S7), and no credential-change event.
7. **The guard cells are NOT in #1864** — the allowlist never gains `X-Lop-Operator-Key` and the
   lowercase-literal trap for `X-Lop-Device` are this ADR's requirements **and core lands them in
   S4c**. They are a **regression guard, not a gap being closed**: the gateway drops both headers
   **today** (`gateway.py`:310-319 applied at `:537` and `:719`), so Q31 passes against the pin and
   fails only if a future allowlist edit lets a device header through (QA round 8, Q-F25).
8. **The user-facing vocabulary is core's and the app must consume it, not re-word it**: the five
   `STATE_DESCRIPTIONS`, `DESCRIBED_STATES` order and `PRECEDENCE_SENTENCE` are module constants
   (`push_devices.py`:159-177 (#1864)), rendered today by `lop mobile devices`
   (`cli.py`:8058-8071 (#1864)). The app slice's Settings copy **mirrors them verbatim** (§6's table);
   deferring the app and shipping different words would be the drift the constants exist to prevent.

### The facts this ADR takes from #1864, and where each is

| Fact this document relies on | #1864 (head `d089f7e0f`) |
|---|---|
| the five states and their precedence resolver | `push_devices.py`:128-145, `:338-356` |
| `STATE_DESCRIPTIONS` (5 rows incl. `absent`) + `DESCRIBED_STATES` + `PRECEDENCE_SENTENCE` | `:159-177` |
| the register refusals (`403 device_revoked`, `403 device_unpaired`) | `:182-185` |
| `machine_only` code + sentence | `:187-188` |
| `OPERATOR_KEY_HEADER` / `OPERATOR_KEY_FIELD` | `:193-194` |
| `device_key` minted + returned by every register | `:510`, `:522-527` |
| the operator key minted by the daemon in `register`, under the lock | `:518-519` |
| the 0600 atomic store write | `:946` |
| `operator_key()` never mints; `verify_operator_key()` constant-time | `:378`, `:407-423` |
| `device_key_matches()` (constant-time, "nothing consumes it yet") | `:359-375` |
| `list` shape (optional `name`/`credential_live`/`last_authenticated_at`) | `:556-571` |
| `unrevoke` deletes every marker the row carries, restores nothing | `:611-645` |
| the daemon gate + the route + its registration | `daemon.py`:4730-4770 (#1864), `:4826-4853`, `:4909-4910` |
| the CLI's loopback call, its `daemon_unreachable`/`credential_missing`/`operator_key_missing` answers | `cli.py`:7704-7752 (#1864), `:7836-7862` |
| the CLI's machine-side `machine_only` remedy | `cli.py`:7866-7877 (#1864) |
| the four unrevoke result lines | `cli.py`:7888-7898 (#1864) |
| the row renderer (`last authenticated` vs `last seen`) | `cli.py`:7988-7992 (#1864) |
| the legend, the unrevoke note, the 60-day caveat | `cli.py`:8058-8071 (#1864) |

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
1's gaps. Each row names the app's state, the other surfaces' state, the action, and what must be observed.

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
| Q27 | any | a phone with a valid `lop_mobile` cookie and **no** `X-Lop-Operator-Key` | call `POST /api/push/devices/{id}/unrevoke` | `403 {"code":"machine_only","error":"a device cannot restore itself — use the computer or your account"}` — the refusal is the operator key's absence, not a locality guess (`_push_operator_gate`, `daemon.py`:4730-4770 (#1864)), and the app renders that sentence |
| Q28 | any | the operator surface | `lop mobile devices list` / `revoke` / `unrevoke` over loopback, then the same with the daemon stopped, then with no operator key in the store | all three verbs act on the store through the daemon; stopped daemon → `daemon_unreachable` ("the mobile daemon on port N did not answer", `cli.py`:7745-7747 (#1864)); no key → `operator_key_missing` (`:7851-7855`); no password → `credential_missing` (`:7730-7733`). No verb edits the store file itself |
| Q29 | any | a re-register of a known `install_id` | register twice from one device, then move state with the FIRST key | the second response carries a **new** `device_key` (`push_devices.py`:510, `:522-527`) and the first key no longer matches (`device_key_matches`, `:359-375`); **no `409` exists in this model** — a one-time return would be the rule only if the store held a hash (item 2 above) |
| Q30 | app killed, credential lapsed | a device whose cookie was issued >30 days ago (synthetic clock) on the **direct** route | let the heartbeat interval elapse | the machine reports it not-live from the expiry the cookie itself carried (`credential_expires_at`, `mobile/auth.py`:465-469) — **not** from the last request — and fan-out pauses for that device (§3.2's heartbeat body) |
| Q31 | any | the **tunnel gateway** hop | send a request through the gateway carrying `X-Lop-Operator-Key` | the header is **absent at the relay** (`gateway.py`:310-319, `:537`) and the route answers `403 machine_only`; the same test is the negative that proves the allowlist must never gain that header (entries are lowercase — a mixed-case literal entry would silently do nothing) |
| Q9 | app on a machine with **no Radient login** | — | a turn finishes while the app is backgrounded | **no push, by design**; Settings states why, in the reviewed copy; on foreground the count and marks are correct, and the badge does not stay stale-positive |
| Q10 | app on a **custom route, machine logged in to Radient** | — | a turn finishes | push **works** (ADR §2.4, review Q6) — the route does not decide it, and the tunnel can even be stopped |
| Q11 | ack for a superseded token | — | the app acks with a stale token | 409 `superseded_completion_token`; the app re-reads and retries with the current token; the mark clears |
| Q12 | a heal lands (`interrupted` → `complete`) | — | the provisional push was already sent | a **second** event is emitted for the corrected record (the key includes the record's content), and the app's next read shows the truth; no device is left holding the provisional wording as final |
| Q13 | daemon restarted with 3 unread while it was down | — | restart | exactly one catch-up (coalesced to a digest above the burst limit); no flood, no hole |
| Q14 | **two machines, one app** | — | completions on both | the icon equals the connected computer's count only; the app does not merge; the staleness window (ADR §1.5) is what is observed, and it is stated, not hidden |
| Q15 | a device is unpaired on the machine (or from the account with the machine offline) | — | after unpair, a turn finishes | no push to that device (observed); the machine's Settings list no longer shows it; the registry holds no token to leak |
| Q16 | a **publish and an ack land in the same 2 s tick** | — | the app is backgrounded; the completion is acked from the desktop in the same tick | the derived count is unchanged, so a count rule emits nothing — **the structural detector emits anyway** (`revision()` equality as the trigger, then the `acknowledgement_map()` diff says which conversation moved); the phone's badge drops on the next read/wake (round 2 M1) |
| Q17 | a heal lands and a relay `/seen` arrives in the same tick | — | clear a completion while a provisional outcome is corrected | **two** emits at most: the ack's, and the heal's (on the supersede cursor) — the nudge consumes **both halves of the detector state** (the `revision()` triple *and* the `acknowledgement_map()` snapshot), so the tick's own diff has nothing left to name and does not re-emit the ack (round 2 m3/Q9, round 3 Q3); the phone ends on the corrected record, never on the provisional one |
| Q18 | a cloud refusal or timeout | — | the emit returns 5xx, then 202 on the third attempt | the cursor does **not** advance on the failures; the same idempotency key is retried three times over ~2 minutes; the accepted attempt advances it; a 5xx across all three drops the item with one log line and the badge is still right on the next read (round 2 M2) |
| Q19 | a device is revoked while it is live | — | any turn finishes afterwards | no push to it (observed), and `POST /api/push/register` from that `install_id` returns `403 device_revoked`; Settings shows the row as revoked with the re-pair affordance, not a hidden row |
| Q20 | a device's token is reported dead by APNs/FCM (`410` / `UNREGISTERED`) | — | the user reinstalls and opens the app | the row was **deleted** with no `revoked_at`; re-registration succeeds on the first attempt (no refusal marker) — the case that must NOT behave like Q19 |
| Q21 | the relay password is rotated while two devices are registered — **direct route** | — | a turn finishes | neither device is pushed; both show delivery paused until they authenticate with the new password, at which point each re-registers and delivery resumes; `revoked_at` is unset on both throughout (assert it), so this is not a revoke |
| Q22 | a rotation with **two** devices on the **direct** route, coming back one at a time | — | device A authenticates and opens; a turn finishes before device B does | A is delivered to and B is not — the pause is **per device**, lifted by that device's own authenticated request (observed). `expired_at` is set on both at the rotation and on neither afterwards as each returns; no credential-change event is emitted more than once per rotation |
| Q23 | each silent stop, taken separately — a rotation, a lapsed cookie (TTL), and the 60-day idle drop | — | open the app afterwards | the relay's `401`/registration attempt is what the app acts on: expired → "notifications are paused for this device until you sign in again"; revoked → "this device was revoked on <computer>"; unpaired → "this computer is no longer paired"; after the drop, re-registration **succeeds** and the copy is the ops note's "push may resume the next time this device opens the app". **No case is silent, and no case reports a device as receiving pushes while a marker is set** |
| Q24 | a revoke (or unpair) lands **while an emit for that device is in flight** | — | revoke from the machine, then let the turn finish | at most the in-flight emit reaches the provider and its accept is *recorded*, never retracted; **no further emit is attempted for that device**, the cursor does not skip anyone else, and the device's next request is refused by its marker. The operator's permutation list asked for exactly this race |
| Q25 | a **re-installed app** whose `install_id` is new, on the **Radient** route | — | reinstall, connect, let a turn finish | it **registers and is pushed to** — the tombstone cannot bind an identity it has never seen, and pretending otherwise is what round 5 M4 caught; the case passes only when the **account-side revoke** (mint refused) stops it, and the Settings/§6 copy must never claim the tombstone or the password rotation did |
| Q26 | a registration **through the tunnel gateway** on the Radient route | — | register, then let a turn finish | the `X-Lop-Device` and `X-Lop-Device-Key` headers **arrive at the relay** (observed on the relay side, not asserted from the app), so the device's state moves; without the `gateway.py`:310-319 allowlist change the same test shows them stripped and **no** state moving — the negative that proves the row |

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
- **Revocation semantics (ADR §4, plan S4a)** are the other half of that agreement: the note's
  round-4 review read ADR §3.1's register route as consulting nothing about revocation, and the
  ADR now defines the device states, the tombstone that refuses re-registration, the credential
  rule that stops delivery after a rotation without revoking, and dead-token deletion as a
  different state with re-registration allowed. The library/test row is S4a, so none of it
  rests on prose alone.
- **The vocabulary is deliberately shared: `revoked_at` / `unpaired_at` / `expired_at`, with the
  precedence revoked > unpaired > expired, plus the *absent* state for a row that was dropped.**
  **Re-checked at the note's head `30a0f4d` (2026-09-30) rather than asserted:** it now carries the
  same five states, the same markers, the same precedence, `expired_at` for the credential lapse
  including a rotation, tombstoning for revoke *and* unpair, and the absent state for the provider
  dead-token and the 60-day drop — the four divergences round 4 M1 named are closed. **The three
  round 5 M6 / QA Q-F11 found are closed too, and so are the four the note was owed** (PR #15 merged
  as `5b76089`): the rate is now the coalesced, change-triggered report "at most once per device per
  5 minutes"; the credential-epoch sentence is gone; the single-route "lacking the new password"
  claim is gone, with the Radient route's lock moved to the cloud grant; and the note now carries the
  **grant**, the **heartbeat** route, **`device_key`** with `X-Lop-Device-Key` and the **`devices`
  report block**. **The two documents agree at that head**; this paragraph stays where they are
  checked against each other, and the check is a reading, never an assertion. §2.2's retention rules (**14 days**; the **60-day drop**, now stated as a row
  deletion with no marker rather than a tombstone) are this ADR's decision as of this pass — the
  note remains their operational runbook. Neither is a cloud route shape, so neither carries the
  "proposal" marker the endpoint list does.
