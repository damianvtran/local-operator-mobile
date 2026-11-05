# Direct paired transport XCTest — preparation, not native proof

Scope: the accepted architect decision `a3fa3c53fc9c`, relayed in full by the
manager. This replaces **allocating** Maestro for this root-recovery experiment;
it does not change or certify the app, provider flow, palettes or theme matrix.

## Grounding and unchanged app

The existing `signin-app-proof/SignInAppUITests.swift` addresses the real app
with `XCUIApplication(bundleIdentifier:)`; its `run.sh` records a serial selected
XCTest, xcresult and attachments. The manager cited historical Debug receipts
(light 165.716s, dark 71.782s, largest 33.524s). Those are historical precedent,
not re-executed here and NOT current Release proof. Do not invoke that script:
it builds the Debug product/entry and links the test target to the Expo app.

`generate.rb` instead creates a NEW two-target project under the owned proof
output: network-free `TransportCarrier` (UIKit only), and `TransportUITests`
depending solely on that carrier. No existing product project, workspace,
CocoaPods project, Metro, package/entry override or production ATS edit is used.
The installed input remains literal native source `a94e5b6e`, artifact
`13393819626`, archive SHA256
`1a3dde5fb3873bf4d2b69c7befc0aa02f7d66103fe2de0a8d16aa3fcf4d92475`.
The real app is NOT built/re-signed by the carrier target.

## One bounded operation, held pending review/release

Use existing `theme-ios-proof` with `proof_stage=transport-xctest`, the existing
native run `41976243925` and artifact name `ios-simulator`. No dispatch is part
of preparation. The branch must match the reviewed driver head at release.

The existing shared900s clock covers input verification/owned iPhone17/iOS26.5
creation/install, generation, ONE serial `build-for-testing` feasibility gate,
and ONE `test-without-building` selecting
`TransportUITests/TransportUITests/testPairedTransport`. Individual caps are
clamped to remaining time; this is not900s per phase. Existing bounded artifact
export/teardown housekeeping remains separate. No Maestro bootstrap, hierarchy
fallback, extra device, retry, production build or dependency-install fallback.
If carrier generation/build fails, STOP. The local machine has CLT but no
CocoaPods executable: Ruby syntax and Swift parse can run locally, but local
generation/SDK compilation were NOT performed. Hosted generation must materialize
`target-graph.json`; both Ruby and Node reject any graph beyond the two targets.

## Native versus supervisor requests

The selected method emits its actual runner PID, launches the installed real
app and queries `welcome-screen`, keeping a screenshot attachment BEFORE
starting the native request phase. Zero tests or a wrapper `Done` cannot pass.
The real app opens Own Tunnel, keeps the password blank, opts into HTTP and
Tests exact loopback then published `.local` authorities on the SAME existing
mock listener/port/publisher. Native success requires its password-refusal UI
AND correlated native-phase GET arrival/completed401. HOST preflight401 is
excluded. Any unexpected native method/route fails the stage.

`URLSession` in the TEST bundle talks only to a separate loopback SUPERVISOR
control port: begin phase, read safe counters, close the SUT listener. It never
requests the SUT API or supplies native success. The carrier has NO networking.
Supervisor responses are no-store and the test bypasses its cache. Host module
controls exercise that boundary locally; they are explicitly NOT app evidence.

If either authority works, close that SAME SUT listener (keep publisher/control
alive), re-enter a FRESH Own Tunnel form, repeat ONLY a successful authority,
and require actual unreachable UI with no new401. A stale previous error cannot
satisfy a fresh form. Neither authority working STOPS without calling an
unperformed negative a pass. Outcomes distinguish authority transport, NOT DNS
root cause, authentication, Save/provider persistence or theme acceptance.

## Evidence and cleanup

Every failure retains partial receipt/arrival/completion data. `finally` exports
partial xcresult attachments; raw `transport.xcresult`, sanitized separate stdout
and stderr, selected-test host PID/group/exit/signal/deadline state, native runner
PID (only if the method actually entered), and observed group reap state remain.
No runner PID or crash cause is invented from an exit code. Native app-process
NSError codes are not collected in this baseline: that is an explicit gap;
UItest/supervisor/host errors cannot substitute for app-process codes.

Event records whitelist stage/authority/verdict/timing/numeric PID only. Logs
use the existing URI/secret redactor. XCTest's original result/activity bundle
and real screenshots can contain the synthetic fixture address shown/entered
in the app; no credentials, cookies or authenticated requests are introduced.
Do not describe the binary xcresult as a fully scrubbed text log.

A passing result also requires the exporter manifest to map Welcome, both
authority screenshots and the successful-authority negative to actual nonempty
PNG bytes. Mapping is grounded in `xcresulttool export attachments`, also used
by Chromium's `Xcode16LogParser._extract_attachments` (source blob
`a02390afe873ac76fb774d586d8038f979d5095b`). A marker JSON or unrelated image is
not screenshot evidence. Independent QA must still open the actual frames.

All launched command groups and the exact owned simulator are reaped; there is
no cleanup of shared worktrees or unrelated processes. Product/native acceptance
and the original route/root cause remain unproved until an actual native run.
