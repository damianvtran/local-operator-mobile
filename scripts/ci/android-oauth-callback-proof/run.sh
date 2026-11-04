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
# Reset is fixture isolation, NEVER cancellation/cleanup acceptance evidence.
reset_mode() {
  adb shell am force-stop com.android.chrome
  cleanup
  adb shell input keyevent KEYCODE_HOME
  local launcher
  launcher=$(adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tr -d '\r' | tail -1)
  [[ "$launcher" == */* ]] || return 1
  for tick in {1..15}; do
    adb shell dumpsys activity activities > "$OUT/evidence/$mode-reset.txt"
    if grep -E 'mResumedActivity:|topResumedActivity=' "$OUT/evidence/$mode-reset.txt" | grep -F "${launcher%%/*}/"; then return 0; fi
    sleep 1
  done
  echo 'Fixture reset did not reach launcher' >&2; return 1
}
wait_browser_ready() {
  for tick in {1..60}; do
    adb shell run-as "$APP_ID" cat "files/oauth-proof-$mode.json" > "$OUT/evidence/$mode-browser-ready.json"
    if python3 - "$OUT/evidence/$mode-browser-ready.json" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
sys.exit(0 if v.get('stage') == 'browser-ready' and v.get('provider_served') is True and v.get('native_socket_probes_passed') is True else 1)
PY
    then return 0; fi
    sleep 1
  done
  echo 'Browser never served the fresh provider page' >&2; return 1
}
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
# The debug-app opt-in lets stock Chrome honor its test-only command-line file.
# Suppress first-run/IPH before launch; the flow also dismisses/verifies the
# observed native tooltip. No browser profile or auth account is imported.
adb shell am force-stop com.android.chrome
adb shell am set-debug-app --persistent com.android.chrome
adb shell "printf '%s' '_ --disable-fre --no-default-browser-check --no-first-run --disable-features=IPH_*' > /data/local/tmp/chrome-command-line"
adb shell cat /data/local/tmp/chrome-command-line > "$OUT/evidence/chrome-flags.txt"
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
  reset_mode
  adb shell run-as "$APP_ID" rm -f "files/oauth-proof-$mode.json"
  adb shell am start -n "$APP_ID/dev.localoperator.loopback.OAuthProofActivity" --es proof_mode "$mode"
  DRIVER_EXIT=0
  cat > "$OUT/$mode-start.yaml" <<YAML
appId: $APP_ID
---
- extendedWaitUntil:
    visible: 'Ready $mode'
    timeout: 60000
- tapOn: 'Start $mode'
YAML
  if maestro test --test-output-dir "$OUT/evidence/start-$mode" "$OUT/$mode-start.yaml" > "$OUT/evidence/$mode-driver.log" 2>&1; then
    if wait_browser_ready; then :; else DRIVER_EXIT=1; fi
  else DRIVER_EXIT=$?; fi
  cat > "$OUT/$mode.yaml" <<YAML
appId: $APP_ID
---
- waitForAnimationToEnd:
    timeout: 5000
- runFlow:
    when:
      visible: 'Minimize tab to return to it later'
    commands:
      - back
- assertNotVisible: 'Minimize tab to return to it later'
- takeScreenshot: '$mode-browser'
YAML
  if [[ "$mode" == positive ]]; then
    # Prefer an AX text selector. Chrome 133 can omit web nodes entirely; the
    # fallback point is inside the fixture's full-width 200-CSS-px top anchor
    # (toolbar ~12% + half anchor ~11% on this pinned Pixel 7), not a URL load.
    if timeout 20s adb shell uiautomator dump /sdcard/oauth-proof-window.xml > "$OUT/evidence/$mode-hierarchy.log" 2>&1; then
      adb exec-out cat /sdcard/oauth-proof-window.xml > "$OUT/evidence/$mode-browser-hierarchy.xml"
    fi
    if [[ -f "$OUT/evidence/$mode-browser-hierarchy.xml" ]] && grep -q 'Complete test sign-in' "$OUT/evidence/$mode-browser-hierarchy.xml"; then
      echo "- tapOn: 'Complete test sign-in'" >> "$OUT/$mode.yaml"
    else
      printf '%s\n' '- tapOn:' '    point: "50%,24%"' >> "$OUT/$mode.yaml"
    fi
    cat >> "$OUT/$mode.yaml" <<YAML
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
  if [[ "$DRIVER_EXIT" == 0 ]]; then
    if maestro test --test-output-dir "$OUT/evidence/driver-$mode" "$OUT/$mode.yaml" >> "$OUT/evidence/$mode-driver.log" 2>&1; then :; else DRIVER_EXIT=$?; fi
  fi
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
wrong_state_proven = mode != 'positive' or native.get('wrong_state_rejections') == 1
receipt = {'mode': mode, 'driver_exit': driver, 'owner_returned': owner_returned,
           'auth_tab_retained': auth_tab_retained, 'native': native,
           'pass': driver == 0 and native.get('pass') is True and native.get('late_refused') is True and wrong_state_proven and owner_returned and not auth_tab_retained}
(out / (mode + '.json')).write_text(json.dumps(receipt, indent=2, sort_keys=True))
print(json.dumps(receipt, sort_keys=True))
sys.exit(0 if receipt['pass'] else 1)
PY
  then :; else FAILURES=1; fi
done
# Native delivery is necessary, not sufficient: also drive the real JS provider
# through token failure/Retry, successful discovery/picker and persisted restore.
if bash "$ROOT/scripts/ci/android-oauth-callback-proof/real-app.sh"; then :; else FAILURES=1; fi
exit "$FAILURES"
