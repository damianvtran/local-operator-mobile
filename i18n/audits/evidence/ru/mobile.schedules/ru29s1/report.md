# Independent Russian audit — `mobile.schedules` (`ru29s1`)

**Verdict: `changes_requested`** — 2 MAJOR, 1 MINOR, 1 NIT. `unresolved_blocker_major_count = 2`.

- **Audited head:** `ba39018c493dda114d42a6b4d9dfbf337f4110f5` (branch `feat/i18n-russian`, worktree `/Users/damian/workspace/ru-wave`).
  The tree carries `M src/i18n/catalogue.gen.ts` and `?? src/i18n/catalogues/ru/`: the ru directory is
  untracked at this commit (`git ls-tree HEAD -- src/i18n/catalogues/ru` is empty, executed in `audit.log`),
  so the audited target bytes are pinned by `input_hashes.target.sha256`, not by the commit.
  `catalogue.gen.ts` is modified and in sync — `i18n:catalogue:check` passes.
- **Auditor:** `i18n-auditor` (lopdev team), session `3cb03947a304`. **Actual model `radient/auto`.** This request
  began on `anthropic/claude-sonnet-5-5` and fell back through `openai/gpt-6-astra` and `kimi/k3.1-pro` on
  provider quota before reaching `radient/auto`; every command in `audit.log` ran under the final model.
  Disclosed, not hidden.
- **Independence:** a different agent, session and context from the translator. Not model-diverse — the
  translator's supplied model is also `radient/auto` — so independence is agent/session, disclosed rather
  than closed. No human native-speaker review and no rendered UI frame are claimed.
- **Inputs:** en `0459a0485ceb2594c60a152a8dbdc5035689ade05ac370134f8e37be6abc575f` · context `d3f0d3bba057aacf4d3495b3d5eec2471d66b6d6c011b50834a1f58a0839aa92` · ru `2c56881e8200d365d75d04362fd9cbda46f0b942b9fe6a584a64062234b22508` · 38 keys.
- **Ledger:** not recorded — this repository has no i18n ledger and no audit-ledger command at this head
  (executed in `audit.log`); `docs/i18n.md` makes the pull request's report the artifact of record.
  A row is proposed in `record.json`, not written.

## Mechanical (self-verified, not just the repo validator)

`npm run -s i18n:check` exits 0 (projection current, 284 baselined literals, 0 new). The repo validator does
**not** compare placeholders or CLDR arms across locales, so every key was compared itself:

- 77/77 keys across the four group-B namespaces (this one: its own `key_count` in `record.json`); no key
  missing, none extra, authoring order identical; no
  duplicate key in the JSON text (counted separately from `JSON.parse`, which would silently collapse one).
- Every message parses through the app's own `parseMessage`; no missing or extra parameters; no
  parameter-kind change outside the six `text -> plural` escalations that `generate.ts` parameter-parity
  explicitly sanctions (each listed in `record.json`); every ru plural carries exactly
  one/few/many/other; every select node keeps the source's arm set including `other`; `#` appears only
  inside a plural.
- 12/12 negative controls tripped the check they target — the same `auditPair()` function that passed the
  catalogue fails a dropped placeholder, a renamed one, a missing `few`, a non-ru category, a missing
  `other`, a rewritten select arm, a bidi control, an ASCII ellipsis, straight quotes, a double space, a
  literal `#`, and an unparseable message. A check that cannot fail is not evidence.
- Typography: «ёлочки» only, `…` only, no double or edge spaces, no bidi/zero-width characters.

`vitest run src/i18n/__tests__/catalogues.test.ts` reports 1 failed / 37 passed: the failure is
`catalogues.test.ts:187` expecting the catalogue directories to equal `SHIPPED_LOCALES`, and ru is still in
`NOT_YET_SHIPPED_LOCALES`. That is the designed directory-vs-shipped gate, not a copy defect — the shipping
change must flip the list.


## Plurals — executed at 0/1/2/5/21/1.5/11/22/101

`Intl.PluralRules('ru')` at this head: 0→many, 1→one, 2→few, 5→many, 21→one, 1.5→other, 11→many,
22→few, 101→one. Every plural node in the namespace was rendered through `formatMessage(parseMessage(ru),
..., 'ru')` at those nine counts and the arm was compared against the correct Russian for that numeral:

