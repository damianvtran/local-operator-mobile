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
each command at **40 minutes** — the figure is the slowest documented block's
measured runtime with room to spare, because a bound below a command's real
runtime reports the command as broken, which is worse than no bound.

That figure is **load-dependent, and it is the one to quote**: `pnpm e2e:relay`
(which is `verify`) measured **28 minutes** on this host at load averages 32–46,
against ~13 minutes on a quiet one. The README, `tools/lib/doc-commands.ts` and
`tools/mock-relay/verify.ts` all state that single figure; if you change one,
change all three. The app-build capture block — the other candidate for slowest —
is bounded to a 74-cell sample (`--devices iphone-15 --themes dark --scales
100,200`) precisely so the gate can pass for the reason the block declares
instead of by timing out. A command this
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

**A frame is not coverage.** Every run prints two counts and a third list, and
the three answer different questions:

| field (TOP LEVEL of `manifest.json`, not under `meta`) | what it means |
|---|---|
| `measurableCells` | cells that reached the state they declare. Only these frames are evidence. |
| `notMeasurableCells` | cells that did NOT, each with its reasons. A finding about the harness or the app. |
| `declaredSkips` | cells whose state this head does not render yet, each with the work that owns it. NOT a gap, and NOT evidence. |

Measured on this head, one device and theme (`--devices iphone-15 --themes dark
--scales 100`), 36 cells:

```
audit: 36 cells, 378 check rows, 252 measured, 54 FAIL, 126 BLOCKED (0 unmeasurable) · palette loaded
audit: 10 cell(s) are DECLARED SKIPS (not gaps):
```

PLEASE READ THOSE NUMBERS TOGETHER. The capture for that run exits 0 — every captured
cell reached the screen and state it names — and the AUDIT then fails 54 rows, all of
them `U-02` contrast on the session view's composer placeholder (`Message Local
Operator…`, measured **1.29:1** where 4.5:1 is required at 16px, on all 21 session-view
cells). That is a new finding rather than a new harness fault, and it is exactly what
the harness is for: while `app/(app)/session/[id].tsx` was a placeholder those cells were
declared skips and the audit measured 81 rows; PR #12 landed the real session view, the
cells became capturable, and the audit now measures 252 rows and finds this. It is an
app finding, not a harness one, and it is named here so the `Web target` job's audit
step is read as "the session view's composer fails contrast", never as a broken checker.

The 10 declared skips are:

- **5 computer cells** (`S2/empty`, `S3/empty`, `S3/populated`, `S13/loading`,
  `S13/degraded`) need something the relay cannot serve: the computer LIST comes
  from Radient's account API (`src/connection/discovery.ts`, `GET /v1/tunnels`),
  so every relay scenario renders the same "Set up a computer" path. Only the
  refusal state (`S13/error`) is reachable, because the mock's gateway refusal
  drives it.
- **3 list states** the app renders without an identifier of their own:
  `S4/loading` (skeletons), `S4/ended` and `S4/degraded-row` (the row receipts
  change copy and colour — "ended", "not answering" — but carry no `testID`).
- **2 subagent cells** (`S6/populated`, `S6/populated-long`): the app declares no
  `subagent` subject, so nothing in a frame can affirm them.

The 21 session-view cells used to be in that list. They are not any more: the app now
declares `session-populated` and the rest, and a declared skip is honoured only while the
app declares no marker for the cell's state — so those entries are refused on this head
and never printed. `matrix.ts` still carries them, with a comment saying so: the owner
text describes the head they were written for, and removing them is a change to the
premise of `verify.ts`'s "no screen whose empty marker the app declares is left
unexplained" check (the app no longer omits the session subjects either) rather than a
tidy-up.

A declared skip is honoured **only while the app declares no marker for that
cell's state**, so it can never hide a marker that stopped rendering: flip a
declared marker off and the cell comes back as `notMeasurableCells`, by name, and
the audit exits 3 instead of 0. That is asserted, not hoped for — measured
2026-10-02 by removing the `sessions-degraded-banner` `testID` from
`src/features/sessions/sessions.tsx` in a scratch build:

```
UNREADY CELLS (1):
  - S4__degraded-listing__iphone-15__dark__100: the cell declares 'degraded-listing'
    but the marker 'sessions-degraded-banner' is not in the DOM: nothing in the frame
    affirms that state, so the cell is NOT MEASURABLE for it
