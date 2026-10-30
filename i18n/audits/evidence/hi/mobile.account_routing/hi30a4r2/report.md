# Hindi delta audit — `mobile.account_routing` (hi30a4r2)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.account_routing` · **Keys:** 14
- **Wave:** 6 — damianvtran/local-operator-mobile, branch `feat/i18n-hindi`, group A
- **Audited revision:** `d4e31b1915b558171ded41501c741568f0854f3f` — the remediation commit; no tracked file differs from it (`git diff HEAD -- src/ i18n/` empty) and the only untracked paths are audit evidence directories
- **Delta of:** round 1 `hi30a4` (`i18n/audits/evidence/hi/mobile.account_routing/hi30a4/record.json`), which was `passed`
- **Auditor:** `i18n-auditor` (lopdev team), session `69ed4c2e63b0`. **Actual model `radient/auto`**, after a provider-quota descent in this turn: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`.
- **Fresh independent read:** a `reviewer` subagent, job `1bb9b3e54846`, actual model `anthropic/claude-sonnet-5-5`, which did not see this auditor's findings.
- **No human native-speaker review, no rendered frame.** Widths are CoreText advances against boxes read from the code.
- **Verdict:** `passed` — Both round-1 MINORs shipped (the control now says लोड and the error sentence already said लोड; the three retry strings are फिर से कोशिश करें). One NIT recorded on bare फिर in the reload pair (the second read graded it MINOR); it does not gate.

## What changed

| id | key | severity | resolution |
| --- | --- | --- | --- |
| H-01 | `mobile.account_routing.reload` | MINOR | applied byte-exactly: `नीति फिर पढ़ें` → `नीति फिर लोड करें` |
| H-02 | `.retry` / `.load_error` / `.rejected` | MINOR | `फिर कोशिश करें` → `फिर से कोशिश करें` (button byte-exact; both sentences carry the asked fragment) |

## Neighbours after the sweep

| string | text | agrees with |
| --- | --- | --- |
| `.error` (unchanged) | `बदलाव की पुष्टि नहीं हो सकी। कनेक्शन जाँचें और मौजूदा नीति पढ़ने के लिए फिर लोड करें।` | `.reload` — the instruction names लोड and the only control is now a लोड control |
| `.reload` (fixed) | `नीति फिर लोड करें` | `.error`, `.loading` (`लोड हो रही है…`), `.load_error` (`लोड नहीं हो सकी`) |
| `.retry`, `.load_error`, `.rejected` | `फिर से कोशिश करें` | `relay.health.ended_send_failed`, `relay.health.quiet_detail` and `mobile.home.startup_queue.blocked` — the whole app now says `फिर से कोशिश करें` |

The round-1 complaint was that the error instructed an action no control was
called. That is fixed: the control and the sentence that names it now use the
same verb.

R2-03 (NIT, not gating): the sweep settled on `फिर से` for retry, while the
reload pair keeps bare `फिर`. The pair agrees with itself and bare `फिर` is
idiomatic, so this is polish, and it is this auditor's own round-1 wording. The
`फिर से` variant measures 107.7 pt, one line, if the programme wants uniformity.

## Measurements
Method unchanged from round 1: CoreText `CTLineGetTypographicBounds`, AppKit system font, the app's own token sizes. The round-1 numbers were reproduced exactly on the round-1 strings before any new string was measured.

| measurement | type size | width |
|---|---|---|
| reload (round-1 text) | 14/400 | 68.4 pt |
| reload (shipped) | 14/400 | 94.4 pt |
| reload alt फिर से लोड करें | 14/400 | 107.7 pt |
| retry (round-1 text) | 14/400 | 84.8 pt |
| retry (shipped) | 14/400 | 98.1 pt |
| error (neighbour unchanged) | 14/400 | 468.7 pt |
| load_error (shipped) | 14/400 | 365.4 pt |
| rejected (shipped) | 14/400 | 439.4 pt |

Boxes:
- settings column: 288.0 pt — same px-4 column; sm Button sizes to its label

## Fresh independent read
The fresh reviewer re-read the seven remediated values without seeing this audit's findings. It agreed both account-routing fixes are correct and that the control and the two sentences now name the same action; it graded the bare फिर in the reload pair MINOR where this audit records a NIT, a polish disagreement that gates nothing.

Where it disagreed, the disagreement is disclosed in `record.json` under `second_independent_pass` and `delta_findings`, not smoothed over.

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
