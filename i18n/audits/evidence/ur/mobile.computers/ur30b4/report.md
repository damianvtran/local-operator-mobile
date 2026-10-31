# ur · mobile.computers · ur30b4 — independent audit

**Verdict: passed** · keys 10/10 (en/ur), keyset equal: True · BLOCKER 0 · MAJOR 0 · MINOR 1 · NIT 0

Auditor: i18n-auditor (lopdev), session b5f20e88b803, model anthropic/claude-sonnet-5-5 (no fallback observed).

Route: Catalogue, sidecars, scripts and generate.ts read by ordinary worktree file reads and `git show origin/main:` of the core repo; NOT the read_public_copy route (refused for src/i18n/**). Context sidecars are nested JSON, not routable. No receipt claimed.

Redaction markers: **0** · bidi/zero-width control chars in target: **0** · `generate.ts --check`: current · placeholder-name parity: 0 mismatches.

## Findings

### C1 — MINOR — `mobile.computers.password_placeholder`

- current: `وہ پاس ورڈ جو lop mobile سے ملا`
- replacement: `lop mobile سے ملنے والا پاس ورڈ`
- why: Placeholder reads as a half-clause with a past-tense «ملا» ('the password that was got'); the participle phrase is the natural placeholder form, shorter, and keeps `lop mobile` as one intact LTR island (fribidi visual order checked for the current text; the replacement has the same single island).
- verified: repl.ts render; bidi.sh fribidi output for the current string.

## Observations (not findings on the Urdu text)

- stays_listed: EN 'It' is ambiguous; the Urdu names «پچھلا کمپیوٹر» as the sidecar and the code flow (adding a computer, 'switch back') require. Correct.
- Outside the catalogue: computers.tsx:654 still hard-codes the English line 'Connected to {name}.' immediately above this sentence, so the Urdu reader gets one English line on that card. Wiring/source scope, not a translation finding.
- badge.connecting «منسلک ہو رہا» is the same wording as the recorded relay.health.reconnecting width exception; no maxCells/maxChars hint exists in these sidecars.
- Test-suite signal (not a copy defect): src/i18n/__tests__/catalogues.test.ts 'ships no locale the runtime cannot render' fails with ur present but not in SHIPPED_LOCALES (68 tests, 67 pass). Wiring scope for the translator/manager.

## Per-key read (each key read against EN text, sidecar note and, where composed, its call site)

| key | role | result |
|---|---|---|
| `add` | button | ok |
| `added.stays_listed` | help | ok |
| `badge.active` | status | ok |
| `badge.connecting` | status | ok |
| `connecting` | status | ok |
| `none_on_phone` | status | ok |
| `password_placeholder` | help | C1 |
| `section.not_connected` | heading | ok |
| `section.on_phone` | heading | ok |
| `switch` | button | ok |

Commands and their actual output: `audit.log` in this directory.
