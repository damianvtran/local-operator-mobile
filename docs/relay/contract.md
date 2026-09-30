# The `lop mobile` relay wire contract

Everything the native client must do against the relay, derived from the code
rather than from prose. Line citations are against **local-operator
`origin/main` @ `52c1df35` (2026-09-29)**; no file under `local_operator/mobile`
or `local_operator/tunnels` changed between that revision and `5bfff4a6`, so the
citations resolve on current `main` too.

Paths are relative to the local-operator repository root:
`local_operator/mobile/daemon.py` → `daemon.py`; `local_operator/mobile/web/src/api.ts`
→ `web/src/api.ts`.

Provenance of every claim is one of:

- **code** — read from the cited line.
- **live** — reproduced against an isolated daemon (see
  [`../../fixtures/relay/README.md`](../../fixtures/relay/README.md)); the sample
  is committed under `fixtures/relay/`.
- **code + live** — both.

---

## 1. Transport, framing and the invariants that shape the client

| Property | Value | Source |
| --- | --- | --- |
| Bind | `127.0.0.1` only, never wider | `service.py:88-96` (uvicorn `host="127.0.0.1"`), `docs/mobile.md` §Security invariants |
| Default port | `4098` (`DEFAULT_PORT`), overridable with `--port`; the operator's install owns 4098 via its supervisor | `daemon.py:114`, `cli.py:621-623` |
| Real-time channel | **HTTP + SSE only, and snapshots/repaints only — no WebSocket and no deltas, deliberately**: an identity proxy answers an unauthenticated request with a redirect, which a WebSocket handshake cannot follow | `docs/mobile.md` §Security invariants |
| Protocol version | `5` — reported by `/healthz` as `version` | `types.py:66` (re-exported from `session/runtime/types.py`), live `fixtures/relay/http/healthz.json` |
| Wire encoding | JSON, UTF-8. SSE frames use the `event:`/`data:` pair with a blank-line terminator | `daemon.py:4664-4665` |
| Keep-alive | uvicorn `timeout_keep_alive=75` (SSE holds a connection open by design) | `service.py:94-95` |

### 1.1 The three auth rules every client must implement

1. **Cookie, not bearer.** One signed cookie authenticates every `/api/*` call:
   name `lop_mobile`, value `<expiry>.<hmac-sha256-hex>`, TTL 30 days, clock skew
   tolerance 60 s. Signed with a key derived from the relay password
   (`sha256("lop-mobile-cookie\0" + password)`), so rotating the password
   invalidates every session for free. — `auth.py:98-103,455-483`
2. **Login is a form POST, and it 303s.** `POST /login` with
   `application/x-www-form-urlencoded` body `password=<password>` → `303` to `/`
   with `Set-Cookie`. Wrong password → `401` **HTML**, not JSON. — code
   `daemon.py:3349-3372`; live `fixtures/relay/http/login-success.json`,
   `login-wrong-password.json`
3. **Failure shape splits by audience.** An unauthenticated `/api/*` request gets
   `401 {"error": "authentication required"}`; any other path gets `303` to
   `/login`. A native client must therefore never treat "got HTML back" as a
   transport bug — it is the login redirect. — code `daemon.py:3307-3322`; live
   `fixtures/relay/http/unauth-api-sessions.json`, `unauth-index.json`

Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`;
`Secure` **only** when the request arrived over TLS (the tunnel case), because
plain-loopback first-run must still be able to set it. — `daemon.py:3362-3371`,
live `fixtures/relay/http/login-success.json`.

> **Native-client consequence.** `HttpOnly` is irrelevant off-browser, but
> `SameSite=Lax` and the `Secure`-when-TLS rule are both real: over a personal
> tunnel the cookie is `Secure` and must be stored in the platform's secure
> storage, and the client must present it by header, not by a shared cookie jar
> that silently drops `Secure` cookies over `http://127.0.0.1`.

### 1.2 Same-origin rule on mutations

Every non-`GET/HEAD/OPTIONS` request is checked before anything else:

- an `Origin` header that is neither `http://<host>` nor `https://<host>` → `403 {"error": "same-origin request required"}`;
- `Sec-Fetch-Site: cross-site` → same `403`;
- **no `Origin` header at all is allowed** — which is what lets a native client
  (and `curl`) mutate without inventing an `Origin`. — code
  `daemon.py:3293-3310`; live `fixtures/relay/http/mutation-cross-origin.json` (`403`)
  and `command-no-origin-post.json` (`200`)

### 1.3 What the relay does *not* set

`secure_cookie()` (`daemon.py:3324-3329`) sets `Cache-Control: no-store` and is
**never called** — grep finds its definition only. Consequence, **verified live**:
JSON API responses carry **no `Cache-Control` at all**
(`fixtures/relay/http/sessions-empty.json` has no such header), so they are
heuristically cacheable by any intermediary. A native client must not rely on
the relay to forbid caching: set its own no-store policy for API responses.
The routes that *do* set cache headers are the SSE streams
(`no-cache, no-transform` plus `X-Accel-Buffering: no`), the image endpoint
(`public, max-age=31536000, immutable`), and the SPA shell / mark / login page
(`no-store`). — code `daemon.py:3393,3407,3507,3537,3799`

---

## 2. Route table

