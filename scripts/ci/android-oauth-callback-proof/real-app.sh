#!/bin/bash
# The native fixture proves socket/lifecycle boundaries. This second surface uses
# the SAME installed Expo APK and real router/provider, so callback delivery alone
# cannot be mistaken for a persisted account and visible picker.
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == Linux ]] || { echo 'Hosted Linux required'; exit 1; }
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="${RUNNER_TEMP:?}/android-oauth-callback-proof"
EVIDENCE="$OUT/evidence/real-app"
mkdir -p "$EVIDENCE"
APP_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).android.package)' "$OUT/expo-config.json")
export EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN=http://127.0.0.1:54831
PROOF_ROW_ID=$(node -e 'console.log("computer-row-"+"0".repeat(32)+"-lop.radienthq.com")')
SERVER_PID=''
LAUNCH_PROBE=''
# Capture the actual startup boundary, not just a later launcher screenshot.
# Only synthetic hosted app/system diagnostics: never a real OAuth account.
capture_app_state() {
  local phase="$1"
  if adb shell pidof "$APP_ID" > "$EVIDENCE/$phase-pid.txt"; then :
  else printf '%s\n' 'not-running' > "$EVIDENCE/$phase-pid.txt"; fi
  adb logcat -d -v threadtime | awk '/AndroidRuntime|ReactNativeJS|ReactNative|Expo|com[.]localoperator[.]mobile|ANDROID_PROOF_/ { print }' > "$EVIDENCE/$phase-logcat.txt"
}
probe_launch() {
  local phase="$1"
  for tick in {1..120}; do
    if adb shell pidof "$APP_ID" > "$EVIDENCE/$phase-first-pid.txt"; then
      capture_app_state "$phase-after-launch"
      for loaded in {1..60}; do
        capture_app_state "$phase-loader"
        if grep -q 'ANDROID_PROOF_BUNDLE_URL=' "$EVIDENCE/$phase-loader-logcat.txt" || ! adb shell pidof "$APP_ID" >/dev/null; then return; fi
        sleep 1
      done
      return
    fi
    sleep 0.5
  done
  capture_app_state "$phase-not-observed"
}
cleanup() {
  capture_app_state exit || echo 'Failed to collect final Android startup diagnostics' >&2
  if [[ -n "$LAUNCH_PROBE" ]]; then
    if kill -0 "$LAUNCH_PROBE" 2>/dev/null; then kill -TERM "$LAUNCH_PROBE"; fi
    if wait "$LAUNCH_PROBE"; then :; else echo 'Startup diagnostic probe reaped' >&2; fi
  fi
  for pid in "$SERVER_PID"; do
    if [[ -n "$pid" ]] && kill -0 -- "-$pid" 2>/dev/null; then kill -TERM -- "-$pid"; fi
  done
  if [[ -f "$EVIDENCE/original-package.json" ]]; then cp "$EVIDENCE/original-package.json" "$ROOT/package.json"; fi
}
trap cleanup EXIT
cd "$ROOT"
# prepare-app.sh ran before Gradle and embedded the same E2E entry.
SERVER_PID=$(python3 - "$EVIDENCE" <<'PY'
import os,pathlib,subprocess,sys
out=pathlib.Path(sys.argv[1]);env=dict(os.environ,SIGNIN_PROOF_RECEIPT=str(out/'provider-receipt.json'))
p=subprocess.Popen(['node','tools/mock-relay/oauth-fast-path.ts'],env=env,stdout=open(out/'provider.log','w'),stderr=subprocess.STDOUT,start_new_session=True)
print(p.pid)
PY
)
# This APK has the actual router/provider in a preflighted embedded bundle.
# Its generated native host explicitly disables packager support; /status or a
# warm bundle cannot prove a host will choose Metro (attempt3 did both already).
[[ -s "$EVIDENCE/bundle-mode.json" && -s "$EVIDENCE/embedded-bundle.sha256" ]] || { echo 'Embedded app preflight missing'; exit 1; }
ready=false
for tick in {1..60}; do
  kill -0 -- "-$SERVER_PID" 2>/dev/null || { cat "$EVIDENCE/provider.log" >&2; exit 1; }
  if curl -fsS http://127.0.0.1:54831/receipt >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Real-app provider setup failed'; exit 1; }
adb reverse tcp:8081 tcp:8081
adb reverse tcp:54831 tcp:54831
adb shell am force-stop com.android.chrome
adb shell am force-stop "$APP_ID"
# Fresh job-owned emulator: the fixture has never written a real OAuth grant.
# Clear only the first launch; the final cold relaunch preserves SecureStore.
curl -fsS 'http://127.0.0.1:54831/control?mode=failure&reset=true' > "$EVIDENCE/control-failure.json"
cat > "$OUT/real-app-negative.yaml" <<YAML
appId: $APP_ID
---
- launchApp:
    clearState: true
- extendedWaitUntil:
    visible:
      id: 'welcome-screen'
    timeout: 120000
- takeScreenshot: 'android-welcome-brand'
- tapOn:
    id: 'welcome-connect'
- extendedWaitUntil:
    visible: 'Retry|Return to Local Operator'
    timeout: 90000
