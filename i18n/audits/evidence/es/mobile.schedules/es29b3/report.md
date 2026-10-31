# Audit report — mobile.schedules (es)

- **Audit ID:** es29b3
- **Date:** 2026-10-29 (session date; command timestamps inside `audit.log` are UTC and fall on 2026-10-30)
- **Auditor:** i18n-auditor (lopdev team); session `1f01d8fb4b08`; actual model **radient/auto**
  (temporary provider-quota fallback from anthropic/claude-sonnet-5-5, via openai/gpt-6-astra and kimi/k3.1-pro; every command below ran under radient/auto)
- **Translator:** i18n-translator; session `c53616dcee1c`; model `radient/auto` (as reported in the task brief, not independently observed)
- **Independence:** different agent context and session from the translator; **same served model** — identity independence only, disclosed and not closed
- **Verdict:** **changes_requested**
- **Keys:** 38 en / 38 es
- **Unresolved blocker/major:** 2

## Mechanical checks (all executed; output in `audit.log`)

- JSON valid: yes.
- Key parity: en=38 es=38; context notes 38/38.
- Placeholders: names identical in all 38 keys. Three conditional retypes, all allowed because a noun or adjective agrees with the count: `summary.monitors_armed`, `summary.wakes`, `tail.failed` (text → plural, `#` is the count, no arm drops a parameter). `count.*`, `show_more.*` and `truncated` keep the English text parameter, which is sound: `#` sits beside a fixed noun phrase.
- ICU: every plural carries one/many/other — the complete Spanish CLDR set as `Intl.PluralRules('es')` reports it in this runtime (0=other, 1=one, 2=other, 1000000=many, 1500000=other). `truncated`'s `family` select is wakes/other, identical to English.
- Counted nouns at 0/1/2/1000000 rendered for wakes and monitors, plus `show_more`, `summary` and `tail.failed` (tables below): no false plural such as the French wave's “1 actives” (its fixed-plural defect, named in that wave's merge message).
- Typography: em dash with spaces, middle dot kept in the cadence/head splices, no space before `? ! : ;`, no guillemets, no double spaces, no bidi controls.
- English-token sweep: ICU arm codes (`wakes`, `other`) and placeholders do not render; the only English-looking word that does render is “monitor/monitores”, which is ES-SCH-1. “No” in the read-error and supervisor sentences is the Spanish negator, not leakage.
- Repository validator: exit 0 (does not parse es while unshipped — see Limits).

## Per-key review

