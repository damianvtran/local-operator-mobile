#!/usr/bin/env bash
# Prove the checkpoint rail PAINTS on a native surface, and that its `building`
# state is visibly different from `deep`.
#
# WHY A SHELL SCRIPT AND NOT LINES IN THE WORKFLOW: the emulator action parses its
# `script:` input one /usr/bin/sh command per line, with no functions and no
# continuations (the action's own note in e2e.yml records what that cost the last
# time it was ignored). This needs two relay restarts, a background capture loop
# alive across a second `maestro test` invocation, and a manifest the analyser
# reads back; those belong in one reviewable place, exactly as
# `run-maestro-tags.sh` does for the tag world.
#
# WHY TWO INVOCATIONS OF `maestro test` PER SCENARIO: the capture has to know
# whether a frame was taken while a gesture was running. `session-rail-paint.yaml`
# connects and opens the conversation; the capture loop starts; `fling.yaml` does
# the swipes. The frames belong to three phases by the clock the loop reads —
# `pre` (a settled list, no gesture: the rail-down control), `fling`, `post` — and
# a single flow that did both would give the loop no "pre" window at all.
#
# WHY `adb exec-out screencap` AND NOT `maestro takeScreenshot`: Maestro's own
# screenshot step is synchronous with the flow, costs a driver round trip, and
# lives inside the process that is timing the gesture, so its latency is the
# thing under test rather than a measurement. `screencap` runs beside the flow
# from the host and its wall time is recorded per frame — the analyser reports the
# distribution, and the run that produced it is the evidence for whether it can
# land inside the ~1.2 s rail window (`RAIL_LINGER_MS` 1000 + `RAIL_FADE_MS` 200).
# The fallback if it cannot is `adb shell screenrecord` plus frame extraction with
# a decoder that is actually on the runner; this script tests for `ffmpeg` and
# says so in the log, so that proposal is made from evidence rather than assumed.
#
# THE RUNNER ONLY. `date +%s%3N` is GNU coreutils, the frames live in
# `$RUNNER_TEMP`, and adb needs a device — the same contract `run-maestro-tags.sh`
# has. The ARITHMETIC that decides the two claims is `scripts/ci/rail-paint-proof.ts`
# and is tested on a laptop (`rail-paint-proof.test.ts`).
set -euo pipefail

: "${APP_ID:?APP_ID is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SID="${SESSION_ID:-6714def86197}"
PASSWORD_FILE="$RUNNER_TEMP/relay-password"
RELAY_PID_FILE="$RUNNER_TEMP/relay.pid"
OUT_DIR="$RUNNER_TEMP/rail-paint"
FRAMES_JSONL="$OUT_DIR/frames.jsonl"
PHASE_FILE="$OUT_DIR/phase"
RUNNING_FLAG="$OUT_DIR/capturing"

# The harness's own fixture session id, the one the checkpoints scenarios are
# re-addressed to (`tools/mock-relay/scenarios.ts`, `CAPTURED_SESSION`). Defaulted
# here to the same literal e2e.yml passes to the main flow set, so the two cannot
# drift apart silently.
SCENARIOS=(checkpoints-deep checkpoints-building)

# A loop whose only stop is a flag file an error path could leave behind must
# still terminate: at ~0.5 s per capture, 120 frames is ~60 s per scenario against
# a burst that costs ~9 s (1.5 s settle + ~6 s of swipes + 1.5 s settle), and
# 120 × ~0.8 MB at 320×640 RGBA is under 100 MB of runner disk.
MAX_FRAMES_PER_SCENARIO=120

if [[ ! -f "$PASSWORD_FILE" ]]; then
  echo "::error::missing relay password file: $PASSWORD_FILE"
  exit 1
fi

mkdir -p "$OUT_DIR"
: > "$FRAMES_JSONL"

# `maestro test` resolves `--config` and the flow path it is given against the
# working directory, and the emulator action runs this script from the checkout's
# root. Pin that here rather than depending on how the caller invoked it.
cd "$ROOT"

