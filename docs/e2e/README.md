# The audit harness: what each tool is for, and what it can prove

Three tools and a small fixture corpus, all plain Node with no dependencies, so
they run on a machine that has only Node, pnpm and the installed Google Chrome
(ADR 0003, "Context"):

| Tool | Question it answers | Run |
|---|---|---|
| `tools/mock-relay/` | What does the relay answer, in every state a phone can meet? | `node tools/mock-relay/relay.mjs --scenario approval` |
| `tools/visual/` | What does the app *look like* in that state, on each device, theme and text scale? | `node tools/visual/capture.mjs --dir dist --out frames` |
| `tools/audit/` | Which of the rubric's mechanical checks does that state fail, and by how much? | `node tools/audit/audit.mjs --manifest frames/manifest.json` |
| `e2e/fixtures/audit-canary/` | Can the audit checker *fail*? | `node e2e/run-canary.mjs` |

Nothing here installs a browser engine, starts a visible window, or touches a
relay the operator is running. The mock relay binds its own loopback port with
its own password, and every Chrome this harness starts is headless with a
throwaway profile under the session's scratch directory, reaped by pid and
swept by its own profile path afterwards.

---

## 1. The mock relay

A deterministic re-implementation of the relay's documented routes
(`docs/relay/contract.md`) and the tunnel edge/gateway refusals
(`docs/relay/tunnel-edge.md`). It exists because the states that matter most —
a wedged runtime, a pending approval, an expired login, a stream cut at the
gateway's 60-second cap — are the ones hardest to produce on demand.

```sh
# every scenario, with the audit-matrix cells it fills
node tools/mock-relay/relay.mjs --list

# one state, on an ephemeral port, printing the port alone on stdout
node tools/mock-relay/relay.mjs --scenario approval --print-port

# a state plus an adversity, and a transcript of every request/response
node tools/mock-relay/relay.mjs --scenario idle --fault sse-cut-after=6 --record "$SCRATCH/run"
```

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

`--scenario <name>` pins one state. The registry is `tools/mock-relay/scenarios.mjs`
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
node tools/mock-relay/verify.mjs
```

230 assertions over the relay's own contract, each driving a real socket and
comparing against the captured corpus: the three auth rules, the cookie's format
and signature, the [redacted] rule on mutations, the command endpoint's status
mapping, idempotency, the read routes, **every scenario in the registry** (started
and asserted against the world that scenario declares) and every fault on the
wire. It exits non-zero on any failure and prints one line per check.

Because the scenario table is driven by the registry, a scenario added there is
verified without editing the script, and one whose shape drifts fails here before
it can mislead a capture run.

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
# the whole plan, before spending any time on it
node tools/visual/capture.mjs --dir ~/local-operator-mobile-worktrees/app-scaffold/dist \
  --out "$SCRATCH/frames" --relay http://127.0.0.1:PORT --plan

# a real run: both themes, three text scales, every cell the relay declares
node tools/visual/capture.mjs --dir <dist> --out "$SCRATCH/frames" --relay <mock-url> --consecutive
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

| Device | Viewport | DPR | Insets (top/bottom) |
|---|---|---|---|
| `iphone-se` | 320×568 | 2 | 20 / 0 |
| `iphone-15` | 390×844 | 3 | 59 / 34 |
| `iphone-max` | 430×932 | 3 | 59 / 34 |
| `android-small` | 360×780 | 3 | 24 / 0 |
| `tablet` | 834×1112 | 2 | 24 / 20 |

Themes: `dark`, `light`. Text scales: `100`, `150`, `200` (percent of the app's
default). The insets are declared per device class and stated in
`tools/visual/matrix.mjs` rather than buried in the probe, so a reviewer can
argue with the number.

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
node tools/audit/audit.mjs --manifest "$SCRATCH/frames/manifest.json" --out "$SCRATCH/report"
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
`BLOCKED`** rather than passing. `BLOCKED` is counted separately, so "we could
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
node e2e/run-canary.mjs
```

`e2e/fixtures/audit-canary/index.html` is a page whose defects are known and
declared in the markup as `data-defect="U-xx"`. The script captures it, audits
both paths, and asserts **both directions**: every declared defect is caught on
`/defects`, and zero checks fail on `/clean`. An instrument that cannot fail is
worthless, and either assertion alone is a trap — an audit that fails
everything would satisfy the first, one that passes everything the second.

The canary also proves the harness's own dimensions work: the fixture is written
in `rem`, so the text-scale dimension comes out **live** (median 3.00× at 200 %).
If a change to the probe breaks the scale signal, the canary reports the
dimension inert and the run fails, rather than silently producing one frame
labelled as three.

---

## 5. Maestro flows (CI only)

`e2e/maestro/` holds the native flows for `docs/ux/flows.md`: first run and
sign-in (F-1), computers (F-2/F-4), the session list (F-5), the session view and
a steer (F-6), an approval and an ask (F-6/S8), a subagent drill-down (F-7),
settings with the theme and 200 % text switches (S11/F-10), connection-loss
recovery (F-9) and the refusal surfaces (S13).

```sh
maestro --config e2e/maestro/config.yaml test \
  -e APP_ID=com.radient.localoperator.mobile \
  -e RELAY_URL=http://127.0.0.1:<mock-port> \
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
