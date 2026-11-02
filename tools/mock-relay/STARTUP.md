# Startup and acknowledgment-loss fixtures

These controls belong only to the loopback mock relay. They do **not** advertise
new relay capabilities, define a create-idempotency field, or model persistent
storage. Use fabricated QA-only text/images: the evidence endpoint intentionally
returns exact request bodies. It never records login forms, cookies, auth
headers, or credential operations.

Start the usual mock with `node tools/mock-relay/relay.ts --port 0 --scenario idle`.
Log the client in through `/login` as usual. The control routes use the existing
`/__mock/` namespace and need no application cookie; all application routes still
pass their normal authentication and origin checks before entering a barrier.

## One-shot selective barriers

`POST /__mock/barriers` with a JSON object arms one barrier (201):

```json
{"id":"first-command","point":"command-ack","commandId":"00000000-0000-4000-8000-000000000001","timeoutMs":30000}
```

| `point` | When `state: "entered"` is observable |
| --- | --- |
| `config` | Authenticated GET `/api/models` or `/api/directories`, before its reply. Add `path` to select just one. There is no invented `/api/config` route. |
| `start` | Valid POST `/api/sessions/start`, **before** a session is created. `createdSessions` must not grow while held here. |
| `start-ack` | That POST has **already created** a session and its SSE projection/catalogue row, but has not replied. |
| `command-ack` | A valid, first-admission prompt/steer has **already** recorded its immutable body and appended its user row, but has not replied. A same-ID replay bypasses this barrier and returns `already admitted`. |

Optional exact-match selectors are `path`, `sessionId`, and `commandId`; omit
selectors that the selected stage cannot yet know. The barrier claims only the
first matching request. Unrelated routes and later requests continue normally.
If multiple armed barriers match, the first armed one wins.

Read `GET /__mock/startup` until the matching barrier is `entered` — do not sleep
for a guessed delay. Its `entered` object contains the actual `path` and, where
known, `sessionId` and `commandId`. Then:

- `POST /__mock/barriers/<id>/release {}` releases that request normally.
- `POST /__mock/barriers/<id>/release {"outcome":"drop"}` destroys **only the
  response connection**, retaining the effect. Drop is valid only at `start-ack`
  and `command-ack`, never at a before-admission barrier.
- Releasing an unknown, unentered, or already completed barrier is 400. Invalid
  options are 400; they never silently arm a different control.

States are `armed`, `entered`, `released`, `dropped`, `expired`, and `cancelled`.
A barrier expires after `timeoutMs` **from arming**, default 30,000, range
1–60,000. If entered, expiry answers 504 `mock barrier expired`; if never entered,
its `entered` stays null. A client disconnect cancels an entered barrier.
`POST /__mock/release` still releases the **scenario lease**, not a held request.

## Effects independent of replies

`GET /__mock/startup` returns:

- `barriers`: the state and observed request for each barrier.
- `createdSessions`: one entry per successful legacy start, including `sessionId`,
  `method`, `path`, exact `rawBody`, parsed `body`, and `bodySha256` (UTF-8).
- `admissions`: one entry per admitted command ID, in admission/FIFO order,
  including `sessionId`, `commandId`, `op`, the same request/body fields, and
  `images` with `index`, `mimeType`, decoded `byteLength`, and decoded-byte `sha256`.
  A changed-body replay cannot overwrite the original evidence or append a row.
- `limits` and `retainedBytes` for the bounded evidence store.

Read array lengths for creation/admission counts; `/__mock/state.sessions` is the
current total of seeded plus created projections. Every default legacy start
POST creates a **different** session: two starts in `idle` grow total sessions
from 1 to 3. An ack-lost legacy create therefore remains genuinely ambiguous to
the app; a client that repeats it creates another session. No dedup capability
or request field is invented to hide that bug.

Created IDs appear in `/api/sessions`, can be adopted through
`/api/sessions/<id>/events`, and accept subsequent prompt/steer commands. Creation
mutates the mock's projections only; no agent process is spawned. Admission
appends one `user-<command_id>` transcript row, including image references. Image
bytes are available through the normal `/image?entry=user-<command_id>&i=<index>`
route; the ledger hashes the canonical request's `data_b64` bytes. The existing
`no-ack=<ms>`, `no-ack-forever`, and scenario command-window faults now also append
and record **before** losing/timing out the reply. Thus 504 → same-ID retry 200
must correspond to one real transcript row, not just a reserved RAM key.

## Bounds and cleanup

Per scenario: at most 16 barriers, 64 created sessions, 128 command admissions,
64 images per command, and 8 MiB of retained raw plus parsed request-body bytes.
Capacity fails closed (400 for barrier controls, 507 before a new admission or
create); identities are not silently evicted. A same-ID command replay still
works at capacity. Image-count bounds also bound per-image metadata overhead.

`POST /__mock/reset {}`, changing `/__mock/scenario`, or relay shutdown cancels
held requests, closes outstanding no-ack command responses, clears their timers,
and drops all startup evidence. Reset/scenario changes rebuild the fixture world;
they cannot release a stale create into the next world. Created IDs are not reused
after reset. Existing configured fault baselines retain their existing semantics:
use `POST /__mock/fault {"faults":[]}` when the next cell needs no injected fault.

The ledger is **in-memory, not crash-durable**. Capture `/__mock/startup` before
cleanup for QA artifacts. This is honest HTTP/SSE fixture proof, not native-frame
proof or evidence of core relay crash persistence.

## Targeted validation

```sh
node node_modules/vitest/vitest.mjs run tools/mock-relay/startup.test.ts --maxWorkers=1 --no-file-parallelism
```

The tests drive real loopback HTTP/SSE, including auth/invalid-input controls,
before/after-create distinction, selective holds, drop-after-effect, image byte
round-trips, changed-body replay immutability, expiry, reset, and capacity.
Use the repository's bounded isolated runner when running on a shared host.
