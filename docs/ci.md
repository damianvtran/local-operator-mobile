# Continuous integration and release

CI is the only place this repository builds native apps. The primary development
machine has no Xcode and no Android SDK, and installing them is deliberately out
of scope (see `AGENTS.md`, "Build host assumptions"), so the pipeline is part of
the product rather than plumbing: if it is wrong, the app cannot ship at all. The
decisions behind it are in `docs/adr/0004-ci-cd.md`; this page is the operator's
view — what runs, what it needs, and what to do when it goes red.

## What runs, and what it proves

| Workflow | Trigger | Jobs | What a green run actually proves |
|---|---|---|---|
| `ci.yml` | `pull_request`, push to `main`, weekly, `workflow_dispatch`, `workflow_call` | `changes`, `checks`, `design-kit` | The JavaScript typechecks (both programs), lints, formats and its unit tests pass; the web target bundles. `design-kit` costs a macOS runner plus a `brew install`, so it is path-gated by the same `changes` pattern the native jobs use — it runs on a pull request only when `design/**`, `docs/design/**`, `src/ui/**`, `scripts/**` or the configs changed, and always on `main`, on the weekly sweep and inside a release gate. Green there means the generated styling layer matches `design/tokens/tokens.json`, the contrast contract holds, and every committed asset re-renders (bytes first, pixels second, with the comparison that passed printed). **The preview-sheet step reports `NOT VERIFIED` on a clean runner** — it renders with the shipped typefaces (Figtree, JetBrains Mono), which live in a sibling checkout a runner does not have — and that step is green only because it downgrades its claim to a warning rather than failing. Say "design-kit passed" with that caveat, or run the gate locally where the faces exist. |
| `android.yml` | `pull_request`, push to `main`, `workflow_dispatch` | `changes`, `android`, `internal` (main only) | `expo prebuild` produces the Android project from the config, Gradle assembles a debug APK, **the APK's manifest carries the version the ref derives** (`versionName`/`versionCode` read out of the built APK and asserted), **the release variant's merged manifest carries the local-network declarations** (`android:usesCleartextTraffic="true"`, `ACCESS_LOCAL_NETWORK` — asserted on the release manifest because the debug overlays set the cleartext attribute themselves), and the generated project re-generates identically (byte for byte, except that Xcode project files are compared with their object identifiers normalized — see below). On `main`, additionally an AAB/APK whose release certificate is verified **not** to be the debug key, and, when configured, a Play **internal** track upload. |
| `ios.yml` | `pull_request`, push to `main`, `workflow_dispatch` | `changes`, `ios`, `internal` (main only) | The app builds for the iOS 26 SDK with Xcode 26 on `macos-26`, **launches on a simulator**, and the captured frame **rendered something** — it differs from a pre-install capture of the home screen, and the launch log carries no JavaScript fatal (the check that caught a real crash on a head where the app had no routes). The settle delta between two captures two seconds apart is **reported, not asserted**, in pixel-channel bytes: a byte-identity gate was tried and removed because a working UI with a caret moves (measured, run 36727261140). The version in the built app's `Info.plist` is asserted against the one the ref derived, **the built `Info.plist` carries `NSLocalNetworkUsageDescription` and the ATS local-networking configuration** (`NSAllowsLocalNetworking` plus the private-range `NSExceptionDomains` — which mechanism the OS honours is Apple's ambiguity, ADR 0002 §5), and the native project re-generates identically. Content is not judged here — a wrong screen renders just as green. On `main`, additionally a signed IPA and, when configured, a TestFlight upload. |
| `e2e.yml` | `pull_request`, push to `main`, nightly, `workflow_dispatch` | `harness`, `mock-relay-contract`, `docs-commands`, `web-audit`, `maestro-android` | **The harness was present and its suites ran** — the `harness` job FAILS when it is absent rather than skipping, so a green `e2e` cannot mean "the thing did not run". Then: `pnpm e2e:relay` in its own job (which prints its own assertion count — quote that line, not a number written here) and `pnpm e2e:divergences`; `pnpm e2e:typecheck` in the audit job (the only typecheck `tools/**` and `e2e/**` get — `pnpm typecheck` covers the app and `scripts/**` only); the web export driven in headless Chrome into a frame per audit cell with every frame checked against the design kit's rubric, and `pnpm e2e:canary`. **Every command goes through the harness's own package scripts**, never a file path, so a rename inside the harness cannot silently disable this workflow. **The bounds come from measurements, not from hope**: `pnpm e2e:relay` is the harness's slowest documented command — its own note says the contract plus the canary's mutation self-test is "LOAD-DEPENDENT: 28 minutes measured on this host at load averages 32-46, ~13 minutes on a quiet one" and sizes its default bound at 45 (`--timeout 2700`), and a reviewer's attempt on this host was killed at ~14 minutes inside the mutation group at load 120-226 — so that job gets **45 minutes** and the step 25 — the job's bound covers its parts (install + the contract + the divergence check), not its largest one, and the install prints its own duration so the next person sizing this has a measurement — rather than the 15 minutes it had, which could only ever report a timeout. `pnpm e2e:docs` (every command `docs/e2e/README.md` names, the relay one included) runs only in the nightly `docs-commands` job; on a pull request it would run the relay contract a second time for no extra coverage. The relay job installs explicitly with `--frozen-lockfile`, because the implicit install pnpm 12 performs before a script (`verify-deps-before-run`) was already happening: measured, a "no install" job pulled 631 packages into a tree that had none. Maestro runs the flow set on an Android 16 emulator — nightly and on demand only, because it is the slowest job here and the harness's own note asks for it that way; it is the one job allowed to be absent from a green PR run. |
| `release.yml` | tag `v*` (or `workflow_dispatch` with a tag and `dry_run`) | `version`, `credentials`, `gate` (= `ci.yml`), `android`, `ios`, `publish` | The same gate a pull request runs, the platforms named by `RELEASE_PLATFORMS` (default `ios`) built and signed, a GitHub Release carrying their artefacts (APK/AAB and/or IPA), and the matching uploads to the Play internal track and/or TestFlight. |

