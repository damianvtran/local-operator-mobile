# The relay client

How this app talks to a `lop mobile` relay: the module boundaries, what every
failure means and which screen owns it, and how to run the end-to-end smoke
script. It is the operator-facing companion to
[`docs/relay/contract.md`](relay/contract.md) (the wire, derived from the relay's
own code) and [`docs/adr/0002-connection-and-auth.md`](adr/0002-connection-and-auth.md)
(the decisions), and it exists so nobody has to reconstruct either from the
source.

**Nothing in `src/relay/` or `src/connection/` imports from `src/features/` or
`app/`.** All of it runs in Node, which is why the protocol is testable with
`pnpm test` and exercisable against a real relay by `scripts/relay-smoke.mjs`.

## Module boundaries

```
src/contracts/     the wire: types.gen.ts (the relay's dataclasses, mirrored)
                   schemas.ts    (zod, one per payload, types inferred)
                   parse.ts      (the only door in: parse / safeParse)
src/relay/         the protocol, UI-free and navigation-free
                   errors.ts     (status → typed error → three decisions)
                   http.ts       (headers, cookies, redirects, caching, timeouts)
                   sse.ts        (framing, keep-alives, the 60 s rotation, the fence)
                   endpoints.ts  (one typed function per route)
                   retry-envelope.ts (the persisted-command rules)
src/connection/    routes, identity, credentials
                   profile.ts        (RouteProfile: radient | custom)
                   pkce.ts           (S256, and the randomness behind it)
                   loopback.ts       (the OAuth callback, per platform)
                   radient-oauth.ts  (sign-in, refresh)
                   discovery.ts      (GET /v1/tunnels → computers)
                   tunnel-session.ts (mint, refresh, re-mint, revoke)
                   client-factory.ts (route → configured client; custom login)
                   storage.ts        (the ONLY module that touches the keystore)
src/state/         three zustand stores, no React
                   connection-store.ts (the only place a route starts or ends)
                   list-store.ts       (replaced wholesale on each push)
                   projection-store.ts (a frame is accepted only if it is the
                                        first of a connection or newer)
```

Four rules that keep the layers apart, each enforced by a file rather than by
convention:

| Rule | Enforced in |
| --- | --- |
| A malformed frame is a typed error, never a crash and never a coercion | `contracts/parse.ts` |
| A token is read in exactly two places — the HTTP layer and the refresh scheduler | `connection/storage.ts` is the only keystore reader |
| Only `startRoute` / `endRoute` change the active route | `state/connection-store.ts` |
| The retry envelope is written by one module, and nothing else decides keep/clear | `relay/retry-envelope.ts` |

### Compatibility: the receipts, and absent fields

The relay evolves additively. Two consequences are visible in the schemas:

- **Unknown fields are preserved, not stripped** (`z.looseObject`), so a newer
  relay cannot break an older app.
- **A field an older relay may omit has an explicit reading here**, and the
  difference between *absent* and *false* is kept where it is a fact rather than
  a style choice. `sessionProjection.activity_started_s: null` withholds the
  digits while `0` is a known zero; `SessionSummary.subagents_running: null` means
  the relay cannot vouch for the row, never "no subagents".

