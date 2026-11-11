# Independent delta audit — `ru` · `mobile.settings` · M1 round 2 (`ru1111m1r2`)

Auditor `i18n-auditor` (lopdev team), session `b074e5794284`, served model
`deepseek/deepseek-flash` (session header; no fallback notice in this transcript).
Independent of the translator (`openai/gpt-6.1-sol`, session `48676ea694c1`, as reported
in `ru.v2-changes.md`; not observed by this auditor). Audit date 2026-11-11. Audited head
`84c4bee109d048e3dad0f996921e1b8ed561dfc8`.

## Verdict

**Verdict: clean-with-findings — 0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT in this namespace**,
plus two declined round-1 findings adjudicated (both upheld).
Ledger status `passed` (passes require zero unresolved BLOCKER/MAJOR).

This is a high-visibility group (Settings, plus the sign-out safety dialog and toast); the
whole 27-value namespace was read, not only the 5 changed values.

## Keys (27; 5 changed in v2)

| key | v2 | changed |
| --- | --- | --- |
| `mobile.settings.about.blurb` | Local Operator — приложение с открытым исходным кодом (MIT). Сессии агентов подключаются к вашему ретранслятору. Сообщения Team Bridge и регистрация уведомлений отправляются напрямую в Radient. | ✓ |
| `mobile.settings.about.version` | Версия | |
| `mobile.settings.account.delete` | Удалить мой аккаунт Radient | |
| `mobile.settings.account.delete_help` | Аккаунт удаляется в консоли Radient (в браузере) — приложение не может сделать это за вас. Удаляются аккаунт и все его туннели. Сессии на компьютере не затрагиваются. | ✓ |
| `mobile.settings.account.signed_in` | Вход выполнен | |
| `mobile.settings.connection.computers` | Компьютеры | |
| `mobile.settings.connection.refresh` | Обновить | |
| `mobile.settings.connection.status` | Состояние | |
| `mobile.settings.connection.use` | Выбрать | |
| `mobile.settings.diagnostics.last_error` | Последняя ошибка | |
| `mobile.settings.diagnostics.none` | Нет | |
| `mobile.settings.diagnostics.privacy_note` | В этих строках никогда нет токенов, паролей или содержимого сессий. | |
| `mobile.settings.diagnostics.route` | Маршрут | |
| `mobile.settings.diagnostics.route_direct` | Напрямую к ретранслятору | |
| `mobile.settings.diagnostics.route_radient` | Туннель Radient | |
| `mobile.settings.diagnostics.stream` | Поток | |
| `mobile.settings.screen_title` | Настройки | |
| `mobile.settings.section.about` | О приложении | |
| `mobile.settings.section.appearance` | Оформление | |
| `mobile.settings.section.connection` | Подключение | |
| `mobile.settings.section.diagnostics` | Диагностика | |
| `mobile.settings.sign_out.body` | Сессия входа с сервером управления будет завершена, а приложение забудет её, поэтому туннель перестанет принимать запросы с этого телефона. Ваш компьютер не затрагивается. | ✓ |
| `mobile.settings.sign_out.confirm` | Выйти | |
| `mobile.settings.sign_out.done` | Выход выполнен. Сессия входа отозвана на компьютере. | ✓ |
| `mobile.settings.sign_out.title` | Выйти? | |
| `mobile.settings.text_size.following` | Размер текста в настройках телефона — {percent}%. Приложение использует этот размер. | ✓ |
| `mobile.settings.text_size.overridden` | Размер текста в настройках телефона — {percent}%. Вместо него используется размер, выбранный выше. | |

## Findings

### M-2 — MINOR — `mobile.settings.connection.status`

- Current: `Состояние`
- English: "Status" (role `meta`: small row label left of the connection state pill).
- Problem: the same English label ships as **`Статус`** in both shipped label sites — `mobile.library.browse.status` and `mobile.projects.create.status` are literally "Status" → `Статус` (2/2). The remediation note justifies `состояние` from two shipped values, but both are prose, not labels (`session_health.control_hint` "what this *state* means"; `computers.disabled_help` "check its status in the console"). One term, one decision: the label row should follow the label precedent, and it sits beside `Подключение` / `Диагностика` / `Маршрут` noun labels.
- Suggested: `Статус`. (Prose `состояние` stays correct wherever the English is "state".)

