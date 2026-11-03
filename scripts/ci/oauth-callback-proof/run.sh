#!/bin/bash
# Hosted-only system-browser proof. Never bootstrap a local SDK/simulator.
set -euo pipefail
[[ "${CI:-}" == true && "${RUNNER_OS:-}" == macOS ]] || { echo 'Hosted macOS CI required'; exit 1; }
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="${RUNNER_TEMP:?}/oauth-callback-proof"
mkdir -p "$OUT/evidence"
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
  # Preserve live progress if the outer job is interrupted during a long mode.
  # This raw teardown snapshot is never promoted to acceptance without run-id validation.
  if [[ -n "${mode:-}" && -n "${CONTAINER:-}" && -f "$CONTAINER/Documents/receipt.json" ]]; then
    cp "$CONTAINER/Documents/receipt.json" "$OUT/evidence/$mode-teardown-native.json" || true
  fi
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
SPEC="$ROOT/scripts/ci/oauth-callback-proof"
XCODEGEN="${XCODEGEN:?The workflow must provide its verified pinned XcodeGen path}"
[[ "$("$XCODEGEN" --version)" == 'Version: 2.46.0' || "$("$XCODEGEN" --version)" == '2.46.0' ]] || { echo 'Unexpected XcodeGen version'; exit 1; }
(cd "$SPEC" && "$XCODEGEN" generate --spec project.yml)
PROJECT="$SPEC/CallbackProof.xcodeproj"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
# Exactly one native build. A setup failure stops before any test is dispatched.
if xcodebuild build-for-testing -project "$PROJECT" -scheme CallbackProof \
  -configuration Debug -destination "id=$UDID" -derivedDataPath "$OUT/dd" \
  -parallel-testing-enabled NO > "$OUT/evidence/build-for-testing.log" 2>&1; then
  cat "$OUT/evidence/build-for-testing.log"
else
  cat "$OUT/evidence/build-for-testing.log"
  exit 1
fi
APP="$OUT/dd/Build/Products/Debug-iphonesimulator/CallbackProof.app"
[[ -f "$APP/CallbackProof" ]] || { echo 'Built fixture app is missing'; exit 1; }
shasum -a 256 "$ROOT/modules/radient-loopback/ios/LoopbackAuthSession.swift" \
  "$SPEC/TCPClosureProbe.swift" "$SPEC/main.swift" "$SPEC/CallbackProofUITests.swift" \
  "$APP/CallbackProof" > "$OUT/evidence/source-and-binary.sha256"
ditto -c -k --keepParent "$APP" "$OUT/evidence/CallbackProof.app.zip"
cp "$ROOT/modules/radient-loopback/ios/LoopbackAuthSession.swift" "$OUT/evidence/LoopbackAuthSession.swift"
cp "$SPEC/TCPClosureProbe.swift" "$SPEC/main.swift" "$SPEC/CallbackProofUITests.swift" "$SPEC/project.yml" "$OUT/evidence/"
xcrun simctl install "$UDID" "$APP"
FAILURES=0
for mode in legacy positive cancel timeout; do
  RUN_ID=$(uuidgen)
  CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  if [[ -f "$CONTAINER/Documents/receipt.json" ]]; then
    mv "$CONTAINER/Documents/receipt.json" "$OUT/evidence/previous-receipt.json"
  fi
  case "$mode" in
    legacy) METHOD=testLegacy ;;
    positive) METHOD=testPositive ;;
    cancel) METHOD=testCancel ;;
    timeout) METHOD=testTimeout ;;
  esac
  DRIVER_EXIT=1
  # At most one STARTUP-ONLY retry. No assertion/test failure is replayed.
  for attempt in 1 2; do
    xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
    RESULT="$OUT/evidence/$mode-attempt$attempt.xcresult"
    LOG="$OUT/evidence/$mode-attempt$attempt.log"
    XCODE_EXIT=0
    if TEST_RUNNER_PROOF_RUN_ID="$RUN_ID" xcodebuild test-without-building \
      -project "$PROJECT" -scheme CallbackProof -configuration Debug \
      -destination "id=$UDID" -derivedDataPath "$OUT/dd" -parallel-testing-enabled NO \
      -only-testing:"CallbackProofUITests/CallbackProofUITests/$METHOD" \
      -resultBundlePath "$RESULT" > "$LOG" 2>&1; then :; else XCODE_EXIT=$?; fi
    DRIVER_EXIT=$XCODE_EXIT
    cat "$LOG"
    RECEIPT_KNOWN=false
    if CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data); then RECEIPT_KNOWN=true; fi
    if [[ "$RECEIPT_KNOWN" == true && -f "$CONTAINER/Documents/receipt.json" ]]; then
      cp "$CONTAINER/Documents/receipt.json" "$OUT/evidence/$mode-attempt$attempt-native.json"
    fi
    REPORT="$OUT/evidence/$mode-attempt$attempt-tests.json"
    REPORT_KNOWN=false
    if xcrun xcresulttool get test-results tests --path "$RESULT" > "$REPORT" 2> "$OUT/evidence/$mode-attempt$attempt-report.log"; then REPORT_KNOWN=true; fi
    if ! xcrun xcresulttool export attachments --path "$RESULT" \
      --output-path "$OUT/evidence/$mode-attempt$attempt-attachments" \
      > "$OUT/evidence/$mode-attempt$attempt-export.log" 2>&1; then
      echo "::warning::Attachment export failed for $mode attempt $attempt; raw xcresult is retained"
      if [[ "$XCODE_EXIT" == 0 ]]; then FAILURES=1; fi
    fi
    if [[ "$XCODE_EXIT" != 0 && "$attempt" == 1 && "$REPORT_KNOWN" == true && "$RECEIPT_KNOWN" == true ]]; then
      # Retry predicate: authoritative not-run AND absent/fresh-ready receipt.
      # Unknown schemas, started test markers, stale identities and any progress fail closed.
      if python3 - "$REPORT" "$CONTAINER/Documents/receipt.json" "$mode" "$RUN_ID" "$LOG" <<'RETRY_PY'