That last point is why the **session-health receipts** (`ended`, `degraded`,
added by local-operator PR #1784) are OPTIONAL and are *not* defaulted:

| Row | Reading |
| --- | --- |
| `ended: false`, `degraded: false` | live, and the relay vouches for it |
| `ended: true` | this daemon observed the session end: offer resume, not a composer |
| `degraded: true` | the record is fresh but the control socket is unreachable: label it, keep the transcript |
| **absent** (older relay, or a durable-only row) | an ordinary session. It is not an error, not ended, and not degraded |

A `.default(false)` would have collapsed the last row into a claim the relay never
made. `isSessionEnded` / `isSessionViewStale` (`state/projection-store.ts`) are
the only places that read them.

## Error taxonomy → UI state

Every failure is classified once, in `relay/errors.ts`. Three decisions ride on
each one: `envelope` (does a persisted command stay retryable), `retry` (may an
automatic retry happen, after what), and `surface` (which screen owns it). The
surface is decided here so three screens cannot each invent their own reading of
`503`.

| Response / body | `kind` | surface | retry | envelope |
| --- | --- | --- | --- | --- |
| `401` + `X-Radient-Login` (edge) | `radiant-login-required` | `sign-in` | re-mint | clear-all |
| `401` `{"error":"authentication required"}` (relay) | `relay-unauthorized` | `password` | never | clear-all |
| `403` `Same-origin request required` | `origin-refused` | `diagnostic` | never | clear |
| `413` (either gate) | `too-large` | `diagnostic` | never | clear |
| `429` | `rate-limited` | `retry` | after backoff | clear |
| `404` `Unknown tunnel` / `unknown tunnel host` | `unknown-tunnel` | `tunnel-gone` | never | clear |
| `404` `{"error":"unknown session"}` and friends | `rejected` | `none` | never | clear |
| `503` `text/plain` "Tunnel temporarily unavailable" | `computer-offline` | `computer-offline` | after backoff | keep |
| `503` JSON `{detail, reason}` — `reason` decides → | `gateway-refused` | see below | per reason | keep |
| `502` `{"error":"local harness unavailable"}` | `relay-down` | `relay-stopped` | after backoff | keep |
| `408` / `502` / `504` | `ambiguous-delivery` | `retry` | same id | keep |
| any other `4xx`/`5xx` | `rejected` | `none` | never | clear |
| no response at all | `transport` | `retry` | same id | keep |
| a `2xx` whose body does not match its schema | `malformed-frame` | `none` | same id | keep |

The gateway's `reason` vocabulary (`gateway.py:73-95`), mapped to distinct
surfaces rather than one "something went wrong":

| `reason` | surface | what the user is told |
| --- | --- | --- |
| `authorization_deferred` | `retry` | paused; clears by itself in about two minutes (the only reason with `Retry-After: 120`) |
| `authorization_lease_pending` | `retry` | usually clears in seconds |
| `control_plane_unreachable` | `computer-offline` | that computer cannot reach Radient |
| `authorization_refused` | `console` | Radient refused it: sign in again on that computer, or check billing |
| `tunnel_not_authorized` | `console` | the tunnel was revoked, suspended or changed |
| `login_required` | `console` | that computer's Radient login expired |
| anything else | `retry` | the gateway's own `detail`, verbatim |

Two rules the table encodes, both of which are expensive to get wrong:

- **Only `408`, `502`, `504` and a transport failure leave a command's delivery
  unknown.** Everything else clears the retry envelope. Keeping a `422` means
  every later prompt in that conversation refuses the same id; clearing a `502`
  means the user's instruction is lost after it may already have run.
- **`projection.degraded` / `ended` are readable now** (PR #1784). Before that they
  were never `true` on any published frame, and the contract's §6.5 said so; the
  schema tests pin both the receipt and its absence so the old reading cannot
  silently return.

## Insecure and unsupported connections

- Plain `http://` is accepted **only** for a private address (`10.`, `192.168.`,
  `172.16-31.`, `127.`, `100.64/10` for Tailscale, `*.local`, `*.ts.net`) and only
  with the caller passing `allowInsecure` — which the UI must obtain by showing
  the warning first. The relay password rides that connection.
- A tunnel hostname is **never normalised**. The edge accepts only
  `^([a-f0-9]{32})-(lop|oc)$` on `https` with no port; adding `:443` or
  lower-casing a label turns a working tunnel into `404 Unknown tunnel`.
- Cloudflare Access (or any identity proxy) is deliberately unsupported at v1: it
  would mean driving a second browser-session flow with cookies this app does not
  own.

## Known gaps in this slice

| Gap | Why, and what it needs |
| --- | --- |
| **Android sign-in has no loopback listener.** iOS works: `expo-web-browser`'s `openAuthSessionAsync` is an `ASWebAuthenticationSession`, which matches the callback URL itself. Android's Custom Tab polyfill resolves on browser CLOSE and cannot dismiss the tab, so a real listener is required and nothing in the shared dependency set provides one. `createDeviceListener()` throws `LoopbackUnavailableError` naming the need rather than hanging a browser sheet. Needs: a native `127.0.0.1` server module, or `expo-auth-session`'s loopback half. |
| **The retry envelope needs device storage.** It can legitimately be megabytes (a prompt with images) and is not a secret, so it does not belong in the keystore — iOS rejects large SecureStore values. Needs: `expo-file-system` or AsyncStorage. `retry-envelope.ts` takes an async key/value port, so a body is not needed. |
| **Routes not in this slice's endpoint list**: `/api/pair*`, `/api/projects*`, `/api/transcribe`, `/api/sessions/{id}/operator/challenge`. The schemas for the route an old client *does* read are covered; these four are the pairing, projects, voice and signing surfaces. |
| **`src/state/ui-store.ts`** (theme, text scale, sheets, toasts) is presentation state and belongs with the UI layer. |

## Running the smoke script

`scripts/relay-smoke.mjs` is plain Node with no dependencies, and deliberately
duplicates a little of `src/relay/` — a smoke run that shared the client under
test would only prove the client agrees with itself. It exercises the real relay
end to end: the public probe, the unauthenticated `401`, the form login and its
failure arm, a cross-origin `403`, the list on both transports, starting a session,
the session stream's seed frame, a durable command sent twice, a refused op,
history, the side payloads, the unread handshake and logout. Each step prints
`PASS`/`FAIL` with the actual status and byte count; a step that cannot run is
`SKIP` with the reason, never a silent pass.

```sh
# 1. An ISOLATED relay. Never the operator's 4098, and never a live tunnel.
ISO=$(mktemp -d "$LOCAL_OPERATOR_SCRATCHPAD/iso.XXXX")
mkdir -p "$ISO/.local-operator"; chmod 700 "$ISO"
printf 'values:\n  hosting: test\n  model_name: mock\n  tool_approval_mode: ask\n' \
  > "$ISO/.local-operator/config.yml"
umask 077
python -c 'import secrets;print(secrets.token_urlsafe(24),end="")' > "$ISO/pw"
PORT=$(python -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')

env -i HOME="$ISO" LOCAL_OPERATOR_CONFIG_DIR="$ISO/.local-operator" \
    PATH="$PATH" TERM=xterm-256color \
    LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_DESKTOP_LAUNCH=1 \
    LOP_MOBILE_PASSWORD="$(cat "$ISO/pw")" \
    <local-operator>/.venv/bin/python -m local_operator.mobile.service --port "$PORT" &

# 2. The run.
node scripts/relay-smoke.mjs --base-url "http://127.0.0.1:$PORT" --password-file "$ISO/pw"

# 3. Reap by pid and delete the root: an isolated daemon left running is a stray
#    listener, and the root holds a config and a password.
kill "$!"; rm -rf "$ISO"
```

`env -i` is what strips `CMUX_*` and `LOP_*`: an inherited `CMUX_WORKSPACE_ID`
lets a child rename the operator's real cmux workspaces, and inherited
`LOP_MOBILE_CHILD_*` makes a child adopt the parent session's provider and model.
`HOME` must be redirected as well as the config dir — the cache and agent home
derive from `HOME` independently.

The script refuses to run against port 4098 or any `*.radienthq.com` host, because
those are the operator's live relay and live tunnels.

**The one run this script must NOT make** is against the real Radient edge: it
needs the operator's account and tunnel. `scripts/radient-connection-check.mjs` is
the credentialed version of that path (discover → mint a tunnel session →
authenticated `GET` → SSE), and it is deliberately not run by CI or by this
repository's tests.
