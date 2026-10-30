# Audit report — mobile.session

- **Audit ID:** es29a4
- **Locale:** es
- **Date:** 2026-10-29
- **Auditor:** `i18n-auditor` (lopdev team); session `c58fa60fdb20`; **actual model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`
- **Translator:** `i18n-translator`; session `c53616dcee1c`; model `radient/auto` (as supplied by the requesting manager)
- **Verdict:** passed
- **Keys:** 2 en / 2 es / 2 context
- **Unresolved blocker/major:** 0
- **Second independent pass:** reviewer job `8bb0387a07e8`, actual model `radient/auto`; it returned **passed with one MINOR** on `status_tray.hint` («línea de trabajo» read as a calque of "working line"). **I reject that finding on evidence** — see below — so this namespace stays passed with no open finding.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; projection current; strings ratchet 0 new.
- 2/2/2 keys; no missing/extra; context parity true.
- No placeholders/plurals/selects; no bidi controls; no ASCII apostrophe or ellipsis; no special spaces; no double space; no guillemet.
- `mobile.session.conversation_details` is **byte-identical** to the phrase inside `mobile.home.options.fixed` («Detalles de la conversación»), which the context note requires so the reader recognises the same destination.

## Findings

None. Both keys are clean.

## The rejected second-pass finding (recorded, with the evidence that decides it)

- **Second pass:** `mobile.session.status_tray.hint` — «Abre la línea de trabajo, las tareas y los subagentes» — MINOR, on the claim that «línea de trabajo» is a calque that reads as *workline / line of work*, with «Abre la línea de actividad…» suggested.
- **Why I reject it:** `línea de trabajo` is **core's own committed Spanish term** for this exact UI element, not a translator's calque. From `origin/main` (executed in `audit.log`):
  - `wire.settings` (working-line settings): «línea de trabajo estática», «animar la línea de trabajo», «El brillo animado de la línea de trabajo.»
  - the same catalogue uses it as a noun the reader already knows.
- Replacing it with «línea de actividad» would introduce a second Spanish name for one product concept — precisely the terminology violation the glossary exists to prevent. The accessibility hint is the only text a screen-reader user gets, which is an argument for the *established* term, not against it.
- If the core ever renames the concept, this key must move with it in the same wave; until then, keeping core's term is the correct call.

## Per-key disposition

| Key | Role | Verdict | Note |
|---|---|---|---|
| `conversation_details` | heading | clean | «Detalles de la conversación» — the destination screen's own title, used as the label of the control that opens it, not an action verb. Byte-identical to the phrase inside `mobile.home.options.fixed`. The control that carries it is keyed at `startup-transcript.tsx:52`, so a Spanish reader does find the label in Spanish. No final full stop, as the note requires. |
| `status_tray.hint` | help | clean | «Abre la línea de trabajo, las tareas y los subagentes» — describes what activating the tray opens; `subagentes` per glossary; `línea de trabajo` matches core es (see above). No final full stop. |

## Notes and limits

- No human native-speaker review; no rendered frame. Neither string has a `maxCells`/`maxChars` hint and both are wrapping/accessible-name text, so no fit claim is made.
- Repository has no `i18n/ledger.json` and no audit-ledger command; a ledger-ready row is in `record.json.ledger.ledger_row_proposed`, explicitly unwritten.
- No keyed public-copy receipt is claimed.
