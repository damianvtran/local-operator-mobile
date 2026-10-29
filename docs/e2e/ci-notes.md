# Wiring the audit harness into CI

For the job that owns `.github/**` (ADR 0004). Everything below is a command
that has been run locally, with the caveats stated where they have not.

## Why this is cheap enough to run on every push

The three local tools are plain Node with **no dependencies**, so a job needs
`actions/setup-node` and a checkout — no `pnpm install`, no browser download.
The only binary they require is the Google Chrome that the runner image already
has. Both tools reap their own Chrome by pid and sweep their own profile, which
means one job cannot leak processes into the next.

## The jobs

### 0. Types and the docs (per push, seconds)

```yaml
- run: pnpm e2e:typecheck     # tsc -p tools/tsconfig.json: tools/** and e2e/**
- run: pnpm e2e:docs          # runs every command in docs/e2e/README.md
```

`pnpm typecheck` (the app's own gate) does **not** cover `tools/**` or `e2e/**`:
`tsconfig.tools.json` includes `scripts/**` only, and those config files belong to
the app scaffold. `pnpm e2e:typecheck` is the gate for this slice's code, and a
CI job that runs only `pnpm typecheck` would type-check none of it.

`pnpm e2e:docs` resolves what every documented command names and then runs it, so
a renamed tool or a stale invocation fails here rather than in a reader's shell.

### 1. Mock-relay contract verification (per push, minutes)

```yaml
- run: pnpm e2e:relay
- run: pnpm e2e:divergences
```

Every assertion the verifier makes over the relay's own contract: the auth gates, the cookie format,
the same-origin rule, the command endpoint's status mapping, idempotency, the
read routes, every scenario in the registry and every fault on the wire. It
exits non-zero on the first failing assertion and prints one line per check.

`verify.ts` is the instrument's own proof and lives beside the relay it drives.
It takes no arguments on a normal run: it resolves the repository and the fixture
corpus from its own location, so it runs from anywhere. **It prints its own
assertion count** (`NNN/NNN checks passed`) and that printed number is the one to
quote: this file deliberately does not repeat it, because a count typed into a
doc drifts from the run the first time anyone adds a check.

### 2. Web build (needs the app's dependencies, per push)

```yaml
- run: pnpm install --frozen-lockfile
- run: npx expo export --platform web      # → dist/
- uses: actions/upload-artifact@v4
  with: { name: web-dist, path: dist/ }
```

### 3. Capture + audit (per push, minutes)

```yaml
- run: |
    pnpm audit:capture \
      --dir dist --out frames \
      --relay ${{ env.MOCK_RELAY_URL }} \
      --tier ci --consecutive --yes
- run: pnpm audit:run --manifest frames/manifest.json
- uses: actions/upload-artifact@v4
  with: { name: audit-frames, path: frames/ }
```

**`--tier ci` is the sample, and it is not optional.** A default (`core`) run is 3816
cells; at the 2.24 s/cell this harness measured on the runner (403 cells in 903 s) that
is ~126 minutes, against a step bound of 195. The tier is declared in
`tools/visual/matrix.ts` rather than spelled here as a `--devices` list so the sample,
the plan and the manifest all read one list a reviewer can argue with, and it captures
every declared cell at two device profiles, both themes and scales 100/135/200 — 1272
cells, ~45 minutes. The full `core` tier (`--tier core`) and the 13992-cell `full` tier
(`--full`) stay runnable locally and on a dispatched run; nothing is reachable only
through CI.

The whole-run bound is derived from the plan (3000 ms/cell, floor 900 s) unless
`--deadline` names one, so a bound cannot silently truncate the plan it was computed
for. If you do name a smaller one, the run prints the budgeted figure beside it before
it renders anything, and every cell it never reached is reported as having no frame —
never skipped silently.

`capture.ts` exits non-zero when a frame's resolved theme does not match the
cell it claims, when a dark/light pair is byte-identical, when two cells that declare
different states render the same bytes, when a cell does not reach the state it
declares, or when a frame is effectively blank — failures a green test suite hides, and
the reason the `manifest.json` carries each frame's resolved theme and canvas colour
rather than just a PNG.

An **inert text-scale dimension** is reported in the manifest
(`meta.textScaleLive: false`) and makes `audit.ts` report `U-04` as `BLOCKED`
with that reason, rather than failing the capture job: an app whose type ignores
the root font-size is a finding for the review thread, not a broken harness. The
canary is where inertness fails a job, because there it means the instrument
itself stopped working.

`audit.ts` exits non-zero on any `FAIL` row. `BLOCKED` rows do not fail the job
— they are reported, counted, and belong in the review thread.

**Run the two against the same mock-relay process the capture used**, started
with the scenario the PR is about, or the numbers describe a different state than
the frames do.

### 4. The canary (per push, minutes)

```yaml
- run: pnpm e2e:canary
```

This is the gate that stops the audit from rotting into a rubber stamp: it fails
if the checker stops catching a declared defect, if it starts failing the clean
page, or if the harness's own scale dimension goes inert. Cheap, and the only
job here that tests the *instrument* rather than the app.

### 4b. The `core` device sample (nightly, and on demand)

```yaml
- run: pnpm audit:capture --dir dist --out frames --relay $MOCK_RELAY_URL --tier core --consecutive --yes
- run: pnpm audit:run --manifest frames/manifest.json
```

`--tier ci` covers 2 of the matrix's 19 declared profiles, so until this job
existed nothing automated covered the device variety the operator's rule asks
for — phones in many sizes, tablets both ways. `web-audit-core` runs the `core`
tier (5 profiles / 3816 cells) on the schedule and on demand only, so a pull
request does not pay for it and the `ci` step's 65-minute bound is not stretched.

Both bounds are derived from the measured rate and checked against the plan the
run prints for itself, rather than guessed. The runner's rate is 2.24 s/cell, so
the 3816-cell `core` capture is ~134 min, and `--plan --tier core --consecutive`
prints the 11,448 frames and derives a deadline of 11,448 s. Those two numbers agree
because both are 3,600 x 3 — three frames per cell with `--consecutive`, and the
budget's three seconds per cell — not because the deadline is frame-derived. The
capture step is
bound at 180, which is above that
derived deadline — so the step cannot cut short the budget the run computes for
itself — and ~1.35x the measured cost. The audit's rate is its own, not the
capture's: its run measured 1.47 s/cell — killed at the old 70-minute bound with
2,870 of 3,024 cells done in 70m12s = 4,212 s (run 38530472075) — so 3,816 cells x
1.47 s = 5,610 s ≈ 93.5 min, and its step is bound at 110. The step caps sum to the
job's own 290 on paper (`180 + 110`), while the REAL requirement is the capture
bound plus the audit's measured need — `180 + 89 = 269`, 21 min under the cap; a
step cap is a ceiling, not a budget. Measured, the job runs ~134 min of capture +
~88 min of audit ≈ 222 min. Re-derive the job cap if either step's bound is raised
again.

The capture states its own device coverage — which declared profiles it covered
and which it did not, by name — in the plan block, beside the run's verdict, in
`meta.deviceCoverage`, and in `index.html`. A green `core` run therefore reads as
the sample it is, and a green `ci` run cannot read as the whole matrix.

### 5. Native E2E with Maestro (nightly and release gate, CI-only)

```yaml
# iOS, macos runner
- run: maestro test --config e2e/maestro/config.yaml \
         -e APP_ID=<the built app's id> \
         -e RELAY_URL=http://127.0.0.1:$MOCK_RELAY_PORT \
         -e SESSION_ID=6714def86197 \
         e2e/maestro
# Android, ubuntu runner with KVM
```

Two things to wire deliberately:

- **One mock relay at a time, started with the scenario the flow needs**, on an
  ephemeral port, and stopped by pid at the end of the job. `--print-port` puts
  the port alone on stdout; diagnostics go to stderr. The tag proof deliberately
  stops the normal relay and starts `tags-cap` on a second ephemeral port after
  flows 01–10; `scripts/ci/run-maestro-tags.sh` owns that handoff.
- **One re-run, not infinite.** Maestro 2.11.0's CLI has no retry option, so
  the CI invocation re-runs the set once on failure itself and raises a
  `::warning` when it flaked; a second failure is a failure (ADR 0003 allows
  exactly one re-run). Reported separately so a flake is visible as a flake.
- **A readiness gate before the first flow, and again before the re-run.**
  `sys.boot_completed` — all `android-emulator-runner` waits for — is reached while
  adbd can still drop the transport, and the two observed nightly/dispatch runs that reached the flows
  after #86 failed the *first* flow on `device offline` (`DeviceServerDiedException`)
  and went green only on the whole-set re-run, seven minutes later.
  `scripts/ci/await-emulator-ready.sh` waits for consecutive good `adb` probes
  (5 x 2 s by default; a ceiling, bounded at 180 s, failing loudly with the last
  probe's reason) and, with an app id, independently bounds warm-up at 30 s and launches the installed app once so the first
  flow does not carry the cold start. `scripts/maestro-flow-contract.ts` pins all
  three call sites. This is a runner-capacity mitigation, not an app fix, and it is
  stated as such so it is not mistaken for coverage.

`RELAY_PASSWORD` must arrive from the job's own environment, read out of a
`0600` file the job created. A literal password in a flow file could not be
committed, and the mock's default is a placeholder that every run shares.

#### Native connection prerequisite and coverage

Passing `-e RELAY_URL` and `-e RELAY_PASSWORD` gives Maestro variables, not native
app credentials. Every flow clears app state: first launch is Welcome. The
scheduled [run 38201325824, job 114655201007](https://github.com/damianvtran/local-operator-mobile/actions/runs/38201325824/job/114655201007)
proved that F1 reaches its Radient hand-off, while 02–09 incorrectly expected
Home or Computers without ever connecting. Increasing waits or reducing the
OS font scale cannot fix that missing prerequisite.

Flows 02–10 now call `e2e/maestro/helpers/connect-relay.yaml` after clearing state.
The helper is outside the workspace's `flows/*.yaml` selection, so it is not an
extra standalone flow. It walks the actual guided own-tunnel screen:

1. Wait for Welcome, select `welcome-custom-url`, wait for `own-tunnel-screen`.
2. Scroll to the address and password, type the job's variables, and hide the
   keyboard after each field. Keep the device's font/accessibility scale.
3. Explicitly opt in to HTTP for this isolated mock (Android uses
   `http://10.0.2.2:<mock-port>`; no production credentials).
4. Press `own-tunnel-test`, scroll to and wait for its **Connected** verdict.
   `runTunnelTest` logs in and reads `/api/sessions`; a form visit alone is not
   success. Wait for enabled `custom-connect`, then save/connect and wait for Home.

Maestro [2.11.0's selector schema](https://github.com/mobile-dev-inc/maestro/blob/v2.11.0/maestro-orchestra/src/main/java/maestro/orchestra/yaml/YamlElementSelector.kt)
supports `enabled: true` (checked 2026-10-12). These are bounded screen/element
waits, not sleeps or expanded retry budgets. The Android action still parses
`script:` one POSIX-shell command per line; that emulator-runner script is unchanged.

The **native job's mock startup** explicitly passes
`--allow-android-emulator-origin`. The native custom-route client sends
`Origin: http://10.0.2.2:<mock-port>`, even though the host-side socket is loopback.
Without that allowance the mock correctly refuses login with 403 before checking
the password; a local probe omitting Origin cannot expose this mismatch. The
opt-in constructs exactly that alias from the kernel-selected port **inside
`listen`, before publishing readiness**. It neither predicts/releases a free
port nor permits wildcards, unrelated origins or another port on the alias.
Default/web mock callers keep their existing origin policy; this is isolated CI
configuration, not a change to app credentials, production HTTP or CSRF policy.

`02-tunnel-pick.yaml` retains its filename but now covers **F-3 own-tunnel setup
and saved custom-route restoration**: stop/relaunch without clearing storage,
wait for Home, then verify the restored route and Connected status in Settings.
Radient F-2/F-4 computer discovery requires an account/control-plane API, neither
of which the relay mock provides; the commented discovery markers are not
executed coverage. F1 is unchanged. Other `SCENARIO`/`BLOCKED` steps remain
unexecuted as documented in their flows. The `idle` scenario contains **one
completed live conversation**, not an empty list: 03 now waits for that fixture's
`session-row-${SESSION_ID}`, rejects the empty state and checks the populated
sidebar's New chat action. Approvals, subagents, dropped-stream recovery and
refusal scenarios do not become executed coverage merely by connecting.

A dependency-free prerequisite regression is available without installing the
app dependencies:

```sh
node scripts/maestro-flow-contract.ts
node tools/mock-relay/android-origin-check.ts
```

It parses the flows' block YAML subset, checks ordered prerequisites and the
helper selection/identifier contract, and rejects unsupported syntax rather than
silently overlooking it. The origin check derives the header from the app's
`requestAuthFor`, exercises real sockets and the actual opt-in CLI, and checks
wrong-password, unauthenticated, unrelated-origin, wrong-port and default-loopback
behavior; synthetic credentials and cookie values are never printed. CI runs
the same assertions through Vitest. Full YAML
parsing and the native Maestro run remain separate gates: these checks do not
prove an APK's HTTP permissions, native cookie handling, scrolling or rendering.

#### Settings targets and text-scale reflow

[QA round 2](https://github.com/damianvtran/local-operator-mobile/pull/86#issuecomment-6133314651)
independently inspected the existing native run **38308549353**: the connection
probe, enabled Connect, saved-route restart and populated conversation row passed.
The remaining Settings failure was a viewport precondition, not a missing selector:
on the 320×640 device its scroll viewport ended at y616, while the theme group
started at y645. The connected custom-route screen places saved own-tunnel
management before Appearance. A ready `settings-screen` root does not make those
controls visible.

`07-settings-theme-scale.yaml` scrolls to each actual assertion/tap target with
bounded `scrollUntilVisible`, preserving all theme/scale/connection/sign-out/
diagnostics assertions and the ten screenshot names. Theme System is earlier
than Light, Connection is above Appearance, and Diagnostics is above the sign-out
tail: those returns scroll **UP**, not DOWN. Theme selection is awaited before
capturing its result.

After selecting 200%, expanded content above the scale track invalidates the old
scroll offset. First re-find the selected **200%** control **DOWN**, then capture
a selected-state-ready frame. The 100% option is earlier in the wrapping track
(`TEXT_SCALE_PERCENTS = [100, 150, 200]`), so the return to **100%** is **UP** only
*after* that re-anchor. The 100% contraction also requires an **UP** re-anchor and
selected-state wait before the reset frame. Neither the OS scale nor the app
layout is changed to fit a test; there are no added sleeps or larger budgets.

The parsed-flow contract guard rejects omitted target scrolls, wrong upward
returns, missing/reversed post-scale remeasurement and a capture without its
selected-state wait. These are Settings-control preconditions, not a global rule
to scroll screen roots. **The repaired native Settings journey remains unproven
until its next native execution**; structural checks do not establish geometry
or UI success. The first-attempt custom-URL scrolling miss recovered on the
existing retry in that prior run, with no proven causal root: no separate fix is
claimed or included here.

### 6. The re-capture diff (nightly, opted in)

ADR 0003 requires a script that re-captures against an isolated `lop mobile` and
diffs the fixtures to detect contract drift, so a second implementation of the
wire format cannot drift unnoticed. Same isolation rules as
`fixtures/relay/README.md`: its own `HOME`, its own config dir, a port that is
not 4098, every `CMUX_*`/`LOP_*` variable stripped, and the daemon stopped by pid
afterwards. An isolated daemon needs the Python toolchain, so this is the one
job that is not cheap — nightly, not per push.

## Artifacts to keep, and for how long

| Artifact | Why | Retention |
|---|---|---|
| `frames/` (PNGs + `manifest.json` + `index.html`) | The design and UX rounds audit from these. `index.html` opens from the filesystem with no network dependency | 30 days, per ADR 0003's storage limit |
| `audit-report.json` / `audit-report.md` | The review thread's `U`-findings cite rows from it | 30 days |
| Maestro per-step screenshots and per-flow logs | F-9's evidence is a sequence, not a still | 30 days |
| `maestro-tag-screenshots/` | LOH-11's native tag line, sheet, cap refusal and cleared-row sequence | 30 days |
| The mock relay's `--record` transcript | Pins what the app actually sent, which is how a client-side bug is distinguished from a relay-side one | 30 days |

**Frames go on the pull request, never into the repository** (ADR 0003 §"What the
harness is not", and the repository's own rule about evidence).

## Things the CI job must not do

- Never launch a visible browser. Every Chrome here runs `--headless=new` with
  `--use-mock-keychain --password-store=basic`; a windowed run in CI is the same
  mistake as a windowed run on a developer's machine.
- Never `playwright install`, `puppeteer`, or a downloaded Chromium. The audit
  drives the installed browser or it reports that it cannot.
- Never point the harness at the operator's daemon, tunnel connector or live
  sessions. The mock relay exists so that nothing in CI needs them.
- Never commit the operator's tunnel hostname, account id, email or a token: the
  repository is public. The mock's tunnels are synthetic 32-hex labels.
