# The audit harness: what each tool is for, and what it can prove

Three tools and a small fixture corpus, all plain Node with no dependencies, so
they run on a machine that has only Node, pnpm and the installed Google Chrome
(ADR 0003, "Context"):

| Tool | Question it answers | Run |
|---|---|---|
| `tools/mock-relay/` | What does the relay answer, in every state a phone can meet? | `pnpm mock:relay --scenario approval` |
| `tools/visual/` | What does the app *look like* in that state, on each device, theme and text scale? | `pnpm audit:capture --dir dist --out frames` |
| `tools/audit/` | Which of the rubric's mechanical checks does that state fail, and by how much? | `pnpm audit:run --manifest frames/manifest.json` |
| `e2e/fixtures/audit-canary/` | Can the audit checker *fail*, per rule rather than per check? | `pnpm e2e:canary` |
| `tools/mock-relay/divergences.ts` | Does the mock still behave like the relay in the ten places it once did not? | `pnpm e2e:divergences` |
| `tools/lib/doc-commands.ts` | Do the commands on this page actually run? | `pnpm e2e:docs` |

`pnpm e2e:docs` starts, waits for and reaps the commands that serve; it bounds
each command at 25 minutes (the slowest is `pnpm e2e:relay`), and `--verbose`
prints every command's output rather than only the failures'. A command this
machine cannot run is skipped **with its reason printed**, and its tool paths and
script names are still resolved, so a skip cannot hide a renamed file.

Every command above is also spelled `pnpm <script>` on purpose: a directory or a
file that moves breaks one place in `package.json` instead of fifteen lines of
prose. `pnpm e2e:verify` runs the type-check, this page's own commands, the relay
contract and the divergence checks together, and is what CI calls.

Nothing here installs a browser engine, starts a visible window, or touches a
relay the operator is running. The mock relay binds its own loopback port with
its own password, and every Chrome this harness starts is headless with a
throwaway profile under the session's scratch directory, reaped by pid and
swept by its own profile path afterwards.

---

## Read this before trusting any frame: which cells are measurable

**A frame is not coverage.** Every relay-backed cell — `S5/*` (the session view and
its streaming, aborted, queued and populated states), `S8/*` (pending approval and
pending ask) and `S6/*` (subagent detail) — is **NOT MEASURABLE today**, and a
design, UX or rubric reading drawn from those frames is a reading of the app's
**not-connected screen**, not of the state the cell names.

Measured on 2026-09-30, one device, one theme, with the relay recording every
request it served:

```
S5/populated          relay requests served: 0   DOM: session-screen, session-back, session-empty
                      text: "This session is not connected yet."
                      frame sha 0c58d3f807a5bbf4
S5/pending-approval   relay requests served: 0   DOM: session-screen, session-back, session-empty
                      text: "This session is not connected yet."
                      frame sha 0c58d3f807a5bbf4
```

The two frames are byte-identical because both are the same fallback screen. The
harness says so rather than leaving the reader to notice: the cell **fails by name**

```
S5__pending-approval__iphone-15__dark__100: the cell declares 'pending-approval' but
the app is showing an empty state (session-empty): the state was never reached; the
app made no request to the mock relay for this cell, so the state it declares
(pending-approval) cannot have come from the relay
```

and the report carries `meta.measurableCells`, `meta.notMeasurableCells` (each with
its reasons) and `meta.coverageNote`. `audit.ts` reads the same list and reports every
row of such a cell as `BLOCKED` with `blockedKind: "state-not-reached"` — never
PASS — and counts them as a gap, so the audit exits non-zero rather than green.

### Why these cells cannot be measured yet, and what unblocks them

The harness lands on the app's session route without taking it through its connect
flow (sign-in → computer pick → session), so the app is right to render "not
connected yet" and never talks to the page origin. Two routes were tried and neither
works from outside the app:

