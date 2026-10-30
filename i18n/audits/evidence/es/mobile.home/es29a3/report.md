# Audit report — mobile.home (es)

- **Audit ID:** es29a3
- **Date:** 2026-10-29
- **Auditor:** `i18n-auditor` (lopdev team); session `c58fa60fdb20`; **actual model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`
- **Translator:** `i18n-translator`; session `c53616dcee1c`; model `radient/auto` (as supplied by the requesting manager)
- **Verdict:** changes_requested
- **Keys:** 27 en / 27 es / 27 context
- **Unresolved blocker/major:** 4 (H-01, H-02, H-03, H-04)
- **Second independent pass:** reviewer job `8bb0387a07e8`, actual model `radient/auto` (pinned `anthropic/claude-sonnet-5-5`, quota fallback), read all 27 keys without my findings. It independently agreed on the two hard tip overruns and on the mixed voice of the suggestion pool; it read `tip.parallel` as within budget, split the pool into two findings, and proposed different replacement wording (recorded under each finding).

## Scope and method

Every key read against the English value and its context note, per `i18n/style-guides/es.md` and `i18n/glossary.md`. Read-only. No translation/MT service. Fit is measured, not inferred: the app's own token sizes (`body-sm` 14 pt for suggestion rows, `meta` 12 pt/500 for the tip line) with the platform text stack (CoreText, system font = SF Pro) — all rows executed in `audit.log`. Widths are points; React Native dp == pt on iOS. **No frame was captured**, so the numbers are text metrics, not pixels on a device.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`; `check-strings: 284 finding(s), all baselined; 0 new`.
- 27/27/27 keys; no missing/extra; context parity true.
- **No placeholders, plurals or selects exist in this namespace.**
- Typography clean across all 27 values: U+2026 for every ellipsis, no `...`, no ASCII apostrophe, no NBSP/U+202F, no double space, no guillemet, no mis-spaced em dash, `¿…?` only on the greeting.
- `mobile.home.options.fixed` names `mobile.session.conversation_details` **byte-identically**: «Detalles de la conversación» in both files (verified by string comparison, not by eye). The destination control is keyed (`startup-transcript.tsx:52` reads `t("mobile.session.conversation_details")` since c5f491e), so the label a Spanish reader is told to look for does exist in Spanish.

## Fit evidence (executed, see `audit.log`)

Row geometry from the code, not assumed: `home-splash.tsx` sits inside `px-4`, so on a 320 pt phone the content column is **288 pt**. A suggestion row is a `w-full` `Button` of size `md` (`px-4` padding, 1 pt border), so its **text box is ~254 pt**. The tip row is content-sized with a 12 pt icon plus a 6 pt gap ahead of the text, so its text starts 18 pt into that column.

### Suggestion chips (14 pt / 400, text box 254 pt)

| Key | Spanish | Chars | Measured |
|---|---|---|---|
| `last_turn` | Muéstrame el último turno | 25 | 193.4 pt |
| `linear_mcp` | Configurar Linear MCP | 20 | 165.7 pt |
| `phone_access` | Activar acceso desde el teléfono | 32 | **236.8 pt** |
| `review_repo` | Revisar este repo | 16 | 126.9 pt |
| `team_of_agents` | Crear un equipo de agentes | 23 | 199.8 pt |
| `wake_summary` | Despiértame con un resumen | 26 | 213.5 pt |

