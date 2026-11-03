# Independent retirement-alert runner and retained seed replay

## Authority and delivery state

Source implementation is not a native receipt. One reviewed runner compile and one separately granted retained seed experiment are distinct allocations. No automatic dispatch, retry, replacement build or tap follows a source check. The strict six-phase proof remains a different entrypoint.

This slice supplies a **compile-only independent XCTest UI-test target**, source-level guards and archive preflight controls. It has no application target dependency. It does not build/prebuild the proof app, install tools, boot a simulator, install/launch an app, open a URL, query SpringBoard or run a test during setup. Local source/Node checks are **not** a Swift/Xcode compilation or replay receipt.

The reusable/manual workflow `.github/workflows/retirement-ui-setup.yml` accepts exactly `mode=setup` (also the default), and exposes **no replay mode**. The existing registered `ios.yml` routes explicit manual `mode=retirement-ui-setup, retirement_proof=false` exclusively to it; its ordinary manual default stays `standard`. The script's argument parser independently rejects every other mode. Only fresh retained-artifact METADATA is read during setup, before any SDK work; the original archive/app is never downloaded then. The metadata must leave at least 17 minutes (10 compile + 5 work + 2 cleanup), and queue delay is rechecked on the compile host. The XCTest test method exists only as future driver source: `build-for-testing` compiles it, never executes it.

## One approved future hosted compile invocation

After fresh independent source/QA review is clean and the parent records the exact committed ref on #147, the parent—not this implementer—may invoke registered `ios.yml` **once**, on that runner commit, with `mode=retirement-ui-setup` and `retirement_proof=false` (the reusable receives `mode=setup`).

**Registered feature-ref entrypoint (source implemented, not dispatched):** after review/QA, parent uses existing workflow `ios.yml`, `ref=test/auth-retirement-native-proof` at the exact reviewed runner SHA, and inputs `{"mode":"retirement-ui-setup","retirement_proof":false}`. REST `POST /repos/damianvtran/local-operator-mobile/actions/workflows/ios.yml/dispatches` supports a branch/tag `ref`; the local `./.github/workflows/retirement-ui-setup.yml` reusable resolves from the SAME commit as the caller. This needs no default-branch merge. Parent must re-read remote branch SHA and workflow registration before invoking; API rejection is a stop, not an app-build fallback or a consumed-success receipt.

Official source checks (2026-11-03): https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event (example uses `ref: topic-branch`); https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows (same-repository `./` resolves same caller commit). These verify the supported mechanism, not an actual API invocation.

The manual validator rejects unknown/missing modes, malformed/nonboolean proof flags and setup+proof contradictions. Setup skips `changes`, so its dependent app build/install/launch/proof job cannot run. Signing/release jobs retain push-main-only guards. The compile job requires successful manual validation. Ordinary default/manual/PR/push behavior is otherwise retained. **No native-classifier exemption was added**: its original documentation-only classifier is byte-identical; all mixed app/native/config/proof diffs still run production classification. Therefore publishing the branch may enqueue ordinary PR app CI; no authorization to push or spend those builds is inferred from this setup slice.

- Runner: existing `macos-26`, existing Xcode and Python stdlib only.
- Job cap: **10 minutes**. Build watchdog stops at **540 seconds** to leave receipt/upload time; owned process-group RSS cap **2 GiB**, one build job, compiler log cap 16 MiB. The group limit is not a claim to cap unrelated Xcode/system daemon memory.
- Exact entry: `python3 scripts/ci/retirement-ui-setup.py --mode setup --output "$RUNNER_TEMP/retirement-ui-setup"`.
- Core compiler invocation: `xcodebuild build-for-testing -project <output>/RetirementSystemAlert.xcodeproj -scheme RetirementSystemAlert -destination 'generic/platform=iOS Simulator' -derivedDataPath <output>/DerivedData -resultBundlePath <output>/setup.xcresult -jobs 1 CODE_SIGNING_ALLOWED=NO`.
- Required products: `*.xctestrun` and the independent `*-Runner.app`. Receipt records actual runner source SHA, Swift input hashes, Xcode/SDK versions, outcome/exit/duration and relative product paths. Compile logs/receipt/products/xcresult upload independently with `always()`, fixed sensitive artifact name and **one-day** retention.
- **Compile/setup failure stops. No retry, timeout expansion, replay or tap follows automatically.** No runner compilation or SDK execution was performed locally (this host has CLT only).

## Retained ORIGINAL proof identity (not the runner identity)

