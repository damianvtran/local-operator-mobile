# zh-CN M2 remediation — round 1

Translator: i18n-translator, session `1108a033f9c2`, actual served model `openai/gpt-6.1-sol` (session header; no model fallback). Locale-only candidate work, fix lane <2h; no production edits, commits, ledger changes or self-audit. This is a remediation decision record, not an independent audit or rendered-fit sign-off. Translated by reasoning, without MT/API/SDK.

## Inputs and direct verification

Read `keys32.json`, `zh-CN.v1.json`, both `r1/audit-zh-CN-{A,B}.md`, core `docs/I18N.md`, RFC architecture/RTL/translation pipeline, `i18n/style-guides/zh-CN.md` and shared glossary. Re-read shipped mobile catalogues and core `local_operator/i18n/catalogues/zh-CN/`. Verified the consuming `contextFact` and `REGION_LABEL` via `git show feat/i18n-app-scan-expression-literals:app/(app)/session/[id].tsx`.

Fresh Python recount of string-value substring occurrences (not key names, excluding `.context.json`): mobile has **21 catalogues / 649 strings**, not 22 catalogues: the 22nd JSON file is `mobile.team_bridge.context.json`, metadata rather than another catalogue. Core has **93 catalogues / 3219 strings**.

| Term | mobile | core |
|---|---:|---:|
| 电脑 | 53 | 18 |
| 会话 | 49 | 348 |
| 你的 | 10 | 35 |
| 隧道 | 7 | 8 |
| 中继 | 7 | 5 |
| 上下文 | 2 | 25 |
| 连接中 | 1 | 1 |
| 连接路径 | 1 | 0 |
| 未响应 | 1 | 4 |
| 空闲 | 1 | 11 |
| 在线 | 1 | 2 |
| 视频 | 1 | 3 |
| 离线 | 0 | 3 |
| 任务 | 9 | 33 |
| 子智能体 | 6 | 39 |
| 活动 | 1 | 12 |
| 状态 | 9 | 58 |
| ctx | 0 | 0 |

Specific binding sources: both mobile and core `relay.chrome.session.subtitle.not_answering` = `未响应`; `.idle` = `空闲`; `relay.health.live` = `在线`. Mobile `mobile.computers.badge.connecting` = `连接中`; `mobile.chrome.composer.row_usage` = `上下文`; `mobile.session.highlights.video_open` = `播放视频{name}`. `mobile.session.status_tray.hint` names `任务和子智能体`; `mobile.session.subagent.screen_title` = `子智能体`.

## Per-finding decisions — 5 fixed / 3 declined

### Audit A (`deepseek/deepseek-flash`, report provenance)

- **MAJOR-1 — fixed in candidate:** short estimate now `ctx{percent}%（约）`, versus wide `上下文{percent}%（估算）`. Plain short is also changed to `ctx{percent}%` under the manager's narrower-form requirement. `ctx` is the source's developer abbreviation for context, retained only in the space-constrained variant; it is not an invented Chinese abbreviation such as 上文, which would change meaning. `约` is native concise approximation wording; full-width parentheses remain intact. This deliberately introduces a narrow-only abbreviation (not claimed as shipped precedent); glossary proposal below. With `21`: wide/plain 9 cells, narrow/plain 6, wide/estimate 17, narrow/estimate 12. With `100`: 10, 7, 18, 13. These are computed character cells (CJK/full-width = 2), not measured iOS points. The call-site comment explicitly selects narrow below 340pt because the long form wraps; no native frame captured here.
- **NIT-1 — fixed in candidate:** `通过你的Radient隧道` → `通过Radient隧道`. The owned account card supplies possession; dropping 你的 follows the guide's pronoun economy and saves 4 cells.
- **NIT-2 — fixed in candidate:** `正在等待位于{host}的电脑响应。…` → `正在等待{host}上的电脑响应。…`. 上 is natural for a host address rather than physical-location 位于; route-provisioning explanation and both full stops retained.
- **NIT-3 — declined:** retain `未登录Radient账户`. This is the account-card name line, not simply the inverse of the signed-in status chip. `账户` disambiguates Radient account authentication from the computer connection state shown alongside it. The source explicitly names Radient; the shipped positive `已登录` does not establish that this different line must have the same word count. The auditor itself calls the original correct and the change optional.

### Audit B (`anthropic/claude-sonnet-5-5`, report provenance)

