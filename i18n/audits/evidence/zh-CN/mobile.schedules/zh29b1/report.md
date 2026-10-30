# Independent Chinese audit — `mobile.schedules` (`zh29b1`)

**Verdict: `changes_requested` — 0 BLOCKER, 3 MAJOR (`ZH-SCH-1`–`ZH-SCH-3`), 2 MINOR (`ZH-SCH-4`–`ZH-SCH-5`); unresolved blocker/major count = 3.** All 38 English/context/zh-CN entries were read and judged against the sidecar notes, the zh-CN style guide and the committed core zh-CN vocabulary.

- **Auditor:** `i18n-auditor` (lopdev team), session `09e9d1711068`. **Actual model: `radient/auto`.** The request began on `anthropic/claude-sonnet-5-5` and hit provider-quota HTTP 429s, then `openai/gpt-6-astra` and `kimi/k3.1-pro`, ending on `radient/auto`; all evidence commands below ran after the final switch. Disclosed, not hidden.
- **Translator:** a different agent, actual model `radient/auto` as supplied by the requesting manager; not observed by this auditor. Independence is agent/session/context, not model diversity — the served model is the same, disclosed.
- **Second independent pass:** job `a163531a0dbd` (`zh-group-B-second-pass`, role `reviewer`, actual `radient/auto` after the same quota descent) read the four namespaces without this auditor's findings. It reported 0 BLOCKER / 0 MAJOR / 5 MINOR / 5 NIT across the group. It independently found the supervisor noun, the account noun, `tail.failed`, `truncated`, `filed_by`, the row/line calques and `from`; it judged `head.next` acceptable. This report keeps `head.next` as MAJOR (reason in `ZH-SCH-1`) and records the severity difference rather than hiding it. Its summary says “83 keys”; the executed count here is 77 (38+15+14+10), and 77/77/77 is authoritative.
- **Inputs:** en `0459a0485ceb2594c60a152a8dbdc5035689ade05ac370134f8e37be6abc575f` · context `d3f0d3bba057aacf4d3495b3d5eec2471d66b6d6c011b50834a1f58a0839aa92` · zh-CN `12e5fd823fcd482138010dae757e2dcc901fa87e993a22395d91e1c63a782eb0`.
- No translation/MT service, no human native-speaker review, no rendered frame. Fit claims are font-metric measurements, not a device capture.

## Mechanical evidence (executed)

`audit.log` holds the actual commands and output:

- `npm run -s i18n:catalogue:check` → exit 0, `src/i18n/catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr)`.
- `node scripts/i18n/check-strings.ts` → `284 finding(s), all baselined; 0 new; no growth vs a57fb8cbe161`.
- JSON valid; **38/38/38** en/zh-CN/context keys; no key added or dropped; context parity complete.
- Every message parses through the app's own `parseMessage`; **0** placeholder-name/kind/order mismatches; **0** `select`-arm mismatches. The `truncated` select keeps `wakes`/`other`; `write_receipt` is not in this namespace.
- Every plural carries exactly `other`; `Intl.PluralRules("zh-CN").resolvedOptions().pluralCategories` is `["other"]`. Collapsing English `one`/`other` to `other` is correct for Chinese and is not a defect.
- No bidi controls, no ASCII prose punctuation, no Latin prose outside kept terms (`lop mobile`, `Radient`) and ICU arm identifiers.
- `#` renders through `String(n)`, so `1000000` prints ungrouped; a renderer limitation, not a translation defect.
- The naive Latin-residue check reports only `other`/arm identifiers (`truncated`) — false positives, not text.

## Rendered evidence — the app's own parser

### Counted nouns at 0 / 1 / 2 / 1 000 000

