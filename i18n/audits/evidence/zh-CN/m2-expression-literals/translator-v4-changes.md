# zh-CN M2 v4 — round-2 remediation delta

- Translator: i18n-translator; session `026e4d956e4c`; actual served model `openai/gpt-6.1-sol` (session header); no fallback observed.
- Lane: narrow copy fix, <2 h. Candidate only, not audited or approved. No self-audit, MT, repository edits, commits or ledger writes.
- Input: `zh-CN.v3.json`; source and sidecar extract `keys33.json`; independent report `~/.local-operator/sessions/ab999e693853/scratchpad/audit-zh-CN-R2-A2.md`.
- Rules read: core `i18n/style-guides/zh-CN.md`, `i18n/glossary.md`, `docs/I18N.md`, accepted RFC. Product name and placeholders preserved.

## Accepted changes (only three values)

| Finding / key | Before | After | Evidence / decision |
|---|---|---|---|
| MAJOR-1 `mobile.session.tray.context_short` | `ctx{percent}%` | `上下文{percent}%` | English sidecar explicitly permits full word where no native short form exists. Chinese 上下文 is established in the catalogues; ctx is not. At 21%: 6 → 9 cells; same as the wide plain form. |
| MINOR-1 `mobile.session.tray.context_short_estimate` | `ctx{percent}%（约）` | `上下文{percent}%（约）` | Keeps native context term and estimate meaning; 12 → 15 cells at 21%, versus wide `上下文21%（估算）` at 17. Narrow form remains 2 cells shorter. At 100%: 16 versus 18; at 0%: 14 versus 16. |
| MINOR-2 `mobile.session.region.label_working` | `活动` | `动态` | Actual English is the noun “activity,” not adjective “active.” 活动 can also be a noun, so the auditor's blanket semantic claim is too strong. Nevertheless 动态 more clearly names ongoing agent updates rather than events/activities in this band; complete cue `动态在下方 · 向下滚动 ↓` reads naturally. Both labels are 4 cells. Source wiring and sidecar confirm this is a hidden-region noun, not an active-state label. |

## Identifier correction (values otherwise unchanged)

In the same source positions, changed `mobile.session.region.label.working`, `.subagents`, `.todos`, `.strip` to `mobile.session.region.label_working`, `label_subagents`, `label_todos`, `label_strip`. This matches the actual English catalogue, sidecar, and `REGION_LABEL` map; the latter three retain 子智能体 / 任务 / 状态 exactly.

## Evidence derived here

Read actual candidate branch `~/local-operator-mobile/.worktrees/i18n-m2-scanner` at `9d99fa0f`: `app/(app)/session/[id].tsx` contextFact lines 130–146 and calls around 921–925 / 1002–1006 select narrow below 340 pt; region map 1099–1103 uses the underscore names; lines 1398–1404 interpolate region labels joined with ` · `. English catalogue and context sidecar under `src/i18n/catalogues/en/mobile.session*.json` corroborate these keys and meanings.

Recounted all non-context zh-CN JSON catalogue string values, using literal substring occurrence counts (not distinct key counts):

| Read scope | Files | Values | ctx | 上下文 | 活动 | 动态 |
|---|---:|---:|---:|---:|---:|---:|
| mobile `.worktrees/i18n-app-scan/src/i18n/catalogues/zh-CN` | 21 | 649 | 0 | 2 | 1 | 0 |
| core `local_operator/i18n/catalogues/zh-CN` | 93 | 3219 | 0 | 25 | 12 | 1 |

The only core 动态 occurrence is `wire.settings.display_shimmer.help` = `工作行上的动态光泽。`; it is not a pre-existing activity-label translation. Thus the label change is a contextual editorial choice, not claimed shipped term parity. Existing 活动 occurrences do not establish a binding glossary choice for this new region noun.

Widths computed with Python `unicodedata.east_asian_width`: W/F characters 2 cells, other characters 1, after replacing `{percent}` with the actual number. These are cell counts, NOT measured React Native point widths. No rendered-fit or browser/native proof claimed; independent design/QA must confirm the 15-cell estimate on the narrow surface. The plain fact's 9-cell count is verified; “within the band” remains the supplied audit's layout assessment, not a fresh render here.

## Validation (executed)

Python3-compatible mechanical validation: PASS — 33 keys; source order with exactly four requested underscore renames; placeholders per key equal English; no empty/edge-whitespace values; all NFC; English-identical only `Local Operator`; exactly three changed values; ctx absent from every value. Read-back repeated after writing.

`cd ~/local-operator-mobile/.worktrees/i18n-m2-scanner && node scripts/i18n/generate.ts --check`

Exit 0, actual stdout:
```
src/i18n/catalogue.gen.ts is current (642 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
```
Node emitted a MODULE_TYPELESS_PACKAGE_JSON warning and reparsed messages.ts as ES module. This checks the existing repository catalogue, not the unintegrated scratch candidate; the separate Python checks validate this 33-key candidate. No generated files were written.

## Declined / remaining / glossary proposals

- No requested value fix declined. Conditional NIT (number-first if ctx survives) is moot: no ctx survives.
- Did not apply other audit findings: task explicitly limits accepted fixes and the four identifier corrections.
- Proposed contextual glossary additions only (not edits): context window/context → 上下文; activity (ongoing agent-update band) → 动态. No universal replacement of 活动 is proposed.
- Independent audit remains required; status is translated, never passed. No final audit evidence record fabricated for this translator-only scratch delta.
