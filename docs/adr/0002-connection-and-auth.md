# ADR 0002 — Connection layer: sign-in, tunnel sessions, transports, custom relays

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-29
- **Deciders:** mobile app maintainers
- **Depends on:** [ADR 0001 — Framework and styling stack](0001-framework.md)
- **Related:** [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md)

**Provenance of code citations.** Every `file:line` in this document is stated at a
named revision and was resolved with `git show <ref>:<path>` — never read from a
working tree, because the shared checkouts carry other sessions' staged work and
their line numbers move under you:

| Repository | Revision | How paths are cited |
|---|---|---|
| **local-operator** | `fc851a94e` (read 2026-09-29; a pinned SHA, not a branch — local-operator's origin/main has moved past it since) | `local_operator/tunnels/gateway.py` → `gateway.py`; `mobile/daemon.py` → `daemon.py`; `mobile/auth.py` → `auth.py`; `mobile/types.py` → `types.py`; `mobile/web/src/store.ts` → `store.ts`; `providers/oauth/radient.py` → `radient.py`; `docs/mobile.md` and `docs/tunnels.md` by full path |
| **agent-server** (Radient) | `dcafe852` (read 2026-09-29; a pinned SHA — agent-server's origin/main happened to equal it then) | `edge/tunnel-worker/src/index.ts` → `index.ts`; `internal/tunnels/*.go`, `internal/services/*.go`, `internal/repositories/*.go`, `internal/responses/*.go` → bare file name; `docs/PERSONAL_TUNNELS.md` by full path |
| **user-console** (Radient console) | `8597fdba` (read 2026-09-29; a pinned SHA, not a branch — user-console's origin/main has moved past it since) | `src/lib/native-oauth.ts` → `native-oauth.ts` |
| **expo** | `500d25dea3746c8ceeb751b3c55f432b269be410` (GitHub `main`, read 2026-09-29; a pinned SHA) | full paths under `packages/`; read with `gh api repos/expo/expo/contents/<path>?ref=<sha>`, since there is no local clone to `git show` |

The SHA is the authority in every row: a branch name only says where the ref was
when it was read, and these branches moved — at the time of writing local-operator's
`origin/main` was 8 commits past the pin, user-console's 36 past it, and agent-server's
happened to sit exactly on it. Re-derive a number at the SHA, never at a branch.

`docs/relay/*` (PR #4) pins agent-server at `2cb7f4a5`, an ancestor of `dcafe852`.
Each is correct for the ref it names; expect the same file's line numbers to differ
between the two documents by the commits in between.

## Context

The app is a client for two servers it does not own:

- the **relay** — `lop mobile serve`, an HTTP + SSE server that binds `127.0.0.1`
  only, with a single shared password and a signed cookie
  (`~/local-operator/local_operator/mobile/daemon.py:4674-4726` for the route
  table; `~/local-operator/local_operator/mobile/auth.py:98` for the cookie name
  `lop_mobile`; `:465-469` for `sign_cookie`, whose value is
  `<expiry>.<hmac-sha256-hex>` over the expiry string);
- the **Radient tunnel** — a Cloudflare Worker edge
  (`~/radient-ml/agent-server/edge/tunnel-worker/src/index.ts`) in front of a
  cloudflared connector that reaches a local gateway
  (`~/local-operator/local_operator/tunnels/gateway.py`), with a Go control plane
  (`~/radient-ml/agent-server/internal/tunnels/`) issuing short-lived session
  grants, and Radient OAuth for the account itself
  (`~/local-operator/local_operator/providers/oauth/radient.py`).

Everything below was read from those repositories on 2026-09-29. Where a claim is
about behaviour we have not executed ourselves, it is marked **spike** and the
spike that would settle it is named in §7.

### The path a request takes

```
phone app ──https──▶ edge Worker ──fetch──▶ Cloudflare Tunnel ──▶ local gateway ──http──▶ relay daemon ──socket──▶ session runtime
 (this ADR)          (Radient)                                  (lop tunnel)                (lop mobile serve)
```

Two facts drive most of the design:

1. **The edge authenticates the browser, and the gateway authenticates the
   relay.** The Worker verifies the `__Host-radient-grant` cookie, strips *all*
   `radient-*`/`__Host-radient-*` cookies plus `Authorization`, signs a
   per-request RS256 origin proof, and forwards
   (`index.ts:246-259`). The gateway verifies that proof and, for the
   `local-operator` harness, **injects the relay's own cookie itself**:
   `headers["cookie"] = f"{COOKIE_NAME}={sign_cookie(self.mobile_password)}"`
   (`gateway.py:544-547`). On the Radient route the phone therefore never needs —
   and can never use — the relay password: the gateway supplies it.
2. **The relay is loopback-only** (`~/local-operator/docs/mobile.md`, "Security
   invariants": every listener binds `127.0.0.1`). A "custom URL" is therefore
   always *something else in front of* the relay, never the relay itself.

### Hard constraints we must design within

| Constraint | Source |
|---|---|
| Mutations require an exact `Origin` equal to the request's own origin | `index.ts:122-131` (edge), `daemon.py:3368-3386` (relay) |
| `Sec-Fetch-Site: cross-site`/`same-site` non-navigations are rejected at the edge | `index.ts:129-130` |
| Request bodies are capped at 10 MiB at the edge and the gateway | `index.ts:10`, `gateway.py:33` |
| SSE is cut every 60 s by the gateway lease and must be reconnected | `gateway.py:34`, `:673-686` |
| The relay pushes **full snapshots** (`event: projection`), never deltas, with a monotonic `version` per projection epoch | `daemon.py:4752-4753`, `types.py:SessionProjection.version` |
| The relay sends `: keepalive` every 25 s when idle | `daemon.py:104-105`, `:2517-2518` |
| Session endpoints are per-IP rate limited (5/s, burst 20) with a global budget | `internal/tunnels/service.go:102-110` |
| The grant lives 5 minutes; the tunnel refresh handle is opaque, **not rotated**, and lives 30 days absolute | `internal/tunnels/session.go:199-210`, `:159-176` |
| Radient OAuth access token lives 1 hour; the OAuth refresh token is **rotated on every use** and rolls 90 days | `internal/services/auth_service.go:492-495`, `:704-720` |

## 1. Sign-in options for a phone

Radient's OAuth client `lop` is registered as `native` with exactly three
redirect URIs — `http://localhost/callback`, `http://127.0.0.1/callback`,
`http://[::1]/callback` — and `validOAuthRedirect` accepts, for native clients,
an `http` redirect on a loopback **literal** host whose *path and query match* and
which supplies its **own port** (`~/radient-ml/agent-server/internal/repositories/oauth_client_migration.go`,
`~/radient-ml/agent-server/internal/services/oauth_redirect.go:66-92`). An exact
`https` match is the only other accepted form. Custom schemes are not accepted at
all.

### Option A — reuse the `lop` client with a loopback PKCE redirect **(recommended)**

The app runs a short-lived HTTP listener on `127.0.0.1:<ephemeral port>/callback`,
opens the console's authorize URL in the system browser session with PKCE S256,
and receives `?code&state` on its own listener. This is exactly what the desktop
client does (`~/local-operator/local_operator/providers/oauth/radient.py:38-39`,
`CALLBACK_PORT = 54549`, `CALLBACK_PATH = "/callback"`), and the console is built for it: its redirect whitelist is a
loopback regex with a required port
(`~/radient-ml/user-console/src/lib/native-oauth.ts:16`), and it navigates to
`redirect_uri?code&state` (`:110-123`).

- **Requires no Radient change.** Existing client id, existing registered
  redirects, existing scopes (`openid profile email offline_access`).
- The resulting access token is audienced to `lop` (`auth_service.go:492`), and the
  control plane accepts an owner token whose `aud` is in
  `RADIENT_TUNNEL_JWT_AUDIENCES` (`config.go:86-90`, checked at `service.go:143-156`).
  **The deployed value of that variable is UNCONFIRMED.** The mechanism is verified;
  the only occurrences of the value in either repository are a unit-test fixture
  (`config_test.go:68`) and an e2e fixture
  (`cmd/server/tunnel_floor_e2e_test.go:111`, both read at the pinned refs), and the docs name the variable without a value
  (`docs/PERSONAL_TUNNELS.md:47`). The configuration lives outside these repositories,
  so it must be *checked*, not assumed (§7 **S8**). Indirect evidence that it is
  `lop` in production: the same owner middleware guards `POST /:id/connect`
  (`service.go:111`, `:128`), which the desktop `lop tunnel` connector calls on every
  start with its `lop`-audienced token — a connector that works today is evidence the
  audience is accepted, but it is second-hand and S8 makes it first-hand.
- The cost is the loopback listener: it must be alive for the few seconds the
  user is in the browser sheet, and the app must land the code whether the code
  arrives on the listener or through the browser session's own callback.

### Option B — a dedicated mobile-app OAuth client with a private-use scheme

Rejected for v1. It is not merely a registration: `validOAuthRedirect` admits only
`https` exact matches and `native` + loopback `http`, so a private-use scheme needs
a **server-side** change in `oauth_redirect.go`; the console independently rejects
non-`http(s)` redirects (`native-oauth.ts:23-42`), so it needs a **console**
change too; and RFC 8252 §7.1's advice to prefer claimed `https` links over custom
schemes means we would be adding a weaker mechanism on purpose.

### Option C — claimed `https` universal link / app link **(hardening path)**

Register a mobile client whose redirect is an `https` URL on a domain Radient
controls, host an AASA file (iOS) and `assetlinks.json` (Android), and let the OS
hand the callback straight to the app. Benefits: no listener, and the browser
sheet dismisses itself on both platforms. Costs: a client registration, AASA and
assetlinks hosting, and a domain decision that belongs to Radient rather than to
this repository. `expo-web-browser` already supports it — its iOS implementation
uses `ASWebAuthenticationSession.Callback.https(host:path:)` when
`preferUniversalLinks` is set (`packages/expo-web-browser/ios/WebAuthSession.swift:38-58`).

**Decision:** v1 signs in with Option A. Option C is the documented upgrade once
the app is in the stores and we want the flow to end without the user switching
back by hand.

### Browser session mechanics (Option A), as implemented

| Step | iOS | Android |
|---|---|---|
| Open | `WebBrowser.openAuthSessionAsync(authorizeUrl, "http://127.0.0.1:<port>/callback")` → `ASWebAuthenticationSession` | same call → Chrome Custom Tabs (not Auth Tab: `expo-web-browser` has no `AuthTabIntent` usage anywhere in `expo/expo`, checked 2026-09-29) |
| Code capture | our loopback listener; the session's own callback may also fire | our loopback listener (Android **cannot** intercept an `http` redirect via Linking without hijacking every web link) |
| Dismiss | automatic when the session's callback matches; otherwise the user taps Done | **not possible from JavaScript** — the app must render a “you can return to the app now” page at `/callback` and tell the user to switch back (`packages/expo-web-browser/src/WebBrowser.ts:404-406`) |
| Return | resolve on the first of: session result, listener code, or app foreground | resolve on the first of: code on the listener, or app foreground followed by a short grace period |

Two details worth stating because they will otherwise be discovered the hard way:

- **`/callback` must render something.** The browser will actually navigate there
  in the fallback path, so the app serves a one-line page — the same shape as the
  desktop flow's callback page — rather than hanging the tab on a blank screen.
- **The listener must be bound before the browser opens and torn down after**
  (including on cancel and on timeout). A listener that outlives the flow is an
  open port on the user's device for no reason, and it is the kind of thing that
  a security review will (rightly) flag.

`expo-web-browser`'s own Android polyfill explains the polyfill's limits in its
source (`WebBrowser.ts:370-409`): the promise resolves on browser close, and the
“we can't dismiss the browser on Android” comment is verbatim. If the switch-back
step proves to be a real irritant, the fix is a small native module using
`androidx.browser`'s Auth Tab (which returns the callback to the app and dismisses
the tab, `developer.chrome.com/docs/android/custom-tabs/guide-auth-tab`, read
2026-09-29) — that is a post-v1 polish item, not a v1 requirement.

Embedded WebViews are out of the question for this step: the console signs users
in through Google/Microsoft, which block WebView user-agents. That is why the app
uses the system browser session and why it must not “simplify” this later.

## 2. Discovery, tunnel selection, and the “no tunnel yet” flow

After sign-in the app holds a Radient OAuth access token (1 hour, refreshable) and
calls the owner APIs with `Authorization: Bearer <token>`. Every response is the
API's envelope — `{"msg": …, "result": …}` — and `result` is what we read
(`~/radient-ml/agent-server/internal/responses/responses.go:20-32`).

- **`GET /v1/tunnels`** returns every tunnel for the account, each with
  `id, name, device_id, gateway_port, enabled, version, hostname, harnesses[],
  status, created_at, updated_at, revoked_at` and an embedded `billing` object
  (`internal/tunnels/service.go:222-236`, `model.go:27-46`).
- **Harness selection:** pick the harness with `id == "local-operator"` and
  `enabled == true`; its `hostname` is the tunnel origin
  (`model.go:17-22`). A tunnel whose only enabled harness is `opencode` is not a
  Local Operator target and is shown as such.
- **Multi-computer:** a tunnel is a computer (`device_id`, `name`). The picker
  lists them by name with status, most recently updated first, and remembers the
  last one used. There is no cross-device grouping beyond what the API provides,
  and we do not invent one.
- **Status mapping** (`internal/tunnels/service.go:310`, `:468-482`):
  `active` → ready; `disabled` → off; `suspended` → suspended (billing);
  `pending`/`reconciling` → provisioning; `revoking`/`deleted` → gone;
  `error` → needs attention. Only `active` is dialable — the control plane
  refuses a session for anything else with 403 (`session.go:68`).
- **Billing** (`BillingStatus`, `service.go:24-32`): show `eligible`, `active`,
  `monthly_price_usd`, `balance_usd`, `amount_due_usd`, `next_charge_at`. A
  tunnel with `eligible: false` produces **402 “tunnel billing is inactive”** at
  session-code time (`session.go:75-77`), so the app must surface this *before*
  the user tries and fails: a banner with the quote and a link to
  `https://console.radienthq.com/dashboard/tunnels`.
- **No tunnel at all:** the app offers two distinct paths and says plainly which
  needs the computer:
  - *Create here:* `POST /v1/tunnels {name, device_id, gateway_port, harnesses[]}`
    allocates the hostname and reserves it (`service.go:305-324`), but the
    **computer** must then run `lop tunnel connect <id>`
    (`~/local-operator/docs/tunnels.md:57-62`). The app shows the id with a copy
    button and the exact command, then polls `GET /v1/tunnels/:id` while the user
    is on that screen.
  - *Already created:* the app lists it and explains that the connector has to be
    running on the computer; nothing the phone does can start it.
- **“Is the computer actually up?”** is answered by request outcomes rather than a
  health field: the gateway's health route is pinned to a loopback Host
  (`gateway.py:553-573`) and cannot be reached through the tunnel. The usable
  signals are in §5.
- **QR codes are not needed on this path** — the phone discovers the hostname
  itself. On the custom path (§6) a QR of the base URL (never the password) is a
  reasonable convenience later; the password stays typed.

## 3. Tunnel session minting, lifecycle, and storage

Because the app holds a Radient OAuth access token, it can mint its own tunnel
session with **zero changes to Radient**: the public session endpoints are
reachable from the internet and are not gated behind the Worker
(`internal/tunnels/service.go:108-113`).

```
1. POST https://api.radienthq.com/v1/tunnels/session/code           (Bearer OAuth access token)
   {tunnel_id, hostname, state, code_challenge, code_challenge_method: "S256"}
   → {code, state, callback_uri}                     code TTL 2 min, single use
2. POST https://api.radienthq.com/v1/tunnels/session/token          (public)
   {code, code_verifier, hostname}
   → {access_token, refresh_token, token_type, expires_in: 300, refresh_expires_in}
```

Server-side validation for step 2 covers PKCE (S256, constant-time), the hostname
binding, the code's expiry, and that the tunnel's configuration version is
unchanged (`session.go:122-158`). The grant is an RS256 JWT audience-bound to the
hostname with `token_use: tunnel_access` and a 5-minute life
(`session.go:199-210`).

**Lifecycle policy** (all of it testable, all of it in one module):

| Event | Action |
|---|---|
| Grant has < 60 s left | Refresh proactively, single-flight, before the next request |
| Request returns 401 from the edge (`X-Radient-Login` present) | Refresh once, then retry the request once; on a second failure, re-mint |
| Refresh fails with 401/`invalid_grant` | Re-mint with a fresh OAuth access token (refresh the OAuth token first if it is near expiry) |
| Tunnel refresh handle is > 25 days old | Re-mint silently in the background — the handle is **absolute, non-rotating, 30 days** (`session.go:159-176`), so it cannot be extended and there is no server-side “keep alive” |
| OAuth refresh fails (401/400) | Sign-in screen, with the tunnel session preserved until the user acts |
| Any 429 | Exponential backoff with jitter; the session endpoints are per-IP limited to 5/s burst 20 (`service.go:102-110`) and a stampede takes out refresh for everyone on that IP |

The refresh handle never rotating is a feature for us — no rotation race across
app foreground/background — and the 30-day absolute bound is the one place the
user can be surprised by a forced sign-in. Re-minting at day 25 with the OAuth
grant is what keeps that invisible; if the OAuth grant has also lapsed (90 days of
no use), the sign-in screen is correct behaviour and the copy should say so.

**Storage.** In `expo-secure-store` (Keychain / Android Keystore), one small JSON
item per concern, `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no
`requireAuthentication` at v1 (it would block background refresh), Android backup
configured so the items are not restored onto another device. Keep each value
small: the platform may refuse a very large value, and iOS historically rejected
values over ~2 KB (`docs.expo.dev/versions/latest/sdk/securestore`, read
2026-09-29). Items: the Radient OAuth set (access, expiry, refresh, account
label), the tunnel session set (grant, expiry, refresh handle, hostname,
tunnel id), and the custom-route set (base URL, password **only if the user opted
to remember it**, cookie value if we end up owning it — §4).

**Writing a refresh token is guarded, not blind.** A refresh response can succeed
with an empty `refresh_token`: `auth_service.go:752-770` returns the new handle only
when the new token row was created, and otherwise answers **HTTP 200 with
`"refresh_token": ""`** rather than the 401/400 the lifecycle above covers. The
rotation branch also only revokes the previous row when creation succeeded
(`:766-768`), so the stored handle is still valid in that case. The rule:

> A storage write of a refresh token **refuses an empty, absent or non-string
> value** and keeps the working one; only a non-empty string replaces it.

This is one function, `saveOAuthTokens`, and it is the difference between a silent
loss of the credential the day-25 re-mint depends on and a 200 that changes nothing.
**Test that proves it:** `connection/storage.test.ts` →
`keeps the stored refresh token when the response field is empty` — seed a token,
apply a response with `refresh_token: ""` (and, separately, with the field absent),
assert the stored value is byte-identical to the seed and that no write occurred. The
same test table covers the mirror case (`refresh_token: "…"` replaces it), because a
guard that refuses everything is as broken as one that accepts everything.

**Why the jar is not used on this route.** The tokens are not collected from a
browser session: the app mints them with its own PKCE exchange against the public
session endpoints and receives them in a JSON body (§3 above), so there is no
`Set-Cookie` to harvest and no browser identity to inherit. Sending the grant as an
explicit `Cookie` header is therefore not an alternative to the platform jar — it is
the only way to present a credential the app itself holds. It also happens to be the
right property: the token is inspectable (expiry), refreshable in the background,
and clearable on logout, none of which is true of a value sealed inside the jar.
§4 covers the one route (`lop_mobile`, on the custom flow) where the jar *is* the
right tool, because there the cookie genuinely does come from a login response.

**Refresh is ours; the edge's renewal is for browsers.** The app calls
`POST https://api.radienthq.com/v1/tunnels/session/refresh {refresh_token, hostname}`
itself and stores the returned grant. The Worker's own refresh branch
(`index.ts:306-316`) only fires when a request arrives carrying a
`__Host-radient-refresh` cookie, which never happens for us because we send the
grant as an explicit header — so a browser client behind the same tunnel and this
app refresh independently, and neither can silently repair the other.

**Logout revokes at the control plane, in that order.** The app is a first-class
control-plane client: it minted its tokens itself and holds them, so it revokes them
itself.

1. **Primary, and the only step that matters:** `POST
   https://api.radienthq.com/v1/tunnels/session/logout` with
   `{refresh_token, hostname}` (`session.go:185-198`) deletes the server-side refresh
   session. **State this plainly in the code and the copy: a logout that does not
   reach the control plane leaves a copied 30-day handle valid.** The local delete
   in step 4 does not revoke anything.
2. **Optional belt and braces:** `POST https://<host>/_radient/logout` with
   `Origin: https://<host>` and **both** cookies — the grant (`__Host-radient-grant`)
   *and* the refresh handle (`__Host-radient-refresh`) — because the Worker only calls
   the backend revoke when the refresh cookie is present
   (`index.ts:295-301`). Used only to clear edge-side cookie state on a shared
   device; never as the mechanism that revokes.
3. **If the hostname is gone** (tunnel deleted) the Worker 404s at `identity()`
   (`index.ts:30-37`) before reaching the revoke call, so step 1 is the only
   reachable revoke — which is another reason it is the primary.
4. Delete the secure-store items, the cached projections/transcripts, the retry
   envelopes, and any `lop_mobile` cookie left in the platform jar by the custom
   route. Radient's OAuth refresh token can also be revoked server-side
   (`RevokeToken`, `internal/services/auth_service.go:790-808`); the public route for
   it is not verified here — confirm before relying on it, and treat this as optional
   at v1 because deleting the local token already ends this device's access.

## 4. Request layer: headers, cookies, redirects

### Header contract

| Route | Every request | Mutations (`POST`) |
|---|---|---|
| Radient tunnel | `Cookie: ` + the grant JWT we minted (`__Host-radient-grant=<jwt>`); `Origin: https://<host>` | same, plus `Content-Type: application/json` |
| Custom URL | `Cookie: ` + the relay's `lop_mobile` value, owned by the platform jar (§ below); `Origin: <base origin>` | same |

- `Origin` is required *by the relay itself* for mutations, not only by the edge
  (`daemon.py:3368-3386`), and both compare an exact string. Send it on every
  request; it costs nothing and removes a class of 403s.
- **Never** set `Sec-Fetch-*` headers: a `cross-site`/`same-site` value that is not
  a navigation is rejected at the edge, and native clients have no reason to
  claim browser fetch metadata (`index.ts:129-130`).
- Do not send `Authorization` on the tunnel route — the edge deletes it
  (`index.ts:251`) and its presence only muddies diagnostics.

The tunnel route's `Cookie` is a **value we hold ourselves**, minted through the
control plane and stored in the keystore (§3) — not a cookie a browser jar collected.
The name matches the browser cookie only because that is the name the edge reads
(`index.ts:304-305`). No jar is involved on this route, which is what makes the
30-day handle inspectable, refreshable and revocable from the app.

### Cookie handling — two routes, two policies

**Tunnel route (own the header; keep the jar out of it).** Use
`credentials: 'omit'` so the platform never attaches or stores cookies, and set
`Cookie` by hand. This is not a guess: Expo's native fetch disables platform
cookie handling exactly when credentials are not `include` — iOS sets
`request.httpShouldHandleCookies = false`
(`packages/expo/ios/Expo/Fetch/ExpoURLSessionTask.swift:28-35`) and Android swaps
in `CookieJar.NO_COOKIES` (`packages/expo/android/src/main/java/expo/modules/fetch/NativeRequest.kt:41-43`,
`ExpoFetchModule.kt:49-51`). **Spike S1** confirms it end to end on both platforms,
including that a manually set `Origin`/`Cookie` survives `credentials: 'omit'` — the
iOS implementation replaces `allHTTPHeaderFields` from the jar *before* applying
explicit headers, so ordering is on our side, but this is a load-bearing detail.

**Custom route (let the jar do it).** `credentials: 'include'` for `POST /login`
stores the relay's `lop_mobile` cookie in the platform jar, and subsequent requests
carry it automatically. This is the simplest correct thing, and it matters because
**reading `Set-Cookie` is the uncertain part**: on iOS, Expo builds response
headers from `httpResponse.allHeaderFields`
(`packages/expo/ios/Expo/Fetch/NativeResponse.swift:110-128`), and CFNetwork is
well known for keeping `Set-Cookie` out of the visible header dictionary — where
on Android, OkHttp surfaces it (bridge interceptors add cookies but do not remove
received `Set-Cookie`). **Spike S2** settles whether we can capture the value
ourselves; if we cannot, the jar path is the design, not the fallback.

**Redirects.** Use `redirect: 'manual'` on `/login`: the daemon answers a successful
form login with `303 → /` plus `Set-Cookie` (`daemon.py:3424-3447`), and a failure
with 401 and an HTML error page. Following the redirect is pointless (the app never
renders the relay's HTML) and on the tunnel route a 303 to `/_radient/login` is a
diagnostic, not something to follow.

### SSE over the 60-second lease

- Use `fetch` with a streaming body reader (`resp.body.getReader()`), which Expo
  documents for `expo/fetch` (`docs.expo.dev/versions/latest/sdk/expo`, read
  2026-09-29), and frame events with a pure-TS parser (`eventsource-parser`) that
  handles `event:`, multi-line `data:`, and `: keepalive` comments. Do **not** use
  `EventSource`: it is not in React Native, and its built-in retry is immediate on
  some server-close shapes — the relay's own web client documents this and
  implements manual backoff for exactly that reason
  (`~/local-operator/local_operator/mobile/web/src/store.ts:1-12` for the rationale, `:143-192` for the implementation).
- **Treat the 60-second cut as expected, not as an error.** The gateway's lease
  (`gateway.py:34`, `:673-686`) ends the stream cleanly. Backoff is explicit, and it
  is deliberately *not* the reference client's rule: **reconnect immediately (0 ms)
  after a clean lease cut, and use exponential backoff 1 s → 15 s, reset on any
  successful frame, for every other close** (a transport error, a 5xx, an
  unexplained EOF). The relay's own web client uses 1 s → 15 s for *all* closes
  including the lease (`store.ts:143-192`, constants at `:143-144`); that is correct
  for a browser tab that may be backgrounded, and wrong for a foregrounded app whose
  streams die on a schedule — waiting a second after a scheduled rotation shows the
  user a gap that did not have to exist. A *silent* stream for more than ~35 s is the
  real failure signal, because the relay keeps the connection warm every 25 s
  (`daemon.py:105`).
- **Resync by snapshot.** Every push is a full projection with a monotonic
  `version` for its epoch; on reconnect, drop frames older than the last rendered
  one and accept the first frame of the new connection unconditionally (the relay
  reconciles epochs itself, and its own client implements exactly this
  `awaitingSnapshot` rule — `store.ts:263-286`).
- **Keep the last good projection while disconnected** and mark it stale rather
  than blanking the screen (`store.ts:296-303`). A flapping tunnel must not erase
  the transcript the user is reading.
- **Command delivery uses the relay's retry envelope**, not a naive POST retry: an
  instruction whose outcome is unknown (transport failure, or HTTP 502/504/408) is
  persisted with its UUID and replayed with the same UUID, so the relay de-duplicates
  it; a definitive 4xx/5xx rejection clears it. The contract is written out in
  `~/local-operator/docs/mobile.md:257-294` and implemented in
  `web/src/continuation-command.ts` — port the rules, do not re-derive them.

### Error taxonomy (drives the UI state machine)

| Response | Who | Meaning | UI |
|---|---|---|---|
| `401` + `X-Radient-Login` | edge (`index.ts:317-323`) | tunnel session expired | Refresh once (`/session/refresh`), retry the request once; re-mint only on a second failure, and go to sign-in only if that fails too (§3) |
| `503` `text/plain` “Tunnel temporarily unavailable” | edge (`index.ts:330`) | **the computer is offline** or its connector is down | “Computer offline” with retry |
| `503` JSON `{detail, reason, error}` | gateway (`gateway.py:472-500`) | connector is up but refusing | Show `detail` verbatim — it is written for a phone — plus the console link for `authorization_refused`/`tunnel_not_authorized` |
| `502` JSON `{"error":"local harness unavailable"}` | gateway (`gateway.py:652-653`) | the **relay daemon** is down | “Start the relay on your computer” |
| `404` JSON `{"error":"unknown tunnel host"}` | gateway (`gateway.py:575-576`) | tunnel/harness changed or was removed | Re-run discovery |
| `403` “Same-origin request required” | edge (`index.ts:128`) | we failed to send `Origin` | Diagnostics-only; never user-facing copy |
| `403` `{"error":"same-origin request required"}` | gateway (`gateway.py:595`) | the gateway rejected our `Origin`, not the edge | Diagnostics-only: a stale or wrong base URL |
| `401` `{"error":"valid Radient origin assertion required"}` | gateway (`gateway.py:614`) | the edge's origin proof was missing, stale or replayed (`gateway.py:360-440`) | Diagnostics-only, but it means the tunnel route was reached without the edge — a configuration error worth surfacing in the diagnostics screen |
| `401` JSON `{"error":"authentication required"}` | relay (`daemon.py:3395-3396`) | custom route: password changed / cookie cleared | Re-prompt for the password |
| `429` | API | rate limited | Back off with jitter |

Every JSON body in this table is quoted **compactly**, as it reaches the wire:
Starlette's `JSONResponse` renders `{"error":"…"}` with no space after the colon,
while the literals in `gateway.py` are written with one (`gateway.py:576`, `:595`,
`:614`, `:652`). Match on the status and the `error` key, never on spacing.

The `reason` vocabulary is stable and enumerated
(`gateway.py:106-146`): `control_plane_unreachable`, `authorization_refused`,
`tunnel_not_authorized`, `authorization_lease_pending`, `login_required`. Map each
to a distinct action, and fall back to `detail` for a reason a future relay adds.

## 5. Custom route (any tunnel or URL + relay password)

Behaviour mirrors the relay's own web client, which is the reference: form login,
then an authenticated cookie.

1. **Reject a Radient tunnel hostname here.** If the host matches the edge's own
   shape — `/^[a-f0-9]{32}-lop\./` (`index.ts:34`) — send the user to the tunnel flow
   instead of asking for a password: on that origin the gateway answers `/login`
   itself (`gateway.py:628-629`), so a password typed there is verified by nobody
   (step 4 makes that concrete). Everything else is classified as *direct*: a custom
   tunnel the user runs, or a plain URL.
2. Normalise and validate the base URL. Accept `https://…`. Accept `http://…` only
   for a private-network host **and** only when the transport-security change in the
   next subsection is in the build — the in-app switch alone does not make cleartext
   work, and a switch that promises something the platform refuses is worse than no
   switch.
3. `POST <base>/login`, `application/x-www-form-urlencoded`, body `password=…`,
   header `Origin: <base origin>`, `redirect: 'manual'`, `credentials: 'include'`
   (so the resulting cookie is stored by the platform jar; §4).
4. **Verify the login with an authenticated probe, never with the status code.** The
   relay answers a wrong password with `401` + an HTML error page
   (`daemon.py:3424-3447`) and a right one with `303 → /`, but a *gateway* in front of
   a `local-operator` harness answers `303 → "/"` for any request to `/login`,
   before the relay is ever reached (`gateway.py:628-629`) — so on that origin
   `303` proves nothing. The app therefore follows the login with
   `GET /api/sessions` (or `/healthz` first, then `/api/sessions`): `200` means the
   session is authenticated (by us or by a gateway that injects its own cookie),
   `401` means the password was wrong — regardless of which status the login itself
   returned. There is **no Bearer/Basic alternative**: the relay's only credential is
   the cookie (`daemon.py:3363-3397`; `basic_auth_header_user` in `auth.py:486-490`
   is not wired to any route).
5. Everything after this is the same API and the same SSE handling as the tunnel
   route; only the header policy differs.

#### Transport security for the `http://` option (native configuration, not a toggle)

Cleartext is refused by platform default on both platforms, so the switch above is
only honest if the build carries the native change too:

- **Android (amended 2026-10-06 — what actually shipped):** a local config plugin,
  `plugins/with-android-local-network.js`, sets `android:usesCleartextTraffic="true"`
  on the MAIN manifest's `<application>`. The earlier plan named
  `expo-build-properties`; it is not a dependency of this repository, and one more
  dependency for a single manifest attribute buys nothing beyond what an in-tree
  plugin does in the open. The
  attribute is app-wide because no narrower build-time declaration is expressible:
  the host is a private address the reader types at runtime, and a
  `networkSecurityConfig` cannot cover it — its `<domain>` element takes a host, not
  a range ("Network security configuration", developer.android.com, read
  2026-10-06; the format's only IP-address handling is the implicit localhost
  configuration added in Android 17). So the v1 cost stands as recorded: the blunt
  flag **plus** the in-app switch, and a sentence in the product copy saying exactly
  that. The debug variants set this attribute in their own overlays (for the Metro
  dev server, with `tools:replace`), which is why CI asserts the RELEASE merged
  manifest and not the debug APK — see the CI paragraph below.
  **The permission half (amended):** `ACCESS_LOCAL_NETWORK` is declared through
  `app.config.ts`'s `android.permissions`, inert while the app targets API 36.
  Android 17 blocks local-network access by default for apps that target SDK 37,
  but grants "legacy apps" (< 37) "an implicit permission grant for
  `ACCESS_LOCAL_NETWORK`", and its guidance is explicit: "Don't request
  `ACCESS_LOCAL_NETWORK` at runtime prior to targeting SDK 37"
  ("Local network permission", developer.android.com, read 2026-10-06). The runtime
  request therefore lands in the same change as the targetSdk-37 bump, where it
  means something — and the COPY half lands with it: while the build targets 36
  the permission cannot be the reason anything failed, so the Android sentence
  ships the machine-side check only and takes its Settings path (Google's own
  group, "Settings > Apps > [App Name] > Permissions > Nearby devices") in that
  same change (`tunnel-verdict.ts`, the `local-network` verdict).
- **iOS (amended 2026-10-06 — the page carries two readings, so both
  mechanisms ship):** the same shape, set through `ios.infoPlist` in `app.config.ts`.
  Apple's page for the key says it "controls whether App Transport Security (ATS)
  allows your app to connect to unqualified domains, `.local` domains, and IP
  addresses using IPv4 or IPv6", and that the local networking exception "tells
  newer versions of the OS to ignore the arbitrary loads key, and enable access to
  unqualified domains, `.local` domains, and IP addresses that they would otherwise
  restrict"
  ([developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking),
  read 2026-10-06). The same page also says, for iOS 17 and later: "ATS no longer
  allows connections to IP addresses by default. Add individual IP addresses and
  classless inter-domain routing (CIDR) ranges in the `NSExceptionDomains`
  dictionary." A previous revision of this ADR read the first sentence alone and
  concluded the key was a **single build-time boolean**; the page does not
  support that conclusion, so the build ships **both**: `NSAllowsLocalNetworking =
  true` and one `NSExceptionDomains` entry per literal private range the app's URL
  validation accepts — `10.0.0.0/8`, `100.64.0.0/10` (CGNAT, which Tailscale
  uses), `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16` — each with
  `NSExceptionAllowsInsecureHTTPLoads`, `NSAllowsArbitraryLoads` false, and no TLS
  relaxation. Loopback is deliberately NOT listed: TN3179 defines a local network
  as an IP network on a broadcast-capable interface, which loopback is not, and
  the app's only loopback use is the OAuth listener on the phone itself, never a
  route to the computer. (The `NSExceptionDomains` page confirms IP addresses and
  CIDR ranges are legal keys on iOS 17+; read 2026-10-06.)
  `NSAllowsArbitraryLoadsInWebContent` is a WKWebView key with no bearing on a
  native `fetch` (this app has no WebView in the data path at all).
  **The trade, stated rather than discovered:** the CIDR list is exactly the
  private literal-IP ranges and nothing else. A literal address outside it still
  depends on the boolean being read the lenient way, and a host named rather than
  numbered — the URL validation accepts `.local` names (covered by the boolean)
  and Tailscale MagicDNS names (which are not) — stays refused over `http://` on
  iOS where Android's app-wide flag would allow it; those routes publish an
  `https://` name, and that is the form to use. The same asymmetry also lets
  Android reach a public `http://` host that iOS refuses. **iOS
  therefore keeps parity with Android: `http://` on a private-network host is
  available on both platforms, off by default, behind the same explicit
  per-connection opt-in** — as *configured* under both readings; which reading the
  OS takes is the device procedure's question (§7, S10), not a claim here. The
  earlier revision's sentence "that premise was wrong" is thereby narrowed: the
  per-host-exception premise was not baseless — that mechanism is real and now
  ships alongside the boolean. **Parity is the manager's decision, taken over a recorded
  objection** — that offering a cleartext LAN path *at all*, on either platform, is a
  product cost, because the relay password and the transcript then travel in the clear
  and a warning is easy to click past. The answer that carries the decision: the
  option is off by default, it is reachable only behind an explicit per-connection
  opt-in whose copy states the exposure, and without it the app is useless in exactly
  the situation a tunnel-less user is in (same Wi-Fi, no Radient account). The
  objection is recorded here so it need not be rediscovered at review.
- Both changes live in `app.config.ts` + one local config plugin, are reviewed as
  native configuration, and are asserted in CI by `scripts/ci/native-config.ts`,
  out of BUILT artefacts only: the RELEASE variant's merged Android manifest
  (`android:usesCleartextTraffic="true"`, `ACCESS_LOCAL_NETWORK` — not the debug
  APK, whose overlays set the cleartext attribute themselves) and the built app's
  `Info.plist` (`NSLocalNetworkUsageDescription`, `NSAllowsLocalNetworking`, the
  CIDR `NSExceptionDomains`) — the same "generated config must match what we think
  we asked for" discipline ADR 0004 already applies to `expo prebuild`.

**What reading the sources settles, and what only a device can (amended
2026-10-06).** The permission side is settled by reading, and shipped: TN3179 —
which serves as plain text at its `.md` URL and was read in full on 2026-10-06 —
says "If your app accesses the local network, add the `NSLocalNetworkUsageDescription`
property to its `Info.plist` to explain its behavior to the user", and the key's own
page widens the audience to "apps that use Bonjour and services implemented with
Bonjour, as well as direct **unicast** or multicast connections to local hosts".
The alert is **one-time per app** ("The system records their decision, so future
accesses don't prompt"), a **direct outbound TCP connect is a trigger** ("Making an
outgoing TCP connection — yes"), and the first attempt **may be refused while the
alert is still on screen** ("it may deny the operation immediately, before the user
has responded to the alert … add appropriate retry logic") — which is why the
connection copy asks for the retry ("then tap Test the connection" — the control's
own label), and why a denial that renders as an ordinary
network failure is the defect the in-app copy exists to prevent. `NSBonjourServices`
is **deliberately deferred, with its reason**: it attaches to Bonjour browsing or
advertising, the app has no discovery, and declaring service types now would claim a
capability the build does not have (the app-store notes already call discovery "a
different review conversation").
The ATS side is NOT settled by reading — the page carries both statements quoted in
the iOS bullet above — so the build ships both mechanisms, and the procedure in §7
S10 settles which one iOS honours, **on a real device**, because the simulator
cannot: "The simulator doesn't support local network privacy. Test your local
network privacy behavior on a real device" (TN3179). **Neither S10 nor the Android
half of this section has been run; nothing here claims a device result.**

**The two platforms are not perfectly symmetric, and the copy should not pretend
otherwise.** Android's `usesCleartextTraffic` is app-wide — it permits cleartext to
*any* host — while the iOS configuration covers unqualified domains, `.local`
domains and IP addresses, with its CIDR entries limited to the private ranges. The
difference does not change the product surface (the switch is described as a LAN
option on both platforms, which is where it is meant to be used), but it does mean an
iOS build would refuse a *public* `http://` host that an Android build would allow.
That asymmetry is stated here rather than discovered as a platform bug.

**What the key does not do, and the cost that remains.** `NSAllowsLocalNetworking`
permits the connection; it does not secure it, and it is not an arbitrary-loads
downgrade — `NSAllowsArbitraryLoads` stays off, and the Radient route (https, to a
public hostname) is unaffected by either key. The cost that remains on this route,
on both platforms, is that **the relay password and the transcript cross the local
network in cleartext**: anyone on the same network segment can read them, and a
hostile DHCP/DNS answer on a public network can point the typed host at an attacker.
That is why the switch is off by default, why it is described as a LAN-only choice in
the UI before it is flipped, and why Tailscale's `tailscale serve` (`https://`, no
cleartext question) stays the recommended self-hosted route.

Caveats to state in the product copy rather than discover in the field:

- **LAN:** plain `http://192.168.x.x:4098` is a LAN-only, cleartext choice, available
  on both platforms only when the transport-security keys above are in the build and
  the user has opted in; the password crossing it is a real exposure, stated in the
  UI before the switch is flipped. When the OS itself blocks the attempt — an iOS
  local-network denial, or Android 17's blocked-by-default grant — the copy names
  the machine-side checks and the permission as a possibility (with a Settings path
  where the build can honour one: iOS today, Android's from the targetSdk-37 bump),
  never a generic "couldn't connect" (`tunnel-verdict.ts`, the `local-network`
  verdict). The possibility is claimed for literal private ADDRESSES only: a name
  that fails to resolve cannot be told apart from one the gate blotted out on a
  platform that hides the DNS reason (measured on the web target, 2026-10-06), and
  a typo must not be read as a permission problem. Reading the copy on real
  hardware is part of the device round S10 belongs to.
- **Tailscale:** `tailscale serve` gives a real `https://` name and is the
  recommended self-hosted route; Funnel publishes it publicly, which raises the
  stakes and deserves its own warning.
- **Cloudflare Access (or any identity proxy):** the app will meet a redirect chain
  into an IdP it knows nothing about. v1 declares this unsupported and says so;
  supporting it means driving a second browser-session flow with the proxy's own
  cookies, which is a separate decision with its own ADR.
- **Proxies that rewrite `Host`** break the relay's exact-origin mutation check
  (`daemon.py:3368-3386`); this surfaces as a 403, and the diagnostics screen should
  say why.
- The relay sets `Secure` only when the request arrived over TLS
  (`daemon.py:3449-3456`), so a plain-HTTP LAN route does work today — but that is
  a statement about the relay, not an endorsement.

## 6. Threat model notes

| Asset | Where it lives | Control |
|---|---|---|
| Radient OAuth refresh token (90-day rolling) | platform keystore | Rotated on every use; revocable server-side; never logged |
| Tunnel session refresh handle (30-day absolute) | platform keystore | Revoked by the control-plane logout call; sent to the **control plane only**, and to the edge only in the optional logout fallback — never on an ordinary request |
| Tunnel grant JWT (5 min) | memory only | Held in memory; never persisted |
| Relay password (custom route only) | user's head, optionally keystore | Never sent on the Radient route — the gateway injects the cookie itself |
| Transcripts, queued commands | device storage | Cleared on logout; the retry envelope's lifetime is bounded by the relay's own contract (24 h TTL, per-session) |

What we deliberately do **not** do: no WebView in any authentication path (providers
block it, and it would put an untrusted renderer in front of a credential); no
certificate exceptions; no plaintext storage of any token; no telemetry that could
carry a hostname off the device.

Residual risks worth stating out loud: an unlocked phone with the app open shows
transcripts; a rooted/jailbroken device can read the keystore; a hostile proxy on a
custom route can see the relay password; and screenshots of the transcript can leak
into the share sheet (the app should not make that worse with a “share whole
transcript” affordance that has no warning).

**Logout is a security control, so it is stated as one.** The primary revoke
(§3) must be the control-plane call, because the local delete that follows it forgives
nothing: a 30-day handle copied off the device stays valid until the control plane is
told. The app must therefore treat a failed revoke as a *visible failure* — offer a
retry and keep the connection marked as still signed in — rather than as a logged-out
state; and it must never claim "signed out everywhere" in copy, because it cannot
revoke a handle that has already been copied to another machine.

**One finding to carry upstream (not a change here).** The edge's incoming-cookie
strip list still names `lop_mobile_session` (`index.ts:257`) while the relay has set
`lop_mobile` since `auth.py:98`. Nothing leaks today — the gateway rebuilds the
`Cookie` header from an allow-list that does not include `cookie`
(`gateway.py:310-319`, `:445-456`) — so this is defense-in-depth hygiene in the
Local Operator and Radient repositories, not a defect in this app. It is recorded
here because this ADR is where the cookie names are enumerated, and a future reader
adding a proxy on the deployed edge will want the stale name gone.

## 7. Spikes this ADR asks for (and what each must prove)

| # | Spike | Pass criterion |
|---|---|---|
| S1 | Header control with `expo/fetch` on iOS 26/27 and Android 16 | A request with `credentials: 'omit'` carries our `Cookie` and `Origin` untouched; the platform jar neither adds nor stores cookies |
| S2 | `Set-Cookie` visibility on a 303 login response | Either we read the cookie value ourselves on **both** platforms, or the decision is “use the jar for `lop_mobile`”, recorded in this ADR as amended |
| S3 | Loopback listener across a browser session | The listener accepts the callback on iOS (ASWebAuthenticationSession presented) and Android (Custom Tab foregrounded), and the app resumes and reads the code; the listener is provably closed on every exit path |
| S4 | SSE through the tunnel for 5 minutes | Stream survives 4–5 gateway cuts, headers arrive intact, `: keepalive` frames parse, and a mid-stream network drop recovers to a fresh snapshot without user-visible data loss |
| S5 | Backgrounding | Document what happens to the stream when the app is backgrounded on each platform, and whether the projection resyncs correctly on resume — this decides whether “live updates while backgrounded” is a v1 promise or a notification-v2 promise |
| S6 | Session refresh under rate limits | Forced-expiry tests (expire the grant, then the handle) refresh once, not N times, when several screens request at once |
| S7 | A real tunnel, end to end | With a maintainer's own tunnel: sign in, mint, list sessions, stream, answer an approval, logout — captured as raw request/response evidence, hostnames redacted |
| S8 | **The audience allow-list actually accepts `lop`** (§1, and the one assumption under the whole direct-mint path) | `POST https://api.radienthq.com/v1/tunnels/session/code` with a real `lop`-audienced access token from a live app sign-in: **pass** = any answer other than the audience rejection (400 for a bad body, 404/403 for a tunnel that is not `active`, or 200 with a code); **fail** = `401`…`invalid audience`, which is the exact string `service.go:145-156` returns when `aud ∉ cfg.JWTAudiences`. Run it once as the first thing the implementation does. If it fails, the app either needs `RADIENT_TUNNEL_JWT_AUDIENCES` to include `lop` (a deployment change, no code change) or needs the browser-redirect fallback — and the ADR gets amended with which |
| S9 | **Logout actually revokes** | With a handle captured before logout: logout, then `POST /v1/tunnels/session/refresh` with that captured handle on another machine — **pass** = `401`…`invalid_grant` (`session.go:159-176`); **fail** = a new grant, which means the revoke never reached the control plane and the primary step is misordered |
| S10 | **Which ATS mechanism lets a literal private IP through, and what a blocked app sees** | On a REAL iOS device (the simulator does not support local-network privacy — TN3179: "The simulator doesn't support local network privacy. Test your local network privacy behavior on a real device"): with the shipped configuration (`NSAllowsLocalNetworking` + the CIDR `NSExceptionDomains`), the first `GET http://<private-ip>:4098/healthz` shows the one-time local-network alert, and after Allow the fetch succeeds. Then compare the two configurations the page left ambiguous — (a) the boolean only, (b) the CIDR exceptions only — to learn which one the OS honours. Also record the DENIED state: whether a denial is distinguishable from an unreachable computer (the copy names the permission as a possibility because reading found no discriminator; a measurement that finds one is what a follow-up matches on) — and whether a name that fails to resolve is distinguishable from a gated host, because the copy claims the permission reading for literal addresses only until that is settled. **Pass** = at least one configuration lets the fetch through and the shipped belt-and-braces build works; **Fail** = neither does, which is a finding against the configuration (raise it with Apple) rather than a product fallback, and this ADR gets amended with the result. **Not yet run (as of 2026-10-06).** |

S1–S5 run on a simulator or emulator and need no credentials; **S10 runs on a real
device only** — the simulator does not support local-network privacy (TN3179) — and
needs a build for each configuration it compares; S6 is a unit-level test against the mock;
S7–S9 are manual, credentialed runs, and their output belongs in the pull request as
redacted evidence, never in a committed file. S8 and S9 are the two that must run **before** any of §3 is treated as settled:
S8 because every token the app mints depends on it, S9 because a logout that does not
revoke is a security defect that reads as a success in the UI.

## Consequences

**Positive**

- Zero changes are required in Radient or Local Operator for v1: the sign-in client
  and its loopback redirects already exist, and the control plane's owner middleware
  is audience-based on `RADIENT_TUNNEL_JWT_AUDIENCES` — which the app's `lop`-audienced
  token satisfies **if** that variable's deployed value includes `lop` (§7 S8, the one
  assumption to verify before building on it).
- The transport design is inherited rather than invented: snapshots, the retry
  envelope, the reconnect rules, and the error vocabulary all have an existing
  implementation and an existing test suite to port from.
- The relay password never touches the Radient route, so the common case has one
  credential (a Radient account) instead of two.

**Negative**

- We depend on a 30-day absolute tunnel handle and a 90-day rolling OAuth grant;
  both need a background renewal path that must be exercised in tests, or users
  will meet a forced sign-in and read it as a bug.
- The Android sign-in flow has a rough edge (manual dismissal) until a native Auth
  Tab module exists.
- Cookie capture on iOS may force the jar-based design for the custom route, which
  is slightly less inspectable than owning the value.

## What would change this decision

- **The control plane restricting minting to the Worker.** If
  `POST /v1/tunnels/session/code` became non-public or required an edge-issued
  proof, the direct-mint path in §3 collapses and the app would have to drive the
  browser flow and let the *Worker* hold the session (with a WebView or a loopback
  proxy). Evidence: a 401/403 from that endpoint with a valid owner token, or a
  change to `service.go`'s route registration.
- **Spike S2 going the other way** (iOS exposing `Set-Cookie` cleanly) would let the
  custom route own its cookie too, removing the last reason to enable the platform
  jar anywhere.
- **A Radient-side mobile client with a claimed `https` callback** would move
  Option C from hardening to v1 and remove the listener entirely.
- **A relay-side change adding a JSON login endpoint or a scoped token** would
  remove the form-POST special case in §5; that is a change in the Local Operator
  repository, and this app should adapt rather than fork behaviour.
