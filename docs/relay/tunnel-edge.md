# What a native client sees through the Radient tunnel edge

The relay is loopback-only. Reaching it from a phone means going through a
Radient personal tunnel, and that path adds a second, *different* contract on
top of [`contract.md`](contract.md): different headers, different cookies,
different errors, and one behaviour that shapes the whole SSE client — the
60-second stream cap.

Provenance:

- **local-operator** citations are `file:line` against **`52c1df35`**
  (`local_operator/tunnels/gateway.py` → `gateway.py`), read with
  `git show 52c1df35:<path>`. Read the ref, not the shared checkout's working
  tree: it currently carries another session's staged, partially-reverted
  `local_operator/mobile/daemon.py`, so tree line numbers are wrong.
- **Radient** citations are `radient-ml:<path>:<line>`, meaning
  `~/radient-ml/agent-server/<path>`; the edge worker is
  `edge/tunnel-worker/src/index.ts` → `edge/index.ts`. The revision read was
  `radient-ml/agent-server` `main` @ `2cb7f4a5`.
- **Cloudflare** claims are cited to the vendor's own documentation, because the
  failure shapes a phone hits most often in the field are produced by neither
  codebase.

Read this together with `docs/tunnels.md` in local-operator (the operator-facing
summary) — this document is the client-facing one.

---

## 1. The path, and the two gates on it

```
native client
  → https://<32-hex>-lop.radienthq.com            (Cloudflare: DNS + proxied tunnel)
  → Cloudflare Worker  (edge/index.ts)            gate 1: Radient grant + origin proof
  → cloudflared named tunnel
  → local Starlette gateway 127.0.0.1:4100        gate 2: origin-proof verify + cookie injection
  → loopback relay daemon 127.0.0.1:4098          the contract in contract.md
```

The hostname is not configurable by the client: the edge accepts only
`^([a-f0-9]{32})-(lop|oc)$` over **https with no port** and the label
`.radienthq.com`; anything else is `404 Unknown tunnel` (`edge/index.ts:30-37`).

> **Native consequence.** A "custom URL" mode must point at the tunnel hostname
> exactly as Radient issued it, with no port and https only. A client that
> normalises the URL (adds `:443`, or lower-cases/trims the label) turns a
> working tunnel into `404 Unknown tunnel`.

### 1.1 What the client must send, and what it must not

| Requirement | Source | Consequence if unmet |
| --- | --- | --- |
| Send the grant cookie yourself: a `Cookie` request header whose value is the access-token JWT | `edge/index.ts:167-177` | `401 Invalid tunnel session` |
| `Origin: https://<host>` on **every** non-`GET/HEAD/OPTIONS` request and on WebSocket upgrades | `edge/index.ts:122-131` | `403 Same-origin request required` |
| No `Sec-Fetch-Site: cross-site`/`same-site` unless `Sec-Fetch-Mode: navigate` | `edge/index.ts:129-131` | `403 Cross-origin subrequest denied` |
| Body ≤ 10 MiB (control-plane subresponses 64 KiB) | `edge/index.ts:10-11,133-147` | `413 Request is too large` |
| Unique `__Host-radient-*` cookie names (one of each) | `edge/index.ts:39-49` | `400 Ambiguous session cookie` |

The edge **strips** before forwarding (`edge/index.ts:246-259`): every
`x-radient-*`, `cf-access-*`, `x-forwarded-*`; `authorization`,
`proxy-authorization`, `forwarded`, `cookie`, `content-length`,
`transfer-encoding`, `keep-alive`, `trailer`, `te`; anything named by
`Connection`. It then rewrites `Cookie` to carry only non-Radient app cookies,
dropping `__Host-radient-*`, `radient-*` and the literal **`lop_mobile`**
(`edge/index.ts:255-258`).

Two facts follow, and both are worth stating because the intuitive design is
wrong in each case:

- **A bearer token is useless on a tunnel host.** `Authorization` is deleted
  before the request leaves the edge (`edge/index.ts:251`). Authentication on
  this route is cookies only.
- **The relay cookie cannot be smuggled through**, and it must not be: the local
  gateway injects `lop_mobile=<signed cookie>` itself when the harness is
  `local-operator` (`gateway.py:545-548`, name from `local_operator/mobile/auth.py:98`).
  On the Radient route the phone never sees, and never needs, the relay password.

