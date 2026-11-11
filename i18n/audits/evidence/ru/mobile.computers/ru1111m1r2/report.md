# Independent delta audit — `ru` · `mobile.computers` · M1 round 2 (`ru1111m1r2`)

Auditor `i18n-auditor` (lopdev team), session `b074e5794284`, served model
`deepseek/deepseek-flash` (session header; no fallback notice in this transcript).
Independent of the translator (`openai/gpt-6.1-sol`, session `48676ea694c1`, as reported
in `ru.v2-changes.md`; not observed by this auditor). Audit date 2026-11-11. Audited head
`84c4bee109d048e3dad0f996921e1b8ed561dfc8`.

## Verdict

**Verdict: clean-with-findings — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT in this namespace.**
Ledger status `passed` (passes require zero unresolved BLOCKER/MAJOR).

## Keys (6; 2 changed in v2)

| key | v2 | changed |
| --- | --- | --- |
| `mobile.computers.wait.nothing_answered` | Ответа нет. | |
| `mobile.computers.wait.nothing_answered_help` | За три минуты туннель не появился в списке, а компьютер не ответил. Убедитесь, что команда выполнилась на компьютере, и начните снова. | |
| `mobile.computers.wait.paused` | Проверка приостановлена, пока приложение в фоновом режиме. Откройте его снова, чтобы продолжить проверку. | ✓ |
| `mobile.computers.wait.relay_sessions` | Его ретранслятор сообщает: {sessions, plural, one {# запущенная сессия} few {# запущенные сессии} many {# запущенных сессий} other {# запущенной сессии}}. | |
| `mobile.computers.wait.relay_version` | Его ретранслятор сообщает версию протокола: {version}. | |
| `mobile.computers.wait.relay_version_sessions` | Его ретранслятор сообщает версию протокола {version} и {sessions, plural, one {# запущенную сессию} few {# запущенные сессии} many {# запущенных сессий} other {# запущенной сессии}}. | ✓ |

## Findings

### M-1 — MINOR — `mobile.computers.wait.relay_sessions` and `mobile.computers.wait.relay_version` (unchanged) now contradict the fixed sibling

- Current: `Его ретранслятор сообщает: {sessions, plural, one {# запущенная сессия} few {# запущенные сессии} many {# запущенных сессий} other {# запущенной сессии}}.` and `Его ретранслятор сообщает версию протокола: {version}.`
- English: "Its relay reports {sessions, plural, one {# running session} other {# running sessions}}." / "Its relay reports protocol version {version}."
- Problem: the round-2 fix rewrote the combined line as a coordinated sentence with an accusative object (`сообщает версию протокола {version} и … запущенную сессию`), retiring the colon-plus-bare-noun list. The two other states of the *same wait-panel line* keep the retired grammar, so the sentence a user reads changes shape with the state: `сообщает: 1 запущенная сессия` beside `сообщает версию протокола 7 и 1 запущенную сессию`. Not a meaning defect — meaning is intact and both renders are grammatical; it is the group consistency the fix itself established.
- Suggested: apply the same fix to the two remaining lines — `Его ретранслятор сообщает {sessions, plural, one {# запущенную сессию} few {# запущенные сессии} many {# запущенных сессий} other {# запущенной сессии}}.` and `Его ретранслятор сообщает версию протокола {version}.` (arm text only; categories and arguments unchanged).

### N-1 — NIT — `mobile.computers.wait.paused`

- Current: `Проверка приостановлена, пока приложение в фоновом режиме. Откройте его снова, чтобы продолжить проверку.` (105 cells, was 86 in v1, English 70)
- Problem: the root repeats across the two sentences (`Проверка … проверку`) and the value grew past the English by half again. Meaning and register are right; this is polish.
- Suggested only if the copy is touched anyway: `… Откройте его снова, чтобы продолжить наблюдение.` ("keep watching"). No change required.

## Judgement on the changed value

`relay_version_sessions`: the `one` arm moved to the accusative (`# запущенную сессию`), which is exactly what `сообщает … и {n} …` governs; `few`/`many` arms are case-identical for inanimate nouns and were correctly left alone. Renders verified with Node `Intl.PluralRules("ru")`: 0/5/21 → many/one/one, 2 → few, 1,5 → other. `paused`: `Проверка приостановлена` names the polling correctly and `Откройте его снова` agrees with `приложение` (neuter). Both accepted.

## Mechanical (this namespace)

Valid JSON; 6/6 keys, set and order identical to the English slice; both plural messages carry exactly `one/few/many/other` (the CLDR `ru` set) with `#` retained and the `{sessions}` argument intact; `{version}` present in both version strings; no empty value; 0 English-identical; 0 bidi controls, straight quotes or three-dot ellipses; Latin tokens limited to ICU syntax. Repo validator at the audited head: `npm run -s i18n:check` exit 0 (`catalogue.gen.ts is current (649 keys, 21 namespaces)`; `check-strings: 212 finding(s), all baselined; 0 new`) — baseline only, the staged values are not in the tree.

## Artifacts

`record.json`, `report.md`, `audit.log` (shared; full slice report:
`i18n/audits/evidence/ru/NOTE-m1-slice-r2.md`).

## Limits — not claimed

No rendered frame, native build or device run; no `maxCells`/`maxChars` for these keys, so
fit is a character-count judgement (the two plural lines are long help text and wrap). No
human native review; no other round-2 report was read.