| key | 0 | 1 | 2 | 1 000 000 |
|---|---|---|---|---|
| `count.wakes` | `0 个唤醒` | `1 个唤醒` | `2 个唤醒` | `1000000 个唤醒` |
| `count.monitors` | `0 个监控` | `1 个监控` | `2 个监控` | `1000000 个监控` |
| `show_more.wakes` | `再显示0个唤醒` | `再显示1个唤醒` | `再显示2个唤醒` | `再显示1000000个唤醒` |
| `show_more.monitors` | `再显示0个监控` | `再显示1个监控` | `再显示2个监控` | `再显示1000000个监控` |
| `summary.wakes` | `0个已定时` | `1个已定时` | `2个已定时` | `1000000个已定时` |
| `summary.monitors_armed` | `0个已启用` | `1个已启用` | `2个已启用` | `1000000个已启用` |
| `tail.failed` | `0个失败` | `1个失败` | `2个失败` | `1000000个失败` |

No stray plural marking; classifiers are correct except `tail.failed` (`ZH-SCH-4`, 次 for failure occurrences). `show_more` is only displayed for `hidden > 0`; 0 is synthetic. `count.wakes`/`count.monitors` render with a space after `#`; the style guide's plural example uses `# 个会话` while its prose rule says no space — recorded as a guide ambiguity, not scored here (see Notes).

### Attention / truncation

| key | input | rendered |
|---|---|---|
| `summary.monitors_attention` | 0/3 | `0/3个需要处理` |
| `summary.monitors_attention` | 1/3 | `1/3个需要处理` |
| `summary.monitors_attention` | 2/3 | `2/3个需要处理` |
| `summary.monitors_attention` | 1 000 000/1 000 000 | `1000000/1000000个需要处理` |
| `truncated` | wakes 3/10 | `显示3/10个设有唤醒的对话。` |
| `truncated` | monitors 3/10 | `显示3/10个设有监控的对话。` |

### Composition — `dueLabel`/`nextDueClause` mirrored from `schedules-copy.ts`

`dueLabel` already returns the whole phrase: `4m后` / `已逾期2h`. `head.next` is `{head} · 下次{label}`.

| count | due label | rendered zh-CN | English comparator |
|---|---|---|---|
| 1 wake, +4m | `4m后` | `1 个唤醒 · 下次4m后` | `1 wake · next in 4m` |
| 3 wakes, +60s | `60s后` | `3 个唤醒 · 下次60s后` | `3 wakes · next in 60s` |
| 1 monitor, +60s | `60s后` | `1 个监控 · 下次60s后` | `1 monitor · next in 60s` |
| 3 wakes, −2h | `已逾期2h` | `3 个唤醒 · 已逾期2h` | `3 wakes · 2h overdue` |
| 5 wakes, −3d | `已逾期3d` | `5 个唤醒 · 已逾期3d` | `5 wakes · 3d overdue` |

### Cadence, state words and status notices

```
每1h30m · 每1h · 剩余1次 · 每1h · 已无剩余次数 · 单次
已禁用 · 休眠中 · 已过期 · 已失效 · 等待中
尚未启用任何任务
在对话中让智能体定期做某件事，它就会出现在这里。唤醒会在指定时间向对话发送提示词；监控会持续观察某一项内容并报告变化。
未安排任何唤醒。 · 未启用任何监控。
已失效——其对话已不在此机器上，因此不会触发
已失效——其对话已不在此机器上，因此不会检查
已暂停——下次回合结束后，唤醒会恢复
已暂停——对话再次运行后，监控会恢复
无法读取此机器上的唤醒。 · 无法读取此机器上的监控。 · 刚才无法读取此机器的定时任务。
收起部分唤醒 · 收起部分监控
唤醒监管程序已安装但未运行，因此下方唤醒不会触发。
此平台尚未支持唤醒监管，因此下方唤醒仅在对话运行时触发。
下方唤醒没有监管程序，因此仅在其对话运行时触发。
```

## Findings

### ZH-SCH-1 — MAJOR — `mobile.schedules.head.next` (composed head line)