- **MINOR-1 — declined:** do not introduce spaces around `{host}` or `{baseUrl}`. The zh-CN guide explicitly says no spaces between Chinese and Latin/digit runs; the auditor acknowledges this. `mobile.chrome.home.connecting` does contain a legacy space, but that is inconsistent precedent, not authority to override the binding guide. No link-detection implementation or reproduction supporting the claimed hostname boundary bug was supplied. The host sentence was independently polished for A-NIT-2; the requested spacing change was not applied. `已直连{baseUrl}` remains unchanged.
- **MINOR-2 — fixed at translation scope; wiring remains manager-owned:** supplied all four new label keys: 活动 / 子智能体 / 任务 / 状态. Verified the inspected branch's `REGION_LABEL` still uses English activity/agents/tasks/status; this was a real wiring gap, not a flaw in `{labels}在下方`. The new source keys enable the manager's code fix; this candidate alone cannot claim that wiring is integrated. Example after integration: `任务 · 状态在下方 · 向下滚动 ↓`. No spacing workaround around the unchanged placeholder is needed for Chinese labels.
- **NIT-1 — fixed in candidate:** `下方还有更多` → `下方还有内容`. Supplies the implied noun and retains the same CJK character count, separator and arrow.
- **NIT-2 — declined:** keep `未响应` for stream_degraded and status.not_answering. Their notes both describe an open/reachable connection not answering. The exact relay term is `未响应`; `响应异常` would imply a different condition not supported by this source. These are two displays of one condition, not two distinct stream enum states. The five diagnostic states remain distinct: 空闲 / 连接中 / 在线 / 未响应 / 离线.

B's no-width-problem conclusion is not adopted: it did not render the under-340pt band and the inspected code explicitly defines a separate narrow branch. A's predicted wrapping is likewise not treated as measured native proof; the remediation makes the strings mechanically shorter without claiming rendered coverage.

## Added keys and manager constraints

- New labels: `working` 活动, `subagents` 子智能体, `todos` 任务, `strip` 状态. All are noun labels usable unchanged in `{labels}在下方`. Chinese needs no case or plural agreement; the specific subagent label reuses the shipped screen title rather than a generic agent term.
- `back_to` = `返回{name}`. Real-name examples: `返回发布计划`, `返回Project Atlas`; fallback: `返回会话`. Computer confirmation: `已连接到MacBook Pro。` / `已连接到你的电脑。`. The computer and session fallback keys are separate already; no split-key request for zh-CN.
- `no_connection` remains `尚未连接`, preserving yet, distinct from `未连接` and `离线` (both offline displays intentionally reuse 离线).
- Video remains 视频, matching shipped `播放视频{name}`.
- Product name remains exactly `Local Operator`; Radient remains Latin. No manual bidi controls introduced.

## Glossary proposals

- Allow **ctx** only as the context-window abbreviation in the under-340pt activity tray. Full/wide Chinese continues to use 上下文. No shipped ctx precedent was found in either corpus; this is an explicit compact developer-UI proposal, permitted by the manager's short-form directive, not a global terminology replacement.
- Use **约** for the parenthesized estimate marker only in that narrow variant; retain 估算 in the wide version.

## Actual validation

`python3` loaded the written v2 JSON back from disk and asserted: 32 keys, exact keys32 order, identical placeholder names per key vs English, no empties/edge whitespace, NFC, English-identical only `mobile.settings.account.app_name = Local Operator`. PASS. Source has no ICU plural/select patterns in these 32 keys; no plural arms are needed. **5 changed existing values + 5 new values; 22 existing values retained.**

Actual output:

```text
PASS: 32 keys; exact source order; placeholder names match English per key; no empties; NFC; English-identical only Local Operator
changed existing 5 new 5
context '上下文21%' 9
context_short 'ctx21%' 6
context_estimate '上下文21%（估算）' 17
context_short_estimate 'ctx21%（约）' 12
Connected fallback: 已连接到你的电脑。
Back fallback: 返回会话
```

Repository validator: `pnpm -s i18n:check` rejected unsupported `-s`. `pnpm run i18n:check` unexpectedly attempted a dependency install and failed because worktree node_modules is not a real directory; no dependency tree was replaced or repaired. Used the exact package script commands directly, with existing Node and dependencies:

```sh
cd ~/local-operator-mobile/.worktrees/i18n-app-scan
node scripts/i18n/generate.ts --check && node scripts/i18n/check-strings.ts
```

Exit **0**. Actual stdout:

```text
src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
scanner sha256: base=fd5946dfe556d9f0161b6093ab9792ae2049758d1870a56a0d888e4d95154d5c head=cf05770fe3fa0ff57d974806f5eb48e0278e8e8785c7d785817548b7ce95b813
check-strings: 212 finding(s), all baselined; 0 new; verified historical debt vs d78ca8616286
```

Node emitted MODULE_TYPELESS_PACKAGE_JSON warnings. This repository check covers the current integrated 649-key tree, **not** this scratch candidate. Candidate coverage is the separate Python validation above. Integration, rendered narrow-band fit, and independent second-round audits remain the manager's gates; no self-audit/pass status claimed.
