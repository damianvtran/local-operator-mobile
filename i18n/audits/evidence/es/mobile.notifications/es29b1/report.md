# Audit report — mobile.notifications (es)

- **Audit ID:** es29b1
- **Date:** 2026-10-29 (session date; command timestamps inside `audit.log` are UTC and fall on 2026-10-30)
- **Auditor:** i18n-auditor (lopdev team); session `1f01d8fb4b08`; actual model **radient/auto**
  (temporary provider-quota fallback from anthropic/claude-sonnet-5-5, via openai/gpt-6-astra and kimi/k3.1-pro; every command below ran under radient/auto)
- **Translator:** i18n-translator; session `c53616dcee1c`; model `radient/auto` (as reported in the task brief, not independently observed)
- **Independence:** different agent context and session from the translator; **same served model** — identity independence only, disclosed and not closed
- **Verdict:** **passed**
- **Keys:** 14 en / 14 es
- **Unresolved blocker/major:** 0

## Mechanical checks (all executed; output in `audit.log`)

- JSON valid: yes — the catalogue and the context sidecar both parse (`JSON.parse` in the logged audit script; a malformed file throws there).
- Key parity: en=14 es=14, no key added or dropped.
- Context parity: 14 notes for 14 keys — every key had its translator note.
- Placeholders: identical names in every key. No retype in this namespace (all 14 are plain text).
- ICU: no plural/select in this namespace, so no arm coverage to check.
- Typography: no space before `? ! : ;`, no straight quotes or guillemets, “…” not used here, no double spaces, no trailing whitespace, no bidi control characters (scans in the log).
- English-token sweep: no whole English word rendered in any value.
- Repository validator `npm run -s i18n:catalogue:check`: exit 0 — with the caveat that it does not parse es while es is unshipped (see Limits).

## Per-key review

Every key was read against its English source and its context note.

| # | key | role | English | Spanish | judgement |
|---|---|---|---|---|---|
| 1 | `mobile.notifications.answer` | button | Answer | Responder | clean |
| 2 | `mobile.notifications.back` | button | Back | Atrás | clean |
| 3 | `mobile.notifications.detail.answer_in_conversation` | button | Answer in conversation | Responder en la conversación | clean |
| 4 | `mobile.notifications.detail.conversation_asks` | heading | This conversation's asks | Preguntas de esta conversación | clean |
| 5 | `mobile.notifications.detail.earlier_updates` | heading | Earlier updates | Actualizaciones anteriores | clean |
| 6 | `mobile.notifications.detail.from` | heading | From | De | clean |
| 7 | `mobile.notifications.detail.no_asks` | status | No asks in this conversation. | No hay preguntas en esta conversación. | clean |
| 8 | `mobile.notifications.detail.nothing_to_dismiss` | status | No updates from this conversation to dismiss. | No hay actualizaciones de esta conversación que descartar. | clean |
| 9 | `mobile.notifications.detail.projects` | heading | Projects | Proyectos | clean |
| 10 | `mobile.notifications.dismiss` | button | Dismiss | Descartar | clean |
| 11 | `mobile.notifications.filter_label` | meta | Show | Mostrar | clean |
| 12 | `mobile.notifications.load_failed` | heading | Couldn't load notifications | No se pudieron cargar las notificaciones | clean |
| 13 | `mobile.notifications.priority_high` | status | High | Alta | clean |
| 14 | `mobile.notifications.title` | heading | Notifications | Notificaciones | clean |

## Findings

None. No BLOCKER, MAJOR, MINOR or NIT finding was raised in this namespace.

Checked and deliberately not raised:

- `detail.conversation_asks` / `detail.no_asks` — “Preguntas” for the product word “ask”. Consistent with core's committed es (`relay.asks.status.expired`: “esta pregunta es demasiado antigua…”), where an ask is a *pregunta*.
- `detail.from` — “De” is the ordinary one-word heading for “From”; no article needed in a heading.
- `filter_label` — “Mostrar” (verb-as-label) matches the context note and the es action-label convention.
- `priority_high` — “Alta” is the standard Spanish priority badge (prioridad alta), one word, no full stop.
- `load_failed` — “No se pudieron cargar las notificaciones” states the failure without implying an empty inbox; no final full stop, as in the English alert title.

## Consistency with core's committed es catalogues

- dismiss → “Descartar” matches core's `relay.asks.status.dismissed` (“Descartado”).
- ask → “pregunta” matches `relay.asks`.
- answer → “Responder” matches `relay.asks.status.answered` register.

## Second pass

This auditor re-read all 14 values a second time after the mechanical pass (the
namespace feeds the inbox and its error alert). No second *independent* auditor ran;
that is the manager's call, and this report does not claim one.

## Limits

- No native-speaker human review: the judgement is an LLM auditor's.
- No rendered proof: no screenshot, simulator or device frame was captured; width statements rest on executed character counts, not on pixels.
- No ledger row and no ledger command: this repository has no i18n/ledger.json and no audit-ledger command (docs/i18n.md records the report in the pull request), so this bundle is the artifact of record.
- The repository validator (npm run -s i18n:catalogue:check) passes but does NOT parse the es bytes while es is absent from SHIPPED_LOCALES: its own line reads 'argument types from en, fr'. ICU validity for es is therefore established by this auditor's parse of every es message with src/i18n/messages.ts, not by the validator.
- Audited bytes are WORKING-TREE bytes: the es catalogues are untracked new files on feat/i18n-spanish at c5f491e, and src/i18n/catalogue.gen.ts is modified (it already carries an es projection). Verified against input_hashes.target.sha256, not against a committed revision.
