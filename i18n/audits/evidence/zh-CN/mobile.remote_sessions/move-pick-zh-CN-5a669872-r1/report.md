# Independent zh-CN audit — seven move-picker keys

**Verdict: PASS** — mobile.remote_sessions, seven specified move_pick keys only; **7 keys read, 0 findings, 0 unresolved blocker/major**. Entire namespace coverage is not claimed.

Auditor session `5a669872c784`; translator `54921291584e` (independent). Actual served audit model **openai/gpt-6.1-sol**, temporary fallback after visible quota model-switch receipt from anthropic/claude-opus-5-5. Translator model is attributed to its draft/notes, not independently observed.

Frozen source `9362cce8a631791b676b2d2c9eda90c43fc7e11c`; draft SHA-256 `a98004322415178b983e8a2f86349086dd56465d1958afc818383746b854d476`; brief SHA-256 `5a72dfd72dc820b1fa8e73d78b97807581572334ee0fd25eb2eab346e759ebca`. All verified in this execution.

## Per-key side-by-side assessment

### mobile.remote_sessions.move_pick.cannot_reach — PASS
- English: Can't reach {device}
- Current zh-CN: 无法连接{device}
- Reason: 无法连接 is the established reachability term in existing unreachable copy. The remote computer is named by exactly one {device}, with no localization of its arbitrary value. Calm concise status, not a phone error.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 20, zh-CN 16; not rendered measurement.

### mobile.remote_sessions.move_pick.destination_heading — PASS
- English: Move or copy to
- Current zh-CN: 移动或复制到
- Reason: 移动或复制到 is an idiomatic destination heading: both operations retained, 到 introduces choices, not an execution claim. 移动/复制 match existing row_long_press_hint. No final punctuation.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 15, zh-CN 12; not rendered measurement.

### mobile.remote_sessions.move_pick.discovery_help — PASS
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Current zh-CN: 本应用仅列出会话列表中可见的设备。没有可见会话的设备暂时无法选择。在另一台电脑上打开Local Operator，再下拉会话列表刷新。
- Reason: Accurately restricts offered devices to those visible through the session list; 没有可见会话 and 暂时 retain the eligibility limitation and yet. Instructions remain ordered: open Local Operator on the other computer, then pull down the session list to refresh. 会话/设备/电脑 match the glossary. No gratuitous 请; product spelling and lack of CJK/Latin padding match the style guide.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 178, zh-CN 120; not rendered measurement.

### mobile.remote_sessions.move_pick.no_answer — PASS
- English: It did not answer when this computer asked.
- Current zh-CN: 此电脑发出请求后，远程电脑未响应。
- Reason: 此电脑发出请求后，远程电脑未响应。 naturally makes the two computers explicit: connected relay requests, remote computer fails to answer, not the phone. 请求 is the lexical noun request, not politeness 请. Source lines 484–485 make this client fallback only when trimmed opaque server reason is absent.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 43, zh-CN 34; not rendered measurement.

### mobile.remote_sessions.move_pick.no_devices — PASS
- English: No other devices are visible.
- Current zh-CN: 当前没有其他可见设备。
- Reason: 当前没有其他可见设备。 preserves other and visible without claiming offline devices or network absence. 当前 supplies natural present-state context. It is a complete factual sentence (context explicitly calls for one), so 。 is acceptable under the full-sentence exception, not a short-label punctuation defect.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 29, zh-CN 22; not rendered measurement.

### mobile.remote_sessions.move_pick.on_this_computer — PASS
- English: On this computer
- Current zh-CN: 在此电脑上
- Reason: 在此电脑上 naturally identifies the connected computer, matching existing 此电脑 usage and sidebar 在{device}上. No 手机 substitution, duplicate remote-location key or final punctuation.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 16, zh-CN 10; not rendered measurement.

### mobile.remote_sessions.move_pick.right_now — PASS
- English: Right now
- Current zh-CN: 当前
- Reason: 当前 is the natural terse current-state section label, unlike an imperative such as 立即. Appropriate heading register, no punctuation or arguments.
- Findings: none; severity/proposed change: N/A.
- Estimated cells: EN 9, zh-CN 4; not rendered measurement.

## Integrity, width and register
- Exactly seven keys; {device} appears once in cannot_reach, other six no arguments. Dropped/renamed/duplicated/nested/select negative controls failed closed. No plural/date/number/markup syntax; CLDR plural N/A (Chinese other-only).
- Local Operator remains byte-identical. No injected bidi controls or redaction markers in bounded copy inputs. One raw translator verification hit is its marker-pattern literal, not copy. Arbitrary device names checked through five synthetic literal substitutions, not runtime rendering.
- Initial naive register scan flagged 请 inside 请求 (request). Inspected actual sentence and source; this is not added politeness. Corrected lexical scan passes; initial failure remains in audit.log. Existing unrelated 请 usage is outside scope.
- Cells include CJK/full-width punctuation as two, not merely codepoints. Every target estimate is shorter than English (ratios 0.4444–0.8); no material expansion finding. Device names remain unbounded; native wrapping/fit unverified. No pseudoexpansion executed or fit claimed.

## Risks and boundaries
- **Source-hook evidence gap remains OPEN**, separately reported by delegator; this audit neither executes nor fixes it. Linguistic PASS is not delivery authorization.
- Frozen private checkpoint has seven English keys but existing zh-CN catalogue does not yet contain them; this report audits the supplied draft, not installed/generated translation coverage.
- Human-native-speaker review waived. No rendered/native/browser, tests, build, hook, installation, commit or push performed. No repository edits. Full UI fit, live language switching and runtime bidi remain unverified.

## Read route
Ordinary explicitly approved exact worktree/scratch reads via functions.read and Python pathlib/json; git rev-parse/ls-files read-only. Nested context read directly, not a routable public-copy key. No read_public_copy invocation or public/keyed-reader receipt claimed. No tracked mobile style/glossary found by git ls-files; core zh-CN style/glossary used as shared reference and cross-checked with actual mobile catalogues. No repository writes.

## Namespace and overall verdict
mobile.remote_sessions (specified seven-key slice): **PASS**, 7/7 read. Overall for this assignment: **PASS**, no findings or translator remediation required. Separate process gap stays OPEN.
