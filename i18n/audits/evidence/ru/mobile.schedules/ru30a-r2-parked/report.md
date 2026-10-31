# Delta audit (round 2) — ru / mobile.schedules (ru30a-r2-parked)

**Verdict: `passed`** — both parked clauses clean; RU-SCH-3's dangling pronoun cured more thoroughly than the prescription asked, with core precedents verified (2 of 38 keys — not a namespace verdict)

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.schedules` |
| Keys | 38 (English = target = context) |
| Branch / head | `feat/i18n-russian` / `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88` |
| Round-1 bundle | `i18n/audits/evidence/ru/mobile.schedules/ru29s1/` — another auditor's; this bundle does not supersede it |
| Auditor | i18n-auditor (lopdev team), session c9aa2aca8837, **radient/auto** — same agent as round 1; the self-review is disclosed in record.json |
| Second independent pass | reviewer (lopdev team), job d473234f21a9, radient/auto (pinned anthropic/claude-opus-5-5) |
| Machine translation | none |

## Why this bundle exists

The group-A delta round was asked to check for regressions introduced by the remediation, and the remediation rewrote the two parked clauses beyond RU-SCH-3's prescription: it kept an explicit referent («эта беседа» / «этой беседы») where the prescription deleted it. Both are judged afresh here. This is NOT a namespace audit — ru29s1 remains the audit of `mobile.schedules`, and its own delta round belongs to its auditor (session 3cb03947a304, whose empty `ru29s1r2/` directory was visible in the tree while this ran). Nothing here overrides that record.

## The two values, judged from scratch

| Key | English | Shipped ru | Verdict |
|---|---|---|---|
| `parked.monitors` | Parked — monitors resume when its conversation runs again | Приостановлено — мониторы возобновятся, когда снова запустится эта беседа | clean |
| `parked.wakes` | Parked — wakes resume after its next turn | Приостановлено — пробуждения возобновятся после следующего хода этой беседы | clean |

**Accuracy.** Both match their sidecar notes exactly. The monitors clause says the conversation must *run* again («когда снова запустится»); the wakes clause says *next turn* («после следующего хода»). Neither says 'when you open it' — which the wakes note forbids in those words — and the check asserts the absence rather than assuming it.

**The rewrite is an improvement, not a deviation to regret.** RU-SCH-3's actual complaint was a dangling «её» with no antecedent in the clause; deleting the pronoun cured the symptom. Keeping it as a demonstrative («эта беседа», «этой беседы») cures the same defect and preserves the source's referent — the English says *its* conversation and *its* next turn, so the reader learns which conversation resumes. Fixed in substance, and better than byte-exact compliance with the prescription.

**Terminology, checked against core rather than assumed.** «беседа» is core's word for a conversation (100+ uses). «монитор» is core's countable object noun for a stored monitor (`wire.settings`: «на каждый монитор», «монитор отключается»), against «мониторинг» for the activity; this clause counts objects, so the glossary's citation form is honoured in its countable sense rather than breached. «следующего хода» reproduces core's own «Изменения действуют со следующего хода», and «запустится» matches core's word for a running session («Запущена на вашем компьютере»).

## Width — why two lines is not a defect

Measured at 12 pt/500 on the same harness (`widths-delta.tsv`): `parked.monitors` 485.1 pt and `parked.wakes` 515.6 pt against a 288 pt row at a 320 pt phone, so both wrap to two lines. That is designed behaviour, not truncation: the clause renders as `<Text className="text-meta text-ink-dim">` with NO `numberOfLines` clamp, and `schedules.tsx` says in terms that THE CLAUSE WRAPS deliberately because a clamp clipped it mid-sentence at 135/200 % text scale (audit U-04/U-07). The siblings are wider still and ship: es `parked.monitors` is 520.5 pt and fr 502.0 pt, both longer than either ru clause, and English's own `parked.monitors` (347.8 pt) already exceeds the 288 pt row at the narrowest width. ru is not the outlier, and nothing is clipped.

## One observation outside this bundle's scope

Checking the remediation's fidelity to RU-SCH-3 turned up two neighbours in the same namespace: RU-SCH-1 (`cadence.left`) and RU-SCH-2 (`summary.monitors_armed`) ARE byte-exact, but RU-SCH-4 (NIT, `empty.body`) is NOT — the shipped value keeps «следят за одним объектом» where the prescription had «за чем-то одним». That finding and its disposition belong to ru29s1's auditor; it is recorded here only because this round noticed it while binding the parked clauses, and a manager told that 'every prescribed replacement landed' should know two of the four did not land byte-exactly.

## What was executed

`audit.log` is the `bash set -x` transcript: branch and commit, the sha256 of the ru `mobile.schedules` catalogue, then `parked-check.mjs` (stored here as `parked-check.mjs.txt`), which reads both values through the repo's own `parseMessage`/`formatMessage` and asserts: nothing to substitute or pluralise; the rendered value is byte-identical to the stored one; the guide's spaced em dash; no ASCII hyphen or en dash standing in for it; no trailing full stop; no ASCII dots or ellipsis; no exclamation; no straight quotes; terminal punctuation parity with English; sentence case; Cyrillic with no Latin smuggled in; and each sidecar's explicit requirement (next turn / runs again) together with the absence of 'when you open it'. It ends with `2 keys, 0 failed`.

## What could not be verified

- Figtree is absent, so widths come from the system face; the harness's calibration controls are recorded in the group-A records.
- No rendered frame was captured: the app was not built or driven, so these are text advances and parse-level checks, not screenshots.
- This bundle judges 2 of 38 keys and deliberately claims no namespace verdict.