- Run `41620694610`, artifact `13225164386`.
- App source `78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b`.
- Immutable bundle SHA-256 `9c667250a1e0a8d5dc129495a8f1bd734e201ec5bfbae8bd7b863e4f951574e7`.
- Inner tar SHA-256 `2e6ce4369dea84a514ba31d8802e9ec36f25dd4f0ace9c36353cba6edc9d1d92`.

These are independent of the **new runner commit**. Never compare the retained app source with current runner HEAD, relabel the old app as a new build, rewrite its nonce/port/source, or use cached bytes to evade server expiry. `verifyHostedReuse` fetches a fresh GitHub artifact API response before accepting archive bytes; absent/expired/inaccessible is a stop, with no authentication-scope expansion. SHA, metadata run/source and expiry must agree. Current server presence is **unobserved** in this source-only slice; a one-day artifact may expire before compile completes.

Before extraction, bounded tar parsing rejects absolute/traversing/duplicate names, hardlinks/specials, escaping symlinks, any member under a symlink (including later-declared links), corrupt headers, unsupported naming extensions and non-whitelisted PAX semantics. File/entry/decompressed bounds apply. Unknown PAX keys deliberately fail closed; real retained bytes must pass the preflight before a replay is eligible. After private extraction, verify ORIGINAL JSON identity/nonce/port, dedicated flavor/bundle/scheme and recomputed immutable bundle digest. Extraction must preserve symlinks/modes. Do not execute an extractor first and validate afterward.

## Registered SHORT retained seed replay (separate grant)

The registered `ios.yml` mode is `retirement-seed-replay`, with `retirement_proof=false`, positive decimal `retirement_compile_run` and `retirement_runner_artifact`, full `retirement_runner_source` equal to the dispatch/checkout SHA, and boolean `retirement_observe_only`. Every contradictory/missing/unknown input fails before native work. Other modes reject replay inputs. The new reusable is not independently dispatchable. PR/push/native classification and release guards are unchanged.

The parent must inspect clean independent code/QA/design dispositions and fresh server artifact metadata BEFORE scheduling either invocation. Queue delay is unbounded: setup rechecks original artifact metadata before SDK work; replay fetches both artifacts at entry/download and refreshes BOTH after the runner bootstrap, then checks expiry at query/tap use. Server error, expired/deleted artifact, unavailable read permissions or insufficient time means STOP, never cached reuse, a new app build or scope expansion.

### Exact parent invocation plan — NOT commands run by this source change

`REF=test/auth-retirement-native-proof` must point at the exact reviewed `RUNNER_SHA`. Confirm its remote SHA first. The same-repository reusable resolves from that caller commit. Only the parent with the explicit allocation may execute these examples; `COMPILE_RUN`/`RUNNER_ARTIFACT` must come from the actual fresh successful setup result, never invented values.

Compile once:

```sh
gh api --method POST repos/damianvtran/local-operator-mobile/actions/workflows/ios.yml/dispatches --input - <<JSON
{"ref":"${REF}","inputs":{"mode":"retirement-ui-setup","retirement_proof":false}}
JSON
```

Read `GET /repos/damianvtran/local-operator-mobile/actions/artifacts/13225164386` and the new runner artifact metadata; verify `expired=false`, server expiry, workflow run/source, and inspect `setup-receipt.json`: compile exit0, `compileOutcome=passed`, `packageValidated=true`, source/Xcode/SDK/tar/manifest/executable hashes. API denial or artifact expiry stops. The setup job is 10min; watchdog540s, group RSS2GiB, one build job. `passed` is written ONLY AFTER the mode-preserving package and exact runner-only `NSAllowsLocalNetworking` readback validate. This is NOT a proof-app rebuild or simulator test.

Then, only under the separately granted ONE replay:

```sh
gh api --method POST repos/damianvtran/local-operator-mobile/actions/workflows/ios.yml/dispatches --input - <<JSON
{"ref":"${REF}","inputs":{"mode":"retirement-seed-replay","retirement_proof":false,"retirement_compile_run":"${COMPILE_RUN}","retirement_runner_artifact":"${RUNNER_ARTIFACT}","retirement_runner_source":"${RUNNER_SHA}","retirement_observe_only":false}}
JSON
```

`observe_only=true` is an alternative terminal observation, NOT a preliminary free probe: it never requests tap authority, is never seed success, and consumes that invocation. Do not follow it with a second replay without a new decision. Unknown/multiple/differently worded alerts stop for the manager; never relax the literal `Open in “Local Operator”?` or normalize its Unicode scalar arrays.

The reusable invokes ONLY:

