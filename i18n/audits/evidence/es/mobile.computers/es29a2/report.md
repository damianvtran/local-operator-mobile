# Audit report — mobile.computers (es)

- **Audit ID:** es29a2
- **Date:** 2026-10-29
- **Auditor:** `i18n-auditor` (lopdev team); session `c58fa60fdb20`; **actual model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`
- **Translator:** `i18n-translator`; session `c53616dcee1c`; model `radient/auto` (as supplied by the requesting manager)
- **Verdict:** passed
- **Keys:** 10 en / 10 es / 10 context
- **Unresolved blocker/major:** 0
- **Second independent pass:** reviewer job `8bb0387a07e8`, actual model `radient/auto`; it also returned **passed** with no finding in this namespace.

## Scope and method

Independent audit of every key against the English value and its context note, per `i18n/style-guides/es.md` and `i18n/glossary.md`. Read-only: no edit, no commit, no push. No translation/MT service. Mechanical layer re-checked by hand: JSON, key and context parity, placeholders/ICU, bidi controls, typography, technical tokens.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; catalogue projection current; strings ratchet 0 new.
- 10/10/10 keys; no missing/extra; context parity true.
- **No placeholders, plurals or selects exist in this namespace.**
- No bidi controls, no ASCII apostrophe or `...`, no NBSP/U+202F, no double space, no guillemet, em dash spacing not used.
- Technical token `lop mobile` byte-identical in `password_placeholder`; `Radient` byte-identical in `section.not_connected`.

## Terminology cross-check against core `es` (executed)

- **`máquina` for "computer" is core's own word, not a local choice.** Core `es` uses it for the reader's machine throughout: «Se ejecuta en tu máquina — tus mensajes le llegan de inmediato», «Este teléfono aún no está emparejado con esa máquina», «Acceso desde el teléfono: controlar las sesiones de lop de esta máquina». The alternative renderings `ordenador` (Spain) and `computadora` (Río de la Plata) appear **zero** times in the 80 committed core `es` catalogues; `máquina` is the neutral choice the glossary's "terminology consistent across the product" rule calls for.
- `equipo` is reserved for *team* in core (`lop schedules`, `cli.teams_help`) — so using `máquina` here also avoids the collision, and this catalogue never uses `equipo` for a computer.
- `teléfono` for the phone matches core and the es guide's neutral-Spanish rule (never `celular`/`móvil` as the device noun).

## Findings

### C-1 — NIT — `mobile.computers.added.stays_listed`

- **Current:** «No desaparece de este teléfono: puedes volver a esa máquina desde la lista.»
- **English:** "It stays listed on this phone, so you can switch back from the computer list."
- **Problem:** accurate and idiomatic, but "No desaparece de este teléfono" drops the word the English turns on — *listed*. A computer is never "on" a phone; what persists is its row in the list. The reassurance survives, so this is not a meaning error.
- **Suggested (optional):** «Sigue en la lista de este teléfono, así que puedes volver a esa máquina desde ahí.»
- **No change is required for the audit verdict.** Recorded so the wording choice is deliberate rather than unnoticed.

## Per-key disposition

| Key | Role | Verdict | Note |
|---|---|---|---|
| `add` | button | clean | «Añadir una máquina» — infinitive label, sentence case, no full stop; `Añadir` is core's own verb. |
| `added.stays_listed` | help | C-1 NIT | See above. |
| `badge.active` | status | clean | «activa» — lower case, one word, feminine agreeing with `máquina` (and with `fila`/`computadora` if the reader parses the row differently, the badge still agrees with the noun it labels). |
| `badge.connecting` | status | clean | «conectando» — lower case, one word, sibling register of `activa`. |
| `connecting` | status | clean | «Conectando…» — one word plus U+2026. |
| `none_on_phone` | status | clean | «Aún no hay máquinas en este teléfono.» — empty state, ends with a full stop as the note requires. |
| `password_placeholder` | help | clean | «La contraseña de lop mobile» — the command is verbatim; `contraseña` is the neutral word (never `clave`, region-marked). |
| `section.not_connected` | heading | clean | «En tu cuenta de Radient, sin conectar» — Radient untouched; `sin conectar` is invariant, so the header does not have to agree with a plural noun it does not name. |
| `section.on_phone` | heading | clean | «En este teléfono» — short header, sentence case. |
| `switch` | button | clean | «Cambiar de máquina» — the natural Spanish for "switch computer" (not the calque «Cambiar máquina»), infinitive, works as both button and sheet title. |

## Notes and limits

- No human native-speaker review; no rendered frame. No `maxCells`/`maxChars` hint applies to this namespace and the longest string (75 chars) is wrapping help text, so no fit finding is claimed.
- Repository has no `i18n/ledger.json` and no audit-ledger command; a ledger-ready row is in `record.json.ledger.ledger_row_proposed`, explicitly unwritten.
- `mobile.computers.password_placeholder` is credential-shaped; no keyed public-copy receipt is claimed.