- **Current:** `{head} · 下次{label}` → executed `3 个唤醒 · 下次4m后` (1 monitor: `1 个监控 · 下次60s后`).
- **Problem:** `dueLabel` already returns `4m后`; `下次` and `后` are two forward time expressions spliced with no separator, so the line reads “next 4m later” rather than “next in 4m”. It is the primary entry-head sentence and the one place the task asks to judge composition. `head.overdue` already uses the clean `{head} · {label}` shape.
- **Replacement:** `{head} · 下次：{label}` → `3 个唤醒 · 下次：4m后`. The full-width colon separates the label from the relative phrase without adding a space. `{head} · {label}` (`3 个唤醒 · 4m后`) is an equally valid terser alternative; the colon form keeps the source's “next”.
- **Second-pass difference:** the second pass judged `下次4m后` acceptable and did not file it; this pass keeps MAJOR because the unseparated splice is the exact calque the composition check exists to catch. Neither reading claims the line is unsafe; it is a correctness/idiom defect, not a comprehension failure.

### ZH-SCH-2 — MAJOR — `mobile.schedules.summary.monitors_attention` (count phrase)

- **Current:** `{broken}/{total}个需要处理` → executed `1/3个需要处理`.
- **Problem:** `个` after a ratio reads as “one-third of an item”, and the following `需要处理` has no noun to attach to; the header is ungrammatical/ambiguous. The committed core twin is `{shown}/{total}项需要关注` (`tui.small.wake_panel.monitors_need_attention`); `处理` also asks the reader to act, while “need attention” is a softer, accurate status.
- **Replacement:** `{broken}/{total}项需要关注` → `1/3项需要关注`.
- **Second-pass difference:** the second pass filed the `处理`→`关注` part as NIT and did not treat the classifier as a finding; this pass treats the ungrammatical count phrase as MAJOR.

### ZH-SCH-3 — MAJOR — `mobile.schedules.supervisor.not_running` / `.unsupported` / `.unverifiable` (terminology)

- **Current:**
  - `唤醒监管程序已安装但未运行，因此下方唤醒不会触发。`
  - `此平台尚未支持唤醒监管，因此下方唤醒仅在对话运行时触发。`
  - `下方唤醒没有监管程序，因此仅在其对话运行时触发。`
- **Problem:** core's committed zh-CN names the wake supervisor **`监督者`** in 14 strings (`cli.wake_help.wake/status/install`, `cli.browser.supervisor_line`); `监管` appears in core only as a verb (`tui.schedule.notice_supervisor`: `没有进程监管这些唤醒`). The phone uses `监管程序`/`唤醒监管` for the same process a reader also meets through `lop wake status`, so one concept has two nouns. `下方唤醒` is also a spatial calque; Chinese text reference prefers `以下唤醒`.
- **Replacement:**
  - `唤醒监督者已安装但未运行，因此以下唤醒不会触发。`
  - `此平台尚不支持监督唤醒，因此以下唤醒仅在对话运行时触发。`
  - `以下唤醒没有监督者，因此仅在其对话运行时触发。`
- **Second-pass difference:** the second pass graded this MINOR; this pass keeps MAJOR because it is a product-term violation across three visible notices, not a one-off style preference.

### ZH-SCH-4 — MINOR — `mobile.schedules.tail.failed` (classifier)

- **Current:** `{count}个失败` → `1个失败` / `3个失败`.
- **Problem:** the value is `consecutive_failures` — failure occurrences — not a count of failed objects. Chinese counts occurrences with `次`; core's `tui.analytics.totals.calls_failed` is `（{count}次失败）`. `个失败` reads as “three failed things”, not “three failures”.
- **Replacement:** `{count}次失败` → `1次失败` / `3次失败`.

### ZH-SCH-5 — MINOR — `mobile.schedules.truncated` (idiom)

- **Current:** `显示{shown}/{total}个设有{family}的对话。`
- **Problem:** `设有` belongs to installed facilities (`园区设有食堂`), not to a conversation that holds wakes/monitors. `含` is the natural verb for data containment and keeps the select arms unchanged.
- **Replacement:** `显示{shown}/{total}个含{family, select, wakes {唤醒} other {监控}}的对话。` → `显示3/10个含唤醒的对话。`

## Per-key judgement (all 38)

