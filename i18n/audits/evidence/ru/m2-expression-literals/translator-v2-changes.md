# Russian M2 — remediation round 1

Translator session: bb00aa739d8b. Actual served model: `openai/gpt-6.1-sol` (this run's model header); no model fallback used. Date: 2026-11-11.
Lane: bounded translation fix (<2 h). Candidate only: no repository edits, commits, ledger writes or self-audit. Independent audits must review these new bytes.

## Deliverable

`ru.v2.json`: exactly 32 source-ordered keys from `keys32.json`; 8 existing values changed and 5 new values added. All remaining 19 values retained. SHA-256: `443fbd3a08819fb2a40215f39b7c94e761d144a211215dec1a1dac14cd88dc96`.

Read both original independent reports: `r1/audit-ru-A.md` (deepseek/deepseek-flash), `r1/audit-ru-B.md` (anthropic/claude-sonnet-5-5), the English/context in keys32.json, the Russian style guide and glossary, and shipped mobile/core references. These are translator dispositions, not a new audit verdict.

## Recounted reference evidence

Read current files under `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/ru/` and `~/local-operator/local_operator/i18n/catalogues/ru/` with Python json.loads, counting only string-valued entries (metadata must not be counted as messages). Mobile: 649 messages, 21 namespaces; there are 22 JSON files including context/metadata. Core: 1,947 string messages in 40 JSON files. References below describe these local checkout bytes, not a claim that an unmerged candidate has shipped.

- Mobile/core `relay.chrome.session.subtitle.not_answering` = `Не отвечает` (one exact case-insensitive value occurrence in each catalogue). Both new status and stream_degraded now reuse it byte-for-byte. Capital N in the diagnostic deliberately follows the manager's verbatim-reuse decision over the source sidecar's lower-case preference.
- Mobile/core `relay.chrome.session.subtitle.idle` = `Простой` (one exact occurrence each). We retain the same noun, adding the Russian locative phrase `в простое` to remove the adjective reading after `Поток`.
- Mobile `mobile.computers.badge.connecting` = `подключается` (one exact occurrence); `mobile.computers.badge.active` = `активен` (two exact catalogue occurrences, the other is a project status). These stream values are unchanged and remain distinct from each other, idle, offline and degraded.
- Mobile `relay.health.live` = `В сети`; `mobile.schedules.state.disabled` = `отключён`. This supports `вне сети` for stream_offline rather than reusing the disabled word.
- Mobile `mobile.settings.diagnostics.route_direct` = `Напрямую к ретранслятору`; `mobile.chrome.composer.row_usage` = `Контекст`.
- Mobile `mobile.chrome.drawer.agents` = `Агенты`, `relay.chrome.session.tray.agents` = `Агенты {running}/{total}`, `relay.chrome.session.tray.tasks` = `Задачи {done}/{total}`, `mobile.session.sheet_title.status` = `Задачи и агенты`. Core also has `relay.chrome.session.agents_title` = `Агенты` and `tasks_title` = `Задачи`. New inline labels use those nouns in lower case.
- Mobile `mobile.session.highlights.video_open` = `Воспроизвести видео {name}`. Keep video fallback `Видео`: same noun, heading capitalization.
- No `конт.` occurrence exists in either reference catalogue. It is an explicitly proposed narrow-form convention, not an established shipped glossary term.

Call-site verification, not just auditor assertions: settings.tsx:717 says unrouted = No connection yet; :725–728 maps offline and degraded to Offline / Not answering. :593–595 renders diagnostics from the SAME streamHealth. Thus no evidence supports introducing instability as a separate degraded meaning. The checked-out file still renders raw streamHealth rather than the auditors' described streamWord helper; the source notes and the state-to-status mapping, not that unavailable helper, ground this decision. computers.tsx:627–630 confirms connected_to receives an arbitrary appeared.name or fallback. video.tsx:168 and agent/[jobId].tsx:93 confirm Back to is a navigation accessibility label. Session [id].tsx:1071–1075 still has the four English REGION_LABEL nouns in this checkout: translations supplied, wiring not claimed.

## Findings — both reports, individually answered

Disposition totals: **10 fixed, 7 declined** across A's 8 and B's 9 findings. Informational wiring observations are addressed separately, not counted twice.

| Finding | Disposition | Reason / evidence |
|---|---|---|
| A M-1 connected_to | fixed | `Подключено: {name}.` removes bureaucracy AND the arbitrary-name declension hazard identified by A. Fallback changed to nominative `ваш компьютер`. computers.tsx accepts arbitrary names, so merely shortening to `к {name}` would leave the Cyrillic-name defect. |
| A M-2 stream_degraded | declined | Keep the shipped `Не отвечает`, now byte-identical including capitalization. The same streamHealth drives status and diagnostics; sidecar explicitly says stream open but not answering. `нестабилен` implies a different condition without evidence. Manager decision 1 is binding. |
| A M-3 stream_idle | fixed | `в простое` preserves shipped `Простой` vocabulary and removes the bare adjective reading of `Поток: простой`. Eight cells versus six; no rendered-fit claim. |
| A M-4 route_direct | declined | Did not adopt `Напрямую к {baseUrl}`: unlike the diagnostics route label this account line explicitly asserts an existing connection. Use `Подключено напрямую к {baseUrl}` to preserve that predicate (also resolves B N2). Shortening is not falsely claimed. |
| A M-5 more_below | fixed | `ещё ниже · прокрутить ↓` is a terse continuation cue consistent with its lower-case role. Dot/arrow unchanged. |
| A N-1 context_short | declined | Retain `конт.`; do not expand to `конт. окна` (which erases the four-cell gain). Record the abbreviation exception/proposal below instead of changing an out-of-scope style guide. |
| A N-2 no_connection | fixed | `Пока нет подключения` restores yet and distinguishes the not-chosen-yet state from `Вне сети` / `вне сети`; settings.tsx:717 confirms the unrouted condition. |
| A N-3 wait.host_answering | declined | Retain `Настроенный маршрут`: source sidecar says a listed route does not prove a machine is running. `выделенный` introduces a dedicated/allocated-resource nuance not needed for that distinction. The caution and host placeholder remain intact. |
| B F1 no_connection | fixed | Same explicit `Пока` fix as A N-2; did not substitute Computer not selected, which would replace the source statement rather than translate it. |
| B F2 stream_offline | fixed | `вне сети` now pairs with status `Вне сети` and shipped live `В сети`, avoiding shipped disabled `отключён`. |
| B F3 stream_idle | fixed | `в простое` resolves the adjective ambiguity while retaining shipped idle terminology; `не запущен` could imply the stream/process never ran, and `ожидает` would abandon the shared term. |
| B F4 more_below | fixed | Same terse cue as A M-5. |
| B F5 short context forms | declined | Do not expand to full `контекст` or make narrow == wide: manager decision 2 requires a real width saving. Retain the transparent graphic contraction `конт.` with an explicit terminology exception; do not claim it is a pre-existing standardized abbreviation. Period is intentional abbreviation punctuation, not an accidental sentence stop. Widths measured below. |
| B N1 connected_to | fixed | Same colon-frame and nominative-fallback fix as A M-1. |
| B N2 route_direct | fixed | `Подключено напрямую к {baseUrl}` restores the explicit connected state rather than the previous noun phrase. |
| B N3 context_estimate | declined | No change: report itself says `прибл.` is acceptable; `оценка` is longer and reads as a label, not an estimate qualifier. Parentheses preserved. |
| B N4 wait.host_answering | declined | No change: report confirms current impersonal omission of your and host-address construction are idiomatic and faithful. There is no defect to fix. |

B W1 / W2 (wiring observations, not translation findings): the five new source keys now cover all four region nouns and Back to. This translation-only task does not modify their still-English call sites.

## New keys and grammatical composition

- working: `активность`; subagents: `агенты`; todos: `задачи`; strip: `статус`. Composed sample: `ниже: активность · агенты · задачи · статус · прокрутить ↓`. The colon frame requires no common case-inflection or plural agreement across the list.
- back_to: `Назад: {name}`. The existing bare `сессия` stays nominative and remains suitable as a title. Examples: `Назад: сессия`, `Назад: План релиза`, `Назад: demo-session`. A navigation-label colon frame identifies the destination without governing dative; `Назад к сессия` is never produced.
- connected_to + computer fallback: `Подключено: ваш компьютер.`; actual-name samples `Подключено: MacBook Pro.`, `Подключено: Домашний компьютер.`. Label/value syntax accepts the uninflected displayed name; no assumption that Cyrillic user names can be inflected by the renderer.
- **No split-key request**: the case-neutral frames solve both variable-name issues without changing session.fallback_name. Note that the existing computer and session fallback keys are already distinct; neither is repurposed.

## Narrow forms / glossary proposals

At percent=100, measured by Python character count (every character here is ASCII or Cyrillic, East Asian width 1):

| Form | String | Cells |
|---|---|---:|
| wide | `100% контекста` | 14 |
| narrow | `100% конт.` | 10 |
| wide estimate | `100% контекста (прибл.)` | 23 |
| narrow estimate | `100% конт. (прибл.)` | 19 |

Both narrow forms save **4 cells**. These are string-cell counts, not React Native proportional-font geometry or rendered proof. No maxCells/maxChars bound was provided for these keys; no screenshot or under-340pt fit claim is made.

**Recorded abbreviation exception / glossary proposal:** use `конт.` only in this percent-context narrow tray slot, with the wide `контекста` form establishing the referent. Russian has no uniquely standardized short form of контекст that I can substantiate from the provided glossary/catalogues. This graphic contraction is chosen to honor the manager's strict-width requirement, not presented as an already-shipped term. A full-word exception would sacrifice the requested saving; the independent audit must judge this scoped contraction. No style-guide file was changed. Other proposed term: activity band → `активность` (not a background job or todo; those remain `задание` / `задача`).

## Actual validation executed

1. `python3` loaded keys32.json and ru.v2.json; checked 32 keys, exact order, nonempty values, simple ICU placeholder names AND order against English, NFC, and English-identical allowlist. Actual output:

```text
ru.v2: 32 keys; exact source order; placeholder names/order identical; empties=0; NFC clean; English-identical=Local Operator only; errors=0
No ICU plural/select expressions in this slice; simple-placeholder check covers every expression.
sha256=443fbd3a08819fb2a40215f39b7c94e761d144a211215dec1a1dac14cd88dc96
```

2. In `~/local-operator-mobile/.worktrees/i18n-app-scan`: `npm run -s i18n:catalogue:check` exited **0**, actual stdout:

```text
src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
```

Node also emitted MODULE_TYPELESS_PACKAGE_JSON for existing src/i18n/messages.ts, reparsing as ES module. No configuration change or suppression was made.

Scope limitation: repository catalogue check validates the current checkout, NOT the scratch candidate merged into it; the Python check validates the candidate itself. Integration generation/check, rendered validation and independent linguistic auditing remain with the manager's integration/review lanes. No passed status claimed and no audit bundle fabricated.
