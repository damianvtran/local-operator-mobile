# Independent Chinese audit — `mobile.home` (`zh29a1`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 2 MINOR (`H-01`, `H-02`), 3 NIT (`H-03`, `H-04`, `H-05`); unresolved blocker/major count = 0.** One repository gate is failing independently of the copy (see “Repository gate” below); it changes no copy verdict in this bundle. All 27 English, context and Chinese entries were read and judged key by key.

- **Auditor:** `i18n-auditor` (lopdev team), session `6de17b1d6bbd`. **Actual model: `radient/auto`.** Fallback trail in this session: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (each a provider-quota HTTP 429 fallback, disclosed). Every judgement and measurement in this bundle was produced under `radient/auto`.
- **Translator:** a different agent, model `radient/auto` as supplied by the requesting manager — not observed by this auditor. Different agent, session and context; **not model-diverse** (the served model is the translator's served model too): disclosed, not closed.
- **Second independent pass:** reviewer job `9855d3d26399` (label `zh-group-a-second-pass`), launched on this session's model (`anthropic/claude-sonnet-5-5` primary); it read all 54 group-A keys without this auditor's findings. Its verdict and the reconciled disagreements are recorded in `record.json.second_independent_pass` and summarised under "Second pass" below.
- **Inputs:** en `4ebba126f106bada157ae56ef2a7fedc2b5ee056d01df7dcd9235c75bd68dce3` · context `db18b25dd2099a953b817d151b9605e43f0403b528c36fdadc822cb6c9125f3c` · zh-CN `24f80843f29ec7687e335f06d412f4add6284f0de837e82e71f741945f5bf033`.
- No human native-speaker review and **no rendered frame**: width figures are executed CoreText measurement plus the code's own geometry, not a screenshot.

## Mechanical result

- Repository validators, executed: `node scripts/i18n/generate.ts --check` → *"src/i18n/catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr)"*; `node scripts/i18n/check-strings.ts` → *"284 finding(s), all baselined; 0 new; no growth vs a57fb8cbe161"*. (`pnpm i18n:check` itself refuses to run in this worktree: pnpm will not create a hoist directory at a symlinked `node_modules`; the two underlying scripts were run directly instead — same code, same exit status, disclosed in `audit.log`.)
- JSON valid and keys exactly 27/27/27 (en / zh-CN, context covers all 27). No key added or dropped.
- **No placeholders and no ICU structures** in this namespace — proven by scan of both locales, not assumed. No markup, code spans, commands, flags, paths or identifiers.
- No bidi controls, zero-width or other `Cf`/`Cc` characters. No ASCII punctuation inside Chinese prose. Every `……` is U+2026 twice and final. Chinese quotation marks `“”` are balanced. No 您, no ！.
- Style scan found exactly one `请` in the whole group-A wave, in `mobile.home.options.fixed` (H-01).
- Widths: worst group-A value here is `options.fixed` at 56 cells — a wrapping help sentence with no budget. The chips and tips are measured under tests (b) below.

## Findings

### H-01 — MINOR — `mobile.home.options.fixed` (guide voice + framing of “live controls”)

- **Current:** `此对话的起始选项已固定。实时控制项请在“对话详情”中查看。`
- **English:** "This conversation's starting options are fixed. Use Conversation details for its live controls."
- **Problem (two, same key):**
  1. `请` — the zh guide is explicit: *"'请' only where the English says 'please' (blocking dialogs)"* (`i18n/style-guides/zh-CN.md` §Formality & tone). The English has no "please" and this is a help note, not a blocking dialog. Note for the wave: core's committed zh-CN does use `请` in comparable error/instruction copy (e.g. `relay.asks.error.session_timeout` *"会话未及时响应——请重试。"*), so the shipped voice and the guide disagree; the guide binds the translator, so the honest fix is to drop `请` here (or amend the guide, which is a repo-artifact change, not a silent exception).
  2. `查看` narrows actionable controls to *looking at* them. The English says the live controls are *at* that screen; the reader goes there to operate them. The Spanish wave recorded the same narrowing as its `H-05` MINOR, and its remediation moved to `para los controles en vivo`.
- **Suggested:** **`此对话的起始选项已固定。实时控制项可在“对话详情”中调整。`** — 58 cells, drops `请`, restores the actionable reading, and keeps the destination label byte-identical (test (a)).
- Not a MAJOR: the noun `实时控制项` correctly renders "live controls" (unlike the French `commandes en cours`, which was a state and was graded MAJOR in that wave), and a single politeness word is a convention deviation of the same order as the French wave's U+202F finding, which that audit recorded MINOR.

### H-02 — MINOR — `mobile.home.suggestion.review_repo` (unrecorded kept-English deviation)

- **Current:** `审查此仓库` · **English:** "Review this repo" · **Sidecar:** *"'repo' is developer vocabulary kept as-is."*
- **Problem:** `repo` was translated to `仓库`. Both merged waves kept it Latin — French `Examinez ce repo`, Spanish `Revisa este repo` — and the key's context note says keep it. The zh guide does not list `repo` in its kept-English set and does prefer settled Chinese (`仓库` is the settled word for a Git repository), so the translation is defensible copy; what is missing is the recorded decision. The glossary lets a locale *extend* its kept-English list but requires the exception to be recorded in the locale guide (§4).
- **Suggested:** keep **`审查此仓库`** and record "repo → 仓库" as a zh-CN per-locale decision in `i18n/style-guides/zh-CN.md` (recommended — the word is what a Chinese developer reads); if the wave prefers strict parity with fr/es instead, the exact replacement is **`审查此repo`**. Either resolution closes the finding; leaving it unrecorded does not.

### H-03 — NIT — `mobile.home.suggestion.last_turn` (“turn” has two words in this wave)

- **Current:** `看看上一轮` · **English:** "Show me the last turn" · **Also in the wave:** `mobile.schedules.parked.wakes` renders "turn" as `回合` (*"下次回合结束后"*).
- **Problem:** one concept, two words. Core itself is split (`回合` through `wire.settings`/`wire.radient_saver`, but `最后一轮` for *the last turn* in `cli.sessions_help.paused`, and `轮次` in the CLI help).
- **Why NIT, not MINOR:** core's own collocation for *the last turn* is `最后一轮`, which is exactly this chip's phrase, and `上一轮` is the idiomatic form here; the wave's `回合` sits in a different collocation ("after the next turn ends"). It is a consistency observation, not a defect.
- **Suggested (optional):** `看看上一回合` if the wave wants one word for “turn” everywhere, or leave as is. The second pass graded this MINOR; this audit records the disagreement and its evidence.

### H-04 — NIT — `mobile.home.startup_queue.blocked` (terseness)

- **Current:** `重试以发送排队消息` · **English:** "Retry to send queued messages".
- **Problem:** the `以` purpose clause is understandable and is core's pattern in longer help copy, but this is a queue-row state; the retried object reads better directly.
- **Suggested (optional):** **`重试发送排队消息`** — 8 characters, 16 cells (measured 111.13 px at 14 pt), same meaning, no purpose clause.

### H-05 — NIT — `mobile.home.tip.parallel` (`展开` for “fan out”)

- **Current:** `要求并行工作以展开多个子智能体` · **English:** "ask for parallel work to fan out subagents".
- **Problem:** `展开` reads “unfold/spread out”; the fan-out reading survives, but `分出` is the clearer verb for splitting work out into subagents, and the tip is a fragment where every word counts.
- **Suggested (optional):** **`要求并行工作，分出多个子智能体`** — 15 characters, 30 cells (budget 48), measured 178.77 px against the ~288 pt tip row — the same width as the current string, with the fan-out reading made explicit.

## Test (a) — the destination name is byte-identical

`mobile.session.conversation_details` = **`对话详情`** (U+5BF9 U+5BDD U+8BE6 U+60C5). The value of `mobile.home.options.fixed` contains that exact four-code-point run, delimited by U+201C/U+201D: `…请在“对话详情”中查看。`. Substring test executed, result `true`. The label is read from the catalogue at the control (`startup-transcript.tsx:52` calls `t("mobile.session.conversation_details")`), so the reader sees the same four characters on the sheet and in the sentence. The quotation marks are typographic delimitation of a UI name, acceptable mainland practice, and they do not change the name; the suggested replacement keeps them.

## Test (b) — the suggestion pool: imperative, and fits the narrow row

Row geometry used: **320 pt viewport** (the narrow case the pool is calibrated on) → the splash's `px-4` gives a **288 pt** row; the `quiet`/`md` button adds `px-4`, leaving a **≈256 pt text box** (the Spanish wave measured ≈254 pt with the border). At 100 % the row is `numberOfLines={1}`; at large text it allows two centred lines. Measurements at `body-sm` 14 pt, CoreText, system font fallback (Figtree is not installed on this machine — disclosed; CJK advance is 1 em, i.e. 14 pt/char at 100 %):

| Key | Value | chars | cells | width @14 pt | imperative? |
|---|---|---|---|---|---|
| `suggestion.last_turn` | 看看上一轮 | 5 | 10 | 69.46 px | yes — reduplicated 看看 is the spoken imperative for "show me" |
| `suggestion.linear_mcp` | 设置Linear MCP | 12 | 14 | 102.00 px | yes — `Linear MCP` kept Latin, per sidecar |
| `suggestion.phone_access` | 开启手机访问 | 6 | 12 | 83.35 px | yes |
| `suggestion.review_repo` | 审查此仓库 | 5 | 10 | 69.46 px | yes (word choice is H-02) |
| `suggestion.team_of_agents` | 创建智能体团队 | 7 | 14 | 97.24 px | yes — and `创建` is the only agent-making verb in the pool, as the sidecar requires |
| `suggestion.wake_summary` | 用摘要唤醒我 | 6 | 12 | 83.35 px | yes — glossary `wake` → 唤醒 |
| *(control)* EN `team_of_agents` | Create a team of agents | 23 | 23 | 154.79 px | — |

- The longest Chinese chip is **102 px against a ≈256 px text box** — 40 % of the box, and **narrower than the English control (154.79 px)**, so no chip can truncate at 320 pt. At 200 % text the longest chips measure 186.61 px (`创建智能体团队`) and 193.77 px (`设置Linear MCP`), still inside the box, and the row may wrap to two lines anyway.
- Every chip is a verb-first imperative; the pool does not mix registers (the defect the Spanish wave graded MAJOR) and it uses 你, per the guide. `创建` opens exactly one chip, so one chip creates an agent.
- Caveat, disclosed: `SUGGESTION_CHAR_BUDGET` is `Record<ShippedLocale, number>` and `zh-CN` is still in `NOT_YET_SHIPPED_LOCALES`, so the repository's per-locale chip assertion does not run against these values yet. The measurement above is the substitute, and it is unambiguous (14 cells max against a 24-character source hint).

## Test (d) — plurals, `other`-only (wave-level; these keys are outside group A)

Verified independently, not taken from the translator:

- `Intl.PluralRules('zh-CN').resolvedOptions().pluralCategories` = **`["other"]`**, and `select()` returns `other` for 0, 1, 2, 1.5 and 100 — executed in Node 24.22.1. The repository's own `pluralCategory('zh-CN', 1)` also returns `other`.
- The wave's five plural messages (`mobile.projects.sessions.count`, `mobile.schedules.count.monitors`, `mobile.schedules.count.wakes`, `mobile.schedules.show_more.monitors`, `mobile.schedules.show_more.wakes`) each carry **one `other` arm and no `one` arm**, while their English source has `one`/`other`.
- **Dropping `one` is correct, not a defect.** A `one` arm could never be selected under zh-CN rules (dead copy), and the zh guide forbids one/other branches outright. `#` still formats (rendered `3 个会话`, `2 个唤醒`). The only failure mode would be a missing `other`; none is missing.
- Scope disclosure: those five keys live in `mobile.projects` and `mobile.schedules`, which belong to another auditor's group. This is recorded as wave-level evidence, not as a `mobile.home` verdict.

## Test (e) — `{subject}`/`{name}` inside Chinese quotation marks (wave-level; outside group A)

The quoting occurs in `mobile.projects` (`删除“{name}”？`, `项目“{subject}”。`, `里程碑“{subject}”。`), not in group A. Judge:

- **It does not break the placeholder.** The braces and the identifier are untouched; only the characters *outside* the braces were added. Executed through the app's own parser (`src/i18n/messages.ts`) and formatted with sample arguments: `{"kind":"project","action":"created","subject":"发布"}` → `已创建项目“发布”。`; `{"kind":"milestone","action":"completed","subject":"审计"}` → `已完成里程碑“审计”。`; `{"name":"示例项目"}` → `删除“示例项目”？…`. All 143 zh strings parse, 0 failures.
- **It is right.** Wrapping a user-supplied name in `“ ”` is the mainland convention the zh guide mandates (quotes are `“ ”`, and `「」` is not used), and it prevents the name from colliding with the sentence. The question mark sits outside the closing quote, also correct.
- No placeholder-name or ordering drift exists anywhere in the wave: en and zh placeholder token sets are identical for every key.

## Per-key disposition

| Key | Role | Verdict |
|---|---|---|
| `connect_disabled_reason` | status | clean — `连接电脑后才能发送。` names the prerequisite, stays short (10 chars / 20 cells) in the slot it shares with the connect action. |
| `folders_read_failed` | status | clean — `刚才无法读取此电脑的文件夹。` keeps "just now" (刚才), drops "we" as Chinese does, appends no error code. |
| `greeting` | heading | clean — `今天想让我帮你做点什么？` is idiomatic, 你, one question, no full stop needed on a question. |
| `options.apply` | button | clean — `使用这些选项`, no final full stop. |
| `options.fixed` | help | **H-01 MINOR** — see above. |
| `options.folder` | meta | clean — `此电脑上的文件夹` places the folder on the connected computer, not the phone. |
| `options.title` | heading | clean — `对话选项`; `conversation` → 对话, the wave's split (对话 vs 会话 for session). |
| `queue.discard` | button | clean — `丢弃排队消息` is destructive and clearly distinct from the move-to-draft button (丢弃 vs 移到草稿). |
| `queue.restore` | button | clean — `将排队消息移到草稿` restores into the composer; no full stop. |
| `queue.sheet_title` | heading | clean — `排队消息`, the same noun phrase as the button that opens it. |
| `queue.view` | button | clean — `查看排队消息`. |
| `refused_start_fallback` | status | clean — `此电脑上没有该文件夹。` states the missing folder without blaming the reader. |
| `starting` | status | clean — `正在启动……`, one short line, U+2026 twice. |
| `startup_queue.blocked` | status | **H-04 NIT** — `重试以发送排队消息` is an instruction to retry, never a claim that sending is under way; the optional terser form is above. |
| `startup_queue.not_started` | status | clean — `未启动`, two characters beside the queued-messages button. |
| `startup_queue.sending` | status | clean — `正在发送排队消息……` is continuous, keeps the ellipsis, repeats no count. |
| `startup_queue.unconfirmed` | status | clean — `启动未确认` names the state and implies nothing is waiting. |
| `suggestion.last_turn` | button | **H-03 NIT** — `看看上一轮` is imperative and idiomatic; the “turn” word is recorded for consistency only. |
| `suggestion.linear_mcp` | button | clean — `Linear MCP` byte-identical, no final full stop. |
| `suggestion.phone_access` | button | clean — `开启手机访问`. |
| `suggestion.review_repo` | button | **H-02 MINOR** — see above. |
| `suggestion.team_of_agents` | button | clean — `创建智能体团队`; glossary 智能体/团队 both respected. |
| `suggestion.wake_summary` | button | clean — `用摘要唤醒我` keeps "me" and glossary 唤醒. |
| `tip.parallel` | help | **H-05 NIT** — `要求并行工作以展开多个子智能体` is a fragment with no full stop; 30 cells against the 48-character budget and 178.77 px against the ~288 pt tip row. |
| `tip.schedule` | help | clean — `设置定时任务按时运行提示词` uses glossary 定时 and 提示词; 26 cells, 154.94 px. |
| `tip.search` | help | clean — `搜索过往对话以重新打开会话`; conversation/session split preserved; 26 cells, 154.94 px. |
| `transcript.waiting` | status | clean — `正在等待对话……`, empty-state status, ellipsis kept. |

## Second pass (independent, reconciled)

Reviewer job `9855d3d26399` (label `zh-group-a-second-pass`), opened on `anthropic/claude-sonnet-5-5`, **ran to completion as `radient/auto`** after the same quota descent (`openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`) — disclosed; it is not model-diverse from this audit or from the translator. It read all 54 group-A keys without my findings.

- **Agreed:** H-01 (`请` in `options.fixed`; its alternative `实时控制项见“对话详情”。` still frames the controls as viewable, so this audit keeps `可在…中调整`); H-02 (`repo` pinned by the sidecar and kept by both merged waves); the `账号` MAJOR in `mobile.account_routing`, reached independently on the same five keys; `saved` as a same-sentence divergence (this audit upgraded its own NIT to `AR-03` MINOR on that agreement); and the mechanical facts (143/143 keys parse, key parity, zh-CN plural rules, quote handling).
- **Not adopted, with reasons:** (1) `last_turn` → `上一回合` — core's own phrase for *the last turn* is `最后一轮` (`cli.sessions_help.paused`), the exact collocation here; recorded as NIT H-03 instead of MINOR. (2) `tip.schedule` → `定期运行` — `定期` narrows "on a timer" to a repeating cadence and would drop the one-shot case; `按时` keeps it. (3) `tip.search`'s `以` clause — core uses the same purpose clause in short UI copy (`打开扩展弹窗以重新配对浏览器。`), so it is the house voice, not a calque; no finding. (4) `ended_placeholder` — it raised a MINOR; the 200 % measurement in `zh29a3` shows the destination-carrying form clips, so the short form stands.
- It independently verified the repository gate below, and measured the chip row at ~254 pt from `home-copy.ts`'s own note (this audit's ~256 pt nominal agrees within the border).

