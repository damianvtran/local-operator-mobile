#!/usr/bin/env bash
# Exact-SHA, already-compiled test APK; no Gradle install/build in the emulator job.
set -euo pipefail
sh scripts/ci/await-emulator-ready.sh
apk=$(find "$RUNNER_TEMP/sound-apk" -maxdepth 1 -name '*.apk')
adb install "$apk"
trap 'adb uninstall dev.localoperator.sound.test >/dev/null' EXIT
timeout 480 adb shell am instrument -w dev.localoperator.sound.test/dev.localoperator.sound.NotificationSoundTestRunner | tee "$RUNNER_TEMP/sound-native.log"
grep -q '7/7 notification sound native checks passed' "$RUNNER_TEMP/sound-native.log"
grep -q '^INSTRUMENTATION_CODE: -1' "$RUNNER_TEMP/sound-native.log"
if grep -Eq 'INSTRUMENTATION_(FAILED|ABORTED)|INSTRUMENTATION_STATUS_CODE: -[12]' "$RUNNER_TEMP/sound-native.log"; then exit 1; fi