- runFlow:
    when:
      visible: 'Return to Local Operator'
    commands:
      - takeScreenshot: 'android-negative-localized-return'
      - tapOn: 'Return to Local Operator'
- extendedWaitUntil:
    visible:
      id: 'sign-in-try-again'
    timeout: 90000
- takeScreenshot: 'android-token-500-error-and-retry'
- tapOn:
    id: 'sign-in-diagnostics-toggle'
- assertVisible:
    id: 'sign-in-diagnostics'
- assertVisible: '.*RadientAuthError.*'
- takeScreenshot: 'android-error-diagnostics'
YAML
RESULT=0
probe_launch negative & LAUNCH_PROBE=$!
if maestro test --test-output-dir "$EVIDENCE/negative" "$OUT/real-app-negative.yaml" > "$EVIDENCE/negative-driver.log" 2>&1; then :; else RESULT=$?; fi
wait "$LAUNCH_PROBE"
LAUNCH_PROBE=''
capture_app_state negative-complete
curl -fsS http://127.0.0.1:54831/receipt > "$EVIDENCE/negative-receipt.json"
if [[ "$RESULT" == 0 ]]; then
  python3 - "$EVIDENCE/negative-receipt.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]));assert all(v.get(k)==n for k,n in {'authorize':1,'token':1,'pkce_verified':1,'discovery':0}.items()),v
PY
  curl -fsS 'http://127.0.0.1:54831/control?mode=success' > "$EVIDENCE/control-success.json"
  cat > "$OUT/real-app-positive.yaml" <<YAML
appId: $APP_ID
---
- tapOn:
    id: 'sign-in-try-again'
- extendedWaitUntil:
    visible: '.*OAuth proof computer.*|Return to Local Operator'
    timeout: 90000
- runFlow:
    when:
      visible: 'Return to Local Operator'
    commands:
      - takeScreenshot: 'android-positive-localized-return'
      - tapOn: 'Return to Local Operator'
- extendedWaitUntil:
    visible:
      id: 'computers-screen'
    timeout: 90000
- assertVisible:
    id: '$PROOF_ROW_ID'
- takeScreenshot: 'android-positive-tunnel-picker'
YAML
  if maestro test --test-output-dir "$EVIDENCE/positive" "$OUT/real-app-positive.yaml" > "$EVIDENCE/positive-driver.log" 2>&1; then :; else RESULT=$?; fi
  curl -fsS http://127.0.0.1:54831/receipt > "$EVIDENCE/positive-receipt.json"
fi
if [[ "$RESULT" == 0 ]]; then
  adb shell am force-stop "$APP_ID"
  cat > "$OUT/real-app-restore.yaml" <<YAML
appId: $APP_ID
---
- launchApp:
    clearState: false
- extendedWaitUntil:
    visible:
      id: 'computers-screen'
    timeout: 90000
- assertVisible:
    id: '$PROOF_ROW_ID'
- takeScreenshot: 'android-persisted-grant-restored-picker'
- tapOn:
    id: '$PROOF_ROW_ID'
- extendedWaitUntil:
    visible:
      id: 'home-screen'
    timeout: 90000
- tapOn:
    id: 'home-sidebar'
- extendedWaitUntil:
    visible:
      id: 'conversations-list'
    timeout: 60000
- assertVisible:
    id: 'session-row-b3535011f562'
- takeScreenshot: 'android-connected-session-list'
YAML
  if maestro test --test-output-dir "$EVIDENCE/restored" "$OUT/real-app-restore.yaml" > "$EVIDENCE/restored-driver.log" 2>&1; then :; else RESULT=$?; fi
  curl -fsS http://127.0.0.1:54831/receipt > "$EVIDENCE/restored-receipt.json"
fi
capture_app_state final
adb exec-out screencap -p > "$EVIDENCE/final.png"
adb shell dumpsys activity activities > "$EVIDENCE/final-activities.txt"
python3 - "$EVIDENCE" "$RESULT" <<'PY'
import json,pathlib,sys
out=pathlib.Path(sys.argv[1]);driver=int(sys.argv[2]);passed=False
try:
 p=json.loads((out/'positive-receipt.json').read_text());r=json.loads((out/'restored-receipt.json').read_text())
 passed=driver==0 and p['authorize']==2 and p['token']==2 and p['pkce_verified']==2 and p['discovery']>=1 and r['authorize']==2 and r['token']==2 and r['discovery']>p['discovery'] and r['session_code']==1 and r['session_token']==1 and r['session_pkce_verified']==1 and r['relay_requests']>0
except (OSError,ValueError,KeyError):pass
embedded=any('ANDROID_PROOF_BUNDLE_URL=assets://' in p.read_text(errors='replace') for p in out.glob('*-logcat.txt'))
passed=passed and embedded
receipt={'pass':passed,'embedded_bundle_loaded':embedded,'driver_exit':driver,'surface':'real-Expo-app-embedded-token500-retry-picker-cold-restore-connected-list','localized_return_exercised':bool(list(out.rglob('*localized-return*.png')))}
(out/'result.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt));sys.exit(0 if passed else 1)
PY
