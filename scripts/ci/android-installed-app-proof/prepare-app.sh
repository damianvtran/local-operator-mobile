#!/bin/bash
# HOSTED INSTALLED-APP PROOF ONLY. Turns the CANDIDATE's freshly prebuilt android/
# project into (1) a debug proof APK whose JS is an embedded production-mode
# bundle carrying the job-only fixture seam, and (2) a same-signer app-targeted
# instrumentation APK (InstalledAppProofRunner). Same pattern as
# scripts/ci/android-oauth-callback-proof/prepare-app.sh: no Metro, no new
# dependency, no SDK install, application source restored after export.
#
# Usage (from the candidate root): bash <harness>/prepare-app.sh <harness-dir>
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == Linux ]] || { echo 'Hosted Linux required'; exit 1; }
HARNESS=$(cd "$1" && pwd)
ROOT=$(pwd)
OUT="${RUNNER_TEMP:?}/installed-proof"
EVIDENCE="$OUT/evidence/build"
mkdir -p "$EVIDENCE"
export EXPO_PUBLIC_ANDROID_INSTALLED_PROOF=54832
MARKER=LOP_INSTALLED_PROOF_FIXTURE_54832

HOST=$(find "$ROOT/android/app/src/main/java" -name MainApplication.kt -print)
[[ $(printf '%s\n' "$HOST" | wc -l) == 1 && -f "$HOST" ]] || { echo 'Expected one generated Expo host'; exit 1; }
cp "$HOST" "$EVIDENCE/MainApplication.generated.kt"

restore() {
  [[ -f "$EVIDENCE/team-bridge-fixture.original.ts" ]] && cp "$EVIDENCE/team-bridge-fixture.original.ts" "$ROOT/src/testing/team-bridge-fixture.ts"
  [[ -f "$EVIDENCE/android-presentation.original.ts" ]] && cp "$EVIDENCE/android-presentation.original.ts" "$ROOT/src/team-bridge/android-presentation.ts"
  [[ -f "$EVIDENCE/package.original.json" ]] && cp "$EVIDENCE/package.original.json" "$ROOT/package.json"
  rm -f "$ROOT/installed-proof-entry.js"
}
trap restore EXIT

# NORMAL payload first, from the untouched candidate: the same production-mode
# export with the original entry and WITHOUT the define. Absence of every proof
# marker here is the "nothing ships" receipt for the JS (source greps alone are
# not proof of what Metro emits).
mkdir -p "$OUT/normal"
env -u EXPO_PUBLIC_ANDROID_INSTALLED_PROOF pnpm exec expo export:embed --platform android \
  --dev false --minify false --max-workers 2 \
  --bundle-output "$OUT/normal/index.android.bundle" --assets-dest "$OUT/normal/res" \
  > "$EVIDENCE/normal-export.log" 2>&1
sha256sum "$OUT/normal/index.android.bundle" > "$EVIDENCE/normal-bundle.sha256"

PROOF_HOST="$HOST" node "$HARNESS/prepare.ts" "$ROOT" "$EVIDENCE"
mkdir -p android/app/src/debug/assets android/app/src/debug/res
pnpm exec expo export:embed --platform android --entry-file "$ROOT/installed-proof-entry.js" \
  --dev false --minify false --max-workers 2 \
  --bundle-output "$ROOT/android/app/src/debug/assets/index.android.bundle" \
  --assets-dest "$ROOT/android/app/src/debug/res" > "$EVIDENCE/proof-export.log" 2>&1
restore
trap - EXIT
# Restored bytes equal the committed candidate's (prebuild never touches src/).
git -C "$ROOT" diff --exit-code -- src > "$EVIDENCE/source-restored.diff" \
  || { echo 'Candidate source not restored after export'; exit 1; }
cmp "$EVIDENCE/package.original.json" package.json
test ! -e installed-proof-entry.js

BUNDLE=android/app/src/debug/assets/index.android.bundle
grep -q "$MARKER" "$BUNDLE" || { echo 'Proof bundle lacks the fixture seam'; exit 1; }
grep -q '127.0.0.1:54832/mock-hub/populated' "$BUNDLE"
# The photo origin the proof app registers (#304 QA R4 Q3); the closing quote
# tells it apart from the mock-hub base URL above.
grep -q '"http://127.0.0.1:54832"' "$BUNDLE" || { echo 'Proof bundle lacks the loopback photo origin'; exit 1; }
python3 - "$BUNDLE" <<'PY'
import pathlib, re, sys
head = pathlib.Path(sys.argv[1]).read_text()[:512]
assert re.search(r'__DEV__\s*=\s*false', head), 'Proof must export production-mode JS'
PY
if grep -qE "$MARKER|EXPO_PUBLIC_ANDROID_INSTALLED_PROOF|mock-hub/populated|54833" "$OUT/normal/index.android.bundle"; then
  echo 'Proof marker leaked into the NORMAL bundle'; exit 1
fi
sha256sum "$BUNDLE" | cut -d' ' -f1 > "$EVIDENCE/proof-bundle.sha256"

# Job-only androidTest source set on the generated app project. Coordinates are
# read from the candidate's own module so the driver links the SAME
# expo-notifications/firebase-messaging the app ships (Gradle keeps one copy and
# leaves the classes to the app APK at runtime).
GRADLE_MODULE=modules/lop-team-bridge-push/android/build.gradle
NOTIF=$(grep -oE "host\.exp\.exponent:expo\.modules\.notifications:[0-9.]+" "$GRADLE_MODULE")
FCM=$(grep -oE "com\.google\.firebase:firebase-messaging:[0-9.]+" "$GRADLE_MODULE")
[[ -n $NOTIF && -n $FCM ]] || { echo 'Candidate module coordinates moved'; exit 1; }
TEST_SRC=android/app/src/androidTest/java/com/localoperator/mobile/installedproof
mkdir -p "$TEST_SRC"
cp "$HARNESS/InstalledAppProofRunner.kt" "$TEST_SRC/"
cat >> android/app/build.gradle <<GRADLE

// --- hosted installed-app proof job only (scripts/ci/android-installed-app-proof) ---
android { defaultConfig { testInstrumentationRunner "com.localoperator.mobile.installedproof.InstalledAppProofRunner" } }
dependencies {
  androidTestImplementation '$NOTIF'
  androidTestImplementation '$FCM'
}
GRADLE
tail -8 android/app/build.gradle > "$EVIDENCE/gradle-append.txt"
