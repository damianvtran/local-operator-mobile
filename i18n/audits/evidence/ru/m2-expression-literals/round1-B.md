# m2-au-ru-B — ru audit, lane B (round 1)
Auditor: i18n-auditor (lane B); model anthropic/claude-sonnet-5-5 (system-prompt served model; no fallback). Independent of translator i18n-translator openai/gpt-6.1-sol.
Candidate: m2-prep/ru.v1.json (27 keys). Inputs read: keys27.json, ru.md, shipped ru catalogue (649 keys, recounted by regex), M1 ru.v2.json (53 keys), call sites via git show feat/i18n-app-scan-expression-literals.

## Mechanical (python3, executed)
key set/order == keys27: PASS; placeholders {baseUrl},{host},{percent},{labels},{name} identical to source: PASS; empties 0; English-identical 0 (only app_name "Local Operator", deliberate); NFC clean; no stray whitespace; glyphs · ↑ ↓ % ( ) counts equal to source; no bidi controls. Full-stop parity: all match except context_short ("конт." ends with an abbreviation dot, source "ctx" has none) - see F5.
No ICU plurals in the 27 keys, so no CLDR category issue.

## Verdict: clean-with-findings - 0 BLOCKER, 0 MAJOR, 5 MINOR, 4 NIT

## Findings
F1 MINOR mobile.settings.status.no_connection
 current: "Нет подключения"  source "No connection yet"
 problem: drops "yet"; in Russian UI "Нет подключения" idiomatically means the network is lost/the link dropped, but this state is "no computer chosen yet" (pill + account card). Collides in meaning with not_connected/offline on the same screen.
 suggest: "Подключения пока нет" (or "Компьютер не выбран" if the pill has room).

F2 MINOR mobile.settings.diagnostics.stream_offline
 current: "отключён"
 problem: the same enum value "offline" is rendered "Вне сети" (status.offline) on the same Settings screen (statusFor case "offline" and streamWord "offline" both fire for health=offline), so one state gets two words. Also "отключён" is the shipped rendering of "disabled" (mobile.schedules.state.disabled), a meaning collision. Shipped relay.health.live = "В сети", so "вне сети" is the established pair.
 suggest: "вне сети" (lower-case, fits monospace line).

F3 MINOR mobile.settings.diagnostics.stream_idle
 current: "простой"
 problem: as a bare lower-case word after the label "Поток" it parses as the adjective "simple" ("Поток: простой"), not the noun "idle". Style guide/shipped (relay.chrome.session.subtitle.idle "Простой") use the noun, but there the context is a session state with sibling words (Работает/Завершена); here the neighbours are verbs/participles (подключается, активен), which worsens ambiguity. Source note says "no live stream has started".
 suggest: "не запущен" or "ожидает" (verbal, unambiguous; matches the "has not started" note). Keep "простой" only if the team accepts the ambiguity, since the glossary favours it.

F4 MINOR mobile.session.region.more_below
 current: "ниже есть ещё · прокрутить ↓"
 problem: "ниже есть ещё" is a dangling colloquial fragment (more what?), unlike the terse cue wanted for a phone caption.
 suggest: "ещё ниже · прокрутить ↓" (sibling of "ниже: {labels} · прокрутить ↓" and shorter by 5 chars).

F5 MINOR mobile.session.tray.context_short / context_short_estimate
 current: "{percent}% конт." / "{percent}% конт. (прибл.)"
 problem: "конт." is not a standard Russian abbreviation (guide: standard abbreviations only; reads like "контакт/контроль"); the stray dot also sits before the estimate paren, "конт. (прибл.)". The source note allows "the full word if none exists". Shipped uses full "Контекст" (composer.row_usage).
 suggest: use the nominative full word "{percent}% контекст" / "{percent}% контекст (прибл.)" (1 cell shorter than "контекста"; "ctx" is 3, so the width gain of any Russian short form is small) - or make short == long if the width test passes. If the width test proves the narrow tray cannot hold it, keep "конт." and record it as a width exception.

NIT
N1 mobile.computers.added.connected_to "Выполнено подключение к {name}." Grammar OK with fallback "вашему компьютеру" (к + dative: "…к вашему компьютеру." reads naturally; with a Latin device name it stays undeclined after "к", fine). Wording is chancery; "Подключено к {name}." is terser and equally correct with the fallback. Not required.
N2 mobile.settings.account.route_direct "Прямое подключение к {baseUrl}" - noun phrase loses the "Connected" state of the source; "Подключено напрямую к {baseUrl}" is closer. {baseUrl} is a URL in a Cyrillic run: LTR, no hazard (ru is LTR).
N3 mobile.session.tray.context_estimate "(прибл.)" - acceptable; "(оценка)" would stay closer to "estimated" but is longer. Keep.
N4 mobile.computers.wait.host_answering "Ожидание ответа компьютера по адресу {host}." drops "your" (idiomatic) and "по адресу" for a host name is fine. Second sentence "Настроенный маршрут ещё не означает, что компьютер работает." faithful ("provisioned" -> "настроенный" OK). No change.

## Checks that PASSED (evidence)
- Status vs shipped: "Не отвечает" == relay.chrome.session.subtitle.not_answering (same wording, as the source requires); "Вне сети" pairs with shipped relay.health.live "В сети"; "Подключён/Не подключён" consistent with shipped не подключено/подключена forms; Settings "Вход ... не выполнен" parallels shipped "Вход выполнен" (signed_in); "туннель Radient" == shipped diagnostics.route_radient; Radient kept Latin; "Local Operator" kept Latin.
- Register: impersonal/«ваш», no "Вы", no "!", sentence case. Stream tokens lower-case, pills sentence case: respects the source role split.
- connected_to + fallback_name together: "Выполнено подключение к вашему компьютеру." and with a device name "…к damian-mbp." both grammatical.
- session.fallback_name "сессия" (nominative, lower-case) correct for the header title and the glossary (session -> сессия; "беседа" is only the shipped rendering of conversation, not of this term).
- Glyphs · ↑ ↓ and parentheses preserved exactly; no bidi controls.

## Wiring observations (out of translation scope, for manager)
W1 app/(app)/session/[id].tsx REGION_LABEL (activity/agents/tasks/status) is still hard-coded English and is what {labels} receives, so ru renders "ниже: tasks · status · прокрутить ↓" - mixed language. Shipped has "Агенты"/"Задачи" (relay.chrome.session.tray.*). Needs wiring or a follow-up.
W2 "Back to ${parentName}" (video.tsx, agent/[jobId].tsx) remains English literal; if later localised, "сессия" (nominative) fails after "к" ("Назад к сессия") - the translator/wiring must use a case-neutral template such as "Назад: {name}" or accept the fallback in dative. Mention to whoever wires it.