`build_app` at `daemon.py:3258`; the table itself at `daemon.py:4587-4637`.
`auth` column: **gate** = the `gate()` split above; **public** = no cookie.

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/healthz` | public | `daemon.py:3336-3342` |
| GET | `/login` | public (redirects when authed) | `daemon.py:3344-3347` |
| POST | `/login` | public | `daemon.py:3349-3372` |
| GET | `/logout` | public | `daemon.py:3374-3381` |
| GET | `/` | gate | `daemon.py:3396-3408` |
| GET | `/assets/*` | **public** (StaticFiles mount) | `daemon.py:4645-4652` |
| GET | `/mark.png` | public | `daemon.py:3383-3394` |
| GET | `/api/sessions` | gate | `daemon.py:3445-3449` |
| GET | `/api/sessions/events` | gate | SSE, `daemon.py:3514-3538` |
| POST | `/api/sessions/start` | gate | `daemon.py:4151-4192` |
| GET | `/api/sessions/past` | gate | `daemon.py:4273-4283` |
| POST | `/api/sessions/resume` | gate | `daemon.py:4194-4235` |
| GET | `/api/sessions/search` | gate | `daemon.py:4237-4260` |
| GET | `/api/sessions/{id}/events` | gate | SSE, `daemon.py:3451-3512` |
| POST | `/api/sessions/{id}/seen` | gate | `daemon.py:3540-3594` |
| POST | `/api/sessions/{id}/pin` | gate | `daemon.py:3596-3669` |
| POST | `/api/sessions/{id}/command` | gate | `daemon.py:3802-3953` |
| POST | `/api/sessions/{id}/operator/challenge` | gate | `daemon.py:3955-4029` |
| GET | `/api/sessions/{id}/history` | gate | `daemon.py:3724-3759` |
| GET | `/api/sessions/{id}/image` | gate | `daemon.py:3761-3800` |
| GET | `/api/sessions/{id}/agents/{job_id}` | gate | `daemon.py:3671-3688` |
| GET | `/api/sessions/{id}/agents/{job_id}/history` | gate | `daemon.py:3690-3722` |
| POST | `/api/pair` | gate | `daemon.py:4031-4099` |
| GET | `/api/pair/{device_id}` | gate | `daemon.py:4101-4143` |
| GET | `/api/commands` | gate | `daemon.py:4145-4149` |
| GET | `/api/models` | gate | `daemon.py:4285-4296` |
| POST | `/api/transcribe` | gate | `daemon.py:4298-4420` |
| GET | `/api/projects` | gate | `daemon.py:4449-4458` |
| POST | `/api/projects` | gate | `daemon.py:4460-4475` |
| GET | `/api/projects/{key}` | gate | `daemon.py:4477-4491` |
| PATCH | `/api/projects/{key}` | gate | `daemon.py:4493-4510` |
| DELETE | `/api/projects/{key}` | gate | `daemon.py:4512-4528` |
| POST | `/api/projects/{key}/milestones` | gate | `daemon.py:4530-4542` |
| DELETE | `/api/projects/{key}/milestones/{name}` | gate | `daemon.py:4544-4556` |
| POST | `/api/projects/{key}/links` | gate | `daemon.py:4558-4570` |
| DELETE | `/api/projects/{key}/links/{session_id}` | gate | `daemon.py:4572-4584` |

There is **no `GET /api/sessions/{id}`** — a single session's state arrives only
over its SSE stream or as a row of `/api/sessions`. A client that wants
"one session, once" must either read the listing or open the SSE stream and use
its seed frame (§4.2).

### 2.1 The error body contract

Errors are `{"error": "<human sentence>"}` — the sentence is the copy the relay
intends a surface to show. Where the *category* matters the body adds a machine
`code` beside it (`daemon.py:3936-3950` for command refusals; `daemon.py:3582-3588`
for the superseded-token 409; `daemon.py:4446` for project refusals). Rules the
client must keep:

- **Never parse the sentence to decide.** Use the status plus `code`; the prose
  has already been rewritten twice on the relay side (`daemon.py:3937-3945`).
- A non-JSON error body means "no more than the status" (`web/src/api.ts:82-92`).

---

## 3. Read routes in detail

### 3.1 `GET /healthz` — public, the reachability probe

```json
{ "ok": true, "version": 5, "sessions": 0, "dist": false }
```

- `sessions` is `len(daemon.table.entries)` — live registrations, **not** the
  number of conversations.
- `dist` reports whether the web bundle is present on this build. A client that
  does not need the web bundle must not treat `dist: false` as unhealthy.
- Always `200` while the process is up; there is no partial-health shape.
- — code `daemon.py:3336-3342`; live `fixtures/relay/http/healthz.json`

### 3.2 `GET /api/sessions` — the session list

**This endpoint and the `sessions` SSE event are the same payload on two
transports** (`daemon.py:3410-3416`). The phone's home screen reads the SSE one.

```jsonc
{
  "sessions": [ /* SessionSummary, see below */ ],
  "degraded": [],                       // [] | ["sessions"] | ["attention"] | both
  "capabilities": {
    "features": { "auth": 1, "commands": 2, "session_catalogue": 3, ... },
    "stt": { "available": false, "path": null, "reason": "..." }
  }
}
```

- `degraded` is **present on every frame and empty when nothing is wrong**, so a
  client can tell "nothing to report" from "this build is too old to know"
  (`daemon.py:3418-3421`). The names are `"sessions"` (the durable store could not
  be walked) and `"attention"` (the completion-receipt store could not be read)
  — `daemon.py:146,717-743`.
- `capabilities.stt` gates the voice mic: **an older relay omits the key entirely
  and absence means the same as `available: false`** (`daemon.py:3422-3432`).
- `capabilities.features` is a lazy, memoised flag dict; a missing key means
  "this build does not have it", never an error (`daemon.py:1465-1488`).
  Live sample: `fixtures/relay/http/sessions-empty.json`.

`SessionSummary` — every key, with optionality:

| Field | Type | Notes |
| --- | --- | --- |
| `session_id` | string | durable conversation identity (12 hex chars for phone-started sessions) |
| `section` | `"active" \| "previous"` | the **shared** catalogue `active` rule, not "a live process exists" — a durable conversation with an unseen completion is `active` on every surface (`daemon.py:929-934`) |
| `pinned` | bool | read from the shared `sidebar-pins.json` store; absence on an older relay means `false` |
| `conversation_name` | string | projection name, else the record's, else the durable row's; `""` when unnamed |
| `cwd` | string | |
| `model_label` | string | display label, e.g. `test/mock` |
| `streaming` | bool | |
| `leaving` | string | the record's own phrase when a runtime was **signalled** and is draining; `""` otherwise. Additive (`daemon.py:944-952`) |
| `updating` | string | the build pair while an idle runtime moves to the build on disk; `""` otherwise. Additive (`daemon.py:955-961`) |
| `needs_attention` | bool | an approval/ask is waiting (`daemon.py:962`) |
| `pending_kind` | `"approval" \| "ask" \| ""` | |
| `subagents_running` | `int \| null` | **`null` means "not reported" and must never be read as `0`** — the relay returns `null` for a session it cannot vouch for (degraded dial, stale heartbeat, leaving runtime) (`daemon.py:466-529,966-991`) |
| `subagents_queued` | `int \| null` | same terms as above, deliberately (`web/src/types.ts:330-336`) |
| `todos_open` | int | `pending` + `blocked` across all phases |
| `mtime` | float (epoch s) | |
| `created_at` | float (epoch s) | optional on older relays |
| `completion_kind` | string | `"complete" \| "error" \| "interrupted" \| "closed" \| "retired" \| ""` from the attention store |
| `unseen` | bool | a completion landed that nobody has acknowledged; absence on an older relay means `false` |

Ordering: rows come back **already ordered** by the shared catalogue rank
(tier, wake band, birth, id); the client only groups them into
★ Pinned / Active / Previous and must not re-sort (`daemon.py:1016`, `docs/mobile.md`
§session list). The per-row `degraded`-style marker on the listing is the
top-level `degraded` array above; **there is no per-row degraded flag**.

### 3.3 `GET /api/sessions/past`

```json
{ "sessions": [ { "id": "6714def86197", "name": "Hello from the mock provider",
                  "mtime": 1790727370.33, "forked": false } ],
  "degraded": [] }
```

- **The route takes no query parameters** — `limit` is fixed at 20 in the handler
  call (`daemon.py:4273-4283`), even though `_past_sessions(limit=20)` accepts
  one. A client cannot page this list.
- `forked: true` marks a fork still wearing its parent's title, so it and its
  parent are byte-identical rows separable only by id (`daemon.py:4668-4702`).
- A durable store that cannot be walked answers `degraded: ["sessions"]`
  **with an empty list** — never a silent "you have no conversations"
  (`daemon.py:4695-4699`).
- Live `fixtures/relay/http/past-with-rows.json`, `past-empty.json`.

### 3.4 `GET /api/sessions/search?q=&limit=`

```json
{ "sessions": [ { "id": "…", "name": "…", "mtime": 1.79e9,
                  "body_match": false, "forked": false } ],
  "query": "hello", "degraded": [] }
