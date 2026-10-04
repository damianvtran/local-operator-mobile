# The `lop mobile` relay wire contract

Everything the native client must do against the relay, derived from the code
rather than from prose.

> **Which tree these citations are against.** Every `file:line` in this document
> is against local-operator **`fc851a94e` (2026-09-30)** — the merge of #1784,
> which added the session-state receipts (§3.2, §6.5) — reachable with
> `git -C <local-operator> show fc851a94e:<path>`. Do **not** re-check them in the
> shared checkout's working tree: it carries another session's staged,
> partially-reverted `local_operator/mobile/daemon.py` (3,696 lines in the tree
> against 5,381 at `HEAD`), so a tree read returns wrong line numbers for every
> daemon citation here. Fetch before trusting a tracking ref.
>
> **Ref-pinned, and relocated once.** Round 1 of this document cited `52c1df35`;
> every citation was then re-resolved to `fc851a94e` by line map, and each one
> checked to land on a line whose text is byte-identical across the two refs, so
> nothing changed meaning in the move. An older copy of this file carries the old
> numbers.

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
| Wire encoding | JSON, UTF-8. SSE frames use the `event:`/`data:` pair with a blank-line terminator | `daemon.py:4752-4753` |
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
   `daemon.py:3424-3447`; live `fixtures/relay/http/login-success.json`,
   `login-wrong-password.json`
3. **Failure shape splits by audience.** An unauthenticated `/api/*` request gets
   `401 {"error": "authentication required"}`; any other path gets `303` to
   `/login`. A native client must therefore never treat "got HTML back" as a
   transport bug — it is the login redirect. — code `daemon.py:3382-3397`; live
   `fixtures/relay/http/unauth-api-sessions.json`, `unauth-index.json`

Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`;
`Secure` **only** when the request arrived over TLS (the tunnel case), because
plain-loopback first-run must still be able to set it. — `daemon.py:3437-3446`,
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
  `daemon.py:3368-3385`; live `fixtures/relay/http/mutation-cross-origin.json` (`403`)
  and `command-no-origin-post.json` (`200`)

### 1.3 What the relay does *not* set

`secure_cookie()` (`daemon.py:3399-3404`) sets `Cache-Control: no-store` and is
**never called** — grep finds its definition only. Consequence, **verified live**:
JSON API responses carry **no `Cache-Control` at all**
(`fixtures/relay/http/sessions-empty.json` has no such header), so they are
heuristically cacheable by any intermediary. A native client must not rely on
the relay to forbid caching: set its own no-store policy for API responses.
The routes that *do* set cache headers are the SSE streams
(`no-cache, no-transform` plus `X-Accel-Buffering: no`), the image endpoint
(`public, max-age=31536000, immutable`), and the SPA shell / mark / login page
(`no-store`). — code `daemon.py:3468,3407,3507,3537,3799`

---

## 2. Route table

`build_app` at `daemon.py:3333`; the table itself at `daemon.py:4675-4725`.
`auth` column: **gate** = the `gate()` split above; **public** = no cookie.

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/healthz` | public | `daemon.py:3411-3417` |
| GET | `/login` | public (redirects when authed) | `daemon.py:3419-3422` |
| POST | `/login` | public | `daemon.py:3424-3447` |
| GET | `/logout` | public | `daemon.py:3449-3456` |
| GET | `/` | gate | `daemon.py:3471-3483` |
| GET | `/assets/*` | **public** (StaticFiles mount) | `daemon.py:4733-4740` |
| GET | `/mark.png` | public | `daemon.py:3458-3469` |
| GET | `/api/sessions` | gate | `daemon.py:3520-3524` |
| GET | `/api/sessions/events` | gate | SSE, `daemon.py:3602-3626` |
| POST | `/api/sessions/start` | gate | `daemon.py:4239-4280` |
| GET | `/api/sessions/past` | gate | `daemon.py:4361-4371` |
| POST | `/api/sessions/resume` | gate | `daemon.py:4282-4323` |
| GET | `/api/sessions/search` | gate | `daemon.py:4325-4348` |
| GET | `/api/directories` | gate | `daemon.py:4350-4359` |
| GET | `/api/sessions/{id}/events` | gate | SSE, `daemon.py:3526-3600` |
| POST | `/api/sessions/{id}/seen` | gate | `daemon.py:3628-3682` |
| POST | `/api/sessions/{id}/pin` | gate | `daemon.py:3684-3757` |
| POST | `/api/sessions/{id}/command` | gate | `daemon.py:3890-4041` |
| POST | `/api/sessions/{id}/operator/challenge` | gate | `daemon.py:4043-4117` |
| GET | `/api/sessions/{id}/history` | gate | `daemon.py:3812-3847` |
| GET | `/api/sessions/{id}/image` | gate | `daemon.py:3849-3888` |
| GET | `/api/sessions/{id}/agents/{job_id}` | gate | `daemon.py:3759-3776` |
| GET | `/api/sessions/{id}/agents/{job_id}/history` | gate | `daemon.py:3778-3810` |
| GET | `/api/attention/unread` | gate | the unread aggregate (S1), `daemon.py:3989-4015` |
| GET | `/api/push/conversation/{handle}` | gate | `daemon.py:4017-4055` |
| POST | `/api/pair` | gate | `daemon.py:4119-4187` |
| GET | `/api/pair/{device_id}` | gate | `daemon.py:4189-4231` |
| GET | `/api/commands` | gate | `daemon.py:4233-4237` |
| GET | `/api/models` | gate | `daemon.py:4373-4384` |
| POST | `/api/transcribe` | gate | `daemon.py:4386-4508` |
| GET | `/api/projects` | gate | `daemon.py:4537-4546` |
| POST | `/api/projects` | gate | `daemon.py:4548-4563` |
| GET | `/api/projects/{key}` | gate | `daemon.py:4565-4579` |
| PATCH | `/api/projects/{key}` | gate | `daemon.py:4581-4598` |
| DELETE | `/api/projects/{key}` | gate | `daemon.py:4600-4616` |
| POST | `/api/projects/{key}/milestones` | gate | `daemon.py:4618-4630` |
| DELETE | `/api/projects/{key}/milestones/{name}` | gate | `daemon.py:4632-4644` |
| POST | `/api/projects/{key}/links` | gate | `daemon.py:4646-4658` |
| DELETE | `/api/projects/{key}/links/{session_id}` | gate | `daemon.py:4660-4672` |

