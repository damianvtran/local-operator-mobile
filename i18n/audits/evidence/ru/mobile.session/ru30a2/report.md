# Audit — ru / mobile.session (ru30a2)

**Verdict: `changes_requested`** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 0 NIT

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.session` |
| Keys | 2 (English = target) |
| Branch / head | `feat/i18n-russian` / `ba39018c493dda114d42a6b4d9dfbf337f4110f5` |
| Auditor | i18n-auditor (lopdev team), session 68877acd3c8a, **radient/auto** (primary anthropic/claude-sonnet-5-5 hit provider quota; fallbacks disclosed in record.json) |
| Second independent pass | reviewer (lopdev team), job 0e8a65e92a72, radient/auto — scope: this namespace |
| Machine translation | none |


## Findings

| ID | Severity | Key | Current | Problem | Replacement |
|---|---|---|---|---|---|
| ru30a2-F1 | **MINOR** | `mobile.session.status_tray.hint` | Открывает текущую работу, задачи и субагентов | The source names a UI surface — «the working line» — and the hint renders it as an abstraction, «current work», which has no referent a screen-reader user can find on the screen. The other three shipped locales keep the surface: fr «la ligne d'activité», es «la línea de trabajo», zh-CN «工作状态行». | **Открывает строку текущей работы, задачи и субагентов** |

### ru30a2-F1 — mobile.session.status_tray.hint (MINOR)

- **Current:** Открывает текущую работу, задачи и субагентов
- **Problem:** The source names a UI surface — «the working line» — and the hint renders it as an abstraction, «current work», which has no referent a screen-reader user can find on the screen. The other three shipped locales keep the surface: fr «la ligne d'activité», es «la línea de trabajo», zh-CN «工作状态行».
- **Replacement:** Открывает строку текущей работы, задачи и субагентов
- **Gate:** MINOR — does not block shipment on its own; the other 1 key in this namespace is clean.

## Considered and accepted (no change requested)

### `mobile.session.conversation_details` — ACCEPT, and it carries a cross-key requirement.

> Детали беседы

Byte-identical to the citation inside mobile.home.options.fixed (…в разделе «Детали беседы»), which the sidecar requires: the destination screen's title must match wherever it is named. A future edit to either string must move both.

## What was executed

`audit.log` in this directory is the transcript: the catalogue validator, `verify.mjs` for this namespace (key sets, placeholder names and types read by the repo's parser, plural arms against `Intl.PluralRules('ru')`, code tokens and product names, typography, terminal punctuation, and the rendered value of every key), then `verify.mjs --negative`, where each check must fail on an injected defect. `verify.mjs.txt` is the script that produced it.

## What could not be verified

- No frame was rendered: the app was not built, so these are copy-level findings, and a UI pass still has to see the ru strings on device.
- Widths are CoreText advances with the system face standing in for Figtree (absolute points approximate, ratios sound).
- The 320 pt composer field width is inferred from the sidecar's 390 pt measurement, not captured.

