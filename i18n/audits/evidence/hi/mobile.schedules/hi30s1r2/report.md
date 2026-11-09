# Hindi (`hi`) — `mobile.schedules` — round 2 (delta re-audit)

| | |
|---|---|
| Locale | `hi` |
| Namespace | `mobile.schedules` (38 keys) |
| File group | B (four namespaces, 77 keys: this one + `mobile.projects`, `mobile.computers`, `mobile.notifications`) |
| Round | 2 — same-history delta re-audit |
| Parent audit | `hi30s1` (`i18n/audits/evidence/hi/mobile.schedules/hi30s1/`) |
| Audited head | `d4e31b1915b558171ded41501c741568f0854f3f` on `feat/i18n-hindi` |
| Worktree | `/Users/damian/workspace/hi-wave` |
| Date | 2026-10-30 |
| Auditor | `i18n-auditor` (lopdev), session `4d508455ed51`, served model `radient/auto` (fallbacks disclosed in `record.json`) |
| Verdict | **passed** — 0 BLOCKER, 0 MAJOR |

## Scope

Round 1 raised seven findings in this namespace (HI-B-1 MAJOR; HI-B-2, HI-B-3,
HI-B-4, HI-B-5 MINOR; HI-B-6, HI-B-7 NIT). The implementer applied six of them
in `d4e31b1` and deliberately kept the seventh (HI-B-5) as shipped. This round
re-reads the remediation, not the whole namespace: the delta diff, its direct
neighbours (the counters, the empty pair, the parked/gone siblings, the plural
arms) and the mechanical contract the fix touches.

The English source and its sidecars are **byte-identical** to round 1 (all four
group-B `en` and `.context.json` hashes match `hi30s1`'s `input_hashes`), so this
is a same-source delta: only target bytes moved.

## Delta measured, not assumed

The Hindi catalogue was an untracked working-tree directory at round 1, so `git`
cannot diff it. The round-1 audited bytes are reproduced from the audited
snapshot whose sha256 equals `hi30s1`'s recorded `input_hashes.target.sha256`
(`88ac1b6a…291163`) — the transcript prints the pairwise check. Against that
snapshot, at `d4e31b1`:

* `mobile.schedules` — 7 keys changed, `mobile.projects` — 3, and
  `mobile.computers` / `mobile.notifications` — **0** (byte-identical files).
* The seven changed keys are exactly the six applied findings' keys; no
  unrecorded edit exists anywhere in group B.

## Findings: resolution

| ID | Severity | Key | Resolution | Evidence |
|---|---|---|---|---|
| HI-B-1 | MAJOR | `mobile.schedules.truncated` | **resolved byte-exactly** | value equals the recorded replacement character for character |
| HI-B-2 | MINOR | `summary.monitors_armed` | **resolved byte-exactly** | `{count} सक्रिय` |
| HI-B-3 | MINOR | `empty_line.wakes` | **resolved byte-exactly** | `कोई जागृति निर्धारित नहीं।` |
| HI-B-4 | MINOR | `supervisor.not_running`, `supervisor.unsupported` | **resolved** | both now read `नीचे दी गई जागृतियाँ`; the elliptical `नीचे दी` is gone from the namespace |
| HI-B-5 | MINOR | `count.wakes` | **kept as shipped — recorded decision, not a defect** | `{count, plural, one {# जागृति} other {# जागृतियाँ}}` unchanged |
| HI-B-6 | NIT | `parked.wakes`, `parked.monitors` | **resolved** | both siblings now use `फिर शुरू …` |
| HI-B-7 | NIT | `gone.monitors` | **resolved byte-exactly** | `…इसलिए इसे कोई जाँचता नहीं` |

"Byte-exactly" here means the shipped value equals the string this auditor
recorded in `hi30s1/record.json` under that finding's `replacement`, compared in
`delta_resolve.py` with `==`, not with an eyesight check.

## The truncation sentence, re-rendered (HI-B-1)

Rendered through the app's own `renderFor()` with the raw tag `hi` (Hindi
plural rules, not English ones):

```
total=42, wakes     जागृतियों वाली कुल 42 बातचीतों में से 10 दिखा रहे हैं।
total=42, monitors  मॉनिटरों वाली कुल 42 बातचीतों में से 10 दिखा रहे हैं।
total=9,  wakes     जागृतियों वाली कुल 9 बातचीतों में से 5 दिखा रहे हैं।
total=9,  monitors  मॉनिटरों वाली कुल 9 बातचीतों में से 5 दिखा रहे हैं।
total=2,  wakes     जागृतियों वाली कुल 2 बातचीतों में से 1 दिखा रहे हैं।
total=1,  wakes     जागृतियों वाली कुल 1 बातचीत में से 0 दिखा रहे हैं।
old (round 1) @42   जागृतियाँ वाली कुल 42 बातचीत में से 10 दिखा रहे हैं।
```

Both requested counts (42 and 9) select `other` — `Intl.PluralRules('hi')`
returns `other` for 9 and 42, `one` only for 0 and 1 — so both render the
oblique plural `बातचीतों`, and the family noun is the oblique `जागृतियों` /
`मॉनिटरों` before `वाली`. The two case errors round 1 named are both gone, and
the composed output is correct at 1 and 2 as well.

## Did the `{total}` escalation break the generator's type contract?

No — but it is a real contract change and it is worth stating precisely.

