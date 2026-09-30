# Relay fixtures

Real and synthetic wire samples for the native client's tests. Every file here
is either **captured from a running relay** (live) or **constructed from the type
definitions** (synthetic) — and **every file says which in its own top-level
`provenance` object**, so a sample that is vendored or renamed on its own still
carries its origin:

```json
"provenance": {
  "kind": "live",            // or "synthetic"
  "relay_ref": "local-operator 52c1df35",
  "captured_at": "2026-09-29", // live only
  "how": "..."                 // live: how it was captured; synthetic: how it was built
}
```

The `provenance` field is the authority. The directory a file sits in and the
index below are conveniences; **if the two ever disagree, the field wins** — a
hand-built sample mistaken for a captured one is how a test starts asserting the
wrong wire.

Read [`../../docs/relay/contract.md`](../../docs/relay/contract.md) for what each
sample means; this file is only about provenance and reproduction.

The tree is currently **96 fixtures — 92 live, 4 synthetic** — plus this README.

## Provenance

The live samples were captured on 2026-09-29 from an **isolated** `lop mobile`
daemon running local-operator `origin/main` @ `52c1df35`:

- an isolated root (`HOME` and `LOCAL_OPERATOR_CONFIG_DIR` both redirected to a
  fresh directory, per the isolation rules in local-operator's `AGENTS.md`),
- its own ephemeral port — **never the operator's 4098** — with every `CMUX_*`
  and inherited `LOP_*` variable stripped,
- `LOP_MOBILE_PASSWORD` read from a `0600` file in that root and never echoed,
- `values: {hosting: test, model_name: mock}` so a real `Session` runs a real
  agent loop over a deterministic provider (`local_operator/providers/clients.py`
  `MockClient` — `[tool]`, `[bash:N]` and `[refuse]` in the last user message
  trigger a tool call, a real `bash` sleep, or a refusal). No provider
  credentials were used and no network was reached.
- the daemon was stopped by pid and the root deleted afterwards; the operator's
  live daemon, tunnel connector and sessions were never touched.

Redaction applied to every live file: the isolated home path is shown as `~`, the
portal password appears nowhere (the `Set-Cookie` value is replaced with a
placeholder), and no personal hostnames, account ids or tokens are present. The
cookie header in `login-success.json` was rewritten by hand to
`lop_mobile=<expiry>.<hmac-sha256-hex>`.

### Reproducing the live capture

```sh
ISO=$(mktemp -d "$LOCAL_OPERATOR_SCRATCHPAD/iso.XXXX")
mkdir -p "$ISO/.local-operator"; chmod 700 "$ISO"
printf 'values:\n  hosting: test\n  model_name: mock\n  tool_approval_mode: ask\n' \
  > "$ISO/.local-operator/config.yml"
umask 077
python -c 'import secrets;print(secrets.token_urlsafe(24),end="")' > "$ISO/pw"
PORT=$(python -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')

env -i HOME="$ISO" LOCAL_OPERATOR_CONFIG_DIR="$ISO/.local-operator" \
    PATH="$PATH" TERM=xterm-256color \
    LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_DESKTOP_LAUNCH=1 \
    LOP_MOBILE_PASSWORD="$(cat "$ISO/pw")" \
    <local-operator>/.venv/bin/python -m local_operator.mobile.service --port "$PORT" &

curl -s "http://127.0.0.1:$PORT/healthz"
curl -s -c jar -d "password=$(cat "$ISO/pw")" "http://127.0.0.1:$PORT/login"   # 303 + Set-Cookie
curl -s -b jar "http://127.0.0.1:$PORT/api/sessions"
```

`tool_approval_mode: ask` is what makes an approval gate appear without
inventing anything; `hosting: test` is what makes turns deterministic.
`POST /api/sessions` (start) then `POST /api/sessions/{id}/command` with
`{"op":"prompt","command_id":"<uuid4>","text":"run it [bash:20]"}` reproduces the
pending-approval frame.

## Index

### HTTP responses (`http/`)

| File | Route | Status | Notes |
| --- | --- | --- | --- |
| `healthz.json` | `GET /healthz` | 200 | unauthenticated; carries `version: 5` |
| `unauth-api-sessions.json` | `GET /api/sessions` | 401 | the API auth failure |
| `unauth-index.json` | `GET /` | 303 | the HTML redirect to `/login` |
| `login-wrong-password.json` | `POST /login` | 401 | **HTML**, not JSON |
| `login-cross-origin.json` | `POST /login` | 403 | foreign `Origin` |
| `login-success.json` | `POST /login` | 303 | cookie value placeholder |
| `logout.json` | `GET /logout` | 303 | cookie cleared + `Clear-Site-Data: "storage"` |
| `mutation-cross-origin.json` | `POST /api/sessions/start` | 403 | the same-origin rule |
| `sessions-empty.json` | `GET /api/sessions` | 200 | empty list, `capabilities` |
| `commands.json` | `GET /api/commands` | 200 | the slash list |
| `models.json` | `GET /api/models` | 200 | `[]` on a relay with no credentials |
| `directories.json` | `GET /api/directories` | 200 | home / recent / tmp |
| `past-empty.json`, `past-with-rows.json` | `GET /api/sessions/past` | 200 | with and without rows |
| `search-empty.json`, `search-hit.json` | `GET /api/sessions/search?q=` | 200 | `body_match` |
| `start-session.json`, `start-session-2.json` | `POST /api/sessions/start` | 200 | `{ok, pid, session_id}` |
| `start-bad-cwd.json` | `POST /api/sessions/start` | 400 | cwd outside home/tmp |
| `resume-unknown.json`, `resume-no-id.json` | `POST /api/sessions/resume` | 404 / 400 | |
| `history-ok.json`, `history-unknown.json`, `history-bad-limit.json` | `GET /api/sessions/{id}/history` | 200 / 404 / 200 | the bad-limit case silently falls back to 80 |
| `image-ok.json`, `image-bad-index.json`, `image-missing-entry-param.json`, `image-unknown-entry.json` | `GET /api/sessions/{id}/image` | 200 / 404 / 400 / 404 | the 200 body records size + mime instead of the bytes |
| `seen-real-token.json`, `seen-missing-token.json`, `seen-unknown-session.json` | `POST /api/sessions/{id}/seen` | 200 / 422 / 404 | |
| `pin-true.json`, `pin-not-bool.json`, `pin-unknown.json` | `POST /api/sessions/{id}/pin` | 200 / 422 / 404 | read-back semantics |
| `subagent-unknown.json`, `subagent-history-unknown.json` | `…/agents/{job}` | 404 | |
| `command-prompt-ok.json`, `command-prompt-duplicate.json`, `command-prompt-tool.json`, `command-prompt-image.json`, `command-steer-queued.json`, `command-abort.json`, `command-no-origin-post.json` | `POST /api/sessions/{id}/command` | 200 | the receipt ladder |
| `command-prompt-wake-durable.json` | `POST …/command` on a reaped conversation | 200 | the wake path |
| `command-unknown-op.json`, `command-bad-json.json`, `command-body-not-object.json`, `command-invalid-op-missing.json`, `command-invalid-uuid.json`, `command-missing-command-id.json`, `command-approval-bad-shape.json`, `command-unknown-session.json` | `POST …/command` | 422 / 400 / 409 | the validation surface |
| `op-ping.json`, `op-snapshot.json`, `op-set-effort-rung.json`, `op-slash-help.json`, `op-slash-result-goal.json`, `op-recall-steer-unknown.json`, `op-new-conversation.json`, `op-resume-session.json`, `op-cancel.json`, `op-prompt-empty-text-with-image.json`, `op-prompt-images-not-list.json`, `op-steer-bad-input-mode.json` | `POST …/command` | 200 / 422 | one file per op, including the two refused ops |
| `operator-challenge-bad-action.json`, `operator-challenge-unknown-session.json` | `POST …/operator/challenge` | 422 / 409 | |
| `pair-no-code.json`, `pair-bad-spki.json`, `pair-status-unknown-device.json`, `pair-status-bad-id.json` | `POST /api/pair`, `GET /api/pair/{id}` | 403 / 200 | |
| `transcribe-missing-audio.json`, `transcribe-bad-mime.json`, `transcribe-413-declared.json` | `POST /api/transcribe` | 422 / 413 | the 413 was produced by declaring a 30 MB `Content-Length` on a raw socket |
| `projects-empty.json` | `GET /api/projects` | 200 | |
| `mark-png.json` | `HEAD /mark.png` | 200 | the brand asset, deliberately unauthenticated |
| `command-set-effort-bad.json`, `command-set-model-unknown.json`, `command-slash-unknown.json` | `POST …/command` | 422 / 200 / 422 | three refusals a model sheet and a slash sheet must render |
| `prompt-image-2.json`, `prompt-image-3.json` | `POST …/command` (`prompt` with one image) | 200 | the second was sent with a payload that could not be decoded, and the relay **still answered `200 prompt admitted`** while dropping the attachment — the evidence behind the contract's “image ingest is best-effort and silent” note |
| `list-after-wake.json` | `GET /api/sessions` | 200 | a row that left `previous` and returned to `active` |

### SSE frames (`sse/`)

| File | Event | Notes |
| --- | --- | --- |
| `sse-list-frame.json` | `sessions` | a full list frame including `capabilities` and a row with `pending_kind: "approval"` |
| `sse-projection-seed.json` | `projection` | the frame a stream opens with (session start; empty transcript) |
| `sse-projection-live-idle.json` | `projection` | live runtime, idle, after a completed turn |
| `sse-projection-pending-approval.json` | `projection` | a real approval gate with a running `bash` tool row |
| `sse-projection-queued-steer.json` | `projection` | `queued_count: 1`, a `steer` row, and the tool skipped by steering |
| `sse-projection-durable-after-death.json` | `projection` | the final frame after the runtime was SIGKILLed: `pid: 0`, `ended: false` — see the contract's §6.5 warning |
| `sse-attention-complete.json` | — | the `attention` object of a completed turn |
| `sse-keepalive.json` | — | the literal keep-alive bytes in its `literal` field (`": keepalive\n\n"`), kept as a string so the sample stays byte-exact while still carrying a provenance marker |

### Gateway constants (`gateway/`)

| File | Notes |
| --- | --- |
| `gateway-refusal-constants.json` | `RELAY_DETAIL`, `TERMINAL_DETAIL`, `TERMINAL_REMEDY`, `MAX_BODY_BYTES`, `MAX_STREAM_SECONDS`, `DEFERRAL_WINDOW_S` and `PROOF_HEADER`, **dumped from the module** rather than transcribed, so the app's copy and the gateway's cannot drift silently |

### Probes (`probes/`)

| File | Notes |
| --- | --- |
| `wedged-row-signal.json` | A 75-second poll of `GET /api/sessions` while the session runtime's process was frozen with `SIGSTOP`: the row's `subagents_running` goes `0` → `null` at the 45-second heartbeat timeout while `section` stays `active`. The measurement behind the contract's §6.5 rule that a stalled conversation is detected by a *field change*, not by a `degraded` flag |

### Synthetic (`synthetic/`)

Marked synthetic because producing them live needs a real model (subagents, asks,
reasoning) or a Radient tunnel. Each was built from the field definitions in
`local_operator/mobile/types.py` and cross-checked against the web client's own
test fixtures (`local_operator/mobile/web/src/*.test.tsx`) for shape.

| File | What it covers |
| --- | --- |
| `sse-projection-every-entry-kind.json` | one row of **every** `EntryKind` (user, reasoning, assistant, tool in all six `ToolState`s, steer, peer_message, notice in all three severities plus a wake, compaction, parent_message, subagent_message), a two-phase todo list with a blocked item, and a six-status subagent roster (running, queued, parked, completed, failed, cancelled) |
| `sse-projection-pending-ask.json` | a secret ask with options, a recommended index, and `question_index: 0` of `question_total: 2` |
| `sse-projection-pending-approval-example.json` | an approval whose detail is a destructive command, with the tool row still `composing` |
| `models.ranked.json` | a realistic ranked `/api/models` payload, wrapped as `{"provenance": …, "models": [...]}` (the array order **is** the ranking — a client must not re-sort it) |

## Using these in tests

- The HTTP files are whole-response records:
  `{provenance, request: {method, path}, status, headers: {...}, body: <parsed>}`.
  Only a subset of headers is kept (the ones a client must act on).
- The SSE files are `{provenance, event, data}`; `sse-keepalive.json` carries its
  payload as the `literal` string, and `synthetic/models.ranked.json` as the
  `models` array. Feed that payload through the parser under test — never through
  a second hand-written encoder, or the test stops testing the wire.
- **Check `provenance.kind` in the test, not the path.** A suite that reads a
  fixture by name after a rename is the case this field exists for.
- `version` values in the frames are the real epoch counter from the captured
  runs, so they are **not** a monotonic sequence across files; a test that needs
  ordering should renumber them.