| key | 0 | 1 | 2 | 5 | 21 | 1.5 |
|---|---|---|---|---|---|---|
| `count.wakes` | 0 пробуждений | 1 пробуждение | 2 пробуждения | 5 пробуждений | 21 пробуждение | 1.5 пробуждения |
| `count.monitors` | 0 мониторов | 1 монитор | 2 монитора | 5 мониторов | 21 монитор | 1.5 монитора |
| `show_more.wakes` | Показать ещё 0 пробуждений | …1 пробуждение | …2 пробуждения | …5 пробуждений | …21 пробуждение | …1.5 пробуждения |
| `tail.failed` | 0 сбоев | 1 сбой | 2 сбоя | 5 сбоев | 21 сбой | 1.5 сбоя |
| `summary.monitors_attention` | 0 из 3 требуют внимания | 1 из 3 требует внимания | 2 из 3 требуют внимания | 5 из 3 требуют внимания | 21 из 3 требует внимания | 1.5 из 3 требуют внимания |
| `summary.monitors_armed` | **0 активны** | 1 активен | 2 активны | 5 активны | 21 активен | 1.5 активны |
| `cadence.left` | осталось 0 | **остался 1** | осталось 2 | осталось 5 | **остался 21** | осталось 1.5 |

Everything above the bold cells is correct: the numeral selects the right arm and the noun carries the
right case in every one of them. The two bold rows are the two MAJOR findings below.

Both select nodes were exercised on every arm: `truncated` renders «Беседы с пробуждениями: показано 2
из 5.» and «Беседы с мониторами: показано 1 из 3.», and the family select keeps the instrumental case the
preposition requires («с пробуждениями», «с мониторами»). The `summary.monitors_attention` row is
synthetic (`{total}` is fixed at 3 in that render, so "5 из 3" is the arm test, not a reachable ratio).

## Composition — the exact sentences, from the real call sites

`schedules-copy.ts` is imported and executed (see `record.json.renderer_provenance`; the runtime runs from a
scratch copy whose only change is `+"ru"` in `SHIPPED_LOCALES`, because the audited head still holds ru
unshipped — `renderFor(..., 'ru')` correctly returns English there). English comparands come from the same
functions with the source switched to `en`, so a difference in the table is a difference in the catalogue.

| state | ru (executed) | en (same functions) |
|---|---|---|
| 1 wake, +240 s | `1 пробуждение · далее через 4m` | `1 wake · next in 4m` |
| 3 wakes, +60 s | `3 пробуждения · далее через 60s` | `3 wakes · next in 60s` |
| 5 wakes, +240 s | `5 пробуждений · далее через 4m` | `5 wakes · next in 4m` |
| 21 wakes, +240 s | `21 пробуждение · далее через 4m` | `21 wakes · next in 4m` |
| 3 wakes, −7 200 s | `3 пробуждения · просрочено на 2h` | `3 wakes · 2h overdue` |
| 5 wakes, −259 200 s | `5 пробуждений · просрочено на 3d` | `5 wakes · 3d overdue` |
| 4 wakes, dormant | `Приостановлено — пробуждения возобновятся после её следующего хода` | `Parked — wakes resume after its next turn` |
| 4 wakes, ghost | `Беседа исчезла — её нет на этой машине, срабатывать нечему` | `Gone — its conversation is no longer on this machine, so nothing fires` |
| 3 monitors, +240 s | `3 монитора · далее через 4m` | `3 monitors · next in 4m` |
| 2 monitors, −7 200 s | `2 монитора · просрочено на 2h` | `2 monitors · 2h overdue` |
| 4 monitors, dormant | `Приостановлено — мониторы возобновятся, когда её беседа снова запустится` | `Parked — monitors resume when its conversation runs again` |
| 4 monitors, ghost | `Беседа исчезла — её нет на этой машине, проверять нечего` | `Gone — its conversation is no longer on this machine, so nothing checks` |
| truncated, wakes 2/5 | `Беседы с пробуждениями: показано 2 из 5.` | `Showing 2 of 5 conversations with wakes.` |

No doubled preposition survives: the translator's reported pre-fix draft `{head} · далее через {label}`
was re-executed in the same sentence shape and renders `3 пробуждения · далее через через 4m`, while the
HEAD bytes render `3 пробуждения · далее через 4m`. That is a negative control on the composition itself —
the harness can see the defect it was meant to catch.

`head.overdue` is `{head} · {label}` — byte-identical to English, and correctly so: it is a placeholder-only
template with no translatable word, and the overdue word itself lives in `due.overdue` («просрочено на
{label}»), which matches core's `tui.schedule.due_overdue` exactly. Nothing is missing there.

## Terminology against core's committed Russian

`core-terms.py` (in `audit.log`) counts core's own occurrences at `89f2beda`:

