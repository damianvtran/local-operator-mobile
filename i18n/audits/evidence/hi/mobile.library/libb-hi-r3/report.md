# libb-hi-r3 - mobile.library (hi) - DELTA audit of libb-hi-r2

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys rendered. Delta of `libb-hi-r2` (round-1 verdict: passed, 0 unresolved BLOCKER/MAJOR). Auditor: i18n-auditor, session c1967ad9dd38, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text (AS SHIPPED NOW): `src/i18n/catalogues/hi/mobile.library.json` sha256 `2a76b935b8821328e7de665bcf25214e2e49a38e3af36ab5b2c03ab7f3401add`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. Round-1 bundle recorded `48235b2ffa9aa6311a27493a0301651ae87967dc99a864053a4540f429fc7367` - it does NOT attest the shipped bytes; this bundle does. The target was hashed at the start and as the last command of the scripted run in audit.log - unchanged.

## Why this bundle exists
Review round 1 (R1-1): the findings of `libb-hi-r2` were applied after that bundle was written, so its recorded hash no longer matches the file as it ships. This delta attests the current bytes and verifies each applied change against the finding that asked for it.

## Keys changed since round 1 (derived, not asserted)
- `mobile.library.browse.refresh`: «ताज़ा करें» → «लाइब्रेरी ताज़ा करें» (round-1 finding libb-hi-r2-1, MINOR) - byte-exact: True

Proof the list is complete and exact: `tools/delta.py` reverts exactly these keys to the round-1 text inside the shipped raw bytes and hashes the result; it equals the sha256 recorded by `libb-hi-r2` (audit.log: "== recorded round-1 sha256 : True"). No other byte of the file differs from what round 1 judged.

## Judgment of the changed text
- `browse.refresh` «लाइब्रेरी ताज़ा करें» — the object is restored, as in English («Refresh library») and every other shipped locale. It is the accessible label of the icon-only header button (read in isolation by a screen reader), so naming the library is needed. `mobile.common.done` is «हो गया» in hi mobile.common and is byte-unchanged: the hi mobile.common round-1 bundle (lib-common-hi-r1) still attests the shipped file (hash equal, audit.log supplement). Spot-check of neighbours: `browse.search_label` «लाइब्रेरी में खोजें», `title` «लाइब्रेरी» use the same transliteration; consistent.

## What was checked (audit.log)
- `generate.ts --check` current (180 keys, 12 namespaces); key set = en = sidecar (31); valid JSON; every value non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source, no plural/select arms (sidecar: labelled counts); sentence-final punctuation matches the source's full stops in the locale's own stop.
- `new_tag_placeholder` still the ASCII server-grammar example.
- Every value re-rendered through the repo's `parseMessage`/`formatMessage` (src/i18n/messages.ts) at its real arguments (`limit`=12 = MAX_ASSET_TAGS; `count`=1,2,5), plus the six mobile.common verbs the Library screens render. The rendered text, not the template, was judged: all 31 render without error and without a leftover brace.
- Wiring: `discard_not_saved`, `discard_confirm` and `editor.discard_title` are passed by library-detail.tsx; the Dialog's Cancel is `t("mobile.common.cancel")` (grep in audit.log), and `discard_confirm` differs from `common.cancel` in this locale.

## Findings
### libb-hi-r3-1 OBSERVATION (resolved)
- key: `mobile.library.discard_not_saved / discard_confirm / Dialog Cancel`
- Round-2 observation libb-hi-r2-2 (the keys had no call site and Dialog Cancel was a literal) is resolved in the code as shipped: library-detail.tsx:919-921 passes t('mobile.library.editor.discard_title'/'discard_not_saved'/'discard_confirm') and dialog.tsx:133/191 renders t('mobile.common.cancel') (grep in audit.log).
