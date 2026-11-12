# es — i18n M3 slice S1 (sign-in + computers) — translator notes

Locale: `es` (neutral Spanish) · Task: m3s1-tr-es · Translator model: deepseek/deepseek-flash (this session)
Brief: `/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/translation-brief-s1.json`
(sha256 prefix `531e6edd8e5f9af5…` — verified against the file: `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`)
Draft: `draft-es-s1.json` (44 keys, brief order) · sha256 `9ff88b2c3df3b4ce24a7a9ff615b48aa7002ee9160ae0ca4fea5a3745de125a3` · 3492 bytes
Evidence base: mobile worktree `~/local-operator-mobile/.worktrees/i18n-m3-s1` @ `1796c3a5c46f5e` (read-only for me);
core style guide `i18n/style-guides/es.md` and `i18n/glossary.md` read from `~/local-operator` `origin/main`.
No machine-translation service, API or website was used; every string was reasoned and written here.

## Register and sources followed

- Style guide `es.md`: **tú**, neutral Spanish (no region-marked words), sentence case, terse, no "!", sentence
  fragments may stay lowercase, action labels infinitive ("Usar…", "Actualizar", "Reintentar"), ellipsis `…`,
  em dash " — " with spaces, no space before `?`/`:`, `¿…?` only for a whole question.
- Glossary §1/§2: product names and technical tokens kept Latin (`Local Operator`, `Radient`, `URL`, `harness`,
  `token`, `endpoint` — wave-1 kept-English list); `relay` → **relé**; `session` → sesión; `agent` → agente.
- Shipped `es` catalogues (mobile.computers, mobile.signin, mobile.home, mobile.settings, mobile.account_routing,
  mobile.schedules, relay.health) were read in full and their wording reused rather than reinvented.

## Glossary / terminology decisions

| Term | es rendering used here | Basis |
|---|---|---|
| computer / machine | **máquina** | The shipped mobile `es` catalogues already say `máquina` for "computer" 55× across 11 files (`mobile.computers.add` "Añadir una máquina", `switch` "Cambiar de máquina", `none_on_phone` "Aún no hay máquinas…", `mobile.home` 16×). Reused, not reinvented. See "drift" below. |
| tunnel | **túnel** | shipped (`mobile.computers.billing_help`, `disabled_help`, `harness_help`, `wait.*`). |
| relay | **relé** | glossary §2 (`relais · relé · …`), shipped (`connect_refused.password` "El relé no aceptó esa contraseña"). |
| harness | **harness** (English) | style guide es wave-1 kept-English list ("runtime, harness, hook(s), handshake, backoff"). |
| account | **cuenta** (+ "de Radient") | shipped (`account_mismatch`, `account_help`, `section.not_connected`). |
| phone | **teléfono** | style guide (region-neutral; `celular`/`móvil` mark regions), shipped. |
| sign-in | **inicio de sesión**; verb **iniciar sesión** | shipped `mobile.signin.stage_*`, `sign_out` "Cerrar sesión". |
| password | **contraseña** | shipped (`password_placeholder`, `connect_refused.*`). |
| remote access | **acceso remoto** | shipped (`billing_help` "activa el acceso remoto"). |
| billing | **facturación** | shipped (`billing_help`). |
| route | **ruta** | `wait.host_answering` "Que una ruta esté configurada…". |
| provisioning | **aprovisionando** | standard es cloud-console verb; fits the lowercase badge set. |
| remove (from this phone) | **quitar** | Distinct from account deletion, which the shipped copy renders `eliminar` (`account_mismatch`). The dialog body explicitly promises nothing else is touched, so `quitar` is the honest verb. |
| refresh | **actualizar** | action-label infinitive; the surface is the computers list, not `mobile.settings.connection.refresh` (separate key, same verb). |

## Judged-identical to English (explicit list)

