# libc-es-r1 - mobile.library (es) - independent audit

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys. Auditor: i18n-auditor, session e89500535af7, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/es/mobile.library.json` sha256 `b8548f22e7bdc8a38922ed08296d07822d10a5a1b8069d4cefcc531ac1f0c67d`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. The target was hashed at the start and as the last command of audit.log - unchanged.

31/31 keys judged. tú register consistent with the es catalogue («Edita», «has hecho»); «Descartar» (confirm) ≠ «Cancelar» (common.cancel). No BLOCKER/MAJOR.

## What was checked (audit.log)
- `generate.ts --check` current; key set = en = sidecar (31); valid JSON; every value a non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source and no plural/select arms (sidecar: labelled counts, not plural-agreeing nouns); sentence keys (6) end with the locale full stop, fragments do not.
- `new_tag_placeholder` checked against the server grammar `^[a-z0-9][a-z0-9_-]{0,23}$` (it is the example a user may tap in).
- `discard_confirm` compared with this locale's `mobile.common.cancel` (they differ) and `discard_not_saved` / `editor.discard_title` read against `library-detail.tsx:914-929` and `dialog.tsx` (Cancel is `t("mobile.common.cancel")`, the confirm uses `variant="danger"` when `destructive`).
- Every value rendered through `formatMessage(parseMessage(v), args, locale)` at the real arguments (`limit`=12; `count`=1,2,5); the rendered text, not the template, was judged.

## Findings

### libc-es-r1-1 MINOR - `browse.no_tags`
- current: «Aún no hay etiquetas. El bibliotecario las añade al organizar los recursos.»
- replacement: «Aún no hay etiquetas. El Bibliotecario las añade al organizar los recursos.»
- why: The sidecar says to keep "The Librarian" a proper noun; core es capitalises it everywhere (wire.settings.librarian.title «Bibliotecario», wire.errors.desktop.librarian_* «el Bibliotecario», wire.slash.library.librarian_help). Lower-case here reads as a generic librarian. Borderline: meaning is intact, so MINOR; promote to MAJOR if the programme treats the sidecar instruction as binding.
- verified: core es grep (bounded, read-only) + before/after render in audit.log

### libc-es-r1-2 MINOR - `action.open_chat`
- current: «Abrir chat»
- replacement: «Abrir conversación»
- why: The same screen calls the conversation «conversación de origen» (detail.no_source) and the es catalogue uses «conversación» ~200x in core and in mobile (session.conversation_details «Detalles de la conversación»); «chat» appears once in mobile (schedules.empty.body «en el chat») and 3x in core. English also splits "chat"/"conversation", so «Abrir chat» mirrors the source and is understandable; the replacement removes the split. Width 18 chars vs 10: fits the wrap-row button.
- verified: core + mobile es grep; before/after render in audit.log

## Out-of-catalogue observation
English literals remain at library-screen.tsx:300 (`Sort: ...`, `Recently seen`), :359 (`Clear filters`) and library-detail.tsx:238/285/366 (`Back to the library`, `Favorite(d)`, `A conversation`). Not part of the 31 keys; not judged.