- **Seeding persisted state** is impossible on this target: the web build's credential
  store is in memory (`src/connection/storage.ts` — `memorySecureStore`, "the honest
  fallback for a runtime with no keystore"), so there is nothing on disk or in
  `localStorage` to seed.
- **Driving the flow by UI** is blocked by the app's own current state: the session
  list has no rows yet, so no flow reaches `/session/<id>` with a live route.

The unblock is an **app-side, web-only seed hook**, and this is the contract the app
streams need to implement for the matrix to cover those states: on web only, read a
documented parameter (for example `?lo-seed-route=<relay-url>&lo-seed-session=<id>`)
at startup and use it as the configured connection, with the app's own configured
route still winning whenever one exists. Until that exists, every relay-backed cell
stays **not measured** — which is a statement this harness makes per cell, not a
pass it hands out.

---

## 1. The mock relay

A deterministic re-implementation of the relay's documented routes
(`docs/relay/contract.md`) and the tunnel edge/gateway refusals
(`docs/relay/tunnel-edge.md`). It exists because the states that matter most —
a wedged runtime, a pending approval, an expired login, a stream cut at the
gateway's 60-second cap — are the ones hardest to produce on demand.

```sh
# every scenario, with the audit-matrix cells it fills
pnpm mock:relay --list
```

```sh
# one state, on an ephemeral port, printing the port alone on stdout
# docs:serves
pnpm mock:relay --scenario approval --print-port
```

```sh
# a state plus an adversity, and a transcript of every request/response
# docs:serves
pnpm mock:relay --scenario idle --fault sse-cut-after=6 --record "$SCRATCH/run"
```

(`docs:serves` is this file's own marker: the command starts a server and does
not exit, so `pnpm e2e:docs` starts it, waits for the readiness the line above
promises — a printed port — and reaps it by pid. The marker is read by the
check, never by a shell.)

### What it answers with

- **The captured corpus.** Response bodies come from `fixtures/relay/**`, the
  samples captured from a real relay, rather than from shapes re-typed here. A
  mock that re-derives a payload drifts from the relay silently; one that
  replays a capture cannot. Point it elsewhere with `--fixtures`.
- **The relay's own auth.** The cookie is `lop_mobile=<expiry>.<hmac-sha256>`
  signed with `sha256("lop-mobile-cookie\0" + password)`, exactly as
  `local_operator/mobile/auth.py` derives it, so the client's cookie and
  login paths are exercised rather than bypassed. `POST /login` is a form POST
  that answers `303` with `Set-Cookie`; a wrong password is `401` **HTML**.
- **The two-gate failure split.** An unauthenticated `/api/*` request is
  `401 {"error": "authentication required"}`; any other path is a `303` to
  `/login`. A client that has not encoded this reads the login page as a
  transport bug.
- **Real stream framing.** `event:`/`data:` pairs with a blank-line terminator,
  a `: keepalive` comment every 25 s, `cache-control: no-cache, no-transform`
  and `x-accel-buffering: no`.

### Scenarios

`--scenario <name>` pins one state. The registry is `tools/mock-relay/scenarios.ts`
and is the authority; `--scenario nope` prints the full list rather than
starting. Each scenario also declares the audit-matrix cells it fills
(`shows`), which is how the capture harness knows what to render without a
second hand-maintained list.

| scenario | cells it fills | what it pins |
|---|---|---|
| `empty` | S4/empty | No conversations at all: an empty catalogue with nothing degraded. |
| `loading` | S4/loading, S5/loading, S13/loading | No frame has arrived yet: every API route holds its response and the streams stay silent with keepalives only. |
| `idle` | S4/populated, S5/populated | One live conversation, idle, after a completed turn (the corpus capture). |
| `many` | S4/populated, S4/populated-long, S4/narrow | Twelve rows: pinned, streaming, needing attention, running subagents, a long name and a long cwd. |
| `degraded` | S4/degraded, S5/degraded | The session record is fresh but its runtime is unreachable: `subagents_running` is null while the row stays active (the SIGSTOP probe's signal). |
| `degraded-listing` | S4/degraded | The durable catalogue could not be walked: `degraded: ["sessions"]` with rows still present. |
| `degraded-attention` | S4/degraded | The completion-receipt store could not be read: `degraded: ["attention"]`. |
| `wedged` | S4/degraded, S13/degraded | A frozen runtime: the row reports real subagent counts until HEARTBEAT_TIMEOUT_S (45 s) has elapsed, then flips to null while `section` stays active. The two-sample comparison is the only signal. |
| `ended` | S4/ended, S10/populated | A finished conversation whose runtime is gone |
| `streaming` | S5/streaming | A turn in flight: assistant text grows frame by frame, then settles. |
| `aborted` | S5/aborted | A turn stopped on purpose: `stop_reason: aborted` with `cut_off: false`, then a second run with `cut_off: true`. |
| `queued` | S5/queued | One queued steering message and the tool row it skipped past. |
| `approval` | S5/pending-approval, S8/approval | A pending approval gate with a real running tool row beneath it. |
| `approval-destructive` | S8/approval | A pending approval whose detail is a destructive command, tool still composing. |
| `ask` | S5/pending-ask, S8/ask | A pending secret ask: free-text, with options offered and one recommended. |
| `ask-multi` | S8/ask-multi | The second of two questions in one pending ask, with a parallel count above one. |
| `subagent-running` | S5/subagents, S6/populated | A running subagent with a queued sibling and a parked one, plus a detail route. |
| `subagent-completed` | S6/populated, S6/populated-long | A completed subagent carrying a result, with a blocked second child. |
| `long-transcript` | S5/populated-long, S5/scroll | A 520-row tool transcript: the case the projection's 80-row cap and degradation tiers exist for. |
| `long-names` | S5/populated-long, S4/populated-long, S8/populated-long | A 64-character conversation name, a deep cwd, and a 400-character pending question. |
| `empty-transcript` | S5/empty | A session that has just started: the seed projection, no rows. |
| `every-entry-kind` | S5/populated | One row of every TranscriptEntry kind, for the renderer's fallback path. |
| `past-empty` | S10/empty | No past conversations. |
| `past-populated` | S10/populated | Past conversations to resume, including a fork wearing its parent's title. |
| `search-empty` | S4/empty | A search query with no results. |
| `search-hit` | S4/populated | A search with body-only matches, which must be marked as such. |
| `models-ranked` | S9/populated | The full ranked model catalogue — order is the ranking, never re-sorted. |
| `multi-computer` | S3/populated | Three computers: active, suspended and a second active one. |
| `no-computers` | S3/empty, S2/empty | No computer is registered yet: the set-up path. |
| `billing-inactive` | S13/error, S2/error | The tunnel's billing is past due: the gateway refuses with `authorization_refused`. |
| `tunnel-revoked` | S13/error | The tunnel was revoked: the gateway refuses with `tunnel_not_authorized`. |
| `login-required` | S13/error | The computer's Radient login expired: gateway `login_required`, and the edge answers 401 with the re-auth hint. |
| `relay-refuses-command` | S13/error, S5/error | A reachable relay that refuses the command: 422 with a typed code, which must never be retried as-is. |
| `gateway-503-authorization_deferred` | S13/error | Every request refused at the gateway with `authorization_deferred`. |
| `gateway-503-authorization_lease_pending` | S13/error | Every request refused at the gateway with `authorization_lease_pending`. |
| `gateway-503-authorization_refused` | S13/error | Every request refused at the gateway with `authorization_refused`. |
| `gateway-503-control_plane_unreachable` | S13/error | Every request refused at the gateway with `control_plane_unreachable`. |
| `gateway-503-login_required` | S13/error | Every request refused at the gateway with `login_required`. |
| `gateway-503-tunnel_not_authorized` | S13/error | Every request refused at the gateway with `tunnel_not_authorized`. |
| `gateway-502-relay-down` | S13/error | The gateway answers its own `502-relay-down` body. |
| `gateway-502-unsafe-redirect` | S13/error | The gateway answers its own `502-unsafe-redirect` body. |
| `gateway-503-relay-not-installed` | S13/error | The gateway answers its own `503-relay-not-installed` body. |
| `gateway-404-unknown-host` | S13/error | The gateway answers its own `404-unknown-host` body. |
| `gateway-413-too-large` | S13/error | The gateway answers its own `413-too-large` body. |
| `gateway-400-get-body` | S13/error | The gateway answers its own `400-get-body` body. |
| `edge-401-login-required` | S13/error | The edge worker answers `401-login-required` before the request reaches the relay. |
| `edge-401-invalid-session` | S13/error | The edge worker answers `401-invalid-session` before the request reaches the relay. |
| `edge-403-cross-origin` | S13/error | The edge worker answers `403-cross-origin` before the request reaches the relay. |
| `edge-404-unknown-tunnel` | S13/error | The edge worker answers `404-unknown-tunnel` before the request reaches the relay. |
| `edge-413-too-large` | S13/error | The edge worker answers `413-too-large` before the request reaches the relay. |
| `edge-503-radient-unavailable` | S13/error | The edge worker answers `503-radient-unavailable` before the request reaches the relay. |
| `edge-503-tunnel-unavailable` | S13/error | The edge worker answers `503-tunnel-unavailable` before the request reaches the relay. |
| `edge-530-cloudflare-1033` | S13/error | The edge worker answers `530-cloudflare-1033` before the request reaches the relay. |
| `edge-502-cloudflare-origin` | S13/error | The edge worker answers `502-cloudflare-origin` before the request reaches the relay. |
| `relay-down-at-gateway` | S13/error | The relay is up but the gateway cannot reach it: a local, fixable fault, not 'offline'. |

### Faults

`--fault <name>`, repeatable. Faults are adversities *on the wire*; they compose
with any scenario.

| Fault | What it injects |
|---|---|
| `sse-cut-after[=<seconds>]` | A **clean end-of-body** after N seconds (default 60, the gateway's real cap): no error frame, no sentinel, no status change, which is why an early EOF carries no information about why it ended |
| `sse-drop-mid-stream` | Half of a frame, then the socket dies — a torn event the framer must not emit |
| `split-chunks[=<ms>]` | Each frame written in two writes with a gap, so `data:` and its terminator land in different TCP reads |
| `stale-version` | A frame carrying an older `version` after a newer one: the fencing case |
| `silent-stall` | The seed frame then silence, with no keep-alives |
| `no-seed` | A 200 with SSE headers and nothing at all |
| `401-mid-session[=<seconds>]` | The stream ends, then the next request is the edge's `401` with `X-Radient-Login` |
| `slow-response[=<ms>]` | Every response delayed |
| `413-oversize[=<bytes>]` | The gateway's pre-flight body ceiling. Default is test-sized (64 KiB) so a run does not allocate the real 10 MiB; pass `=10485760` for the real number |
| `duplicate-delivery` | The same `command_id` delivered twice: one admission, `already admitted` the second time, one row |
| `no-ack[=<ms>]` | Accepted, never acknowledged, then `504 {"error": "session did not answer"}` — the ambiguous case the retry envelope exists for |
| `no-ack-forever` | Accepted and never answered at all |
| `503-<reason>` / `gateway-<key>` | A mid-session gateway refusal with any `RELAY_DETAIL` reason or gateway body |

### The control surface

`/__mock/*` is the mock's own namespace, public on loopback and absent from the
relay's contract. It is how the capture harness learns which scenarios and
session ids are being served (`GET /__mock/state`) and how a test can switch
state mid-run (`POST /__mock/scenario`, `POST /__mock/fault`, `POST /__mock/reset`).
It never shadows a contract route.

### Proving it answers what the relay answers

```sh
pnpm e2e:relay
```

Asserts the relay's own contract, each driving a real socket and
comparing against the captured corpus: the three auth rules, the cookie's format
and signature, the [redacted] rule on mutations, the command endpoint's status
mapping, idempotency, the read routes, **every scenario in the registry** (started
and asserted against the world that scenario declares) and every fault on the
wire. It exits non-zero on any failure and prints one line per check.

Because the scenario table is driven by the registry, a scenario added there is
verified without editing the script, and one whose shape drifts fails here before
it can mislead a capture run.

### Known mock/relay divergences

A QA pass drove ~44 request cases through this mock and a real `lop mobile serve`
and found ten divergences, all of which are now fixed **and asserted** by
`tools/mock-relay/divergences.ts` (`pnpm e2e:divergences`) — the verifier cannot
cover them, because they are fall-through behaviours the fixture corpus never
captured:

| # | Was | The relay's behaviour, now asserted |
|---|---|---|
| D1 | `404` on `/api/sessions/<unknown>/events` | `200 text/event-stream` that stays open and sends **nothing** |
| D2 | op refusal before the liveness check | `409 session not connected` first: contract §4.3's order IS the contract |
| D3 | an empty `/api/sessions/start` body fabricated a start | `400 invalid JSON` |
| D4 | the image route checked its parameter first | `404 unknown session` first |
| D5 | unrouted paths answered `404` JSON | `404 text/plain "Not Found"` |
| D6 | no 405 anywhere | `405 text/plain "Method Not Allowed"` with `Allow` |
| D7 | `POST /logout` accepted | `405`, `Allow: GET, HEAD` — only `GET /logout` exists |
| D8 | the cleared cookie omitted `expires` | `Max-Age=0` **and** `expires` |
| D9 | a relay-level 10 MiB ceiling | the bare relay has none (the cap is the gateway's); the `413-oversize` fault still models it |
| D10 | `/mark.png` served a stand-in | still a stand-in: the shipped mark is a binary asset in the relay's own bundle. The *bytes* are asserted to be a real PNG, which is what a client can observe |

D10 is the one divergence left, and it is cosmetic: a client reads `image/png`
and the signature, not the artwork. `divergences.ts` prints it on every run, so
the limitation is visible rather than inferred.

### The mock's observation surface (`/__mock/*`)

| Endpoint | What it answers |
|---|---|
| `GET /__mock/state` | `scenario`, applied `faults`, `sessions`, `admittedCommands`, `duplicateDelivered`, `uptimeS`, and two counts: **`requests`** is every request the relay *served* (control routes excluded, so reading the state cannot move it), and **`recorded`** is the length of the transcript `--record` would write |
| `GET /__mock/scenarios` | every scenario with the cells it declares, and every fault name |
| `POST /__mock/scenario` | pin the world (`{"scenario": "<name>"}`) — what makes a captured cell's state true rather than assumed |
| `POST /__mock/fault` | apply faults to a running relay |
| `GET /__mock/record` | the transcript rows themselves |
| `POST /__mock/reset` | clear the transcript |
| `POST /__mock/shutdown` | stop the process |

`requests` is a **counter**, and that is a fix rather than a description: it used to
be the transcript's length, which holds only the routes the mock records. A probe
that had fetched, streamed and screenshotted could therefore read `requests: 0` and
"prove" a recovery that never happened — a zero from a dead instrument reads exactly
like evidence. `verify` now asserts the counter moves when traffic is served, does
not move when the state is read, and stays distinct from `recorded`.

### What the mock cannot prove

- **Not that the relay is right.** It is a second implementation of the wire
  format and it can drift. The corpus and the contract are what keep it honest;
  a contract change must re-capture the corpus rather than edit the mock.
- **Not a substitute for a real relay.** The QA pass against a real
  `lop mobile serve` on an isolated config dir is what proves the app talks to
  the real thing.
- **Not the tunnel.** The edge and the gateway are Radient's surfaces, modelled
  here only to the extent the app must respond to them.

---

## 2. The visual capture harness

Serves a built web target, drives the **installed** headless Chrome over CDP,
and writes a frame matrix plus the numbers behind each frame.

```sh
# the whole plan, before spending any time on it. No build and no Chrome: the
# plan is computed from the relay's registry, and the fixture page stands in as
# the served directory so this line runs anywhere the tools do.
# docs:needs mock-relay
node tools/visual/capture.ts --dir e2e/fixtures/audit-canary \
  --out "$SCRATCH/frames" --relay <mock-url> --plan
```

```sh
# A real run against a real build: both themes, three text scales, every cell the
# relay declares. Build first — `pnpm export:web`, which writes `dist/`.
#
# This command reads the APP's current state, and on 2026-09-30 it exits non-zero
# with two true findings rather than a harness fault:
#   * eight `S5/*` states render byte-identically on a phone, so the app cannot yet
#     distinguish them (the readiness guard's identical-state rule);
#   * the text-scale guard measures 1.40x at 200% (median text 24px -> 33.6px), below
#     the 1.9x bar: part of the app's type is rem-based and scales, part is px-based
#     and does not, so "200%" is not a 200% render yet.
# `docs:exits 1` records that expectation so this page stays executable. REMOVE the
# marker (and this comment) once the app satisfies both — a marker that outlives its
# finding is how a green run stops meaning anything.
# docs:needs mock-relay web-build
# docs:exits 1
node tools/visual/capture.ts --dir <dist> --out "$SCRATCH/frames" \
  --relay <mock-url> --consecutive --yes
```

Output:

```
<out>/frames/<screen>__<state>__<device>__<theme>__<scale>.png
<out>/manifest.json     per-frame viewport, resolved theme, canvas colour, PNG hash,
                        console errors, and the measurements the audit consumes
<out>/index.html        the whole matrix in one page, with the numbers beside each frame
```

### The three things it is built not to get wrong

1. **The viewport is set with `Emulation.setDeviceMetricsOverride`, never
   `--window-size`.** On Chrome 152 the flag clamps the width at a 500 px floor
   and silently loses 87 px of height, so a frame's dimensions would be assumed
   rather than set.
2. **Every frame states its *resolved* theme and its *computed* canvas colour**,
   read back from the page — never what the harness asked for. A theme applied
   after first paint once produced two byte-identical "dark" and "light"
   captures, so the run compares the two frames' hashes, compares each canvas
   against the design token for the theme it claims, and fails on either. A
   frame with almost nothing mounted is reported as blank rather than passed.
3. **It reaps what it starts**, by pid, sweeps its own profile path, and asserts
   0 processes remain. A leaked browser keeps retrying the keychain on the
   operator's screen for minutes after the run.

### How the app is asked to change theme and text size

Two mechanisms, applied **before first paint** (`Page.addScriptToEvaluateOnNewDocument`):

- `Emulation.setEmulatedMedia` for `prefers-color-scheme` and
  `prefers-reduced-motion` — so an app that follows the OS appearance, like this
  one does through React Native's `useColorScheme()`, needs no cooperation at all.
- Query parameters `?lo-theme=dark|light`, `?lo-text-scale=<1|1.5|2>`,
  `?lo-reduce-motion=1`, plus `--lo-inset-*` custom properties published on the
  root element for the device profile's safe-area insets. These exist because a
  web build has no OS text-size signal a browser can emulate, and because
  `env(safe-area-inset-*)` cannot be overridden through CDP.

The harness does not assume either mechanism worked. It measures the **observed
text-scale ratio** (the median rendered text height at 200 % over the same
element at 100 %) and reports the dimension as live or **inert**. An inert
dimension is not a failed run — it is a run that cannot answer any large-text
question, and the manifest says so instead of producing three identical frames
labelled as three scales.

### Devices, themes and scales

| Device | Viewport | DPR | Insets (top / bottom / left / right) | Tier |
|---|---|---|---|---|
| `iphone-se` | 320×568 | 2 | 20 / 0 / 0 / 0 | core |
| `iphone-se2` | 375×667 | 2 | 20 / 0 / 0 / 0 | full |
| `android-compact` | 360×640 | 3 | 24 / 0 / 0 / 0 | full |
| `android-small` | 360×780 | 3 | 24 / 0 / 0 / 0 | full |
| `iphone-15` | 390×844 | 3 | 59 / 34 / 0 / 0 | core |
| `android-large` | 412×915 | 2.6 | 24 / 16 / 0 / 0 | full |
| `iphone-max` | 430×932 | 3 | 59 / 34 / 0 / 0 | full |
| `fold-cover` | 280×653 | 2.6 | 24 / 16 / 0 / 0 | full |
| `fold-open` | 673×841 | 2.6 | 24 / 16 / 0 / 0 | full |
| `iphone-15-landscape` | 844×390 | 3 | 0 / 21 / 59 / 59 | core |
| `android-large-landscape` | 915×412 | 2.6 | 0 / 16 / 24 / 24 | full |
| `tablet-768` | 768×1024 | 2 | 24 / 20 / 0 / 0 | full |
| `tablet-768-landscape` | 1024×768 | 2 | 20 / 20 / 0 / 0 | full |
| `tablet` | 834×1112 | 2 | 24 / 20 / 0 / 0 | core |
| `tablet-landscape` | 1112×834 | 2 | 20 / 20 / 0 / 0 | core |
| `tablet-pro` | 1024×1366 | 2 | 24 / 20 / 0 / 0 | full |
| `tablet-pro-landscape` | 1366×1024 | 2 | 20 / 20 / 0 / 0 | full |
| `android-tablet` | 800×1280 | 1.5 | 24 / 16 / 0 / 0 | full |
| `android-tablet-landscape` | 1280×800 | 1.5 | 16 / 16 / 24 / 24 | full |


All 19 profiles above are what the harness *can* plan, and they come from
`tools/visual/matrix.ts` — that file is the authority, and this table is
generated from it rather than maintained beside it. A default run captures the
`core` tier only (5 profiles: the 320 pt floor, one typical phone,
the landscape case whose side insets the notch rules need, and a tablet in each
orientation); `--full` adds the rest. A run states which tier it took, and a cell
that was not captured is reported BLOCKED rather than passed.

Themes: `dark`, `light`. Text scales: `100`, `150`, `200` (percent of the app's
default) — `150` is skipped on tablets and foldables, where it is not the
binding case. The insets are declared per device class in the same file rather
than buried in the probe, so a reviewer can argue with the number.

### What it can and cannot prove

- **Proves:** what the app renders, at a known viewport, in each theme and text
  scale; that the theme reached the render; that a first frame differs from the
  settled frame (post-paint reflow); and the geometry and colours the audit reads.
- **Cannot prove:** anything about the native render. A web export is not the
  device build, and the frames are a floor for layout, not a claim about iOS or
  Android. It also cannot show an *absence* — a reconnect flash that never
  appears is a Maestro flow's evidence, not a still's.

---

## 3. The audit checker

Runs the mechanical half of `docs/ux/audit-rubric.md` §3 over a captured state
matrix, re-driving the same URLs in headless Chrome (the check is over the real
render, not over a saved PNG), extracting geometry and the accessibility tree
over CDP.

```sh
# a real manifest from the fixture page, so the audit below has frames to read
# docs:needs mock-relay
node tools/visual/capture.ts --dir e2e/fixtures/audit-canary --out "$SCRATCH/frames" \
  --cells path:/defects/defects --cells path:/clean/clean \
  --devices iphone-se --themes dark,light --scales 100,200 \
  --relay <mock-url> --consecutive --yes
```

```sh
# the audit over those frames. The fixture declares its own defects, so this run
# is *supposed* to exit 1: `docs:exits` is how this page says so, rather than the
# check learning to ignore a failure.
# docs:exits 1
pnpm audit:run --manifest "$SCRATCH/frames/manifest.json" \
  --out "$SCRATCH/report" --tokens design/tokens/tokens.json
```

It writes `audit-report.json` and `audit-report.md`: one row per check × cell,
with the measured number, the frame it came from, and a verdict.

| Id | Check | Fail criterion |
|---|---|---|
| `U-01` | Touch-target size | min(w, h) < 44 pt (48 on Android). The rubric's dense-list exception is measured (≥ 24 pt with ≥ 8 pt of separation) and reported as `EXCEPTION`, never folded into a pass |
| `U-02` | Contrast, body text | < 4.5:1, or < 3:1 for large text, measured against the node's **effective** ground |
| `U-03` | Colour-only status | A status drawn only in a semantic colour, with no word, glyph or accessible name carrying it |
| `U-04` | Text scale to 200 % | Clipping at 200 %, **and** only when the harness showed the scale dimension is live |
| `U-05` | Safe areas | Content inside the notch band, or pinned content inside the home-indicator band, or a control within 8 pt of an unsafe edge |
| `U-06` | Horizontal overflow | The document wider than the viewport |
| `U-07` | Clipped text | `overflow: hidden`/clip with hidden content, except a single-line ellipsis that has a full value |
| `U-08` | Overlap | Two text-or-control boxes intersecting by > 25 % of the smaller one |
| `U-09` | Accessible name | An interactive accessibility node with no name |
| `U-10` | Label-in-name | The accessible name does not contain the visible label |

Three rules the report keeps: **a pass states its measurement**; **an exception
is recorded, never assumed**; and **a check that cannot be evaluated says
`BLOCKED`** rather than passing.

### How text scale is actually driven, and how the harness knows it worked

The app does **not** read a `?lo-text-scale=` query parameter. Its type roles
multiply the **browser root font size** on web (and `PixelRatio.getFontScale()` on
native), so the harness drives the root font size — the capture probe sets
`document.documentElement.style.fontSize = 16 * factor + "px"` before app scripts
run, which is the same input the app reads. The query parameter still exists, but it
is a **page's own opt-in**, not the app's mechanism: the audit-canary fixture honours
it, and a page that ignores both is the negative control below. Nothing in this
document should be read as "the app scales because the parameter is set" — that
inference is what produced a run of "200 %" cells rendered at 100 %.

Because a dimension that renders without measuring anything reads exactly like
coverage, the guard is **per cell**, not per run: for every (screen, state, device,
theme) captured at both 100 % and 200 %, the median rendered text height must grow by
at least **1.9×**. A cell that does not is failed by name —

```
path--inert__inert__iphone-15__dark__200: the text did not scale: median text 40px
at 200% against 1x the 100% cell (needs ≥1.9x), so this cell measures 100% and cannot
answer a large-text question
```

— and every frame records which of the two it was:

| Manifest field | What it says |
|---|---|
| `meta.textScaleVerdict` | the run-level sentence, with the median ratio |
| `meta.textScaleLive` | true only when every measured pair was live |
| `meta.textScaleLiveCells` / `meta.textScaleInertCells` | the cells by name, so a reader can tell a live 200 % row from a 100 % render wearing a 200 % label |
| `meta.textScalePairsPlanned` / `textScalePairsMeasured` | the coverage this run does not have |
| `records[].scaleLive` / `scaleRatio` | per frame; `null` means both scales were not captured, which is a third answer and not a pass |

A run-level median is not enough and was the earlier guard's flaw: one responsive
screen lifts the median while another screen's cell is inert. Both directions are
asserted in `verify` (`pnpm e2e:relay`): `e2e/fixtures/inert-text-scale/` is a page
whose type is entirely in `px` and must FAIL by name, and the rem-based
`e2e/fixtures/audit-canary/` must pass. Neither fixture is evidence about the app —
together they prove the *guard* discriminates.

### The U-08 overlap rule, and what it deliberately does not report

`U-08` pairs meaningful boxes (text or interactive) and fails a pair whose overlap
covers more than 25 % of the smaller box. Three cases are excluded or reported, and
the distinction is the whole rule:

| Case | Verdict | Why |
|---|---|---|
| A **pinned overlay** (any CSS keyword) over content that scrolls beneath it | **not reported** | pin-over-scroll is the intended design: a composer rides above a transcript, a settings footer rides above a form. The content is *under* an opaque bar, which no user sees as an overlap |
| A pinned overlay that is **translucent** | **reported** | a see-through bar over text IS a visible overlap, whoever painted it |
| A pinned opaque overlay that **encloses a control** | **reported** | a control the user cannot reach is a defect regardless of how the overlay was positioned |
| Two **pinned** elements overlapping | **reported** | two bars stacked on each other is a defect |

"Pinned" cannot be the CSS keyword. The first version tested
`position: fixed | sticky`, and `react-native-web` paints a pinned footer
`absolute`, so a correct `/` screen produced 32 overlap rows pairing its
composer with the content under it. An absolutely-positioned element therefore
counts as pinned when it is **anchored to a safe-area edge** — its rect starts at
`inset.top` or ends at `height - inset.bottom`, because a bar that clears the inset
is still anchored — and is **opaque**, which is what lets the rule read opacity as
the difference between the second row and the first.

Both directions are asserted in the canary, because a rule that only exempts is
indistinguishable from a rule that does nothing: `e2e/fixtures/audit-canary/` carries
a clean-path pin-over-scroll footer that must **not** be reported, and, on the
defect path, a translucent pinned bar and a control seated under an opaque pinned
bar that must be.

### A measurement outside the captured frame says so

The audit measures the live DOM, which is taller than the viewport, so a row can be
real and invisible at the same time — the frames look clean and the row is right. A
row whose measured region is off-screen therefore carries the note:
"the measured region is BELOW THE FOLD (y=… pt in a … pt viewport), so no frame can
show it". Without it a reader is left to reconcile a clean frame with a failing row,
and the honest reading of that gap is not obvious.

### Which of the rubric this actually covers

`U-01`…`U-10` are the ids this tool checks, and `U-04` is the only one reported
from a second dimension (the text-scale frames). The rest of the rubric is **not**
covered by this tool, and a reader should not infer that it is:

| Rubric range | Status |
|---|---|
| `U-01`…`U-10` | **machine-checked** by `audit.ts`, over every captured cell |
| `U-11`…`U-17` | **machine-defined in the rubric (docs/ux/audit-rubric.md §3) and NOT implemented here.** No tool in this repository checks them; a run reports them as unimplemented rather than passing them |
| `§4` copy, `§5` flow, `§6` per-screen, `§7` scoring | **manual**, a named reviewer's work (`ux-reviewer`/`designer`), not a tool's |
| `§9` assertions `R1`–`R6` | **unchecked**: they are rubric assertions with no tool behind them yet |

The generated `audit-report.json` carries the same split in its `coverage` field,
with `implemented` and `unimplemented` by name, so a report read on its own says
which half it is. `BLOCKED` is counted separately, so "we could
not tell" can never be read as "it passed". U-04 is reported from two facts for
the same reason: the scale dimension's liveness, and the clipping at 200 %.

Contrast maths is the design kit's own — the same WCAG formulae as
`design/tokens/contrast-contract.mjs`, applied to the *rendered* node rather
than to a declared token pair. The shipped contract validates the palette; this
validates the pixels.

### What it cannot prove

- It is a **floor for the web render**, not a claim about the native render.
- It cannot judge copy, hierarchy or intent: §4-§7 of the rubric are a named
  reviewer's work.
- It measures one frame per cell. A transition, a gesture, or a state that lives
  between frames is `ux-reviewer` territory.
- `axe-core` (ADR 0003's web floor) is deliberately **not** vendored here; see
  "Not built yet" below.

---

## 4. The canary: proving the audit can fail

```sh
pnpm e2e:canary
```

`e2e/fixtures/audit-canary/index.html` is a page whose defects are known and
declared in the markup as `data-defect="U-xx"`. The script captures it, audits
both paths, and asserts **both directions**: every declared defect is caught on
`/defects`, and zero checks fail on `/clean`. An instrument that cannot fail is
worthless, and either assertion alone is a trap — an audit that fails
everything would satisfy the first, one that passes everything the second.

The assertion is per **defect**, not per check id, and that distinction is the
point: a check with two independent rules (`U-05-top` vs `U-05-left`, `U-07-x` vs
`U-07-y`) would stay green with one of them dead, and a defect no element declares
(U-04's scaling clip) would not be asserted at all. Both were true of an earlier
revision, so `pnpm e2e:relay` now also runs a **mutation self-test**: it blinds one
rule at a time through `--blind <rule>` and requires the canary to fail naming
exactly that defect. A rule the self-test cannot blind is a rule nothing checks.

The canary also proves the harness's own dimensions work, in both directions:
`e2e/fixtures/audit-canary/` is written in `rem`, so the text-scale dimension comes
out **live** (measured median 2.00× at 200 %), and `e2e/fixtures/inert-text-scale/`
is written in `px` and must fail by name. `pnpm e2e:relay` asserts both.

What this does **not** say is anything about the app. The canary is a page this
repository controls; a live dimension there proves the *harness* drives a real
input, and the app's own cells are judged per cell by the guard described in
§"How text scale is actually driven". An earlier revision of this document quoted
a 3.00× median from the canary and read it as coverage of the app — a live
dimension on a page we wrote is not evidence about a page we did not.

---

## 5. Maestro flows (CI only)

`e2e/maestro/` holds the native flows for `docs/ux/flows.md`: first run and
sign-in (F-1), computers (F-2/F-4), the session list (F-5), the session view and
a steer (F-6), an approval and an ask (F-6/S8), a subagent drill-down (F-7),
settings with the theme and 200 % text switches (S11/F-10), connection-loss
recovery (F-9) and the refusal surfaces (S13).

```sh
# docs:needs mock-relay maestro
maestro --config e2e/maestro/config.yaml test \
  -e APP_ID=com.radient.localoperator.mobile \
  -e RELAY_URL=<mock-url> \
  -e SESSION_ID=6714def86197
```

**These have not been run.** They need a booted simulator or emulator and a
native build, and this repository's build-host rules forbid installing Xcode or
the Android SDK locally; ADR 0004 wires them to CI, and
[`ci-notes.md`](ci-notes.md) records how. Treat them as unexecuted until CI has
run them, and say so in any QA report rather than implying coverage.

They are also flows, not stills, because some of what F-9 needs to show is an
**absence**: a user must not see a reconnect flash when the gateway's 60-second
cap ends a stream, and no screenshot can show something that never appeared.

---

## 6. Not built yet, and the gaps that remain

- **`axe-core`** (ADR 0003's web accessibility floor). The audit's own checks
  cover the rubric's mechanical half; the library is a separate dependency and
  this change adds none. It belongs with the web-target work that owns the
  dependency graph.
- **Native E2E** has never executed (above).
- **The mock relay has not been run against a real relay's re-capture** in this
  change: the capture-and-diff job ADR 0003 requires is a CI job, not something
  this slice could stand up without an isolated daemon.
- **Pixel-diff regression** is deliberately absent (ADR 0003: not at v1).
- **`U-05`'s bottom band** judges *pinned* content only. On a scrolling page every
  control passes through the bottom band on its way past, so judging unpinned
  nodes would flag the whole document; a non-pinned control left inside the band
  is not caught. It is a recorded limitation, not an oversight.
