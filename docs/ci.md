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
| `ci.yml` | `pull_request`, push to `main`, `workflow_dispatch` | `checks`, `design-kit` | The JavaScript typechecks, lints, formats and its unit tests pass; the generated styling layer matches `design/tokens/tokens.json`; the design kit's contrast contract holds and its committed assets (icons, splash, store art, preview sheet) still re-render from their sources; the web target bundles. |
| `android.yml` | `pull_request`, push to `main`, `workflow_dispatch` | `changes`, `android`, `internal` (main only) | `expo prebuild` produces the Android project from the config, Gradle assembles a debug APK, and the generated project re-generates byte-identically. On `main`, additionally a signed AAB/APK and, when configured, a Play **internal** track upload. |
| `ios.yml` | `pull_request`, push to `main`, `workflow_dispatch` | `changes`, `ios`, `internal` (main only) | The app builds for the iOS 26 SDK with Xcode 26 on `macos-26`, **launches on a simulator**, renders a real frame (the simulator build is a Release build, so it has a bundled JS payload and no Metro dependency), and the native project re-generates identically. On `main`, additionally a signed IPA and, when configured, a TestFlight upload. |
| `e2e.yml` | `pull_request`, push to `main`, nightly, `workflow_dispatch` | `harness`, `mock-relay`, `maestro` | The mock-relay web-target frames and a11y report, and Maestro flows on an Android 16 emulator against the mock relay. **The harness does not exist yet**, so `harness` reports it absent and the two jobs are *skipped* — GitHub shows `skipped`, never a green tick, so an absent suite cannot be mistaken for a passing one. The contract it is waiting for is named at the top of `e2e.yml`. |
| `release.yml` | tag `v*` (or `workflow_dispatch` with a tag and `dry_run`) | `version`, `secrets`, `gate` (= `ci.yml`), `android`, `ios`, `publish` | The same gate a pull request runs, both platforms built and signed, a GitHub Release carrying the APK/AAB/IPA, and uploads to the Play internal track and TestFlight. |

Native jobs are **skipped, not failed**, on a change that touches only
documentation. That decision is implemented inside the workflow by a `changes`
job that inspects the diff, never by `on.paths`: a workflow excluded by a path
filter does not skip, it never runs, and a required check that never runs can
never be satisfied.

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

**Names only. No value is ever committed, printed or logged.** Set them in the
repository's **Actions secrets** (Settings → Secrets and variables → Actions →
Secrets).

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

Optional, referenced by the ADR and not needed by anything here today:
`EXPO_TOKEN` (EAS escape hatch) and `MAESTRO_CLOUD_API_KEY` (parallel device
runs).

### Where they live, and why

They are **repository** secrets, and the jobs that use them are the only jobs
that reference them:

- `android.yml`/`ios.yml` expose them through a job that declares
  `environment: release` and runs **only on a push to `main`**. A pull request
  cannot reach that job, so a branch pushed here cannot print the key — the
  security comes from the job, not from an `if:` on a step.
- `release.yml` runs only on a tag, and its credential-bearing jobs also declare
  `environment: release`.

Configure the environment with a **deployment branch rule of `main` and
`v*` tags** (Settings → Environments → `release`). That rule is what makes the
first point true, and it is the one setting this repository's security depends
on that is not in the source tree. Add required reviewers to the same
environment if the release process ever gains a second maintainer.

### Fork pull requests

GitHub does not give repository secrets to a `pull_request` run from a fork. So:

- **still runs**: every `checks` and `design-kit` step, the debug APK, the iOS
  simulator build and its frames, and the whole Maestro/mock-relay layer once the
  harness lands. A fork contributes a fully tested change.
- **does not run**: anything that signs or uploads. The steps are skipped, the
  job summary says so in words, and nothing is implied to have been verified.

A catch worth knowing: `secrets.X != ''` in an `if:` is not a guard against a
fork — it is a guard against a *missing* secret, and on a `pull_request` from a
branch in this repository the secrets are present. That is why the gates are
composed in one place per job (`steps.sign.outputs.enabled`) rather than repeated
inline, and why the condition includes the event.

## Running the same gates locally

Everything except the native builds runs on this machine, with Node and pnpm.

```sh
pnpm install --frozen-lockfile

pnpm lint            # biome check: linter, formatter and import order
pnpm format:check    # biome format
pnpm typecheck       # tsc --noEmit
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
node scripts/ci/version.mjs --ref-type tag --ref-name v1.0.0 --run-number 42
node scripts/ci/version.mjs --ref-type branch --ref-name main --run-number 42

# Are the release credentials present? (names only; values never printed)
node scripts/ci/check-secrets.mjs --mode internal --need ANDROID_KEYSTORE_BASE64

# The simulator a runner would pick, from a captured device list
node scripts/ci/ios-simulator.mjs --prefer "iPhone 17" --json-file devices.json

# Release notes for a range
node scripts/ci/release-notes.mjs --from v0.9.0 --to v1.0.0
```

The native builds cannot be reproduced locally, by design. To iterate on them,
push a branch: the debug APK and the simulator build are attached to the run.

## Versioning

**The git tag is the only source of truth, and nothing is bumped in a pull
request.** `scripts/ci/version.mjs` derives everything from the ref and exports
it to the job:

| Value | Rule |
|---|---|
| version (JS / `app.json` / Android `versionName` / iOS `CFBundleShortVersionString`) | `vX.Y.Z` without the `v` when the ref is a tag; `0.0.0` otherwise |
| Android `versionCode`, iOS `CFBundleVersion` | `github.run_number` — monotonic across every build of the repository, never reused |
| Release notes | generated from the conventional commits since the previous tag (`scripts/ci/release-notes.mjs`) |

The non-tag version is `0.0.0` rather than the ADR's written `0.0.0-dev.<run>`
because the same string reaches `CFBundleShortVersionString`, and Apple rejects a
non-numeric short version at upload — which would break the internal TestFlight
upload on every push to `main`. Monotonicity, the property both stores actually
enforce, is carried by the build number. The dev string is still reported as
`display_version` for summaries.

`app.config.ts` reads the derived values from the environment
(`LOCAL_OPERATOR_MOBILE_VERSION`, `LOCAL_OPERATOR_MOBILE_VERSION_CODE`), which is
what lets a tag version reach both native projects with nothing committed:

```sh
node scripts/ci/version.mjs --write   # in CI: sets the two variables for the job
```

Android's release signing comes from `plugins/with-android-release-signing.js`, a
config plugin rather than an edited `android/app/build.gradle`, because `android/`
is generated and the next `expo prebuild --clean` would discard a hand edit. The
plugin is what a reviewer reads; the generated Gradle is a build product. Without
`LO_RELEASE_STORE_FILE` in the environment, `bundleRelease` fails loudly instead
of signing with the debug key.

## Release runbook

1. **Confirm `main` is green.** The tag builds the commit you tag; a red `main`
   means the release build has already failed once.
2. **Tag and push it.**

   ```sh
   git switch main && git pull --ff-only
   git tag -a v1.0.0 -m "v1.0.0"
   git push origin v1.0.0
   ```

   A tag is the whole instruction. There is no version bump to land first and no
   release branch to cut.
3. **Watch `release.yml`.** In order: the version is derived, the credential
   check passes (it names any missing secret and stops), the gate runs, both
   platforms build and sign, the GitHub Release is created with the APK, AAB and
   IPA attached, and only then do the Play and TestFlight uploads run. A release
   that dies half-way still leaves the Release — the artefact a user can install.
4. **Verify**, in this order: the Release page lists three artefacts; the run
   summary names the version and build number; the Play internal track shows the
   new `versionCode`; the build appears in App Store Connect. TestFlight
   processing is asynchronous — the job does not wait for it.
5. **Install the APK** from the Release on an Android device and open it. The
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
macOS used for exactly two things (the simulator build and the signed archive,
plus the design kit's asset gates, which need macOS to reproduce the committed
PNGs), and the emulator job kept off pull requests until the harness exists.

| Runner | Used for | Notes |
|---|---|---|
| `ubuntu-latest` (24.04 at the time of writing) | `checks`, the Android build, the uploader jobs | Ships the Android SDK, Java 17/21/25, Google Chrome and fastlane. Timeouts are set on every job. |
| `macos-26` | the iOS build, the design-kit asset gates | Ships Xcode 26.x (which is what Apple requires for uploads) and CocoaPods 1.17.0. The simulator is named in `env` in `ios.yml` and resolved by `scripts/ci/ios-simulator.mjs`, which prints what it chose. |

`fastlane` is used as the runner image provides it (2.238.0 on `macos-26`, 2.240.1
on `ubuntu-latest`, read from the image manifests on 2026-09-29), so upgrading it
means moving the runner label — the same one-line change as Xcode or the Android
SDK. Nothing is `gem install`ed at release time.

Every job sets `timeout-minutes`. A wedged step failing in 30 minutes rather than
GitHub's 360-minute default is the difference between a retry and a lost
afternoon.

## Things this pipeline deliberately does not do

- **It does not run the relay smoke script against a real relay.**
  `scripts/relay-smoke.mjs` needs a running `lop mobile serve` with a password,
  which is a developer's own machine, not a runner. CI's end-to-end layer runs
  against the **mock relay** (ADR 0003, layer 3).
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
| `design-kit` fails on `build-icons.mjs --check` or `capture.mjs --check` | The asset was regenerated on a machine with a different rasterizer, Chrome version or font stack. Reproduce with the same command locally; the gate prints which of the byte and pixel comparisons passed. |
| `design-kit` fails on `build-preset.mjs --check` | `design/tokens/tokens.json` changed and `tailwind-preset.js` (and the preview's CSS) were not regenerated — run the generator without `--check`. |
| `android` fails at "Assert the native project regenerates identically" | Something edited the generated `android/` tree, or a config plugin is non-deterministic. Fix the plugin: the edit is what `prebuild --clean` discards. |
| `ios` fails to find a simulator | The runner image moved to a newer iPhone than `IOS_SIMULATOR_DEVICE` in `ios.yml`. The job warns and picks the newest available iPhone; change the name in `ios.yml` to silence it. |
| `ios` fails in `xcodebuild` with a signing error | Only the `internal` job signs. Check `APPLE_TEAM_ID`, and that the App Store Connect key has not been revoked. |
| `release.yml` stops at "Check the release credentials" | Exactly what it is for: the message lists every missing variable name. Set them, then re-run. |
| `e2e` jobs are `skipped` | The audit harness is not on this ref. That is the intended state until it lands; see the contract in `e2e.yml`. |