audit: 9 cells, 90 check rows, 72 measured, 0 FAIL, 18 BLOCKED (10 unmeasurable) · palette loaded
audit-exit=3
```

### The state-marker contract is the app's, and the harness imports it

A cell declaring `<screen>/<state>` is evidence only if the frame carries the id
the app renders in that state. Which id that is, is declared in
**`src/ui/a11y.ts` `STATE_MARKER`**, keyed `<subject>/<state>` — `sessions`,
`past`, `computers` — and `tools/lib/readiness.ts` **imports** it. The harness
keeps the cell vocabulary (`S4` is the matrix's language; the app never learns
it).

This used to be a table in the harness that asked for `<subject>-<state>`
(`sessions-populated`, `computers-error`, …). The app renders no such ids, so
every relay-backed cell was reported NOT MEASURABLE while the tool looked
healthy — a harness dialect beside the app's vocabulary, with the failure
dressed as a finding about the app. An entry in `STATE_MARKER` must be an id
present in ONLY that state (a screen root or a container is not a marker, because
it is on screen in every state), and a value ending in `-` is a family prefix
(`session-row-`, `past-row-`). A state with no entry is a **declared gap**: the
harness reports the cell by name rather than inventing a marker.

**A marker counts by PRESENCE; a screen root requires VISIBILITY.** Two different
questions, and conflating them made most of the app's declared states unmeasurable. A
state marker is a machine-readable assertion about what a screen is showing — not an
affordance a person taps — and the app's derived markers are zero-size `View`s by
design (`src/features/session/state-markers.tsx`), so requiring a non-zero box
excluded exactly the states this rule exists to affirm: the design round on PR #12
measured that `populated`, `streaming`, `aborted`, `queued`, `error`, `rich-rows`,
`pending-approval`, `pending-ask` and `subagents` could not be measured as shipped. A
**root** still requires a rendered box — `display:none`, `visibility:hidden` and a
zero-area rect all fail it — because the root IS the screen: a zero-size root really
would mean nothing drew. The probe reports both lists (`testIds` = presence,
`visibleTestIds` = rendered) and `tools/lib/readiness.ts` reads them separately
(`presentIds` for a marker, `visibleIds` for a root), so neither rule can be satisfied
by the other's evidence. Both directions are pinned in `scripts/readiness.test.ts` and
in `verify`'s readiness guard.

### Seeding a run so the app actually talks to the relay

```sh
# docs:needs mock-relay
pnpm audit:capture --dir dist --out "$SCRATCH/frames" --relay "$MOCK_URL"
```

`--relay` is enough. The harness serves the build itself and proxies the relay's
paths (`/api/`, `/healthz`, `/login`, `/logout`) **at that origin**, so it seeds
the page with the origin the build is served from and the mock relay's own
default password — the app's `lo-relay` / `lo-relay-password` /
`lo-relay-insecure` names, read by PR #11's `webRelayOverride()`.

Seeding the mock relay's OWN origin instead — which every earlier revision of
this page instructed — makes each request cross-origin, the mock sends no CORS
headers, the browser rejects the fetch before the app can authenticate, and every
relay-backed cell renders "The relay could not be reached". That run is green,
its frames exist, and none of them is evidence, which is why the default is now
the served origin. `--seed-route` / `--seed-password` remain as overrides.

The seed is **recorded, not re-typed**. `meta.seed` in the manifest holds what the run
applied (`applied`, `password`, `route`, `origin`), and `pnpm audit:run` re-applies it when
it re-drives the same cells — re-deriving a `route` that was the capture's own origin at the
**audit's** own origin, because the audit serves the build on its own port. A manifest that
records none (one written before the field existed) is not read as "nothing was seeded":
the audit says so on stdout and every cell whose record was ready is `BLOCKED` by name
instead of measured. Until PR #36 the audit rebuilt each cell's URL without the seed and
measured the app's own fallback screen under the cell's name: `0 FAIL` over 256 cells, 95 %
of whose measured cells described a screen the cell does not name.

The scenario is recorded the same way. The mock relay holds **one** scenario at a time, so
the capture pins each cell's before rendering it and writes the name to
`records[].pinnedScenario`; the audit pins the same one before re-driving, or the page is
whatever the previous cell left behind.

The origin must also be **stable across runs**, which is what `--port` is for: the
harness serves the build on an ephemeral port by default, so each run's serve origin —
the one the seed names, and the one the app's saved route and login are keyed by in
`localStorage` and the browser profile — is a different origin from the last run's. Pin
it (`--port 4321`) whenever a run depends on state an earlier navigation left behind
(a hand login, or a warm-up cell below).

**A relay-backed cell whose screen re-subscribes on login needs a WARM-UP first.** The
capture navigates once per cell and reuses one browser, and the design round measured
on PR #12 that the session screen does not re-subscribe its stream once login lands, so
a single-navigation capture keeps the 401 banner and the cell reads as an unreached
state. Nothing in `runCapture` warms the page up today — it navigates straight to each
cell's route — so a plan whose FIRST cell is relay-backed is the one to read with that
in mind, and a cell that needs the warm-up is a limitation of this harness rather than
of the relay. Measured counter-example on this head, so the limitation is not
overstated: `--cells S4/populated` alone, from a cold profile in one navigation, still
reaches the relay and is ready — the stream re-subscription is the session screen's
property, not one of relay-backed cells as a class.

### What the app still has to do (this harness cannot)

1. **Nine empty markers.** On this head `src/ui/a11y.ts` declares `-empty` for
   five subjects only, so `verify` names the screens whose empty state has no
   marker: `S1` (sign-in), `S1-welcome`, `S2`, `S3`, `S3-custom`, `S7`
   (new-session), `S11` (settings), `S13`, `S14`. Those are app-side work.
2. **A marker for the row receipts.** `S4/ended` and `S4/degraded-row` change
   copy and colour but leave no `testID` behind, so nothing in the frame can
   affirm them.
3. **A marker for the list's loading state** (`S4/loading`), which currently
   renders unlabelled skeletons.
4. **The computer cells**, which need Radient's account API — either a fixture
   path the mock can serve or an app-side state marker driven by something the
   harness can produce. (Distinct from the relay-backed cells above, which the
   design round on PR #12 established ARE reachable with the serve origin pinned
   and a warm-up cell first — see "Seeding a run" — so "the relay cannot serve
   this" is about the account API, not about the relay.)

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
# the password the mock's login form expects, alone on stdout.
# An earlier revision read it with `node -e "import('./tools/mock-relay/relay.ts')…"`,
# and that started a listening relay: the import ran the CLI, the shell command
# substitution waited on the socket, and nothing ever returned. `relay.ts` now guards
# its CLI with `import.meta.main`, so a plain import is safe (the capture harness does
# exactly that for the default seed password) — but the printed form stays the
# documented one, because it cannot depend on the guard staying.
pnpm mock:relay --print-password
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
| `many` | S4/populated, S4/populated-long | Twelve rows: pinned, streaming, needing attention, running subagents, a long name and a long cwd. (`S4/narrow` is not declared beside it: this scenario builds ONE world and both names navigate to the same route (`/`), so the two cells were one state under two names — the identical-state check reported the pair as a collapse, the same bytes AND the same content, on iphone-se and tablet-landscape. A width is an AXIS rather than a state, so `narrow` went and `populated-long` — the content variant the rubric names — stayed; the narrow viewport is still captured by the `iphone-se` device at every cell.) |
| `degraded` | S4/degraded-row, S5/degraded | The session record is fresh but its runtime is unreachable: the row carries its own receipt (`degraded: true`, what a phone-observed SIGSTOP produces) and `subagents_running` is null while the row stays active. |
| `degraded-listing` | S4/degraded-listing | The durable catalogue could not be walked: `degraded: ["sessions"]` with rows still present. |
| `degraded-attention` | S4/degraded-listing | The completion-receipt store could not be read: `degraded: ["attention"]` — the same cell, because the reader's question is the same one. |
| `wedged` | S4/degraded-row, S13/degraded | A frozen runtime: the row reports real subagent counts until HEARTBEAT_TIMEOUT_S (45 s) has elapsed, then flips to null while `section` stays active. The two-sample comparison is the only signal. |
| `ended` | S4/ended, S10/populated | A finished conversation whose runtime is gone |
| `streaming` | S5/streaming | A turn in flight: assistant text grows frame by frame, then settles. |
| `aborted` | S5/aborted | A turn stopped on purpose: `stop_reason: aborted` with `cut_off: false`, then a second run with `cut_off: true`. |
| `queued` | S5/queued | One queued steering message and the tool row it skipped past. |
| `approval` | S8/approval | A pending approval gate with a real running tool row beneath it. (`S5/pending-approval` is not declared beside it: `matrix.ts` gives S8 the session route and the session subject, so a cell on either name is the same capture — one state under two names, which the identical-state check reported as a collapse once every cell was captured.) |
| `approval-destructive` | S8/approval | A pending approval whose detail is a destructive command, tool still composing. |
| `ask` | S8/ask | A pending secret ask: free-text, with options offered and one recommended. (`S5/pending-ask` is not declared beside it, for the `approval` reason above.) |
| `ask-multi` | S8/ask-multi | The second of two questions in one pending ask, with a parallel count above one. |
| `subagent-running` | S5/subagents, S6/populated | A running subagent with a queued sibling and a parked one, plus a detail route. |
| `subagent-completed` | S6/populated, S6/populated-long | A completed subagent carrying a result, with a blocked second child. |
| `long-transcript` | S5/populated-long | A 520-row tool transcript: the case the projection's 80-row cap and degradation tiers exist for. (`S5/scroll` is not declared beside it: the relay builds ONE projection for this scenario, so the two cells were one state under two names, and a scroll position is a viewport interaction the wire cannot declare.) |
| `long-names` | S5/populated-long, S4/populated-long, S8/populated-long | A 64-character conversation name, a deep cwd, and a 400-character pending question. |
| `empty-transcript` | S5/empty | A session that has just started: the seed projection, no rows. |
| `every-entry-kind` | S5/populated | One row of every TranscriptEntry kind, for the renderer's fallback path. |
| `past-empty` | S10/empty | No past conversations. |
| `past-populated` | S10/populated | Past conversations to resume, including a fork wearing its parent's title. |
| `search-empty` | S4/empty | A search query with no results. |
| `search-hit` | S4/populated | A search with body-only matches, which must be marked as such. |
| `models-ranked` | — (no cell) | The full ranked model catalogue — order is the ranking, never re-sorted. It declared `S9/populated`, and that cell was removed: the sheets are modals the app opens from the composer, no wire action opens one, and the cell therefore rendered `S5/populated` byte-for-byte (see the capture section). |
| `multi-computer` | S3/populated | Three computers: active, suspended and a second active one. |
| `no-computers` | S3/empty, S2/empty | No computer is registered yet: the set-up path. |
| `billing-inactive` | S13/error | The tunnel's billing is past due: the gateway refuses with `authorization_refused`. It used to declare `S2/error` as well, which was a second name for this same state (see the capture section). |
| `tunnel-revoked` | S13/error | The tunnel was revoked: the gateway refuses with `tunnel_not_authorized`. |
| `login-required` | S13/error | The computer's Radient login expired: gateway `login_required`, and the edge answers 401 with the re-auth hint. |
| `relay-refuses-command` | S13/error | A reachable relay that refuses the command: 422 with a typed code, which must never be retried as-is. |
| `mid-session-401` | S5/error | The stream comes up, carries the session, and then the edge refuses it: the reconnect is answered 401, so a connected session sits in its error state. |
| `stream-refused` | — (reachable by name) | The session's own event channel is refused at the gateway while the catalogue and the health route answer: a refused subscription, which the app surfaces as a connection state, so no matrix cell declares it. |
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
and signature, the same-origin rule on mutations, the command endpoint's status
mapping, idempotency, the read routes, **every scenario in the registry** (started
and asserted against the world that scenario declares) and every fault on the
wire. It exits non-zero on any failure and prints one line per check.

Because the scenario table is driven by the registry, a scenario added there is
verified without editing the script, and one whose shape drifts fails here before
it can mislead a capture run.

### The control ops the mock answers

`approval_answer` is implemented (it used to fall through to `command-unknown-op`,
which made the pending card's approve/deny/settle path unexercisable here): the
contract's own validation (§4.3) — `request_id` a non-empty string, `approved` a
bool, `remember` a bool when present, each refused `422` with the contract's own
sentence — and a real settlement, so the next projection frame carries no pending
request and `GET /__mock/state` reports `approvalsAnswered`. The success detail is
the mock's own wording: the relay passes the *runtime's* sentence through
(`daemon.py:4041`), so the shape is what the contract pins, not the words.

Two faults make previously unreachable client paths reachable:

| Fault | The condition it creates |
|---|---|
| `reused-draft-replay` | an instruction is admitted and **never acknowledged**, then the identical bytes are sent again and the relay answers `already admitted` — the condition the client's `reusedPreviousDraft` path exists for, and what the composer has to re-offer |

`rich-rows` is a scenario (cell `S5/rich-rows`) whose transcript carries a fenced code
block, a fenced diff and two tables — the rows that own the copy control — built on a
captured envelope from a synthetic fixture
(`fixtures/relay/synthetic/sse-projection-rich-rows.json`, `provenance.kind:
synthetic`). Without it, no scenario's DOM contained a fenced block, so a control the
kit's floor applies to was unmeasurable by anything.

### What the harness leaves behind, and what it cannot promise

Every run reaps its own Chrome by pid and profile, asserts the count is zero, reports an
error naming the profile if it is not, and prints the reading — `teardown: N process(es)
left by this run, M orphan(s) from earlier runs reaped, K live owner(s) left alone`. A
non-zero survivor count fails the run, and both numbers land in the manifest's `teardown`
block, so "a run that ends normally leaves nothing behind, and proves it in its own
output" is literally what the output does. It also **sweeps** profiles whose
owner has died: `launchChrome` records `chrome.pid` and `owner.pid` beside the
profile, and every later run's `close()` reaps any profile in the same root whose
owner is gone, then removes the directory. The kill is scoped to the profile path —
never to `chrome` by name, because a name-wide match is how one session's teardown
killed another session's processes — and a live owner's browser is skipped and
reported as `skipped`, never touched. The recorded pid is checked for **liveness** only;
the signal itself is always scoped to the profile path, so a pid the OS has since re-used
cannot be killed by mistake — what protects it is the path, not the pid.

The sweep exists because the guarantee it replaces was false: Chrome is spawned
`detached` (`kill -pgid` is safe then), so a run killed with SIGKILL cannot reap
anything and leaves a browser re-parented to pid 1. Four such browsers, four to seven
hours old, were found from cancelled gate runs while those runs' own reports said
nothing was left. So the honest statement is two-part:

- a run that ends **normally** leaves nothing behind, and proves it in its own output;
- a run that is **killed** cannot clean up after itself — the next run in that
  directory does it instead. It is self-healing, not instantly clean, and a machine
  that never runs these tools again keeps the orphan.

### D11 — the mock's op-shape validation is a SUBSET of the relay's

`validate_control_frame` (`types.py:208-424`) is a long if/elif chain; the mock replicates
the parts the harness exercises and **no more**, and the difference is visible on an unknown
session:

- **replicated**: `prompt`/`steer` text-or-image in the relay's order (a present-but-blank
  `text` can be rescued by a non-blank `data_b64`/`data`, a MISSING `text` key cannot) with
  the relay's own sentence; `approval_answer`'s `request_id`/`approved`/`remember`;
  `ask_answer`'s `request_id`/`value`.
- **NOT replicated**: `cancel`'s `mode`, `slash`'s `command`/`args`, `recall_steer`'s
  `command_id`, `credential`, `variables`, `register_secret_redaction`, `adopt_aside`,
  `peer_message`/`peer_set_model`, `input_mode`'s membership, `input_path`'s length bound.

For those ops a **malformed** request on an unknown session is `409` here where the relay
gives `422`; a well-formed one agrees (`409`). The order itself — validation between the
lookup and the 409, except for `prompt` — is checked at the pinned ref and asserted in D2.

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
| `POST /__mock/fault` | set the relay's **baseline** faults (`{"faults": ["<name>"]}`). A scenario is pinned *with* its own faults, so the applied set is this baseline plus the pinned scenario's — which is why a fault set here survives a pin and a fault a scenario declares does not |
| `GET /__mock/record` | the transcript rows themselves |
| `POST /__mock/reset` | clear the transcript |
| `POST /__mock/shutdown` | stop the process |
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
# A real run against a real build. Build first — `pnpm export:web`, which writes `dist/`.
#
# The device/theme/scale set is EXPLICIT and small on purpose: the full `core` tier is
# 832 cells, which is ~31 minutes at the measured 2.24 s/cell (403 cells in 903 s on the
# CI runner), and no documentation gate may spend that on one command. So this example is
# the bounded sample; `--plan` above prints the full count, and dropping these three flags
# captures the whole `core` tier. `--tier ci` is the sample the per-push CI job takes —
# every declared cell at two device profiles, both themes and two scales, 256 cells — and
# `--full` is all 19 profiles at 3008 cells.
#
# The bound is DERIVED FROM THE PLAN unless you name one: `--deadline` defaults to
# 3000 ms/cell with a 900 s floor, so a bound always holds the plan it was computed for,
# and a smaller explicit bound is printed beside the budgeted figure rather than
# discovered when it fires.
#
# This command reads the APP's current state. It exits 0 on this head; the two findings
# it used to record are fixed, and both fixes were declarations rather than app changes:
#   * `S2/error` and `S13/error` were ONE state under two names — `/tunnels` renders a
#     single refusal surface and `STATE_MARKER.computers` declares a single `error` — so
#     `S2/error` was removed from `billing-inactive`'s `shows`.
#   * `S9/populated` was the same state as `S5/populated`: the sheets are modals opened
#     from the composer, the harness reaches a screen only by URL, and the cell declared
#     the session's own marker. It was removed from `models-ranked`'s `shows`.
# A group made ONLY of DECLARED SKIPS is not reported at all — this head's 10 skips are
# one placeholder screen between them — but a group with ANY evidential cell in it is.
# The text-scale guard is REPORTED, never blocking: `themeProblems` comes from
# `verifyThemes` and the scale verdict does not feed it, so it cannot fail this run.
# Read the per-cell pair, not a run median.
# docs:needs mock-relay web-build
node tools/visual/capture.ts --dir <dist> --out "$SCRATCH/frames" \
  --relay <mock-url> --consecutive --yes \
  --devices iphone-15 --themes dark --scales 100,200
```