All six fit the 254 pt text box today; the widest (`phone_access`) leaves 17.2 pt. For calibration, the widest shipped French chip («Créez une équipe d'agents») measures 194.3 pt. So the chips are **not** an overflow finding — but the phone-access chip also exceeds the widest accepted character budget (fr 31 vs its 32), and `SUGGESTION_CHAR_BUDGET` is a `Record<ShippedLocale, number>` with no `es` entry, so the wave must add a measured `es` value when the locale ships.

### Tips (12 pt / 500, one line at normal text)

| Key | Spanish | Chars | Measured | Row + 18 pt icon |
|---|---|---|---|---|
| `parallel` | pide trabajo en paralelo entre varios subagentes | 48 | 308.5 pt | **326.5 pt** |
| `schedule` | programa un prompt para que se ejecute periódicamente | 53 | **362.1 pt** | **380.1 pt** |
| `search` | busca conversaciones pasadas para reabrir una sesión | 52 | **348.8 pt** | **366.8 pt** |
| — | EN longest (calibration) | 45 | 295.0 pt | 313.0 pt |
| — | FR longest (calibration) | 44 | 290.1 pt | 308.1 pt |

The English source's own longest tip needs 313 pt of a 320 pt screen, so the operative bound is **the screen edge, not the 288 pt padding box** (a clamped row would already clip English, which ships). Under that bound all three Spanish tips overflow; the two worst do so by 47-60 pt. `TIP_CHAR_BUDGET = 48` is asserted for every shipped locale in `home-copy.test.ts` and the tip renders `numberOfLines={1}`, so `schedule` and `search` would also fail that test the day `es` flips to shipped. `parallel` sits exactly at 48 — it passes the character gate and still overruns the row, which is the reason this audit measures instead of counting.

## Findings

### H-01 — MAJOR — `mobile.home.suggestion.{linear_mcp, phone_access, review_repo, team_of_agents}` (mixed register in one pool)

- **Current:** «Configurar Linear MCP» · «Activar acceso desde el teléfono» · «Revisar este repo» · «Crear un equipo de agentes» — versus «Muéstrame el último turno» and «Despiértame con un resumen».
- **Problem:** one pool, two grammars: four infinitive labels and two second-person imperatives. This is not a taste call. `home-splash.tsx:273` calls `onPick(label)` and `home.tsx:523` wires `onPick={setDraft}` — a chip's tap **replaces the composer draft**, so the chip text is a message the user sends, not a button caption. English is uniformly imperative ("Show me", "Wake me", "Set up", "Turn on", "Review", "Create"), and the merged French wave settled the same question the same way (`Montrez…`, `Réveillez-moi…`, `Activez…`, `Créez…`). The es guide's "Action labels: infinitive" rule governs control labels such as `Guardar`/`Reanudar`; it does not make a prefilled message infinitive.
- **Suggested (uniform tú imperative, all inside the row):**
  - `mobile.home.suggestion.linear_mcp`: **«Configura Linear MCP»** (159.0 pt)
  - `mobile.home.suggestion.phone_access`: **«Activa el acceso telefónico»** (195.1 pt)
  - `mobile.home.suggestion.review_repo`: **«Revisa este repo»**
  - `mobile.home.suggestion.team_of_agents`: **«Crea un equipo de agentes»**
- **Why the phone chip changes wording, not just its verb:** «Activa el acceso desde el teléfono» measures 246.4 pt against a 254 pt text box — 7.6 pt (3 %) of headroom, inside the measurement's own error, and it would also need an `es` budget of 34. «Activa el acceso telefónico» is the same feature in a settled compound ("acceso telefónico") with 59 pt of headroom, matching the widest shipped French chip. If the wave prefers to stay closer to core's «acceso desde el teléfono», the long form must be verified at 320 pt in a rendered frame before it ships.
- **Second pass:** agreed that the pool mixes voices (it split the same defect into two MINORs and proposed the same verbs); it proposed «Activa acceso desde el teléfono» (31 chars, 230.1 pt) — also workable, but it keeps the article-less telegraphic register. I record both; the recommendation above is mine.

### H-02 — MAJOR — `mobile.home.tip.schedule` (fit)

- **Current:** «programa un prompt para que se ejecute periódicamente» — **53 chars, 362.1 pt** (row + icon 380.1 pt on a 320 pt screen, ~60 pt over).
- **English:** "set a schedule to run a prompt on a timer" (41 chars).
- **Problem:** clips the rotating tip mid-sentence at every supported width, and fails `TIP_CHAR_BUDGET = 48` once `es` ships. The tip is ambient copy with no affordance — a truncated tip is a fragment, not a tip.
- **Suggested:** **«programa un prompt para que se repita»** — 37 chars, 249.1 pt (row + icon 267.1 pt).
- **Second pass alternative:** «programa un prompt con temporizador» (247.9 pt) — same width, but "temporizador" reads as a countdown device rather than a schedule; I did not adopt it.

### H-03 — MAJOR — `mobile.home.tip.search` (fit)

- **Current:** «busca conversaciones pasadas para reabrir una sesión» — **52 chars, 348.8 pt** (row + icon 366.8 pt, ~47 pt over).
- **English:** "search past conversations to reopen a session" (45 chars).
- **Suggested:** **«busca una conversación pasada y reábrela»** — 42 chars, 269.9 pt (row + icon 287.9 pt, 32 pt inside the screen edge).
- **Second pass alternative:** «busca una conversación pasada para reabrirla» (44 chars, 293.4 pt) — also fits (row + icon 311.4 pt) and mirrors the English purpose clause more literally; it leaves ~9 pt to the screen edge. Either is acceptable; the shorter one is the safer of the two at 320 pt.

### H-04 — MAJOR — `mobile.home.tip.parallel` (fit + accuracy)

- **Current:** «pide trabajo en paralelo entre varios subagentes» — **48 chars (exactly the gate), 308.5 pt** (row + icon 326.5 pt, ~6.5 pt over the 320 pt screen — about half a character, which is exactly how a truncated fragment looks).
- **English:** "ask for parallel work to fan out subagents".
- **Problem (two, one measured):**
  1. It satisfies `TIP_CHAR_BUDGET` and still overruns the row: the character budget is an English-calibrated proxy, and Spanish at 12 pt is wider per character.
  2. `entre varios subagentes` describes work *shared among* subagents; the English asks for parallel work that *fans out into* subagents. The second pass raised this independently; I agree it changes the proposition, not just the idiom.
- **Suggested:** **«pide varios subagentes en paralelo»** — 34 chars, 222.2 pt (row + icon 240.2 pt, 80 pt of headroom), and the fan-out reading is the one that survives translation. «pide trabajo en paralelo a varios subagentes» (46 chars, 281.6 pt) is the conservative repair of the preposition only, if the wave wants to keep "trabajo".

### H-05 — MINOR — `mobile.home.options.fixed` (accuracy of "live controls")

- **Current:** «Las opciones iniciales de esta conversación son fijas. Usa Detalles de la conversación para ver sus controles en vivo.»
- **English:** "…Use Conversation details for its live controls."
- **Problem:** «para ver sus controles» narrows actionable controls to *viewing* them. The destination screen is where the reader changes those controls; the English says the controls are there, not that they can be looked at. "en vivo" itself is correct Spanish for live/real-time.
- **Suggested:** **«Las opciones iniciales de esta conversación son fijas. Usa Detalles de la conversación para los controles en vivo.»**
- The byte-identical destination name is preserved by this suggestion.

### H-06 — NIT — `mobile.home.startup_queue.blocked`

- **Current:** «Reintenta para enviar los mensajes en cola» (29 EN → 42 chars).
- **Problem:** «Reintenta para enviar» is a purpose clause where Spanish wants the retried object; it reads translated. The string renders in a wrapping full-width row, so there is no fit issue.
- **Suggested (optional):** «Reintenta el envío de los mensajes en cola» — 42 chars, 266.8 pt.

## Per-key disposition

| Key | Role | Verdict |
|---|---|---|
| `connect_disabled_reason` | status | clean — «Conecta una máquina para enviar.» (32 chars; shorter than the French equivalent of the same slot). |
| `folders_read_failed` | status | clean — first person mirrors "We couldn't"; «Ahora mismo» carries "just now"; no error code appended; same sentence `/new` uses. |
| `greeting` | heading | clean | «¿En qué te puedo ayudar hoy?» — tú, ¿…?, sentence case. |
| `options.apply` | button | clean | «Usar estas opciones» — infinitive, no full stop. |
| `options.fixed` | help | **H-05** |
| `options.folder` | meta | clean | «Carpeta en esta máquina» — the folder lives on the computer, not the phone. |
| `options.title` | heading | clean | «Opciones de la conversación». |
| `queue.discard` | button | clean | «Descartar los mensajes en cola» — destructive verb, clearly distinct from the move-to-draft verb. |
| `queue.restore` | button | clean | «Pasar los mensajes en cola a borrador» — restores into the composer, no full stop. |
| `queue.sheet_title` | heading | clean | «Mensajes en cola» — plural noun phrase, matches the button that opens it. |
| `queue.view` | button | clean | «Ver los mensajes en cola» — same noun phrase as the sheet title. |
| `refused_start_fallback` | status | clean | «Esa carpeta no existe en esta máquina.» — names the missing folder, does not blame the reader. |
| `starting` | status | clean | «Iniciando…» — one line, 10 chars, U+2026. |
| `startup_queue.blocked` | status | H-06 NIT | Instruction to retry, not a claim that sending is under way. |
| `startup_queue.not_started` | status | clean | «Sin iniciar» — two words beside the queued-messages button. |
| `startup_queue.sending` | status | clean | «Enviando los mensajes en cola…» — continuous, no count repeated. |
| `startup_queue.unconfirmed` | status | clean | «Inicio sin confirmar» — names the state; implies nothing is waiting and no auto-retry exists. |
| `suggestion.last_turn` | button | clean | «Muéstrame el último turno» — `turno` is core's own word for a conversation turn («su último turno», «un turno en curso»); imperative keeps the user's voice. |
| `suggestion.linear_mcp` | button | **H-01** | `Linear MCP` byte-identical. |
| `suggestion.phone_access` | button | **H-01** | Fit measured: 236.8 pt of 254 pt today. |
| `suggestion.review_repo` | button | **H-01** | `repo` kept as developer vocabulary. |
| `suggestion.team_of_agents` | button | **H-01** | Still the only chip that creates an agent after the fix. |
| `suggestion.wake_summary` | button | clean | «Despiértame con un resumen» — glossary wake → despertar; the only chip that speaks as the reader, and it is preserved. |
| `tip.parallel` | help | **H-04** |
| `tip.schedule` | help | **H-02** |
| `tip.search` | help | **H-03** |
| `transcript.waiting` | status | clean | «Esperando la conversación…» — U+2026 kept. |

## Context the manager should have (not findings — no key is involved)

- `src/features/home/home-splash.tsx:292` hardcodes the connect card's label as the English literal `label="Connect a computer"`. In the no-route state, a Spanish reader sees that English string; `mobile.home.connect_disabled_reason` is read only by the composer, not by this slot. This is a code-side localisation gap on this namespace's surface, outside a translation audit's authority — but it is the same class the French wave fixed for the conversation-details label, and it will be visible the moment `es` ships.
- The French bundle's H-04 remedy (keying the destination label) **did** land: `startup-transcript.tsx:52` now reads `t("mobile.session.conversation_details")`.

## Notes and limits

- No human native-speaker review; **no rendered frame** — the fit findings rest on executed text metrics plus the code's own row geometry, and no pixel or truncation screenshot is claimed.
- `catalogue.gen.ts` currently projects `es` while `locale.ts` still lists `es` in `NOT_YET_SHIPPED_LOCALES` and `SHIPPED_LOCALES` is `["en","fr"]`, and `SUGGESTION_CHAR_BUDGET` has no `es` entry. So none of the per-locale budget assertions run against these catalogues today — which is how two over-budget tips got in. When `es` flips, the `Record<ShippedLocale, number>` becomes a compile error until an `es` budget is measured, and `home-copy.test.ts` fails on H-02 and H-03 if they ship unchanged. Fix before the flip.
- Repository has no `i18n/ledger.json` and no audit-ledger command; a ledger-ready row is in `record.json.ledger.ledger_row_proposed`, explicitly unwritten.
