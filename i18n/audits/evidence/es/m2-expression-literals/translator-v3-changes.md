# Spanish M2 split-key candidate — v3

Translator: i18n-translator; session `4b47d4bb5551`; ACTUAL served model `openai/gpt-6.1-sol` (session header). No fallback/model switch or MT API/SDK/service used. Bounded translation-only fix (<2 h); not a self-audit or an independent audit.

Inputs: `es.v2.json`, `es.v2-changes.md`, `keys33.json`, core `docs/I18N.md`, `docs/design/i18n.md`, `AGENTS.md` internationalization section, `i18n/style-guides/es.md`, `i18n/glossary.md`, and the manager's split-key addendum.

- Appended `mobile.session.back_to_session`: **Volver a la sesión**. Infinitive `Volver a` matches `mobile.session.back_to = Volver a {name}`; the feminine definite article makes a natural complete navigation label. `sesión` follows the glossary/style guide.
- Revised `mobile.session.fallback_name`: **tu sesión → sesión**. The new complete navigation key frees the header fallback from having to fit after `Volver a`; the plain lowercase noun is the appropriate header title. This supersedes the shared-fallback composition rationale in v2, without altering the v2 note.
- Retained all 31 other prior values verbatim. The previous `back_to` sidecar still mentions fallback interpolation; the explicit split-key addendum and final sidecar entry supersede that note for unnamed parents.
- Glossary proposals: none. Width exceptions: none identified; the new source entry has no numeric length hint.

## Executed mechanical validation

Python in the session's persistent kernel wrote UTF-8 JSON and re-read the file. Actual output:

```text
PASS: es.v3.json — 33 keys, exact source order, exact placeholders, no empty values, NFC; 31 prior values unchanged, fallback revised, new key appended last.
```

Checks asserted 33 keys, exact `keys33.json` order, placeholder sets equal to each sidecar entry, nonempty string values, NFC, and exactly one changed pre-existing value (`mobile.session.fallback_name`). No ICU plurals occur in these inputs. This is the requested candidate validation only; no repository catalogue validator, rendered UI proof, audit or ledger update is claimed. No repository edits or commits.
