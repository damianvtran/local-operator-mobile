# Completion prefetch and push-wake warm refresh

A completion received while the app is running can resolve its opaque conversation
handle on the **currently selected authenticated relay** and take one projection
into the existing warm cache. A tap overlaps the same per-session prefetch with
navigation. Neither path starts a computer route or searches other computers. A
handle that does not resolve on this relay is a 404 with no fallback.

The coordinator is pure and injected. The connection provider registers a scope
only after route admission, and unregisters it on retirement. Resolution and the
seed share a 25-second deadline. A screen's live stream supersedes any seed take;
onscreen sessions are not prefetched. Concurrent requests for a session share a
seed, and successful seeds are limited to one per session per 60 seconds. Only the
first projection is taken, and the stream closes **before** the cache save. The
existing encrypted native warm-cache adapter and private-write barrier remain in
force; the seed also rechecks ownership when its serialized cache write is admitted.
The web cache remains memory-only.

## Background push refresh: warm-only, not a permanent tunnel

Core #4050 (v0.106.0) supplies the missing authority: a successful authenticated
`POST /api/push/register` optionally returns `computer_handle`, the **same opaque
value** as a push's `computer`. The app stores that answer by account and saved
route in the existing sealed warm family. A changed answer replaces it; an absent
(or empty) answer clears it, never infers one. Sign-out and proven account change
purge the family and memory; removing a computer drops its mapping. Failed or
deduplicated registrations supply no new binding facts.

The **one existing notification task** clears attention badges/banners first,
then gives the warm-sync coordinator only the remainder of its **same 25-second
budget**. It never opens credentials, admits a route, searches another computer,
or switches routes. Both push branches require the currently selected, already
admitted scope to match the stored authenticated handle:

- **Attention:** one `GET /api/sessions?include_peers=true`, plus at most one
  first-projection seed for the conversation last viewed in this warm process.
  The existing per-session single-flight/60-second successful-seed limit applies;
  successful list saves also suppress repeated attention reads for 60 seconds.
  With no last-viewed conversation, only the list is refreshed.
- **Completion:** resolve the opaque conversation handle on that route, then reuse
  the same one-seed coordinator/cache path. No list request. A 404 has no fallback.
- **Mismatch, absent mapping, unreadable mapping, or no admitted scope:** no relay
  request. Attention's existing account unread/badge clear is independent of that
  relay gate and may still run when its own signed-in scope is mounted.

A mounted screen releases its seed-supersession claim on `background` and reclaims
it on `active`, before reopening its stream. Merely mounting the screen is not
proof the phone is onscreen while locked. Foreground receipt/tap and screen
supersession otherwise retain their existing behavior. Scope retirement aborts
transport; both list and seed saves recheck ownership in the cache write queue.

This is **warm-only under unchanged `WHEN_UNLOCKED_THIS_DEVICE_ONLY`**. A cold,
locked/headless launch with no provider returns NoData immediately (no scope wait
or credential restoration). A credential read failure makes no request and writes
no sign-out/refusal. A failed refreshed-session persist is already tolerated by
`writeStoredTunnelSession`: the manager keeps the session in memory. Cache and
mapping write failures are also best effort. None of this relaxes keychain access
or grants a cold background process authority to reconnect.

**Battery/OS limits:** no periodic work, new dependency, additional task/mode,
permanent socket, or keepalive is added. Each eligible push uses one or two relay
requests; the projection stream closes on its first seed. The OS still decides
whether/when a silent push gets execution and may suspend/kill the app. This does
not promise a continuously live tunnel, device battery savings, or native delivery.

Visible iOS completion pushes **without `content-available` do not wake a suspended
app**. Android data messages can reach this branch now; iOS remains inert until
the separate cloud lane adds `aps.content-available=1`. That lane owns the envelope;
`body`, `conversation`, and `data` are unchanged. This PR changes no cloud payload.

## Evidence and remaining validation

Node tests use the production endpoint, SSE, coordinator, and cache modules against
`tools/mock-relay` over loopback, injecting notification envelopes. They check the
200 resolve/seed path, first-frame stream closure, account-scoped cache contents,
404/no-fallback, 401/no-seed, and onscreen skip. Injected adapter tests additionally
cover deadline cancellation, account switch while resolving/receiving/queuing a
save, single-flight, receipt/tap dedupe, reconnect, and the successful-seed limit.
Expo received-listener tests mock the native binding; they are not native proof.

`src/notifications/background-push-refresh.test.ts` injects iOS `body` and Android
`dataString` through the **actual registered callback**, using production endpoints,
coordinator, and cache against `tools/mock-relay` on loopback. It asserts list 200,
resolve 200, a single projection seed/cache write, zero relay requests on mismatched
or missing/locked mappings, 60-second dedupe, cold NoData without credential reads,
credential-read failure without requests, tolerated persist failure, account-switch
fencing, and a real 25-second quiet-SSE transport abort. Native bindings/outbox are
mocked, not the relay/coordinator/cache. `BACKGROUND_TASK_BASELINE=<main-task.ts>`
replays main's unchanged task callback body for the failing-before attention test.

Independent QA should rerun that matrix on the pinned PR head and separately check
registration omission/replacement, account ownership and removal/purge; background
and resume a mounted conversation to check claim release/reclaim; and verify a
refreshed tunnel session stays in memory when the unchanged writer cannot persist.
Only changed-file and direct-neighbor tests are local; locked CI is authoritative
for the declared dependency tree. No native, device, rendered UI, energy/battery,
or OS delivery measurement is claimed. iOS completion wake validation waits on the
cloud envelope lane; Android/iOS native delivery remains device/CI validation.
