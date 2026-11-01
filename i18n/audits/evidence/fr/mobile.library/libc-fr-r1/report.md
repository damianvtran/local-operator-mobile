# libc-fr-r1 - mobile.library (fr) - independent audit

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys. Auditor: i18n-auditor, session e89500535af7, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/fr/mobile.library.json` sha256 `e07c70d5566e4af4b1d78e47a5d1411a5f7db64f6948f270fc0d0797c385fe9d`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. The target was hashed at the start and as the last command of audit.log - unchanged.

31/31 keys judged against library-detail.tsx / library-screen.tsx and the fr catalogue (« Abandonner » = core tui.authoring.discard; « Annuler » = common.cancel; NNBSP before « ? » kept as in the rest of fr). No BLOCKER/MAJOR.

## What was checked (audit.log)
- `generate.ts --check` current; key set = en = sidecar (31); valid JSON; every value a non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source and no plural/select arms (sidecar: labelled counts, not plural-agreeing nouns); sentence keys (6) end with the locale full stop, fragments do not.
- `new_tag_placeholder` checked against the server grammar `^[a-z0-9][a-z0-9_-]{0,23}$` (it is the example a user may tap in).
- `discard_confirm` compared with this locale's `mobile.common.cancel` (they differ) and `discard_not_saved` / `editor.discard_title` read against `library-detail.tsx:914-929` and `dialog.tsx` (Cancel is `t("mobile.common.cancel")`, the confirm uses `variant="danger"` when `destructive`).
- Every value rendered through `formatMessage(parseMessage(v), args, locale)` at the real arguments (`limit`=12; `count`=1,2,5); the rendered text, not the template, was judged.

## Findings

### libc-fr-r1-1 NIT - `browse.any_tag`
- current: «Toute étiquette»
- replacement: «Toutes les étiquettes»
- why: Filter choice that lifts the tag restriction; French filter lists say « Toutes les … ». « Toute étiquette » is grammatical but reads as an English calque ("any tag").
- verified: render in audit.log (unchanged value shown); judgment only, no catalogue term conflicts

### libc-fr-r1-2 NIT - `browse.no_tags`
- current: «Aucune étiquette pour l’instant. Le bibliothécaire en ajoute en organisant les éléments.»
- replacement: «Aucune étiquette pour l’instant. Le bibliothécaire les ajoute en organisant les éléments.»
- why: « en ajoute en organisant » stacks two « en » (partitive pronoun, then gerund) and stumbles when read aloud; « les ajoute » is cleaner. Meaning and lower-case « bibliothécaire » (core fr wire.settings.librarian / librarian_* errors) are right.
- verified: before/after rendered through messages.ts in audit.log

## Out-of-catalogue observation
English literals remain at library-screen.tsx:300 (`Sort: ...`, `Recently seen`), :359 (`Clear filters`) and library-detail.tsx:238/285/366 (`Back to the library`, `Favorite(d)`, `A conversation`). Not part of the 31 keys; not judged.
