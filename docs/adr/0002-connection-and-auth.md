# ADR 0002 — Connection layer: sign-in, tunnel sessions, transports, custom relays

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-29
- **Deciders:** Local Operator Mobile maintainers
- **Depends on:** [ADR 0001 — Framework and styling stack](0001-framework.md)
- **Related:** [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md)

## Context

The app is a client for two servers it does not own:

- the **relay** — `lop mobile serve`, an HTTP + SSE server that binds `127.0.0.1`
  only, with a single shared password and a signed cookie
  (`~/local-operator/local_operator/mobile/daemon.py:3020-3044` for the route
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
   (`gateway.py:451-456`). On the Radient route the phone therefore never needs —
   and can never use — the relay password: the gateway supplies it.
2. **The relay is loopback-only** (`~/local-operator/docs/mobile.md`, "Security
   invariants": every listener binds `127.0.0.1`). A "custom URL" is therefore
   always *something else in front of* the relay, never the relay itself.

### Hard constraints we must design within

| Constraint | Source |
|---|---|
| Mutations require an exact `Origin` equal to the request's own origin | `index.ts:122-131` (edge), `daemon.py:2335-2355` (relay) |
| `Sec-Fetch-Site: cross-site`/`same-site` non-navigations are rejected at the edge | `index.ts:129-130` |
| Request bodies are capped at 10 MiB at the edge and the gateway | `index.ts:10`, `gateway.py:31` |
| SSE is cut every 60 s by the gateway lease and must be reconnected | `gateway.py:34`, `:578-594` |
| The relay pushes **full snapshots** (`event: projection`), never deltas, with a monotonic `version` per projection epoch | `daemon.py:3071-3072`, `types.py:SessionProjection.version` |
| The relay sends `: keepalive` every 25 s when idle | `daemon.py:76-79`, `:2517-2518` |
| Session endpoints are per-IP rate limited (5/s, burst 20) with a global budget | `internal/tunnels/service.go:96-110` |
| The grant lives 5 minutes; the tunnel refresh handle is opaque, **not rotated**, and lives 30 days absolute | `internal/tunnels/session.go:199-210`, `:159-176` |
| Radient OAuth access token lives 1 hour; the OAuth refresh token is **rotated on every use** and rolls 90 days | `internal/services/auth_service.go:452-455`, `:704-720` |

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
client does (`~/local-operator/local_operator/providers/oauth/radient.py:42-44`,
port 54549), and the console is built for it: its redirect whitelist is a
loopback regex with a required port
(`~/radient-ml/user-console/src/lib/native-oauth.ts:16`), and it navigates to
`redirect_uri?code&state` (`:110-123`).

- **Requires no Radient change.** Existing client id, existing registered
  redirects, existing scopes (`openid profile email offline_access`).
- The resulting access token is audienced to `lop`, which is already in the
  tunnel control plane's audience allow-list
  (`RADIENT_TUNNEL_JWT_AUDIENCES`, `internal/tunnels/config.go:86-90`; the test
  fixture uses `lop`, `config_test.go:68`), so **the same token can mint tunnel
  sessions** (§3) with no server change.
- The cost is the loopback listener: it must be alive for the few seconds the
  user is in the browser sheet, and the app must land the code whether the code
  arrives on the listener or through the browser session's own callback.

### Option B — a dedicated “Local Operator Mobile” OAuth client with a private-use scheme

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
- **Status mapping** (`internal/tunnels/service.go:302`, `:466-472`):
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
    allocates the hostname and reserves it (`service.go:300-310`), but the
    **computer** must then run `lop tunnel connect <id>`
    (`~/local-operator/docs/tunnels.md:57-62`). The app shows the id with a copy
    button and the exact command, then polls `GET /v1/tunnels/:id` while the user
    is on that screen.
  - *Already created:* the app lists it and explains that the connector has to be
    running on the computer; nothing the phone does can start it.
- **“Is the computer actually up?”** is answered by request outcomes rather than a
  health field: the gateway's health route is pinned to a loopback Host
  (`gateway.py:462-480`) and cannot be reached through the tunnel. The usable
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
| Any 429 | Exponential backoff with jitter; the session endpoints are per-IP limited to 5/s burst 20 (`service.go:96-110`) and a stampede takes out refresh for everyone on that IP |

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

**Alternative considered and rejected:** let the platform cookie jar hold
`__Host-radient-grant`/`__Host-radient-refresh` by using `credentials: 'include'`
and never touching the values. It works mechanically, but it puts the app's
single most important credential in a store we cannot read, cannot inspect for
expiry, cannot refresh in the background, and cannot clear selectively on logout.
Owning the tokens explicitly is more code and far more testable. §4 covers the one
route (`lop_mobile`) where the cookie jar *is* the right tool.

**Logout** clears both sides:

1. `POST https://<host>/_radient/logout` with `Cookie: __Host-radient-refresh=…`
   and `Origin: https://<host>` — the Worker forwards it to
   `/v1/tunnels/session/logout`, deletes the server-side refresh session, and
   clears its cookies (`index.ts:295-301`). This is the revoke that matters.
2. If the hostname is gone (tunnel deleted) the Worker 404s on `identity()`; then
   call `POST https://api.radienthq.com/v1/tunnels/session/logout
   {refresh_token, hostname}` directly (`session.go:185-196`).
3. Delete the secure-store items, the cached projections/transcripts, the retry
   envelopes, and any `lop_mobile` cookie left in the platform jar by the custom
   route.
   Radient's OAuth refresh token can also be revoked server-side
   (`RevokeToken`, `internal/services/auth_service.go:738-756`); the public route
   for it is not verified here — confirm before relying on it, and treat this as
   optional at v1 because deleting the local token already ends this device's
   access.

## 4. Request layer: headers, cookies, redirects

### Header contract

| Route | Every request | Mutations (`POST`) |
|---|---|---|
| Radient tunnel | `Cookie: __Host-radient-grant=<jwt>`, `Origin: https://<host>` | same, plus `Content-Type: application/json` |
| Custom URL | `Cookie: lop_mobile=<value>`, `Origin: <base origin>` | same |

- `Origin` is required *by the relay itself* for mutations, not only by the edge
  (`daemon.py:2335-2355`), and both compare an exact string. Send it on every
  request; it costs nothing and removes a class of 403s.
- **Never** set `Sec-Fetch-*` headers: a `cross-site`/`same-site` value that is not
  a navigation is rejected at the edge, and native clients have no reason to
  claim browser fetch metadata (`index.ts:129-130`).
- Do not send `Authorization` on the tunnel route — the edge deletes it
  (`index.ts:251`) and its presence only muddies diagnostics.

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
form login with `303 → /` plus `Set-Cookie` (`daemon.py:2391-2416`), and a failure
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
  (`~/local-operator/local_operator/mobile/web/src/store.ts:1-12`, `:104-160`).
- **Treat the 60-second cut as expected, not as an error.** The gateway's lease
  (`gateway.py:34`, `:578-594`) ends the stream cleanly; the client reopens at once
  with a small random jitter, and does not paint a “reconnecting” state for a
  normal rotation. A *silent* stream for more than ~35 s is the real failure signal,
  because the relay keeps the connection warm every 25 s (`daemon.py:79`).
- **Resync by snapshot.** Every push is a full projection with a monotonic
  `version` for its epoch; on reconnect, drop frames older than the last rendered
  one and accept the first frame of the new connection unconditionally (the relay
  reconciles epochs itself, and its own client implements exactly this
  `awaitingSnapshot` rule — `store.ts:215-245`).
- **Keep the last good projection while disconnected** and mark it stale rather
  than blanking the screen (`store.ts:250-258`). A flapping tunnel must not erase
  the transcript the user is reading.
- **Command delivery uses the relay's retry envelope**, not a naive POST retry: an
  instruction whose outcome is unknown (transport failure, or HTTP 502/504/408) is
  persisted with its UUID and replayed with the same UUID, so the relay de-duplicates
  it; a definitive 4xx/5xx rejection clears it. The contract is written out in
  `~/local-operator/docs/mobile.md:196-232` and implemented in
  `web/src/continuation-command.ts` — port the rules, do not re-derive them.

### Error taxonomy (drives the UI state machine)

| Response | Who | Meaning | UI |
|---|---|---|---|
| `401` + `X-Radient-Login` | edge (`index.ts:317-323`) | tunnel session expired | Silent re-mint; a second failure goes to sign-in |
| `503` `text/plain` “Tunnel temporarily unavailable” | edge (`index.ts:330`) | **the computer is offline** or its connector is down | “Computer offline” with retry |
| `503` JSON `{detail, reason, error}` | gateway (`gateway.py:397-430`) | connector is up but refusing | Show `detail` verbatim — it is written for a phone — plus the console link for `authorization_refused`/`tunnel_not_authorized` |
| `502` JSON `{"error":"local harness unavailable"}` | gateway (`gateway.py:557-558`) | the **relay daemon** is down | “Start the relay on your computer” |
| `404` JSON `{"error":"unknown tunnel host"}` | gateway (`gateway.py:483-484`) | tunnel/harness changed or was removed | Re-run discovery |
| `403` “Same-origin request required” | edge (`index.ts:128`) | we failed to send `Origin` | Diagnostics-only; never user-facing copy |
| `401` JSON `{"error":"authentication required"}` | relay (`daemon.py:2362-2364`) | custom route: password changed / cookie cleared | Re-prompt for the password |
| `429` | API | rate limited | Back off with jitter |

The `reason` vocabulary is stable and enumerated
(`gateway.py:73-95`): `control_plane_unreachable`, `authorization_refused`,
`tunnel_not_authorized`, `authorization_lease_pending`, `login_required`. Map each
to a distinct action, and fall back to `detail` for a reason a future relay adds.

## 5. Custom route (any tunnel or URL + relay password)

Behaviour mirrors the relay's own web client, which is the reference: form login,
then an authenticated cookie.

1. Normalise and validate the base URL. Accept `https://…`; accept `http://…` only
   for a private-network host with an explicit, per-connection “allow insecure
   connection” switch and a visible warning, because the relay's own docs assume an
   identity boundary in front of it (`docs/mobile.md:34-36`) and the password rides
   this connection.
2. `POST <base>/login`, `application/x-www-form-urlencoded`, body `password=…`,
   header `Origin: <base origin>`, `redirect: 'manual'`, `credentials: 'include'`
   (so the resulting cookie is stored by the platform jar; §4).
3. `303` → signed in; `401` → wrong password (the relay answers 401 with the login
   page and an inline error). There is **no Bearer/Basic alternative**: the relay's
   only credential is the cookie (`daemon.py:2330-2365`; `basic_auth_header_user`
   in `auth.py:486-490` is not wired to any route).
4. Everything after this is the same API and the same SSE handling as the tunnel
   route; only the header policy differs.

Caveats to state in the product copy rather than discover in the field:

- **LAN:** plain `http://192.168.x.x:4098` is a LAN-only, cleartext choice; the
  password crossing it is a real exposure. Say so before the switch is flipped.
- **Tailscale:** `tailscale serve` gives a real `https://` name and is the
  recommended self-hosted route; Funnel publishes it publicly, which raises the
  stakes and deserves its own warning.
- **Cloudflare Access (or any identity proxy):** the app will meet a redirect chain
  into an IdP it knows nothing about. v1 declares this unsupported and says so;
  supporting it means driving a second browser-session flow with the proxy's own
  cookies, which is a separate decision with its own ADR.
- **Proxies that rewrite `Host`** break the relay's exact-origin mutation check
  (`daemon.py:2335-2355`); this surfaces as a 403, and the diagnostics screen should
  say why.
- The relay sets `Secure` only when the request arrived over TLS
  (`daemon.py:2416-2424`), so a plain-HTTP LAN route does work today — but that is
  a statement about the relay, not an endorsement.

## 6. Threat model notes

| Asset | Where it lives | Control |
|---|---|---|
| Radient OAuth refresh token (90-day rolling) | platform keystore | Rotated on every use; revocable server-side; never logged |
| Tunnel session refresh handle (30-day absolute) | platform keystore | Revoked by logout; the edge never sees it from us |
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

**One finding to carry upstream (not a change here).** The edge's incoming-cookie
strip list still names `lop_mobile_session` (`index.ts:257`) while the relay has set
`lop_mobile` since `auth.py:98`. Nothing leaks today — the gateway rebuilds the
`Cookie` header from an allow-list that does not include `cookie`
(`gateway.py:235-247`, `:445-456`) — so this is defense-in-depth hygiene in the
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

S1–S4 run on a phone or simulator/emulator; S7 is a manual, credentialed run and its
output belongs in the pull request as redacted evidence, never in a committed file.

## Consequences

**Positive**

- Zero changes are required in Radient or Local Operator for v1: the sign-in client
  and its loopback redirects already exist, and a `lop`-audienced access token is
  already accepted by the tunnel control plane.
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
