# Hindi delta audit — `mobile.session` (hi30a2r2)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.session` · **Keys:** 2
- **Wave:** 6 — damianvtran/local-operator-mobile, branch `feat/i18n-hindi`, group A
- **Audited revision:** `d4e31b1915b558171ded41501c741568f0854f3f` — the remediation commit; no tracked file differs from it (`git diff HEAD -- src/ i18n/` empty) and the only untracked paths are audit evidence directories
- **Delta of:** round 1 `hi30a2` (`i18n/audits/evidence/hi/mobile.session/hi30a2/record.json`), which was `passed`
- **Auditor:** `i18n-auditor` (lopdev team), session `69ed4c2e63b0`. **Actual model `radient/auto`**, after a provider-quota descent in this turn: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`.
- **Fresh independent read:** a `reviewer` subagent, job `1bb9b3e54846`, actual model `anthropic/claude-sonnet-5-5`, which did not see this auditor's findings.
- **No human native-speaker review, no rendered frame.** Widths are CoreText advances against boxes read from the code.
- **Verdict:** `passed` — Bytes unchanged from round 1 (same sha256); nothing in the remediation touched this namespace; 2/2 keys still render and still read as native Hindi.

## What changed

Nothing. The round-1 audit raised no finding in this namespace, and its file
sha256 is byte-identical to the round-1 measurement
(`1f326bb988a0063f528c9a15f09127674419c2687d851a07d5c58a8513bcb21a`). The
remediation did not touch a byte here.

Both values still render through the repository's formatter and still read as
native Hindi:

- `बातचीत का विवरण` — the destination title the home sheet quotes by name; it is
  still byte-identical to `mobile.home.options.fixed`'s quoted `“बातचीत का विवरण”`.
- `कार्यरत पंक्ति, कार्य और उप-एजेंट खोलता है` — the status-tray hint.

## Measurements
Method unchanged from round 1: CoreText `CTLineGetTypographicBounds`, AppKit system font, the app's own token sizes. The round-1 numbers were reproduced exactly on the round-1 strings before any new string was measured.

| measurement | type size | width |
|---|---|---|
| conversation_details (unchanged) | 14/400 | 99.8 pt |
| status_tray.hint (unchanged) | 14/400 | 227.7 pt |

Boxes:
- list column: 288.0 pt — same px-4 column

## Fresh independent read
The fresh reviewer read this namespace as a neighbour of the changed strings and raised nothing here. Its report covers the seven remediated values in the other five namespaces.


## The zero-count plural (not this group's message)
This group carries no plural message. The round-1 disagreement over `0 जागृति` is settled in `cross_namespace_observations`, identical in all six round-2 records: **this audit accepts the implementer's disposition and withdraws its round-1 MAJOR.** The binding hi style guide says `one` covers 0 and 1 and gives `0 फ़ाइल` as its example; the core glossary records hi as `one/other (0 is one)`; `Intl.PluralRules('hi').select(0)` is `one`; core ships the same one/other arms for the same noun. My round-1 claim that Hindi reads the plural after zero contradicted the guide, and the guide wins.

## Mechanical
- `node scripts/i18n/generate.ts --check` — exit 0 (catalogue.gen.ts current, 143 keys, 10 namespaces)
- `node scripts/i18n/check-strings.ts` — exit 0 (284 baselined findings, 0 new, no growth vs `647581a`)
- all 66 group-A values rendered through the repository's own `parseMessage`/`formatMessage` — 0 failures
- `vitest run src/features/home/home-copy.test.ts` — 31 passed (includes the 48-character tip budget)
- 10/10 negative controls fired on corrupted fixtures; 0 false positives on the real values
- per-namespace predicates: key set, context coverage, placeholder surface, ICU arms, NFC, ZWJ/ZWNJ, bidi controls, Devanagari digits, spacing, U+2026, danda-vs-ASCII stop, curly quotes, तुम/तू — 0 failures

## Ledger
No audit-ledger command exists in this repository at this head (`i18n/` holds `audits/` only; `scripts/i18n/` has no ledger writer). A ledger-ready row is proposed in `record.json` → `ledger.ledger_row_proposed` and **not written**.

## Limits
No native-speaker review; no rendered frame; the translator's run was not observed. A delta asks the round-1 auditor to re-read its own findings, so it is not an independent audit of the remediation — the fresh reviewer pass is the independent opinion this round. For `mobile.account_routing.load_error` and `.rejected`, round 1 captured only the flagged fragment, so the fix is proved at the fragment; their sentence prefixes are checked against the English source, not diffed.