**There is no CORS at the edge** (`edge/index.ts` adds no `Access-Control-*`,
and no `OPTIONS` shortcut): a native client has nothing to preflight, and must
not invent CORS headers. The control plane (`api.radienthq.com`) is the
opposite — `Access-Control-Allow-Origin: *` with an `OPTIONS → 204`
(`radient-ml:internal/middlewares/middleware.go:159-188`).

### 1.2 Response headers the client will observe

The edge forces `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on proxied responses
(`edge/index.ts:266-278`). The gateway forces `cache-control: no-store`,
`referrer-policy`, `x-content-type-options: nosniff` and
`content-security-policy: frame-ancestors 'none'` (`gateway.py:668-671`) and
passes through only a small allowlist (`content-type`, `content-length`,
`content-encoding`, `content-range`, `accept-ranges`, `etag`, `last-modified`,
`x-accel-buffering` — `gateway.py:320-329`). **`set-cookie` is not allowlisted**,
so **no cookie is ever set through the tunnel**: the relay's `lop_mobile` never
crosses it (the gateway injects that one itself, §1.1), and on the Radient route
the app holds no cookie values at all — it composes the one `Cookie` header it
sends from its own stored tunnel session (§2.1).

> **A consequence the app must handle:** because the gateway forces
> `cache-control: no-store` and drops most headers, the relay's own caching
> signals (the immutable image cache in `contract.md` §3.6) do **not** survive
> the tunnel. The client must cache images itself.

---

## 2. Authentication on the tunnel route

### 2.1 The grant, and its 5-minute life

The edge verifies the `__Host-radient-grant` JWT (`edge/index.ts:167-177`):
RS256; `issuer = https://api.radienthq.com/v1/tunnels`; `audience = <hostname>`;
required claims `sub, iat, exp, tunnel_id, harness_id, version, token_use`;
`maxTokenAge: "5m"`, `clockTolerance: 0`; and then explicitly
`token_use == "tunnel_access"`, `exp - iat <= 300`.

A valid grant is forwarded with **no `Set-Cookie`**; the refresh cookie is
untouched (`edge/index.ts:303-309`). When the grant is missing/expired **and** a
`__Host-radient-refresh` cookie is present, the edge performs a transparent
refresh **regardless of method** — a `POST` or `DELETE` from the app is refreshed
just as a `GET` is — and re-sets **both** cookies on the proxied response
(`edge/index.ts:306-326`).

**The edge would do all of this for us. We deliberately do not let it.** This app
ows the tunnel session instead of leaving it to a cookie store: it mints the
session itself (§2.2), holds `access_token` and `refresh_token` from the JSON
body in the platform secure store, and sets the `Cookie` header per request from
what it holds. The lifecycle — proactive refresh with under 60 s left,
single-flight, re-mint on a 401/`invalid_grant`, silent re-mint at day 25 of the
absolute 30-day handle — is **ADR 0002 §3**; this document is not a second
statement of it, and where the two could be read differently the ADR governs.

Two mechanical consequences follow, and they are the parts a client can get
wrong:

- **Accept no `Set-Cookie`.** A transparent refresh (or a 401 that clears the
  session) may arrive with `Set-Cookie` on the *proxied* response. The app ignores
  it: it presents what it holds, and decides for itself whether to refresh, re-mint
  or sign out. There is no cookie jar on this route — `credentials: 'omit'`
  semantics, hand-set `Cookie`, exactly as ADR 0002 §4 states, and the reason is
  in ADR 0002 §3's rejected alternative: a jar puts the app's most important
  credential in a store it cannot read, cannot inspect for expiry, cannot refresh
  in the background and cannot clear selectively.
- **The edge's own logout cannot revoke our session.** `POST /_radient/logout`
  revokes server-side only `if (jar.get(REFRESH))` — it reads the refresh value
  from the request's cookie (`edge/index.ts:296`). Because we never present that
  cookie, the handler still redirects and still clears cookies, but **nothing is
  revoked**: a copied refresh handle would stay usable. Signing out on this route
  is therefore the control plane's own call, `POST /v1/tunnels/session/logout`
  with `{refresh_token, hostname}` (§2.2), followed by clearing the local secure
  store. Treat that as a required step of sign-out, not an optimisation.