```

- `limit` default `40`, clamped to `1..200`; a non-numeric limit falls back to
  `40` rather than erroring (`daemon.py:4254-4258`).
- `body_match: true` means the row matched only on what was *said* in the
  conversation, not on its name/id — the UI is expected to mark those so the hit
  does not look arbitrary (`web/src/types.ts:393-395`).
- `query` is echoed so a late response can be matched to its request.
- Live `fixtures/relay/http/search-hit.json`, `search-empty.json`.

### 3.5 `GET /api/sessions/{id}/history?before=&limit=`

```json
{ "entries": [ /* TranscriptEntry */ ], "has_more": true }
```

- `before` = the id of the **oldest entry the client already holds**; the page is
  the entries immediately older than it, chronological within the page
  (`daemon.py:3724-3733`). Without `before` the page is the tail.
- `limit` default `80`, clamped `1..200`; non-numeric falls back to `80`
  (`daemon.py:3746-3750`); live `fixtures/relay/http/history-bad-limit.json` shows
  `limit=abc` answered `200` with a default-sized page, not a 400.
- Unknown id → `404 {"error": "unknown session"}`. A live generation **or** a
  durable user session qualifies; other ids 404 so the route cannot be used to
  probe arbitrary paths (`daemon.py:3739-3745`).
- For a durable-only conversation the fold is disk-only
  (`durable_only=True`); for a live one it may fold through the loaded cache.
- Entry objects are the `TranscriptEntry` shape (§6.1) with `details` populated
  for tool rows; images are references, exactly as on the projection.
- Live `fixtures/relay/http/history-ok.json`, `history-unknown.json`.

### 3.6 `GET /api/sessions/{id}/image?entry=&i=`

- Returns raw image bytes with the stored mime type and
  `Cache-Control: public, max-age=31536000, immutable`. — code
  `daemon.py:3796-3800`; live `fixtures/relay/http/image-ok.json`
- Content key is `(entry id, image-only index)`: `entry` is a globally unique
  message uuid, `i` counts **image blocks only** (a text caption does not shift
  it). The `pid` in the path only routes; a recycled pid maps to a different
  session whose transcript lacks that uuid, which is why `immutable` is safe
  (`daemon.py:3761-3777`).
- Statuses: `400 {"error": "entry id is required"}` when `entry` is missing,
  `400 {"error": "bad image index"}` on a non-numeric `i`,
  `404 {"error": "no such image"}` when the block does not resolve (including an
  out-of-range `i`), `404 {"error": "unknown session"}` for a session with no live
  generation. — live `image-missing-entry-param.json`,
  `image-bad-index.json`, `image-unknown-entry.json`
- **The image endpoint requires a live generation**: `_entry_for_session` is the
  only lookup (`daemon.py:3782-3784`), unlike `/history` which also accepts a
  durable user session. A transcript preview for a **previous** conversation
  therefore cannot render attachments — the client must degrade those to a
  placeholder rather than a broken-image icon.
- Bytes are read back out of the on-disk transcript and base64-decoded; an
  undecodable payload is a logged warning and a `404` (`daemon.py:1925-1970`).

### 3.7 `GET /api/sessions/{id}/agents/{job_id}` and `…/history`

- Detail returns the **full cached descendant state**: every `SubagentRow` field
  **plus** `transcript`, `todos`, the full `prompt`, the full launch message id,
  and `version` (the daemon epoch). — code `daemon.py:3671-3688`,
  `capture_subagent_details` `daemon.py:2159-2260`; live
  `fixtures/relay/http/subagent-unknown.json` for the miss
- The aggregate roster rides the projection **stripped** (`prompt`, `result_text`,
  `error_text`, `transcript`, `todos` emptied) and re-materialised only on this
  route, because the roster is re-sent ~30×/s (`daemon.py:2240-2260`).
- `…/history?before=&limit=` pages one child's transcript, never the root's;
  `limit` default `80`, clamped `1..200`; same body as `/history`.
- Misses: detail → `404 {"error": "unknown subagent"}`; history →
  `404 {"error": "subagent history unavailable"}` (when the child session id is
  unknown) — live `subagent-history-unknown.json`.
- The history route proves the child belongs to this root lineage before reading
  disk; child transcripts are deliberately not public root routes
  (`daemon.py:3690-3709`).

### 3.8 `GET /api/commands`

```json
{ "commands": [ { "name": "help", "description": "List all commands",
                  "aliases": [], "arguments": "none" } ] }
```

- `arguments` ∈ `"none" | "optional" | "required"` (lowercased `ArgumentMode`).
- TUI chrome is excluded by name: `exit`, `quit`, `clear` are absent because they
  are meaningless on a phone (`daemon.py:3228-3249`).
- Cached in-process after the first call (`daemon.py:3231`).
- Live `fixtures/relay/http/commands.json`.

### 3.9 `GET /api/models`

```json
{ "models": [ { "selector": "test/mock", "provider": "test", "model_id": "mock",
                "name": "mock", "label": "test/mock",
                "connected": true, "aggregated": false } ] }
