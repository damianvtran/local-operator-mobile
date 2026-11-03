# Independent retirement-alert runner: setup only

## Authority and delivery state

This slice supplies a **compile-only independent XCTest UI-test target**, source-level guards and archive preflight controls. It has no application target dependency. It does not build/prebuild the proof app, install tools, boot a simulator, install/launch an app, open a URL, query SpringBoard or run a test during setup. Local source/Node checks are **not** a Swift/Xcode compilation or replay receipt.

The reusable/manual workflow `.github/workflows/retirement-ui-setup.yml` accepts exactly `mode=setup` (also the default), and exposes **no replay mode**. The existing registered `ios.yml` routes explicit manual `mode=retirement-ui-setup, retirement_proof=false` exclusively to it; its ordinary manual default stays `standard`. The script's argument parser independently rejects every other mode. No retained artifact is downloaded during setup. The XCTest test method exists only as future driver source: `build-for-testing` compiles it, never executes it.

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

## Separately granted future SHORT replay plan — NOT implemented as a workflow

Only after the above compile receipt passes, source+QA guards pass, artifact remains available and the manager grants a **new explicit replay**, the parent may prepare a separate reviewed replay invocation: **5-minute replay + 2-minute owned cleanup**, no app rebuild. There is no replay dispatcher in this slice and no authority to invoke one now.

1. Query server artifact metadata afresh; download the exact retained archive from that still-live artifact. Validate transport SHA/path safety/limits before private extraction, then frozen identities and bundle digest. Refuse any missing/expired/mismatched input; no local-cache fallback.
2. Create/lease a disposable simulator with exact run ownership. Boot/install the retained app only there. Preserve original proof source/nonce/receiver port. Keep runner source separately recorded. No operator devices/accounts.
3. A separately reviewed **host orchestration boundary** must sample current supported process identity/PID on that owned UDID, validate the owned lease and artifact expiry, and bind a fresh authority receipt to its one openURL window. It must repeat live ownership/process checks before system query and before tap. The Node guard model tests the resulting facts; a self-authored JSON file alone is not live verification. This live host-to-driver handoff is a remaining replay setup gate, not provided or attested by compile-only success.
4. Establish exact title typography from the actual retained before-frame. The candidate literal is `Open in “Local Operator”?`, but its typography is **UNATTESTED here**. `titleAttested` must remain false until independently witnessed; never normalize quotes or broaden strings merely to pass.
5. Future driver uses public `XCUIApplication(bundleIdentifier: "com.apple.springboard")`, explicit **SYSTEM** scope. After identity authorization, capture before any tap; require exactly one alert, exact title and exactly Cancel/Open buttons, no additional text/alerts. Recheck guards and structure, then one literal `Open.tap()`. Never coordinates, private APIs, interruption monitors, dismissal fallbacks or app-store/DOM injection. Unknown/ambiguous guards refuse; no query of an unowned device just to take a refusal screenshot.
6. Capture the resulting observations and perform bounded owned cleanup on all outcomes. Keep native ingress, JS entry and HTTP progress separate; one alert tap is not proof of the six retirement phases or full auth/account E2E.

## Source-test coverage and limits

Negative controls cover title/buttons, multiple alerts, wrong PID/UDID/lease/source/bundle/flavor/tar, missing/expired server artifact, stale/future observations, unattested typography, tar hardlinks/specials/traversal/duplicates/symlink parents/PAX escapes and checksum corruption. Project generation is tested with Python stdlib only (no Xcode invocation). Swift source constants match the Node model; that is **not** compiled Swift behavior. Native SDK/runner compile, exact alert text and the future live handoff remain unverified until their distinct gates run.
