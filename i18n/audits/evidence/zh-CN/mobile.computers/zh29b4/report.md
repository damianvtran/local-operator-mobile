# Independent Chinese audit — `mobile.computers` (`zh29b4`)

**Verdict: `changes_requested` — 0 BLOCKER, 1 MAJOR (`ZH-CMP-1`), 1 MINOR (`ZH-CMP-2`); unresolved blocker/major count = 1.** All 10 English/context/zh-CN entries were read and judged.

- **Auditor:** `i18n-auditor` (lopdev team), session `09e9d1711068`. **Actual model: `radient/auto`**, after `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` provider-quota 429 fallbacks; all evidence commands ran under the final model.
- **Translator:** a different agent, `radient/auto` as supplied; not observed. Independence is agent/session/context, not model diversity (same served model, disclosed).
- **Second independent pass:** job `a163531a0dbd` (`zh-group-B-second-pass`, role `reviewer`, actual `radient/auto`). It independently found the `账号` term and graded it MINOR; the independent group-A audit (`zh29a4`, `AR-01`) graded the same wave-level term MAJOR for `mobile.account_routing`. This report keeps it MAJOR because it is a product-wide term already shipped as `账户` (42 core strings, 0 `账号`) and because the group-A audit independently reached the same conclusion. The `此手机列表` grammar issue is MINOR.
- **Inputs:** en `356f10123aa96d48169552395506cd9b1f2e3b50955bfd363624fd2371930643` · context `3ac04e8333c94e9d419a144bcf08b3ce40ea54b88acc153a9caa1789ba40b6a5` · zh-CN `35e1126ce5f9b18e6adaf509c077b87684fed043398169c06a2b88ee74deeb1a`.
- No translation/MT service, no human native review, no rendered frame.

## Mechanical evidence

- `npm run -s i18n:catalogue:check` → exit 0, projection current (143 keys, 10 namespaces); strings ratchet 0 new vs `a57fb8c`.
- JSON valid; **10/10/10** keys; no missing/extra; context parity complete; every message parses.
- No placeholders or ICU structures; `lop mobile` is kept byte-identical as the command it names; `Radient` is kept as the product name.
- No bidi controls, no ASCII prose punctuation; full-width `，` and `……` only; no `您`/`请`/`！`.

## Rendered strings (app parser)

```
添加电脑 · 它仍会保留在此手机列表中，可从电脑列表切回。
使用中 · 连接中 · 正在连接…… · 此手机尚未添加电脑。
来自lop mobile的密码 · Radient账号中，未连接 · 此手机 · 切换电脑
```

## Findings

### ZH-CMP-1 — MAJOR — `mobile.computers.section.not_connected` (account terminology)

- **Current:** `Radient账号中，未连接`
- **Problem:** the product's committed Chinese calls the account **`账户`**, never `账号`: core has **42** occurrences of `账户` and **0** of `账号`, including `mobile.setup.account` = `Radient账户：{identity}（凭据{id}）` and the whole `relay.account_policy.*` screen. The same wave uses `账号` in `mobile.account_routing` (`账号路由`, five keys), and the group-A audit independently grades that term MAJOR (`AR-01`). Two words for one account concept is a wave-level terminology violation, not a one-off style preference. `账号中` is also a less natural locative than `账户下` for computers that belong to the account.
- **Replacement:** `Radient账户下，未连接` (or, if the programme prefers a separator, `Radient账户 · 未连接`)
- **Second-pass difference:** graded MINOR there; this pass keeps MAJOR on the combined evidence of 42/0 core usage and the group-A MAJOR finding. If the wave owner deliberately chooses `账号` as the consumer-facing term, that is a glossary/one-term decision and must be applied to `account_routing` too; it cannot remain split.

### ZH-CMP-2 — MINOR — `mobile.computers.added.stays_listed` (grammar)

- **Current:** `它仍会保留在此手机列表中，可从电脑列表切回。`
- **Problem:** `此手机列表` reads as a compound (“this phone list”) rather than “this phone's list”; the possessive `的` is missing. `从电脑列表切回` also wants `中` to read as “from the computer list”.
- **Replacement:** `它仍会保留在此手机的列表中，可从电脑列表中切回。`

## Per-key judgement (all 10)

| # | key | Verdict |
|---|---|---|
| 1 | `add` | PASS — `添加电脑`, sentence case, no final full stop |
| 2 | `added.stays_listed` | **ZH-CMP-2 MINOR** |
| 3 | `badge.active` | PASS — `使用中`; one-word badge, distinct from `连接中` |
| 4 | `badge.connecting` | PASS — `连接中` |
| 5 | `connecting` | PASS — `正在连接……`; U+2026 twice per zh-CN guide |
| 6 | `none_on_phone` | PASS — `此手机尚未添加电脑。` |
| 7 | `password_placeholder` | PASS — `来自lop mobile的密码`; keeps `lop mobile` verbatim |
| 8 | `section.not_connected` | **ZH-CMP-1 MAJOR** |
| 9 | `section.on_phone` | PASS — `此手机`; bare locative header, paired with the account header |
| 10 | `switch` | PASS — `切换电脑`; button and sheet title |

## Fit

Content width 288 pt at 320 pt. `Radient账号中，未连接` at 17/600 measures **181.0 pt**, fits one line with 107 pt spare; `它仍会保留在此手机列表中，可从电脑列表切回。` at 14/400 measures **308.0 pt**, wraps to 2 lines (it is a help sentence, not clamped); `来自lop mobile的密码` measures **137.5 pt** in the password field; `正在连接……` measures 84.0 pt. No overflow at 100%.

## Notes and limits

- **`badge.active`** `使用中` is a state, not “connected”; the sibling `连接中` and the context's “the connected one” make the pair coherent. No change.
- **`section.on_phone`** `此手机` is elliptical like the English “On this phone”; it is a section header, not a sentence. No change.
- No rendered frame or human native review; fit is a font-metric estimate.
- No `i18n/ledger.json` / audit-ledger command in this repository; proposed ledger row in `record.json.ledger` is explicitly unwritten. The catalogue is untracked at `a57fb8c` and pinned by the target hash.

## Gate note

`node_modules/.bin/vitest run src/i18n/__tests__/catalogues.test.ts` fails on this tree at `ships no locale the runtime cannot render`: the directory list is `['en','es','fr','zh-CN']` while `SHIPPED_LOCALES` is `['en','es','fr']`. That is the designed directory-vs-shipped gate (a catalogue directory is not activation), not a copy defect; the wave cannot land green until the `locale.ts` flip (zh-CN shipped, removed from pending) lands with the catalogue after the audits pass. `i18n:catalogue:check` and the strings ratchet are green; the catalogue bytes are untracked at `a57fb8c` and must be committed together with the projection.

## Recording boundary

The account finding is a wave-level decision shared with `mobile.account_routing` (`zh29a4`, `AR-01`) and, if the wave chooses `账号`, must be settled in the glossary or the wave record rather than split between namespaces. This bundle records the current bytes and does not edit the catalogue.
