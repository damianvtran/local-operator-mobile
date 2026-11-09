#!/usr/bin/env bash
# No pods/dependencies: same persistence source as the app pod. The normal iOS
# workflow remains the Expo binding build; this lane does not stand in for it.
set -euo pipefail
mkdir -p "$RUNNER_TEMP/sound-ios-results"
git rev-parse HEAD | tee "$RUNNER_TEMP/sound-ios-results/source-sha.txt"
cd modules/lop-notification-sound
common=(-scheme LopNotificationSoundStore -destination "platform=iOS Simulator,id=$SOUND_SIMULATOR" -derivedDataPath "$RUNNER_TEMP/sound-ios-data" -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 CODE_SIGNING_ALLOWED=NO)
xcodebuild "${common[@]}" build-for-testing
xcodebuild "${common[@]}" test-without-building -skip-testing:LopNotificationSoundStoreTests/ProcessPersistenceTests -resultBundlePath "$RUNNER_TEMP/sound-ios-results/barriers.xcresult"
# Each invocation launches a new test-runner process, verified by persisted PID.
xcodebuild "${common[@]}" test-without-building -only-testing:LopNotificationSoundStoreTests/ProcessPersistenceTests/testPhaseAWrite -resultBundlePath "$RUNNER_TEMP/sound-ios-results/write.xcresult"
xcodebuild "${common[@]}" test-without-building -only-testing:LopNotificationSoundStoreTests/ProcessPersistenceTests/testPhaseBRead -resultBundlePath "$RUNNER_TEMP/sound-ios-results/restart.xcresult"
