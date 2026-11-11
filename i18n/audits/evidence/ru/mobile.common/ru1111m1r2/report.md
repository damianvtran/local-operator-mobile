# Independent delta audit — `ru` · `mobile.common` · M1 round 2 (`ru1111m1r2`)

Auditor `i18n-auditor` (lopdev team), session `b074e5794284`, served model
`deepseek/deepseek-flash` (session header; no fallback notice in this transcript).
Independent of the translator (`openai/gpt-6.1-sol`, session `48676ea694c1`, as reported
in `ru.v2-changes.md`; not observed by this auditor). Audit date 2026-11-11. Audited head
`84c4bee109d048e3dad0f996921e1b8ed561dfc8`.

## Verdict

**Verdict: clean — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT in this namespace.**
Ledger status `passed` (passes require zero unresolved BLOCKER/MAJOR).

## Keys (4, no change in v2)

| key | v2 |
| --- | --- |
| `mobile.common.not_found.action` | К сессиям |
| `mobile.common.not_found.headline` | Этой страницы не существует. |
| `mobile.common.not_found.next` | Вернитесь к сессиям, чтобы продолжить. |
| `mobile.common.not_found.title` | Страница не найдена |

## Judgement

Button label `К сессиям` matches the empty state and the `ru` convention of terse action
labels; the headline, follow-up and title are accurate, idiomatic and correctly punctuated
(no full stop on the label/heading, full stops on the sentence pair). Terminology: `сессия`
per glossary. No pre-existing inconsistency with a v2 change: the three `not_found` values
and `mobile.session.not_connected.next` (`в списке сессий`) agree on the noun.

## Mechanical (this namespace)

Valid JSON; 4/4 keys, set and order identical to the English slice; no placeholders, plural
or select structures; no empty value; 0 English-identical; no bidi/C1 control characters,
straight quotes, three-dot ellipses, backticks or double spaces. Repo validator at the
audited head: `npm run -s i18n:check` exit 0 (`catalogue.gen.ts is current (649 keys, 21
namespaces)`; `check-strings: 212 finding(s), all baselined; 0 new`). The staged values are
not installed in the tree, so that run is baseline only.

## Artifacts

`record.json`, `report.md`, `audit.log` (shared by all four `ru1111m1r2` bundles; the full
slice report with findings and adjudications is `i18n/audits/evidence/ru/NOTE-m1-slice-r2.md`).

## Limits — not claimed

No rendered frame, native build or device run (not this role); no `maxCells`/`maxChars`
exists for these keys, so fit is a character-count judgement. Landing must re-run
`i18n:check` with the values in the tree. No human native review; no other round-2 report
was read.