The cookie attributes are recorded for completeness rather than as something to
reproduce: `SameSite=Lax` + `Secure` + `HttpOnly`, **no `Domain`**
(`edge/index.ts:50-52`). A client that hand-sets the header sends exactly one cookie —
the grant cookie's name paired with the access-token JWT — and the `__Host-` prefix
rules (no `Domain`, `Path=/`, `Secure`) constrain how it must be spelled.

### 2.2 Minting your own session (the native-app path, no Radient change needed)

A native client holding the user's Radient OAuth access token can mint a tunnel
session itself, with PKCE, entirely against public endpoints:

| Call | Body | Success | Errors |
| --- | --- | --- | --- |
| `POST /v1/tunnels/session/code` | `{tunnel_id, hostname, state, code_challenge, code_challenge_method:"S256"}` | one-time 2-minute code, bound to hostname + challenge + state | validation errors; the code is stored hashed and consumed with `FindOneAndDelete`, so a wrong `code_verifier` **burns the code** (`radient-ml:internal/tunnels/store.go:185-191`) |
| `POST /v1/tunnels/session/token` | `{code, code_verifier, hostname}` | raw `{access_token, refresh_token, token_type:"Bearer", expires_in:300, refresh_expires_in}` + `Cache-Control: no-store` (`radient-ml:internal/tunnels/session.go:122-158`) | `400 invalid_grant`; `endpointError` for target problems |
| `POST /v1/tunnels/session/refresh` | `{refresh_token, hostname}` | same raw shape; **the same refresh token comes back — it is deliberately not rotated** (`session.go:159-183`) | `401 invalid_grant` when empty/unknown/expired/hostname-version mismatch |
| `POST /v1/tunnels/session/logout` | `{refresh_token, hostname}` | `200 {}`; idempotent (`session.go:185-198`) | `200` even when absent |

These three session endpoints are **public and per-IP rate limited**; the owner
endpoints in §4 need `Authorization: Bearer <Radient access token>`.

Then the client sends, per request (composed from the store it owns — §2.1):

```
Cookie      the grant cookie (`__Host-radient-grant`) carrying the access_token JWT
Origin      https://<hostname>          # on mutations
```

`POST /v1/tunnels/session/logout` is also the app's real sign-out on this route:
the edge's own `/_radient/logout` cannot revoke a session whose refresh value it
must read from a cookie we deliberately never send (§2.1).

`code_challenge` must match `^[A-Za-z0-9_-]{43}$`, `code_verifier`
`^[A-Za-z0-9._~-]{43,128}$`, `state` non-empty ≤ 1024, method exactly `S256`
(`radient-ml:internal/tunnels/session.go:45-57,131`).

Grant claims (`session.go:199-209`): `iss` = the grant issuer, `sub` = the tunnel
owner's account id, `aud` = the exact hostname, `iat`/`exp` (`exp = iat + 300`),
plus `tunnel_id`, `harness_id`, `version`, `token_use: "tunnel_access"`; header
`alg: RS256`, `kid` = first 32 hex chars of `sha256(RSA modulus)`.

Refresh handle: 32 hex chars, stored SHA-256-hashed, bound to one
owner/tunnel/hostname/version, **absolute 30-day expiry** and stable across
refreshes (`session.go:149-153,181-183`). `refresh_expires_in` reports the
remaining seconds of that window — the app should treat it as the hard deadline
after which the user must sign in again.

> **Why this matters for the product:** the phone can hold a 30-day refresh
> handle and re-derive a 5-minute grant silently, so "sign in once" is
> achievable with no Radient-side change. What the phone *cannot* do today is
> receive the OAuth redirect at a custom scheme (private-use schemes are
> rejected), which is the sign-in problem the app's auth design must solve
> separately — loopback listener during sign-in, or a Radient-registered mobile
> client.

### 2.3 What the client must NEVER do here

- Do not read or attempt to provision the connector's own secret material.
  `POST /v1/tunnels/:id/connect` returns `cloudflared_token` and the gateway's
  pinned JWKS material (`radient-ml:internal/tunnels/service.go:346-360`) — that
  is owner-scoped material for the machine, not for a phone.
