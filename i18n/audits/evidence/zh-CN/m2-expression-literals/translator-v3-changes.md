# zh-CN M2 split-key addition

- Translator session: `22b86bd77cae`; actual served model: `openai/gpt-6.1-sol` (runtime session header; no fallback).
- Added final key `mobile.session.back_to_session`: `返回会话`. Uses the same `返回` verb frame as `mobile.session.back_to = 返回{name}` and glossary session term `会话`. Natural complete navigation label; no grammatical case or article needed in Chinese.
- Retained `mobile.session.fallback_name = 会话`: already the plain noun appropriate for a header. All original 32 v2 values retained unchanged.
- Inputs: `keys33.json`, `zh-CN.v2.json`, `zh-CN.v2-changes.md`, core i18n HOWTO/RFC, `i18n/style-guides/zh-CN.md`, shared glossary. No new glossary proposals or ambiguity for this addition. Translation by own reasoning; no MT/API/SDK; no self-audit.
- Actual Python3 read-back validation: PASS — 33 keys, exact keys33 source order, matching placeholder names per key, no empty strings/edge whitespace, NFC, and all 32 original values unchanged. This is candidate mechanical validation, not a repo catalogue-validator run or independent audit. No production catalogue/ledger edits or commits.
