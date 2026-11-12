# Russian M2 — split back-navigation key

Translator session: c2709b58d7f7. Actual served model: `openai/gpt-6.1-sol` (session model header); no fallback used. Date: 2026-11-11. Lane: bounded translation fix (<2 h).

- Added `mobile.session.back_to_session`: **Назад к сессии**. Retains the `Назад` navigation frame, uses the glossary term `сессия` in the dative after `к`, and reads naturally as a standalone button for an unnamed parent session.
- Retained `mobile.session.back_to`: `Назад: {name}`. Its colon frame avoids inflecting arbitrary proper names; the dedicated unnamed-session key can now use natural inflected wording instead.
- Retained `mobile.session.fallback_name`: `сессия` (plain nominative screen-title noun). No prior values revised: all 32 v2 values unchanged; key 33 appended last.
- Glossary proposals: none for this delta. No unresolved ambiguity for the new key; keys33.json entry 33 explicitly supersedes the older fallback-splicing note in entry 32.

Validation actually executed: Python 3 JSON round-trip, exactly 33 keys, exact keys33.json order, exact per-key placeholder names, no empty strings, NFC, all 32 inherited values unchanged, and on-disk readback equality: PASS.

SHA-256 ru.v3.json: `759cb72414b0c4dad571f18e8c0b9ea8bb7320462b90af82c8c5b42aa0fa19bd`.

Candidate only, not a repository catalogue edit or audit. Repository-wide catalogue validator not run: this task specifically requests the standalone Python-validated candidate. Independent audit remains required; no audit verdict or ledger status claimed. ru.v2-changes.md unchanged.
