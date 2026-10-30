# Independent Russian delta re-audit — `mobile.schedules` (`ru29s1r2`)

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR. `unresolved_blocker_major_count = 0`.
Round-1 findings: **RU-SCH-1 fixed byte-exactly, RU-SCH-2 fixed byte-exactly, RU-SCH-3 fixed with a
wording deviation (verified), RU-SCH-4 not applied** (NIT, carried open, non-gating).

- **Audited head:** `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88` (branch `feat/i18n-russian`, worktree
  `/Users/damian/workspace/ru-wave`). At this head the ru catalogue is **committed**: `git ls-tree -r HEAD
  -- src/i18n/catalogues/ru` lists all 10 files (executed in `audit.log`, coda), and the worktree is clean
  for the catalogues and the projection. This audit wrote only this evidence bundle — no catalogue byte
  was edited and nothing was committed.
- **Auditor:** `i18n-auditor` (lopdev team), session `d598a29e6e64`. **Actual model `radient/auto`.** The
  request opened on `anthropic/claude-sonnet-5-5` and fell back through `openai/gpt-6-astra` and
  `kimi/k3.1-pro` on provider quota before reaching `radient/auto`; every command in `audit.log` ran under
  the final model. Disclosed, not hidden.
- **Independence:** a different agent, session and context from the translator. Not model-diverse — the
  translator's supplied model is also `radient/auto` — so independence is agent/session, disclosed rather
  than closed. No human native-speaker review and no rendered UI frame are claimed.
- **Inputs:** en `0459a048…c575f` · context `d3f0d3bb…9aa92` · ru `f95a0e21…c97090` · 38 keys.
  The en and context files are **byte-identical to round 1** (`ru29s1`'s recorded hashes, re-verified in
  `audit.log`), so the source the fixes target did not move; only the target changed, from
  `2c56881e…b22508` to `f95a0e21…c97090`.
- **Delta scope, proved not asserted:** inverting exactly the applied fixes in the shipped file
  reproduces the round-1 audited bytes' SHA-256 `2c56881e…b22508` (`scope.py`, `SCOPE_EXACT` in
  `audit.log`). The delta in this namespace is therefore exactly `cadence.left`, `summary.monitors_armed`,
  `parked.wakes` and `parked.monitors`; no other byte in the file moved.

## Mechanical — the repo gate and the harness

- `npm run -s i18n:catalogue:check` → **exit 0**: "`catalogue.gen.ts` is current (143 keys, 10 namespaces,
  argument types from en, es, fr, **ru**, zh-CN)". ru is now part of the strictest-reading type surface.
- `npm run -s i18n:check` → **exit 0**: the catalogue check plus "check-strings: 284 finding(s), all
  baselined; 0 new; no growth vs `ba39018c493d`".
- `vitest run src/i18n/__tests__/catalogues.test.ts` → **39 passed (39)**. Round 1 could only report
  1 failed / 37 passed here, because ru was a directory without being shipped; the flip closed that gate.
- Keys: 38/38 in en, ru and the sidecar; no missing, none extra, authoring order identical, no duplicate
  key in the JSON text, no context gap.
- Every message parses through the app's own `parseMessage`. **Zero** unsanctioned parameter or arm
  differences (`paramOrArmProblems: []`). The six round-1 recorded `text → plural` escalations persist —
  `cadence.left` among them — each with a plural-vs-text counterpart on the English side and sanctioned by
  `generate.ts` parameter-parity. Every ru plural carries one/few/many/other; every select keeps the
  source's arm set (`truncated` wakes/other); no bidi or zero-width characters; «ёлочки» and `…` only.

## RU-SCH-1 — `mobile.schedules.cadence.left` — FIXED, byte-exact

Shipped bytes are the prescribed bytes, byte for byte:

```
{cadence} · {remaining, plural, one {осталось #} few {осталось #} many {осталось #} other {осталось #}}
```

Executed at the counts the round-1 record used (the plural selector is the app's `formatMessage`, ru
`Intl.PluralRules`):

| 0 | 1 | 2 | 5 | 11 | 21 | 22 | 101 | 1.5 |
|---|---|---|---|---|---|---|---|---|
| раз в 1d · осталось 0 | **раз в 1d · осталось 1** | … 2 | … 5 | … 11 | **… 21** | … 22 | … 101 | … 1.5 |

The gender flip is gone: the last delivery, the state the row sits in longest, now reads «осталось 1»
like every other count. The composition is the real one (`wakeCadenceWord(240000, remaining)`):
«раз в 4m · осталось 3 / осталось 1», «… доставок больше нет» at 0, «раз в 4m» at null, «однократно» at
none. Core's twin `tui.schedule.ends_left` is the same uniform «осталось #» — read at core `89f2beda693`,
`local_operator/i18n/catalogues/ru/tui.schedule.json:16` (executed in `audit.log`).

**The regression the four identical arms could have introduced, checked:** the plural node still types
the argument as a number. `catalogue.gen.ts` line 388 reads
`"mobile.schedules.cadence.left": { cadence: string | number; remaining: number };`, the parser reports
`remaining: plural`, and the negative control — feeding a string through the same parser/renderer —
throws `RangeError: Message "{n, plural, one {# x} other {# x}}" needs a number for "n", received "1"`.
The arms are byte-identical (`cadence_left_arms_identical: true`), so the node is now grammar-neutral in
Russian; keeping it is deliberate — it mirrors core's `ends_left`, and dropping it would *loosen* the
call-site type from `number` to `string | number`. Recorded as a considered-and-accepted call, not a
finding.

