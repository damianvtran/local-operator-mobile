# Vietnamese M2 split-key candidate (v3)

Translator: i18n-translator; session `8e4d1ba4d0d1`; actual served model `openai/gpt-6.1-sol` (this session model header; no fallback used). Date: 2026-11-11. Lane: fix (<2 h).

- Added last: `mobile.session.back_to_session` = `Quay lại phiên`.
- Uses the existing `Quay lại {name}` verb frame and glossary/style-guide term `phiên`. Natural complete Vietnamese navigation label; no article or case change required.
- Retained `mobile.session.fallback_name` = `phiên`: already the plain bare noun appropriate for the header title. No revision.
- All original 32 values preserved byte-for-byte as decoded strings and in their original order; new key appended last. No new glossary proposal.
- Inputs: `vi.v2.json`, `vi.v2-changes.md`, `keys33.json`, core `i18n/style-guides/vi.md`, `i18n/glossary.md`, relevant i18n contributor/RFC sections. Translation derived by my own reasoning; no MT or translation service used. Context for the split-key behavior is the supplied addendum and final `keys33.json` entry; no claim of independently exercised UI behavior.

## Actual validation

Executed Python in this session: parsed JSON; asserted 32 input keys / 33 output keys; exact `keys33.json` key order; original 32 values unchanged; every value nonempty and NFC; exact placeholder names per source context. Re-read and parsed the written output and compared it with the validated mapping. PASS (33 keys).

This is a scratch candidate, not an installed catalogue: repository catalogue validator not run against it. No repository files, ledger, audit records or commits changed. No self-audit or independent pass claimed; independent auditing remains with the manager's auditor lane. Existing v2 note preserved unchanged.