Output:

```
<out>/frames/<screen>__<state>__<device>__<theme>__<scale>.png
<out>/manifest.json     per-frame viewport, resolved theme, canvas colour, PNG hash,
                        console errors, and the measurements the audit consumes
<out>/index.html        the whole matrix in one page, with the numbers beside each frame
```

### When a frame fails transiently

`Page.captureScreenshot: Internal error` is a transient CDP failure — it appeared once
under fleet load and the same command passed standalone minutes later — and an aborted
capture run is indistinguishable from a real one. So one retry happens before a cell is
failed, and **the retry is counted rather than hidden**: `screenshotRetries` appears in
the manifest's `teardown` block, and a run that used one says so on stdout. A retry that
does not succeed still fails the cell.

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
orientation) — 832 cells at 26 frames per cell. A run states which tier it took,
and a cell that was not captured is reported as having no frame rather than passed.

Three tiers are declared in `matrix.ts`, and each says what it is:

| tier | sample | cells | why |
|---|---|---|---|
| `ci` | every declared cell × `iphone-se`, `tablet-landscape` × both themes × scales 100 and 200 | 256 | the per-push CI job's sample. The step is bound at 20 minutes and the measured rate is 2.24 s/cell, so an 832-cell `core` run cannot fit; this one lands ~10 minutes. It keeps the CELL axis whole — a state that is not captured is a state no review round can report on — and shrinks only the device, theme and scale axes, each to what its check needs: the narrowest and widest viewports (the two sides of the 768 breakpoint), because the theme check compares a cell's dark and light frames, and the 100 %/200 % pair the text-scale guard measures. |
| `core` | the 5 `core` profiles, both themes, all three scales | 832 | the default, and the local sample the operator's rule asks for. |
| `full` | all 19 profiles | 3008 | the dispatched/nightly sample. |