import json, pathlib, re, sys
report_path, receipt_path = map(pathlib.Path, sys.argv[1:3])
mode, run_id = sys.argv[3:5]
log_path = pathlib.Path(sys.argv[5])
try:
    report = json.loads(report_path.read_text())
    log = log_path.read_text()
except (OSError, ValueError):
    sys.exit(1)

def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)

known_report = isinstance(report, dict) and isinstance(report.get('testNodes'), list)
cases = [node for node in walk(report) if str(node.get('nodeType', '')).lower().replace(' ', '').startswith('testcase')]
not_run_results = {'not run', 'not executed'}
# Nonempty but unrecognized trees are not evidence that no test ran.
case_not_run = (all(str(case.get('result', '')).lower() in not_run_results for case in cases)
                if cases else known_report and not report['testNodes'])
started_marker = 'PROOF_TEST_STARTED' in log or re.search(r"Test Case .* started[.]", log) is not None
test_never_ran = known_report and case_not_run and not started_marker
receipt_ready = not receipt_path.exists()
if receipt_path.exists():
    try:
        native = json.loads(receipt_path.read_text())
        receipt_ready = (native.get('mode') == mode and native.get('run_id') == run_id and
                         native.get('stage') == 'ready' and native.get('started') is False)
    except (OSError, ValueError):
        receipt_ready = False
allowed = test_never_ran and receipt_ready
print(json.dumps({'mode': mode, 'test_never_ran': test_never_ran, 'receipt_ready': receipt_ready, 'retry_allowed': allowed}))
sys.exit(0 if allowed else 1)
RETRY_PY
      then
        echo "::warning::Retrying $mode after startup-only attempt $attempt: target test never ran and native receipt is absent/fresh-ready"
        continue
      fi
    fi
    break
  done
  # Keep each attempt, raw result bundle and final frame even when assertions fail.
  if [[ -n "$CONTAINER" && -f "$CONTAINER/Documents/receipt.json" ]]; then
    cp "$CONTAINER/Documents/receipt.json" "$OUT/evidence/$mode-native.json"
  fi
  if ! xcrun simctl io "$UDID" screenshot "$OUT/evidence/$mode-final.png"; then FAILURES=1; fi
  if python3 - "$OUT/evidence" "$mode" "$DRIVER_EXIT" "$RUN_ID" <<'PY'
import json, pathlib, sys
out, mode, driver_exit, run_id = pathlib.Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
path = out / (mode + '-native.json')
try:
    native = json.loads(path.read_text()) if path.exists() else {'pass': None, 'detail': 'missing-native-receipt'}
except (OSError, ValueError):
    native = {'pass': None, 'detail': 'unreadable-native-receipt'}
fresh = native.get('mode') == mode and native.get('run_id') == run_id
receipt = {'mode': mode, 'pass': driver_exit == 0 and fresh and native.get('pass') is True,
           'driver_exit': driver_exit, 'native_receipt_fresh': fresh, 'native': native}
(out / (mode + '.json')).write_text(json.dumps(receipt, indent=2, sort_keys=True))
print(json.dumps(receipt, sort_keys=True))
# Driver/fixture failures are retained separately, not called product regressions.
sys.exit(0 if receipt['pass'] else 1)
PY
  then :; else FAILURES=1; fi
done
exit "$FAILURES"