There is **no `GET /api/sessions/{id}`** — a single session's state arrives only
over its SSE stream or as a row of `/api/sessions`. A client that wants
"one session, once" must either read the listing or open the SSE stream and use
its seed frame (§4.2).

### 2.1 The error body contract

Errors are `{"error": "<human sentence>"}` — the sentence is the copy the relay
intends a surface to show. Where the *category* matters the body adds a machine
`code` beside it (`daemon.py:4024-4038` for command refusals; `daemon.py:3670-3676`
for the superseded-token 409; `daemon.py:4534` for project refusals). Rules the
client must keep:

- **Never parse the sentence to decide.** Use the status plus `code`; the prose
  has already been rewritten twice on the relay side (`daemon.py:4025-4033`).
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
- — code `daemon.py:3411-3417`; live `fixtures/relay/http/healthz.json`

### 3.2 `GET /api/sessions` — the session list

**This endpoint and the `sessions` SSE event are the same payload on two
transports** (`daemon.py:3485-3491`). The phone's home screen reads the SSE one.

```jsonc
{
  "sessions": [ /* SessionSummary, see below */ ],
  "degraded": [],                       // [] | ["sessions"] | ["attention"] | both
  "capabilities": {
    "features": { "auth": 1, "commands": 2, "session_catalogue": 3, ... },
    "stt": { "available": false, "path": null, "reason": "..." }
  },
  "unread": {                           // S1 (ADR 0006 §1.1); absent on an older relay
    "count": 2,                         // conversations with unread completions; ABSENT when degraded
    "revision": [1043, 1041, 7],        // an equality token, never an order
    "degraded": []                      // ["attention"] when the receipt store could not be read
  }
}
```

- `degraded` is **present on every frame and empty when nothing is wrong**, so a
  client can tell "nothing to report" from "this build is too old to know"
  (`daemon.py:3493-3496`). The names are `"sessions"` (the durable store could not
  be walked) and `"attention"` (the completion-receipt store could not be read)
  — `daemon.py:146,717-743`.
- `capabilities.stt` gates the voice mic: **an older relay omits the key entirely
  and absence means the same as `available: false`** (`daemon.py:3497-3507`).
- `capabilities.features` is a lazy, memoised flag dict; a missing key means
  "this build does not have it", never an error (`daemon.py:1496-1519`).
  Live sample: `fixtures/relay/http/sessions-empty.json`.