- Do not use the relay password on the Radient route (it is injected locally)
  and do not fall back to it silently: a fallback that silently succeeds makes
  the app's auth state unverifiable.

---

## 3. The 60-second stream cap — the behaviour that shapes the SSE client

`MAX_STREAM_SECONDS = 60` (`gateway.py:34`). The mechanism
(`gateway.py:678-686`) is worth knowing exactly, because the client's behaviour
depends on the *shape* of the end rather than the fact of it:

- the chunk loop runs inside `async with asyncio.timeout(MAX_STREAM_SECONDS)`;
- on expiry the `TimeoutError` is **caught and swallowed**, the generator
  returns, and `upstream.aclose()` runs in `finally`;
- the HTTP response was already `200` with headers sent.

**So the stream ends as a clean end-of-body.** There is no error frame, no
sentinel, no status change. The same clean end happens when the loop breaks
because the 30-second authorization lease lapsed or `revoked` flipped
(`gateway.py:680-681`) — so an early EOF carries **no information at all** about
why it ended.

The relay's own side of this is a fresh 25-second keep-alive comment
(`contract.md` §6.3), so inside 60 seconds the client will normally have seen two
keep-alives; a stream that ends before the first one is anomalous.

### 3.1 The resulting client contract

1. **Treat EOF at ~60 s as expected, not as an error**, and reconnect
   immediately with the same grant (the connection is cheap and the grant is
   still valid for up to 5 minutes).
2. **Do not display connection state on the 60-second boundary.** A user must not
   see a reconnect flash every minute; only a failure to *re-establish* is
   user-visible.
3. **Resumption is by refetch, not replay.** `last-event-id` is in the gateway's
   forwarded-header allowlist (`gateway.py:317`), so a `Last-Event-ID` header does
   reach the relay — but nothing in the relay reads it (`daemon.py` has no
   `last-event-id` handling). Recovery is therefore: reconnect, and render the
   **seed frame** the stream opens with (the relay's session stream always sends
   the current projection first — `contract.md` §6.2), which is a full snapshot.
   This is only sound because the protocol is snapshot/repaint with no deltas.
4. **Reconnect with the grant you hold, and refresh it yourself** rather than
   leaving it to the edge (§2.1: no cookie jar on this route; ADR 0002 §3 is the
   refresh/re-mint lifecycle).
5. **A stream ending early (< 60 s) means the gateway stopped forwarding**
   (lease lapsed, or a revoke). Reconnect; if the reconnect answers the gateway's
   503 refusal, switch to the `reason`-driven surface in §5.

Backoff guidance, from the frequencies in the code: the connector renews its
30-second lease on a 10-second poll (`gateway.py:35`, `service.py:47`), so a
refusal that is going to clear on its own clears within ~10-30 s; and the
`authorization_deferred` state is documented to clear by itself within 120 s
(`DEFERRAL_WINDOW_S`, `gateway.py:66` — the one reason that carries
`Retry-After`).

---

## 4. Disambiguating "which side is broken" from the app

The tunnel route has two gates and a Cloudflare layer in front of both, and the
three produce different-looking failures. A phone user's question is always
"is my computer asleep, or is this tunnel gone, or is my login stale?", so the
app should be built to answer that question, not to show status codes.

Owner APIs that settle it (all `Authorization: Bearer <Radient access token>`;
`radient-ml:internal/tunnels/service.go`):

- `GET /v1/tunnels` → `{"msg":"Personal tunnels","result":[<Tunnel>…]}`, newest
  first, `status != "deleted"` excluded, **with the same `billing` object copied
  onto every item** (`service.go:222-235`).
- `GET /v1/tunnels/:id` → the single tunnel + billing (`service.go:237-249`).
- `GET /v1/tunnels/billing` → the `BillingStatus` (`service.go:197-204`).
- `POST /v1/tunnels/billing/activate` `{accepted_monthly_price_usd}`
  (`service.go:205-221`).

`BillingStatus` is `{active, eligible, monthly_cost_usd, monthly_price_usd,
balance_usd, amount_due_usd, next_charge_at}` (`service.go:24-32`); `eligible`
requires an active billing account, credits > −1.0, and `amount_due == 0`.

