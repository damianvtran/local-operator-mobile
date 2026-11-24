#!/usr/bin/env bash
# ADR 0010 S2/S4: run the Team Bridge push module's framework-only
# instrumentation (TeamBridgePushTestRunner) from the exact-SHA, already-compiled
# library test APK; no Gradle install/build in the emulator job. Same shape as
# notification-sound-android-tests.sh, whose comments carry the -r rationale.
set -euo pipefail
sh scripts/ci/await-emulator-ready.sh
apk=$(find "$RUNNER_TEMP/team-bridge-apk" -maxdepth 1 -name '*.apk')
adb install -g "$apk"
trap 'adb uninstall dev.localoperator.teambridge.test >/dev/null' EXIT
timeout 480 adb shell am instrument -w -r dev.localoperator.teambridge.test/dev.localoperator.teambridge.TeamBridgePushTestRunner | tee "$RUNNER_TEMP/team-bridge-push-native.log"
# Derive the count instead of pinning a literal (#304 review R7-1): a pinned
# "15/15" went stale the moment a 16th case landed, failing a green run. The
# runner prints "$passed/$total"; require exactly one such summary, every case
# passed, and total >= MIN_CASES so a case silently dropped from the runner's
# list (16 as of #304 QA R5 Q10) still fails. Raise the floor when adding cases.
min_cases=16
summary=$(tr -d '\r' < "$RUNNER_TEMP/team-bridge-push-native.log" | grep -Eo '[0-9]+/[0-9]+ team bridge push native checks passed' || true)
[ "$(printf '%s\n' "$summary" | grep -c .)" -eq 1 ] || { echo "expected one native checks summary, got: ${summary:-none}" >&2; exit 1; }
passed=${summary%%/*}
total=${summary#*/}; total=${total%% *}
[ "$passed" -eq "$total" ] || { echo "native checks: $passed/$total passed" >&2; exit 1; }
[ "$total" -ge "$min_cases" ] || { echo "native checks: $total cases ran, expected at least $min_cases" >&2; exit 1; }
grep -Eq '^INSTRUMENTATION_CODE: -1[[:space:]]*$' "$RUNNER_TEMP/team-bridge-push-native.log"
if grep -Eq 'INSTRUMENTATION_(FAILED|ABORTED)|INSTRUMENTATION_STATUS_CODE: -[12]' "$RUNNER_TEMP/team-bridge-push-native.log"; then exit 1; fi
