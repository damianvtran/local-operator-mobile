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

**`--tier ci` is the sample, and it is not optional.** A default (`core`) run is 1836
cells; at the 2.24 s/cell this harness measured on the runner (403 cells in 903 s) that
is ~59 minutes, against a step bound of 30. The tier is declared in
`tools/visual/matrix.ts` rather than spelled here as a `--devices` list so the sample,
the plan and the manifest all read one list a reviewer can argue with, and it captures
every declared cell at two device profiles, both themes and scales 100/135/200 — 612
cells, ~23 minutes. The full `core` tier (`--tier core`) and the 6732-cell `full` tier
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
tier (5 profiles / 1836 cells) on the schedule and on demand only, so a pull
request does not pay for it and the `ci` step's 30-minute bound is not stretched.

Both bounds are derived from the measured rate and checked against the plan the
run prints for itself, rather than guessed. The runner's rate is 2.24 s/cell, so
the 1836-cell `core` capture is ~69 min, and `--plan --tier core --consecutive`
prints the 4,536 frames and derives a deadline of 4,536 s. Those two numbers agree
because both are 1836 x 3 — three frames per cell with `--consecutive`, and the
budget's three seconds per cell — not because the deadline is frame-derived. The
capture step is
bound at 60, which is above that
derived deadline — so the step cannot cut short the budget the run computes for
itself — and ~1.9x the measured cost. The audit runs at 1.25 s/cell, so it is
~18 min and its step is bound at 35. The job holds its parts:
`install + export + capture 60 + audit 35 < 120`.

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

- **One mock relay per job, started with the scenario the flow needs**, on an
  ephemeral port, and stopped by pid at the end of the job. `--print-port` puts
  the port alone on stdout; diagnostics go to stderr.
- **One re-run, not infinite.** Maestro 2.11.0's CLI has no retry option, so
  the CI invocation re-runs the set once on failure itself and raises a
  `::warning` when it flaked; a second failure is a failure (ADR 0003 allows
  exactly one re-run). Reported separately so a flake is visible as a flake.

`RELAY_PASSWORD` must arrive from the job's own environment, read out of a
`0600` file the job created. A literal password in a flow file could not be
committed, and the mock's default is a placeholder that every run shares.

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
