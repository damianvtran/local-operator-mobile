# libc-ru-r1 - mobile.library (ru) - independent audit

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys. Auditor: i18n-auditor, session e89500535af7, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/ru/mobile.library.json` sha256 `fef91c9fac91a98120f0506824651a4830dd89ee3e26ae935e9fcbee3fa2934e`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. The target was hashed at the start and as the last command of audit.log - unchanged.

31/31 keys judged. «Отбросить» (confirm) ≠ «Отмена» (common.cancel) and matches core ru tui.authoring.discard; plural-free {count}/{limit} strings read correctly at every real value. No BLOCKER/MAJOR.

## What was checked (audit.log)
- `generate.ts --check` current; key set = en = sidecar (31); valid JSON; every value a non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source and no plural/select arms (sidecar: labelled counts, not plural-agreeing nouns); sentence keys (6) end with the locale full stop, fragments do not.
- `new_tag_placeholder` checked against the server grammar `^[a-z0-9][a-z0-9_-]{0,23}$` (it is the example a user may tap in).
- `discard_confirm` compared with this locale's `mobile.common.cancel` (they differ) and `discard_not_saved` / `editor.discard_title` read against `library-detail.tsx:914-929` and `dialog.tsx` (Cancel is `t("mobile.common.cancel")`, the confirm uses `variant="danger"` when `destructive`).
- Every value rendered through `formatMessage(parseMessage(v), args, locale)` at the real arguments (`limit`=12; `count`=1,2,5); the rendered text, not the template, was judged.

## Findings

### libc-ru-r1-1 MINOR - `discard_not_saved`
- current: «Название, описание и теги, которые вы изменили, не сохранятся.»
- replacement: «Изменения названия, описания и тегов не будут сохранены.»
- why: Literal order of the English relative clause: it can be read as "the name, description and tags themselves will not be saved" rather than "your edits to them". Subject = the changes, matching the title «Отбросить изменения?» and the verb «Сохранить» (mobile.common.save) / «не будут сохранены» register.
- verified: before/after render in audit.log

### libc-ru-r1-2 NIT - `editor.title / detail.no_tags`
- current: «Изменить сведения / Измените сведения»
- replacement: «(keep)»
- why: Internally consistent and idiomatic, but the ru mobile catalogue renders the sibling "details" as «Детали беседы» (session.conversation_details, home.options.fixed). Different nouns for the English word "details" across screens; I do not request a change because «сведения» reads better here and the pair is consistent within the feature, but flag it as a glossary note for the programme.
- verified: grep of ru mobile + core catalogues

## Out-of-catalogue observation
English literals remain at library-screen.tsx:300 (`Sort: ...`, `Recently seen`), :359 (`Clear filters`) and library-detail.tsx:238/285/366 (`Back to the library`, `Favorite(d)`, `A conversation`). Not part of the 31 keys; not judged.