| Key | Value | Reason |
|---|---|---|
| `mobile.computers.row.a11y` | `{name}, {status}, {reach}` | Placeholder-only screen-reader template: three substitutions and two comma pauses. es punctuates a list of attributes with the same commas and the same order, so the string is legitimately byte-identical. Nothing to translate. |

No other key is identical: `Radient` alone appears only inside translated sentences, and `Recomendado` differs from
"Recommended".

## Per-key rationale (non-obvious only)

- `not_harness` — "no ejecuta el harness de Local Operator": `ejecutar` is the verb the shipped `es` copy already uses
  for "runs" (`mobile.schedules.supervisor.not_running`: "está instalado pero no se ejecuta").
- `wait.listing` — "Esperando a que Radient añada tu máquina a **la lista**…": reuses the shipped noun `la lista`
  (`wait.nothing_answered_help`: "sin túneles en la lista") instead of a coined verb for "to list". Shimmer line, ends `…`, no full stop.
- `wait.tunnel_status` — "Radient ya tiene el túnel — {status}.": the `ya` carries the step-completed sense of "has the
  tunnel". `{status}` is Radient's untranslated English word, placed after the em dash exactly as in the source, so the
  sentence stays grammatical with a Latin token at the end.
- `wait.start_again` — "Empezar de nuevo": echoes the shipped `wait.nothing_answered_help` "vuelve a empezar".
- `remove.body` — "La quita de la lista…": `quitar`/`afectar a` keep the non-destructive guarantee exact ("No afecta a
  la máquina, a su túnel ni a tu cuenta"), and `la` agrees with `máquina`.
- `paths.radient_body` — "Requiere una cuenta de Radient." as a fragment (Spanish UI convention for a stored
  requirement) rather than "Necesitas…", keeping the honest cost terse. "ni ninguna contraseña del relé que guardar"
  mirrors the source's "no relay password to keep".
- `paths.own_title` vs `paths.own_action` — the card **header** reads "Configura tu propio túnel" (what the reader gets)
  while the card **button** uses the infinitive label "Usar mi propio túnel"; the source also distinguishes a header
  from an action, so this is not drift.
- `own_tunnel_instead` — "Usar mi propio túnel en su lugar": keeps `instead` explicit (it contrasts with the Radient list
  above) and keeps the infinitive action form. Deliberately longer than `own_action` because the two buttons sit on
  different screens and only this one carries the contrast.
- `signin.intro` — "Tu navegador completa el inicio de sesión, así que la app nunca ve tu contraseña.": subject kept as
  the browser (the source's point), and `la app` matches the shipped register (`session_error`).
- `panel.waiting` — "Esperando a tu navegador.": identical wording to the shipped `stage_browser`, plus the full stop the
  headline needs. `panel.opening` — "Abriendo tu navegador…".
- `panel.unavailable` — "Esta compilación no puede completar el inicio de sesión con Radient.": `compilación` is the
  settled es word for an app *build* in shipped Spanish software; `completar` echoes `intro`/`waiting_help`, so one verb
  covers "finish" across the three strings.
- `panel.unavailable_alt` — "Aún puedes conectarte con la dirección y la contraseña del relé.": `del relé` matches the
  shipped `connect_refused.password` and the `unavailable` note (the relay route still works).
- `welcome.body` — "Esta app **dirige** las sesiones de tu propia máquina y muestra lo que hizo. Tu código nunca sale de
  ella.": `dirige` for "drives" (avoids reusing `gestiona`, which `radient_body` already spends on the tunnel); `de ella`
  agrees with `máquina`, keeping the privacy promise exact.
- Status badges — **lower case, feminine singular**, agreeing with `máquina` as the shipped sibling badges already do
  (`badge.active` "activa", `badge.connecting` "conectando"): "ruta lista", "aprovisionando", "suspendida",
  "desactivada", "revocada", "desconocida", "respondiendo". Feminine agreement was chosen over mixing genders
  ("suspendido" would agree with `túnel`) so that the badges on one row read as one system; es has no case convention
  to satisfy, so lower case is purely the sibling badges' settled form. `route_ready` is the only one that names its
  subject ("ruta lista"), matching the source's intent that it describes the route, not the computer; `aprovisionando`
  is gender-free by construction.
- `row.a11y_active` / `row.a11y_connecting` — the trailing words are the **same** words as `badge.active` ("activa") and
  `badge.connecting` ("conectando"), as the source requires.
- `billing_inactive` — "La facturación de este túnel está inactiva, así que se denegará el acceso remoto.": reuses the
  shipped `facturación de este túnel` and `acceso remoto`; impersonal future for "will be refused".
- `try_now` / `try_anyway` — "Probar ahora" / "Reintentar de todos modos": `probar` for "try" here (a probe of
  discovery), `reintentar` for "try again", which is the shipped `mobile.computers.retry` wording.

## Width risks (measured, char counts since the mobile sidecars declare no maxCells)

es runs long on short words; the only strings where growth is structural rather than trimmable:

| Key | en | es | Δ |
|---|---|---|---|
| `mobile.signin.title` | 7 | 14 | +100% ("Iniciar sesión" is the settled term; "Entrar" would break the shipped `iniciar sesión` family) |
| `mobile.signin.start` | 20 | 26 | +30% ("Iniciar sesión con Radient"; same reason) |
| `mobile.signin.panel.unavailable` | 43 | 68 | +58% (headline; wraps to 2 lines on a phone, detail line follows) |
| `mobile.signin.try_anyway` | 16 | 25 | +56% (secondary button) |
| `mobile.computers.own_tunnel_instead` | 25 | 32 | +28% (quiet text button; the `instead` contrast was kept deliberately) |
| `mobile.computers.try_now` | 7 | 12 | +71% (banner action; "Probar" alone would drop "now") |

All badge values stay ≤ 14 cells. Nothing was truncated; every string is a full idiomatic rendering. The two `help`
bodies (+12% / +9%) are paragraph copy and reflow normally.

## Consistency risk found (not mine to fix, flagged for the coder/auditor)

"computer" has three spellings in the shipped mobile `es` catalogues: **máquina** (55 occurrences, 11 files — the
dominant and the one this slice follows), **ordenador** (6, including `mobile.computers.connect_refused.generic` —
inside the very namespace this slice extends) and **computadora** (3, `mobile.notifications.permission.*`). I did not
propagate the minority forms, and I did not edit those keys (out of my 44-key scope, and the worktree is read-only for
me). One term per concept is the audit invariant; this is pre-existing drift the S1 audit will see, best fixed in a
follow-on copy pass rather than by the translator.

## Validator

My draft cannot be validated by `npm run -s i18n:check` directly: that check runs against the catalogue files **in the
repo**, the English-first worktree is read-only for me, and the draft lives in my session scratchpad until the coder
applies it. I ran the repo's own parser against the draft instead (read-only import, no writes):

```
$ node --experimental-strip-types validate-es.mts draft-es-s1.json
ICU/params/order: OK (44/44)
```

`validate-es.mts` imports `parseMessage` from `src/i18n/messages.ts` (the exact parser `generate.ts` uses) and asserts,
per key: non-empty string; parses as a valid ICU message; identical placeholder **name** set to English; no parameter
**kind** downgrade (text → plural/select only, and none is needed here — no es plural arm was introduced); and that all
44 keys are present in the brief's order with none added or dropped. Additional checks: valid JSON, UTF-8, tabs like the
neighbouring catalogues, `…` character (no `...`), em dash with spaces, no straight quotes/apostrophes, no manual bidi
controls, no space before `?`. The coder must still run `npm run -s i18n:generate` + `npm run -s i18n:check` after
applying the values, and the audit ledger row for `es` stays `status: translated` (never `passed`) — I am not the
auditor of my own locale.
