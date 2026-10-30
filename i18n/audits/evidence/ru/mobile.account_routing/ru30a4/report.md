# Audit — ru / mobile.account_routing (ru30a4)

**Verdict: `passed`** — no findings

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.account_routing` |
| Keys | 14 (English = target) |
| Branch / head | `feat/i18n-russian` / `ba39018c493dda114d42a6b4d9dfbf337f4110f5` |
| Auditor | i18n-auditor (lopdev team), session 68877acd3c8a, **radient/auto** (primary anthropic/claude-sonnet-5-5 hit provider quota; fallbacks disclosed in record.json) |
| Second independent pass | reviewer (lopdev team), job 0e8a65e92a72, radient/auto — scope: this namespace |
| Machine translation | none |


## Findings

None.

All 14 keys read against the sidecar's per-key intent and the glossary: «маршрутизация аккаунтов» throughout, «ретранслятор» for relay, «Перезагрузить политику» for the reload-after-uncertain-save control (a GET, never a blind write), and «Сохранить политику» for the explicit write. Nothing in the set over-promises. The error copy keeps the sidecar's safety rule: «Не удалось подтвердить изменение» asserts neither success nor failure, «Изменение не сохранено» is the definitive refusal, and «Настройки маршрутизации аккаунтов недоступны на этом ретрансляторе» does not call the relay outdated in the way the note forbids.

## What was executed

`audit.log` in this directory is the transcript: the catalogue validator, `verify.mjs` for this namespace (key sets, placeholder names and types read by the repo's parser, plural arms against `Intl.PluralRules('ru')`, code tokens and product names, typography, terminal punctuation, and the rendered value of every key), then `verify.mjs --negative`, where each check must fail on an injected defect. `verify.mjs.txt` is the script that produced it.

## What could not be verified

- No frame was rendered: the app was not built, so these are copy-level findings, and a UI pass still has to see the ru strings on device.
- Widths are CoreText advances with the system face standing in for Figtree (absolute points approximate, ratios sound).
- The 320 pt composer field width is inferred from the sidecar's 390 pt measurement, not captured.

