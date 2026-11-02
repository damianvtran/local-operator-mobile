# Independent Chinese audit — `mobile.account_routing` (`zh29a4`)

**Verdict: `changes_requested` — 0 BLOCKER, 1 MAJOR (`AR-01`), 2 MINOR (`AR-02`, `AR-03`), 0 NIT; unresolved blocker/major count = 1.** All 14 entries were read and judged against the English, the sidecars and core's committed zh-CN for the same settings screen.

- **Auditor:** `i18n-auditor` (lopdev team), session `6de17b1d6bbd`. **Actual model: `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (provider-quota HTTP 429, disclosed). All judgements here were produced under `radient/auto`.
- **Translator:** a different agent, model `radient/auto` as supplied by the requesting manager; not observed; not model-diverse (same served model) — disclosed.
- **Second independent pass:** job `9855d3d26399` (label `zh-group-a-second-pass`), read all group-A keys without this auditor's findings; result recorded in `record.json`.
- **Inputs:** en `34fa87b25d0f65b83f675f51a99e592235902a25878938850287cbe397ed8a03` · context `2103f8d2a4f3b649bbde90c78d8bf74628211bc99836920fb3ffa3eea985c58c` · zh-CN `9570e834f23fda2f3d2d948374bebdaf0b2e7ddd196da7e605d432c4f059dfb0`.
- No native-speaker review, no rendered frame.

## Mechanical result

- `node scripts/i18n/generate.ts --check` → catalogue current (143 keys, 10 namespaces); `node scripts/i18n/check-strings.ts` → 284 baselined, 0 new. (`pnpm i18n:check` cannot run here — pnpm refuses a hoisted directory at the symlinked `node_modules`; the scripts were run directly, disclosed in `audit.log`.)
- JSON valid; keys exactly 14/14/14 (en / zh-CN / context). No key added or dropped.
- No placeholders, no ICU structures, no markup, no code spans/commands/flags/paths/identifiers. No bidi or control characters, no ASCII punctuation inside prose, no `请`, `您` or `！`, ellipses are U+2026 twice and final. **No `请`/`您` in this settings namespace.**
- Safety reading: `error` never asserts success or failure ("could not be confirmed" → `无法确认此次更改`), `saved` is only a confirmation, `rejected` is the definitive refusal (`更改未保存`), `unsaved` names the uncommitted draft, `retry` (a failed read) is distinct from `reload` (re-read the committed policy after an uncertain save) — `重试` vs `重新加载策略`. No polarity error anywhere.
- Longest value: `unavailable` at 56 cells; a wrapping status sentence with no budget.

## Finding

### AR-01 — MAJOR — `账号` for “account” (5 keys; terminology consistency with core's committed zh-CN)

- **Current keys:** `title` `账号路由` · `loading` `正在加载账号路由……` · `load_error` `无法加载账号路由。检查连接后重试。` · `disconnected` `连接电脑后才能更改账号路由。` · `unavailable` `此中继不提供账号路由设置。在此电脑上更新Local Operator。`
- **Problem:** the product's shipped Chinese calls the account **`账户`**, never `账号`. Core's committed `zh-CN` uses `账户` in 41 strings (42 occurrences across 10 files) and `账号` in zero — including `relay.account_policy.*`, the core mirror of this very screen (`relay.account_policy.loading` = `正在加载账户路由……`, `relay.account_policy.load_error` = `无法加载账户路由。……`, `relay.account_policy.unavailable` = `此中继上无法使用账户路由设置。……`), and `mobile.setup.*` for the same Radient account (`此Radient账户…`). Ten of this namespace's fourteen English sentences are byte-identical to core's (every shared key except `title`, whose core value is the section heading `电脑设置`). Five of them already read differently in Chinese — `loading`, `saved`, `unavailable`, `scope`, `load_error` — so a reader who opens the same settings on the web and on the phone meets two Chinese versions of the same sentence; `error` and `rejected` also differ in small, defensible ways (`检查连接` vs `检查网络连接`; `所选值` vs `所填值`), which this audit did not raise. The wave also uses `账号` in a second namespace (`mobile.computers.section.not_connected` = `Radient账号中，未连接`), which is that namespace's auditor's call, but it shows this is a wave-level term choice rather than a one-off slip.
- `账号` is not wrong Chinese, but the programme's rule is one term, one decision, and the decision already shipped is `账户` (glossary §2 has no `account` row; the zh guide's kept-English/preferred-Chinese table does not authorise a second word). This is graded MAJOR as a terminology violation, not a comprehension failure.
- **Exact replacements (minimal — the translator's sentences are otherwise sound):**

| Key | Replacement |
|---|---|
| `mobile.account_routing.title` | **`账户路由`** |
| `mobile.account_routing.loading` | **`正在加载账户路由……`** |
| `mobile.account_routing.load_error` | **`无法加载账户路由。检查连接后重试。`** |
| `mobile.account_routing.disconnected` | **`连接电脑后才能更改账户路由。`** |
| `mobile.account_routing.unavailable` | **`此中继不提供账户路由设置。在此电脑上更新Local Operator。`** |

- Recommended but not required for the term fix: `unavailable`'s English is byte-identical to core's, whose committed sentence is **`此中继上无法使用账户路由设置。更新此电脑上的Local Operator。`**; adopting it gives the identical sentence one rendering. The minimal replacement above already removes the MAJOR.

### AR-02 — MINOR — `mobile.account_routing.scope` (idiom; same sentence, second rendering)

- **Current:** `更改仅应用到此电脑。` · **English:** "Changes apply only to this computer." · **Core (identical English):** `更改仅对此电脑生效。`
- **Problem:** `应用到此电脑` is understandable but stiff; Chinese product copy prefers `对此电脑生效` for "apply to", and the identical English sentence already ships that way in core. Two renderings of one sentence in one product dilute the voice; the scope note is also the sentence that must never imply a phone-global policy, so it benefits from the settled phrasing.
- **Suggested:** **`更改仅对此电脑生效。`**

### AR-03 — MINOR — `mobile.account_routing.saved` (same sentence, second rendering)

- **Current:** `已保存到此电脑。` · **English:** "Saved on this computer." · **Core (identical English):** `已保存在此电脑上。`
- **Problem:** both are correct Chinese; only the rendering differs from the one the product already ships for the identical sentence. Graded NIT initially and raised to MINOR after the independent second pass flagged the same divergence: it is the same defect class as `AR-02` (one English sentence, two renderings across clients on one settings screen), and the two should be settled together.
- **Suggested:** **`已保存在此电脑上。`** — same words either way, one fewer variant.

## Per-key judgement

| Key | Role | Verdict |
|---|---|---|
| `title` | heading | **AR-01** — `账号` → `账户`. Otherwise correct: section heading, not a provider picker. |
| `scope` | help | **AR-02** — see above. Scope correctly limited to this computer. |
| `disconnected` | status | **AR-01** — `账号` → `账户`; the prerequisite is named, the relay is not called outdated and no empty policy is claimed. |
| `loading` | status | **AR-01** — `账号` → `账户`; read in flight, no policy choice asserted. |
| `save` | button | clean — `保存策略`, matches glossary/precedent (`保存策略` is core's own). |
| `saving` | button | clean — `正在保存……`, pending, never a saved confirmation. |
| `saved` | status | **AR-03 MINOR** — confirmation only; the same English sentence has two renderings across clients. |
| `unsaved` | status | clean — `尚未保存。` names the uncommitted draft; no full stop issue for a sentence-like status. |
| `retry` | button | clean — `重试`; a failed read, not a blind repeat of an uncertain save. |
| `reload` | button | clean — `重新加载策略`; re-reads the committed policy, distinct from `重试`. |
| `unavailable` | status | **AR-01** — `账号` → `账户`; "does not provide … on this relay" matches the confirmed-missing-route case and never covers an offline/unknown tunnel. |
| `load_error` | status | **AR-01** — `账号` → `账户`; a read failure distinct from a confirmed old relay. |
| `error` | status | clean — `无法确认此次更改。检查连接并重新加载，以读取当前策略。` keeps the unknown outcome, asserts neither not-saved nor success, and the `，以` purpose clause is core's house style. |
| `rejected` | status | clean — `更改未保存。检查所选值或此电脑的设置后重试。` is the definitive refusal; `所选值` is apt for this screen's radio choice (the `unsaved` note: "changing radio alone does not persist"), and no backend text is folded in as a descriptor. |

## Second pass (independent, reconciled)

Reviewer job `9855d3d26399` (`radient/auto` after the same quota descent) read all 14 keys without this auditor's findings. It **independently confirmed `AR-01`** with the same five keys and byte-identical replacements, and it **independently flagged `saved`** (this audit then raised `AR-03` from NIT to MINOR). It did **not** flag `scope` (`AR-02`), which this audit keeps: `更改仅应用到此电脑。` is the second rendering of a sentence core already ships as `更改仅对此电脑生效。` It also repeated the wave-level `mobile.computers.section.not_connected` occurrence as supporting evidence and correctly left that namespace to its own auditor.

## Notes and limits

- No human native-speaker review; **no rendered frame**. No fit risk here: the longest value wraps.
- The `账号` finding rests on core's committed bytes, executed and printed in `audit.log` (`git show origin/main:…/zh-CN/relay.account_policy.json`, and counts of `账户`/`账号`), not on recall.
- Translator provenance is as supplied by the requesting manager; the run was not observed.
- `audit_notes_not_execution_log`: prose is judgement; `audit.log` holds the actual commands and their output.