- `unread` is the machine's own aggregate (push/ack-sync S1), a TOP-LEVEL
  sibling of `degraded` — deliberately not a `capabilities` flag, because a
  missing key there means "this build does not have it" while an older relay's
  missing block here means **unknown, never 0**. `count` counts CONVERSATIONS
  with unread completions over exactly the rows the listing serves — one
  conversation with three unread completions counts once — and equals the
  frame's own `unseen` rows. A non-empty `degraded` means the receipt store
  could not be read, and then `count` is **absent** rather than `0`: a store
  that could not be read is not an empty pile, and clearing a badge on it is
  the lie the absence prevents. `revision` is `AttentionStore.revision()`: an
  equality token, never an order. The dedicated route `GET /api/attention/unread`
  serves the same block as its whole body (`daemon.py:3989-4015`, the
  snapshot's assembly at `daemon.py:1008-1085`). Live:
  `fixtures/relay/http/sessions-with-unread.json`.

`SessionSummary` — every key, with optionality:

| Field | Type | Notes |
| --- | --- | --- |
| `session_id` | string | durable conversation identity (12 hex chars for phone-started sessions) |
| `section` | `"active" \| "previous"` | the **shared** catalogue `active` rule, not "a live process exists" — a durable conversation with an unseen completion is `active` on every surface (`daemon.py:958-963`) |
| `pinned` | bool | read from the shared `sidebar-pins.json` store; absence on an older relay means `false` |
| `conversation_name` | string | projection name, else the record's, else the durable row's; `""` when unnamed |
| `cwd` | string | |
| `model_label` | string | display label, e.g. `test/mock` |
| `streaming` | bool | |
| `leaving` | string | the record's own phrase when a runtime was **signalled** and is draining; `""` otherwise. Additive (`daemon.py:973-981`) |
| `updating` | string | the build pair while an idle runtime moves to the build on disk; `""` otherwise. Additive (`daemon.py:984-990`) |
| `needs_attention` | bool | an approval/ask is waiting (`daemon.py:991`) |
| `pending_kind` | `"approval" \| "ask" \| ""` | |
| `subagents_running` | `int \| null` | **`null` means "not reported" and must never be read as `0`** — the relay returns `null` for a session it cannot vouch for (degraded dial, stale heartbeat, leaving runtime) (`daemon.py:466-529,1041-1066`) |
| `subagents_queued` | `int \| null` | same terms as above, deliberately (`web/src/types.ts:342-348`) |
| `ended` | bool | **the session-state receipts (#1784).** True only for a row whose process THIS daemon watched die: an entry for this id exists and is ended and no live one does. **False for a durable-only row** — a conversation nothing has registered since boot — because the relay has not observed that end and will not guess (`daemon.py:906-914,1021`). Absent on a relay older than `fc851a94e`; a client MUST read absence as `false` |
| `degraded` | bool | **the receipt that the relay's own dial is down**: the record is fresh but the control socket is unreachable, so nothing this row shows is being confirmed right now (`daemon.py:906-914,1022`). False by construction for a durable-only row. Absent on an older relay, absence = `false` |
| `todos_open` | int | `pending` + `blocked` across all phases |
| `mtime` | float (epoch s) | |
| `created_at` | float (epoch s) | optional on older relays |
| `completion_kind` | string | `"complete" \| "error" \| "interrupted" \| "closed" \| "retired" \| ""` from the attention store |
| `unseen` | bool | a completion landed that nobody has acknowledged; absence on an older relay means `false` |

Ordering: rows come back **already ordered** by the shared catalogue rank
(tier, wake band, birth, id); the client only groups them into
★ Pinned / Active / Previous and must not re-sort (`daemon.py:1047`, `docs/mobile.md`
§session list). The per-row `degraded`-style marker on the listing is the
top-level `degraded` array above; **the row's own health is `ended`/`degraded`,
which are per-row booleans** (`daemon.py:906-914`).

### 3.3 `GET /api/sessions/past`

```json
{ "sessions": [ { "id": "6714def86197", "name": "Hello from the mock provider",
                  "mtime": 1790727370.33, "forked": false } ],
  "degraded": [] }
```

- **The route takes no query parameters** — `limit` is fixed at 20 in the handler
  call (`daemon.py:4361-4371`), even though `_past_sessions(limit=20)` accepts
  one. A client cannot page this list.
- `forked: true` marks a fork still wearing its parent's title, so it and its
  parent are byte-identical rows separable only by id (`daemon.py:4756-4790`).
- A durable store that cannot be walked answers `degraded: ["sessions"]`
  **with an empty list** — never a silent "you have no conversations"
  (`daemon.py:4783-4787`).
- Live `fixtures/relay/http/past-with-rows.json`, `past-empty.json`.

### 3.4 `GET /api/sessions/search?q=&limit=`

```json
{ "sessions": [ { "id": "…", "name": "…", "mtime": 1.79e9,
                  "body_match": false, "forked": false } ],
  "query": "hello", "degraded": [] }
```

- `limit` default `40`, clamped to `1..200`; a non-numeric limit falls back to
  `40` rather than erroring (`daemon.py:4342-4346`).
- `body_match: true` means the row matched only on what was *said* in the
  conversation, not on its name/id — the UI is expected to mark those so the hit
  does not look arbitrary (`web/src/types.ts:405-407`).
- `query` is echoed so a late response can be matched to its request.
- Live `fixtures/relay/http/search-hit.json`, `search-empty.json`.

### 3.5 `GET /api/sessions/{id}/history?before=&limit=`

```json
{ "entries": [ /* TranscriptEntry */ ], "has_more": true }
```

- `before` = the id of the **oldest entry the client already holds**; the page is
  the entries immediately older than it, chronological within the page
  (`daemon.py:3812-3821`). Without `before` the page is the tail.
- `limit` default `80`, clamped `1..200`; non-numeric falls back to `80`
  (`daemon.py:3834-3838`); live `fixtures/relay/http/history-bad-limit.json` shows
  `limit=abc` answered `200` with a default-sized page, not a 400.
- Unknown id → `404 {"error": "unknown session"}`. A live generation **or** a
  durable user session qualifies; other ids 404 so the route cannot be used to
  probe arbitrary paths (`daemon.py:3827-3833`).
- For a durable-only conversation the fold is disk-only
  (`durable_only=True`); for a live one it may fold through the loaded cache.
- Entry objects are the `TranscriptEntry` shape (§6.1) with `details` populated
  for tool rows; images are references, exactly as on the projection.
- Live `fixtures/relay/http/history-ok.json`, `history-unknown.json`.

### 3.6 `GET /api/sessions/{id}/image?entry=&i=`

- Returns raw image bytes with the stored mime type and
  `Cache-Control: public, max-age=31536000, immutable`. — code
  `daemon.py:3884-3888`; live `fixtures/relay/http/image-ok.json`
- Content key is `(entry id, image-only index)`: `entry` is a globally unique
  message uuid, `i` counts **image blocks only** (a text caption does not shift
  it). The `pid` in the path only routes; a recycled pid maps to a different
  session whose transcript lacks that uuid, which is why `immutable` is safe
  (`daemon.py:3849-3865`).
- Statuses: `400 {"error": "entry id is required"}` when `entry` is missing,
  `400 {"error": "bad image index"}` on a non-numeric `i`,
  `404 {"error": "no such image"}` when the block does not resolve (including an
  out-of-range `i`), `404 {"error": "unknown session"}` for a session with no live
  generation. — live `image-missing-entry-param.json`,
  `image-bad-index.json`, `image-unknown-entry.json`
- **The image endpoint requires a live generation**: `_entry_for_session` is the
  only lookup (`daemon.py:3870-3872`), unlike `/history` which also accepts a
  durable user session. A transcript preview for a **previous** conversation
  therefore cannot render attachments — the client must degrade those to a
  placeholder rather than a broken-image icon.
- Bytes are read back out of the on-disk transcript and base64-decoded; an
  undecodable payload is a logged warning and a `404` (`daemon.py:1960-2005`).

### 3.7 `GET /api/sessions/{id}/agents/{job_id}` and `…/history`

- Detail returns the **full cached descendant state**: every `SubagentRow` field
  **plus** `transcript`, `todos`, the full `prompt`, the full launch message id,
  and `version` (the daemon epoch). — code `daemon.py:3759-3776`,
  `capture_subagent_details` `daemon.py:2209-2310`; live
  `fixtures/relay/http/subagent-unknown.json` for the miss
- The aggregate roster rides the projection **stripped** (`prompt`, `result_text`,
  `error_text`, `transcript`, `todos` emptied) and re-materialised only on this
  route, because the roster is re-sent ~30×/s (`daemon.py:2290-2310`).
- `…/history?before=&limit=` pages one child's transcript, never the root's;
  `limit` default `80`, clamped `1..200`; same body as `/history`.
- Misses: detail → `404 {"error": "unknown subagent"}`; history →
  `404 {"error": "subagent history unavailable"}` (when the child session id is
  unknown) — live `subagent-history-unknown.json`.
- The history route proves the child belongs to this root lineage before reading
  disk; child transcripts are deliberately not public root routes
  (`daemon.py:3778-3797`).

### 3.8 `GET /api/commands`

```json
{ "commands": [ { "name": "help", "description": "List all commands",
                  "aliases": [], "arguments": "none" } ] }
```

- `arguments` ∈ `"none" | "optional" | "required"` (lowercased `ArgumentMode`).
- TUI chrome is excluded by name: `exit`, `quit`, `clear` are absent because they
  are meaningless on a phone (`daemon.py:3303-3324`).
- Cached in-process after the first call (`daemon.py:3306`).
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
  (`web/src/types.ts:364-382`, `daemon.py:5090-5219`).
- `name` is the display string; `label` is the parity contract (equal to
  `selector` when no name can be vouched for). Render `name`.
- `connected` = the provider has a credential that can run this model now;
  `aggregated` = the provider resells it.
- Field set is deliberately only what a surface renders — earlier revisions
  shipped `routed`, `context_window`, `input_price`, `output_price` and cost
  159 KB of a 301 KB response on a mobile link (`web/src/types.ts:377-382`).
- Failure → `502 {"error": "…"}` when the catalogue cannot be produced but at
  least one admitted provider has no listings
  (`daemon.py:5199-5218`); an unreadable credential store falls back to the
  **cached** catalogue rather than failing (`daemon.py:5147-5172`).
- The response is **gzipped when the client sends `Accept-Encoding: gzip` and the
  body is ≥ 1024 bytes**; gzip is applied per-route, never as middleware, because
  middleware would buffer the SSE stream (`daemon.py:4905-4990`).
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
  (`daemon.py:4350-4359,4754-4800`).
- Live `fixtures/relay/http/directories.json` — the sample is an isolated run, so
  `recent` is empty.

### 3.11 `/login`, `/logout`, `/mark.png`, `/`, `/assets/*`

- `GET /login` → the server-rendered password form (HTML, ~14 KB), or a `303` to
  `/` when already authenticated (`daemon.py:3419-3422`). **This page is the only
  login UI the product ships**; it also carries an inline script that wipes
  `lo-mobile-command:*` / `lo-mobile-draft:*` from browser storage, which is the
  WebKit-safe half of logout (`docs/mobile.md` §Retry-envelope).
- `GET /logout` → `303` to `/login`, `Set-Cookie` clearing `lop_mobile`
  (`Max-Age=0`), and `Clear-Site-Data: "storage"`. It is **not** auth-gated and
  does not check CSRF — a native client calling it must expect to be logged out
  regardless of the cookie it presented. — code `daemon.py:3449-3456`; live
  `fixtures/relay/http/logout.json`
- `GET /mark.png` → the brand mark, public because the login page needs it before
  a cookie exists, `Cache-Control: no-store` (a phone that cached a 404 from a
  build without the asset kept showing a broken image) — `daemon.py:3458-3469`.
- `GET /` → the SPA shell with `no-store`, or `503` plain text
  `mobile web bundle not built — run: cd local_operator/mobile/web && pnpm install && pnpm build`
  when `dist/` is absent. **A native client never calls this**, but it is the
  fastest way to tell "the daemon is up but has no web bundle" apart from "the
  daemon is down". — code `daemon.py:3471-3483`; live
  `fixtures/relay/http/index-authed-no-dist.json`
- `/assets/*` is a `StaticFiles` mount resolved **at app build time**: a rebuilt
  bundle needs `lop mobile restart` to appear, which is the documented upgrade
  path (`daemon.py:4730-4740`).

### 3.12 `GET /api/push/conversation/{handle}` — a push tap's conversation

Push/ack-sync S2 [ADR 0006 §3.1/§4]: a push payload carries only an opaque
handle, so a cold tap — the conversation is not in the unread set any more, or
never was on this client — resolves through here.

| Case | Response |
| --- | --- |
| a handle this machine minted for a conversation it still offers | `200 {"session_id": "<id>"}` |
| unknown, stale after a key rotation, or naming a conversation that no longer exists | `404 {"error": "unknown conversation handle"}` — a clean refusal, never a `500` |

— `daemon.py:4017-4055`; live `fixtures/relay/http/push-conversation-ok.json`,
`push-conversation-unknown.json`.

The handle is deliberately NOT checked against the unread set: resolving an
already-acknowledged conversation is the whole point. It is minted
deterministically per conversation (`base64url(HMAC-SHA256(key, identity))[:22]`
over the conversation's stable identity; `push_handles.py`) and appears as
`push_handle` on the rows of `GET /api/attention/unread`.

---

## 4. The mutation routes

### 4.1 `POST /api/sessions/{id}/command` — the single command endpoint

Every mutation travels here, mirroring the registrant's dispatch so the auth gate
lives in one place (`daemon.py:3890-3893`). Body: `{"op": "<op>", ...fields}`.

Handler order (this order is the contract):

1. `gate()` (auth + same-origin).
2. Body must be a JSON **object** → otherwise `400 {"error": "request body must be an object"}`; unparseable JSON → `400 {"error": "invalid JSON"}`. — live `command-body-not-object.json`, `command-bad-json.json`
3. `operator_cap` and `operator_handshake` are **dropped from any body** — they are machine-held proof material, and a value arriving over HTTP can only be a forgery. Dropped rather than refused so a client learns nothing about their shape. — code `daemon.py:3905-3912`
4. `operator_sig`, `operator_cert`, `operator_key_id` **are** admitted (stage D): the phone may sign a challenge the runtime minted for its own connection (`daemon.py:3913-3938`).
5. `op` must be a non-empty string → `422 {"error": "op must be a non-empty string"}`.
6. `validate_control_frame` runs the per-op shape checks (§4.3).
7. `prompt`/`steer` additionally must satisfy `ContinuationCommand.from_json` — **identity is mandatory over HTTP even though protocol-v2 loopback clients remain valid** (`daemon.py:3952-3957`).
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

— code `daemon.py:4012-4041`; live (the `command-*.json` captures under `fixtures/relay/http/`).

> `422` and `502`/`504` are **not** interchangeable: only `502/504` leave the
> delivery outcome unknown. `422` is a pre-admission refusal and the retained
> envelope must be discarded, or every later prompt in that conversation will
> refuse the same id (see §5).

`detail` strings observed live (these are the receipts a native UI can surface
verbatim): `prompt admitted`, `already admitted`, `steering queued`,
`snapshot sent`, `pong`, `no turn was running`,
`cancelling at the next tool boundary`, `model: <provider>/<model_id>`.

### 4.2 The op vocabulary

`ControlOp` in `types.py:428-512` is the **relay↔runtime** vocabulary; the
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
| `credential`, `register_secret_redaction`, `complete_aside`, `adopt_aside`, `stop`, `retire_if_pristine` | see `daemon.py:3918-4038` | reachable but not phone-surface |

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
  `/tmp` still matches (`daemon.py:4852-4861`).
- Success: `{"ok": true, "pid": <int>, "session_id": "<12 hex>"}`, where
  `session_id` is minted **before** the spawn so the child, the response and the
  first SSE frame all agree (`daemon.py:4266-4269`).
- The session is spawned as a **supervised child process** running
  `python -m local_operator.session.runtime.process`, so a daemon restart costs
  the phone its view, never the session its work (`daemon.py:3119-3132`).
- The call waits up to `SESSION_START_TIMEOUT_S = 30 s` for the child to publish
  its discovery record; a child that exits first →
  `500 {"error": "session exited before becoming ready; check mobile logs"}`
  (`daemon.py:110,3121-3135`).
- An observer daemon (`LO_MOBILE_NO_DIAL=1`) refuses:
  `RuntimeError("observer daemon cannot start sessions")` → `500`
  (`daemon.py:3134-3137`).
- **Idempotent per session id while a start is in flight**: concurrent callers
  await the same task (`daemon.py:3094-3117`).
- Live `fixtures/relay/http/start-session.json`, `start-session-2.json`.

### 4.5 `POST /api/sessions/resume`

Request `{"session_id": string}`.

- Missing/blank → `400 {"error": "session_id is required"}`;
  unknown → `404 {"error": "no such past session: <id>"}` (live
  `fixtures/relay/http/resume-no-id.json`, `resume-unknown.json`).
- Success: `{"ok": true, "pid": <int>, "session_id": "<same id>"}`. The resumed
  runtime's cwd is `Path.home()`, **not** the conversation's recorded cwd
  (`daemon.py:4318-4319`) — the client must not promise that resuming restores
  the working directory; if the user then wants another cwd, that is `move`.
- A session already live is adopted rather than duplicated
  (`daemon.py:3138-3153`).

### 4.6 `POST /api/sessions/{id}/seen` — the unread acknowledgement

Request `{"completion_token": "<uuid>"}`.

| Case | Response |
| --- | --- |
| no live entry **and** no durable user session | `404 {"error": "unknown session"}` |
| unparseable JSON body | `422 {"error": "completion_token is required; update the client"}` |
| `completion_token` absent or not a string | `422 {"error": "completion_token is required"}` |
| a **real** token a newer completion has replaced | `409 {"error": "completion token superseded by a newer completion", "code": "superseded_completion_token"}` (`attention.py:185`'s constant, pinned cross-repo) |
| an unknown token | `409 {"error": "unknown completion token"}` |
| success | `200 {"ok": true, "attention": <state>}` |

— code `daemon.py:3628-3682`, the superseded branch at `daemon.py:4236-4244`;
live `seen-missing-token.json`, `seen-unknown-session.json`,
`seen-real-token.json`, `seen-superseded.json`.

The token is the `attention.completion_token` the projection carried. On the
superseded branch the remedy differs: re-read the projection and acknowledge the
token it now names (`daemon.py:3662-3676`). A success invalidates the listing
cache and wakes the list stream so the next paint already shows the truth
(`daemon.py:3679-3681`).

### 4.7 `POST /api/sessions/{id}/pin` — the shared pin store

Request `{"pinned": <bool>}` — **desired state, not a toggle**, so a retried
request cannot flip the pin back (`daemon.py:3684-3699`).

| Case | Response |
| --- | --- |
| unknown session | `404 {"error": "unknown session"}` |
| `pinned` not a strict bool (e.g. `1`) | `422 {"error": "pinned (a boolean) is required"}` |
| `pinned: true` but the conversation has **no durable folder yet** | `409 {"error": "no saved messages yet — pin it after you send one"}` |
| success | `200 {"ok": true, "pinned": <state read back>}` |

— code `daemon.py:3706-3757`; live `pin-true.json`, `pin-not-bool.json`,
`pin-unknown.json`.

The body of a `200` is **the state the store read back**, not the state that was
asked for, so a caller cannot be told a pin the reader pruned
(`daemon.py:3755-3757`). Both branches are the same file the TUI's `F10` and the
desktop action write (`sidebar-pins.json`), so a pin is one fact across three
surfaces.

### 4.8 `POST /api/sessions/{id}/operator/challenge` — the signing flow

Request `{"action": "loosen"|"approve", "request_id"?: string}`.

- Authority-bearing fields (`operator_cap`, `operator_sig`, `operator_key_id`,
  `operator_cert`) are stripped from **this** body only: this endpoint's whole
  output is a challenge, so a body carrying proof material is a caller confusing
  two endpoints (`daemon.py:4075-4083`).
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
  presentation of the same challenge finds nothing (`daemon.py:4043-4063`,
  `daemon.py:3923-3931`).

### 4.9 `POST /api/pair` and `GET /api/pair/{device_id}`

- `POST /api/pair` body `{"code": string, "spki": base64url uncompressed P-256
  point, "name"?: string}`. A wrong code and no live code are answered
  **identically** with `403 {"error": "that pairing code is not valid"}` — the
  distinction would tell a guesser whether a pairing window is open
  (`daemon.py:4152-4159`). A malformed `spki` → `422 {"error": "spki must be an
  uncompressed P-256 public point, base64url"}`; a revoked device →
  `403 {"error": "this device has been revoked"}`; success →
  `{"ok": true, "device_id": "<hex>"}`.
- `GET /api/pair/{device_id}` → `{"paired": false, "device_id": "…"}` when
  unknown (live `pair-status-unknown-device.json`) or
  `{"paired": true, "device_id", "certificate", "operator_key_id", "scope",
  "exp", "name", "authority_ready"}` when paired. `authority_ready` is false
  between `lop operator init` and `lop operator install` — the state an older
  UI lied about (`daemon.py:4208-4231`).
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
(`daemon.py:4529-4534`). Shapes mirror the desktop wire models
(`web/src/types.ts:491-594`); `ProjectMilestone.status` is **derived**
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
  (`daemon.py:3952-3957`); without one the request is a `422`.
- The relay forwards the frame; it does not itself de-duplicate. It fits the
  frame to the socket first and raises `OversizedRequest` (a `ValueError` → `422`)
  *before* registering a pending future, so a refusal never leaves a parked
  request behind (`daemon.py:2846-2861`, `attach_client.py:323-368`).

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
`{"ok": true, "detail": "<detail>"}` (`daemon.py:4041`), so **the `duplicate`
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
  `daemon.py:3602-3626`
- Changes that wake it: a projection arriving from a runtime (which bumps a row's
  streaming/attention), a session appearing/disappearing, a pin written, a
  `/seen` acknowledgement (`daemon.py:1050-1068,3593,3666`).

### 6.2 `GET /api/sessions/{id}/events` — one session's projection

- Frames: `event: projection` + `data: <SessionProjection>`.
- The **seed frame**: the current projection is sent immediately so a
  reconnecting client renders without waiting for a change. If no live entry
  exists, the daemon folds the durable transcript and seeds from that
  (`daemon.py:3549-3572`).
- Then one frame per change, where "change" is any runtime frame the relay folds
  — i.e. **roughly every streaming token batch**, not per token
  (`daemon.py:3573-3576`).
- The subscriber's queue is `maxsize=8`; when it is full the **oldest** frame is
  dropped and the newest pushed (`daemon.py:3538`, `_fan_out` `daemon.py:2008-2048`).
  A snapshot protocol can afford that; a delta protocol could not.
- On the last subscriber leaving, the relay tells the runtime `unwatch` and
  prunes the projection generation (`daemon.py:3580-3589`).

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
  `fixtures/relay/sse/sse-keepalive.json` (its `literal` field is the exact bytes)
- Response headers on both streams: `content-type: text/event-stream;
  charset=utf-8`, `cache-control: no-cache, no-transform`,
  `x-accel-buffering: no` (the last is what turns buffering off at
  nginx-family proxies) — `daemon.py:3591-3600,3534-3538`.
- `SessionEventResponse` explicitly closes its body iterator in a `finally`, so a
  cancelled proxy stream does not leave an unseen subscriber pinning a viewer
  forever (`daemon.py:3349-3359`).

### 6.4 Reconnect and resync

A client may reconnect at any time: every frame is a full repaint, so there is no
resync protocol. The rules that make that safe:

- **One writer per session at a time is not required** — the stream is
  read-only, and multiple subscribers are normal (`first_watcher` only decides
  whether to tell the runtime it is being watched, `daemon.py:3540-3548`).
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
process replacements* (`_projection_generations`, `daemon.py:2203-2390`).

- The daemon identifies a runtime generation by `(pid, started_at, control_key)`
  — pid alone is reusable, and the control key is regenerated per registration
  (`daemon.py:2246-2255`).
- `epoch = max(state.epoch + 1, projection.version)` on a generation change;
  otherwise `epoch = offset + projection.version` (`daemon.py:2315-2340`).
- A frame from a **retired** identity is fenced: `_StaleProjection` is raised and
  the frame is dropped (`daemon.py:2261-2274`). The retired set is bounded to the
  last 8 identities (`daemon.py:2334-2338`).
- A **durable fold carries no process identity**, so it re-materialises at the
  retained epoch and never reopens a generation (`daemon.py:2288-2300`). That is
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
a runtime died) is published with `pid: 0` and `kind: "daemon"`, and it carries the
session's disk transcript. Live proof (captured at `52c1df35`):
`fixtures/relay/sse/sse-projection-durable-after-death.json`, the frame published
after the runtime was SIGKILLed — `pid: 0`, the transcript from disk, and the list
stream, one frame later, moving the row to `section: "previous"`. **On
`fc851a94e` that same frame also carries `ended: true`** (see the receipts below);
the committed capture predates the receipts, so its `ended` reads `false`, which is
what the build at that ref published.

### 6.5.1 The session-state receipts (`ended`, `degraded`)

**This corrects round 1 of this document.** At `52c1df35` the two projection
fields were declared but never published `true`, and the round-1 text here said
so; that was accurate then and is **wrong now**. #1784 (`fc851a94e`) made the
relay tell the truth about session state, on both transports:

| Where | Field | True when | False when | Cleared by |
| --- | --- | --- | --- | --- |
| summary row | `ended` | an entry for this id exists, is ended, and no live entry for it does — a death **this daemon observed** (`daemon.py:906-914`) | **a durable-only row**: nothing has registered since boot, so the relay will not guess an end it did not see | a fresh registration for that id (`active` wins) |
| summary row | `degraded` | the live entry's own dial is down — record fresh, socket unreachable (`daemon.py:906-914`) | a durable-only row, by construction | the next successful dial |
| projection | `ended` | the frame was built by a caller that **proved** the session's end: the scan's `stale` pivot (`daemon.py:2603`), the record-vanished branch (`daemon.py:2647`), or a wake that settled without a live host (`daemon.py:2773`) | a durable rebuild that was not told, and every live frame | the next live frame (`incoming.ended = False`, `daemon.py:1668`) |
| projection | `degraded` | the entry's dial is down, **mirrored onto the payload peers are served** (`_mirror_dial_health`, `daemon.py:2030`, called on a failed dial at `daemon.py:1569` and on a dropped reader at `daemon.py:1704`) | as above | the next live frame (`incoming.degraded = False`, `daemon.py:1667`) |

Three rules a client must take from that table:

1. **Absence means `false`.** Both summary keys exist on every row of a current
   relay; on a relay older than `fc851a94e` they are absent entirely, and the
   reading is the same as `false` — the rolling-upgrade rule `unseen` and `pinned`
   already follow.
2. **A durable-only row says `false`, not "unknown"**, deliberately: a
   conversation nothing has registered since boot was not observed to end. A
   client that reads `ended: false` there as "still running" makes the same guess
   the relay refuses to make; the honest render for such a row is the durable
   listing's own facts (name, age, last activity), not a liveness claim. **This is
   measured, and it is the strongest version of the point**: with a runtime dead
   and a daemon that never saw it live, the row reports `ended: false`,
   `degraded: false` and `subagents_running: null`
   (`fixtures/relay/probes/durable-only-row.json`). Durable rows also come back
   **thinner** — `model_label` is `""` where a live row says `test/mock`, and
   `cwd` is empty after a death — so a client must not render a durable-only row
   through a layout that assumes those fields are populated.
3. **The summary's flags drive the list; the projection's drive the session
   view.** They agree because both derive from the same entry state — but a
   durable rebuild *without* caller knowledge is `false` on the projection while
   the summary may be `true`, so the list can legitimately be one pass ahead of a
   seed frame.

**Measured at `fc851a94e`: the degraded receipt fires at the heartbeat timeout.**
A phone-started session whose runtime was frozen with `SIGSTOP` (record still
published, socket open, nothing beating), polled from `GET /api/sessions` every
3 s (`fixtures/relay/probes/degraded-row-signal.json`):

| Since the freeze | `subagents_running` | `degraded` | `ended` | `section` |
| --- | --- | --- | --- | --- |
| 0–42 s | `0` | `false` | `false` | `active` |
| ~45 s | `null` | `false` | `false` | `active` |
| ~48 s onward (incl. 10 s after `SIGCONT`) | `null` | **`true`** | `false` | `active` |

So the order is: the counts stop being advertisable at the 45 s timeout
(`HEARTBEAT_TIMEOUT_S`, `session/runtime/types.py:416-417`, via
`_advertisable_counts`, `daemon.py:512-519`), and the row's `degraded` flag
follows within a scan interval (`daemon.py:2619-2620`). Two caveats this capture
earns: the flag clears on the next **successful dial**, which was not observed
within 10 s of `SIGCONT` here — a client should clear its "not answering"
affordance from the flag going `false`, never on a timer — and the receipt needs a
record that was **stamped**: a runtime frozen before its first beat reads as fresh
and never reaches the wedged state (observed in a second run of the same probe).

**The round-1 measurement remains the fallback for older relays.** At `52c1df35`
the only wire evidence that a conversation had stopped answering was that same
*field change*: `subagents_running` went `0` → `null` at the 45 s timeout while
`section` stayed `active` and no flag appeared anywhere
(`fixtures/relay/probes/wedged-row-signal.json`). A client must therefore keep
both readings: flag first, count-change for a relay that predates the receipt.

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
- The soft cap is `PROJECTION_FRAME_SOFT_CAP_BYTES = 700_000`, and the
  drop-flood argument behind it is `projection.py:188-199`; the **hard** ceiling
  is the control socket's `_MAX_LINE_BYTES = 1 << 20` at
  `session/runtime/server.py:266`, mirrored by the sender's own
  `_READ_LIMIT_BYTES = 1 << 20` (`attach_client.py:144-148`) — the two numbers
  must stay equal, because the writer refuses to exceed what the reader will
  accept. A frame over the limit is dropped, and a flood of drops starves the
  daemon loop for **every** session. **Trap:** `session/runtime/viewer_server.py:76`
  defines a *different* `_MAX_LINE_BYTES = 64 * 1024` for another socket — a
  16× smaller ceiling; sizing a payload from that one is wrong.

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
| `ended` | bool | the daemon's receipt that this session's process is **gone** — `true` on the durable rebuild after a death the scan proved (`daemon.py:2603,2647,2773`), `false` on every live frame and on a rebuild nobody told. See §6.5.1 |
| `degraded` | bool | the relay's dial to this session is **down**: record fresh, socket unreachable. Mirrored onto the payload peers are served (`daemon.py:2030`) and cleared by the next live frame (`daemon.py:1667`). See §6.5.1 |
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
| `attention` | object | added by the frame builder, not the dataclass (`daemon.py:1825`); `{conversation_id, completion_token, anchor_id, kind, reason, cause, notify, unseen, revision}` |

The frame builder additionally **fills** `stop_reason`/`cut_off` from the durable
attention record when the fold never saw a turn end (a runtime killed mid-turn),
and appends a `notice` transcript row for `error`/`interrupted`/`closed`/`retired`
outcomes with the sentence and severity taken from `harness/rows.py`
(`daemon.py:1799-1904`). A client must not synthesise such a row itself.

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
| **degraded dial (not answering)** | row `degraded: true`, projection `degraded: true` (§6.5.1; live `fixtures/relay/probes/wedged-row-signal.json`) — and on a relay older than `fc851a94e`, nothing at all, so the fallback is `subagents_running: null` plus SSE silence |
| **wedged runtime** | heartbeat older than `HEARTBEAT_TIMEOUT_S = 45 s` → the scan marks the registration wedged and the row reports `degraded: true` (`daemon.py:2619-2620`); **measured at both refs** in `fixtures/relay/probes/wedged-row-signal.json` |
| **ended** | row `ended: true`, plus one final durable frame with `pid: 0` and `ended: true` (live: `fixtures/relay/http/list_row_ended.json` and `fixtures/relay/sse/sse_projection_ended.json` for `fc851a94e`; `sse-projection-durable-after-death.json` is the same event at `52c1df35`, where the frame read `ended: false`). **`ended` does not imply `section: "previous"`**: the section is the shared catalogue rule, so a died conversation whose completion nobody acknowledged is still `active` — measured in the same capture (`ended: true`, `section: "active"`, `unseen: true`) |
| **durable-only row** | a conversation nothing has registered since boot: `ended: false` and `degraded: false` **by construction**, not by observation (`daemon.py:906-914`) — render it from the durable listing's facts and make no liveness claim |
| **woken** | `prompt` on a durable-only conversation returns `200 {"detail": "prompt admitted"}` and the relay spawns a host process (live `command-prompt-wake-durable.json`, `list-after-wake.json`) |
| **auth lost** | `401 {"error": "authentication required"}` on any `/api/*`; on an SSE stream, the 401 is **not visible to EventSource** — a native client must check the status itself or it will retry forever |
| **command refusal** | `422` with prose (+ optional `code`), or `502`/`504` for the ambiguous pair |

---

## 8. Known gaps and risks to design around

1. **No per-session HTTP GET.** Single-session state is SSE-only or listing-only.
2. **`ended`/`degraded` are ref-dependent** (§6.5.1). Against `fc851a94e`+ they are real receipts on both the row and the projection; against an older relay they are absent (read as `false`) and the only evidence a conversation stopped answering is `subagents_running` flipping to `null`. A client must be built for both, because the app will meet relays it did not ship with — that is exactly the compatibility mechanism the fields' additive defaults exist for.
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

---

## 9. Queued asks (pending core land — target state, not shipped)

> **This section is not the relay today.** Everything below is the frozen target
> contract from the Local Operator repository's design note
> (`docs/design/ask-nonblocking.md` §4), committed with the core's first
> implementation pull request. Nothing here is on `fc851a94e` or on any relay a
> client can reach now. Do not build against it without checking that the relay in
> front of you publishes `asks`. The decisions for the native app are in
> [`../adr/0005-queued-asks.md`](../adr/0005-queued-asks.md); the wire itself is
> defined by the core and **never** here.

What changes, in the terms the rest of this document uses:

| Today (§6.7 / §4.2) | Target state |
| --- | --- |
| `SessionProjection.pending` — one `PendingRequest` slot, `pending_count` | unchanged for **approvals**; asks additionally arrive as `SessionProjection.asks: PendingAsk[]` (cap 20 newest, open first) plus `asks_open: int`. `pending`/`pending_count` keep meaning *blocking* requests |
| `SessionListRow.pending_kind` (`"approval" \| "ask" \| ""`) | unchanged; the row gains `asks_open: int` |
| `op ask_answer {request_id, value}` | `op ask_respond {ask_id, answers}`, plus `ask_decline {ask_id}` and `ask_dismiss {ask_id}`. A whole-ask body replaces the per-question value — the reason is that the current per-question form silently truncates a multi-select answer to `values[0]` |
| ask states are implicit (waits, or is answered) | a per-ask `status` the client renders: `open \| answered \| declined \| timed_out \| late \| dismissed \| expired`, folded by the runtime from an append-only log |
| no deadline | `expires_at`, `timeout_s`, `urgent` per ask; a late answer stays submitable until `expires_at + 7 d`, after which the ask reads `expired` |
| one terminal transcript kind for an answer | new `EntryKind`s `ask_response` and `ask_timeout`, each with `details` carrying the ask id, the questions and the answers |
| legacy single-slot mirror | for exactly one core release, when no approval is pending, the **head open ask's first unanswered question** is *also* projected as today's per-question card with `request_id = "<ask_id>.<qidx>"` — so a new core still serves an old app/web client. **Client rule:** once `asks` is present, a client **ignores any `pending_gate` whose `kind == "ask"`**, or the same ask renders twice |

`PendingAsk` (fields a client consumes; the core's §4 governs): `ask_id`,
`session_id`, `created_at`, `expires_at`, `timeout_s`, `urgent`, `status`,
`answered_at`, `delivered` (bool — the rows *this* status requires are present;
sticky), `questions[{id, question, options[{label, description, recommended}],
multi, secret, persist}]`, `answers` (`{qid: [str]}`; for a secret question the
array holds the vault key only, **never the value**), `answered_by` (`{surface}`).

Two client-facing facts that are easy to get wrong:

- **The presence of `asks` is the capability flag.** The core publishes the field
  only while its non-blocking switch is on, so *field present* means "this relay
  speaks queued asks" — an older relay omits the field exactly as a switched-off
  core does, and a client must treat both the same way.
- **Open asks are not session status.** `working`/`idle` stays activity-derived;
  `asks_open` is the separate count a badge may use.

---