The `<Tunnel>` shape a discovery screen needs (`radient-ml:internal/tunnels/model.go:27-48`):
`id` (32 hex), `owner_account_id`, `name`, `device_id`, `gateway_port` (immutable
after creation), `enabled` (desired state), `version` (bumps on every change),
`hostname`, `harnesses[]` (`{id: "local-operator"|"opencode", enabled, port,
hostname, url}`, 1–2 entries), `status`
(`pending|active|reconciling|disabled|suspended|revoking|deleted|error`),
`created_at`, `updated_at`, optional `revoked_at`, optional `billing`.

> **The one thing the API cannot tell you: whether the machine is awake.**
> `status: "active"` means the *cloud route is provisioned*; it is explicitly
> not a connector heartbeat (`radient-ml:docs/PERSONAL_TUNNELS.md:96,105-106`).
> The connector's own liveness exists only as a **loopback-only** endpoint on the
> machine (`GET http://127.0.0.1:<gateway_port>/_lop_tunnel/health` →
> `{"ok":bool,"connected":bool}` + `detail`/`reason` — `gateway.py:555-569`),
> which is unreachable through the tunnel. A phone therefore learns "the computer
> is offline" only by *failing to reach it*, never by asking.

---

## 5. Every failure a client can hit, and how to surface it

**Everything in the "surface" column is a recommendation; the "fact" columns are
code or vendor documentation.**

### 5.1 Outside both codebases (Cloudflare)

| Observed | Fact | Recommended surface |
| --- | --- | --- |
| Cloudflare error **1033** (typically HTTP **530**) | No healthy `cloudflared` instance — the machine is asleep, the connector is stopped, or the job is not loaded ([Cloudflare: error 1033](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/)). local-operator records this exact field failure, ~7 h of it, while the connector was simply not running (`local_operator/launchd.py:738-746`) | **"Your computer is offline"** with the machine-side remedy; poll with backoff; never re-auth |
| Cloudflare **502** "Unable to reach the origin service" | The connector is up but the local gateway is not listening/crashed ([Cloudflare common errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)) | Same "offline" family, different copy: the tunnel is running but the local relay isn't answering — a local, fixable fault |
| DNS failure after a tunnel is suspended or revoked | The control plane replaces ingress with `http_status:404` and **deletes the DNS records** (`radient-ml:internal/tunnels/cloudflare.go:152-163,287-295`) | "This tunnel no longer exists" + a console link. Terminal; do not retry |
| SSE buffered / not streaming | Cloudflare proxies buffer unless the origin sets `Content-Type: text/event-stream` ([Cloudflare common errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)); the relay does set it (`daemon.py:3505`) | If frames arrive in bursts, suspect a proxy on the path — but on the supported path this should not happen |

### 5.2 The edge worker (bodies are `text/plain; charset=utf-8`)