stop_pid() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  kill -9 "$pid" 2>/dev/null || true
}

relay_pid=""
capture_pid=""
cleanup() {
  # The flag first: the capture loop must not outlive this script, and the relay
  # after it, so no orphan answers on this run's port. `$RELAY_PID_FILE` is left
  # in place deliberately — the workflow's `if: always()` stop step reads it and
  # is the last word on the relay even when this script exits non-zero.
  rm -f "$RUNNING_FLAG"
  stop_pid "$capture_pid"
  stop_pid "$relay_pid"
}
trap cleanup EXIT

# A decoder that is not on the runner cannot be a fallback. One line, so the
# record exists in the log for whoever reads this run's numbers next.
if command -v ffmpeg > /dev/null 2>&1; then
  echo "ffmpeg (screenrecord+extract fallback): $(ffmpeg -version | head -1)"
else
  echo "ffmpeg (screenrecord+extract fallback): ABSENT on this runner"
fi

# THE BAND IS DERIVED FROM THE DEVICE, NEVER FROM A DEVICE PROFILE. The AVD is
# whatever the emulator action created; the rail's column is 7–15 pt in, so the
# pixel band depends on the density actually in force. `wm size`/`wm density` can
# print a physical and an override line, and the override is what the app lays out
# against — take the last value printed.
# `tr -d '\r'`: adb shell has handed back CRLF on some device images, and a
# trailing carriage return would fail the all-digits checks below as "could not
# read the geometry" — a wasted dispatch for a whitespace byte.
read_geometry() {
  adb shell wm size | tr -d '\r' | awk -F': ' '/[0-9]+x[0-9]+/ {split($2, wh, "x"); w=wh[1]; h=wh[2]} END {print w" "h}'
}
read_density() {
  adb shell wm density | tr -d '\r' | awk -F': ' '/[0-9]+/ {d=$2} END {print d}'
}

read -r SCREEN_W SCREEN_H <<< "$(read_geometry)"
DENSITY="$(read_density)"
case "${SCREEN_W:-}" in ''|*[!0-9]*) echo "::error::could not read the screen size from the emulator"; exit 1 ;; esac
case "${SCREEN_H:-}" in ''|*[!0-9]*) echo "::error::could not read the screen size from the emulator"; exit 1 ;; esac
case "${DENSITY:-}" in ''|*[!0-9]*) echo "::error::could not read the screen density from the emulator"; exit 1 ;; esac
printf '{"type":"screen","widthPx":%s,"heightPx":%s,"densityDpi":%s}\n' \
  "$SCREEN_W" "$SCREEN_H" "$DENSITY" >> "$FRAMES_JSONL"
echo "device: ${SCREEN_W}x${SCREEN_H} @ ${DENSITY} dpi"

start_relay() {
  local scenario="$1" port_file="$OUT_DIR/$1-relay.port" err_file="$OUT_DIR/$1-relay.err"
  stop_pid "$relay_pid"
  rm -f "$port_file" "$err_file"
  ( cd "$ROOT" && pnpm mock:relay \
      --scenario "$scenario" \
      --password "$(cat "$PASSWORD_FILE")" \
      --allow-android-emulator-origin \
      --print-port --quiet \
      < /dev/null > "$port_file" 2> "$err_file" ) &
  relay_pid=$!
  # The workflow's stop step kills this pid even if this script dies mid-scenario.
  printf '%s\n' "$relay_pid" > "$RELAY_PID_FILE"
  local port=""
  for _ in $(seq 1 60); do
    port=$(head -1 "$port_file" 2>/dev/null || true)
    case "$port" in ''|*[!0-9]*) sleep 0.5 ;; *) break ;; esac
  done
  port=$(head -1 "$port_file" 2>/dev/null || true)
  case "$port" in
    ''|*[!0-9]*)
      echo "::error::the $scenario mock relay never printed a port"
      cat "$err_file" || true
      exit 1
      ;;
  esac
  # The emulator reaches the host's loopback through 10.0.2.2.
  RELAY_URL_FOR_DEVICE="http://10.0.2.2:$port"
  echo "$scenario mock relay: http://127.0.0.1:$port (device $RELAY_URL_FOR_DEVICE)"
}

