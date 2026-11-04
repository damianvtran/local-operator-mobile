#!/bin/bash
# Hosted real-application proof. One app build, one runner, no credential or
# signing lane. Exact process groups and the owned simulator are reaped on exit.
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == macOS ]] || { echo 'Hosted macOS required'; exit 1; }
OUT="$RUNNER_TEMP/signin-app-proof"
mkdir -p "$OUT"
SERVER_PID=''; METRO_PID=''
cleanup() {
  for pid in "$SERVER_PID" "$METRO_PID"; do
    if [[ -n "$pid" ]]; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
  done
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
APP_ID=$(pnpm exec expo config --type public --json | node -e 'let s=""; process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).ios.bundleIdentifier))')
WORKSPACE=$(find ios -maxdepth 1 -name '*.xcworkspace' -type d | head -1)
[[ -n "$WORKSPACE" && -n "$UDID" && -n "$APP_ID" ]]
# Export actual process-group owners, not pnpm's subsequently reparented children.
SERVER_PID=$(python3 - "$OUT" <<'PY'
import os, pathlib, subprocess, sys
out = pathlib.Path(sys.argv[1]); env = dict(os.environ, SIGNIN_PROOF_RECEIPT=str(out / 'provider-receipt.json'))
p = subprocess.Popen(['node', 'tools/mock-relay/oauth-fast-path.ts'], env=env, stdout=open(out / 'provider.log','w'), stderr=subprocess.STDOUT, start_new_session=True)
print(p.pid)
PY
)
METRO_PID=$(python3 - "$OUT" <<'PY'
import os, pathlib, subprocess, sys
out = pathlib.Path(sys.argv[1]); env = dict(os.environ, CI='1', EXPO_NO_TELEMETRY='1')
p = subprocess.Popen(['pnpm','exec','expo','start','--localhost','--port','8081','--max-workers','2'], env=env, stdout=open(out / 'metro.log','w'), stderr=subprocess.STDOUT, start_new_session=True)
print(p.pid)
PY
)
# Expo --localhost binds the hostname, often ::1 on macOS. Probe that exact
# host, not 127.0.0.1: the OAuth mock separately binds literal IPv4 on purpose.
ready=false
for tick in {1..120}; do
  if ! kill -0 -- "-$SERVER_PID" 2>/dev/null || ! kill -0 -- "-$METRO_PID" 2>/dev/null; then
    cat "$OUT/provider.log" "$OUT/metro.log" >&2
    echo 'Provider/Metro exited during setup' >&2; exit 1
  fi
  if curl -fsS http://127.0.0.1:54831/receipt >/dev/null && curl -fsS http://localhost:8081/status | grep -q 'packager-status:running'; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Provider/Metro setup failed'; exit 1; }
curl -fsS --max-time 180 'http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false' > "$RUNNER_TEMP/signin-dev.js"
grep -q 54831 "$RUNNER_TEMP/signin-dev.js"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl help keychain > "$OUT/simctl-keychain-help.txt" 2>&1
grep -q reset "$OUT/simctl-keychain-help.txt"
xcrun simctl help ui > "$OUT/simctl-ui-help.txt" 2>&1
grep -q appearance "$OUT/simctl-ui-help.txt"
# Match the proven callback-proof UI runner: ad-hoc simulator identities only,
# no developer team, certificate, provisioning profile or release signing lane.
SIGNING=(CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=)
xcodebuild -workspace "$WORKSPACE" -scheme SignInAppProof -configuration Debug -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$RUNNER_TEMP/SignInAppDD" "${SIGNING[@]}" build-for-testing > "$OUT/build.log" 2>&1
APP=$(find "$RUNNER_TEMP/SignInAppDD/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' ! -name '*Runner.app' -type d | head -1)
[[ -n "$APP" ]]
EXEC=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")
shasum -a 256 "$APP/$EXEC" "$RUNNER_TEMP/signin-dev.js" > "$OUT/binary-and-preflight-bundle.sha256"
git rev-parse HEAD > "$OUT/source-head.txt"
ditto -c -k --keepParent "$APP" "$OUT/real-expo-debug-app.zip"
for theme in light dark; do
  # This simulator and all grants were created by this job. Between theme
  # phases only, discard its synthetic Keychain data so the next case starts
  # signed out. The prior phase already proved persistence across a cold launch.
  xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl keychain "$UDID" reset
  xcrun simctl ui "$UDID" appearance "$theme"
  xcrun simctl ui "$UDID" appearance > "$OUT/$theme-appearance.txt"
  set +e
  TEST_RUNNER_APP_ID="$APP_ID" xcodebuild -workspace "$WORKSPACE" -scheme SignInAppProof -configuration Debug -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$RUNNER_TEMP/SignInAppDD" -resultBundlePath "$OUT/$theme.xcresult" -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -only-testing:SignInAppUITests/SignInAppUITests/testAlreadySignedInFastPathAndServerError "${SIGNING[@]}" test-without-building > "$OUT/$theme-test.log" 2>&1
  RESULT=$?
  set -e
  if [[ -d "$OUT/$theme.xcresult" ]]; then
    xcrun xcresulttool export attachments --path "$OUT/$theme.xcresult" --output-path "$OUT/frames/$theme"
  fi
  if [[ -f "$OUT/provider-receipt.json" ]]; then cp "$OUT/provider-receipt.json" "$OUT/$theme-provider-receipt.json"; fi
  cat "$OUT/$theme-test.log"
  [[ "$RESULT" == 0 ]] || exit "$RESULT"
  python3 - "$OUT/$theme-provider-receipt.json" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
assert v['authorize'] == 2 and v['token'] == 2 and v['pkce_verified'] == 2 and v['discovery'] >= 2, 'Real-app flow/persistence receipts incomplete (including zero-tests execution)'
PY
done