| term | core's committed choice | mobile ru | verdict |
|---|---|---|---|
| milestone | `веха` (14 occurrences: «Добавить веху», «веху «{name}» добавлена») | `веха` throughout | consistent |
| supervisor | `супервизор` (1: `tui.schedule.notice_supervisor` — «У этих пробуждений нет супервизора») | `супервизор` in all three notices | consistent; the unverifiable sentence tracks core's twin almost word for word |
| monitor, the object | `монитор` (5: «Мониторы дельт», «монитор отключается») | `монитор` throughout | consistent — a countable stored object cannot be `мониторинг` |
| monitoring, the activity | `мониторинг` (1, in the delegated-work sentence: «ожидающее пробуждения или мониторинга») | not needed in this group | the split is right: `монитор` for the object, `мониторинг` only for the activity. Do not swap them. |
| delivery | `доставка` («на одну доставку») | `доставок больше нет` | consistent |
| turn | `ход` (26: «на этом ходе») | `после её следующего хода` | consistent |
| wake | `пробуждение` (27); `tui.schedule.empty_header` is «Нет запланированных пробуждений» | `empty_line.wakes` is byte-identical | consistent |
| machine | `машина` («машина ушла в офлайн») | `на этой машине` | consistent |
| schedule words | `cadence_every` «раз в {interval}», `cadence_once` «однократно», `status_scheduled` «запланировано», `ends_left` «осталось #» | `раз в`, `однократно`, `запланировано` match; `ends_left` does **not** (finding RU-SCH-1) | one divergence |

`head.next`'s «далее» is core's own word for this slot (`tui.schedule.detail_next` = «Далее»,
`notice_edited` = «Сохранено {id} — далее {due}»), so «далее через 4m» is the programme's phrasing, not a
new coinage. It is not a doubled preposition.

## Register, grammar, agreement

- вы throughout: «Попросите», «Очистите», «Проверьте», «Удалить» (infinitive action label per the guide).
  No ты, no «Пожалуйста», no «!», sentence case, no Title Case.
- State words agree with the noun of the row they sit in, and the mapping is exercised rather than assumed:
  `state.stale` («устарело», neuter) is rendered only by `wakeDueWord` over a wake (пробуждение, neuter);
  `state.disabled` («отключён»), `state.expired` («истёк») and `state.dormant` («спит») only by
  `monitorSlot`/`monitorStateWord` over a monitor (монитор, masculine); `state.waiting` («ожидает») is
  genderless. Executed: `отключён`, `истёк`, `спит`, `ожидает`, `устарело`.
- Case government after prepositions holds in every composed fragment: «с пробуждениями»/«с мониторами»
  (instrumental), «просрочено на 2h», «через 4m», «из этого проекта», «на этой машине», «после её
  следующего хода», «когда её беседа снова запустится».
- The supervisor lead was rendered for every branch: «На этой платформе у пробуждений пока нет
  супервизора…» (unsupported), «У пробуждений ниже нет супервизора…» (`verifiable === false`),
  «Супервизор пробуждений установлен, но не запущен…» (installed, not running, and also the absent-field
  case the code reads as "the probe can speak"), and the empty string when it is running.

## Fit (font metrics, not pixels)

Median ru/en growth 1.28x across the 55 measured keys. No unbreakable token exceeds its slot, and no
clamped slot truncates. The parked clause is the one long addition: 453.9 pt at text-meta, so it wraps to
2 lines where English takes 1 (en 243.4 pt) — the entry head is unclamped by design (`schedules.tsx`
removed a clamp for exactly this sentence), so it wraps rather than clips. The truncated strip is 294.3 pt
against 288, also 2 lines (en 268.8, 1 line).

## Second, independent pass

A separate reviewer agent (job `c6f22d89a9c1`, session model reported as `radient/auto`, different agent and
session, read-only, shown the two contested findings rather than this report) agreed with both MAJORs and
with both replacements, and contributed the MINOR in RU-SCH-3 (the dangling «её» in the parked clauses),
which this audit verified and accepted.

It also proposed one finding this audit **rejects**: that `head.next` should read
`{head} · далее через {label}`, on the premise that `{label}` is a bare duration («далее 45s»). Executed,
`{label}` is `due.ahead`'s output and already carries «через» («через 4m»), so those bytes render
«3 пробуждения · далее через через 4m» — the doubled-preposition defect the translator fixed before this
audit and this audit's own negative control reproduces. Rejected on evidence, not on preference.