# The capture loop: one frame per iteration, tagged with the phase that was in
# force when the capture STARTED, and its own wall time. Runs beside the fling
# flow, so a slow `adb` never delays the gesture it is trying to observe — it only
# lowers the frame rate, which is exactly the number the report carries.
capture_loop() {
  local scenario="$1" dir="$2" n=0
  while [[ -f "$RUNNING_FLAG" ]] && (( n < MAX_FRAMES_PER_SCENARIO )); do
    n=$((n + 1))
    local phase start end path
    phase="$(cat "$PHASE_FILE" 2>/dev/null || echo pre)"
    start="$(date +%s%3N)"
    path="$(printf '%s/%04d-%s.png' "$dir" "$n" "$phase")"
    if adb exec-out screencap -p > "$path" 2>/dev/null && [[ -s "$path" ]]; then
      end="$(date +%s%3N)"
      printf '{"type":"frame","state":"%s","phase":"%s","path":"%s","atMs":%s,"captureMs":%s}\n' \
        "$scenario" "$phase" "$path" "$start" "$((end - start))" >> "$FRAMES_JSONL"
    else
      # A capture that produced nothing is not a frame; leaving an empty file in
      # the set would fail the analyser's size check and hide the real count.
      rm -f "$path"
    fi
  done
}

run_flow() {
  local flow="$1"
  maestro test \
    --config e2e/maestro/config.yaml \
    -e APP_ID="$APP_ID" \
    -e RELAY_URL="$RELAY_URL_FOR_DEVICE" \
    -e RELAY_PASSWORD="$(cat "$PASSWORD_FILE")" \
    -e SESSION_ID="$SID" \
    --test-output-dir "$OUT_DIR/maestro" \
    "$flow"
}

for scenario in "${SCENARIOS[@]}"; do
  dir="$OUT_DIR/$scenario"
  mkdir -p "$dir"
  start_relay "$scenario"

  # One retry per invocation, the same policy as the main flow set (ADR 0003): a
  # flake stays visible as a ::warning, a second failure is a failure.
  run_flow e2e/maestro/rail-paint/session-rail-paint.yaml || {
    echo "::warning title=Rail setup flow flaked once::re-running once, per ADR 0003"
    run_flow e2e/maestro/rail-paint/session-rail-paint.yaml
  }

  # A settled list: the setup flow's last gesture is a launch and a tap, and the
  # tail pin is a scroll the app made itself — `transcript-presence.ts` ignores
  # those on purpose, so the rail is down here and these frames are the control.
  echo pre > "$PHASE_FILE"
  touch "$RUNNING_FLAG"
  capture_loop "$scenario" "$dir" &
  capture_pid=$!
  sleep 1.5

  echo fling > "$PHASE_FILE"
  # No retry here, deliberately. A retried gesture burst would put a second,
  # unexplained fling inside the phase window the numbers are read from; if the
  # flow fails the analyser has no rail-up frame and says so, which is an honest
  # failure rather than a laundered one.
  run_flow e2e/maestro/rail-paint/fling.yaml

  # The linger is 1 s; half again past it, so the post frames really are after
  # the rail is gone and the pre/post pair cannot explain away a rail-up frame.
  echo post > "$PHASE_FILE"
  sleep 1.5

  rm -f "$RUNNING_FLAG"
  stop_pid "$capture_pid"
  capture_pid=""
  echo "$scenario: $(grep -c "\"state\":\"$scenario\"" "$FRAMES_JSONL" || true) frames"
done

node "$ROOT/scripts/ci/rail-paint-proof.ts" \
  --frames "$FRAMES_JSONL" \
  --out "$OUT_DIR/report.json"
