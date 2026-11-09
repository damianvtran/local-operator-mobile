# libc-es-r2 - mobile.library (es) - DELTA audit of libc-es-r1

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys rendered. Delta of `libc-es-r1` (round-1 verdict: passed, 0 unresolved BLOCKER/MAJOR). Auditor: i18n-auditor, session c1967ad9dd38, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text (AS SHIPPED NOW): `src/i18n/catalogues/es/mobile.library.json` sha256 `382f12f64c444159b07ef689e6820c39383c9d88e16e5a2bc5c46b27dd8bafd1`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. Round-1 bundle recorded `b8548f22e7bdc8a38922ed08296d07822d10a5a1b8069d4cefcc531ac1f0c67d` - it does NOT attest the shipped bytes; this bundle does. The target was hashed at the start and as the last command of the scripted run in audit.log - unchanged.

## Why this bundle exists
Review round 1 (R1-1): the findings of `libc-es-r1` were applied after that bundle was written, so its recorded hash no longer matches the file as it ships. This delta attests the current bytes and verifies each applied change against the finding that asked for it.

## Keys changed since round 1 (derived, not asserted)
- `mobile.library.browse.no_tags`: «Aún no hay etiquetas. El bibliotecario las añade al organizar los recursos.» → «Aún no hay etiquetas. El Bibliotecario las añade al organizar los recursos.» (round-1 finding libc-es-r1-1, MINOR) - byte-exact: True
- `mobile.library.action.open_chat`: «Abrir chat» → «Abrir conversación» (round-1 finding libc-es-r1-2, MINOR) - byte-exact: True
- `mobile.common.done` (mobile.common, outside this file): «Listo» → «Hecho»

Proof the list is complete and exact: `tools/delta.py` reverts exactly these keys to the round-1 text inside the shipped raw bytes and hashes the result; it equals the sha256 recorded by `libc-es-r1` (audit.log: "== recorded round-1 sha256 : True"). No other byte of the file differs from what round 1 judged.

## Judgment of the changed text
- `browse.no_tags` «El Bibliotecario» — capital B, as core es writes the same helper (wire.settings.librarian.title «Bibliotecario», wire.errors.desktop.librarian_*). Reads as the proper noun the sidecar requires. Sentence otherwise unchanged and correct.
- `action.open_chat` «Abrir conversación» — now the same word as `detail.no_source` («conversación de origen») and `mobile.session.conversation_details` («Detalles de la conversación»). 18 chars against 10 before: a wrap-row outline button (library-detail.tsx:316-318, `size="sm"`), same wrap-row as in round 1; no fit hazard found.
- `mobile.common.done` «Hecho» (outside this file; mobile.common, rendered by the three Library sheets at library-screen.tsx:439/550/625) — matches core es `relay.session.tags.done` «Hecho», whose sidecar role is the same ("closes the sheet; every assignment already landed as its own write") as the mobile.common.done sidecar ("closes a sheet whose choices already applied"). «Hecho» is the right register for a closing button of an already-applied sheet; it is also no longer in conflict with any other es mobile string (the only «Listo»/«Hecho» occurrence in all 10 es mobile namespaces is this key).

## What was checked (audit.log)
- `generate.ts --check` current (180 keys, 12 namespaces); key set = en = sidecar (31); valid JSON; every value non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source, no plural/select arms (sidecar: labelled counts); sentence-final punctuation matches the source's full stops in the locale's own stop.
- `new_tag_placeholder` still the ASCII server-grammar example.
- Every value re-rendered through the repo's `parseMessage`/`formatMessage` (src/i18n/messages.ts) at its real arguments (`limit`=12 = MAX_ASSET_TAGS; `count`=1,2,5), plus the six mobile.common verbs the Library screens render. The rendered text, not the template, was judged: all 31 render without error and without a leftover brace.
- Wiring: `discard_not_saved`, `discard_confirm` and `editor.discard_title` are passed by library-detail.tsx; the Dialog's Cancel is `t("mobile.common.cancel")` (grep in audit.log), and `discard_confirm` differs from `common.cancel` in this locale.

## Findings
### libc-es-r2-1 OBSERVATION (not a defect of mobile.library.json; no change requested of it)
- key: `mobile.common.done (es)`
- The earlier es mobile.common bundle lib-common-es-r1 records sha256 ed13003e... and judged «Listo» 'clean'; the shipped mobile.common.json now has «Hecho» (sha256 7a7984be...). That bundle therefore no longer attests the shipped file - the same class of defect as R1-1 - and it is outside the six bundles asked for here. Needs its own es mobile.common delta bundle (suggested id lib-common-es-r2). The new text «Hecho» itself is correct (see report).
