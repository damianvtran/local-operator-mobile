# Delta audit (round 2) — ru / mobile.home (ru30a1r2)

**Verdict: `passed`** — 3 of 3 round-1 findings fixed byte-exactly and re-measured inside the row; 1 new MINOR (non-gating) on the same key; no BLOCKER and no MAJOR

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.home` |
| Keys | 27 (English = target = context) |
| Branch / head | `feat/i18n-russian` / `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88` |
| Round-1 bundle | `i18n/audits/evidence/ru/mobile.home/ru30a1/` |
| Auditor | i18n-auditor (lopdev team), session c9aa2aca8837, **radient/auto** — same agent as round 1; the self-review is disclosed in record.json |
| Second independent pass | reviewer (lopdev team), job d473234f21a9, radient/auto (pinned anthropic/claude-opus-5-5) |
| Machine translation | none |

## Round-1 findings, re-checked against the shipped bytes

| Round-1 id | Severity | Key | Byte-exact vs prescription | Status |
|---|---|---|---|---|
| ru30a1-F1 | MAJOR | `mobile.home.tip.parallel` | yes | fixed |
| ru30a1-F2 | MAJOR | `mobile.home.tip.schedule` | yes | fixed |
| ru30a1-F3 | MAJOR | `mobile.home.tip.search` | yes | fixed |

## Round-1 findings in detail

### ru30a1-F1 — `mobile.home.tip.parallel` (fixed)

- **Prescribed (round 1):** попросите раздать работу субагентам
- **Shipped at this head:** попросите раздать работу субагентам
- **Byte-exact vs the prescription:** yes
- **Width of the value round 1 rejected → the value shipped now:** 296.2 pt → 234.3 pt
- **Judgement:** Both defects the finding named are cured. The overflow: 296.2 -> 234.3 pt at 12 pt/500, which is inside the ~270 pt text box the row leaves after its 12 pt icon and gap-1.5, and below English's own 267.7 pt maximum. The reversed relation: «раздать работу субагентам» puts the subagents in the dative as the recipients the work is distributed to, where «для субагентов» read as 'for their benefit'. Residual: the source's «parallel» is not carried — r2-F1.

### ru30a1-F2 — `mobile.home.tip.schedule` (fixed)

- **Prescribed (round 1):** настройте запуск промпта по расписанию
- **Shipped at this head:** настройте запуск промпта по расписанию
- **Byte-exact vs the prescription:** yes
- **Width of the value round 1 rejected → the value shipped now:** 313.8 pt → 258.0 pt
- **Judgement:** 313.8 -> 258.0 pt: 12 pt more headroom than the row needs and 9.7 pt below the English maximum. The idiomatic defect is gone too — «настроить запуск … по расписанию» replaces the non-collocation «поставьте расписание».

### ru30a1-F3 — `mobile.home.tip.search` (fixed)

- **Prescribed (round 1):** поищите сессию в прошлых беседах
- **Shipped at this head:** поищите сессию в прошлых беседах
- **Byte-exact vs the prescription:** yes
- **Width of the value round 1 rejected → the value shipped now:** 306.0 pt → 223.3 pt
- **Judgement:** 306.0 -> 223.3 pt, 44.4 pt below the English maximum. The scope error is gone: «в прошлых беседах» searches *inside* past conversations, where «поищите прошлые беседы» made them the object searched for.

## Delta findings

### r2-F1 — MINOR, `mobile.home.tip.parallel`

- **Current:** попросите раздать работу субагентам
- **Problem:** Accurate as a delegation hint, but it has lost the source's «parallel», which is the point of the trick — the reason to fan out is concurrency. It also diverges from the product's own settled rendering of the very same tip: core's `tui.welcome.tip.subagents` (EN "Ask for parallel work and the agent fans out subagents") ships as «Попросите параллельную работу — агент запустит субагентов», which uses neither of this value's words. Two surfaces teaching one trick with two vocabularies. Note the shape of the trade: no wording that fits the ~270 pt box carries «ask» + «parallel» + «subagents» at once — the three-element candidates measure 280.6 / 304.2 / 315.8 pt and the core sentence itself 380.7 pt.
- **Recommended:** попросите раздать работу параллельно — measures 242.4 pt
- **Alternative:** попросите параллельную работу — 200.4 pt

**Measured options** (12 pt/500, against the ~270 pt text box):

| Candidate | Width | Note |
|---|---|---|
| попросите раздать работу параллельно | 242.4 pt | **recommended** — one-word swap on the shipped value |
| попросите распараллелить работу | 211.4 pt | clearest single verb; a technicalism, names neither mechanism nor subagents |
| попросите параллельную работу | 200.4 pt | matches core's clause exactly; loses the mechanism |
| попросите запустить субагентов параллельно | 280.6 pt | rejected — clips the ~270 pt text box |
| запустите субагентов параллельно | 213.4 pt | rejected — a user cannot launch subagents |

- **Gating:** MINOR — non-gating. What is missing is the concurrency qualifier, not the meaning; the chip still points at the right mechanism.

## Considered and accepted (no change requested)

- `mobile.home.tip.schedule` — «on a timer» is folded into «по расписанию»; a wake fires a prompt at a time, so the schedule sense is the accurate one and no separate timer noun is needed.
- `mobile.home.tip.search` — «to reopen a session» becomes the object («сессию») rather than a purpose clause; spelling the outcome out measures 382.9 pt, so the compression is width-bound and the tap supplies the reopen.
- `the 24 unchanged keys` — identical bytes and identical English/context sidecars, so round 1's accepted-as-is judgements (the 26-character chip, «Разбудите меня») carry over byte-for-byte rather than being re-litigated.

## What was executed

`audit.log` is the captured `bash set -x` transcript of, in order: `git rev-parse` for branch and commit; `shasum -a 256` of the ru catalogue; the repository's own copy gate in both halves — `npm run -s i18n:catalogue:check` (`scripts/i18n/generate.ts --check`: the generated projection matches the JSON authoring source, every message parses, and every locale directory defines exactly the English keys namespace by namespace) and `npm run -s i18n:strings:check` (`scripts/i18n/check-strings.ts` against the shrink-only baseline); `node verify.mjs <namespace>`, which reads the strings through the repo's OWN parser and renderer (`parseMessage` / `formatMessage` / `pluralCategory`) and checks placeholder names and types, plural arms against `Intl.PluralRules('ru')`, code tokens, product names, typography and the rendered value of every key; and `node verify.mjs --negative`, thirteen injected defects each of which must be caught. `diff-vs-round1.txt` is the per-key comparison of these bytes against round 1's own rendered output, which is what binds the delta to the earlier audit.

## Independence and self-review

This is the SAME agent and session as round 1, grading replacements it prescribed itself. Disclosed, not papered over. Mitigations: every shipped value is compared BYTE-WISE with this session's own record.json rather than with prose; every width is re-measured on the same harness, whose two controls (the repo's recorded 189.4 pt Spanish chip, and the round-1 strings re-measuring to 296.2 / 313.8 / 306.0 / 316.0 pt) show the method is unchanged; and an independent second pass judged all seven delta strings from the guide, glossary and English only, without seeing this session's conclusions. It dissented on two of the seven, and this auditor rejected one of its replacement proposals on measurement.

## What could not be verified

- Figtree is not installed on this machine, so CoreText widths fall back to the system sans face and absolute points are approximate. Two controls make the ratios sound: the harness reproduces the repository's own recorded 189.4 pt Spanish-chip measurement to the tenth of a point, and it re-measures the round-1 strings to round 1's exact figures (296.2 / 313.8 / 306.0 pt for the three tips, 316.0 pt for the old placeholder), which is the evidence that this round used the same method.
- No rendered frame was captured: this is a copy audit and the app was not built or driven. A UI reviewer still has to look at the ru strings in a build; these are text advances, not screenshots.
- The 320 pt figures are derived, not captured: the composer's own chrome is subtracted from the viewport — mx-3 (12 pt each side) + px-2 (8 pt each side) + the two hairline borders = 42 pt — and the sidecar records the field at ~348 px at 390 pt, which is the same 42 pt, so 320 pt leaves 278 pt. The tip row's ~270 pt text box (the 288 pt row minus the 12 pt Info icon and gap-1.5) is round 1's own note, carried forward because the layout did not change.
- This delta round is bounded by design: it re-judges the changed values and re-runs the mechanical suite over every key of the namespace, and it carries the round-1 linguistic verdict for the unchanged keys because their bytes are identical (proved by sha256) and their English source and context sidecars are byte-identical to round 1 too.
- Independence is disclosed rather than claimed: this auditor is the same agent and session as round 1 and is therefore grading its own prescriptions.
