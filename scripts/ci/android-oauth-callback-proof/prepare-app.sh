#!/bin/bash
# Hosted proof only: actual Expo app/router/provider with embedded E2E JavaScript.
# No Metro race, new dependency, SDK install, production source or Release change.
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == Linux ]] || { echo 'Hosted Linux required'; exit 1; }
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="${RUNNER_TEMP:?}/android-oauth-callback-proof"
EVIDENCE="$OUT/evidence/real-app"
mkdir -p "$EVIDENCE"
cd "$ROOT"
export EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN=http://127.0.0.1:54831
node scripts/ci/signin-app-proof/prepare-entry.ts "$EVIDENCE"
HOST=$(find "$ROOT/android/app/src/main/java" -name MainApplication.kt -print)
[[ $(printf '%s\n' "$HOST" | wc -l) == 1 && -f "$HOST" ]] || { echo 'Expected one generated Expo host'; exit 1; }
cp "$HOST" "$EVIDENCE/generated-host-before.kt"
node scripts/ci/android-oauth-callback-proof/embedded-host.ts "$HOST" "$ROOT/signin-proof-entry.js"
cp signin-proof-entry.js "$EVIDENCE/signin-proof-entry.js"
sha256sum signin-proof-entry.js > "$EVIDENCE/entry-sha256.txt"
cp "$HOST" "$EVIDENCE/generated-host-embedded.kt"
mkdir -p android/app/src/debug/assets android/app/src/debug/res
# dev=true preserves __DEV__ for the existing explicit E2E gate. The native host
# nevertheless loads the packaged asset and never relies on a development server.
pnpm exec expo export:embed --platform android --entry-file "$ROOT/signin-proof-entry.js" \
  --dev true --minify false --max-workers 2 \
  --bundle-output "$ROOT/android/app/src/debug/assets/index.android.bundle" \
  --assets-dest "$ROOT/android/app/src/debug/res" > "$EVIDENCE/embedded-export.log" 2>&1
grep -q 54831 android/app/src/debug/assets/index.android.bundle
sha256sum android/app/src/debug/assets/index.android.bundle > "$EVIDENCE/embedded-bundle.sha256"
printf '%s\n' '{"embedded":true,"native_dev_support":false,"js_dev":true,"scope":"hosted-debug-proof-only"}' > "$EVIDENCE/bundle-mode.json"
