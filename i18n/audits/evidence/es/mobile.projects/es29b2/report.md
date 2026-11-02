# Audit report — mobile.projects (es)

- **Audit ID:** es29b2
- **Date:** 2026-10-29 (session date; command timestamps inside `audit.log` are UTC and fall on 2026-10-30)
- **Auditor:** i18n-auditor (lopdev team); session `1f01d8fb4b08`; actual model **radient/auto**
  (temporary provider-quota fallback from anthropic/claude-sonnet-5-5, via openai/gpt-6-astra and kimi/k3.1-pro; every command below ran under radient/auto)
- **Translator:** i18n-translator; session `c53616dcee1c`; model `radient/auto` (as reported in the task brief, not independently observed)
- **Independence:** different agent context and session from the translator; **same served model** — identity independence only, disclosed and not closed
- **Verdict:** **passed**
- **Keys:** 15 en / 15 es
- **Unresolved blocker/major:** 0

## Mechanical checks (all executed; output in `audit.log`)

- JSON valid: yes.
- Key parity: en=15 es=15; context notes 15/15.
- Placeholders: names identical in all 15 keys. One retype: `milestones.count` promotes `{completed}` text → plural (allowed: the Spanish noun agrees with the completed count); `{total}` survives as a plain placeholder inside every arm — verified by rendering each arm with three different totals (table below).
- ICU: `milestones.count` and `sessions.count` carry one/many/other — exactly the categories `Intl.PluralRules('es')` reports for this runtime (0=other, 1=one, 2=other, 1000000=many). No `few`, no `zero`, no `=N` arm.
- `write_receipt`: outer `kind` select has project/milestone/other; each kind arm repeats the full 7-code `action` select plus `other` — identical arm sets to English in all three arms (log).
- Typography: `¿…?` on the two destructive confirmations; no space before `? ! : ;`; no guillemets; no double spaces; no bidi controls.
- English-token sweep: the only Latin tokens are ICU arm codes and `{subject}`/`{name}` placeholders, none of which render.
- Repository validator: exit 0 (does not parse es while unshipped — see Limits).

## Per-key review

