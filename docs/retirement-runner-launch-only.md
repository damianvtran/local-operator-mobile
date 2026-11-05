# Actual XCTest runner launch-only diagnostic

This is a separate manual `ios.yml` mode, `retirement-runner-launch-only`.
It is **actual test execution**, not the NO-TEST toolchain probe, an ordinary
build gate, a seed replay, or mobile acceptance. Implementation does not itself
authorize a hosted run. Do not substitute this diagnostic for product testing.

## Why a separate controller

The fixed compiled runner is from source
`4fff5e12296c3b6bd4ce3663988b9da8ca383227`, compile run `41985836532`, artifact
`13398590341` (ZIP size 6,844,204 bytes, SHA-256
`861740ebe53e0ff6c6ec610c571216ffbfdeec20258b281c6e3c562458195786`).
The reviewed controller source is the dispatch checkout SHA, recorded separately.
The old replay's equal-source guard is not relaxed. The fixed ZIP, receipt,
manifest, products, configuration/executable hashes and four unchanged Swift
source hashes bind the compiled inputs; a controller SHA is not a runner SHA.
Expired inputs close the diagnostic: no rebuilding, setup or repinning.

The pinned `RetainedReplayTests` requests ready and then before-observe before
constructing SpringBoard. The real `ReplayHostClient` accepts null identity for
ready only. Therefore no original application, identity, installation or launch
is needed. Xcode can install/launch the independent XCTest runner itself.

## Capability boundary and interpretation

The host listens on ephemeral IPv4 loopback, with a private 24-byte session and
32-byte bearer. Only bounded authenticated POST `/rpc` messages with exact keys,
fresh 32-byte challenges and strict order are accepted. The ten-key ready reply
has a one-second lifetime and null identity/fingerprint/open time. The next
before-observe is **always HTTP 403**. No query grant, application identity,
observation authority or tap permission exists in this controller.

Ready and next-request receipts come only from actual inbound messages; the
controller never manufactures them. They are pinned-source/capability evidence,
not independent process attestation. Denial sent is not denial consumed.
A graceful nonzero result identifying the selected failing test is reported as
expected XCTest failure, never a passing test. Early/unrelated exits, zero exits,
protocol failure, runner-start timeout and post-denial timeout remain distinct.
`testExecutionAttempted` describes command attempt, not successful test bootstrap;
`appBuildAttempted` and `mobileAcceptanceComplete` are always false.

## Fixed envelope and isolation

Only Xcode 26.6 / build 17F113 with simulator SDK 26.5 is accepted. The sole
credentialed step checks workflow creation (queued dispatch) and runner metadata,
requires 180 minutes of artifact life at dispatch and 20 minutes at job start,
and acquires the fixed ZIP. Expiry is checked again before native launch. No
original-app API/preflight/download is used. Controller/native children receive
minimal environments without account credentials.

One 300-second work clock starts before acquisition: acquisition 90s,
version/SDK 15s combined, static/prepare 45s, ownership 60s total (inventory,
create, verification individually clipped to 30s), ready/next request 40s,
post-denial exit 30s; 20s remains for overhead. Boot gets its existing separate
300s window with work paused. Cleanup shares one persisted 120s allowance,
including fallback. The workflow ceiling is 15 minutes. Controller RSS is capped
at 512 MiB and owned native process groups at 2 GiB by an independent watchdog.
Shared CoreSimulator daemon memory is **not** claimed bounded.

Creation uses the existing durable intent and exact owned process/device journal,
including uncertain-create recovery. No template/borrowed simulator, global erase,
service termination or name-based process sweep is permitted. Independent
watchdog and always cleanup do not depend on JavaScript `finally`. Unknown
inventory/reap/cleanup remains failure. Only a closed JSON receipt (at most
16 KiB) is uploaded; no raw output, private environment, xctestrun, artifact bytes,
result bundle or screenshots leave the owned tree. Local Foundation fixtures
exercise the real Swift client but are not native XCTest evidence.