| # | key | Verdict |
|---|---|---|
| 1 | `cadence.every` | PASS — `每{duration}`, core's `每{interval}` |
| 2 | `cadence.left` | PASS — `每1h · 剩余1次`, classifier 次 for deliveries |
| 3 | `cadence.once` | PASS — `单次`, core's own |
| 4 | `cadence.spent` | PASS — `已无剩余次数`, no promise of a fire |
| 5 | `count.monitors` | PASS — `# 个监控`; `other` only; 0/1/2/1 000 000 checked; spacing note |
| 6 | `count.wakes` | PASS — `# 个唤醒`; `other` only; spacing note |
| 7 | `due.ahead` | PASS — `{label}后`, core's `{duration}后` |
| 8 | `due.overdue` | PASS — `已逾期{label}`, core's `已逾期{age}` |
| 9 | `empty.body` | PASS — two sentences; wake/monitor definitions preserved; reads natively |
| 10 | `empty.title` | PASS — `尚未启用任何任务`; short heading, no full stop |
| 11 | `empty_line.monitors` | PASS — `未启用任何监控。` |
| 12 | `empty_line.wakes` | PASS — `未安排任何唤醒。` |
| 13 | `gone.monitors` | PASS — `已失效——其对话已不在此机器上，因此不会检查`; distinct from parked; shares `已失效` with `state.stale` only in the slot, explained below |
| 14 | `gone.wakes` | PASS — `已失效——…因此不会触发` |
| 15 | `head.next` | **ZH-SCH-1 MAJOR** |
| 16 | `head.overdue` | PASS — `{head} · {label}` renders `3 个唤醒 · 已逾期2h` |
| 17 | `parked.monitors` | PASS — resumes when the conversation runs; not “opening it” |
| 18 | `parked.wakes` | PASS — resumes after the next turn; `回合` is core-attested (24 occurrences), not a finding |
| 19 | `read_error.monitors` | PASS — names the family; never empty-list shaped |
| 20 | `read_error.wakes` | PASS |
| 21 | `read_unreachable` | PASS — says the read did not happen, no cause claimed |
| 22 | `show_less.monitors` | PASS — `收起部分监控`; the control collapses the extra rows |
| 23 | `show_less.wakes` | PASS |
| 24 | `show_more.monitors` | PASS — `other` only; `再显示1个监控` natural |
| 25 | `show_more.wakes` | PASS |
| 26 | `state.disabled` | PASS — `已禁用` |
| 27 | `state.dormant` | PASS — `休眠中`, distinct from the parked clause |
| 28 | `state.expired` | PASS — `已过期` |
| 29 | `state.stale` | PASS — `已失效`; the slot and the gone clause's explanation keep the two states distinct; not scored |
| 30 | `state.waiting` | PASS — `等待中` |
| 31 | `summary.monitors_armed` | PASS — `{count}个已启用`; readable section fragment |
| 32 | `summary.monitors_attention` | **ZH-SCH-2 MAJOR** |
| 33 | `summary.wakes` | PASS — `{count}个已定时`; readable section fragment |
| 34 | `supervisor.not_running` | **ZH-SCH-3 MAJOR** |
| 35 | `supervisor.unsupported` | **ZH-SCH-3 MAJOR** |
| 36 | `supervisor.unverifiable` | **ZH-SCH-3 MAJOR** |
| 37 | `tail.failed` | **ZH-SCH-4 MINOR** |
| 38 | `truncated` | **ZH-SCH-5 MINOR** |

## Fit — measured, not assumed

No `maxCells`/`maxChars` field exists in this namespace's sidecars (the only mobile namespaces that carry a budget are `relay.health` and `mobile.session_health`), so there is no declared budget to exceed. Measured with AppKit/PingFang SC at the design kit's sizes (`text-meta` 12/500, `text-mono-label` 11/600 + 0.06 em, `text-body-sm` 14/400) against a 320 pt device: screen content 288 pt (`px-4` = 32), row indent 276 pt (`pl-3` = 12). No rendered frame; these are font metrics (± a few percent).

