# ur · mobile.notifications · ur30b3 — independent audit

**Verdict: passed** · keys 14/14 (en/ur), keyset equal: True · BLOCKER 0 · MAJOR 0 · MINOR 1 · NIT 0

Auditor: i18n-auditor (lopdev), session b5f20e88b803, model anthropic/claude-sonnet-5-5 (no fallback observed).

Route: Catalogue, sidecars, scripts and generate.ts read by ordinary worktree file reads and `git show origin/main:` of the core repo; NOT the read_public_copy route (refused for src/i18n/**). Context sidecars are nested JSON, not routable. No receipt claimed.

Redaction markers: **0** · bidi/zero-width control chars in target: **0** · `generate.ts --check`: current · placeholder-name parity: 0 mismatches.

## Findings

### N1 — MINOR — `mobile.notifications.dismiss / mobile.notifications.detail.nothing_to_dismiss`

- current: `ہٹائیں ; اس گفتگو سے ہٹانے کے لیے کوئی اپ ڈیٹ نہیں۔`
- replacement: `خارج کریں ; اس گفتگو سے خارج کرنے کے لیے کوئی اپ ڈیٹ نہیں۔`
- why: The phone inbox mirrors the relay inbox, whose core Urdu for 'Dismiss' is «خارج کریں» (relay.notifications.row.dismiss / confirm.dismiss / detail.dismiss); «ہٹائیں» is core's TUI wording AND this app's word for 'remove' (milestone remove), so an icon-only a11y label «ہٹائیں» reads as delete/remove. Not wrong, so MINOR; both attested in core.
- verified: core ur relay.notifications.* vs tui.notifications.hint_dismiss grep in precedent.out; repl.ts render.

## Observations (not findings on the Urdu text)

- اطلاعات / اعلیٰ / پچھلی اپ ڈیٹس / ماخذ / پروجیکٹس all match core relay.notifications and tui.notifications precedents; no glossary violation.

## Per-key read (each key read against EN text, sidecar note and, where composed, its call site)

| key | role | result |
|---|---|---|
| `answer` | button | ok |
| `back` | button | ok |
| `detail.answer_in_conversation` | button | ok |
| `detail.conversation_asks` | heading | ok |
| `detail.earlier_updates` | heading | ok |
| `detail.from` | heading | ok |
| `detail.no_asks` | status | ok |
| `detail.nothing_to_dismiss` | status | N1 |
| `detail.projects` | heading | ok |
| `dismiss` | button | N1 |
| `filter_label` | meta | ok |
| `load_failed` | heading | ok |
| `priority_high` | status | ok |
| `title` | heading | ok |

Commands and their actual output: `audit.log` in this directory.
