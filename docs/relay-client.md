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
`pnpm test` and exercisable against a real relay by `scripts/relay-smoke.ts`,
which drives the app's own client rather than a copy of it.

## Module boundaries

```
src/contracts/     the wire: types.gen.ts (the relay's dataclasses, mirrored)
                   schemas.ts    (zod, one per payload, types inferred)
                   parse.ts      (the only door in: parse / safeParse)
src/relay/         the protocol, UI-free and navigation-free
                   errors.ts     (status → typed error → three decisions)
                   http.ts       (headers, cookies, redirects, caching, timeouts)
                   sse.ts        (framing, keep-alives, the 60 s rotation, the fence,
                                  and what each way of ending is worth)
                   endpoints.ts  (one typed function per route)
                   platform-fetch.ts (the bound global fetch; see "Browser traps")
                   retry-envelope.ts (the persisted-command rules)
                   send-command.ts   (hold → send → settle, written once, and
                                      single-flight per session)
src/testing/       stand-ins for the platform, never imported by product code
                   cookie-jar-fetch.ts (the OS cookie jar, for Node)
                   fixture-relay.ts    (a real HTTP server replaying fixtures/relay)
src/e2e/           the outside-in suite: the real client against a real socket
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
| Two sends on one session in the same tick are ONE instruction | `relay/send-command.ts` (single-flight) |
| The copy a screen shows comes from ONE accessor | `relay/errors.ts` (`displayableMessage`) |
| One request is under one deadline, and what it covers depends on the response class | `relay/http.ts` (`open` / `release`) |

What single-flight does with a second call, in full, because the three cases are
different and a caller has to be able to tell them apart:

- **Same bytes** → the call JOINs the send in flight and shares its outcome: one
  request, one `command_id`, and `reusedPreviousDraft: false` (nothing was
  discarded — the joiner's own bytes are what is being sent).
- **Different bytes** → it waits for the send in flight and then runs normally, with
  its own id. Waiting must not become dropping.
- **Different bytes, and the send it waited on OVERLAPPED it and failed AMBIGUOUSLY**
  (its delivery is unknown, so its envelope is still held) → it is REFUSED with
  `ambiguous-delivery`, naming the unresolved instruction, and nothing of its own
  reaches the wire. The store's reuse rule would otherwise hand it the held
  envelope, putting the earlier instruction's bytes on the wire again under the
  earlier id — de-duplicated, so nothing runs twice, but the caller's draft would be
  replaced by one it never issued. The composer re-offers the draft; retrying the
  unresolved instruction (same id, de-duplicated) or discarding it is the user's
  choice. A DEFINITIVE failure clears the envelope, so that waiter proceeds with a
  fresh id.

**The refusal fires only while the first send is unresolved**, which is what the
third bullet is conditional on. A LATE re-send — the ordinary composer flow, where
the user edits and taps again after the first failure has already surfaced — does not
take that path: the ambiguous send has left the registry, `holdNew` hands back the
held envelope, and the result is `reusedPreviousDraft: true` with the EARLIER
instruction on the wire and the caller's draft unsent. The safety property holds
there too, by a different mechanism: `hold` writes an envelope's id and its bytes
together and only `runSend` sends them, so different bytes never travel under the
earlier id. Both paths owe the user the same affordance — a visible
`reusedPreviousDraft`, and the held draft still in the composer.

**Wire ONE store per session.** The registry is keyed by the envelope store, so two
stores for one session that send the same bytes in the same tick produce two POSTs
and two `command_id`s. That is deliberate — a `WeakMap` keyed by store is what keeps
two routes (or two tests) from queueing behind each other — but it means the
double-tap protection follows the STORE, not the session. A screen that builds a
store per render loses the guard.

### Compatibility: the receipts, and absent fields

The relay evolves additively. Two consequences are visible in the schemas:

- **Unknown fields are preserved, not stripped** (`z.looseObject`), so a newer
  relay cannot break an older app.
- **A field an older relay may omit has an explicit reading here**, and the
  difference between *absent* and *false* is kept where it is a fact rather than
  a style choice. `sessionProjection.activity_started_s: null` withholds the
  digits while `0` is a known zero; `SessionSummary.subagents_running: null` means
  the relay cannot vouch for the row, never "no subagents".

That last point is why the **session-health receipts** (`ended`, `degraded`, added
by local-operator PR #1784) have exactly one reading, and it is the contract's
rather than this client's (`docs/relay/contract.md` §6.5.1, rule 1 —
"**Absence means `false`.**", the rolling-upgrade rule `unseen` and `pinned`
already follow):

| On the wire | Reading |
| --- | --- |
| `ended: false`, `degraded: false` | nothing was observed to have ended, or to be degraded |
| `ended: true` | this daemon observed the session end: offer resume, not a composer |
| `degraded: true` | the record is fresh but the control socket is unreachable: label it, keep the transcript |
| **absent** (a relay older than `fc851a94e`) | `false` |

`false` is not a liveness claim, which is why defaulting it invents nothing: a
durable-only conversation — one nothing has registered with that daemon since
boot — reports `false` for both by construction, and the honest render for such a
row is the durable listing's own facts, not "running". `subagents_running: null`
stays the signal that nothing is being confirmed right now, so a durable rebuild
published with `pid: 0` reads as stale rather than live while `ended` stays
`false` — the relay did not observe that death, and neither may the client. That
pair is asserted from the real captures (`probes/durable-only-row.json`,
`sse/sse-projection-durable-after-death.json`, and `sse_projection_ended.json`,
the same rebuild at a ref where the caller had proved the end).

`isSessionEnded` / `isSessionViewStale` (`state/projection-store.ts`) are
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
| no response: the certificate was rejected | `certificate-rejected` | `connection` | never | keep |
| no response: the name did not resolve | `host-unresolved` | `connection` | after backoff | keep |
| a `2xx` whose body does not match its schema | `malformed-frame` | `none` | same id | keep |

The three "no response" rows are one catch in the code and three different answers
for a user, which is why they are not collapsed:

- **`certificate-rejected`** — a self-signed, expired or misaddressed certificate
  on the user's own tunnel. The fix is the certificate, retrying the same one
  cannot change the answer, and `connection` says the fix belongs to the route's own
  settings rather than to the computer or an account.
- **`host-unresolved`** — the address does not resolve: a typo, or a DNS record
  that is gone. One automatic retry is allowed (a resolver timeout clears by
  itself) and the sentence still names the address. This is the ordinary failure of
  a self-hosted tunnel URL, which is a supported route rather than a fallback.
- **`transport`** — everything else, including a runtime that reports neither a
  code nor a recognisable message. Its message is the RUNTIME's ("fetch failed"), so
  it is a diagnostic, and a screen that shows copy uses its own.

All three keep the envelope: a command whose request produced no answer at all has
an unknown delivery, and replaying is free while discarding is not.

The gateway's `reason` vocabulary (`gateway.py:66-95` at `52c1df35`, the ref the
fixture corpus was dumped from), mapped to distinct
surfaces rather than one "something went wrong":

| `reason` | surface | what the user is told |
| --- | --- | --- |
| `authorization_deferred` | `retry` | paused; clears by itself in about two minutes (the only reason with `Retry-After: 120`, which is `DEFERRAL_WINDOW_S` in `gateway.py:66` and is emitted by `refusal_headers()` at `gateway.py:503-518`) |
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
  schema tests pin the receipt, the absence-as-`false` reading, and the durable
  rebuild pair, so the old reading cannot silently return.

## The two deadlines, and the one sentence a screen may show

**A request is under one deadline, and what it covers depends on the response
class** (`relay/http.ts`):

- a **short read** (`json`/`raw`/`bytes`) is bounded from dispatch until its body has
  been read. A proxy that answers with headers and then stalls the body is an
  ordinary shape, and clearing the deadline when the headers arrived left the caller
  pending for ever — for `sendPersistedCommand` that is the composer waiting with the
  envelope held and the outcome never reported;
- a **stream's** body is deliberately not bounded: the deadline is cleared when the
  response arrives, and `sse.ts`'s silence watchdog owns everything after the
  headers. It is still bounded UP TO the response, because a connector that accepts
  the connection and never answers would otherwise sit in `connecting` for ever — the
  watchdog only starts once headers exist.

A failure in either phase is a `transport` failure: no answer arrived, so the
delivery is unknown and the envelope is kept.

**`displayableMessage` is the only accessor a screen may render.** It refuses the
four things that are not copy — a `transport` failure's message (the runtime's own
words: "fetch failed", "This operation was aborted", "connect ECONNREFUSED …"), an
empty body, a markup body (a proxy's HTML error page), and nothing at all — and falls
back to the sentence the classifier wrote for that status and kind. `message` is the
classifier's field and `diagnostic` is for logs; a screen that reads either directly
is how `""` or `<html><body>502 Bad Gateway</body></html>` reaches a user. A CLIENT
bug (`surface: "diagnostic"`) is a separate question and is read from `surface`: the
answer there is a retry affordance rather than a sentence.

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

## The fixture corpus is the specification's second copy

The schemas are tested against every file in `fixtures/relay/` (the tree merged with
the relay-contract docs), and the walk **fails on any file it has not classified** —
so a fixture added later cannot slip past unvalidated, and a schema cannot quietly
stop covering a route. Three parts of that corpus are read for their own rules
rather than as payloads, and each has an assertion instead of an exemption:

- **`provenance` is checked, not assumed.** Every fixture marks its own origin in
the file (`kind`, `relay_ref`, and `captured_at`/`how` for a capture or
`modelled_on`/`why` for a built sample), and the marker is the authority — a
sample sitting in the wrong directory is a test failure, not a rename to trust.
- **The probes are data.** `probes/*.json` record a row changing over time, and
they are what the receipts' rules came from: the counts go unknown at the
heartbeat timeout and `degraded` follows a scan later, never clears on a timer,
and a runtime frozen before it ever reported a beat never raises the flag at all
("false + null" is not health). `probes/durable-only-row.json` also shows a
**thinner** row after a restart — `model_label: ""`, counts `null` — so a screen
must not render a durable-only row through a layout that assumes those fields are
populated.
- **The ranked model list keeps its order.** `synthetic/models.ranked.json` wraps
the array, and its README entry says the order **is** the ranking: parsing must
not re-sort it, which is asserted directly.

## Known gaps in this slice

| Gap | Why, and what it needs |
| --- | --- |
| **Android sign-in has no loopback listener.** iOS works: `expo-web-browser`'s `openAuthSessionAsync` is an `ASWebAuthenticationSession`, which matches the callback URL itself. Android's Custom Tab polyfill resolves on browser CLOSE and cannot dismiss the tab, so a real listener is required and nothing in the shared dependency set provides one. `createDeviceListener()` throws `LoopbackUnavailableError` naming the need rather than hanging a browser sheet. Needs: a native `127.0.0.1` server module, or `expo-auth-session`'s loopback half. |
| **The retry envelope needs device storage.** It can legitimately be megabytes (a prompt with images) and is not a secret, so it does not belong in the keystore — iOS rejects large SecureStore values. Needs: `expo-file-system` or AsyncStorage. `retry-envelope.ts` takes an async key/value port, so a body is not needed. |
| **Routes not in this slice's endpoint list**: `/api/pair*`, `/api/projects*`, `/api/transcribe`, `/api/sessions/{id}/operator/challenge`. The schemas for the route an old client *does* read are covered; these four are the pairing, projects, voice and signing surfaces. |
| **`src/state/ui-store.ts`** (theme, text scale, sheets, toasts) is presentation state and belongs with the UI layer. |

## Running the smoke script

`scripts/relay-smoke.ts` runs the app's REAL client (`createRelayClient`,
`SseConnection`, `sendPersistedCommand`) against a running relay, so there is one
implementation of the protocol and the script cannot agree with a private copy of
it. It is a thin driver: only the sequence and the PASS/FAIL ledger are its own.
Node built-ins only, run with native type stripping (`node scripts/relay-smoke.ts`);
`scripts/lib/load-src.ts` is the resolve hook that lets Node load `src/`, whose
imports are extensionless because Metro and Vite do not need them.

It covers the public probe, the unauthenticated `401`, the form login and its
failure arm, a cross-origin `403`, the list on both transports, starting a
session, the session stream's seed frame, a durable command sent twice, a refused
op, history, the side payloads, the unread handshake and logout. Each step prints
`PASS`/`FAIL` with the actual detail; a step that cannot run is `SKIP` with the
reason and is never counted as a pass.

`--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` only silences the one warning
Node prints for `src/`: the repository root cannot declare `"type": "module"`
(`metro.config.js` is loaded with `require`), so its modules are reparsed as ES
modules and Node says so once. It changes nothing about the run, and it keeps a
transcript meant for a pull request clean. `--help` prints the recipe.

**Two suites, two questions.** `src/e2e/` (run by `pnpm test`) drives the same
client over real sockets against a fixture-replay server, so it proves the client
agrees with the *captured wire* and needs no daemon. The smoke script proves it
agrees with a *live daemon*; a fixture server cannot show that the daemon still
behaves as its fixtures say. Neither replaces the other.

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
    "$LOP_PY" -m local_operator.mobile.service --port "$PORT" &   # the INSTALLED runtime, read-only

# 2. The run.
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/relay-smoke.ts \
  --base-url "http://127.0.0.1:$PORT" --password-file "$ISO/pw"

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
needs the operator's account and tunnel. `scripts/radient-connection-check.ts` is
the credentialed version of that path (discover → mint a tunnel session →
authenticated `GET` → SSE → revoke), a thin driver over the same modules, and it
is deliberately not run by CI or by this repository's tests. Without
`RADIENT_ACCESS_TOKEN` it prints `NO CREDENTIALS — not run here` and exits 2.

## How a stream ends, and what the client does about it

Every way a stream ends is one of four, and only the last one stops the loop:

| The leg ended because | `lastEnd` | published state | what happens next |
| --- | --- | --- | --- |
| the gateway's ~60 s lease cut it | `eof` | `rotating` | reopens at once, reseeds from the first frame |
| a ~35 s silence tripped the watchdog | `eof` | `stalled` | reopens at once, reseeds |
| the socket was reset or errored mid-body | `error` | `stalled`, carrying `lastError` | reopens after a backoff, reseeds |
| the OPEN failed (a `401`, an unknown tunnel, a relay that is down) | — | `closed` | stops and calls `onError` |

Two consequences worth stating because they are deliberate:

- **A mid-stream reset is a broken connection, not a lease rotation.** A phone that
  changes networks gets a `transport`-class error from the body reader; the loop
  reopens on the same path a stall takes, with the delay DOUBLING per consecutive
  failure from `STREAM_RETRY_BASE_MS` to `STREAM_RETRY_MAX_MS` — a real floor plus
  jitter, not the rotation path's `random() * ms`, which can be zero.
- **That retrying is bounded.** `STREAM_RETRY_MAX_ATTEMPTS` consecutive mid-body
  failures end the loop through the same `closed` + `onError` a failed open uses
  (~8 s of backoff). Without it, a route whose handshake succeeds and whose body
  always fails would reconnect for ever and no caller would ever be told. The count
  resets on a delivered frame, so a long-lived stream that fails once keeps the full
  budget.
- **`onError` means "stopped", and only that.** A reconnecting stream reports its
  cause through the state (`lastEnd`, and `lastError` for an error-ended leg) so a
  screen stays on "reconnecting" for a transient failure while a diagnostics view
  still sees what happened. A failure to re-ESTABLISH is what ends the loop, and
  that is the one an `onError` handler will see.

## Browser traps the Node tests could not see

**`fetch` is brand-checked in a browser.** `window.fetch` called with any receiver
other than the window throws `TypeError: Illegal invocation` before a request is
made. Storing the platform function on an object and calling it as
`this.fetchImpl(...)` supplies exactly that wrong receiver, and the client turned
the throw into a `transport` error — a plausible "cannot reach the relay" with no
traffic at all. Node's own `fetch` accepts any receiver, so every Node test
passed. `relay/platform-fetch.ts` binds the global once, and every fallback to the
global goes through it. `src/e2e/brand-check.e2e.test.ts` reproduces the browser's
rule over Node's real fetch and asserts the server *received* the request.

**The refresh handle never rides an ordinary request.** Ordinary tunnel requests
carry `__Host-radient-grant` alone (ADR 0002 §6, `tunnel-edge.md` §2.1). Presenting
the handle would switch on the edge's transparent refresh, which re-sets both
cookies on a proxied response; the app ignores every `Set-Cookie` and refreshes
through the control plane on its own schedule. The handle is sent to the control
plane, and to the edge only by the optional logout fallback.

**A browser hides the redirect a form login answers with, so admission is
verified instead of read.** `fetch(url, { redirect: 'manual' })` in a browser
returns an OPAQUE redirect — `type: 'opaqueredirect'`, `status` 0, no headers, no
body — because the target counts as cross-origin under the CORS model. Node's
undici and `expo/fetch` return the real `303`, so the fixture suite, the device
and the smoke script all saw a success while a browser user was told
`kind: rejected, status 0` after a sign-in that had in fact set the cookie.
`relay/http.ts` names that shape (`isOpaqueRedirect`), and the two endpoints whose
outcome it hides act on it: `login()`/`logout()` verify with a follow-up read of a
route only an admitted session can answer (`GET /api/models` — the cheapest gated
route, 13 bytes against the sessions list's 902, both `401` without the cookie),
take the refusal's sentence from the taxonomy, and report how they know it —
`LoginOutcome.verified`, and `logout()`'s `signedOut`. `status` stays the number the
transport actually reported (`0` here) and is never synthesised: the verdict is
`signedIn`/`signedOut` plus `verified`, and anything that logs `status` sees a number
the relay could really have sent. A refusal the transport COULD see is unchanged: a
wrong password is still a plain `401`.

**A sign-in or sign-out helper returns a VERDICT, and never rejects.**
`signInToCustomRoute` / `signOutOfCustomRoute` publish `ok: true` unconditionally,
so every classified failure is mapped back into that shape with the taxonomy's own
sentence — including the relay's `403` for a page whose `Origin` is not the
relay's, which is the first gate a browser meets. `signOutOfCustomRoute` RETURNS
`signedOut`/`verified` rather than discarding them: a sign-out the relay did not
perform leaves a live 30-day cookie in the platform jar, and a screen that warns
about that needs to see it. A plain `transport` is the one failure whose taxonomy
message is a runtime diagnostic, so it is replaced with a sentence of its own
rather than shown to a user.

**The Radient route cannot work from a page at all, and that is the browser's
rule, not a missing feature.** `Cookie` and `Origin` are forbidden header names in
`fetch`: a page cannot set them, so the client's own grant header and tunnel origin
are dropped silently, the edge receives neither, and its `401` reads to the user as
"tunnel session expired". Nothing in this client can fix that, and the fix is not
in the client: the Radient route is **native-only**, and the web target is a
design/audit surface which uses the **custom** route. A route picker must not offer
Radient on web. This is asserted where the header policy is applied
(`connection/profile.ts`, `connection/client-factory.ts`).
