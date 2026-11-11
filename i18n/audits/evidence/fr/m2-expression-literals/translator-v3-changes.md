# French M2 split-key candidate v3

- Translator: i18n-translator; session d4a94e22bca2; actual served model **openai/gpt-6.1-sol**, from the session model header. No fallback or machine translation used.
- Added `mobile.session.back_to_session`: **Retour à la session**. Reuses the `Retour à` navigation frame and glossary term `session`; the definite article makes the unnamed-parent label natural French.
- `mobile.session.fallback_name` remains **session**, the bare header-title noun. No revision necessary. All 32 v2 values remain byte-identical as JSON string values.
- Inputs: `fr.v2.json`, `keys33.json` (English and context), `fr.v2-changes.md`, core French style guide and shared glossary. The older `back_to` context still mentions fallback composition; the explicit 33rd-key context and task addendum supersede that use: unnamed parents must select the full new key.
- Python3 validation actually executed against the re-read output: PASS — 33 keys, exact source order, matching placeholder names and multiplicities, no empty/padded values, NFC, and all original 32 values unchanged. No new plural/select messages.
- Scoped scratch candidate only; repository catalogue validator not run because no catalogue or ledger was integrated or changed. Independent audit and integration validation remain the manager’s responsibility. No self-audit or approval claimed.
- New glossary proposals: none.
