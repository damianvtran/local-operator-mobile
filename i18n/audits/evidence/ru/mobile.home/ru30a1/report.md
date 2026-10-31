# Audit — ru / mobile.home (ru30a1)

**Verdict: `changes_requested`** — 0 BLOCKER, 3 MAJOR, 0 MINOR, 0 NIT

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.home` |
| Keys | 27 (English = target) |
| Branch / head | `feat/i18n-russian` / `ba39018c493dda114d42a6b4d9dfbf337f4110f5` |
| Auditor | i18n-auditor (lopdev team), session 68877acd3c8a, **radient/auto** (primary anthropic/claude-sonnet-5-5 hit provider quota; fallbacks disclosed in record.json) |
| Second independent pass | reviewer (lopdev team), job 0e8a65e92a72, radient/auto — scope: this namespace |
| Machine translation | none |


## Findings

| ID | Severity | Key | Current | Problem | Replacement |
|---|---|---|---|---|---|
| ru30a1-F1 | **MAJOR** | `mobile.home.tip.parallel` | попросите параллельную работу для субагентов | Two defects in one string. (a) Fit: 296.2 pt at the tip's 12 pt meta step against the ~288 pt one-line row at 320 pt, and the row is numberOfLines={1} at 100 % text scale, so the tail is ellipsized; English's own longest tip is 267.7 pt. (b) Meaning: «для субагентов» reads as work *for* the subagents' benefit, while the source's “fan out subagents” makes the subagents the mechanism the work spreads into — the relation is reversed. | **попросите раздать работу субагентам** |
| ru30a1-F2 | **MAJOR** | `mobile.home.tip.schedule` | поставьте расписание запуска промпта по таймеру | Fit: 313.8 pt against the same ~288 pt one-line row at 320 pt — the widest entry in the pool and 46 pt over the row, so it truncates at 100 % text scale. Wording: «поставьте расписание» is not the Russian collocation for setting a schedule (it is задают or настраивают); «поставить» belongs with a task (поставить задачу) or a timer, not a schedule. | **настройте запуск промпта по расписанию** |
| ru30a1-F3 | **MAJOR** | `mobile.home.tip.search` | поищите прошлые беседы, чтобы открыть сессию | Fit: 306.0 pt against the ~288 pt row at 320 pt, so it truncates at 100 %. Wording: «поищите прошлые беседы» searches *for* past conversations; the source searches *in* them to reopen a session, and the missing «в» turns the scope into the object. | **поищите сессию в прошлых беседах** |

### ru30a1-F1 — mobile.home.tip.parallel (MAJOR)

- **Current:** попросите параллельную работу для субагентов
- **Problem:** Two defects in one string. (a) Fit: 296.2 pt at the tip's 12 pt meta step against the ~288 pt one-line row at 320 pt, and the row is numberOfLines={1} at 100 % text scale, so the tail is ellipsized; English's own longest tip is 267.7 pt. (b) Meaning: «для субагентов» reads as work *for* the subagents' benefit, while the source's “fan out subagents” makes the subagents the mechanism the work spreads into — the relation is reversed.
- **Replacement:** попросите раздать работу субагентам — measures **234.3 pt** at the same type step

### ru30a1-F2 — mobile.home.tip.schedule (MAJOR)

- **Current:** поставьте расписание запуска промпта по таймеру
- **Problem:** Fit: 313.8 pt against the same ~288 pt one-line row at 320 pt — the widest entry in the pool and 46 pt over the row, so it truncates at 100 % text scale. Wording: «поставьте расписание» is not the Russian collocation for setting a schedule (it is задают or настраивают); «поставить» belongs with a task (поставить задачу) or a timer, not a schedule.
- **Replacement:** настройте запуск промпта по расписанию — measures **258 pt** at the same type step

### ru30a1-F3 — mobile.home.tip.search (MAJOR)

- **Current:** поищите прошлые беседы, чтобы открыть сессию
- **Problem:** Fit: 306.0 pt against the ~288 pt row at 320 pt, so it truncates at 100 %. Wording: «поищите прошлые беседы» searches *for* past conversations; the source searches *in* them to reopen a session, and the missing «в» turns the scope into the object.
- **Replacement:** поищите сессию в прошлых беседах — measures **223.3 pt** at the same type step

## Considered and accepted (no change requested)

### `mobile.home.suggestion.phone_access` — SHIP as-is (26 characters against English's 24).

> Включите доступ с телефона

The 24-character figure is an English-calibrated character budget, not this slot's constraint: the chip row is measured in points and the code keeps a per-locale SUGGESTION_CHAR_BUDGET for exactly that reason. Measured, this chip is 196.8 pt against the ~254 pt text box at 320 pt (Spanish's widest, which the code records as 189.4 pt, fits at the same box), so it does not truncate and even at 200 % text scale it wraps to the second line the row allows at large text. The wave must raise the budget when it ships (see ship_gate below), not shorten the copy.

### `mobile.home.suggestion.wake_summary` — ACCEPT — a verb divergence from core that is not a glossary violation.

> Разбудите меня со сводкой

Core's committed Russian uses «пробудить» once, in wire.settings.team_bridge_session.help («Сессия, которую можно пробудить при новых сообщениях»), while this chip uses «Разбудите меня». The glossary's term is the noun «пробуждение»; the glossary says a preferred rendering is a citation form, and that a row is violated by a different TERM, not by a grammar form. «Разбудить» is the everyday verb for waking a person and is the only natural imperative for this playful chip; «Пробудите меня со сводкой» would read literary. No change requested.

## Ship gate (code, not copy)

- mobile.home.tip.* replacements must land before the ru set is flipped to shipped.
- Before the flip, SUGGESTION_CHAR_BUDGET and IDENTICAL_BY_DESIGN are Record<ShippedLocale, …>: adding ru without entries is a TypeScript error. The widest ru chip measures 26 characters (phone_access), and the identity list needs mobile.schedules.head.overdue (the only value in the wave byte-identical to English).
- At this head src/i18n/__tests__/catalogues.test.ts fails on the directory↔SHIPPED_LOCALES binding (expected: the directory exists before the ship flip), so the branch cannot be green until the flip lands.

## What was executed

`audit.log` in this directory is the transcript: the catalogue validator, `verify.mjs` for this namespace (key sets, placeholder names and types read by the repo's parser, plural arms against `Intl.PluralRules('ru')`, code tokens and product names, typography, terminal punctuation, and the rendered value of every key), then `verify.mjs --negative`, where each check must fail on an injected defect. `verify.mjs.txt` is the script that produced it.

## What could not be verified

- No frame was rendered: the app was not built, so these are copy-level findings, and a UI pass still has to see the ru strings on device.
- Widths are CoreText advances with the system face standing in for Figtree (absolute points approximate, ratios sound).
- The 320 pt composer field width is inferred from the sidecar's 390 pt measurement, not captured.