| Status | Body | Source | Surface |
| --- | --- | --- | --- |
| 400 | `Ambiguous session cookie` | `edge/index.ts:45` | Client bug: two `__Host-radient-*` cookies on one request. The app sends exactly one `Cookie` header from its own store — a duplicate means something else on the device joined in |
| 400 | `Login state is missing; start login again` / `Login state did not match` / `Invalid login response` | `:209,213,218` | Restart the sign-in flow |
| 401 | `Invalid tunnel session` | `:175` | Grant failed validation (issuer/audience/claims/lifetime) |
| 401 | `Sign in with Radient to access this tunnel` + **`X-Radient-Login: /_radient/login`** (+ cookies cleared when the refresh itself 401'd) | `:317-322` | **Refresh once from the stored handle, then retry once; on a second 401 re-mint and, failing that, sign in again** (ADR 0002 §3). Do not say "computer offline" — the connector was reached. Ignore the response's `Set-Cookie`: the app decides, not the edge |
| 403 | `Same-origin request required` | `:128` | Client bug: `Origin` missing or wrong on a mutation. Fix `Origin: https://<host>`; do not loop |
| 403 | `Cross-origin subrequest denied` | `:130` | Client bug: cross-site fetch metadata without `navigate` |
| 403 | `Tunnel sign-in was cancelled. You can close this page.` | `:214-216` | Only on the browser sign-in path |
| 404 | `Unknown tunnel` | `:32,35` | Hostname form/port/https — client bug; log the raw host |
| 404 | `Unknown authentication route` | `:302` | Only if the client invents `/_radient/*` paths |
| 413 | `Request is too large` | `:140,162` | "File too large"; no retry |
| 503 | `Authentication unavailable` | `:153,191` (edge misconfigured) | Transient-looking; retry with backoff, keep the session |
| 503 | `Radient session unavailable` | `:161` — control plane ≥500, 429 **or 3xx**; a 4xx is collapsed to **401** with this same message | Backoff; never log out. **This is a place the edge destroys information**: a control-plane 402 (billing) or 403 (tunnel unavailable) on the refresh path reaches the app as a 401 |
| 503 | `Invalid authentication response` | `:163,181` | Retry once; if it persists, sign in again |
| 503 | `Tunnel temporarily unavailable` | `:330` | Retry with backoff |
| 303 | `Redirecting` + `Location` | `:60-62,221,298` | **Only for `GET` with `Accept: text/html`** (`:318-319`) — a native JSON client gets the 401 instead, which is the behaviour to rely on |

Notable mappings a client must not misread:
- A control-plane **429 or 5xx becomes an edge 503**, and the edge does **not**
  propagate `Retry-After` (`edge/index.ts:161`).
- A control-plane **402/403 on the refresh path becomes an edge 401**
  (`edge/index.ts:161`). The honest way to learn which it was is the owner API
  (`GET /v1/tunnels`, §4) — do not guess in the copy.

### 5.3 The local gateway (`application/json`)

Body from `unavailable_body` (`gateway.py:491-502`);
`Retry-After: 120` **only** for `authorization_deferred` (`gateway.py:504-518`).

| Status | Body | Source | Surface |
| --- | --- | --- | --- |
| 503 | `{"detail": <sentence for a phone>, "reason": <code>, "error": "tunnel authorization unavailable"}` | `:491-502` | Render `detail` verbatim; **switch on `reason`** (§5.4) |
| 503 | same, `+ Retry-After: 120` | `:504-518` | Only `authorization_deferred`: say "paused; clears by itself in about two minutes" — *not* "signed out" |
| 404 | `{"error": "unknown tunnel host"}` | `:574-576` | Hostname not among the registered harnesses. Terminal for that URL |
| 403 | `{"error": "same-origin request required"}` | `:595` | Client bug (`Origin`/`Sec-Fetch-Site`) |
| 413 | `{"error": "request exceeds 10 MiB"}` | `:600` | File too large |
| 400 | `{"error": "GET/HEAD bodies are not supported"}` | `:601-602` | Client bug |
| 401 | `{"error": "valid Radient origin assertion required"}` | `:612-615` | **Should be unreachable** — the assertion is minted by the edge. If seen, the client is bypassing the edge (hitting the gateway directly) |
| 502 | `{"error": "local harness unavailable"}` | `:651-652` | The relay daemon is not answering on loopback: "the relay isn't running on your computer" |
| 502 | `{"error": "unsafe harness redirect"}` | `:653-667` | Client bug (followed a redirect the gateway refused to relay) |
| 503 | `{"error": "mobile relay is not installed"}` | `:635` | The machine has no relay password configured |
| 303 | empty + `Location: /_radient/logout` + `Clear-Site-Data: "storage"` | `:624-627` | The relay's `/logout` was relayed |
| 303 | empty + `Location: /` | `:628-629` | The relay's `/login` was relayed |
| 200 | `{"ok":false,"connected":<bool>,"detail":…,"reason":…}` | `:559-569` | **Loopback-only** — not reachable through the tunnel |

### 5.4 The `reason` vocabulary, and what each means for the app

`refusal_reason()` (`gateway.py:472-480`): revoked → `tunnel_not_authorized`;
else the last recorded poller failure; else `authorization_lease_pending`.

| Constant | Value | `gateway.py` | REACHABLE from a phone | Recommended surface |
| --- | --- | --- | --- | --- |
| `UNREACHABLE` | `control_plane_unreachable` | `:67` (detail `:107-112`) | yes | "Your computer can't reach Radient"; retry silently, no user action |
| `REFUSED` | `authorization_refused` | `:68` (`:113-117`) | yes | Send the user to `https://console.radienthq.com/dashboard/tunnels` (login/billing); `TERMINAL_REMEDY` names `lop login radient` (`:246`) |
| `AUTHORIZATION_DEFERRED` | `authorization_deferred` | `:76` (`:126-131`) | yes, **and the only one with `Retry-After: 120`** | "Paused; clears by itself in ~2 minutes". The code went out of its way to keep this distinct from "signed out" (`:69-75`) |
| `NOT_AUTHORIZED` | `tunnel_not_authorized` | `:77` (`:133-136`) | yes | "This tunnel was revoked, suspended or changed"; remedy `lop tunnel connect` (`:247`) |
| `LEASE_PENDING` | `authorization_lease_pending` | `:78` (`:137-140`) | yes | The 30 s lease is warming up: retry silently within seconds |
| `LOGIN_REQUIRED` | `login_required` | `:90` (`:141-145`) | yes | "Sign in again on that computer" |
| `LOCAL_PREREQUISITE` | `local_prerequisite` | `:91` | **no** — park-only, deliberately no `RELAY_DETAIL` entry (`:86-89`) | n/a for a phone |
| `REENROLMENT_REQUIRED` | `reenrolment_required` | `:92` | **no** — park-only | n/a |
| `OWNER_MISSING` | `owner_missing` | `:102` | **no** — park-only | n/a |

The three unreachable constants are the code's own statement that a phone cannot
reach those states; an app must not invent copy for them.

---

## 6. What the app should build, given all of the above

1. **Two auth modes behind one interface.** Radient (an owned tunnel session,
   injected relay auth, no password on the phone) and direct (a URL plus the
   relay password, form login, the `lop_mobile` cookie — the one route where a
   platform cookie jar *is* the right tool, ADR 0002 §4). The mode is discovered
   by probing, not chosen from a setting that can disagree with reality.
2. **An owned tunnel session, not a cookie store.** Mint `access_token` +
   `refresh_token` from the JSON body (§2.2), keep them in the platform secure
   store, hand-set `Cookie` per request, and ignore any `Set-Cookie` the edge
   sends. The 5-minute refresh, the day-25 re-mint and sign-out (including the
   control-plane revoke the edge cannot do for us) are **ADR 0002 §3** —
   implement that, not a jar.
3. **SSE client shaped by the 60-second cap**: reconnect silently at EOF, render
   the seed snapshot, keep the last good frame rendered while reconnecting, and
   surface only sustained failure.
4. **A failure taxonomy with five surfaces**, not a status-code dump:
   *computer offline* (Cloudflare 1033/502, gateway 502, or unreachable host),
   *tunnel problem* (`REFUSED`, `NOT_AUTHORIZED`, DNS gone),
   *waiting* (`LEASE_PENDING`, `AUTHORIZATION_DEFERRED` with the 120 s window),
   *sign in again* (edge 401 + `X-Radient-Login`, `LOGIN_REQUIRED`), and
   *relay not installed* (gateway 503).
5. **A discovery screen** backed by `GET /v1/tunnels`, with the honest caveat
   that `active` is provisioning, not a heartbeat: show the tunnel list from the
   API and the *reachability* from a probe, and never present one as the other.

## 7. Open questions this mapping could not settle

1. **`Referrer-Policy`'s literal value at `gateway.py:669`** — the header is
   definitely set; the value could not be read verbatim by the tooling used here.
   Cosmetic for a native client.
2. **The edge→connector `fetch` timeout** — none is declared in
   `edge/index.ts:260-262`; the effective ceiling is Cloudflare's request
   duration, which was not verified against current Workers documentation.
3. **The exact wire status for a down connector** (1033 vs 530 vs a Cloudflare
   error page) — the vendor documents the condition, not the status for this
   hostname shape; settling it needs a real request against a stopped connector,
   which was out of scope here.
4. **Whether `POST /_radient/logout` is meaningfully reachable from a native
   client** — the handler is an ordinary one and `enforceOrigin` only requires a
   matching `Origin` (`edge/index.ts:295-301`), but no test drives it without
   browser semantics.