Native jobs are **skipped, not failed**, on a change that touches only
documentation. That decision is implemented inside the workflow by a `changes`
job that inspects the diff, never by `on.paths`: a workflow excluded by a path
filter does not skip, it never runs, and a required check that never runs can
never be satisfied.

One consequence is worth stating plainly, because it is the difference between a
green tick and a proof: a **skipped** job is never the thing a green run proves.
The only skip that can appear in a green run by design is the path-gated
`design-kit` (and the doc-only native skip); the `e2e` detector refuses to skip
at all, and a run whose `harness` job fails is red, with the missing pieces named
in the annotation.

## Third-party actions, and how they are pinned

Two conventions, on purpose (ADR 0004, "Supply-chain hygiene"):

- `actions/*`, `pnpm/action-setup` and `actions/setup-java` track a **major tag**
  (`actions/checkout@v7`). GitHub maintains these, and a major tag is the
  conventional way to consume them.
- **Everything else is pinned to a full commit SHA**, with the release it came
  from in a trailing comment (`reactivecircus/android-emulator-runner@c9c93e6b… #
  v2.38.0`). A third-party action runs inside a job that holds signing material;
  a tag can be moved, a SHA cannot.

`pnpm` has no version input anywhere: `pnpm/action-setup` reads `packageManager`
from `package.json`, so there is exactly one place that decides it. `Node` is
`24`, the version the app is developed on (Expo's floor is 22.13+/24.3+).

The workflows never run `npm install`, never copy a `node_modules` and never
`cp -R` a dependency tree: the pnpm store cache keyed on `pnpm-lock.yaml` is the
only dependency mechanism.

## Secrets

**Names only. No value is ever committed, printed or logged.** Set them as
**environment secrets** on the `release` environment (Settings → Environments →
release → Environment secrets) — see "Where they live, and why" below.

| Secret | Used by | What it is |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | `android.yml` `internal`, `release.yml` | The release keystore, base64-encoded. Decoded to a temp path at build time and removed afterwards. |
| `ANDROID_KEYSTORE_PASSWORD` | same | Keystore password. Passed to Gradle **in the environment**, never as `-P`: a Gradle property lands in `ps` and in the log. |
| `ANDROID_KEY_ALIAS` | same | Key alias. |
| `ANDROID_KEY_PASSWORD` | same | Key password. |
| `PLAY_SERVICE_ACCOUNT_JSON_BASE64` | `android.yml` `internal`, `release.yml` | Google Play service-account JSON, base64. Decoded to `SUPPLY_JSON_KEY`. |
| `APPLE_TEAM_ID` | `ios.yml` `internal`, `release.yml` | Apple team id. Feeds `ios.appleTeamId` through the app config and the export options. |
| `APPLE_ASC_KEY_ID` | same | App Store Connect API key id. |
| `APPLE_ASC_ISSUER_ID` | same | App Store Connect issuer id. |
| `APPLE_ASC_PRIVATE_KEY_BASE64` | same | The `.p8`, base64. Decoded to `APPLE_ASC_PRIVATE_KEY_PATH`. |

The Android rows and the Apple rows are independent: a release needs only the rows
of the platforms it releases (see "Which platforms a tag releases" below).

### Which platforms a tag releases: `RELEASE_PLATFORMS`

A tag releases the platforms named by the repository **variable**
`RELEASE_PLATFORMS` (Settings → Secrets and variables → Actions → **Variables**, not
Secrets — it is a switch, not a credential): a comma-separated list of `ios` and/or
`android`. Case and spaces do not matter (`iOS, Android` is fine).

- **Unset or blank means `ios`.** This is a deliberate default, not an accident of
  which secrets exist: Apple goes first and Google Play is parked, so a tag must
  not fail on Play credentials nobody has yet. The run summary says when the value
  came from the default.
- **An unknown name fails the run** (`windows`, or the typo `andriod`) rather than
  being ignored — a release does not guess which platform was meant.
- **Enabled means required.** `release.yml`'s `credentials` job checks each enabled
  platform's secrets in its own step, so a missing Apple variable and a missing Play
  variable never appear in the same list. An enabled platform with a missing
  credential still **fails** the release; a platform that is not enabled is not
  checked, built, uploaded or attached.
- **Re-enabling Android** takes two things together: set
  `RELEASE_PLATFORMS=ios,android` **and** add the five Android secrets
  (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON_BASE64`). Setting only the
  variable is not a way to ship half a release: the gate fails on the missing
  secrets. Adding only the secrets changes nothing — the variable decides.

Optional, referenced by the ADR and not needed by anything here today:
`EXPO_TOKEN` (EAS escape hatch) and `MAESTRO_CLOUD_API_KEY` (parallel device
runs).

### Where they live, and why

**Put them in the `release` environment, and configure that environment with two
deployment rules: a BRANCH rule `main` and a TAG rule `v*`.** Both halves matter:

- GitHub's deployment policies are typed — `type: branch` or `type: tag` — and its
  own documentation says name patterns "must be configured for branches or tags
  individually". A *branch* pattern `v*` does **not** cover `refs/tags/v*`, so an
  environment configured with only `main` refuses `release.yml`'s jobs on a tag
  ref, and the first tagged release dies at the environment before it signs
  anything (review round 4, M4-1). The tag rule is what lets the four
  `environment: release` jobs in `release.yml` (`credentials`, `android`, `ios`,
  `publish`) run on `refs/tags/v*`.
- Every job that reads a credential declares `environment: release`: the two
  signing jobs in `android.yml`/`ios.yml` (which run only on a push to `main`, so
  the branch rule covers them), the `credentials` gate beside each of them, and
  `release.yml`'s `credentials`, `android`, `ios` and `publish` jobs (tag refs, so
  the tag rule covers them).
- **Environment** secrets are the point of the exercise: only a job that declares
  the environment can read them, so the deployment rules are what keep signing
  material out of a pull request that edits a workflow to drop an `if:`. Keeping
  the same credentials as **repository** secrets also works — every job that reads them
  declares the environment, and a job in an environment sees both scopes — but
  repository secrets are readable by any workflow a collaborator can push, which
  is exactly the gap the environment exists to close (QA round 3, Q1).

A pull request cannot reach any of those jobs, so a branch pushed here cannot
print a key. **The environment exists (created 2026-10-04), and its deployment
rules are the mechanism** — branch `main` and tag `v*` added 2026-10-09,
alongside the workflows' own `if:` conditions. The environment is what makes it
an enforced rule rather than a workflow convention.

**A cost of that arrangement, stated because it is a choice.** If the environment
is given required reviewers, the `credentials` gate waits for approval *before* it
can report, and the signing job waits again — two prompts per `main` push rather
than one (the gate cannot avoid reading the secrets: that is the question it
answers). A review-free environment with the same two deployment rules keeps the
protection against a feature branch reaching the secrets without the second
prompt, and is the configuration this pipeline expects.

**STATE (2026-10-09): the environment exists; its secrets do not.** `release`
was created with a **branch** rule `main` and a **tag** rule `v*` (custom branch
policies enabled, which is what makes a tag rule possible at all), so the jobs
above can reach it from tags and from `main`. The nine credentials, however, are
still **unset** — the repository and environment secret counts are both 0 — so a
`v*` tag fails at the `credentials` gate today, by design, naming every missing
name. Add the nine as **environment secrets** when the account work resumes (see
`docs/publishing/submission-runbook.md`), and decide then whether the environment
requires reviewers (the paragraph above).

### What a missing credential means, per platform

One policy, both platforms, decided by a `credentials` job in each workflow:

- **`android.yml`** — without `ANDROID_KEYSTORE_*` and
  `PLAY_SERVICE_ACCOUNT_JSON_BASE64`, the `internal` job is **skipped**, and the
  `credentials` job's warning annotation names the missing variables. Nothing is
  decoded and nothing is built, so the unsigned-path failure this replaces (a
  zero-byte keystore decoded from an empty secret, which failed the job on every
  push to `main`) cannot happen.
- **`ios.yml`** — without the `APPLE_*` variables, the `internal` job is
  **skipped** the same way, with the same annotation.
- **A tagged release FAILS rather than skipping** a platform it was asked to
  release: `release.yml`'s credential check runs first and names every missing
  variable of each platform in `RELEASE_PLATFORMS`, so the release path is a hard
  failure and the pull-request/main paths are a visible skip. A platform that
  `RELEASE_PLATFORMS` does not name (the default is `ios`) is not checked at all —
  that is a decision recorded in a variable, not a skip caused by an absent secret.

Why a skip rather than a hard failure on `main`: an internal build without signing
material is impossible, and reding `main` on every push until someone configures a
keystore is a permanently red gate — the kind people learn to ignore, and the exact
failure mode the iOS frame check was repaired for. A skipped job is visible in the
job list, the annotation says why, and a release is still refused outright.

### What a green run proves, in one place

The pipeline is the only place the native apps are built (ADR 0004), which makes
it easy to read a green tick as more than it is. The table at the top of this
document is the per-job answer; these are the limits of it.

- `checks` green says nothing about a native build.
- The Android debug APK is **debug-signed by design** — the release certificate is
  checked only in the `internal` job, on a push to `main`.
- The iOS frame proves the app painted something and did not throw — not that the
  screen is right, and not that it is still. The settle delta is a reported
  number; pixel-level judgement is the audit harness's job.
- `e2e` green is the one that used to be able to mean nothing at all. It cannot
  now: the detector fails when `tools/` is absent.
- A `success` on `android.yml`'s or `ios.yml`'s `internal` job means the signed
  artefact was built **and its certificate checked**. It cannot mean anything else,
  because **the job does not run at all without its credentials** (the policy
  below), so there is no branch in which it signs nothing and still reports
  success.

### Fork pull requests

GitHub does not give repository secrets to a `pull_request` run from a fork. So:

- **still runs**: every `checks` and `design-kit` step, the debug APK, the iOS
  simulator build, its launch and its frame, the mock-relay contract test, and the
  frame capture plus the audit once the harness lands. A fork contributes a fully
  tested change.
- **does not run**: anything that signs or uploads. The steps are skipped, the
  job summary says so in words, and nothing is implied to have been verified.
  The Maestro flow set is nightly-only for every contributor, fork or not — it
  runs on `schedule` and `workflow_dispatch`, never on a pull request, because an
  emulator boot is minutes and the flows are the flakiest part of the pipeline.

A catch worth knowing: `secrets.X != ''` in an `if:` is not a guard against a
fork — it is a guard against a *missing* secret, and on a `pull_request` from a
branch in this repository the secrets are present. That is why the gates are
composed in one place per job (`steps.play.outputs.all_present` in `android.yml`,
`steps.apple.outputs.all_present` in `ios.yml`) rather than repeated inline, and
why the condition includes the event.

## Running the same gates locally

Everything except the native builds runs on this machine, with Node and pnpm.

```sh
pnpm install --frozen-lockfile

pnpm lint            # biome check: linter, formatter and import order
pnpm format:check    # biome format
pnpm typecheck       # tsc --noEmit, then tsc --noEmit -p tsconfig.tools.json
pnpm test            # vitest, Node environment
pnpm theme:check     # the generated styling layer matches the tokens
pnpm export:web      # the web target bundles

# The design kit's own gates, in the order design/README.md lists them. They are
# plain `node` scripts with no dependencies, which is why this list needs no
# install and no pnpm.
node design/tokens/contrast-contract.mjs
node design/tokens/build-preset.mjs --check
node design/app-icon/build-icons.mjs --check      # needs rsvg-convert or ImageMagick
node design/preview/capture.mjs --check           # needs Google Chrome
```

`build-icons --check` and `capture --check` re-render every committed asset and
compare it with the file in the tree, so they need the same tools their
generators need, and they say so — in install lines — when one is missing.

The CI helper scripts are ordinary Node programs and can be exercised directly.
They take their inputs as flags precisely so this works without a runner:

```sh
# What version would CI derive from a ref?
node scripts/ci/version.ts --ref-type tag --ref-name v1.0.0 --run-number 42
node scripts/ci/version.ts --ref-type branch --ref-name main --run-number 42

# Are the release credentials present? (names only; values never printed)
node scripts/ci/check-secrets.ts --mode internal --need ANDROID_KEYSTORE_BASE64

# The simulator a runner would pick, from a captured device list
node scripts/ci/ios-simulator.ts --prefer "iPhone 17" --json-file devices.json

# Release notes for a range
node scripts/ci/release-notes.ts --from v0.9.0 --to v1.0.0
```

The native builds cannot be reproduced locally, by design. To iterate on them,
push a branch: the debug APK and the simulator build are attached to the run.

### The tooling is TypeScript, and it is typechecked

The scripts under `scripts/**` are `.ts` and are run **directly by Node** — Node
strips the type annotations, so there is no build step and no dependency, which
matters because these scripts run before `pnpm install`. The constraints that
follow are real ones: nothing that needs emit (no `enum`, no `namespace`, no
parameter properties, no decorators), `import type` for anything that is a type,
and the module type has to be declared — `scripts/package.json` says
`"type": "module"` because the root manifest cannot (`metro.config.js` is
CommonJS), and that one file covers everything under `scripts/`.

`tsconfig.tools.json` is the second program `pnpm typecheck` runs: the app's
config, pointed at Node ESM with `types: ["node"]` and no DOM. It belongs to the
app scaffold and currently includes `scripts/**/*.ts` — this directory. The
harness's `tools/**` and the kit's `design/**` convert to TypeScript under the
same operator directive, and each one extends that `include` when it does; until
then `allowJs: false` keeps them out of the program rather than leaving them
silently untyped, so the gate is green today and covers more as each tree
converts. `erasableSyntaxOnly` is what enforces the stripping rules at the type
level: a `enum`, a `namespace` or a parameter property would compile here and
then fail at runtime under `node`.

A boundary value (a `simctl` payload, an `xcodebuild -list` result) is parsed and
narrowed field by field, never asserted: a shape change in a future Xcode then
fails with a sentence about the shape instead of an `undefined` inside a build
command.

## Versioning

**The git tag is the only source of truth, and nothing is bumped in a pull
request.** `scripts/ci/version.ts` derives everything from the ref and exports
it to the job:

| Value | Rule |
|---|---|
| version (JS / `app.json` / Android `versionName` / iOS `CFBundleShortVersionString`) | `vX.Y.Z` without the `v` when the ref is a tag; `0.0.0` otherwise |
| Android `versionCode`, iOS `CFBundleVersion`, internal builds | **the last release's counter plus the commits since it** — `base + git rev-list --count <last release tag>..HEAD`, and before the first release simply the commit count of the ref. Monotonic as the branch grows, identical for every workflow building the same commit, and stored nowhere |
| Android `versionCode`, iOS `CFBundleVersion`, releases | **`release/build-number.txt`**, read as-is, and the release FAILS unless it is strictly greater than what an internal build of the same commit would claim (`base + commits since the last release`) |

**What `release/build-number.txt = 1000` is for, and why the internal arm counts
from the last release.** Both publishers write into one store sequence — Play
compares every upload's `versionCode` against everything already on the track —
so the two arms have to agree on one ordering, and the file is the only value a
release sets deliberately. `1000` is the first release's number: high enough to
clear every internal build ever published before it (there were ~85 commits, so
each of those claimed its own count) and a round number to bump from.

The internal arm counts from the last release rather than from the counter's
current value, which is what makes the sequence single. An internal build claims
`base + commits since the last release`; a release claims the counter, which the
release pull request sets above that same expression. So internal builds climb
from each release's number up to the next one, and each release stops the climb
and restarts it higher. Deriving the internal number from the counter's current
value instead would collide at the bump commit: its internal upload claims exactly
the number the release then publishes, and Play rejects the second one. Measured
on a clone with a `v0.0.1` tag and the counter at 1000: the release claims 1000, a
`main` push at that commit claims 1000, three commits later 1003, and a tag there
is rejected until the counter reaches 1004 — the number the failure message
prints. Three consequences worth knowing before the first release:

- **The floor moves with the bump.** The bump is itself a commit, so it raises the
  floor by one, and any commit after it raises it again. A second refusal is
  quoting the floor at the new tip, not repeating itself — which is why the tag
  goes on the bump commit with nothing in between, and why the message and this
  doc both say to leave a **margin** (ten is plenty for a release pull request) so
  one bump is enough (QA rounds 2 and 3; the message used to print a number that
  could never be right on the first try).
- **`base` is the last ANCESTOR tag, and the commits are counted from the same
  one.** A tag cut on a sibling branch with a higher version is not a base: the
  script skips any tag that is not an ancestor of the ref being built, and counts
  from the tag it accepted. Verified with a `v9.9.9` on a sibling branch beside a
  `v0.1.0` on the trunk: the trunk build derives from `v0.1.0`. The counter should
  still only be set on a tag anyone can reach, because the *sort* that picks the
  first candidate is the version number.
- **The floor includes `main`'s tip, not just this commit.** Internal builds are
  published from `main`, so a tag that is not the tip has to clear a later
  commit's number too — otherwise the tag's number equals one already on the Play
  track and the upload is refused as a duplicate, after the GitHub Release exists.
  The release job fetches `origin/main` for exactly this comparison (QA Q4), and
  prints the number as `main_tip_internal_build_number` — `not-checked` when the
  ref is absent, never a guessed floor.
| Release notes | generated from the conventional commits since the previous tag (`scripts/ci/release-notes.ts`) |

**Why the build number is not `github.run_number`** (this was a real defect, fixed
before the first release): that counter is per **workflow**, not per repository.
Measured on 2026-09-30, `android.yml`, `ios.yml`, `ci.yml` and `e2e.yml` were all
at run number 30 while `release.yml` sat at 17 — so a tag cut that day would have
claimed `versionCode=18` against a 30 already uploaded to the Play internal track
from `main`, and Play rejects a lower one. The commit count cannot do that: it is
one number for the whole repository, and every workflow building the same commit
derives the same value from it. The release's explicit counter is what clears the
internal builds *and* the previous release, and the failure names the minimum it
needs (`release/build-number.txt` to `<minimum>` or higher, in the release pull
request). A re-run of an internal build of the same commit repeats its number —
Play rejects a duplicate upload — and the remedy is a new commit, or the counter
bump the release message asks for. That is deliberate: a number that moves while
the code does not is a number nobody can trace back to a build.

The non-tag version is `0.0.0` rather than the ADR's written `0.0.0-dev.<run>`
because the same string reaches `CFBundleShortVersionString`, and Apple rejects a
non-numeric short version at upload — which would break the internal TestFlight
upload on every push to `main`. Monotonicity, the property both stores actually
enforce, is carried by the build number. The dev string is printed as
`display_version` in the run log and deliberately **not** exported into the job:
nothing consumes it, and a variable nothing reads is how a version silently stops
reaching an artefact.

`app.config.ts` reads the derived values from the environment
(`LOCAL_OPERATOR_MOBILE_VERSION`, `LOCAL_OPERATOR_MOBILE_VERSION_CODE`) and writes
them into `version`, `ios.buildNumber` and `android.versionCode`. An unset
variable is the local case: the version stays `0.0.0` and no build number is
written, so a contributor's prebuild behaves exactly as before.

```sh
node scripts/ci/version.ts --write   # in CI: sets the two variables for the job
```

**THE WIRING IS ASSERTED IN THE ARTEFACT, not in the environment.** An exported
variable that no generated file consumes is invisible to every other gate here,
so `android.yml` reads `versionName`/`versionCode` out of the built APK's manifest
and `ios.yml` reads `CFBundleShortVersionString`/`CFBundleVersion` out of the
built app's `Info.plist`, and each **fails** when the value is not the one the ref
derived. That is the check that would have caught the version reaching nothing at
all.

**The same discipline covers the local-network configuration, which nothing in the
JS bundle can prove.** `scripts/ci/native-config.ts` asserts, from built products
only, that the declarations ADR 0002 §5 requires are present: the release
variant's merged `AndroidManifest.xml` carries `android:usesCleartextTraffic="true"`
and `ACCESS_LOCAL_NETWORK` — the RELEASE manifest, because the template's debug
overlays set the cleartext attribute themselves and a check on them could not
fail — and the built app's `Info.plist` carries `NSLocalNetworkUsageDescription`
and the ATS local-networking configuration. Both native workflows run it; a config
change that never reaches the product is red instead of silent.

Android's release signing comes from `plugins/with-android-release-signing.js`, a
config plugin rather than an edited `android/app/build.gradle`, because `android/`
is generated and the next `expo prebuild --clean` would discard a hand edit. It is
**registered in `app.config.ts`'s `plugins` array**, which is what makes it run on
every prebuild; a plugin that nothing lists is inert, and the generated project
then keeps Expo's template release `signingConfig` — the DEBUG keystore — so
`bundleRelease` produces a debug-signed AAB that Play rejects. The plugin is what
a reviewer reads; the generated Gradle is a build product. `android.yml`'s
`internal` job verifies the built APK's certificate with `apksigner` before it
claims anything was signed, and without `LO_RELEASE_STORE_FILE` in the
environment `bundleRelease` fails loudly instead of signing with the debug key.

## Release runbook

1. **Confirm `main` is green.** The tag builds the commit you tag; a red `main`
   means the release build has already failed once.
2. **Check what the release would claim.** The build number comes from
   `release/build-number.txt`, and the release refuses to run when it would not
   outrank the previous release and the internal builds already published from
   `main`. The version job prints all four numbers in its summary (this release's,
   an internal build of the same commit, the previous release's, and the floor),
   and a `workflow_dispatch` with `dry_run: true` prints them without building
   anything. Raise the counter in a pull request if the run says to.

3. **Tag and push it.**

   ```sh
   git switch main && git pull --ff-only
   git tag -a v1.0.0 -m "v1.0.0"
   git push origin v1.0.0
   ```

   A tag is the whole instruction. There is no version bump to land first and no
   release branch to cut.
4. **Watch `release.yml`.** In order: the version is derived, the platforms are
   resolved from `RELEASE_PLATFORMS` (default `ios`) and the credential check
   passes for each (it names any missing secret and stops), the gate runs, the
   enabled platforms build and sign, the GitHub Release is created with their
   artefacts attached (APK + AAB for Android, IPA for iOS), and only then do the
   matching Play and TestFlight uploads run. A release
   that dies half-way still leaves the Release — the artefact a user can install.
5. **Verify**, in this order: the Release page lists the artefacts of the enabled
   platforms (the IPA alone for the default; three with Android); the run summary
   names the version, build number and platforms; the Play internal track shows the
   new `versionCode` (Android only); the build appears in App Store Connect. TestFlight
   processing is asynchronous — the job does not wait for it.
6. **Install the build** — the APK from the Release on an Android device (when
   Android is enabled), or the TestFlight build on an iPhone — and open it. The
   artefacts being present is not the same claim as the app working.

**A dry run.** `workflow_dispatch` with a tag and `dry_run: true` runs the version
derivation, the credential check and the full gate, then stops before any build
or upload. It is the cheap way to find out what a release would complain about.

**Rolling back.** The releases before this one are on the GitHub Releases page —
attach or point users at the previous APK. The Play internal track can be halted
and a previous AAB re-promoted in the Play Console; TestFlight builds cannot be
deleted but can be expired. Over-the-air JavaScript rollback does not exist yet:
OTA is designed in and switched off for v1 (ADR 0004).

## Runner images, and what a run costs

Both platforms build on GitHub-hosted runners, which are **free for standard
runners in public repositories**. The scarce resource is therefore wall-clock and
concurrency, not money, and the pipeline is shaped around that: cheap jobs first,
and macOS spent only where it is unavoidable.

What that costs, concretely, and how each spend is gated:

| Spend | Runner | Gated by |
|---|---|---|
| `checks` (types, tests, lint, web export) | `ubuntu-latest` | every pull request, every `main` push — it is the cheap early signal |
| `design-kit` (asset re-render, contrast, styling layer) | `macos-26` + `brew install librsvg imagemagick` | the `changes` job: `design/**`, `docs/design/**`, `src/ui/**`, `scripts/**` or the configs; **always** on `main`, on the weekly sweep, and in a release gate |
| `android` (prebuild, debug APK, determinism) | `ubuntu-latest` | the `changes` job: anything that is not `docs/**` or `*.md` |
| `ios` (prebuild, pods, simulator build, launch, frame) | `macos-26` | the same `changes` job |
| `internal` (signed AAB/IPA, store uploads) | both | push to `main` only |
| `web-audit` (frames, rubric, canary) | `ubuntu-latest` | every PR, and it costs no macOS minutes: the harness's Chrome discovery has Linux candidates, which is why it moved off `macos-26` |
| `mock-relay-contract` (the relay's contract, ~28 min at load 32-46 on the dev host; 45-minute job bound) | `ubuntu-latest` | every PR. Minutes, not macOS minutes; **not** the longest job here — on run 37167390506 it took 7m13s against `web-audit`'s 14m50s and the iOS simulator job's 21m41s. It runs once per push, and `pnpm e2e:docs` — which would run it a second time — is nightly and on demand |
| Maestro flows | `ubuntu-latest` with KVM | nightly and on demand only |

The two macOS spends that used to happen on every pull request — the design kit's
`brew install` and the iOS build — are now gated by the design and native
`changes` jobs respectively. A weekly `schedule` on `ci.yml` runs the design kit
anyway, because those gates compare **re-rendered** artefacts and a rasterizer or
font on a runner image can drift without this repository changing; without the
sweep, the first evidence would be a PR that touches nothing design-related and
still fails.

| Runner | Used for | Notes |
|---|---|---|
| `ubuntu-latest` (24.04 at the time of writing) | `checks`, the Android build, the uploader jobs | Ships the Android SDK, Java 17/21/25, Google Chrome and fastlane. Timeouts are set on every job. |
| `macos-26` | the iOS build, the design-kit asset gates | Ships Xcode 26.x (which is what Apple requires for uploads) and CocoaPods 1.17.0. The simulator is named in `env` in `ios.yml` and resolved by `scripts/ci/ios-simulator.ts`, which prints what it chose. |

`fastlane` is used as the runner image provides it (2.238.0 on `macos-26`, 2.240.1
on `ubuntu-latest`, read from the image manifests on 2026-09-29), so upgrading it
means moving the runner label — the same one-line change as Xcode or the Android
SDK. Nothing is `gem install`ed at release time.

Every job sets `timeout-minutes`. A wedged step failing in 30 minutes rather than
GitHub's 360-minute default is the difference between a retry and a lost
afternoon.

## Things this pipeline deliberately does not do

- **It does not run the relay smoke script against a real relay.**
  `scripts/relay-smoke.ts` needs a running `lop mobile serve` with a password,
  which is a developer's own machine, not a runner. CI's end-to-end layer runs
  against the **mock relay** (ADR 0003, layer 3).
- **It does not run Maestro on an iOS simulator yet.** The harness documents the invocation and the flows are platform-parameterised, so the wiring is small — but the emulator job should be green for a while before a second copy of it exists on macOS minutes. Follow-up, named here so it is not a silent gap.
- **It does not run the fixture re-capture diff.** ADR 0003 requires a script that re-captures against an isolated `lop mobile` and diffs the fixtures, to catch the mock relay drifting from the relay. That script does not exist yet, so there is nothing to wire; when it does, it belongs here, nightly, because it needs the Python toolchain.
- **It does not upload build logs as artefacts.** Uploading them would require a
  secret-scrubbing step first (ADR 0004), and GitHub's own run log is already
  attached to the run. The credential-bearing steps print names, never values.
- **It does not publish over-the-air updates.** OTA is off for v1 by decision.
- **It does not gate on visual regression.** No pixel diffs at v1 (ADR 0003); the
  design and UX rounds look at the frames uploaded by `design-kit`.
- **It does not add reviewers, and no workflow tags a person.** Review requests
  are the operator's call.

## When a run goes red

| Symptom | Usual cause |
|---|---|
| `design-kit` fails on `build-icons.mjs --check` or on `capture.mjs --check` when the reference faces are present | The asset was regenerated on a machine with a different rasterizer, Chrome version or font stack. Both gates re-render and compare bytes first, pixels second, and print which comparison passed. The icons gate is reproducible on `macos-26` with `brew install librsvg imagemagick` (which is what this job installs); the capture gate additionally needs the SHIPPED typefaces, so on a clean runner it reports `NOT VERIFIED` instead of failing — read the warning, and see the next row. |
| `design-kit` warns that the preview capture gate could not make its claim | The sheet renders with the shipped typefaces (Figtree, JetBrains Mono) from a sibling checkout's `public/fonts`, and those woff2 files are not in this repository. Without them the page falls back to the platform face and the five committed captures all differ (measured 2026-09-30: `0 of 5 committed captures verified`). The step turns into a hard failure on its own the moment the reference faces are reachable — a job that checks the sibling repo out before it, or the faces committed under `design/fonts/` (whose `OFL.txt` is already there) and `capture.mjs` pointed at them. That change belongs to the design kit, not to CI. |
| `checks` fails in `pnpm lint` on files under `tools/**` or `e2e/**` | Those trees are the audit harness, which was written on a branch with no package manifest and so has never met biome. The errors are formatting and lint diagnostics in the harness's own files; the fix belongs to that stream, and `pnpm lint` is right to refuse a tree that does not pass it. |
| `design-kit` fails on `build-preset.mjs --check` | `design/tokens/tokens.json` changed and `tailwind-preset.js` (and the preview's CSS) were not regenerated — run the generator without `--check`. |
| `android` fails at "Assert the native project regenerates identically" | Something edited the generated `android/` tree, or a config plugin is non-deterministic. Fix the plugin: the edit is what `prebuild --clean` discards. The step prints a bounded diff of every differing file, so which of the two it is is a reading rather than a guess. |
| `android` fails at "Assert the release merged manifest keeps the local-network configuration", or `ios` at "Assert the built Info.plist carries the local-network configuration" | A declaration `app.config.ts` or a config plugin asks for did not reach the product. The step names the field it could not find (`scripts/ci/native-config.ts` prints one line per finding); fix the config or the plugin and re-run — never the generated native file, which the next `prebuild --clean` discards. |
| `ios` fails on the same gate, and the diff is only identifiers | That is a **pass** unless the diff shows real content: Xcode addresses objects with 24-hex identifiers and Expo's generator mints fresh ones on every run, so `project.pbxproj` is compared with those normalized to `<object-id>` (measured, run 36737644701 — five font references and their Resources group differed in nothing else). A real difference inside the file still fails, and the printed diff shows it with the identifiers already normalized. |
| `ios` fails to find a simulator | The runner image moved to a newer iPhone than `IOS_SIMULATOR_DEVICE` in `ios.yml`. The job warns and picks the newest available iPhone; change the name in `ios.yml` to silence it. |
| `ios` fails in `xcodebuild` with a signing error | Only the `internal` job signs. Check `APPLE_TEAM_ID`, and that the App Store Connect key has not been revoked. |
| `release.yml` stops at "Check the signing and store credentials, by name" | Exactly what it is for: the message lists every missing variable name. Set them, then re-run. |
| `e2e` jobs are `skipped` | The detector job failed because the audit harness is not on this ref, and the suites behind it were skipped for that reason (`needs`). The detector's annotation names every missing piece, and the workflow conclusion is **failure**, not success — a green `e2e` means the suites ran. |
