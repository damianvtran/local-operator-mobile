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
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
for mode in legacy positive cancel timeout; do
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  # Remove only this synthetic proof app's previous receipt, not any user data.
  if [[ -f "$CONTAINER/Documents/receipt.json" ]]; then mv "$CONTAINER/Documents/receipt.json" "$OUT/evidence/previous-receipt.json"; fi
  SIMCTL_CHILD_PROOF_MODE="$mode" xcrun simctl launch "$UDID" "$BUNDLE"
  cat > "$OUT/flow.yaml" <<YAML
appId: $BUNDLE
---
- tapOn:
    text: Continue
    optional: true
- extendedWaitUntil:
    visible: 'PASS $mode'
    timeout: 60000
YAML
  if [[ "$mode" == legacy ]]; then
    # Consent is dismissed by Maestro; capture the actual failing Safari navigation
    # before the harness's deliberate 30-second negative-control cancellation.
    cat > "$OUT/consent.yaml" <<YAML
appId: $BUNDLE
---
- tapOn:
    text: Continue
    optional: true
YAML
    maestro --device "$UDID" test "$OUT/consent.yaml"
    sleep 2
    xcrun simctl io "$UDID" screenshot "$OUT/evidence/legacy-browser.png"
  fi
  maestro --device "$UDID" test "$OUT/flow.yaml"
  cp "$CONTAINER/Documents/receipt.json" "$OUT/evidence/$mode.json"
  python3 - "$OUT/evidence/$mode.json" <<'PY'
import json, sys
receipt = json.load(open(sys.argv[1]))
print(json.dumps(receipt, sort_keys=True))
assert receipt['pass'] is True, receipt
PY
  xcrun simctl io "$UDID" screenshot "$OUT/evidence/$mode.png"
done