`--tier <ci|core|full>` or `--full` selects one; `--devices`, `--themes` and
`--scales` override any of them. The whole-run `--deadline` is derived from the
plan's size (3000 ms/cell, floor 900 s) unless you name one, so the default bound
always holds the plan it was computed for.

### Two cells that render byte-identically

The check this harness leans on hardest is the cross-cell one: two cells that declare
different states and produce the same bytes is the app ignoring the state, and it is what
caught `S13/error = S2/error` on 26 consecutive frames. **Bytes alone are not the verdict,
though**, because a frame is a viewport and a viewport can be filled by chrome. At 320 px
with 200 % text the session's header, progress and panel rows fill the whole picture, and
`S5/populated-long` and `S5/rich-rows` — whose transcripts differ in every row — are
byte-identical while the app renders both states correctly. So a byte-identical group is
partitioned by what each cell is SHOWING, read without the viewport (`CONTENT_PROBE`: the
rendered text and accessibility labels, i.e. what a phone would read out), and:

- **same bytes and same content** → a real collapse. It fails, as it always did.
- **same bytes, different content** → a limit of the camera. It passes **only** when the
  pair is declared by name in `matrix.ts` `IDENTICAL_FRAME_EXEMPTIONS` with the reason a
  reviewer needs (which viewport, and which content differs). An undeclared pair still
  FAILS, naming the key to declare — so a new collapse cannot exempt itself by being
  camera-shaped by accident, and the exemption table is a statement a reviewer reads
  rather than a knob that loosens the comparison.