| # | key | role | English | Spanish | judgement |
|---|---|---|---|---|---|
| 1 | `mobile.schedules.cadence.every` | meta | every {duration} | cada {duration} | clean |
| 2 | `mobile.schedules.cadence.left` | meta | {cadence} · {remaining} left | {cadence} · {remaining} por enviar | clean |
| 3 | `mobile.schedules.cadence.once` | meta | once | una vez | clean |
| 4 | `mobile.schedules.cadence.spent` | meta | {cadence} · no deliveries left | {cadence} · no quedan envíos | clean |
| 5 | `mobile.schedules.count.monitors` | meta | {count, plural, one {# monitor} other {# monitors}} | {count, plural, one {# monitor} many {# de monitores} other {# monitores}} | **ES-SCH-1 (major)** — terminology |
| 6 | `mobile.schedules.count.wakes` | meta | {count, plural, one {# wake} other {# wakes}} | {count, plural, one {# despertar} many {# de despertares} other {# despertares}} | clean |
| 7 | `mobile.schedules.due.ahead` | meta | in {label} | en {label} | clean |
| 8 | `mobile.schedules.due.overdue` | meta | {label} overdue | vencido hace {label} | clean |
| 9 | `mobile.schedules.empty.body` | help | Ask an agent in chat to do something on a regular basis and it will appear here. Wakes fire a prompt into a conversation at a time; monitors watch one thing and report what changes. | Pide a un agente en el chat que haga algo de forma regular y aparecerá aquí. Los despertares lanzan un prompt en una conversación a una hora concreta; los monitores vigilan una cosa y avisan de lo que cambia. | **ES-SCH-1 (major)** — terminology |
| 10 | `mobile.schedules.empty.title` | heading | Nothing is armed | No hay nada armado | **ES-SCH-3 (minor)** |
| 11 | `mobile.schedules.empty_line.monitors` | status | No monitors armed. | No hay monitores armados. | **ES-SCH-1 + ES-SCH-3** |
| 12 | `mobile.schedules.empty_line.wakes` | status | No wakes scheduled. | No hay despertares programados. | clean |
| 13 | `mobile.schedules.gone.monitors` | status | Gone — its conversation is no longer on this machine, so nothing checks | Desaparecido — su conversación ya no está en esta máquina, así que nada lo comprueba | **ES-SCH-1 + ES-SCH-4 (nit)** |
| 14 | `mobile.schedules.gone.wakes` | status | Gone — its conversation is no longer on this machine, so nothing fires | Desaparecido — su conversación ya no está en esta máquina, así que nada lo dispara | **ES-SCH-4 (nit)** |
| 15 | `mobile.schedules.head.next` | meta | {head} · next {label} | {head} · próximo {label} | clean |
| 16 | `mobile.schedules.head.overdue` | meta | {head} · {label} | {head} · {label} | clean |
| 17 | `mobile.schedules.parked.monitors` | status | Parked — monitors resume when its conversation runs again | En pausa — los monitores se reanudan cuando su conversación vuelva a ejecutarse | **ES-SCH-1 (major)** — terminology |
| 18 | `mobile.schedules.parked.wakes` | status | Parked — wakes resume after its next turn | En pausa — los despertares se reanudan tras su próximo turno | clean |
| 19 | `mobile.schedules.read_error.monitors` | status | The monitors on this machine could not be read. | No se pudieron leer los monitores de esta máquina. | **ES-SCH-1 (major)** — terminology |
| 20 | `mobile.schedules.read_error.wakes` | status | The wakes on this machine could not be read. | No se pudieron leer los despertares de esta máquina. | clean |
| 21 | `mobile.schedules.read_unreachable` | status | We couldn't read this machine's schedules just now. | Ahora mismo no hemos podido leer las programaciones de esta máquina. | clean |
| 22 | `mobile.schedules.show_less.monitors` | button | Show fewer monitors | Mostrar menos monitores | **ES-SCH-1 (major)** — terminology |
| 23 | `mobile.schedules.show_less.wakes` | button | Show fewer wakes | Mostrar menos despertares | clean |
| 24 | `mobile.schedules.show_more.monitors` | button | {hidden, plural, one {Show # more monitor} other {Show # more monitors}} | {hidden, plural, one {Mostrar # monitor más} many {Mostrar # de monitores más} other {Mostrar # monitores más}} | **ES-SCH-1 (major)** — terminology |
| 25 | `mobile.schedules.show_more.wakes` | button | {hidden, plural, one {Show # more wake} other {Show # more wakes}} | {hidden, plural, one {Mostrar # despertar más} many {Mostrar # de despertares más} other {Mostrar # despertares más}} | clean |
| 26 | `mobile.schedules.state.disabled` | status | disabled | desactivado | **ES-SCH-1 (major)** — gender |
| 27 | `mobile.schedules.state.dormant` | status | dormant | inactivo | **ES-SCH-1 (major)** — gender |
| 28 | `mobile.schedules.state.expired` | status | expired | caducado | **ES-SCH-1 (major)** — gender |
| 29 | `mobile.schedules.state.stale` | status | stale | obsoleto | clean |
| 30 | `mobile.schedules.state.waiting` | status | waiting | en espera | clean |
| 31 | `mobile.schedules.summary.monitors_armed` | heading | {count} armed | {count, plural, one {# monitor armado} many {# de monitores armados} other {# monitores armados}} | **ES-SCH-1 + ES-SCH-3** |
| 32 | `mobile.schedules.summary.monitors_attention` | heading | {broken} of {total} need attention | {broken} de {total} requieren atención | **ES-SCH-2 (major)** — verb agreement |
| 33 | `mobile.schedules.summary.wakes` | heading | {count} scheduled | {count, plural, one {# despertar programado} many {# de despertares programados} other {# despertares programados}} | clean |
| 34 | `mobile.schedules.supervisor.not_running` | status | The wake supervisor is installed but not running, so the wakes below will not fire. | El supervisor de despertares está instalado pero no se ejecuta, así que los despertares de abajo no se dispararán. | clean |
| 35 | `mobile.schedules.supervisor.unsupported` | status | Wakes are not supervised on this platform yet, so the wakes below only fire while a conversation is running. | En esta plataforma aún no se supervisan los despertares, así que los de abajo solo se disparan mientras una conversación está en marcha. | clean |
| 36 | `mobile.schedules.supervisor.unverifiable` | status | Nothing supervises the wakes below, so they only fire while their conversation is running. | Nada supervisa los despertares de abajo, así que solo se disparan mientras su conversación está en marcha. | clean |
| 37 | `mobile.schedules.tail.failed` | status | {count} failed | {count, plural, one {# fallido} many {# de fallidos} other {# fallidos}} | **ES-SCH-5 (nit)** |
| 38 | `mobile.schedules.truncated` | status | Showing {shown} of {total} conversations with {family, select, wakes {wakes} other {monitors}}. | Mostrando {shown} de {total} conversaciones con {family, select, wakes {despertares} other {monitores}}. | **ES-SCH-1 (major)** — family noun |
## Executed render evidence

Produced by the app's own parser/formatter from the hashed es bytes; the full captured output is in `audit.log`.

### Counted nouns at 0 / 1 / 2 / 1 000 000

| key | input | es category | rendered |
|---|---|---|---|
| `count.wakes` | 0 | other | `0 despertares` |
| `count.wakes` | 1 | one | `1 despertar` |
| `count.wakes` | 2 | other | `2 despertares` |
| `count.wakes` | 1000000 | many | `1000000 de despertares` |
| `count.monitors` | 0 | other | `0 monitores` |
| `count.monitors` | 1 | one | `1 monitor` |
| `count.monitors` | 2 | other | `2 monitores` |
| `count.monitors` | 1000000 | many | `1000000 de monitores` |
| `summary.wakes` | 0 | other | `0 despertares programados` |
| `summary.wakes` | 1 | one | `1 despertar programado` |
| `summary.wakes` | 2 | other | `2 despertares programados` |
| `summary.wakes` | 1000000 | many | `1000000 de despertares programados` |
| `summary.monitors_armed` | 0 | other | `0 monitores armados` |
| `summary.monitors_armed` | 1 | one | `1 monitor armado` |
| `summary.monitors_armed` | 2 | other | `2 monitores armados` |
| `summary.monitors_armed` | 1000000 | many | `1000000 de monitores armados` |
| `show_more.wakes` | 0 | other | `Mostrar 0 despertares más` |
| `show_more.wakes` | 1 | one | `Mostrar 1 despertar más` |
| `show_more.wakes` | 2 | other | `Mostrar 2 despertares más` |
| `show_more.wakes` | 1000000 | many | `Mostrar 1000000 de despertares más` |
| `show_more.monitors` | 0 | other | `Mostrar 0 monitores más` |
| `show_more.monitors` | 1 | one | `Mostrar 1 monitor más` |
| `show_more.monitors` | 2 | other | `Mostrar 2 monitores más` |
| `show_more.monitors` | 1000000 | many | `Mostrar 1000000 de monitores más` |
| `tail.failed` | 0 | other | `0 fallidos` |
| `tail.failed` | 1 | one | `1 fallido` |
| `tail.failed` | 2 | other | `2 fallidos` |
| `tail.failed` | 1000000 | many | `1000000 de fallidos` |

### Head / due composition (`nextDueClause`)

| composition | output |
|---|---|
| `nextDueClause(3 despertares, 240s)` | `3 despertares · próximo en 4m` |
| `nextDueClause(2 monitores, -7200s)` | `2 monitores · vencido hace 2h` |
| `nextDueClause(1 despertar, 30s)` | `1 despertar · próximo en 30s` |
| `nextDueClause(3 wakes, 240s)` | `3 wakes · next in 4m` |
| `nextDueClause(2 monitors, -7200s)` | `2 monitors · 2h overdue` |
| `nextDueClause(1 wake, 30s)` | `1 wake · next in 30s` |

Reading: `head.next` splices `{head} · próximo {label}` onto `due.ahead` = `en {label}`, so
`3 despertares · próximo en 4m` — no duplicated preposition (the French wave's
“prochain dans dans 4m” defect does not recur here). `head.overdue` splices the
overdue phrase: `2 monitores · vencido hace 2h`, matching the desktop's
`tui.schedule.due_overdue` (“vencido hace {age}”) word for word.

### State words, empty states, cadence, truncation

| key / case | output |
|---|---|
| `mobile.schedules.state.disabled` | `desactivado` |
| `mobile.schedules.state.dormant` | `inactivo` |
| `mobile.schedules.state.expired` | `caducado` |
| `mobile.schedules.state.stale` | `obsoleto` |
| `mobile.schedules.state.waiting` | `en espera` |
| `mobile.schedules.cadence.once` | `una vez` |
| `mobile.schedules.empty.title` | `No hay nada armado` |
| `mobile.schedules.empty_line.wakes` | `No hay despertares programados.` |
| `mobile.schedules.empty_line.monitors` | `No hay monitores armados.` |
| `mobile.schedules.show_less.wakes` | `Mostrar menos despertares` |
| `mobile.schedules.show_less.monitors` | `Mostrar menos monitores` |
| `mobile.schedules.summary.monitors_attention` | `1 de 40 requieren atención` |
| `mobile.schedules.truncated` | `Mostrando 3 de 9 conversaciones con despertares.` |

### `truncated` at both families and boundary counts

| case | output |
|---|---|
| `family=wakes 3/9` | `Mostrando 3 de 9 conversaciones con despertares.` |
| `family=wakes 1/9` | `Mostrando 1 de 9 conversaciones con despertares.` |
| `family=monitors 3/9` | `Mostrando 3 de 9 conversaciones con monitores.` |
| `family=monitors 1/9` | `Mostrando 1 de 9 conversaciones con monitores.` |

### `summary.monitors_attention` — verb agreement at 1 / 2 / 1 000 000

| case | output |
|---|---|
| `broken=1 total=40` | `1 de 40 requieren atención` |
| `broken=2 total=40` | `2 de 40 requieren atención` |
| `broken=1000000 total=40` | `1000000 de 40 requieren atención` |

### Cadence splice

| case | output |
|---|---|
| `cadence.every(1d)` | `cada 1d` |
| `cadence.left(1d,3)` | `cada 1d · 3 por enviar` |
| `cadence.spent(1d)` | `cada 1d · no quedan envíos` |

## Findings

### ES-SCH-1 (MAJOR) — `monitor` terminology: catalogue contradicts glossary §2 and core's committed es

- **Affected keys (13):** `count.monitors`, `empty.body`, `empty_line.monitors`, `gone.monitors`, `parked.monitors`, `read_error.monitors`, `show_less.monitors`, `show_more.monitors`, `summary.monitors_armed`, `state.disabled`, `state.dormant`, `state.expired`, `truncated` (`other` arm).
- **Current:** `one {# monitor} many {# de monitores} other {# monitores}` and the same noun throughout (“los monitores vigilan”, “No hay monitores armados.”, “En pausa — los monitores se reanudan…”, “No se pudieron leer los monitores…”, “Mostrar menos monitores”, “No hay nada … con monitores”).
- **Problem:** `i18n/glossary.md` §2 records `monitor` as *translate* with es = **monitorización**, and §1 says prose about `monitor` translates exactly as it does for `wake`/`schedule` (only a tool invocation keeps the English word). Core's committed es agrees: `wire.settings.monitor.title` = “Monitorizaciones”, `wire.settings.monitor_maxconsecutivefailures.help` = “…antes de desactivar una monitorización”, `wire.settings.session_delegated.description` = “…en espera de un despertar o una monitorización”. The French wave translated the same keys with “surveillance(s)”. The es style guide records no exception, so the catalogue silently overrides a binding glossary row. Secondary effect: in Spanish “monitor” most readily reads as *display* or *instructor*, so the count line is not self-evident.
- **Suggested wording (with the feminine gender the glossary noun implies):**
  - `count.monitors` → `{count, plural, one {# monitorización} many {# de monitorizaciones} other {# monitorizaciones}}`
  - `empty.body` → `…; las monitorizaciones vigilan una cosa y avisan de lo que cambia.`
  - `empty_line.monitors` → `No hay monitorizaciones activas.`
  - `gone.monitors` → `Desaparecida — su conversación ya no está en esta máquina, así que nada la comprueba`
  - `parked.monitors` → `En pausa — las monitorizaciones se reanudan cuando su conversación vuelva a ejecutarse`
  - `read_error.monitors` → `No se pudieron leer las monitorizaciones de esta máquina.`
  - `show_less.monitors` → `Mostrar menos monitorizaciones`
  - `show_more.monitors` → `{hidden, plural, one {Mostrar # monitorización más} many {# de monitorizaciones más} other {# monitorizaciones más}}`
  - `summary.monitors_armed` → `{count, plural, one {# monitorización activa} many {# de monitorizaciones activas} other {# monitorizaciones activas}}`
  - `state.disabled` → `desactivada` · `state.dormant` → `inactiva` · `state.expired` → `caducada`
  - `truncated` → `…{family, select, wakes {despertares} other {monitorizaciones}}.`
  - `state.stale` (“obsoleto”, wake-side) and `state.waiting` (“en espera”) are unaffected.
- **Alternative disposition (equally valid, closes this finding without the rewrite):** record `monitor` as an es exception in `i18n/style-guides/es.md` with its reason (countable object, shorter than the glossary noun). The glossary permits a per-locale exception only when it is recorded there; what is not acceptable is a catalogue that contradicts both without a record. The auditor does not decide this — it is a manager call — but the current state is a recorded-decision gap either way.
- **Why MAJOR:** glossary violation across 13 keys, plus a gender cascade (the state words and “Desaparecido” are masculine only because the noun was changed).

### ES-SCH-2 (MAJOR) — `summary.monitors_attention` verb agreement at one broken monitor

- **Current:** `{broken} de {total} requieren atención`
- **Renders:** broken=1 → `1 de 40 requieren atención`; broken=2 → `2 de 40 requieren atención`.
- **Problem:** the verb must agree with the count. With exactly one alerting monitor — a common state — the header is ungrammatical. The French wave hit the same composed-heading class and avoided it by dropping the verb (`{broken} sur {total} en alerte`).
- **Suggested wording (allowed text → plural retype; `{total}` stays in every arm):**
  `{broken, plural, one {# de {total} requiere atención} many {# de {total} requieren atención} other {# de {total} requieren atención}}`
  → `1 de 40 requiere atención` / `2 de 40 requieren atención` / `1000000 de 40 requieren atención`.
- **Alternative (no retype):** `{broken} de {total} en alerta` — invariant, and matches the French solution's shape.

### ES-SCH-3 (MINOR) — “armado/armados” carries the English “armed” metaphor

- **Affected keys:** `empty.title` (“No hay nada armado”), `empty_line.monitors` (“No hay monitores armados.”), `summary.monitors_armed` (“# monitor armado / # monitores armados”).
- **Problem:** “armado” is a literal carry-over of *armed*; in Spanish it reads first as “assembled”. The terminal's committed es vocabulary never uses it — the same states are “programado” (`tui.schedule.status_scheduled`) and “se ejecutan” (`tui.schedule.notice_supervisor`), and core's monitor copy says “desactivar una monitorización” — and the French wave did not carry the metaphor (“Aucune planification active”, “# active”). Meaning is not lost, so this is not a blocker.
- **Suggested wording:** `empty.title` → `No hay nada en marcha`; `empty_line.monitors` → `No hay monitorizaciones activas.` (or `No hay monitores activos.` if ES-SCH-1 is closed by exception); `summary.monitors_armed` → `{count, plural, one {# monitorización activa} many {# de monitorizaciones activas} other {# monitorizaciones activas}}` (masculine `activo/activos` under the exception route).

### ES-SCH-4 (NIT) — “Desaparecido” as a row status

- **Current:** `Desaparecido — su conversación ya no está en esta máquina, así que nada lo comprueba` / `… nada lo dispara`
- **Problem:** “desaparecido” is strongly associated with missing persons in Spanish; as a one-word status for an orphaned schedule it invites a double take before the clause explains it. The clause itself carries the meaning, so nothing is unsafe.
- **Suggested:** `Ya no está — su conversación ya no existe en esta máquina, así que nada lo comprueba` / `… nada lo dispara`. (The two “ya no” clauses read naturally; the finding is only the status word.)

### ES-SCH-5 (NIT) — `tail.failed` counts an adjective

- **Current:** `{count, plural, one {# fallido} many {# de fallidos} other {# fallidos}}` → `1 fallido` / `2 fallidos`
- **Problem:** a bare substantivised adjective as a failure count; Spanish normally counts the noun, and the fragment reads like a truncated phrase next to the monitor's health sentence.
- **Suggested:** `{count, plural, one {# fallo} many {# de fallos} other {# fallos}}` → `1 fallo` / `2 fallos` / `1000000 de fallos`.
- **Status:** nit — current text is readable and the meaning (failed checks) survives.

## Consistency with core's committed es catalogues

Matched exactly: `cada {…}` (core `tui.schedule.cadence_every`), `una vez`, `en {duration}` (`tui.schedule.due_in`), `vencido hace {age}` (`tui.schedule.due_overdue`), “No hay despertares programados” (`tui.schedule.empty_header`), “desactivado” (`tui.schedule.value_off`), “obsoleto” (`tui.review.lane_stale`), “despertares”/“despertar”, “sesión”, “prompt”, “máquina”, “conversación”.
Consistent without an exact twin: “se disparan”/“disparan” follows core's own trigger vocabulary (`wire.settings.wakes_triggers_project_staleness_enabled.label` = “Disparador de obsolescencia de proyectos”); core's sentences for the supervisor case use “se ejecutan” instead, which is a different clause, not a contradiction.
Not matched: the monitor noun (ES-SCH-1).

## Second pass

This auditor re-read all 38 values a second time after the mechanical pass — this is
the largest and most composed namespace (nine keys are spliced into other strings).
No second *independent* auditor ran; if the manager wants one for this high-visibility
group, ES-SCH-1's disposition is the one to double-check, because it is a judgement
about a recorded decision rather than a mechanical defect.

## Limits

- No native-speaker human review: the judgement is an LLM auditor's.
- No rendered proof: no screenshot, simulator or device frame was captured; width statements rest on executed character counts, not on pixels.
- No ledger row and no ledger command: this repository has no i18n/ledger.json and no audit-ledger command (docs/i18n.md records the report in the pull request), so this bundle is the artifact of record.
- The repository validator (npm run -s i18n:catalogue:check) passes but does NOT parse the es bytes while es is absent from SHIPPED_LOCALES: its own line reads 'argument types from en, fr'. ICU validity for es is therefore established by this auditor's parse of every es message with src/i18n/messages.ts, not by the validator.
- Audited bytes are WORKING-TREE bytes: the es catalogues are untracked new files on feat/i18n-spanish at c5f491e, and src/i18n/catalogue.gen.ts is modified (it already carries an es projection). Verified against input_hashes.target.sha256, not against a committed revision.
