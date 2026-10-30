# Independent Chinese delta audit — `mobile.account_routing` (`zh29a4r2`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT; unresolved blocker/major count = 0.**
The round-1 findings `AR-01` (MAJOR), `AR-02` (MINOR) and `AR-03` (MINOR) are all resolved on the shipped bytes at `d3c39d8d2df2bccc78af82df9253776b4c933ad8`; no fix introduced a new problem. All 14 English, context and Chinese entries were read and judged key by key.

- **Auditor:** `i18n-auditor` (lopdev team), session `2fdd9a1e0a55`. **Actual model: `radient/auto`.** Fallback trail in this session: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (each a provider-quota HTTP 429 fallback; the two initial read-only survey calls ran under the primary). Every judgement, measurement and bundle in this audit was produced under `radient/auto`. Disclosed, not model-diverse from the translator.
- **Previous round:** `zh29a4` at a57fb8c + the translator's then-uncommitted catalogue, target `9570e834…`; verdict `changes_requested` (1 MAJOR, 2 MINOR). Bundle: `i18n/audits/evidence/zh-CN/mobile.account_routing/zh29a4/`.
- **Shipped revision:** `d3c39d8d2df2bccc78af82df9253776b4c933ad8`, branch `feat/i18n-chinese`, worktree clean before this bundle. The target bytes are pinned by `input_hashes.target`.
- **Inputs:** en `34fa87b25d0f65b83f675f51a99e592235902a25878938850287cbe397ed8a03` · context `2103f8d2a4f3b649bbde90c78d8bf74628211bc99836920fb3ffa3eea985c58c` · zh-CN `6b1cb4e01ee57342b8402eee0bfe4d8c76bec5480557cb41ad1f8f17c7a811d7` (previous zh-CN `9570e834f23fda2f3d2d948374bebdaf0b2e7ddd196da7e605d432c4f059dfb0`).
- **Second independent pass:** job `9b2d25113c21` (label `zh-delta-second-pass`), `reviewer` role, session `0a3293bdab48`, actual model `radient/auto` after the same quota descent. It read all 41 delta keys without this auditor's findings and reached the same verdicts. Recorded in `record.json.second_independent_pass`.
- No human native-speaker review and **no rendered frame**. Widths here are Unicode cell arithmetic (CJK and full-width punctuation = 2 cells, typographic quotes = 2, U+2026 = 2), not CoreText; every changed value in this namespace is a short wording change with no added structural content, and the longest shipped value (`unavailable`) is 56 cells, a wrapping status sentence, so no new clipping risk is introduced.

## Delta result — exactly the seven prescribed values

| Key | Round-1 text | Shipped text | Finding | Verdict |
|---|---|---|---|---|
| `title` | `账号路由` | **`账户路由`** | AR-01 | resolved |
| `loading` | `正在加载账号路由……` | **`正在加载账户路由……`** | AR-01 | resolved |
| `load_error` | `无法加载账号路由。检查连接后重试。` | **`无法加载账户路由。检查连接后重试。`** | AR-01 | resolved |
| `disconnected` | `连接电脑后才能更改账号路由。` | **`连接电脑后才能更改账户路由。`** | AR-01 | resolved |
| `unavailable` | `此中继不提供账号路由设置。在此电脑上更新Local Operator。` | **`此中继不提供账户路由设置。在此电脑上更新Local Operator。`** | AR-01 | resolved |
| `scope` | `更改仅应用到此电脑。` | **`更改仅对此电脑生效。`** | AR-02 | resolved |
| `saved` | `已保存到此电脑。` | **`已保存在此电脑上。`** | AR-03 | resolved |

- **Proof the delta is exactly these seven values:** putting the seven round-1 values back into the shipped JSON and serialising it the way the repository does yields sha256 **`9570e834f23fda2f3d2d948374bebdaf0b2e7ddd196da7e605d432c4f059dfb0`** — the round-1 target hash. No other value changed. Executed; output in `audit.log`.
- The other seven keys (`save`, `saving`, `unsaved`, `retry`, `reload`, `error`, `rejected`) are byte-identical to the round-1 bytes.

## Finding disposition

### AR-01 — resolved (was MAJOR — `账号` for “account”, five keys)

- **Counted, not sampled:** `mobile.account_routing` now carries **5 occurrences of `账户` in 5 keys** and **0 of `账号`** (and 0 of `帐户`). Core's committed zh-CN (`origin/main`, 93 catalogue files) carries **42 occurrences of `账户` across 10 files and 0 of `账号`**, including `relay.account_policy` (3). The namespace now uses the one term the product already ships.
- **New wording reads naturally:** `账户路由` is the feature name core uses in the same screen's copy; `正在加载账户路由……`, `无法加载账户路由。检查连接后重试。` and `连接电脑后才能更改账户路由。` are the round-1 sentences with the term corrected, and each remains idiomatic. `此中继不提供账户路由设置。在此电脑上更新Local Operator。` keeps the confirmed-missing-route meaning and the imperative remedy; it is the minimal replacement round 1 prescribed. The recommended-but-optional core-identical variant (`此中继上无法使用账户路由设置。更新此电脑上的Local Operator。`) was not adopted; it is not required, and the shipped sentence is correct on its own.
- **No new problem:** no placeholder, punctuation, register or polarity change; the only difference is the noun.

### AR-02 — resolved (was MINOR — `scope` same-sentence divergence)

- **Shipped:** `更改仅对此电脑生效。` — byte-identical to core's committed rendering of the identical English sentence. Reads naturally; correctly limits the change to this computer and never implies a phone-global policy.

### AR-03 — resolved (was MINOR — `saved` same-sentence divergence)