### M-3 — MINOR — terminology record gate: `сервер управления` and `поток` ship with no glossary row

- Keys: `mobile.settings.sign_out.body` (`control plane` → `сервер управления`), `mobile.settings.diagnostics.stream` (`stream` → `Поток`).
- Problem: both are **new** terms — 0 occurrences in the shipped `ru` catalogue and no row in `i18n/glossary.md` or `i18n/style-guides/ru.md`. `en.md` states the gate plainly ("a new concept needs a glossary row before it ships in copy") and glossary §4 makes the wave that first needs a term responsible for its row. The translator proposed both in the staging note and correctly did not edit guide files; the rows still have to land with this wave, or the next wave re-invents them.
- Action: land two rows (`glossary.md` §2 core terminology; `ru.md` recorded-calls section, dated) and cite them from the wave note. Wording is not the issue — both renderings are sound (see adjudications).

### N-3 — NIT — `mobile.settings.diagnostics.route_direct` (no change recommended)

- Current: `Напрямую к ретранслятору`, beside the sibling value `Туннель Radient`.
- Problem: the pair is uneven in shape — one value is adverbial ("directly to the relay"), the other a noun phrase ("Radient tunnel") — in the same `Маршрут` row. Both are accurate and each reads correctly after the label, so this is recorded, not requested; a noun value that keeps the sense (`Прямое подключение к ретранслятору`, 33 cells) is longer than the slot deserves.

## Changed values — judgement

All five accepted. `about.blurb` keeps the three claims (open source/MIT, agent sessions →
your relay, Team Bridge messages and notification registration → Radient directly) and
renders the relay with the shipped vocabulary. `account.delete_help` keeps browser-only
deletion, the account-plus-tunnels scope, and the reassurance that sessions on the computer
are untouched; the new parenthetical `(в браузере)` removes the stacked `в` phrases without
losing a claim. `sign_out.body` and `sign_out.done` are handled claim by claim in the slice
report: sign-in session with the control plane ends, app forgets it, tunnel stops accepting
this phone, computer untouched (dialog); sign-in session revoked on the computer (toast) —
distinct, unambiguous, and neither reads as an agent/chat session because both say
`сессия входа`. `text_size.following` keeps the phone size, the `{percent}%` and who follows
it, and its first clause is byte-identical to the sibling `overridden` (verified).

## Adjudications (declined round-1 findings)

**A N-2 — keep `mobile.settings.connection.use` = `Выбрать` — UPHELD.** English "Use" is a
small button in a narrow row that switches to that computer. Shipped `ru` has no "Use"
action; its switch action is `mobile.computers.switch` = `Сменить компьютер`, too long for
the row, and `использовать` (11 cells) reads bureaucratic there. `Выбрать` names what the
button does in the narrowest accurate form.

**B M3 — keep `mobile.settings.diagnostics.stream` = `Поток` — UPHELD.** The English sidecar
fixes "One word" for this label and `Поток событий` is two; shipped `ru` has zero `поток`
occurrences, so nothing is contradicted; `поток` is the settled Russian word for a live data
stream and the row sits among equally terse labels (`Маршрут`, `Последняя ошибка`). Adding
"events" would specify what the source does not say.

## Mechanical (this namespace)

Valid JSON; 27/27 keys, set and order identical to the English slice; no plural or select
structures; `{percent}` preserved in both text-size values together with the `%` sign; no
empty value; 0 English-identical (product names `Local Operator`, `Team Bridge`, `Radient`,
`MIT` excepted, glossary §1); 0 bidi controls, straight quotes, three-dot ellipses;
`—` used 3× always spaced; no full stop on labels/headings, full stops on sentences. Repo
validator at the audited head: `npm run -s i18n:check` exit 0 (`catalogue.gen.ts is current
(649 keys, 21 namespaces)`; `check-strings: 212 finding(s), all baselined; 0 new`) — baseline
only, the staged values are not in the tree.

## Artifacts

`record.json`, `report.md`, `audit.log` (shared; full slice report:
`i18n/audits/evidence/ru/NOTE-m1-slice-r2.md`).

## Limits — not claimed

No rendered frame, native build or device run; no `maxCells`/`maxChars` for these keys, so
fit is a character-count judgement (the two longest values are help paragraphs that wrap).
No human native review; no other round-2 report was read.