* **Generator rule.** A locale may turn a plain placeholder into a
  plural/select node, never the reverse and never across plural↔select
  (`scripts/i18n/generate.ts`, "WHY A KIND MAY ONLY ESCALATE"). English has
  `{total}` as a plain placeholder; `hi` now has `{total, plural, …}`. That is
  the permitted direction, and `node scripts/i18n/generate.ts --check` exits 0
  ("catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from
  en, es, fr, hi, ru, vi, zh-CN)"). The verifier prints exactly one escalation
  and no other kind drift across all 77 group-B keys.
* **CLDR completeness.** `hi` has the categories `one`/`other`, and the node
  carries both plus `#`. No locale-selectable category is missing.
* **Generated type.** "Strictest kind wins" narrowed the key's parameter from
  `{ total: string | number; … }` to `{ shown: number; total: number; family: string }`.
  That is a tightening, not a relaxation: `renderFor` now **throws** on a string
  `total` (`RangeError: … needs a number for "total", received "42"`), which is
  the behaviour the plural arm needs.
* **Call sites.** `truncatedClause(family, shown: number, total: number)`
  (`schedules-copy.ts:255`) already declares `total: number`, and both call sites
  pass `wakes.total` / `monitors.total`, which are numbers. `tsc --noEmit` exits
  0 over the whole app, so no call site breaks. A future caller that passed a
  numeric string would now be a compile error — correct, and the reason the
  escalation is safe rather than merely permissive.

## Regression checks on the neighbours (HI-B-2, HI-B-3)

Counters, rendered:

| Key | Value |
|---|---|
| `summary.monitors_armed` | `0 सक्रिय` · `1 सक्रिय` · `2 सक्रिय` · `22 सक्रिय` |
| `summary.wakes` | `0 निर्धारित` · `2 निर्धारित` · `22 निर्धारित` |
| `summary.monitors_attention` | `9 में से 2 को ध्यान चाहिए` |
| `tail.failed` | `1 विफल` |
| `count.monitors` | `0 मॉनिटर` · `2 मॉनिटर` |
| `empty.title` | `कुछ भी सक्रिय नहीं` |
| `empty_line.monitors` | `कोई मॉनिटर सक्रिय नहीं।` |
| `empty_line.wakes` | `कोई जागृति निर्धारित नहीं।` |

The new `{count} सक्रिय` has the same `[number] [invariant adjective]` shape as
its two siblings `{count} निर्धारित` and `{count} विफल`, and it now uses the same
word, `सक्रिय`, as the empty heading and the monitors empty line — the split
round 1 objected to (`चालू` in one place, `सक्रिय` in two) is gone. Rows keep
their own state words (`बंद` disabled, `निष्क्रिय` dormant, `समाप्त` expired,
`पुराना` stale, `प्रतीक्षारत` waiting); none of them collides with the header.

One point considered and **not** raised: `सक्रिय` (armed) is now the antonym of a
row's `निष्क्रिय` (dormant), so a dormant row may sit under a header reading
`2 सक्रिय`. English ships the same tension ("2 armed" above "dormant"), and the
armed header is only the no-attention variant, so this is a property of the
source copy rather than a translation defect. Keeping the source's framing is
the right call.

`empty_line.wakes` moved to `निर्धारित`, which is the same adjective as
`summary.wakes`; the noun `शेड्यूल` stays where the glossary puts it
(`read_unreachable`, "this machine's schedules"). That is the intended split —
adjective in the counter and its empty line, glossary noun for the collection —
not term drift.

## HI-B-5 — position, not re-litigation

`0 जागृति` stands. My round-1 position is unchanged: `one` covering 0 and 1 is
Hindi's own treatment of zero, CLDR and the `hi` style guide both say so, and it
is now pinned by a test (`src/i18n/__tests__/runtime.test.ts` asserts
`renderFor(…, {count: 0}, "hi") === "0 जागृति"`). I record the durable
consequence rather than a finding: changing that form later is a test edit, not
a catalogue-only edit.

## Mechanical

* `node scripts/i18n/generate.ts --check` → exit 0 (see above).
* `node scripts/i18n/check-strings.ts` → exit 0, "284 finding(s), all baselined;
  0 new; no growth vs 647581a4abd5".
* Independent structural verifier over all 77 group-B keys → 0 problems, 1
  accounted escalation; placeholder name sets identical, select arms identical,
  every plural node carries `one` + `other`, key order identical to English,
  NFC clean, no ZWJ/ZWNJ/bidi controls, no doubled spaces.
* Verifier negative controls: 8/8 as expected (dropped placeholder, dropped `one`
  arm, plural↔select crossing, renamed select arm, ZWJ, precomposed U+095E,
  renamed plural placeholder, and an unchanged copy that must pass).
* Affected tests: `vitest run src/i18n src/features/schedules src/features/projects`
  → 7 files, 188 tests passed, exit 0. `tsc --noEmit` exit 0.
* Nukta spelling stays base + U+093C throughout; the precomposed U+0958–U+095F
  block appears nowhere.

## Fit

The rendered truncation line is 34 cells at total=42 and 32 at total=9, against
42 and 40 for the English sentence — narrower than English, so any budget sized
for the source holds. The template string grew only because the plural node's
syntax is not visible text. `{count} सक्रिय` is 6 cells against English's 7.

## Honest limits

One independent auditor read this delta; no second independent pass and no
rendered UI frame are claimed. The round-1 second pass covered the same keys and
the delta changes only fragments inside them. Every command cited here is in
`audit.log`, which is the executed transcript, not a note.