- **Shipped:** `已保存在此电脑上。` — byte-identical to core's committed rendering. A confirmation only; it does not overstate that a backend policy was read back, and it matches the same sentence on the desktop.

**No new findings in this namespace.** The unchanged `error` (`无法确认此次更改。检查连接并重新加载，以读取当前策略。`) still keeps the unknown outcome and asserts neither success nor failure; `rejected` (`更改未保存。检查所选值或此电脑的设置后重试。`) remains the definitive refusal; `retry` (a failed read) and `reload` (re-read the committed policy) remain distinct. The second pass also read four small differences from core (`检查连接` vs `检查网络连接`, `所选值` vs `所填的值`, `不提供` vs `上无法使用`) and deliberately did not grade them, matching round 1's explicit acceptance.

## Per-key judgement

| Key | Role | Verdict |
|---|---|---|
| `title` | heading | **AR-01 resolved** — `账户路由`, the feature name core ships. Correct section heading, not a provider picker. |
| `scope` | help | **AR-02 resolved** — `更改仅对此电脑生效。` core-identical; scope correctly local. |
| `disconnected` | status | **AR-01 resolved** — `连接电脑后才能更改账户路由。` names the prerequisite; no outdated-relay or empty-policy claim. |
| `loading` | status | **AR-01 resolved** — `正在加载账户路由……` read in flight; no policy choice asserted. |
| `save` | button | clean — `保存策略`, core's own rendering. |
| `saving` | button | clean — `正在保存……`, pending, never a saved confirmation. |
| `saved` | status | **AR-03 resolved** — `已保存在此电脑上。` confirmation only; core-identical. |
| `unsaved` | status | clean — `尚未保存。` names the uncommitted draft. |
| `retry` | button | clean — `重试`; a failed read, not a blind repeat of an uncertain save. |
| `reload` | button | clean — `重新加载策略`; re-reads the committed policy, distinct from `重试`. |
| `unavailable` | status | **AR-01 resolved** — `此中继不提供账户路由设置。在此电脑上更新Local Operator。` confirmed missing route only; never covers an offline/unknown tunnel. |
| `load_error` | status | **AR-01 resolved** — `无法加载账户路由。检查连接后重试。` a read failure distinct from a confirmed old relay. |
| `error` | status | clean — `无法确认此次更改。检查连接并重新加载，以读取当前策略。` keeps the unknown outcome; `，以` is core's house style. |
| `rejected` | status | clean — `更改未保存。检查所选值或此电脑的设置后重试。` definitive refusal; `所选值` fits this screen's radio choice. |

## Mechanical result

- `node scripts/i18n/generate.ts --check` → **`src/i18n/catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr, zh-CN)`**, exit 0.
- `node scripts/i18n/check-strings.ts` → **`check-strings: 284 finding(s), all baselined; 0 new; no growth vs a57fb8cbe161`**, exit 0.
- Affected tests: `./node_modules/.bin/vitest run src/features/home/home-copy.test.ts src/i18n/__tests__/catalogues.test.ts src/i18n/__tests__/runtime.test.ts` → **3 files passed, 78 tests passed**. This is the gate that now covers the flipped zh-CN locale, including the per-locale chip budget.
- JSON valid; keys exactly **14/14/14** (en / zh-CN / context); no key added, dropped or reordered. Parsed through the app's own parser: **14/14**, **0 keys with params** — no placeholders, ICU structures or markup to preserve.
- No bidi/control (`Cc`/`Cf`) characters; no ASCII punctuation in prose; all full stops U+3002; the two ellipses (`loading`, `saving`) are exactly two U+2026 and final; no `请`, `您` or `！`; no CJK–Latin spaces (guide-compliant `在此电脑上更新Local Operator`).
- Fit: `unavailable` is the longest value at **35 characters / 56 cells**, a wrapping status sentence with no `maxCells` hint; `error` 54 cells; buttons 4–12 cells. No fit risk. No rendered frame is claimed.

## Second independent pass (reconciled)

Reviewer job `9b2d25113c21` (`radient/auto`) read the two namespaces independently and reached the same result: **AR-01, AR-02 and AR-03 resolved**, no new problem, `mobile.account_routing` **passed**. It independently counted 5 `账户` / 0 `账号` in the namespace and 42 `账户` / 0 `账号` across core's 93 files, and independently confirmed `对话详情` is byte-identical inside `mobile.home.options.fixed`. It also confirmed all mechanical facts: 14/14/14 and 27/27/27 key parity, no placeholders/ICU/markup, no ASCII punctuation or bidi controls, ellipses doubled. No reconciliation difference exists for this namespace.

## Notes and limits

- No human native-speaker review; **no rendered frame**. Width statements are cell arithmetic, not CoreText; the two core-aligned sentences keep their short status widths (`scope` 20 cells unchanged; `saved` 16→18 cells), and `unavailable` remains the longest value at 56 cells, a wrapping status with no budget. No new clipping risk.
- The term finding rests on core's **committed** bytes, executed: `git -C /Users/damian/local-operator grep -o "账户" origin/main -- 'local_operator/i18n/catalogues/zh-CN/*.json' | wc -l` → 42, and the `账号` equivalent → 0. Not recall.
- Translator provenance is as supplied by the requesting manager; the run was not observed by this auditor.
- This repository has no i18n ledger and no audit-ledger command (verified: `package.json` scripts, `scripts/i18n/`, `docs/i18n.md`); the bundle is the durable record and a proposed ledger row is recorded in `record.json.ledger`.
- `audit_notes_not_execution_log`: this report is judgement; `audit.log` holds the actual commands and their actual output.
