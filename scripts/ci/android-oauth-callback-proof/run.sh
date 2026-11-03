#!/bin/bash
# Hosted-only, debug APK and synthetic provider. No account/signing/Play access.
set -euo pipefail
[[ "${CI:-}" == true && "${RUNNER_OS:-}" == Linux ]] || { echo 'Hosted Linux CI required'; exit 1; }
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="${RUNNER_TEMP:?}/android-oauth-callback-proof"
mkdir -p "$OUT/evidence"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$APK" ]] || { echo 'Debug APK must be compiled before emulator proof'; exit 1; }
APP_ID=$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.argv[1])); if(!c.android?.package)process.exit(1); console.log(c.android.package)' "$OUT/expo-config.json")
cleanup() { adb shell am force-stop "$APP_ID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
adb wait-for-device
bash "$ROOT/scripts/ci/await-emulator-ready.sh"
# A google_apis image alone does not prove a browser exists. Use the installed
# Play-store image browser; never fetch an opaque APK to make the fixture pass.
adb shell pm list packages com.android.chrome | grep -q 'package:com.android.chrome'
adb shell dumpsys package com.android.chrome | grep -E 'versionName=|versionCode=' > "$OUT/evidence/browser-version.txt"
adb shell cmd package query-services --brief -a android.support.customtabs.action.CustomTabsService > "$OUT/evidence/browser-providers.txt"
grep -q com.android.chrome "$OUT/evidence/browser-providers.txt"
adb shell getprop ro.build.version.sdk > "$OUT/evidence/api.txt"
adb install -r "$APK"
cp "$APK" "$OUT/evidence/callback-proof-debug.apk"
sha256sum "$APK" "$ROOT/modules/radient-loopback/android/src/main/java/dev/localoperator/loopback/LoopbackAuthSession.kt" > "$OUT/evidence/source-and-apk.sha256"
# Chrome first-run UI belongs to fixture setup, BEFORE any auth flow deadline.
adb shell am start -a android.intent.action.VIEW -d 'https://example.com' -p com.android.chrome
cat > "$OUT/warm-browser.yaml" <<'YAML'
appId: com.android.chrome
---
- runFlow:
    when:
      visible: 'Accept & continue'
    commands:
      - tapOn: 'Accept & continue'
- runFlow:
    when:
      visible: 'Use without an account'
    commands:
      - tapOn: 'Use without an account'
- runFlow:
    when:
      visible: 'No thanks'
    commands:
      - tapOn: 'No thanks'
- extendedWaitUntil:
    visible: 'Example Domain'
    timeout: 60000
YAML
maestro test --test-output-dir "$OUT/evidence/warm-browser" "$OUT/warm-browser.yaml"
FAILURES=0
for mode in positive cancel timeout destroy; do
  cleanup
  adb shell am start -n "$APP_ID/dev.localoperator.loopback.OAuthProofActivity" --es proof_mode "$mode"
  title='Complete test sign-in'
  if [[ "$mode" != positive ]]; then title='Test callback waiting'; fi
  cat > "$OUT/$mode.yaml" <<YAML
appId: $APP_ID
---
- extendedWaitUntil:
    visible: 'Ready $mode'
    timeout: 60000
- tapOn: 'Start $mode'
- extendedWaitUntil:
    visible: '$title'
    timeout: 60000
- takeScreenshot: '$mode-browser'
YAML
  if [[ "$mode" == positive ]]; then
    cat >> "$OUT/$mode.yaml" <<YAML
- tapOn: 'Complete test sign-in'
- extendedWaitUntil:
    visible: 'PASS positive|Sign-in response received. Return to the app.|FAIL positive.*'
    timeout: 60000
- runFlow:
    when:
      visible: 'Return to Local Operator'
    commands:
      - takeScreenshot: 'positive-return-link'
      - tapOn: 'Return to Local Operator'
YAML
  fi
  if [[ "$mode" == cancel ]]; then echo '- back' >> "$OUT/$mode.yaml"; fi
  if [[ "$mode" != destroy ]]; then
    limit=90000
    if [[ "$mode" == timeout ]]; then limit=360000; fi
    cat >> "$OUT/$mode.yaml" <<YAML
- extendedWaitUntil:
    visible: 'PASS $mode|FAIL $mode.*'
    timeout: $limit
- assertVisible: 'PASS $mode'
- takeScreenshot: '$mode-returned'
YAML
  fi
  DRIVER_EXIT=0
  if maestro test --test-output-dir "$OUT/evidence/driver-$mode" "$OUT/$mode.yaml" > "$OUT/evidence/$mode-driver.log" 2>&1; then :; else DRIVER_EXIT=$?; fi
  if [[ "$mode" == destroy && "$DRIVER_EXIT" == 0 ]]; then
    # Execute the REAL management Activity.finish()/onDestroy through a control
    # that exists only in the debug manifest, not a mocked lifecycle callback.
    adb shell am broadcast -n "$APP_ID/dev.localoperator.loopback.OAuthProofControlReceiver" -a dev.localoperator.loopback.PROOF_DESTROY
    cat > "$OUT/destroy-return.yaml" <<YAML
appId: $APP_ID
---
- extendedWaitUntil:
    visible: 'PASS destroy|FAIL destroy.*'
    timeout: 90000
- assertVisible: 'PASS destroy'
- takeScreenshot: 'destroy-returned'
YAML
    if maestro test --test-output-dir "$OUT/evidence/driver-destroy-return" "$OUT/destroy-return.yaml" >> "$OUT/evidence/$mode-driver.log" 2>&1; then :; else DRIVER_EXIT=$?; fi
  fi
  cat "$OUT/evidence/$mode-driver.log"
  if adb shell run-as "$APP_ID" cat "files/oauth-proof-$mode.json" > "$OUT/evidence/$mode-native.json"; then :; else DRIVER_EXIT=1; fi
  adb shell dumpsys activity activities > "$OUT/evidence/$mode-activities.txt"
  adb exec-out screencap -p > "$OUT/evidence/$mode-final.png"
  if python3 - "$OUT/evidence" "$mode" "$DRIVER_EXIT" "$APP_ID" <<'PY'
import json, pathlib, re, sys
out, mode, driver, app = pathlib.Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
try:
    native = json.loads((out / (mode + '-native.json')).read_text())
except (OSError, ValueError):
    native = {'pass': None, 'detail': 'missing-or-invalid-native-receipt'}
activities = (out / (mode + '-activities.txt')).read_text()
resumed = [line for line in activities.splitlines() if 'mResumedActivity:' in line or 'topResumedActivity=' in line]
owner_returned = any(app + '/dev.localoperator.loopback.OAuthProofActivity' in line for line in resumed)
auth_tab_retained = any(re.search(r'\* Hist #\d+:.*(?:CustomTabActivity|AuthTabActivity)', line) for line in activities.splitlines())
receipt = {'mode': mode, 'driver_exit': driver, 'owner_returned': owner_returned,
           'auth_tab_retained': auth_tab_retained, 'native': native,
           'pass': driver == 0 and native.get('pass') is True and owner_returned and not auth_tab_retained}
(out / (mode + '.json')).write_text(json.dumps(receipt, indent=2, sort_keys=True))
print(json.dumps(receipt, sort_keys=True))
sys.exit(0 if receipt['pass'] else 1)
PY
  then :; else FAILURES=1; fi
done
exit "$FAILURES"
