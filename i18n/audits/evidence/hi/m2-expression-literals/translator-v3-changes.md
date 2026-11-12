# Hindi M2 split-key v3 — 2026-11-11

Translator: i18n-translator, session `2006a3a729b8`; ACTUAL served model `openai/gpt-6.1-sol` (session model header). No fallback or MT service used. Lane: bounded fix (<2 h). Translation plus mechanical validation only; not an independent audit.

- Output: `hi.v3.json`, 33 keys, SHA-256 `9d7bb518fdfec9867824730958197dff116e6d4d786b1f71a60696fc8fb42762`.
- Added last: `mobile.session.back_to_session` = `सत्र पर वापस जाएँ`.
- Reasoning: uses the binding glossary's सत्र and the same polite navigation frame `पर वापस जाएँ` as `mobile.session.back_to`. The singular noun सत्र needs no change before पर.
- `mobile.session.fallback_name` remains `सत्र`: already the natural bare screen-title noun; no revision needed. All previous 32 values and their order are unchanged.
- Inputs: `hi.v2.json`, `hi.v2-changes.md`, `keys33.json`; core Hindi style guide and glossary; core i18n HOWTO/RFC and AGENTS.md i18n section.
- Executed `python3` mechanical validation: PASS — 33 keys; exact `keys33.json` order; placeholders match every context row; no empty values; all values NFC; first 32 pairs unchanged; JSON written and read back successfully.
- Repository catalogue validator not run: this task explicitly produces a scratch candidate, not a catalogue modification. Candidate assertions above are the requested validation; integrated catalogue validation belongs to the manager's integration lane.
- Ambiguities: none for the added key. Glossary proposals: none. No repository/ledger edit or commit; no self-audit.