## RU-SCH-2 — `mobile.schedules.summary.monitors_armed` — FIXED, byte-exact

Shipped: `{count, plural, one {# активный} few {# активных} many {# активных} other {# активных}}`,
identical to the prescription. Executed:

| 0 | 1 | 2 | 5 | 11 | 21 | 101 | 1.5 |
|---|---|---|---|---|---|---|---|
| **0 активных** | 1 активный | 2 активных | 5 активных | 11 активных | **21 активный** | 101 активный | 1.5 активных |

The reachable zero is fixed where round 1 measured it: `monitorSectionSummary([])` → **«0 активных»**
(and «5 активных» for five rows), so the section header reads «Monitors · 0 активных» instead of
«0 активны». The label «Monitors»/«Wakes» beside it is still hard-coded English in `schedules.tsx`
(out-of-scope in this wave for every locale; recorded in round 1).

## RU-SCH-3 — `parked.wakes` + `parked.monitors` — FIXED with a wording deviation (not byte-exact)

The defect — a possessive with no antecedent in an impersonal clause — is gone, but the shipped wording
is **not** the prescribed wording in either arm:

| key | round-1 (defect) | prescribed | shipped |
|---|---|---|---|
| `parked.wakes` | …возобновятся после **её** следующего хода | …после следующего хода | …после следующего хода **этой беседы** |
| `parked.monitors` | …когда **её** беседа снова запустится | …когда **эта** беседа снова запустится | …когда снова запустится **эта** беседа |

Verified, not assumed: both shipped clauses now name the referent, the genitive government holds
(«после хода **этой беседы**»), the monitors clause's verb-first order is idiomatic Russian, and the
meaning matches the English ("after its next turn" / "when its conversation runs again"). Executed
through `parkedWakesClause()` / `parkedMonitorsClause()`.

Cost, measured on the same basis as round 1 (AppKit `.AppleSystemUIFont`, text-meta 12/500, 288 pt of
content at a 320 pt device): 515.6 pt vs 453.9 pt for the old clause and 436.4 pt for the prescribed one;
**still 2 wrapped lines** at base size, and the entry head is unclamped by design (`schedules.tsx:379`
and `:450` carry no `numberOfLines`; the clamp was removed for exactly this sentence). At 200 % text
scale it is 5 lines vs 4 for the prescribed wording and 2 for English — a density cost, not a truncation.
Accepted as a benign deviation and **not filed as a finding**: no rule is violated, nothing clips, and
the wording is defensible Russian.

## RU-SCH-4 — `mobile.schedules.empty.body` — NOT APPLIED (NIT, carried open)

The shipped body still reads «…мониторы следят за **одним объектом** и сообщают об изменениях»; the
prescribed «за чем-то одним» was not applied and no rejection is recorded anywhere in the shipped commit.
The NIT stands as round 1 stated it («объект» reads as a facility or a code object rather than the thing
being watched). It does not gate a pass and does not change what the reader can do.

## Regression sweep — the neighbours of both changed keys

Every plural in the namespace was re-rendered at 0/1/2/5/21/1.5 and matches the round-1 table byte for
byte: `count.wakes` («0 пробуждений / 1 пробуждение / 2 пробуждения / 5 пробуждений / 21 пробуждение»),
`count.monitors`, `show_more.wakes/monitors`, `tail.failed`, `summary.monitors_attention`
(«1 из 3 требует внимания»). Composition through the real call sites is unchanged:
«3 пробуждения · далее через 4m», «3 пробуждения · просрочено на 2h»,
«Беседы с пробуждениями: показано 2 из 5.», the three supervisor leads, the gone clauses and the empty
body. `monitorSectionSummary` at 0 and 5 is the only behavioural change, and it is the fix.

The other three group-B namespaces were re-checked in the same run: `mobile.notifications` and
`mobile.computers` are **byte-identical** to their round-1 audited bytes; `mobile.projects` is covered in
`ru29p1r2`.

## Fit

| string | width | lines @288 pt | lines @200 % |
|---|---|---|---|
| parked.wakes (shipped) | 515.6 pt | 2 | 5 |
| parked.wakes (prescribed) | 436.4 pt | 2 | 4 |
| parked.monitors (shipped) | 485.1 pt | 2 | 5 |
| en parked.wakes | 243.4 pt | 1 | 2 |
| cadence.left «раз в 1d · осталось 21» | 129.4 pt | 1 | 1 |
| monitors_armed «21 активный» | 74.3 pt | 1 | 1 |

No unbreakable token exceeds its slot; nothing is clamped in the schedules list. These are font metrics,
not pixels (`widths.tsv`).

## What was not verified

- No rendered frame, simulator or screenshot: the widths above are CoreText advances, not painted pixels.
- No human native-speaker review.
- No second independent pass was requested for this delta; the round-1 second pass (`c6f22d89a9c1`)
  covered these same namespaces and contributed RU-SCH-3.

## Record

`i18n/audits/evidence/ru/mobile.schedules/ru29s1r2/record.json` is the machine-readable record;
`audit.log` is the executed transcript (group-wide: all four group-B namespaces, identical in the four
delta bundles, nothing filtered); `widths.tsv` and `control.txt` are the measurements and the negative
controls it cites; `verify.out.json` is the harness's full output; and `verify.mjs.txt`,
`control.mjs.txt`, `scope.py.txt` and `measure.swift.txt` are the harness sources, so every number in
this report can be re-derived from bytes inside this bundle rather than from a session scratch path.
