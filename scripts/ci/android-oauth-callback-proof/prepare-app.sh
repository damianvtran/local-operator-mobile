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
export EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF=true
ORIGIN_HELPER="$ROOT/src/connection/oauth-proof-override.ts"
cp "$ORIGIN_HELPER" "$EVIDENCE/origin-admission-original.ts"
# Only this job's bundle sees the explicit proof define; restore application
# source even if export fails. A normal Release keeps its original Debug gate.
restore_origin() { cp "$EVIDENCE/origin-admission-original.ts" "$ORIGIN_HELPER"; }
trap restore_origin EXIT
node scripts/ci/signin-app-proof/prepare-entry.ts "$EVIDENCE"
HOST=$(find "$ROOT/android/app/src/main/java" -name MainApplication.kt -print)
[[ $(printf '%s\n' "$HOST" | wc -l) == 1 && -f "$HOST" ]] || { echo 'Expected one generated Expo host'; exit 1; }
cp "$HOST" "$EVIDENCE/generated-host-before.kt"
node scripts/ci/android-oauth-callback-proof/embedded-host.ts "$HOST" "$ROOT/signin-proof-entry.js" "$ORIGIN_HELPER"
cp "$ORIGIN_HELPER" "$EVIDENCE/origin-admission-proof.ts"
cp signin-proof-entry.js "$EVIDENCE/signin-proof-entry.js"
sha256sum signin-proof-entry.js > "$EVIDENCE/entry-sha256.txt"
cp "$HOST" "$EVIDENCE/generated-host-embedded.kt"
mkdir -p android/app/src/debug/assets android/app/src/debug/res
# Expo57 DEV bundles unconditionally load a message socket that rejects assets.
# Export real production-mode JS; only the job-generated entry/admission helper
# uses the explicit proof define, never Expo's global __DEV__ or a Metro server.
pnpm exec expo export:embed --platform android --entry-file "$ROOT/signin-proof-entry.js" \
  --dev false --minify false --max-workers 2 \
  --bundle-output "$ROOT/android/app/src/debug/assets/index.android.bundle" \
  --assets-dest "$ROOT/android/app/src/debug/res" > "$EVIDENCE/embedded-export.log" 2>&1
grep -q 54831 android/app/src/debug/assets/index.android.bundle
python3 - <<'PY'
import pathlib,re
head=pathlib.Path('android/app/src/debug/assets/index.android.bundle').read_text()[:512]
assert re.search(r'__DEV__\s*=\s*false',head), 'Proof must export production-mode JS, not Expo embedded DEV'
PY
sha256sum android/app/src/debug/assets/index.android.bundle > "$EVIDENCE/embedded-bundle.sha256"
printf '%s\n' '{"embedded":true,"native_dev_support":false,"js_dev":false,"explicit_proof_define":true,"scope":"hosted-debug-proof-only"}' > "$EVIDENCE/bundle-mode.json"
