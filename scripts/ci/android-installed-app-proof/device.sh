#!/bin/bash
# HOSTED INSTALLED-APP PROOF ONLY: one emulator row (android-emulator-runner
# `script:`). Preflight already passed on the downloaded bytes; this installs the
# exact staged APKs, starts the loopback hub as its own process group, re-checks
# identity on the device, then runs every receipt row (run.py).
#
# Usage: bash device.sh <harness-dir> <candidate-root> <staged-dir> <evidence-dir>
set -uo pipefail
HARNESS=$1 ROOT=$2 STAGED=$3 EVIDENCE=$4
mkdir -p "$EVIDENCE"
sh "$HARNESS/../await-emulator-ready.sh"
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
PKG=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["app_package"])' "$STAGED/manifest.json")
DRIVER=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["driver_package"])' "$STAGED/manifest.json")

set -m
(cd "$ROOT" && exec node "$HARNESS/hub.ts" "$ROOT" "$EVIDENCE/api$API-hub-requests.jsonl") > "$EVIDENCE/api$API-hub.log" 2>&1 &
HUB=$!
set +m
cleanup() { kill -- -"$HUB" 2>/dev/null; wait "$HUB" 2>/dev/null; kill -0 "$HUB" 2>/dev/null && echo "hub $HUB still alive"; }
trap cleanup EXIT
for _ in $(seq 1 30); do curl -sf http://127.0.0.1:54832/__proof/ping >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:54832/__proof/ping || { echo '::error::loopback hub did not start'; cat "$EVIDENCE/api$API-hub.log"; exit 1; }

adb install -r -g "$STAGED/app-debug.apk" || exit 1
adb install -r -t "$STAGED/app-debug-androidTest.apk" || exit 1
# On-device identity: the driver resolves the app it targets and the app's
# notification receiver is the decorated one, before any receipt row.
adb shell am instrument -w -r -e mode identity "$DRIVER/com.localoperator.mobile.installedproof.InstalledAppProofRunner" \
  | tee "$EVIDENCE/api$API-identity.txt"
grep -q "\"target\":\"$PKG\"" "$EVIDENCE/api$API-identity.txt" || { echo '::error::driver does not target the app'; exit 1; }
grep -q 'LoNotificationsService' "$EVIDENCE/api$API-identity.txt" || { echo '::error::app receiver is not LoNotificationsService'; exit 1; }

python3 "$HARNESS/run.py" "$STAGED" "$EVIDENCE" "$ROOT"