Declared exemptions are reported (`EXEMPT IDENTICAL FRAMES (n)`) and recorded in the
manifest as `identicalStateExemptions`. Two lists fail a run: `identicalStates` (a
collapse — the same bytes AND the same content) and `identicalStateUndeclared` (the same
bytes, different content, and nothing has signed for it as a camera limit); the declared
exemptions do not.

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
| `U-03` | Colour-only status | A status drawn only in a semantic colour, with no word, glyph or accessible name carrying it. The palette carries **both themes**, because a dark cell's dot is the dark hex and a palette with only `.light` made the check unable to fire in dark at all |
| `U-04` | Text scale to 200 % | Clipping at 200 %, **and** only when the harness showed the scale dimension is live |
| `U-05` | Safe areas | Content inside the notch band, or pinned content inside the home-indicator band, or a control within 8 pt of an unsafe edge — measured on the node's **painted** box, and never on a node that paints nothing |
| `U-06` | Horizontal overflow | The document wider than the viewport; a node wider than the viewport is an `EXCEPTION` (recorded, never a pass) when an ancestor scrolls horizontally on purpose — the rubric's own clause, and the shape a code block has |
| `U-07` | Clipped text | `overflow: hidden`/clip with hidden content, except a single-line ellipsis that has a full value |
| `U-08` | Overlap | Two text-or-control boxes whose **painted regions** intersect by > 25 % of the smaller one. A pair whose layout boxes intersect while the painted regions do not is recorded as an `EXCEPTION` naming the reason, never reported as an overlap |
| `U-09` | Accessible name | An interactive accessibility node with no name |
| `U-10` | Label-in-name | The accessible name does not contain the visible label |

