# Hindi delta audit — `mobile.home` (hi30a1r2)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.home` · **Keys:** 27
- **Wave:** 6 — damianvtran/local-operator-mobile, branch `feat/i18n-hindi`, group A
- **Audited revision:** `d4e31b1915b558171ded41501c741568f0854f3f` — the remediation commit; no tracked file differs from it (`git diff HEAD -- src/ i18n/` empty) and the only untracked paths are audit evidence directories
- **Delta of:** round 1 `hi30a1` (`i18n/audits/evidence/hi/mobile.home/hi30a1/record.json`), which was `changes_requested`
- **Auditor:** `i18n-auditor` (lopdev team), session `69ed4c2e63b0`. **Actual model `radient/auto`**, after a provider-quota descent in this turn: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`.
- **Fresh independent read:** a `reviewer` subagent, job `1bb9b3e54846`, actual model `anthropic/claude-sonnet-5-5`, which did not see this auditor's findings.
- **No human native-speaker review, no rendered frame.** Widths are CoreText advances against boxes read from the code.
- **Verdict:** `passed` — Round-1 H-01/H-02/H-03 shipped byte-exactly as asked and H-04's NIT was declined openly. One residual MINOR (R2-02, the माँगें nuance, which the independent second read graded MAJOR) and the declined NIT. Nothing blocks; the mechanical suite is clean and the tip is inside both budgets.

## What changed

Three of the four round-1 findings were applied, byte for byte, against the wording this
audit asked for; the fourth was a NIT and was declined openly.

| id | key | severity | resolution |
| --- | --- | --- | --- |
| H-01 | `mobile.home.tip.parallel` | MAJOR | applied byte-exactly (`काम कहें` → `काम माँगें`) |
| H-02 | `mobile.home.startup_queue.blocked` | MINOR | applied byte-exactly (`फिर` → `फिर से`) |
| H-03 | `mobile.home.suggestion.wake_summary` | MINOR | applied byte-exactly (`सारांश के साथ जगाएँ` → `सारांश के साथ मुझे जगाएँ`) |
| H-04 | `mobile.home.options.apply` | NIT | declined; no change, and the round-1 second reader had asked for none |

Diff coverage: 12 of this namespace's 27 values were captured by the round-1
measurement artifacts, and exactly the three keys above differ; the other nine
comparable values are byte-identical. Values the round-1 artifacts did not
capture were checked against the round-1 record's per-finding `current` text and
against the unchanged file-level sha256 of the namespaces the remediation did not
touch.

## The tip, re-measured

The tip is the one string with a hard budget on both sides: 48 characters
(`TIP_CHAR_BUDGET`, asserted by `home-copy.test.ts`) and a one-line 270 pt box.

| string | pt at meta 12/500 | characters | verdict |
| --- | --- | --- | --- |
| round-1 text `…काम कहें…` | 203.9 | 42 | the calque the round-1 MAJOR filed |
| **shipped `…काम माँगें…`** | **204.8** | **44** | 65.2 pt inside the 270 pt box; 4 characters inside the budget |
| alt `…काम करने को कहें…` | 246.4 | 50 | fits the box, **over the 48-character budget** |
| alt `…काम करने को कहें, तो काम उप-एजेंटों में बँट जाता है` | 288.4 | 59 | **overflows** the 270 pt box and the budget |
| alt `…काम के लिए कहें…` | 240.0 | 49 | fits the box, over the budget by one |
| widest tip in the pool (`schedule`) | 212.3 | 48 | 57.7 pt inside the box, exactly at the budget |

The independent second read this round graded the shipped verb MAJOR and offered
the two alternatives in rows 3 and 4. Neither can ship: one breaks the
character budget the unit test enforces, the other overflows the box. The two
direction-fixing variants that do fit the box are still over the budget. This
audit therefore records R2-02 as a MINOR (the applied verb is the one it asked
for, and it is grammatical and readable) while disclosing the second reader's
MAJOR, and does not gate on it.

Chips and greeting, same method: `wake_summary` 131.3 pt in the 256 pt chip box (was 108.2); the widest chip is `Linear MCP सेट करें` at 116.3 pt; the greeting is 285.2 pt in the 288 pt column, one line.

## A correction to my own round-1 evidence

Round 1 recorded the tip as "26 characters against `TIP_CHAR_BUDGET` 48". It is 42 characters (round-1 text) and 44 (shipped) by the same `length` the budget test asserts. The budget conclusion was right and the margin was overstated: four characters of headroom, not twenty-two. That matters this round, because it is why the alternatives a fresh reader offered cannot fit.

## Fresh independent read
The fresh reviewer re-read the seven remediated values without seeing this audit's findings. It independently confirmed all three home resolutions, and it graded the shipped tip verb MAJOR where this audit holds MINOR — with replacements that exceed the repository's 48-character tip budget (50 and 59 characters) and, in the longer form, the 270 pt tip box (288.4 pt), so the disagreement does not change the verdict.

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