```sh
python3 scripts/ci/retirement-replay-watchdog.py --mode run --root "$RUNNER_TEMP/retirement-seed-replay"
# always fallback, SAME root and SAME persisted remaining cleanup allowance:
python3 scripts/ci/retirement-replay-watchdog.py --mode cleanup --root "$RUNNER_TEMP/retirement-seed-replay"
```

No Node/package installation, app prebuild/build, Pods, dependency tree, private API, coordinates or interruption monitor. Existing hosted Node must support stripped TypeScript; missing/incompatible runtime is a setup failure, not permission to install. Do not invoke the Node coordinator without the independent watchdog.

### Runtime state machine and budgets

1. ALL work shares one300s monotonic watchdog: metadata/downloads, safe ZIP/tar admission, private extraction/hash/mode validation, owned create/boot/install, bootstrap, launch/ready, URL, sampling, receipt and observations. Each command is capped at min(stage cap, remaining); a slow cold start is not extra authority. No native work is hidden in workflow steps outside the watchdog.
2. Exact original nonce/receiver port/source remain unchanged. Bootstrap the independent runner, refresh metadata AFTER runner-ready, arm readiness BEFORE proof launch, measure live owned PID/container/plist/bundle, then send ONE URL only with at least70s remaining. The ONE60s receipt clock starts before openURL and never restarts at observation/tap.
3. Ephemeral private loopback bearer/session only; no Ed25519/general producer-authentication framework. Host owns lease/intent/inventory, exact live launchctl PID/full label and installed source/flavor/content. A new independent sample is required before QUERY and TAP. Runner JSON is not identity authority. One-use entitlements reserve BEFORE await; refusal/lost response consumes them.
4. A fresh QUERY permit precedes ANY SpringBoard query. Capture, observe exact scalar arrays/buttons/count, and report the observation. Observer ends here. Otherwise one fresh TAP permit binds that fingerprint, independent live sample, session/challenge and expiry. Check at actual use, consume local entitlement, then ONE literal Open tap. Public XCTest SYSTEM scope only, disposable owned simulator only.
5. The independent outer watchdog bounds synchronous I/O and tracks gated owned child groups. Cleanup starts BEFORE runner/native/server stop, and has ONE persisted120s total (including the workflow fallback). A monotonic memo prevents clock rollback renewing it. Device deletion requires exact intent/lease/inventory; query post-delete inventory or report UNOBSERVED. First coarse cause survives later teardown errors. Nonzero outcomes remain visible.

### Evidence, prerequisites and honest limits

Only `ROOT/evidence/**` is uploaded, sensitive fixed name, one-day retention. Total work export capped16MiB: validated bounded before/after PNGs and allowlisted scalar/hash/timing/seed/cleanup/watchdog summaries. No root enumeration, original JSON, nonce/port, bearer/private environment, xctestrun, raw logs or xcresult. Host screenshots are not proof of particular pixels until actually viewed. Swift's before/after attachments remain private; do not export xcresult wholesale. Setup runner package is a separate source-identified artifact.

| Prerequisite | Source/fixture evidence | Runtime still required |
|---|---|---|
| Portable single runner/xctestrun, macros, modes/full hashes and runner-only ATS | real Python package/prepare fixtures, failed packaging cannot mark compile passed | actual Xcode-produced schema/SDK compile |
| Original and runner archive/expiry admission | real ZIP/tar/PAX/mode parsers, corrupt/escaping/duplicate/special controls, fresh-response boundaries | actual fresh server artifacts and retained bytes |
| Independent identity/query/tap | real localhost RPC/seed requests and injected native boundary; exact PID/UDID/source/bundle/expiry/title/fingerprint negatives | live simulator container/launchctl and XCTest transport |
| Original seed/readiness/receipt | nonce/source/flavor/body/unknown-field controls; post-bootstrap refresh and one receipt-clock coordinator tests | native ingress, JS entry and HTTP receipt remain distinct |
| One-work/one-cleanup lifetime | real owned Node child watchdog/teardown tests and first-cause controls | hosted load and actual owned inventory absence |
| Exact Swift action guard | shared pure Swift permit/scalar fixtures plus Node source assertions | Swift fixtures not executed locally; public accessibility/Unicode/timing/pixels unverified |
| Exclusive no-rebuild workflow | all manual input combinations, ordinary PR classification retained, namespaced concurrency | registered dispatch/job receipts after manager grant |

Successful seed experiment is NOT the six-phase retirement/restore proof, native account-switch validation or provider/UI E2E. Export explicitly states `scope=retained-seed-only` and `fullRetirementProofComplete=false`. No source-only result waives the independent review/QA gate, artifact expiry or single native allocation. Stop a failed compile/setup or replay; no automatic retry, cap increase, replacement app, signing/forwarding change or title fallback.
