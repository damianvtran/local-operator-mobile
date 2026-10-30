# Hindi delta audit — `mobile.session_health` (hi30a3r2)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.session_health` · **Keys:** 11
- **Wave:** 6 — damianvtran/local-operator-mobile, branch `feat/i18n-hindi`, group A
- **Audited revision:** `d4e31b1915b558171ded41501c741568f0854f3f` — the remediation commit; no tracked file differs from it (`git diff HEAD -- src/ i18n/` empty) and the only untracked paths are audit evidence directories
- **Delta of:** round 1 `hi30a3` (`i18n/audits/evidence/hi/mobile.session_health/hi30a3/record.json`), which was `passed`
- **Auditor:** `i18n-auditor` (lopdev team), session `69ed4c2e63b0`. **Actual model `radient/auto`**, after a provider-quota descent in this turn: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`.
- **Fresh independent read:** a `reviewer` subagent, job `1bb9b3e54846`, actual model `anthropic/claude-sonnet-5-5`, which did not see this auditor's findings.
- **No human native-speaker review, no rendered frame.** Widths are CoreText advances against boxes read from the code.
- **Verdict:** `changes_requested` — H-01 shipped byte-exactly and the resume/reopen split survives, but the H-02 edit kept only the second clause of 'Still reopening — it has not come up yet.': R2-01, MAJOR, a regression introduced by the fix. The one-clause status also lost its closing danda.

## What changed

| id | key | severity | resolution |
| --- | --- | --- | --- |
| H-01 | `mobile.session_health.resume_refused` | MINOR | applied byte-exactly: `अभी फिर नहीं खोला जा सका। फिर कोशिश करें।` → `अभी दोबारा नहीं खोला जा सका। फिर से कोशिश करें।` |
| H-02 | `mobile.session_health.still_reopening` | NIT | **only partly applied — and the partial edit is this round's regression (R2-01)** |

## R2-01 — MAJOR, regression

English: *Still reopening — it has not come up yet.*

| | text |
| --- | --- |
| round 1 | `अभी भी खुल रहा है — यह अभी तैयार नहीं हुआ।` |
| asked (round 1) | `अभी भी खुल रहा है — यह अभी तक तैयार नहीं हुआ।` |
| **shipped** | **`अभी तक तैयार नहीं हुआ`** |
| this round's ask | `अब भी खुल रहा है — अभी तक तैयार नहीं हुआ।` |

The edit kept the second clause and dropped the first. Three consequences:

1. **The clause that carries the state is gone.** This line *replaces* the
   `reopening` line after the reference client's 20 s cap, and its sidecar says
   the reader must learn the reopen has not silently failed. A bare "it has not
   become ready yet" states an outcome without the pending action, which is the
   opposite of what the slot is for.
2. **No subject remains.** The prior text at least said *यह* (`it`).
3. **The closing danda is gone**, while the sibling `reopening` line is a full
   sentence ending in `।`.

Why MAJOR rather than BLOCKER: nothing false or unsafe is asserted, no
placeholder or plural is broken, and the reader still learns the session is not
ready. What is missing is a meaning-bearing clause the source has and the
context note requires — a reduced message, introduced by a fix, not a
misstatement.

Why it is not a layout constraint: the notice renders at `text-meta` with no
`numberOfLines` clamp (`session-health.tsx:500-506`), and the restored sentence
measures 214.1 pt in the sheet's 288 pt column — 73.9 pt of spare, one line, the
same slot that already holds the 223.9 pt `reopening` line. Nothing forced the
truncation.

Wording: this audit adopts the second reader's `अब भी …` over its own round-1
`अभी भी … यह …`, because it restores the clause *and* removes the doubled `अभी`
that the round-1 NIT was about.

## The resume/reopen split survives

The manager asked whether the `resume_refused` rewrite lost the distinction the
second pass defended in round 1. It did not:

| surface | Hindi | verb |
| --- | --- | --- |
| `resume_refused_title` (heading) | `जारी नहीं रखा जा सका` | जारी रखना — *resume* |
| `resume_no_route` | `…इस सत्र को जारी रखने के लिए…` | जारी रखना — *resume* |
| the button, `relay.chrome.session.resume` | `जारी रखें` | जारी रखना — *resume* |
| `resume_refused` body | `…दोबारा नहीं खोला जा सका।` | दोबारा खोलना — *reopen* |
| `relay.health.ended_send_failed` (mirror) | `…अभी दोबारा नहीं खोला जा सका।` | दोबारा खोलना — *reopen* |

English draws the same line: *Could not resume* as the title, *could not be
reopened* in the body. The title and the button carry *resume* and agree; the
body carries *reopen* and matches the same sheet family's core sentence word for
word. Nothing collapsed.

## Neighbours after the sweep

`resume_refused` now says `फिर से कोशिश करें` like `relay.health.ended_send_failed`
and `relay.health.quiet_detail` in the same app. `अभी दोबारा नहीं खोला जा सका`
matches the mirror sentence the reader meets on the same session surface.

## Measurements
Method unchanged from round 1: CoreText `CTLineGetTypographicBounds`, AppKit system font, the app's own token sizes. The round-1 numbers were reproduced exactly on the round-1 strings before any new string was measured.

| measurement | type size | width |
|---|---|---|
| reopening (t=0 notice) | 12/500 | 223.9 pt |
| still_reopening (round-1 text) | 12/500 | 215.0 pt |
| still_reopening (shipped) | 12/500 | 110.0 pt |
| still_reopening (this round ask) | 12/500 | 214.1 pt |
| still_reopening (round-1 ask) | 12/500 | 235.5 pt |
| resume_refused (round-1 text) | 14/400 | 292.4 pt |
| resume_refused (shipped) | 14/400 | 317.6 pt |
| resume_refused_title (unchanged) | 14/400 | 116.8 pt |

Boxes:
- sheet column: 288.0 pt — 320 pt viewport minus the sheet's px-4 (session-health.tsx:349)

## Fresh independent read
The fresh reviewer re-read the seven remediated values without seeing this audit's findings. It independently found the same MAJOR this audit files as R2-01 (the dropped 'Still reopening' clause and the missing closing danda) and proposed the wording this audit adopts, and it agreed that the resume/reopen split survives the rewrite.

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