Its one robustness note — making `sessions.live` attributive («# активная / # активных») against a future
zero — is recorded and not filed: `sessionCountLabel` returns the base phrase at a live count of ≤ 0, so
the zero is unreachable at this head.


## What was not fully verified

- No rendered frame: the parked clause's 2-line wrap and the badge widths are font metrics, not pixels.
- `mobile.schedules.empty.title` («Ничего не запланировано») was considered against «Nothing is armed» and
  kept: a monitor also runs on a cadence, so «запланировано» is not false, and the phrase is what a Russian
  product would put on an empty schedules screen. Recorded as a considered-and-accepted call, not a finding.
- `state.dormant` = «спит» has no core precedent (core has no comparable monitor state); it was judged
  acceptable as a one-word row state and is not proposed for change.

## Findings

### RU-SCH-1 — MAJOR — `mobile.schedules.cadence.left`

- current: `{cadence} · {remaining, plural, one {остался #} few {осталось #} many {осталось #} other {осталось #}}`
- replacement: `{cadence} · {remaining, plural, one {осталось #} few {осталось #} many {осталось #} other {осталось #}}`
- why: Executed through the app's renderer: remaining=1 -> «раз в 1d · остался 1», 21 -> «… остался 21», 101 -> «… остался 101». The count names deliveries (its sibling cadence.spent says «доставок больше нет»), and доставка is feminine, so masculine «остался» is the wrong agreement — it is grammatical only under an elided masculine noun («остался 1 раз») that the string never names. Worse than a static error, the same row alternates as the budget counts down: «осталось 3» -> «осталось 2» -> «остался 1», so the gender flips on the last delivery, the one state a reader looks at. Core's committed twin for this phrase, tui.schedule.ends_left, is uniform «осталось #» in all four arms, as are relay.shell.usage.remaining and tui.schedule.ends_until_left. One word changes; the ICU shape stays as the generator already verified it.

### RU-SCH-2 — MAJOR — `mobile.schedules.summary.monitors_armed`

- current: `{count, plural, one {# активен} few {# активны} many {# активны} other {# активны}}`
- replacement: `{count, plural, one {# активный} few {# активных} many {# активных} other {# активных}}`
- why: Executed header shapes: 1 -> «1 активен», 2 -> «2 активны», 5 -> «5 активны», 0 -> «0 активны». The zero case is reachable and is rendered: the Monitors section header prints `Monitors · ${monitorSectionSummary(rows)}` whenever the family is readable, and monitorSectionSummary([]) -> «0 активны» when the monitors family is empty while wakes have rows (executed; the header then reads «Monitors · 0 активны» above «Нет активных мониторов.»). «0 активны» is ungrammatical — zero takes the genitive-plural counter form «0 активных» — and at the other counts a subjectless predicate is a weaker section counter than the adjectival one. The replacement changes no ICU structure and renders «0 активных / 1 активный / 2 активных / 5 активных / 21 активный».

### RU-SCH-3 — MINOR — `mobile.schedules.parked.wakes + mobile.schedules.parked.monitors`

- current: `Приостановлено — пробуждения возобновятся после её следующего хода / Приостановлено — мониторы возобновятся, когда её беседа снова запустится`
- replacement: `Приостановлено — пробуждения возобновятся после следующего хода / Приостановлено — мониторы возобновятся, когда эта беседа снова запустится`
- why: The clause is impersonal («Приостановлено» names no noun), so «её» has no feminine antecedent anywhere in the string, and the clause is the WHOLE head line of the entry — there is no surrounding sentence to supply one. The same catalogue does it right one key over: gone.monitors/ gone.wakes open with «Беседа исчезла —», which gives «её» its noun. Raising «её беседа» in parked.monitors is also circular: the monitors belong to that conversation, so the possessive points at the container itself. Found by the independent second pass and confirmed here; meaning survives, so MINOR, not MAJOR.

### RU-SCH-4 — NIT — `mobile.schedules.empty.body`

- current: `Попросите агента в чате делать что-то регулярно — и это появится здесь. Пробуждения отправляют промпт в беседу в заданное время; мониторы следят за одним объектом и сообщают об изменениях.`
- replacement: `Попросите агента в чате делать что-то регулярно — и это появится здесь. Пробуждения отправляют промпт в беседу в заданное время; мониторы следят за чем-то одним и сообщают об изменениях.`
- why: English is 'watch one thing'. «объект» reads as a facility or a code object rather than the thing being watched; «за чем-то одним» is the plain phrasing.


## What this audit did not do

- No rendered frame, no simulator, no screenshot: widths are font metrics (see `record.json.fit`), and the sentences are the app's own renderer over the audited bytes.
- No human native-speaker review. The auditor is an LLM reading as a native-fluent user.
- A second independent pass was performed by a separate reviewer agent over all four group-B namespaces; its agreement, the finding it contributed and the one it proposed that this audit rejected on executed evidence are recorded in `record.json.second_pass`.

## Record

`i18n/audits/evidence/ru/mobile.schedules/ru29s1/record.json` is the machine-readable record; `audit.log` is the executed transcript
(group-wide: it covers all four group-B namespaces, unfiltered).
