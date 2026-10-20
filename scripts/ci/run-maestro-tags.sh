#!/usr/bin/env bash
# Run the tag-specific Maestro flow against its own mock world.
#
# WHY THIS IS A SCRIPT RATHER THAN LINES IN THE WORKFLOW: the Android emulator
# action parses its `script:` input one command per line, with no shell
# functions or continuations. Restarting the mock relay on a second scenario
# needs a bound, a readiness loop and an at-most-once retry; those belong in one
# reviewable place, and the workflow's main flow invocation stays the same.
#
# It runs AFTER the normal flow set, on the same emulator and installed APK, so
# the tag flow gets a real build without a second emulator job. The relay is
# started with `--scenario tags-cap`: nine categories, eight already assigned to
# `tag-cap-row`, so the ninth press exercises the relay's 8-tag refusal.
set -euo pipefail

: "${APP_ID:?APP_ID is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASSWORD_FILE="$RUNNER_TEMP/relay-password"
PORT_FILE="$RUNNER_TEMP/tags-relay.port"
ERR_FILE="$RUNNER_TEMP/tags-relay.err"
PID_FILE="$RUNNER_TEMP/relay.pid"

if [[ ! -f "$PASSWORD_FILE" ]]; then
  echo "::error::missing relay password file: $PASSWORD_FILE"
  exit 1
fi

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

# The normal flow set's relay is no longer needed. Stop it before the tag world
# starts so two relays cannot answer on one run's ports.
if [[ -f "$PID_FILE" ]]; then
  stop_pid "$(cat "$PID_FILE" 2>/dev/null || true)"
  rm -f "$PID_FILE"
fi

cd "$ROOT"
pnpm mock:relay \
  --scenario tags-cap \
  --password "$(cat "$PASSWORD_FILE")" \
  --allow-android-emulator-origin \
  --print-port --quiet \
  < /dev/null > "$PORT_FILE" 2> "$ERR_FILE" &
TAG_PID=$!
echo "$TAG_PID" > "$PID_FILE"

cleanup() {
  stop_pid "$TAG_PID"
  rm -f "$PID_FILE" "$PORT_FILE" "$ERR_FILE"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  port=$(head -1 "$PORT_FILE" 2>/dev/null || true)
  case "$port" in
    ''|*[!0-9]*) sleep 0.5 ;;
    *) break ;;
  esac
done
port=$(head -1 "$PORT_FILE" 2>/dev/null || true)
case "$port" in
  ''|*[!0-9]*)
    echo "::error::the tags mock relay never printed a port"
    cat "$ERR_FILE" || true
    exit 1
    ;;
esac

TAG_RELAY_URL_FOR_DEVICE="http://10.0.2.2:$port"
echo "tags mock relay: http://127.0.0.1:$port (device $TAG_RELAY_URL_FOR_DEVICE)"

run_tags() {
  maestro test \
    --config e2e/maestro/config.yaml \
    -e APP_ID="$APP_ID" \
    -e RELAY_URL="$TAG_RELAY_URL_FOR_DEVICE" \
    -e RELAY_PASSWORD="$(cat "$PASSWORD_FILE")" \
    --test-output-dir "$RUNNER_TEMP/maestro-tags-screenshots" \
    e2e/maestro/tags/session-tags.yaml
}

# One retry, the same policy as the main flow set: a flake stays visible, a
# second failure is a failure.
run_tags || {
  echo "::warning title=Tag Maestro flow flaked once::re-running once, per ADR 0003"
  run_tags
}
