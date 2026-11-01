# libc-fr-r2 - mobile.library (fr) - DELTA audit of libc-fr-r1

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys rendered. Delta of `libc-fr-r1` (round-1 verdict: passed, 0 unresolved BLOCKER/MAJOR). Auditor: i18n-auditor, session c1967ad9dd38, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text (AS SHIPPED NOW): `src/i18n/catalogues/fr/mobile.library.json` sha256 `fdf9b359ba106b6ff5093d57b3c983f7a74048e3a50315d73fc1661ea9a5ee75`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. Round-1 bundle recorded `e07c70d5566e4af4b1d78e47a5d1411a5f7db64f6948f270fc0d0797c385fe9d` - it does NOT attest the shipped bytes; this bundle does. The target was hashed at the start and as the last command of the scripted run in audit.log - unchanged.

## Why this bundle exists
Review round 1 (R1-1): the findings of `libc-fr-r1` were applied after that bundle was written, so its recorded hash no longer matches the file as it ships. This delta attests the current bytes and verifies each applied change against the finding that asked for it.

## Keys changed since round 1 (derived, not asserted)
- `mobile.library.browse.any_tag`: «Toute étiquette» → «Toutes les étiquettes» (round-1 finding libc-fr-r1-1, NIT) - byte-exact: True
- `mobile.library.browse.no_tags`: «Aucune étiquette pour l’instant. Le bibliothécaire en ajoute en organisant les éléments.» → «Aucune étiquette pour l’instant. Le bibliothécaire les ajoute en organisant les éléments.» (round-1 finding libc-fr-r1-2, NIT) - byte-exact: True

Proof the list is complete and exact: `tools/delta.py` reverts exactly these keys to the round-1 text inside the shipped raw bytes and hashes the result; it equals the sha256 recorded by `libc-fr-r1` (audit.log: "== recorded round-1 sha256 : True"). No other byte of the file differs from what round 1 judged.

## Judgment of the changed text
- `browse.any_tag` «Toutes les étiquettes» — the chip that clears the tag restriction (library-screen.tsx:584-588, shown before the tag chips). French filter lists say «Toutes les …»; no longer an "any tag" calque. Plural matches the chips beside it.
- `browse.no_tags` «… Le bibliothécaire les ajoute en organisant les éléments.» — «les» agrees with the antecedent «étiquettes» (f. pl.) from the previous sentence; the doubled «en … en» is gone. Lower-case «bibliothécaire» is core fr's rendering and is kept.

## What was checked (audit.log)
- `generate.ts --check` current (180 keys, 12 namespaces); key set = en = sidecar (31); valid JSON; every value non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source, no plural/select arms (sidecar: labelled counts); sentence-final punctuation matches the source's full stops in the locale's own stop.
- `new_tag_placeholder` still the ASCII server-grammar example.
- Every value re-rendered through the repo's `parseMessage`/`formatMessage` (src/i18n/messages.ts) at its real arguments (`limit`=12 = MAX_ASSET_TAGS; `count`=1,2,5), plus the six mobile.common verbs the Library screens render. The rendered text, not the template, was judged: all 31 render without error and without a leftover brace.
- Wiring: `discard_not_saved`, `discard_confirm` and `editor.discard_title` are passed by library-detail.tsx; the Dialog's Cancel is `t("mobile.common.cancel")` (grep in audit.log), and `discard_confirm` differs from `common.cancel` in this locale.

## Findings
None. No BLOCKER, MAJOR, MINOR or NIT on the current text.

Note: `editor.discard_title` «Abandonner les modifications ?» keeps U+202F before «?» - correct French typography, unchanged since round 1 (the checks.py special-space line lists it deliberately).
