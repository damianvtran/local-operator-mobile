# libc-zh-CN-r2 - mobile.library (zh-CN) - DELTA audit of libc-zh-CN-r1

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys rendered. Delta of `libc-zh-CN-r1` (round-1 verdict: changes_requested, 1 unresolved BLOCKER/MAJOR). Auditor: i18n-auditor, session c1967ad9dd38, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text (AS SHIPPED NOW): `src/i18n/catalogues/zh-CN/mobile.library.json` sha256 `e3eba79dfdceed60545ea9e0f8a401c41c759de6e50abc4b2fea9fa216930579`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. Round-1 bundle recorded `27a055806e3d3f87e57bc2bdadeac3a39827cf317045d9a0ec97f2af9e6c3b61` - it does NOT attest the shipped bytes; this bundle does. The target was hashed at the start and as the last command of the scripted run in audit.log - unchanged.

## Why this bundle exists
Review round 1 (R1-1): the findings of `libc-zh-CN-r1` were applied after that bundle was written, so its recorded hash no longer matches the file as it ships. This delta attests the current bytes and verifies each applied change against the finding that asked for it.

## Keys changed since round 1 (derived, not asserted)
- `mobile.library.detail.no_source`: «此资源没有记录来源会话。» → «此资源没有记录来源对话。» (round-1 finding libc-zh-CN-r1-1, MAJOR) - byte-exact: True

Proof the list is complete and exact: `tools/delta.py` reverts exactly these keys to the round-1 text inside the shipped raw bytes and hashes the result; it equals the sha256 recorded by `libc-zh-CN-r1` (audit.log: "== recorded round-1 sha256 : True"). No other byte of the file differs from what round 1 judged.

## Judgment of the changed text
- `detail.no_source` «此资源没有记录来源对话。» — GATING ITEM, CLOSED. Checked against (a) its sibling button `action.open_chat` «打开对话» (library-detail.tsx:317, same screen), (b) the «出现于» list it sits under (library-detail.tsx:349-353, which lists conversation titles via `occurrence.session_title`), (c) the mobile zh catalogue's two-word split: 对话 = conversation (home.options.*, notifications.detail.*, schedules.*, session.conversation_details «对话详情») vs 会话 = session (projects.sessions.count, session_health.*, projects.session_state.filed_by). English «source conversation» is a conversation → 对话; the old 会话 pointed at a different object than the button beside it. The only remaining 会话 in the zh mobile catalogue are genuine "session" strings in projects/session_health (and the established home.tip.search «重新打开会话», a session reopen) — none in mobile.library.
- Sentence still ends with 。 and carries no ASCII punctuation (checks.py).

## What was checked (audit.log)
- `generate.ts --check` current (180 keys, 12 namespaces); key set = en = sidecar (31); valid JSON; every value non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source, no plural/select arms (sidecar: labelled counts); sentence-final punctuation matches the source's full stops in the locale's own stop.
- `new_tag_placeholder` still the ASCII server-grammar example.
- Every value re-rendered through the repo's `parseMessage`/`formatMessage` (src/i18n/messages.ts) at its real arguments (`limit`=12 = MAX_ASSET_TAGS; `count`=1,2,5), plus the six mobile.common verbs the Library screens render. The rendered text, not the template, was judged: all 31 render without error and without a leftover brace.
- Wiring: `discard_not_saved`, `discard_confirm` and `editor.discard_title` are passed by library-detail.tsx; the Dialog's Cancel is `t("mobile.common.cancel")` (grep in audit.log), and `discard_confirm` differs from `common.cancel` in this locale.

## Findings
None. No BLOCKER, MAJOR, MINOR or NIT on the current text.
