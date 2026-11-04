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
ready=false
for tick in {1..120}; do
  if ! kill -0 -- "-$SERVER_PID" 2>/dev/null || ! kill -0 -- "-$METRO_PID" 2>/dev/null; then
    cat "$OUT/provider.log" "$OUT/metro.log" >&2
    echo 'Provider/Metro exited during setup' >&2; exit 1
  fi
  if curl -fsS http://127.0.0.1:54831/receipt >/dev/null && curl -fsS http://127.0.0.1:8081/status | grep -q 'packager-status:running'; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Provider/Metro setup failed'; exit 1; }
curl -fsS --max-time 180 'http://127.0.0.1:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false' > "$RUNNER_TEMP/signin-dev.js"
grep -q 54831 "$RUNNER_TEMP/signin-dev.js"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
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
set +e
TEST_RUNNER_APP_ID="$APP_ID" xcodebuild -workspace "$WORKSPACE" -scheme SignInAppProof -configuration Debug -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$RUNNER_TEMP/SignInAppDD" -resultBundlePath "$OUT/signin.xcresult" -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -only-testing:SignInAppUITests/SignInAppUITests/testAlreadySignedInFastPathAndServerError "${SIGNING[@]}" test-without-building > "$OUT/test.log" 2>&1
RESULT=$?
set -e
if [[ -d "$OUT/signin.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$OUT/signin.xcresult" --output-path "$OUT/frames"
fi
cat "$OUT/test.log"
exit "$RESULT"
