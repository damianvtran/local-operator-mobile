# Independent delta audit — `ru` · `mobile.session` · M1 round 2 (`ru1111m1r2`)

Auditor `i18n-auditor` (lopdev team), session `b074e5794284`, served model
`deepseek/deepseek-flash` (session header; no fallback notice in this transcript).
Independent of the translator (`openai/gpt-6.1-sol`, session `48676ea694c1`, as reported
in `ru.v2-changes.md`; not observed by this auditor). Audit date 2026-11-11. Audited head
`84c4bee109d048e3dad0f996921e1b8ed561dfc8`.

## Verdict

**Verdict: clean-with-findings — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT in this namespace**,
plus one declined round-1 finding adjudicated (upheld).
Ledger status `passed` (passes require zero unresolved BLOCKER/MAJOR).

## Keys (16; 2 changed in v2)

| key | v2 | changed |
| --- | --- | --- |
| `mobile.session.chip.effort_change_failed` | Не удалось изменить усилие. | |
| `mobile.session.chip.model_change_failed` | Не удалось сменить модель. | |
| `mobile.session.composer.retained_instruction` | Предыдущее указание, возможно, уже доставлено. Отправьте это указание ещё раз, прежде чем отправлять текущий черновик. | ✓ |
| `mobile.session.empty.headline` | Здесь пока ничего нет. | |
| `mobile.session.empty.next` | Отправьте первое сообщение ниже. | |
| `mobile.session.find.hint` | Ищет сообщения в транскрипте, загруженном на это устройство | |
| `mobile.session.find.label` | Искать в этой беседе | |
| `mobile.session.not_connected.headline` | Эта сессия пока не подключена. | |
| `mobile.session.not_connected.next` | После подключения компьютера откройте её в списке сессий. | ✓ |
| `mobile.session.subagent.no_rows` | У этого субагента нет собственных строк транскрипта. | |
| `mobile.session.subagent.prompt_label` | промпт | |
| `mobile.session.subagent.result_label` | результат | |
| `mobile.session.subagent.screen_title` | Субагент | |
| `mobile.session.subagent.unavailable_headline` | Этот субагент больше недоступен. | |
| `mobile.session.subagent.unavailable_next` | Его транскрипт не сохранён или компьютер не отвечает. | |
| `mobile.session.subagents_hint` | Показать субагентов | |

## Findings

### N-2 — NIT — `mobile.session.find.hint`

- Current: `Ищет сообщения в транскрипте, загруженном на это устройство`
- Problem: `загруженном на это устройство` reads as "loaded onto", where a stored copy is usually `на этом устройстве`; the shipped catalogue uses `…этого устройства` for the same "the copy on this phone" idea. Audible-only string; both parse.
- Suggested: `Ищет сообщения в транскрипте, загруженном на этом устройстве`.

## Changed values — judgement

Both accepted. `retained_instruction` keeps the uncertainty (`возможно, уже доставлено`)
and the required order (retry the earlier instruction *before* sending the draft) and drops
v1's verbal-noun `Повторите его отправку`; the repetition `указание … это указание` is mild
and the meaning is unambiguous. `not_connected.next` `в списке сессий` is the natural
location and names the noun (`сессия`, glossary).

Cross-key checks that the changes touch: `find.label` `Искать в этой беседе` matches the
shipped conversation vocabulary (`беседа`, 28 values) and the shipped search wording
(`mobile.library.browse.search_label` = `Искать в библиотеке`); `chip.*_change_failed` keep
the shipped verb pairing (`сменить модель` / `изменить усилие`, as in the shipped chip
hints); `subagent` values use the glossary term `субагент` and the shipped word
`транскрипт`. No `сеанс` added (the 4 shipped `сеанс` values are pre-existing drift,
outside this slice).

## Adjudication (declined round-1 finding)

**B N4 — keep `mobile.session.subagents_hint` = `Показать субагентов` — UPHELD.** The
source context for this key is explicit: "Accessibility hint … **Imperative**, no final full
stop", and the `ru` guide renders imperative action labels with the infinitive. My own count
shows the tension is real: 11 of 11 shipped `ru` accessibility hints are third-person
(`Открывает меню сессии`, `Показывает…`, `Прикрепляет…`) and the sibling `find.hint` in this
same slice is third-person, so `Показать субагентов` is the one infinitive hint. The cause
is the English source, which is imperative here and descriptive there; the translation
mirrors the source rather than erasing the distinction. Upheld — but the register should be
settled at the **source/guide** level if a future wave aligns the two hints, not by
deviating in `ru` alone.

## Mechanical (this namespace)

Valid JSON; 16/16 keys, set and order identical to the English slice; no plural or select
structures; no placeholders; no empty value; 0 English-identical; lowercase label sibling
pair `промпт`/`результат` preserved as the source has it; 0 bidi controls, straight quotes,
three-dot ellipses or backticks. Repo validator at the audited head: `npm run -s
i18n:check` exit 0 (`catalogue.gen.ts is current (649 keys, 21 namespaces)`;
`check-strings: 212 finding(s), all baselined; 0 new`) — baseline only.

## Artifacts

`record.json`, `report.md`, `audit.log` (shared; full slice report:
`i18n/audits/evidence/ru/NOTE-m1-slice-r2.md`).

## Limits — not claimed

No rendered frame, native build or device run; no `maxCells`/`maxChars` for these keys and
two values are audible-only. No human native review; no other round-2 report was read.