```

- **The array order IS the ranking** — direct-connected providers first, newest
  version first, aggregators last, computed server-side by the same `rank_rows`
  the desktop picker uses. Re-sorting or regrouping client-side throws that away
  (`web/src/types.ts:352-370`, `daemon.py:5002-5131`).
- `name` is the display string; `label` is the parity contract (equal to
  `selector` when no name can be vouched for). Render `name`.
- `connected` = the provider has a credential that can run this model now;
  `aggregated` = the provider resells it.
- Field set is deliberately only what a surface renders — earlier revisions
  shipped `routed`, `context_window`, `input_price`, `output_price` and cost
  159 KB of a 301 KB response on a mobile link (`web/src/types.ts:365-370`).
- Failure → `502 {"error": "…"}` when the catalogue cannot be produced but at
  least one admitted provider has no listings
  (`daemon.py:5111-5130`); an unreadable credential store falls back to the
  **cached** catalogue rather than failing (`daemon.py:5059-5084`).
- The response is **gzipped when the client sends `Accept-Encoding: gzip` and the
  body is ≥ 1024 bytes**; gzip is applied per-route, never as middleware, because
  middleware would buffer the SSE stream (`daemon.py:4817-4902`).
- Live `fixtures/relay/http/models.json` (empty catalogue on an isolated run with no
  provider credentials).

### 3.10 `GET /api/directories`

```json
{ "home": "~", "recent": ["~/work"], "tmp": "/private/tmp" }
```

- `home` is the daemon account's home; `recent` is up to 8 working directories of
  recently active agents from the on-disk registry, deduped, live directories
  only; `tmp` is the resolved system temp dir (on macOS `/private/tmp`, not
  `/tmp`) so it matches the spawn gate's resolved comparison
  (`daemon.py:4262-4271,4754-4800`).
- Live `fixtures/relay/http/directories.json` — the sample is an isolated run, so
  `recent` is empty.

### 3.11 `/login`, `/logout`, `/mark.png`, `/`, `/assets/*`

- `GET /login` → the server-rendered password form (HTML, ~14 KB), or a `303` to
  `/` when already authenticated (`daemon.py:3344-3347`). **This page is the only
  login UI the product ships**; it also carries an inline script that wipes
  `lo-mobile-command:*` / `lo-mobile-draft:*` from browser storage, which is the
  WebKit-safe half of logout (`docs/mobile.md` §Retry-envelope).
- `GET /logout` → `303` to `/login`, `Set-Cookie` clearing `lop_mobile`
  (`Max-Age=0`), and `Clear-Site-Data: "storage"`. It is **not** auth-gated and
  does not check CSRF — a native client calling it must expect to be logged out
  regardless of the cookie it presented. — code `daemon.py:3374-3381`; live
  `fixtures/relay/http/logout.json`
- `GET /mark.png` → the brand mark, public because the login page needs it before
  a cookie exists, `Cache-Control: no-store` (a phone that cached a 404 from a
  build without the asset kept showing a broken image) — `daemon.py:3383-3394`.
- `GET /` → the SPA shell with `no-store`, or `503` plain text
  `mobile web bundle not built — run: cd local_operator/mobile/web && pnpm install && pnpm build`
  when `dist/` is absent. **A native client never calls this**, but it is the
  fastest way to tell "the daemon is up but has no web bundle" apart from "the
  daemon is down". — code `daemon.py:3396-3408`; live
  `fixtures/relay/http/index-authed-no-dist.json`
- `/assets/*` is a `StaticFiles` mount resolved **at app build time**: a rebuilt
  bundle needs `lop mobile restart` to appear, which is the documented upgrade
  path (`daemon.py:4642-4652`).

---

## 4. The mutation routes

### 4.1 `POST /api/sessions/{id}/command` — the single command endpoint

Every mutation travels here, mirroring the registrant's dispatch so the auth gate
lives in one place (`daemon.py:3802-3805`). Body: `{"op": "<op>", ...fields}`.

Handler order (this order is the contract):

1. `gate()` (auth + same-origin).
2. Body must be a JSON **object** → otherwise `400 {"error": "request body must be an object"}`; unparseable JSON → `400 {"error": "invalid JSON"}`. — live `command-body-not-object.json`, `command-bad-json.json`
3. `operator_cap` and `operator_handshake` are **dropped from any body** — they are machine-held proof material, and a value arriving over HTTP can only be a forgery. Dropped rather than refused so a client learns nothing about their shape. — code `daemon.py:3817-3824`
4. `operator_sig`, `operator_cert`, `operator_key_id` **are** admitted (stage D): the phone may sign a challenge the runtime minted for its own connection (`daemon.py:3825-3850`).
5. `op` must be a non-empty string → `422 {"error": "op must be a non-empty string"}`.
6. `validate_control_frame` runs the per-op shape checks (§4.3).
7. `prompt`/`steer` additionally must satisfy `ContinuationCommand.from_json` — **identity is mandatory over HTTP even though protocol-v2 loopback clients remain valid** (`daemon.py:3864-3869`).
8. Dispatch.

Status mapping, which a client should map onto its own retry policy:

| Status | Body | Meaning | Client action |
| --- | --- | --- | --- |
| `200` | `{"ok": true, "detail": "<phrase>"}` | admitted | show `detail` as the receipt |
| `409` | `{"error": "session not connected"}` | no live entry for this id | wake path or reconnect |
| `422` | `{"error": "<prose>"}`, plus `"code"` when the refusal is typed | shape/refusal | **never retry the same bytes** — this is a pre-admission rejection |
| `502` | `{"error": "<≤200 chars>"}` | transport failure between relay and runtime | keep the command, retry (see §5) |
| `504` | `{"error": "session did not answer"}` | runtime accepted but missed the 15 s reply window | ambiguous — keep the command, retry |
| `500`/`503` | route-specific | see the individual routes | |

— code `daemon.py:3924-3953`; live `fixtures/relay/http/command-*.json`.

> `422` and `502`/`504` are **not** interchangeable: only `502/504` leave the
> delivery outcome unknown. `422` is a pre-admission refusal and the retained
> envelope must be discarded, or every later prompt in that conversation will
> refuse the same id (see §5).

`detail` strings observed live (these are the receipts a native UI can surface
verbatim): `prompt admitted`, `already admitted`, `steering queued`,
`snapshot sent`, `pong`, `no turn was running`,
`cancelling at the next tool boundary`, `model: <provider>/<model_id>`.

### 4.2 The op vocabulary

`ControlOp` in `types.py:428-497` is the **relay↔runtime** vocabulary; the
phone-facing subset is enforced by `validate_control_frame` (`types.py:208-427`).
Ops the phone can reach, with the shape the relay validates:

| op | body | Notes |
| --- | --- | --- |
| `prompt` | `{command_id, text, images?}` | durable idempotent user turn; `text` may be empty **only** when an image carries data |
| `steer` | `{command_id, text, images?}` | idempotent mid-turn injection |
| `abort` | `{}` | the stop button; **never kills the session** |
| `cancel` | `{mode?: "graceful"\|"immediate"}` | supervised-agent counterpart of `abort`; default `graceful` lands at a tool boundary |
| `set_model` | `{provider, model_id}` | |
| `set_effort` | `{effort}` | one rung of the model's ladder; on a model with no ladder → `422 {"error": "<model> has no reasoning-effort levels; drop --effort"}` |
| `slash` | `{command, args}` | off-terminal subset; many commands answer `422 {"error": "/<name> is terminal-only here"}` |
| `slash_result` | `{command, args, images?}` | the **routed** slash op — the one authority-increasing commands need (`/approvals auto`, `/mcp reauth`) |
| `approval_answer` | `{request_id, approved: bool, remember?: bool}` | |
| `ask_answer` | `{request_id, value: string}` (`question_index` also sent by the web client) | |
| `snapshot` | `{}` | ask for a fresh welcome-equivalent projection |
| `ping` | `{}` | liveness; answered `{"ok":true,"detail":"pong"}` |
| `recall_steer` | `{command_id}` | unsend one queued steering message; missing → `422 {"error": "that steering message is no longer queued"}` |
| `peer_message` | `{text, mode: mailbox\|steer, wake?, sender?}` | inbound cross-session message |
| `peer_set_model` | `{provider, model_id, sender?}` | |
| `variables` | `{action: list\|set\|update\|delete, key, value, type}` | session code memory |
| `credential`, `register_secret_redaction`, `complete_aside`, `adopt_aside`, `stop`, `retire_if_pristine` | see `daemon.py:3830-3950` | reachable but not phone-surface |

**Two ops are typed in the client but refused by the relay** — a native app must
not build UI on them:

| op | live response |
| --- | --- |
| `new_conversation` | `422 {"error": "start a new session from the session list"}` |
| `resume_session` | `422 {"error": "pick the session from the session list instead"}` |

— live `fixtures/relay/http/op-new-conversation.json`, `op-resume-session.json`; the
supported paths are `POST /api/sessions/start` and `POST /api/sessions/resume`.

Other live refusals worth pinning as copy: `422 {"error": "unknown op: 'frobnicate'"}`
(`command-unknown-op.json`), `422 {"error": "images must be a list of objects"}`
(`op-prompt-images-not-list.json`),
`422 {"error": "input_mode must be one of 'typed', 'dictated' or 'mixed'"}`
(`op-steer-bad-input-mode.json`), `422 {"error": "command_id must be a valid UUID"}`
(`command-invalid-uuid.json`), `422 {"error": "command_id must be a UUID string"}`
(`command-missing-command-id.json` — a different sentence for the *missing* case
than for the *malformed* one).

### 4.3 Shape validation, per op

`validate_control_frame` (`types.py:208-427`) — a summary of what it rejects:

- `prompt`/`steer`: `text` non-empty **or** at least one image with non-blank
  `data_b64`/`data`; `images` a list of objects; `input_mode` ∈
  `typed|dictated|mixed`; `input_path` a bounded string (≤ 96 chars); when
  `command_id` is present it must parse as a UUID.
- `approval_answer`: `request_id` non-empty string, `approved` a bool,
  `remember` a bool when present (live: `{"error": "approved must be a boolean"}`).
- `ask_answer`: `request_id` non-empty, `value` a string.
- `slash`/`slash_result`: `command` non-empty, `args` a string (may be empty).
- `cancel`: `mode` ∈ `graceful|immediate`.
- `credential`, `variables`, `peer_message`, `peer_set_model`,
  `register_secret_redaction`, `complete_aside`, `adopt_aside`, `recall_steer`:
  see `types.py:311-427`.
- `operator_sig` ≤ 160 chars and even-length hex; `operator_cert` a bounded
  string ≤ 4096; `operator_key_id` a hex id; `operator_cap` (if a client sends
  one) must be wire-hex — but the command route strips it first.

### 4.4 `POST /api/sessions/start`

Request `{"cwd"?: string, "provider"?: string, "model_id"?: string}`;
`cwd` defaults to the daemon account's home.

- `cwd` is expanded and **resolved**, then must be an existing directory **under
  the owner's home or under the resolved temp dir**; anything else →
  `400 {"error": "not an allowed start directory: <raw>"}` (live
  `fixtures/relay/http/start-bad-cwd.json`). Both bounds are resolved so a symlinked
  `/tmp` still matches (`daemon.py:4764-4773`).
- Success: `{"ok": true, "pid": <int>, "session_id": "<12 hex>"}`, where
  `session_id` is minted **before** the spawn so the child, the response and the
  first SSE frame all agree (`daemon.py:4178-4181`).
- The session is spawned as a **supervised child process** running
  `python -m local_operator.session.runtime.process`, so a daemon restart costs
  the phone its view, never the session its work (`daemon.py:3044-3057`).
- The call waits up to `SESSION_START_TIMEOUT_S = 30 s` for the child to publish
  its discovery record; a child that exits first →
  `500 {"error": "session exited before becoming ready; check mobile logs"}`
  (`daemon.py:110,3121-3135`).
- An observer daemon (`LO_MOBILE_NO_DIAL=1`) refuses:
  `RuntimeError("observer daemon cannot start sessions")` → `500`
  (`daemon.py:3059-3062`).
- **Idempotent per session id while a start is in flight**: concurrent callers
  await the same task (`daemon.py:3019-3042`).
- Live `fixtures/relay/http/start-session.json`, `start-session-2.json`.

### 4.5 `POST /api/sessions/resume`

Request `{"session_id": string}`.

- Missing/blank → `400 {"error": "session_id is required"}`;
  unknown → `404 {"error": "no such past session: <id>"}` (live
  `fixtures/relay/http/resume-no-id.json`, `resume-unknown.json`).
- Success: `{"ok": true, "pid": <int>, "session_id": "<same id>"}`. The resumed
  runtime's cwd is `Path.home()`, **not** the conversation's recorded cwd
  (`daemon.py:4230-4231`) — the client must not promise that resuming restores
  the working directory; if the user then wants another cwd, that is `move`.
- A session already live is adopted rather than duplicated
  (`daemon.py:3063-3078`).

### 4.6 `POST /api/sessions/{id}/seen` — the unread acknowledgement

Request `{"completion_token": "<uuid>"}`.

| Case | Response |
| --- | --- |
| no live entry **and** no durable user session | `404 {"error": "unknown session"}` |
| unparseable JSON body | `422 {"error": "completion_token is required; update the client"}` |
| `completion_token` absent or not a string | `422 {"error": "completion_token is required"}` |
| a **real** token a newer completion has replaced | `409 {"error": "completion token superseded by a newer completion", "code": <SUPERSEDED_TOKEN_CODE>}` |
| an unknown token | `409 {"error": "unknown completion token"}` |
| success | `200 {"ok": true, "attention": <state>}` |

— code `daemon.py:3540-3594`; live `seen-missing-token.json`,
`seen-unknown-session.json`, `seen-real-token.json`.

The token is the `attention.completion_token` the projection carried. On the
superseded branch the remedy differs: re-read the projection and acknowledge the
token it now names (`daemon.py:3574-3588`). A success invalidates the listing
cache and wakes the list stream so the next paint already shows the truth
(`daemon.py:3591-3593`).

### 4.7 `POST /api/sessions/{id}/pin` — the shared pin store

Request `{"pinned": <bool>}` — **desired state, not a toggle**, so a retried
request cannot flip the pin back (`daemon.py:3596-3611`).

| Case | Response |
| --- | --- |
| unknown session | `404 {"error": "unknown session"}` |
| `pinned` not a strict bool (e.g. `1`) | `422 {"error": "pinned (a boolean) is required"}` |
| `pinned: true` but the conversation has **no durable folder yet** | `409 {"error": "no saved messages yet — pin it after you send one"}` |
| success | `200 {"ok": true, "pinned": <state read back>}` |

— code `daemon.py:3618-3669`; live `pin-true.json`, `pin-not-bool.json`,
`pin-unknown.json`.

The body of a `200` is **the state the store read back**, not the state that was
asked for, so a caller cannot be told a pin the reader pruned
(`daemon.py:3667-3669`). Both branches are the same file the TUI's `F10` and the
desktop action write (`sidebar-pins.json`), so a pin is one fact across three
surfaces.

### 4.8 `POST /api/sessions/{id}/operator/challenge` — the signing flow

Request `{"action": "loosen"|"approve", "request_id"?: string}`.

- Authority-bearing fields (`operator_cap`, `operator_sig`, `operator_key_id`,
  `operator_cert`) are stripped from **this** body only: this endpoint's whole
  output is a challenge, so a body carrying proof material is a caller confusing
  two endpoints (`daemon.py:3987-3995`).
- Success: `{"challenge": "<hex>", "expires_s": <int>, "session_id": "...",
  "action": "...", "request_id": "..."}`.
- `422 {"error": "action must be 'loosen' or 'approve'"}`; `409 {"error":
  "session not connected"}` when there is no live entry; `504` when the runtime
  does not answer; `502` on transport failure; `502 {"error": "the session sent
  no challenge"}` when the reply carried none. — live
  `operator-challenge-bad-action.json`, `operator-challenge-unknown-session.json`
- The challenge is **single-use and bound to
  `(connection, session_id, action, request_id)`**, and it is minted on the
  relay's own persistent connection to that session — a challenge minted
  anywhere else is refused by the runtime. Sign it and present the signature on
  the **command** route, which is the one narrowed to admit it. A second
  presentation of the same challenge finds nothing (`daemon.py:3955-3975`,
  `daemon.py:3835-3843`).

### 4.9 `POST /api/pair` and `GET /api/pair/{device_id}`

- `POST /api/pair` body `{"code": string, "spki": base64url uncompressed P-256
  point, "name"?: string}`. A wrong code and no live code are answered
  **identically** with `403 {"error": "that pairing code is not valid"}` — the
  distinction would tell a guesser whether a pairing window is open
  (`daemon.py:4064-4071`). A malformed `spki` → `422 {"error": "spki must be an
  uncompressed P-256 public point, base64url"}`; a revoked device →
  `403 {"error": "this device has been revoked"}`; success →
  `{"ok": true, "device_id": "<hex>"}`.
- `GET /api/pair/{device_id}` → `{"paired": false, "device_id": "…"}` when
  unknown (live `pair-status-unknown-device.json`) or
  `{"paired": true, "device_id", "certificate", "operator_key_id", "scope",
  "exp", "name", "authority_ready"}` when paired. `authority_ready` is false
  between `lop operator init` and `lop operator install` — the state an older
  UI lied about (`daemon.py:4120-4143`).
- A non-hex device id is **not** an error: live `pair-status-bad-id.json` returns
  `200 {"paired": false}`. Only an id that parses as hex but fails the store
  raises `422 {"error": "bad device id"}`.

### 4.10 `POST /api/transcribe` — voice input

Multipart form: required file field `audio`; optional string fields `language`,
`prompt`, `model`.

| Case | Response |
| --- | --- |
| declared `Content-Length` > 20 MB + 1 MB | `413 {"error": "Recording is too large — the limit is 20 MB. Try a shorter clip."}` |
| malformed multipart | `422 {"error": "invalid multipart body"}` |
| `audio` not a file | `422 {"error": "audio file is required"}` |
| empty payload | `422 {"error": "audio file is empty"}` |
| payload > 20 MB | `413` (same copy as above) |
| mime not in the allowlist | `422 {"error": "Unsupported audio format: <mime or 'unknown'>."}` |
| no transcription backend | `503 {"error": "Voice input isn't available on this machine.", "code": "stt_unavailable"}` |
| provider refusal | provider-mapped status and body via `describe_stt_failure` |
| unexpected fault | `500 {"error": "Voice input failed unexpectedly."}` |
| success | `{"text", "provider", "model", "path"}` |

Limits and allowlist: `STT_MAX_UPLOAD_BYTES = 20 MB`; mimes `audio/mp4`,
`audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/wav`, `audio/x-m4a`, `audio/aac`
— `daemon.py:156-173`. Live `transcribe-413-declared.json`,
`transcribe-missing-audio.json`, `transcribe-bad-mime.json`.

The `capabilities.stt` block on the list payload is what decides whether the
client shows a mic at all (§3.2).

### 4.11 Project routes

`GET /api/projects` → `{"projects": [ProjectSummary]}`; `POST /api/projects`
(create); `GET|PATCH|DELETE /api/projects/{key}`; `POST
/api/projects/{key}/milestones`; `DELETE /api/projects/{key}/milestones/{name}`;
`POST /api/projects/{key}/links`; `DELETE /api/projects/{key}/links/{session_id}`.

A non-object body → `400 {"error": "request body must be an object"}`. All
failures flow through `mobile_projects.ProjectRouteError` →
`{"error": <message>, "code": <code>}` with the error's own status
(`daemon.py:4441-4446`). Shapes mirror the desktop wire models
(`web/src/types.ts:479-582`); `ProjectMilestone.status` is **derived**
server-side (`completed|overdue|upcoming`) and must not be recomputed by the
client. Live `fixtures/relay/http/projects-empty.json`.

---

## 5. Idempotency, the retry envelope, and what "already admitted" means

Three layers cooperate, and a native client must implement all three.

### 5.1 Client side: the persisted retry envelope

The web client's source of truth is `web/src/continuation-command.ts`, described
in `docs/mobile.md` §Retry-envelope. What it means for a native port:

- The envelope is **the exact bytes of an instruction whose delivery outcome is
  unknown**, keyed per session (`lo-mobile-command:<sessionId>`), and its UUID
  **is the identity of that body**: a retry replays the *same* `command_id`.
- **Keep** the envelope across anything ambiguous: transport failure, HTTP
  `502`/`504`/`408`, app reload, SSE reconnect, and navigating between the
  owner's own conversations.
- **Clear** it on a definitive end of that UUID's ambiguity: a definitive
  acknowledgement, a pre-admission rejection (**any 4xx/5xx except
  408/502/504**), a 24 h TTL, explicit discard, or logout / identity change / 401.
- Envelopes are bounded by **count**, oldest evicted, never the active route.
- Logout clears all scoped storage; on WebKit the clearing is done by the login
  page's own inline script plus the 401 handler, **not** by trusting
  `Clear-Site-Data`, which WebKit may ignore.

Status → action, as the client must read it:

| Response | Envelope |
| --- | --- |
| `200` | clear (definitive acknowledgement; `detail` may be `already admitted`) |
| `401` | clear all scoped storage and re-authenticate |
| `408`, `502`, `504` | **keep**, retry with the same `command_id` |
| every other 4xx/5xx | clear — pre-admission rejection |
| no response (transport failure) | keep |

### 5.2 Relay side: the same id, twice

- Over HTTP, `prompt`/`steer` **must** carry a UUID `command_id`
  (`daemon.py:3864-3869`); without one the request is a `422`.
- The relay forwards the frame; it does not itself de-duplicate. It fits the
  frame to the socket first and raises `OversizedRequest` (a `ValueError` → `422`)
  *before* registering a pending future, so a refusal never leaves a parked
  request behind (`daemon.py:2771-2786`, `attach_client.py:323-368`).

### 5.3 Runtime side: the durable identity ledger

`CommandReservations` (`command_reservation.py:18-120`) keeps the invariant that
matters: **`reserve` answers "already admitted" only for an identity that is
durably in the transcript or live in the pending map.** A refused command is
fully *released*, so the client's retry of the same id really does admit it —
the failure mode this closed was a prompt parked as `prompt-transfer` that then
answered "already admitted" to a retry while the message was in no transcript and
no queue (a silent drop, 2 of 19 race runs). Steering capacity is bounded at
`MAX_PENDING_STEERS = 32`.

The runtime's ack carries both the sentence and the flag:

```jsonc
{"op": "ack", "req": <int>, "detail": "already admitted", "duplicate": true}
```

— `session/runtime/server.py:5830-5866`. The relay maps an ack to
`{"ok": true, "detail": "<detail>"}` (`daemon.py:3953`), so **the `duplicate`
flag itself is not visible over HTTP**; a client sees `detail == "already
admitted"`. Live `fixtures/relay/http/command-prompt-duplicate.json` — the identical
`command_id` sent twice returned `200 {"ok": true, "detail": "already admitted"}`
and **no second row appeared in the transcript** (`command-prompt-ok.json` then
the duplicate; the projection showed one user row).

### 5.4 A live receipt ladder (what a composer should show)

Observed on the isolated daemon, in order, for one session:

1. `prompt` → `200 {"ok": true, "detail": "prompt admitted"}`
2. the row appears in the next projection frame (`version` bumped);
3. with the turn still streaming, a second `prompt` for a *different* id is
   admitted too — the runtime queues it;
4. `steer` while a turn runs → `200 {"ok": true, "detail": "steering queued"}`
   and `queued_count` goes to `1` in the frame;
5. `abort` with nothing running → `200 {"ok": true, "detail": "no turn was running"}`.

---

## 6. SSE in detail

There are exactly **two** streams, both snapshot-based, both with the same
framing.

### 6.1 `GET /api/sessions/events` — the list stream

- Frames: `event: sessions` + `data: <the same body as GET /api/sessions>`.
- Opens with one immediate frame, then one per list change. — code
  `daemon.py:3514-3538`
- Changes that wake it: a projection arriving from a runtime (which bumps a row's
  streaming/attention), a session appearing/disappearing, a pin written, a
  `/seen` acknowledgement (`daemon.py:1019-1037,3593,3666`).

### 6.2 `GET /api/sessions/{id}/events` — one session's projection

- Frames: `event: projection` + `data: <SessionProjection>`.
- The **seed frame**: the current projection is sent immediately so a
  reconnecting client renders without waiting for a change. If no live entry
  exists, the daemon folds the durable transcript and seeds from that
  (`daemon.py:3474-3484`).
- Then one frame per change, where "change" is any runtime frame the relay folds
  — i.e. **roughly every streaming token batch**, not per token
  (`daemon.py:3485-3488`).
- The subscriber's queue is `maxsize=8`; when it is full the **oldest** frame is
  dropped and the newest pushed (`daemon.py:3463`, `_fan_out` `daemon.py:1973-1998`).
  A snapshot protocol can afford that; a delta protocol could not.
- On the last subscriber leaving, the relay tells the runtime `unwatch` and
  prunes the projection generation (`daemon.py:3492-3501`).

### 6.3 Framing, keep-alives and headers

```
event: projection
data: {"session_id": "…", …}

: keepalive

```

- The keep-alive is an **SSE comment** (`: keepalive`) sent after
  `SSE_KEEPALIVE_S = 25 s` with no frame, and it arrives as a bare line plus a
  blank line — it carries no `event:` name. — code `daemon.py:105,3489-3490,
  3529-3530`; live, captured at t≈28.9 s of quiet in
  `fixtures/relay/sse/sse-keepalive.txt`
- Response headers on both streams: `content-type: text/event-stream;
  charset=utf-8`, `cache-control: no-cache, no-transform`,
  `x-accel-buffering: no` (the last is what turns buffering off at
  nginx-family proxies) — `daemon.py:3503-3512,3534-3538`.
- `SessionEventResponse` explicitly closes its body iterator in a `finally`, so a
  cancelled proxy stream does not leave an unseen subscriber pinning a viewer
  forever (`daemon.py:3274-3284`).

### 6.4 Reconnect and resync

A client may reconnect at any time: every frame is a full repaint, so there is no
resync protocol. The rules that make that safe:

- **One writer per session at a time is not required** — the stream is
  read-only, and multiple subscribers are normal (`first_watcher` only decides
  whether to tell the runtime it is being watched, `daemon.py:3465-3473`).
- A reconnecting client should treat its **first frame after reconnect as
  authoritative** even if its `version` looks older than the last one it held:
  the web client resets its ordering guard exactly there
  (`web/src/store.ts:257-300`, `awaitingSnapshot`). The reason is that the
  daemon's epoch counter can restart across a reconnection, which is a different
  thing from a stale frame.
- Between frames the client must show **stale-but-labelled**, not blank: the web
  client keeps the last good projection and only flips a `connected` flag
  (`web/src/store.ts:288-300`).

### 6.5 Generation/epoch fencing — `version`

`SessionProjection.version` is **not** a per-process counter: it is an epoch the
daemon computes so that a session's projections order monotonically *across
process replacements* (`_projection_generations`, `daemon.py:2153-2340`).

- The daemon identifies a runtime generation by `(pid, started_at, control_key)`
  — pid alone is reusable, and the control key is regenerated per registration
  (`daemon.py:2196-2205`).
- `epoch = max(state.epoch + 1, projection.version)` on a generation change;
  otherwise `epoch = offset + projection.version` (`daemon.py:2265-2290`).
- A frame from a **retired** identity is fenced: `_StaleProjection` is raised and
  the frame is dropped (`daemon.py:2211-2224`). The retired set is bounded to the
  last 8 identities (`daemon.py:2284-2288`).
- A **durable fold carries no process identity**, so it re-materialises at the
  retained epoch and never reopens a generation (`daemon.py:2238-2250`). That is
  what makes `/history`, subagent detail and a reconnecting SSE succeed after the
  payload was evicted, instead of fencing to a 500.
- The retained projection map is bounded: `MAX_RETAINED_SESSION_PROJECTIONS = 64`,
  evicting oldest-first and pruning the matching generation and subagent details
  with it (`daemon.py:119,2255-2262`).

> **Client rule.** Compare `version` **only within one stream connection** and
> only after the first frame; drop `incoming.version < current.version`. Never
> persist a version across connections, and never infer "the session restarted"
> from a version drop — the seed frame after reconnect is authoritative
> (`web/src/store.ts:270-286`).

**A projection's `pid` can be `0`.** A durable re-materialisation (the fold after
a runtime died) is published with `pid: 0` and `kind: "daemon"`, and its
`ended`/`degraded` fields are **both `false`**. Live proof:
`fixtures/relay/sse/sse-projection-durable-after-death.json`, captured ~5 s after the
runtime was SIGKILLed — the last frame for that session had `pid: 0`, the
transcript from disk, and `ended: false`. The list stream, one frame later, moved
the row to `section: "previous"`.

> **Consequence for the app.** `ended` and `degraded` on the projection are
> effectively **not usable signals** over the relay: `projection.degraded` is
> assigned `False` on every write path the relay owns
> (`daemon.py:1301,1633,3902`) while the flag exists only on the *entry*
> (`entry.degraded`, set on a wedged registration, `daemon.py:2531`); and the
> durable frame after a death carries `ended: false` too. A native client must
> derive liveness from **the listing row** (`section`, `subagents_running: null`,
> vanishing `streaming`) and from **SSE silence**, not from those two fields.

**Measured: `subagents_running: null` is the relay's unreachable-runtime signal.**
With the runtime's process frozen (`SIGSTOP`, so the record stays published and
the socket stays open but nothing beats), the list row was polled every 5 s
(`fixtures/relay/probes/wedged-row-signal.json`):

| Time since freeze | `subagents_running` | `section` | `streaming` |
| --- | --- | --- | --- |
| 5–35 s | `0` | `active` | `false` |
| 40–75 s | `null` | `active` | `false` |

The transition happens at `HEARTBEAT_TIMEOUT_S = 45 s`
(`session/runtime/types.py:416-417`; `_advertisable_counts` refuses to report
counts for a registration it cannot vouch for, `daemon.py:512-519`). Note what
does **not** change: the row stays `active`, and no `degraded` marker appears
anywhere. So a "this conversation is unreachable" affordance must key on
**`subagents_running` flipping to `null`** against a row that previously
reported `0` — a two-sample comparison, not a flag.

### 6.6 Payload size, and why frames get degraded

- `PROJECTION_TRANSCRIPT_LIMIT = 80` rows, and the **first user message is pinned
  at the head** so a long session never loses the row that names the
  conversation (`types.py:980`, `projection.py:3127-3153`).
- `PROJECTION_FRAME_SOFT_CAP_BYTES = 700_000`. Past it the frame is degraded in
  tiers, losslessly for the collapsed view; the retained projection object is
  untouched (`projection.py:193,855-1150`). Floor lengths: prompt 120,
  result 200, error 400, transcript tail 16, entry text 4 000 → 200
  (`projection.py:200-250`).
- Tool-row expand payload: `output` keeps the **last 8 000 chars**, each args
  value is compacted to **4 000**, diff fields ride through whole
  (`projection.py:144-147,441-463`).
- Subagent roster rows: launch prompt preview 1 000, `result_text` 200,
  `error_text` 2 000 (`projection.py:160-181`). The full prompt/result/transcript
  are reachable only through the detail route (§3.7).
- The hard ceiling is the control socket's `_MAX_LINE_BYTES = 1 << 20`; a frame
  over it is dropped, and a flood of drops starves the daemon loop for **every**
  session (`projection.py:193-199`, `attach_client.py:144-148`).

### 6.7 What a projection frame carries

`SessionProjection` — `types.py:798-897`; live samples under `fixtures/relay/`.

| Field | Type | Notes |
| --- | --- | --- |
| `session_id` | string | |
| `pid` | int | **`0` on a durable re-materialisation** |
| `kind` | string | `tui` \| `exec` \| `daemon` |
| `conversation_name`, `cwd`, `model_label`, `model_selector` | string | `model_selector` is `provider/model_id` — the model sheet's value |
| `effort`, `effort_ladder` | string, string[] | `effort` is `""` when the model has no ladder |
| `streaming` | bool | |
| `activity` | string | e.g. `thinking`, `responding`, or the running tool's intent |
| `activity_started_s` | `float \| null` | **`null` means withhold the digits**, `0.0` is a real known zero (`types.py:820-836`) |
| `stop_reason` | string | `""` until a turn ends, then `completed` \| `aborted` |
| `cut_off` | bool | whether the `aborted` turn was cut off rather than stopped on purpose; **additive**, older relays omit it |
| `queued_count` | int | user messages waiting for a turn boundary |
| `ended` | bool | declared, but see §6.5 — not usable over the relay |
| `degraded` | bool | declared, but see §6.5 — never published `true` |
| `transcript` | TranscriptEntry[] | tail, ≤ 80 rows |
| `todos` | TodoPhase[] | one implicit `"Todos"` phase carries a flat list and renders headerless |
| `subagents` | SubagentRow[] | **stripped** aggregate; sorted `running` first then by `job_id` |
| `pending` | PendingRequest \| null | the front waiting request |
| `pending_count` | int | ≥ 1 while `pending` is set; a parallel tool batch can open several |
| `usage` | `Record<string,int>` | `input_tokens`/`output_tokens` |
| `cumulative_parent_cost` | `float \| null` | `null` = money we cannot state, distinct from a real `0.0` |
| `child_costs` | `Record<string,float>` | empty means "no children", never "children cost nothing" |
| `subagent_cost`, `subagent_cost_knowledge` | `float \| null`, string | the owner ledger that **supersedes** `child_costs`; a reader must use one or the other, never add both |
| `cost_knowledge` | string | `unknown\|exact\|partial\|floor` for the parent figure |
| `context_tokens`, `context_window`, `context_is_estimate` | int, int, bool (all nullable) | `context_window` `null`/`0` = unknown, so no percentage is possible; the client spells `12.4k/—` |
| `version` | int | the epoch (§6.5) |
| `attention` | object | added by the frame builder, not the dataclass (`daemon.py:1790`); `{conversation_id, completion_token, anchor_id, kind, reason, cause, notify, unseen, revision}` |

The frame builder additionally **fills** `stop_reason`/`cut_off` from the durable
attention record when the fold never saw a turn end (a runtime killed mid-turn),
and appends a `notice` transcript row for `error`/`interrupted`/`closed`/`retired`
outcomes with the sentence and severity taken from `harness/rows.py`
(`daemon.py:1764-1869`). A client must not synthesise such a row itself.

`TranscriptEntry` — `types.py:551-600`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | message uuid for messages, `tc-<tool_call_id>` for tool rows, a synthetic `nt-<…>` for notices |
| `kind` | `user\|assistant\|tool\|notice\|steer\|compaction\|parent_message\|subagent_message\|peer_message\|reasoning` | an unknown kind must render through a fallback, not crash |
| `text` | string | |
| `tool_call_id`, `tool_name` | string | |
| `tool_state` | `composing\|queued\|running\|done\|failed\|interrupted` | **default is `interrupted`**, deliberately: a row whose state nobody set is a call nobody saw return (`types.py:561-577`) |
| `summary`, `intent` | string | one-line args summary; the model's own narration |
| `diff_added`, `diff_removed` | int | |
| `elapsed_s` | float | |
| `error` | string | |
| `details` | object | expand payload: `args` (dict **or** string), `output` (string), `diff` (string **or** string[]), `partial`, `sender`, `severity` (`info\|warning\|error`), `notice_kind` (`wake`), `user_run` (bang-mode: the card opens expanded) |
| `images` | `{index, mime_type}[]` | **references only**; bytes come from `/image` |
| `final` | bool | assistant rows stream; flips true on message end |
| `text_complete` | bool | settled streaming ≠ complete representation; transport caps can replace the row with a prefix while keeping its message id |

`PendingRequest` — `types.py:701-747`: `request_id`, `kind (approval|ask)`,
`title`, `detail`, `options [{label, description}]`, `secret` (render a **masked**
field; the value never rides the projection), `question_index`, `question_total`,
`recommended` (index into `options` **as carried** — do not re-sort), `persist`
(store the credential rather than keep it in session memory). All fields after
`detail` are defaulted **on purpose**, because a new viewer reading an old payload
would otherwise raise `TypeError` and crash the ask card.

`SubagentRow` — `types.py:637-677`: `job_id`, `label`, `agent`, `status`
(`running|completed|failed|cancelled|parked|queued`), `progress`,
`elapsed_s (float | null)` — **`null` means no age, and must not be painted as
`0s` counting from the client's mount** — `model_label`, `result_text`,
`error_text`, `parent_job_id`, `session_id`, `prompt`, `launch_message_id`,
`effort`, `ancestors`, `ancestor_ids`, `child_ids`, `peer_ids`, `transcript`,
`todos`, `activity`. On the projection, `prompt`/`result_text`/`error_text`/
`transcript`/`todos` are **stripped to empty** — read them from the detail route.

---

## 7. Session states the relay can produce

The canonical list a test matrix should cover, each with how it is reached:

| State | How the relay signals it |
| --- | --- |
| **empty list** | `sessions: []`, `degraded: []` (live `sessions-empty.json`) |
| **loading** | no frame yet — there is no "loading" body; the first frame is the seed |
| **degraded listing** | `degraded: ["sessions"]` and/or `["attention"]` on the list body, possibly with rows |
| **live idle** | row `section: active`, projection `pid > 0`, `streaming: false` |
| **streaming** | `streaming: true`, `activity` non-empty, `activity_started_s` a number or `null` |
| **composing a tool** | a `tool` row with `tool_state: composing` or `queued` |
| **queued steer** | `queued_count > 0` and a `steer` row in the tail |
| **pending approval** | `pending.kind == "approval"`, `pending_count ≥ 1`, listing `needs_attention: true`, `pending_kind: "approval"` (live `sse-projection-pending-approval.json`) |
| **pending ask** | same with `kind == "ask"`; `options` may be empty (free-text/secret) |
| **terminal-only slash refusal** | a `422` from `slash` naming the command |
| **aborted (resume)** | `stop_reason: "aborted"`, `cut_off` true only for the involuntary arm |
| **completed turn** | `stop_reason: "completed"`, `attention.kind: "complete"`, often `unseen: true` |
| **unread** | row `unseen: true`, `completion_kind: "complete"` |
| **subagent running/queued** | roster rows with `status`, plus the parent row's `subagents_running`/`subagents_queued` (**`null` = not reported**) |
| **leaving / updating** | the row's `leaving` / `updating` strings, additive fields |
| **degraded dial** | **not directly signalled** — `entry.degraded` never reaches the projection (§6.5); infer from `subagents_running: null` plus SSE silence plus a row that stops changing |
| **wedged runtime** | heartbeat older than `HEARTBEAT_TIMEOUT_S = 45 s`; **measured**: the listing row's `subagents_running` flips `0` → `null` while `section` stays `active` (fixtures/relay/probes/wedged-row-signal.json, §6.5) |
| **ended** | the runtime is reaped; the row flips to `section: "previous"` and one final durable frame is published with `pid: 0`, `ended: false` (live `sse-projection-durable-after-death.json`) |
| **woken** | `prompt` on a durable-only conversation returns `200 {"detail": "prompt admitted"}` and the relay spawns a host process (live `command-prompt-wake-durable.json`, `list-after-wake.json`) |
| **auth lost** | `401 {"error": "authentication required"}` on any `/api/*`; on an SSE stream, the 401 is **not visible to EventSource** — a native client must check the status itself or it will retry forever |
| **command refusal** | `422` with prose (+ optional `code`), or `502`/`504` for the ambiguous pair |

---

## 8. Known gaps and risks to design around

1. **No per-session HTTP GET.** Single-session state is SSE-only or listing-only.
2. **`ended` / `degraded` are unusable over the relay** (§6.5). Do not build a
   banner on them; build it on `section` + silence.
3. **No `Cache-Control` on JSON API responses** (`secure_cookie` is dead code,
   §1.3). The client must own its caching policy.
4. **`/api/sessions/past` cannot be paged** (no `limit` parameter, §3.3).
5. **`/api/sessions/{id}/image` needs a live generation**, so attachments in
   *previous* conversations cannot be rendered (§3.6).
6. **A 401 on an SSE stream is invisible to an `EventSource`-shaped client**; it
   must be detected at the transport layer and must trigger re-auth rather than
   backoff-forever.
7. **`new_conversation` / `resume_session` command ops are refused**; use the
   dedicated routes (§4.2).
8. **`resume` does not restore the conversation's cwd** (it uses the account
   home, §4.5).
9. **Image ingest is best-effort and silent.** `image_blocks` (`server.py:119-186`)
   drops an entry whose base64 is invalid, whose bytes do not sniff as an image,
   or whose payload cannot be bounded — and the command still answers `200`.
   A prompt that carried a bad attachment is indistinguishable from one that did
   not, so the app should verify its own attachments before sending and should
   not promise delivery in the receipt copy.
10. **Prompt images are refit to fit one socket line** (`attach_client.py:323-368`):
    each image is re-encoded (JPEG at full resolution first, downscaling only if
    needed) so N images fit *together* under `1 << 20` bytes minus measured
    overhead; only an image that cannot fit at its tightest rung is refused, and
    the refusal names the attachment by its composer chip number. A native client
    should bound its own picks (the web client downscales to 1568 px, PNG stays
    PNG, others JPEG 0.9, ≤ 8 images) rather than relying on the relay's refit.
11. **The list stream's queue is 8 deep and drops oldest** (§6.2): a client that
    stalls while consuming will simply miss intermediate frames. That is safe
    because frames are full repaints — but only if the client renders the newest
    frame it has, never a queue it believes is complete.
12. **Nothing here is versioned per route.** The only version marker is
    `/healthz`'s `version` (`5`) and the per-op `ProtocolVersion` comments in
    `types.py:428-512`; additive fields are the compatibility mechanism, and the
    documented rule is that a client must tolerate their absence.
