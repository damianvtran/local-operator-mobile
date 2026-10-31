# Audit report — mobile.account_routing (es)

- **Audit ID:** es29a1
- **Date:** 2026-10-29
- **Auditor:** `i18n-auditor` (lopdev team); session `c58fa60fdb20`; **actual model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (provider quota/429 at each step)
- **Translator:** `i18n-translator`; session `c53616dcee1c`; model `radient/auto` (as supplied by the requesting manager; not observed by me)
- **Verdict:** passed
- **Keys:** 14 en / 14 es / 14 context
- **Unresolved blocker/major:** 0
- **Second independent pass:** reviewer job `8bb0387a07e8`, actual model `radient/auto` (pinned `anthropic/claude-sonnet-5-5`, quota fallback), read all 14 keys without my findings; it also returned **passed** with no finding in this namespace.

## Scope and method

Independent audit of the Spanish catalogue against the English source and every per-key context note, per `i18n/style-guides/es.md` and `i18n/glossary.md`. I did not translate these files and did not edit them. No translation API, SDK, MT service or back-translation was used. The mechanical layer was re-checked by hand after the repository validator: JSON validity, key and context parity, placeholder/ICU structure, bidi controls, typography codepoints, technical tokens.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`; `check-strings: 284 finding(s), all baselined; 0 new`.
- 14/14/14 keys, no missing or extra key, every key has a context entry.
- **No placeholder or ICU structure exists in this namespace** (no `{name}`, no plural/select arms, no `%s`) — nothing to preserve, nothing to mismatch.
- No bidi control characters, no ASCII apostrophe or `...`, no NBSP/U+202F, no double spaces, no guillemets, no badly spaced em dash.
- Technical tokens: `Local Operator` byte-identical in `unavailable`; `relé` for relay per glossary §2.

## Terminology cross-check against core `es` (executed)

Core `origin/main:local_operator/i18n/catalogues/es/` (80 catalogues) settles the vocabulary this namespace uses:

- `wire.settings.account_policy.error.unavailable`: **«El enrutamiento de cuentas no está disponible.»** — the same phrase, so `enrutamiento de cuentas` and `política` are core's own words, not the translator's invention.
- `wire.settings.account_policy.label`: «Política de cuentas» — `política` for policy ✓.
- `wire.settings.session.description`: «Las políticas de limpieza…» — same register.
- `relé` (relay): core uses it throughout (`cli.services_help`, `wire.settings`).

One recorded difference, **not** a finding: core writes «Comprueba … y vuelve a intentarlo» for the same failure shape (`account_policy.error.write_failed`); this catalogue writes «Revisa … y vuelve a intentarlo». `Revisa` and `Comprueba` are both native and neutral; the glossary does not fix the verb, so this is a free stylistic choice rather than a term violation. Flagging it as an error would be padding.

## Per-key disposition

| Key | Role | Verdict | Note |
|---|---|---|---|
| `disconnected` | status | clean | «Conecta una máquina para cambiar el enrutamiento de cuentas.» names the missing prerequisite; does not call the relay outdated and does not claim an empty policy (context note). |
| `error` | status | clean | «No se pudo confirmar el cambio…» keeps the unknown outcome — it asserts neither saved nor not-saved — and sends the reader to reload for the committed policy. |
| `load_error` | status | clean | Distinct from `unavailable`: a read that failed for another reason; «vuelve a intentarlo» retries a read, not a write. |
| `loading` | status | clean | «Cargando el enrutamiento de cuentas…» — U+2026; asserts no choice before the backend answers. |
| `rejected` | status | clean | «El cambio no se guardó.» is a definitive refusal, not an uncertain one; `ajustes` for settings per glossary; backend text is left to ride separately. |
| `reload` | button | clean | «Recargar política» — infinitive label; reads as re-reading the computer's policy, not as repeating the write. |
| `retry` | button | clean | «Reintentar» — matches core's retry label exactly. |
| `save` | button | clean | «Guardar política» — infinitive; explicitly the save of this draft. |
| `saved` | status | clean | «Guardado en esta máquina.» scopes the confirmation to the computer, as the note requires. |
| `saving` | button | clean | «Guardando…» — pending, never a confirmation. |
| `scope` | help | clean | «Los cambios solo se aplican a esta máquina.» — never implies a phone-global policy. |
| `title` | heading | clean | «Enrutamiento de cuentas» — core's own heading phrase; sentence case, no full stop. |
| `unavailable` | status | clean | «…no están disponibles en este relé. Actualiza Local Operator en esta máquina.» — used only for a confirmed missing relay route; names the fix without blaming the reader. |
| `unsaved` | status | clean | «Aún sin guardar.» — terse status; changing the radio alone does not persist, and the line does not claim it does. |

## Notes and limits

- No human native-speaker review; no rendered frame. Fit was therefore not a risk in this namespace: the longest string (115 chars) renders in a wrapping settings paragraph, and no `maxCells`/`maxChars` hint applies here.
- The repository has no `i18n/ledger.json` and no audit-ledger command; the report is recorded in the pull request and this bundle is the durable record. A ledger-ready row is in `record.json.ledger.ledger_row_proposed`, explicitly unwritten.
- No keyed public-copy receipt is claimed.