Three rules the report keeps: **a pass states its measurement**; **an exception
is recorded, never assumed**; and **a check that cannot be evaluated says
`BLOCKED`** rather than passing. A fourth is the audit's own: **a cell whose
re-driven page does not reach the state its record names is `BLOCKED` as
`state-not-reproduced`, never measured** — its rows would describe a screen the cell
does not name. That rule is the capture's own readiness rule (route, screen root and
declared state marker — **not** content), and its bound, including the cells it can
miss, is stated on `reDriveMismatch` in `tools/lib/readiness.ts`. The report prints
what it re-applied as a `- re-drive:` line, read from `meta.seed` and
`records[].pinnedScenario` rather than from a flag an operator has to remember.

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
covers more than 25 % of the smaller box. The cases below are excluded or reported, and
the distinction is the whole rule:

| Case | Verdict | Why |
|---|---|---|
| A **pinned overlay** (any CSS keyword) over content that scrolls beneath it | **not reported** | pin-over-scroll is the intended design: a composer rides above a transcript, a settings footer rides above a form. The content is *under* an opaque bar, which no user sees as an overlap |
| A pinned overlay that is **translucent** | **reported** | a see-through bar over text IS a visible overlap, whoever painted it |
| A pinned opaque overlay that **encloses a control** | **reported** | a control the user cannot reach is a defect regardless of how the overlay was positioned |
| Two **pinned** elements overlapping | **reported** | two bars stacked on each other is a defect |
| A node that **cannot be seen** — clipped to nothing by an ancestor on its containing-block chain (`overflow` other than `visible`), or `aria-hidden` and painting no ink of its own | **not reported** | a box is not a drawing. The composer's measuring stand-in is a full-size box inside a zero-height `overflow: hidden` wrapper, so its geometry overlaps the placeholder it measures while it paints not one pixel: 40 rows for an overlap nobody could look at. It is excluded from *this* rule only — U-07 measures clipping itself, and the stand-in stays in the app because the height it measures is a real fix. **The chain is the whole rule**: an ancestor clips only what is laid out inside it, so a `fixed` node or an `absolute` node whose containing block sits above a static wrapper is painted and is reported — the working shape of every toast and sheet |
| A pair whose **layout boxes** intersect while their **painted regions** do not — one of the two is clipped only PART of the way by an ancestor on its chain | **not reported**, and recorded as an `EXCEPTION` naming the reason | the same "a box is not a drawing" rule at the precision the row above needs. A node clipped part of the way keeps its FULL layout box, so that box reaches past its clipper and meets a sibling sitting outside it, and the layout pairing of 2026-10-04 reported exactly that as an overlap: on the `main` manifest every one of the 114 U-08 FAIL rows was such a pair, and 124 replayed pairs painted nothing on each other. Two nodes that really are drawn on top of each other still fail, and the canary asserts both directions |

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
bar that must be. The same fixture carries the two shapes a clip test is most likely
to swallow — an `absolute` node and a `fixed` node, each inside a static zero-height
`overflow: hidden` wrapper, each painted over content and therefore reported —
because the overlap cases above have no clipping ancestor between them, so a filter
that walked every ancestor instead of the containing-block chain would keep catching
those while hiding a real defect. And the painted-region rule above is asserted the
same way, in **both** directions: `data-defect` elements prove the rule still fires,
and `data-not-defect` elements (`#phantom-over` for U-08, `#inset-clipped` for U-05,
`#status-row-dot` for U-03) prove it stays silent on the shape it must not report —
invisible to the eye for the two geometry rules, redundant with the status word beside
it for U-03 — with the U-08 suppression still required to be RECORDED with its reason,
so a pair that quietly stopped overlapping cannot pass as a working rule.

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
[`ci-notes.md`](ci-notes.md) records how. **That file is deliberately NOT read by
`pnpm e2e:docs`**: its snippets are `yaml` workflow fragments rather than shell
commands, and this branch has no workflow to run them in (PR #10 owns CI). Its shell
one-liners name `pnpm` scripts, so a rename breaks them loudly rather than silently —
and the day #10 lands a workflow, that file should move inside the gate. Treat the
whole file as unexecuted until CI has
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
