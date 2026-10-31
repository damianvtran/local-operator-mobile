# libc-vi-r1 - mobile.library (vi) - independent audit

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys. Auditor: i18n-auditor, session e89500535af7, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/vi/mobile.library.json` sha256 `fa3c0d94b6c639cf7297d925c2fa714fe16cf028cd2395278786f39738994e5e`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. The target was hashed at the start and as the last command of audit.log - unchanged.

31/31 keys judged. «Bỏ thay đổi» (confirm) ≠ «Hủy» (common.cancel), equals core vi «Bỏ thay đổi?»; «thẻ» matches core vi library terms. No BLOCKER/MAJOR.

## What was checked (audit.log)
- `generate.ts --check` current; key set = en = sidecar (31); valid JSON; every value a non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source and no plural/select arms (sidecar: labelled counts, not plural-agreeing nouns); sentence keys (6) end with the locale full stop, fragments do not.
- `new_tag_placeholder` checked against the server grammar `^[a-z0-9][a-z0-9_-]{0,23}$` (it is the example a user may tap in).
- `discard_confirm` compared with this locale's `mobile.common.cancel` (they differ) and `discard_not_saved` / `editor.discard_title` read against `library-detail.tsx:914-929` and `dialog.tsx` (Cancel is `t("mobile.common.cancel")`, the confirm uses `variant="danger"` when `destructive`).
- Every value rendered through `formatMessage(parseMessage(v), args, locale)` at the real arguments (`limit`=12; `count`=1,2,5); the rendered text, not the template, was judged.

## Findings

### libc-vi-r1-1 NIT - `detail.message_label`
- current: «Nhắn về tài nguyên này»
- replacement: «Tin nhắn về tài nguyên này»
- why: English is a noun phrase ("Message about this asset") naming the composer field; «Nhắn về …» is a verb phrase (imperative "Message about…"). It works as a field prompt, but the noun form matches the sidecar ("a fragment") and sibling labels.
- verified: before/after render in audit.log

### libc-vi-r1-2 NIT - `browse.tag / editor.tags / action.add_tag`
- current: «Thẻ»
- replacement: «(keep)»
- why: Core vi splits the word: conversation tags are «nhãn» (relay.chrome.row.tags, tui.tags.*), asset-library tags are «thẻ» (wire.errors.desktop.library_tag_*). Mobile Library is the asset surface, so «thẻ» is the right choice; no mobile vi string uses either word outside library. Recorded so a later reader does not "fix" it to «nhãn».
- verified: core vi grep (bounded, read-only)

## Out-of-catalogue observation
English literals remain at library-screen.tsx:300 (`Sort: ...`, `Recently seen`), :359 (`Clear filters`) and library-detail.tsx:238/285/366 (`Back to the library`, `Favorite(d)`, `A conversation`). Not part of the 31 keys; not judged.
