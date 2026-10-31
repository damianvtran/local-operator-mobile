# libc-zh-CN-r1 - mobile.library (zh-CN) - independent audit

**Verdict: changes_requested** - 0 BLOCKER, 1 MAJOR (BLOCKER+MAJOR = 1). 31/31 keys. Auditor: i18n-auditor, session e89500535af7, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/zh-CN/mobile.library.json` sha256 `27a055806e3d3f87e57bc2bdadeac3a39827cf317045d9a0ec97f2af9e6c3b61`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. The target was hashed at the start and as the last command of audit.log - unchanged.

31/31 keys judged. «放弃» (confirm) ≠ «取消» (common.cancel), equals core zh «放弃更改？». ONE MAJOR (zh-1): detail.no_source uses 会话 where the whole mobile catalogue and the neighbouring button use 对话.

## What was checked (audit.log)
- `generate.ts --check` current; key set = en = sidecar (31); valid JSON; every value a non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source and no plural/select arms (sidecar: labelled counts, not plural-agreeing nouns); sentence keys (6) end with the locale full stop, fragments do not.
- `new_tag_placeholder` checked against the server grammar `^[a-z0-9][a-z0-9_-]{0,23}$` (it is the example a user may tap in).
- `discard_confirm` compared with this locale's `mobile.common.cancel` (they differ) and `discard_not_saved` / `editor.discard_title` read against `library-detail.tsx:914-929` and `dialog.tsx` (Cancel is `t("mobile.common.cancel")`, the confirm uses `variant="danger"` when `destructive`).
- Every value rendered through `formatMessage(parseMessage(v), args, locale)` at the real arguments (`limit`=12; `count`=1,2,5); the rendered text, not the template, was judged.

## Findings

### libc-zh-CN-r1-1 MAJOR - `detail.no_source`
- current: «此资源没有记录来源会话。»
- replacement: «此资源没有记录来源对话。»
- why: The zh mobile catalogue keeps two words apart: 对话 = conversation (home.tip.search «搜索过往对话以重新打开会话», session.conversation_details «对话详情», schedules.*, notifications.*) and 会话 = session (projects.sessions.count «# 个会话», session_health.*). English "source conversation" is a conversation → 对话. On the same screen the button beside it is «打开对话» (action.open_chat) and the «出现于» list it sits under lists conversation titles, so 会话 contradicts the sibling control and reads as a different object (a session). Core zh desktop library (tui.library.*) uses 会话 for this, but the mobile catalogue is the binding reference for a mobile screen.
- verified: mobile zh grep for 对话/会话 usage; before/after render in audit.log

## Out-of-catalogue observation
English literals remain at library-screen.tsx:300 (`Sort: ...`, `Recently seen`), :359 (`Clear filters`) and library-detail.tsx:238/285/366 (`Back to the library`, `Favorite(d)`, `A conversation`). Not part of the 31 keys; not judged.
