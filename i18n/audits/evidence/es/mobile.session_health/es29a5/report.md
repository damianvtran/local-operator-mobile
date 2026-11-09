# Audit report — mobile.session_health (es)

- **Audit ID:** es29a5
- **Date:** 2026-10-29
- **Auditor:** `i18n-auditor` (lopdev team); session `c58fa60fdb20`; **actual model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`
- **Translator:** `i18n-translator`; session `c53616dcee1c`; model `radient/auto` (as supplied by the requesting manager)
- **Verdict:** changes_requested
- **Keys:** 11 en / 11 es / 11 context
- **Unresolved blocker/major:** 1 (S-01)
- **Second independent pass:** reviewer job `8bb0387a07e8`, actual model `radient/auto`, read all 11 keys without my findings. It flagged the same `still_reopening` defect (as MINOR; I keep MAJOR and say why) and returned **passed** for the namespace; it agreed that `ended_placeholder` is correctly short.

## Scope and method

Every key against the English value and its context note, per `i18n/style-guides/es.md` and `i18n/glossary.md`. These are safety lines: the ones that say what a send does in an ended state, what a failure means and what is known. I checked specifically for softening, for promised delivery, for a promised deduplication on retry, and for a state word that contradicts the button it sits under. Read-only; no translation/MT service; no frame captured.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; projection current; strings ratchet 0 new.
- 11/11/11 keys; no missing/extra; context parity true.
- **No placeholders, plurals or selects exist in this namespace.**
- Typography: the two em dashes are spaced « — »; the trailing ellipsis in `ended_placeholder` is U+2026; no ASCII apostrophe, no NBSP/U+202F, no double space.
- Technical tokens: no command, flag, path or identifier in this namespace.

## Cross-check against core `es` (executed — see `audit.log`)

The Resume/ended vocabulary is core's, and this namespace must not invent a second one:

| Core key (`origin/main`, es) | Value |
|---|---|
| `relay.chrome.session.resume` | **«Reanudar»** |
| `relay.chrome.session.resuming` | **«Reanudando…»** |
| `relay.chrome.session.subtitle.ended` | **«Finalizada»** |
| `relay.health.ended_detail` | «El historial se conserva. Envía un mensaje o toca Reanudar para reabrir la sesión en tu carpeta personal.» |
| `relay.health.ended_send_failed` | «Esta sesión finalizó y no se pudo reabrir en este momento. Inténtalo de nuevo o toca “Finalizada” arriba y elige Reanudar.» |

- `resume_refused_title` «No se pudo reanudar» agrees with the button's **Reanudar** ✓.
- `resume_no_route` «…para reanudar esta sesión» uses the same verb ✓.
- `resume_refused` uses **reabrir** for the process, not "reanudar". That is core's own pattern in `ended_send_failed` («no se pudo reabrir… elige Reanudar»), so it is consistency, not divergence — recorded as S-2 below and **not** a change request.
- `reopening` «Reabriendo…» is not a divergence from core's «Reanudando…»: this app names the state "Reopening" (EN) / «Réouverture» (FR), because it is the reopen that the reader is waiting on, not the Resume command. The gerund also matches this catalogue's own progress pattern («Cargando…», «Guardando…», «Conectando…», «Iniciando…», «Enviando…»).
- The ended state word **Finalizada** is not rendered by this namespace at all; it comes from the mirrored `relay.chrome` catalogue, which is copied byte-identically and audited separately. Nothing here contradicts it.

## Fit evidence (executed — see `audit.log`)

`mobile.session_health.ended_placeholder` is the ended composer's placeholder. The field is ~324 px wide at 390 pt.

| String | chars | 16 pt | 200 % (32 pt) |
|---|---|---|---|
| «Envía para reabrir…» (current) | 19 | 161.9 pt | **306.2 pt** |
| «Envía para reabrir en tu carpeta personal…» (rejected) | 47 | 351.5 pt | — |
| "Send to reopen in your home folder…" (EN) | 35 | 302.2 pt | 581.2 pt |
| «Envoyer rouvre…» (FR) | 15 | 141.7 pt | — |

The Spanish value fits the 324 px field **even at 200 % text scale** (306.2 pt), while the English sentence the note measures needs 581.2 pt at the same scale. Dropping the destination clause is what buys that, and it is the resolution the source note itself sanctions (`ended_detail` carries the destination), and the one the merged French wave shipped.

## Findings

### S-01 — MAJOR — `mobile.session_health.still_reopening`

- **Current:** «Sigue reabriendo — todavía no ha arrancado.»
- **English:** "Still reopening — it has not come up yet."
- **Problem:** two calque markers in one line.
  1. `reabrir` is transitive; without the reflexive, «Sigue reabriendo» reads as *it keeps reopening [something]* — repeated attempts — which is the opposite of the fact this line exists to state ("the reopen is still pending, it has not silently failed", per the context note). A session reopens **se**; the native form is «Sigue reabriéndose».
  2. `no ha arrancado` borrows the startup verb used for a program/daemon (core: «Al arrancar…») for a session that has not **come up**. «todavía no está lista» states that fact without the metaphor.
- **Severity note:** the second independent pass rated this MINOR. I keep MAJOR under the audit's own definition (unidiomatic copy that changes the proposition the line carries): a reader who parses «Sigue reabriendo» as repeated attempts has been told the reopen is retrying itself, and the line's job is to distinguish *still pending* from *failed*. It is understandable either way — but it is not the sentence a Spanish product would ship.
- **Suggested:** **«Sigue reabriéndose — todavía no está lista.»** (46 chars, 274.7 pt)
- An acceptable variant that keeps the second clause closer to English: «Sigue reabriéndose — todavía no ha vuelto.» (closest to the French «elle n'est pas encore revenue»).

### S-2 — NIT (accepted, no change) — `mobile.session_health.resume_refused`

- **Current:** «Esta sesión no se pudo reabrir en este momento. Vuelve a intentarlo.»
- **Note:** the sentence uses **reabrir** while the button above it says **Reanudar**. That is core's own pairing in `relay.health.ended_send_failed` («no se pudo reabrir… elige Reanudar»), and the retry line is retryable as the context note requires. Recorded so a future reviewer does not "fix" it to *Reanudar* in one place and split the pair. No change.

### S-3 — NIT (accepted, no change) — `mobile.session_health.ended_placeholder`

- **Current:** «Envía para reabrir…» — English: "Send to reopen in your home folder…".
- **Note:** the Spanish drops the destination clause (*in your home folder*). That omission is the short form the source context note itself sanctions: the English and French strings both clip this field at 200 % (581.2 pt and ~590.9 pt against ~324 px), the note records that French ships «Envoyer rouvre…», and the destination is still stated in the health sheet through the mirrored `relay.health.ended_detail` («…reabrir la sesión en tu carpeta personal»). The Spanish form fits at 200 % with room (306.2 pt of 324). Adding the destination («Envía para reabrir en tu carpeta personal…», 351.5 pt at 100 %) would recreate the clipping the note documents. No change.

## Per-key disposition

| Key | Role | Verdict | Note |
|---|---|---|---|
| `control_hint` | help | clean | «Muestra qué significa este estado y qué hace un envío ahora» — describes what the sheet offers and promises no action it does not have. |
| `ended_placeholder` | help | clean (S-3 NIT, accepted) | «Envía para reabrir…» — U+2026; says sending reopens; the destination lives in `ended_detail`. Fits the field at 200 %. |
| `menu_hint` | button | clean | «Abre el menú de la sesión». |
| `menu_label` | button | clean | «Acciones de la sesión» — accessible name of the ⋮ control; plural noun, sentence case. |
| `menu_title` | heading | clean | «Sesión» — one short noun, not the conversation's name. |
| `reopening` | status | clean | «Reabriendo — esto puede tardar unos segundos.» — names the wait instead of a bare ellipsis, as the note requires. |
| `resume_gone` | status | clean | «Esta sesión ya no está guardada.» — a 404, never invites a retry. (The Past screen still renders this sentence from an English literal; see the note below — a code-side gap, not this key's.) |
| `resume_no_route` | status | clean | «Conecta una máquina para reanudar esta sesión.» — names the missing prerequisite, does not blame the session. |
| `resume_refused` | status | clean (S-2 NIT, accepted) | Retryable; agrees with core's verb pairing. |
| `resume_refused_title` | heading | clean | «No se pudo reanudar» — agrees with the button «Reanudar» (core `relay.chrome.session.resume`). |
| `still_reopening` | status | **S-01 MAJOR** | See above. |

## Context the manager should have (not a finding — no catalogue key is involved)

`src/features/past/past.tsx:109` sets the refusal to the **English literal** `"This session is no longer saved."` — the same sentence as `mobile.session_health.resume_gone` — so the Past screen will show English in Spanish even though the key is translated. This is a code-side localisation gap outside a translation audit's authority; it is the same class the French wave fixed for the conversation-details label.

## Notes and limits

- No human native-speaker review; no rendered frame. The placeholder fit claim is executed text metrics against the stated field width, not a screenshot.
- Repository has no `i18n/ledger.json` and no audit-ledger command; a ledger-ready row is in `record.json.ledger.ledger_row_proposed`, explicitly unwritten.
- No keyed public-copy receipt is claimed.