| line | chars | cells | px @100% | lines @100% | verdict |
|---|---:|---:|---:|---:|---|
| `empty.body` | 59 | 118 | 826.0 | 3 | wraps, no clip |
| `supervisor.not_running` | 25 | 50 | 350.0 | 2 | wraps |
| `supervisor.unsupported` | 28 | 56 | 392.0 | 2 | wraps |
| `supervisor.unverifiable` | 24 | 48 | 336.0 | 2 | wraps |
| `truncated` (3/10) | 15 | 26 | 156.7 | 1 | fits |
| `head.next` (3 wakes) | 13 | 19 | 114.5 | 1 | fits |
| `head.overdue` | 13 | 19 | 110.9 | 1 | fits |
| `summary.wakes` / `summary.monitors_attention` | 5 / 8 | 9 / 13 | 53.4 / 76.7 | 1 | fits |
| `gone.monitors` | 22 | 42 | 264.0 | 1 | fits with 24 pt spare; 2 lines at 200% |

No value has a single unbreakable token wider than the 288 pt content width, so nothing can overflow horizontally at 100%. The entry name and the user's message are the only clamped fields; every catalogued status sentence wraps. At 200% the sentences wrap to 2–3 lines; no catalogue string is clipped. The earlier French audit's `empty.body` (6 lines at 100%) is longer than Chinese; Chinese is 3 lines.

## Notes that are not findings

- **`state.stale` and `gone.*` share `已失效`.** They occupy different slots: one is a one-word due-slot replacement, the other is a full clause that explains the missing conversation. The second pass agreed this is defensible; not scored.
- **`parked.wakes` uses `回合` for “turn”.** Core uses `回合` in 24 committed strings (e.g. `wire.settings.compaction_mid_turn_enabled.label` = `回合中压缩`); `relay.transcript.turn` uses `轮次` for a transcript turn. The mobile sentence reads naturally; not scored.
- **`count.wakes`/`count.monitors` render `# 个…` with a space**, while the rest of the namespace uses `{count}个…` without. The style guide's prose rule says no space; its own plural example shows `# 个会话`. This is a guide ambiguity and an internal rhythm difference, not a translation error. If the programme picks one, align the two plural keys (and `mobile.projects.sessions.count`) in the same pass.
- **`summary.wakes`/`summary.monitors_armed` use `个` ellipsis** (`3个已定时` / `3个已启用`) rather than core's `项已定时`/`个监控已启用`. Both are readable in the section context; not scored.
- **`head.next` second-pass view** is recorded above; the disagreement is deliberate.

## Source-level gaps (outside this catalogue pair)

These are not catalogue findings and are excluded from the unresolved count; they are reported so the manager can route them:

- `src/features/schedules/schedules.tsx` composes the section headers with hardcoded English prefixes: `Wakes · ${wakeSectionSummary(...)}` and `Monitors · ${monitorSectionSummary(...)}` (also the screen title `Schedules`, `Back`, `Try again`). A zh-CN build will therefore show `Wakes · 3个已定时` / `Monitors · 1/3项需要关注`, not a fully Chinese header. The prior French and Spanish audits recorded the same unkeyed-prefix gap; it is a source/strings-programme change, not a catalogue edit.
- `monitorStateWord`'s `default` returns the relay's raw state word for a state this build does not know. That is documented as deliberate; it is not a missing translation for the three known states (`disabled`/`dormant`/`expired` all key correctly).

## Gate note

`node_modules/.bin/vitest run src/i18n/__tests__/catalogues.test.ts` fails on this tree at `ships no locale the runtime cannot render`: the directory list is `['en','es','fr','zh-CN']` while `SHIPPED_LOCALES` is `['en','es','fr']`. That is the designed directory-vs-shipped gate (a catalogue directory is not activation), not a copy defect; the wave cannot land green until the `locale.ts` flip (zh-CN shipped, removed from pending) lands with the catalogue after the audits pass. `i18n:catalogue:check` and the strings ratchet are green; the catalogue bytes are untracked at `a57fb8c` and must be committed together with the projection.

## Recording boundary

This repository has no `i18n/ledger.json` and no audit-ledger command; `docs/i18n.md` says the PR records the report, and this bundle is the durable artifact. A proposed ledger row is in `record.json.ledger`; it is explicitly unwritten and its note references this record path. No rendered frame, no human native review, and no claim that the untracked catalogue is on `main` are made. The catalogue is untracked at `a57fb8c`; its bytes are pinned by `input_hashes.target.sha256`.