| # | key | role | English | Spanish | judgement |
|---|---|---|---|---|---|
| 1 | `mobile.projects.delete_body` | confirm | Delete {name}? The project row goes for good. Its linked sessions and their transcripts are not touched. | ¿Eliminar {name}? La fila del proyecto se borra para siempre. Sus sesiones vinculadas y sus transcripciones no se tocan. | clean |
| 2 | `mobile.projects.draft_kept_note` | help | Kept from your last visit. Clear the fields to start something new. | Se conservó de tu última visita. Vacía los campos para empezar algo nuevo. | **ES-PROJ-2 (nit)** |
| 3 | `mobile.projects.milestone_slash_note` | help | Milestone names can't contain a slash. A milestone with one could never be removed. | Los nombres de hito no pueden contener una barra. Un hito con barra nunca podría quitarse. | clean |
| 4 | `mobile.projects.milestones.count` | meta | {completed} of {total} milestones | {completed, plural, one {# hito de {total}} many {# de hitos de {total}} other {# hitos de {total}}} | clean |
| 5 | `mobile.projects.milestones.none` | meta | no milestones | sin hitos | clean |
| 6 | `mobile.projects.project_name_hint` | help | 1-64 characters: letters, digits, dot, underscore or hyphen. No spaces, and it can't start with a hyphen. | De 1 a 64 caracteres: letras, dígitos, punto, guion bajo o guion. Sin espacios, y no puede empezar por guion. | clean |
| 7 | `mobile.projects.remove_milestone_body` | confirm | Remove {name} from this project? The milestone goes for good. The project's sessions and its progress line are not touched. | ¿Quitar {name} de este proyecto? El hito se borra para siempre. Las sesiones del proyecto y su línea de progreso no se tocan. | clean |
| 8 | `mobile.projects.session_state.filed_by` | status | filed by | registrada por | clean |
| 9 | `mobile.projects.session_state.missing` | status | missing | ausente | clean |
| 10 | `mobile.projects.session_state.not_running` | status | not running | detenida | clean |
| 11 | `mobile.projects.sessions.count` | meta | {count, plural, one {# session} other {# sessions}} | {count, plural, one {# sesión} many {# de sesiones} other {# sesiones}} | clean |
| 12 | `mobile.projects.sessions.live` | meta | {base} · {live} live | {base} · {live} en curso | clean |
| 13 | `mobile.projects.stale_badge` | status | progress stale | progreso obsoleto | clean |
| 14 | `mobile.projects.write_receipt` | status | {kind, select, project {{action, select, created {Created} completed {Completed} reopened {Reopened} added {Added} updated {Updated} removed {Removed} deleted {Deleted} other {Updated}} {subject}.} milestone {{action, select, created {Created} completed {Completed} reopened {Reopened} added {Added} updated {Updated} removed {Removed} deleted {Deleted} other {Updated}} milestone {subject}.} other {{action, select, created {Created} completed {Completed} reopened {Reopened} added {Added} updated {Updated} removed {Removed} deleted {Deleted} other {Updated}} {subject}.}} | {kind, select, project {Proyecto {subject} {action, select, created {creado} completed {completado} reopened {reabierto} added {añadido} updated {actualizado} removed {quitado} deleted {eliminado} other {actualizado}}.} milestone {Hito {subject} {action, select, created {creado} completed {completado} reopened {reabierto} added {añadido} updated {actualizado} removed {quitado} deleted {eliminado} other {actualizado}}.} other {{subject} {action, select, created {creado} completed {completado} reopened {reabierto} added {añadido} updated {actualizado} removed {quitado} deleted {eliminado} other {actualizado}}.}} | **ES-PROJ-1 (minor)** — `other` kind arm |
| 15 | `mobile.projects.write_unknown_note` | status | We couldn't reach your computer, so we can't tell whether that was saved. Check the project before trying again. | No pudimos llegar a tu máquina, así que no sabemos si se guardó. Revisa el proyecto antes de volver a intentarlo. | clean |
## Executed render evidence

All values below were produced by the app's own parser/formatter (`src/i18n/messages.ts`), from the es catalogue bytes hashed in `input_hashes`.

### `write_receipt` — 7 action codes × 3 kinds (es)

| render | output |
|---|---|
| `project/created` | `Proyecto pagos-migración creado.` |
| `project/completed` | `Proyecto pagos-migración completado.` |
| `project/reopened` | `Proyecto pagos-migración reabierto.` |
| `project/added` | `Proyecto pagos-migración añadido.` |
| `project/updated` | `Proyecto pagos-migración actualizado.` |
| `project/removed` | `Proyecto pagos-migración quitado.` |
| `project/deleted` | `Proyecto pagos-migración eliminado.` |
| `milestone/created` | `Hito beta corta creado.` |
| `milestone/completed` | `Hito beta corta completado.` |
| `milestone/reopened` | `Hito beta corta reabierto.` |
| `milestone/added` | `Hito beta corta añadido.` |
| `milestone/updated` | `Hito beta corta actualizado.` |
| `milestone/removed` | `Hito beta corta quitado.` |
| `milestone/deleted` | `Hito beta corta eliminado.` |
| `other/created` | `beta corta creado.` |
| `other/completed` | `beta corta completado.` |
| `other/reopened` | `beta corta reabierto.` |
| `other/added` | `beta corta añadido.` |
| `other/updated` | `beta corta actualizado.` |
| `other/removed` | `beta corta quitado.` |
| `other/deleted` | `beta corta eliminado.` |
| `kind=project action=archived` | `Proyecto pagos-migración actualizado.` |
| `kind=workspace action=created` | `pagos-migración creado.` |
| `en project/created` | `Created payments.` |
| `en milestone/created` | `Created milestone payments.` |
| `en other/created` | `Created payments.` |

The last six rows of the table are the two unknown codes (`kind=project action=archived`,
`kind=workspace action=created`) and the English renders of the same key through the same
parser (`Created payments.` / `Created milestone payments.` / `Created payments.`).

Reading of the table: every one of the 21 combinations has the right gender
(`Proyecto … creado`, `Hito … creado`) and the right participle per action; no
English word renders anywhere; word order (noun + subject + participle) matches the
French wave's structure, which the context note explicitly permits.
The `other` kind arm is the one weak shape: `beta corta creado.` hangs a participle
on a bare name (finding ES-PROJ-1).

### `milestones.count` — plural categories and `{total}` survival

| completed | rendered |
|---|---|
| 0 [other] | `0 hitos de 40` |
| 1 [one] | `1 hito de 40` |
| 2 [other] | `2 hitos de 40` |
| 1000000 [many] | `1000000 de hitos de 40` |
`{total}` survival, proven by rendering each arm with three totals:

```
  arm one (completed=1): "1 hito de 1" | "1 hito de 7" | "1 hito de 40" -> total-sensitive=true
  arm many (completed=1000000): "1000000 de hitos de 1" | "1000000 de hitos de 7" | "1000000 de hitos de 40" -> total-sensitive=true
  arm other (completed=0): "0 hitos de 1" | "0 hitos de 7" | "0 hitos de 40" -> total-sensitive=true
```

### `sessions.count` / `sessions.live`

| case | output |
|---|---|
| count 0 [other] | `0 sesiones` |
| count 1 [one] | `1 sesión` |
| count 2 [other] | `2 sesiones` |
| count 1000000 [many] | `1000000 de sesiones` |
| sessions.live(base=4 sesiones, live=2) | `4 sesiones · 2 en curso` |
| milestones.none | `sin hitos` |
| stale_badge | `progreso obsoleto` |
| filed_by | `registrada por` |
| missing | `ausente` |
| not_running | `detenida` |

## Findings

### ES-PROJ-1 (MINOR) — `mobile.projects.write_receipt`, `other` kind arm

- **Current:** `other {{subject} {action, select, created {creado} completed {completado} reopened {reabierto} added {añadido} updated {actualizado} removed {quitado} deleted {eliminado} other {actualizado}}.}`
- **Renders:** `beta corta creado.` (and `pagos-migración creado.` for an unknown kind)
- **Problem:** the unknown-kind fallback leaves the participle with no noun to agree with, so the receipt reads as a truncated phrase. English tolerates this because its arm is verb-first (`Created payments.`); Spanish is participle-last and needs a head. The arm is reachable by design (context: “other catches an unknown kind or an unknown action code”).
- **Suggested wording (period moves inside each arm):**
  `other {{action, select, created {Creado: {subject}} completed {Completado: {subject}} reopened {Reabierto: {subject}} added {Añadido: {subject}} updated {Actualizado: {subject}} removed {Quitado: {subject}} deleted {Eliminado: {subject}} other {Actualizado: {subject}}}}`
  → `Creado: beta corta.` / `Actualizado: pagos-migración.`
- **Why MINOR, not MAJOR:** the 21 real combinations are correct; only the unknown-kind fallback is affected and its meaning is not lost.

### ES-PROJ-2 (NIT) — `mobile.projects.draft_kept_note`

- **Current:** `Se conservó de tu última visita. Vacía los campos para empezar algo nuevo.`
- **Problem:** the impersonal preterite `Se conservó` is understandable but vaguer than the English fragment; the note tells the reader *what* was kept only implicitly.
- **Suggested:** `Guardado de tu última visita. Vacía los campos para empezar algo nuevo.`
- **Status:** nit — current text is grammatical and safe.

## Consistency with core's committed es catalogues

- milestone → **hito** matches core (`tui.projects_edit.binding_add_milestone`: “Añadir hito”; `milestone_added`: “hito “{name}” añadido”).
- session → **sesión** (feminine) matches everywhere in core.
- stale → **obsoleto** matches `tui.review.lane_stale` and `wire.settings.projects`.
- `sessions.count` arms (`one {# sesión} many {# de sesiones} other {# sesiones}`) are byte-identical in shape to core's `relay.session.tags.more` and `tui.schedule.subtitle`.
- “registrada por”: core has no `filed by` twin to compare, so this is a convention judgement — it follows the same lower-case, no-full-stop status fragment shape as core's `relay.*`/`tui.*` status words (“programado”, “descartado”, “obsoleto”).

## Second pass

This auditor re-read all 15 values a second time after the mechanical pass and the
render tables — projects copy is high-visibility (destructive confirmations, the
name grammar, the success receipt). No second *independent* auditor ran; that is the
manager's decision and this report claims none.

## Limits

- No native-speaker human review: the judgement is an LLM auditor's.
- No rendered proof: no screenshot, simulator or device frame was captured; width statements rest on executed character counts, not on pixels.
- No ledger row and no ledger command: this repository has no i18n/ledger.json and no audit-ledger command (docs/i18n.md records the report in the pull request), so this bundle is the artifact of record.
- The repository validator (npm run -s i18n:catalogue:check) passes but does NOT parse the es bytes while es is absent from SHIPPED_LOCALES: its own line reads 'argument types from en, fr'. ICU validity for es is therefore established by this auditor's parse of every es message with src/i18n/messages.ts, not by the validator.
- Audited bytes are WORKING-TREE bytes: the es catalogues are untracked new files on feat/i18n-spanish at c5f491e, and src/i18n/catalogue.gen.ts is modified (it already carries an es projection). Verified against input_hashes.target.sha256, not against a committed revision.