## Repository gate — verified independently (not a copy finding)

The staged catalogue directory breaks a repository test. `./node_modules/.bin/vitest run src/i18n` → **1 failed | 87 passed**:

```
src/i18n/__tests__/catalogues.test.ts:187
  expect(directories).toEqual([...SHIPPED_LOCALES].sort());
+   "zh-CN"
```

This is the programme's own gate, not a surprise: `docs/i18n.md` says a directory is not activation and *“a translation that lands without passing its audit is a red test rather than a locale that looks shipped.”* The test goes green when the wave flips `SHIPPED_LOCALES` after every group's audit passes — which then requires a measured `SUGGESTION_CHAR_BUDGET["zh-CN"]` entry (the record is `Record<ShippedLocale, number>`, so the flip is a compile error without one). Until then, a branch that commits `src/i18n/catalogues/zh-CN/` carries a red suite; the French and Spanish waves resolved it by flipping inside their own changes. Full output is in `audit.log`. **This is a repository gate, not a translation defect: it changes no copy verdict in this bundle**, and with `mobile.account_routing` still `changes_requested` the wave could not honestly flip yet.

## Context for the manager (not findings — no key is involved)

- `src/features/home/home-splash.tsx:292` still hardcodes the connect row's label as the English literal `label="Connect a computer"` (and `src/features/sessions/conversations-pane.tsx:1141` carries the same literal in another surface). In the no-route state a Chinese reader sees that English string; the catalogue's `connect_disabled_reason` is read by the composer, not by this row. This is a code-side localisation gap on this namespace's own surface — outside a translation audit's authority, unchanged since the Spanish audit flagged the same line, and it will be visible the moment `zh-CN` ships.
- `zh-CN` is still in `NOT_YET_SHIPPED_LOCALES` (`SHIPPED_LOCALES` is `en, fr, es`), so no per-locale budget assertion covers this wave yet. When it flips, `SUGGESTION_CHAR_BUDGET` becomes a compile error until a measured zh budget exists; every chip above is far inside any plausible budget (14 cells max).

## Notes and limits

- No human native-speaker review; **no rendered frame** — the fit statements are executed text metrics (CoreText, system font, CJK = 1 em) plus the repository's own row arithmetic, and no pixel or truncation screenshot is claimed.
- The measurement font is the system UI font, not Figtree, because Figtree is not installed on this machine; the app's own stack falls back to the system font for CJK (`theme.css:169`). For Chinese text the difference is immaterial (every CJK advance in the fallback face is exactly 1 em), but it is disclosed rather than glossed.
- Translator provenance is as supplied by the requesting manager; this auditor did not observe the translator's run.
- `audit_notes_not_execution_log`: the prose in this report and in `record.json` is judgement; `audit.log` holds the actual commands and their actual output.
