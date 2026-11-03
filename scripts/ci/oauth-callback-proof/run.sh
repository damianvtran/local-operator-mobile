#!/bin/bash
# Hosted-only system-browser proof. Never bootstrap a local SDK/simulator.
set -euo pipefail
[[ "${CI:-}" == true && "${RUNNER_OS:-}" == macOS ]] || { echo 'Hosted macOS CI required'; exit 1; }
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="${RUNNER_TEMP:?}/oauth-callback-proof"
mkdir -p "$OUT/CallbackProof.app" "$OUT/evidence"
APP="$OUT/CallbackProof.app"
BUNDLE=dev.localoperator.oauthproof
read -r DEVICE RUNTIME < <(xcrun simctl list devices available --json | python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    if ".iOS-" not in runtime: continue
    for device in devices:
        if device["name"].startswith("iPhone") and device.get("deviceTypeIdentifier"):
            print(device["deviceTypeIdentifier"], runtime)
            raise SystemExit(0)
raise SystemExit("No installed iPhone simulator runtime")
')
UDID=$(xcrun simctl create 'OAuth callback proof' "$DEVICE" "$RUNTIME")
cleanup() {
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
ARCH=$(uname -m)
xcrun swiftc -sdk "$SDK" -target "${ARCH}-apple-ios16.4-simulator" \
  "$ROOT/modules/radient-loopback/ios/LoopbackAuthSession.swift" \
  "$ROOT/scripts/ci/oauth-callback-proof/main.swift" \
  -o "$APP/CallbackProof" -framework UIKit -framework AuthenticationServices -framework Network
cat > "$APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.localoperator.oauthproof</string>
<key>CFBundleExecutable</key><string>CallbackProof</string>
<key>CFBundleName</key><string>Callback Proof</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>UILaunchScreen</key><dict/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
shasum -a 256 "$ROOT/modules/radient-loopback/ios/LoopbackAuthSession.swift" "$APP/CallbackProof" > "$OUT/evidence/source-and-binary.sha256"
# Retain the actual signed simulator app, not merely a hash of a missing binary.
ditto -c -k --keepParent "$APP" "$OUT/evidence/CallbackProof.app.zip"
cp "$ROOT/modules/radient-loopback/ios/LoopbackAuthSession.swift" "$OUT/evidence/LoopbackAuthSession.swift"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
# Every mode owns an idle Ready screen until the already-running UI driver taps
# Start. No OAuth deadline may include Maestro's first cold startup.
FAILURES=0
for mode in legacy positive cancel timeout; do
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  if [[ -f "$CONTAINER/Documents/receipt.json" ]]; then
    mv "$CONTAINER/Documents/receipt.json" "$OUT/evidence/previous-receipt.json"
  fi
  LAUNCHED=true
  if ! SIMCTL_CHILD_PROOF_MODE="$mode" xcrun simctl launch "$UDID" "$BUNDLE"; then
    echo "Fixture launch failed: $mode"
    LAUNCHED=false
    FAILURES=1
  fi
  title='Complete test sign-in'
  limit=90000
  if [[ "$mode" == cancel || "$mode" == timeout ]]; then title='Synthetic callback waiting'; fi
  # Timeout exercises the production five-minute deadline unchanged. UI-driver
  # cold start remains outside it; this wait merely observes that real deadline.
  if [[ "$mode" == timeout ]]; then limit=360000; fi
  # Maestro resolves these screenshot basenames under the --test-output-dir
  # supplied below. Absolute siblings under evidence/ fail its path sandbox.
  # The recursive artifact upload retains that per-mode tree even on failure.
  cat > "$OUT/flow-$mode.yaml" <<YAML
appId: $BUNDLE
---
- extendedWaitUntil:
    visible: 'Ready $mode'
    timeout: 60000
- tapOn:
    id: proof.start
- extendedWaitUntil:
    visible: 'Continue|$title'
    timeout: 60000
- runFlow:
    when:
      visible: Continue
    commands:
      - tapOn: Continue
- extendedWaitUntil:
    visible: '$title'
    timeout: 60000
- takeScreenshot: '$mode-browser-ready'
YAML
  if [[ "$mode" == legacy || "$mode" == positive ]]; then
    cat >> "$OUT/flow-$mode.yaml" <<YAML
- tapOn: 'Complete test sign-in'
YAML
  fi
  if [[ "$mode" == legacy ]]; then
    cat >> "$OUT/flow-$mode.yaml" <<YAML
- extendedWaitUntil:
    visible: "(?i).*(connect|cannot open|can.t open).*"
    timeout: 10000
- takeScreenshot: 'legacy-browser'
YAML
  fi
  if [[ "$mode" == cancel ]]; then
    cat >> "$OUT/flow-$mode.yaml" <<YAML
- tapOn: Cancel
YAML
  fi
  cat >> "$OUT/flow-$mode.yaml" <<YAML
- extendedWaitUntil:
    visible: 'PASS $mode|FAIL $mode.*'
    timeout: $limit
- assertVisible: 'PASS $mode'
- takeScreenshot: '$mode-returned'
YAML
  DRIVER_EXIT=0
  if [[ "$LAUNCHED" == false ]]; then
    DRIVER_EXIT=1
    echo "Fixture launch failed before UI-driver interaction" > "$OUT/evidence/$mode-driver.log"
  elif maestro --device "$UDID" test --test-output-dir "$OUT/evidence/driver-$mode" "$OUT/flow-$mode.yaml" > "$OUT/evidence/$mode-driver.log" 2>&1; then
    cat "$OUT/evidence/$mode-driver.log"
  else
    DRIVER_EXIT=$?
    cat "$OUT/evidence/$mode-driver.log"
  fi
  # Capture BEFORE validation/teardown even when the driver or native case fails.
  # A failed legacy fixture must never suppress positive/cancel/timeout cases.
  if [[ -f "$CONTAINER/Documents/receipt.json" ]]; then
    cp "$CONTAINER/Documents/receipt.json" "$OUT/evidence/$mode-native.json"
  fi
  if ! xcrun simctl io "$UDID" screenshot "$OUT/evidence/$mode-final.png"; then FAILURES=1; fi
  if python3 - "$OUT/evidence" "$mode" "$DRIVER_EXIT" <<'PY'
import json, pathlib, sys
out, mode, driver_exit = pathlib.Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
path = out / (mode + '-native.json')
try:
    native = json.loads(path.read_text()) if path.exists() else {'pass': None, 'detail': 'missing-native-receipt'}
except (OSError, ValueError):
    native = {'pass': None, 'detail': 'unreadable-native-receipt'}
receipt = {'mode': mode, 'pass': driver_exit == 0 and native.get('pass') is True,
           'driver_exit': driver_exit, 'native': native}
(out / (mode + '.json')).write_text(json.dumps(receipt, indent=2, sort_keys=True))
print(json.dumps(receipt, sort_keys=True))
# Driver/fixture failures are retained separately, not called product regressions.
sys.exit(0 if receipt['pass'] else 1)
PY
  then :; else FAILURES=1; fi
done
exit "$FAILURES"
