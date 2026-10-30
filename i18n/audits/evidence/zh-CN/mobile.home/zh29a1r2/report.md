# Independent Chinese delta audit — `mobile.home` (`zh29a1r2`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 1 MINOR still open (`H-02`), 3 optional NITs carried; unresolved blocker/major count = 0.**
`H-01` (`options.fixed`) is resolved on the shipped bytes at `d3c39d8d2df2bccc78af82df9253776b4c933ad8` and reads naturally; no fix introduced a new problem. `H-02` (`review_repo`) was **not** changed: the shipped value is byte-identical to the round-1 audited value and the required zh-CN guide record still does not exist. Because `H-02` was graded MINOR, it does not close the namespace under this programme's gate rule, but it remains open and is carried, not silently dropped. All 27 English, context and Chinese entries were read and judged key by key.

- **Auditor:** `i18n-auditor` (lopdev team), session `2fdd9a1e0a55`. **Actual model: `radient/auto`.** Fallback trail in this session: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (each a provider-quota HTTP 429 fallback; the two initial read-only survey calls ran under the primary). Every judgement, measurement and bundle in this audit was produced under `radient/auto`. Disclosed, not model-diverse from the translator.
- **Previous round:** `zh29a1` at a57fb8c + the translator's then-uncommitted catalogue, target `24f80843…`; verdict `passed` (2 MINOR, 3 NIT). Bundle: `i18n/audits/evidence/zh-CN/mobile.home/zh29a1/`.
- **Shipped revision:** `d3c39d8d2df2bccc78af82df9253776b4c933ad8`, branch `feat/i18n-chinese`, worktree clean before this bundle. The target bytes are pinned by `input_hashes.target`.
- **Inputs:** en `4ebba126f106bada157ae56ef2a7fedc2b5ee056d01df7dcd9235c75bd68dce3` · context `db18b25dd2099a953b817d151b9605e43f0403b528c36fdadc822cb6c9125f3c` · zh-CN `af7ff4eb76ddaf5d6af4bfd78ddf6646015c49810b4d7375630de0d577cd9c27` (previous zh-CN `24f80843f29ec7687e335f06d412f4add6284f0de837e82e71f741945f5bf033`).
- **Second independent pass:** job `9b2d25113c21` (label `zh-delta-second-pass`), `reviewer` role, session `0a3293bdab48`, actual model `radient/auto` after the same quota descent. It read all 41 delta keys without this auditor's findings and reached the same verdicts. Recorded in `record.json.second_independent_pass`.
- No human native-speaker review and **no rendered frame**. Widths here are Unicode cell arithmetic (CJK and full-width punctuation = 2 cells, typographic quotes = 2, U+2026 = 2), not CoreText.

## Delta result — H-01 changed, H-02 did not

| Finding | Round-1 text | Shipped text | Verdict |
|---|---|---|---|
| `H-01` | `此对话的起始选项已固定。实时控制项请在“对话详情”中查看。` | **`此对话的起始选项已固定。实时控制项可在“对话详情”中调整。`** | resolved |
| `H-02` | `审查此仓库` | `审查此仓库` (byte-identical) | **open, MINOR** |

- **Proof the delta is exactly H-01:** putting the round-1 `options.fixed` value back into the shipped JSON and serialising it the way the repository does yields sha256 **`24f80843f29ec7687e335f06d412f4add6284f0de837e82e71f741945f5bf033`**, the round-1 target hash. Every other value, including `review_repo`, is byte-identical to the round-1 bytes. Executed; output in `audit.log`.
- The premise that both round-1 minors were changed is not borne out by the bytes: only `options.fixed` changed. The home copy still ships `审查此仓库`.

## Finding disposition

### H-01 — resolved (was MINOR — `options.fixed` guide voice + framing)

- **Shipped:** `此对话的起始选项已固定。实时控制项可在“对话详情”中调整。` — exactly the round-1 suggested replacement.
- **Does it read naturally?** Yes. Two sentences, 你-free and 请-free, as the guide requires; `此对话的起始选项已固定。` states the fixed state, and `实时控制项可在“对话详情”中调整。` is an actionable pointer, not the round-1 `请在…中查看` that narrowed live controls to viewing. `调整` matches what the details screen does (the live model/approval controls).
- **Destination name still byte-identical:** `mobile.session.conversation_details` = **`对话详情`**, four code points **对 U+5BF9, 话 U+8BDD, 详 U+8BE6, 情 U+60C5**. `options.fixed` contains `“对话详情”` (U+201C + those four + U+201D). Substring test `true`.
- **No new problem:** the sentence is 29 characters / 58 cells both before and after the fix — width-neutral — so the change cannot create a new truncation risk. No placeholder, punctuation, register or polarity change. The quotation marks are balanced and the final full stop is present.

### H-02 — still open (MINOR — `review_repo` unrecorded kept-English deviation)

- **Current:** `审查此仓库` · **English:** "Review this repo" · **Sidecar:** *"'repo' is developer vocabulary kept as-is."*
- **Problem:** the copy is natural, idiomatic Chinese — `仓库` is the settled word for a Git repository and core itself uses it in prose (`cli.update_help.from_snapshot`, `wire.remote_compute.bad_repo`, `wire.settings…github_repositories.label`). Both merged waves kept it Latin (fr `Examinez ce repo`, es `Revisa este repo`), and the key's own context note pins it. Round 1 offered two closing routes: keep `审查此仓库` **and record** "repo → 仓库" as a zh-CN per-locale decision in the core guide `i18n/style-guides/zh-CN.md`, or switch the value to `审查此repo`. Neither was done: the shipped value is unchanged, and the guide has no `repo`/`仓库` line (last touched `ad1de332210`, identical to `origin/main`), while the glossary requires a per-locale kept-English exception to be recorded in that guide.
- **Suggested:** keep **`审查此仓库`** and add one line to the core zh-CN guide's kept-English/decision area: *"repo → zh-CN translates to 仓库 — recorded deliberate override of the per-key sidecar's kept-English note; 仓库 is the settled Chinese word for a Git repository."* If strict fr/es parity is preferred instead, the exact replacement is **`审查此repo`**. Either closes it; leaving it unrecorded does not.
- **Severity:** MINOR. It is a decision-record gap, not a comprehension or safety defect; it gates nothing. If the decision exists only in the PR thread, it is still absent from the repository bytes this audit can read.

**Carried NITs (unchanged, optional, not re-graded as new):** `H-03` `看看上一轮` vs the wave's `回合` (core uses `最后一轮` for this exact collocation) · `H-04` `重试以发送排队消息` → optional `重试发送排队消息` · `H-05` `要求并行工作以展开多个子智能体` — `展开` for fan-out; `分出` clearer.

**No new findings in this namespace.** All 27 values preserve meaning, polarity and safety: `queue.discard` is clearly destructive and distinct from `queue.restore`; `refused_start_fallback` states the missing folder without blaming the reader; `startup_queue.blocked` remains an instruction to retry, never a claim that sending is under way; `startup_queue.unconfirmed` never implies anything is waiting; `startup_queue.sending` and `starting` keep their ellipses. The second pass independently reached the same conclusion and raised no new problem.

## Test (a) — the destination name is byte-identical

`mobile.session.conversation_details` = **`对话详情`** (U+5BF9 U+5BDD U+8BE6 U+60C5). The shipped `mobile.home.options.fixed` contains that exact four-code-point run, delimited by U+201C/U+201D: `…可在“对话详情”中调整。`. Substring test executed, result `true`. The label is read from the catalogue at the control (`startup-transcript.tsx:52` calls `t("mobile.session.conversation_details")`), so the reader sees the same four characters on the sheet and in the sentence. The quotation marks are typographic delimitation of a UI name, mainland practice, and do not change the name.

## Per-key judgement

| Key | Role | Verdict |
|---|---|---|
| `connect_disabled_reason` | status | clean — `连接电脑后才能发送。` names the prerequisite; short in the slot it shares with the connect action. |
| `folders_read_failed` | status | clean — `刚才无法读取此电脑的文件夹。` keeps "just now" and appends no error code. |
| `greeting` | heading | clean — `今天想让我帮你做点什么？` idiomatic, 你, one question. |
| `options.apply` | button | clean — `使用这些选项`, no final full stop. |
| `options.fixed` | help | **H-01 resolved** — `此对话的起始选项已固定。实时控制项可在“对话详情”中调整。` actionable, 请-free, destination byte-identical, width-neutral at 58 cells. |
| `options.folder` | meta | clean — `此电脑上的文件夹` places the folder on the connected computer. |
| `options.title` | heading | clean — `对话选项`; conversation → 对话, the wave's split. |
| `queue.discard` | button | clean — `丢弃排队消息` destructive and distinct from the move-to-draft button. |
| `queue.restore` | button | clean — `将排队消息移到草稿` restores into the composer; no final full stop. |
| `queue.sheet_title` | heading | clean — `排队消息`, the same noun phrase as the button that opens it. |
| `queue.view` | button | clean — `查看排队消息`. |
| `refused_start_fallback` | status | clean — `此电脑上没有该文件夹。` states the missing folder without blaming the reader. |
| `starting` | status | clean — `正在启动……`, one short line, U+2026 twice. |
| `startup_queue.blocked` | status | **H-04 NIT (carried)** — `重试以发送排队消息` is an instruction to retry, never a claim that sending is under way. |
| `startup_queue.not_started` | status | clean — `未启动`, two characters beside the queued-messages button. |
| `startup_queue.sending` | status | clean — `正在发送排队消息……` continuous, ellipsis kept, count not repeated. |
| `startup_queue.unconfirmed` | status | clean — `启动未确认` names the state, implies nothing waiting. |
| `suggestion.last_turn` | button | **H-03 NIT (carried)** — `看看上一轮` imperative and idiomatic; “turn” word recorded for consistency only. |
| `suggestion.linear_mcp` | button | clean — `Linear MCP` byte-identical, no final full stop. |
| `suggestion.phone_access` | button | clean — `开启手机访问`. |
| `suggestion.review_repo` | button | **H-02 MINOR (open)** — `审查此仓库`; copy sound, required guide record missing. |
| `suggestion.team_of_agents` | button | clean — `创建智能体团队`; only this chip creates an agent. |
| `suggestion.wake_summary` | button | clean — `用摘要唤醒我`, glossary `唤醒`. |
| `tip.parallel` | help | **H-05 NIT (carried)** — `要求并行工作以展开多个子智能体`; `展开` for fan-out. |
| `tip.schedule` | help | clean — `设置定时任务按时运行提示词`. |
| `tip.search` | help | clean — `搜索过往对话以重新打开会话`. |
| `transcript.waiting` | status | clean — `正在等待对话……`, ellipsis kept. |

## Mechanical result

- `node scripts/i18n/generate.ts --check` → **`src/i18n/catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr, zh-CN)`**, exit 0.
- `node scripts/i18n/check-strings.ts` → **`check-strings: 284 finding(s), all baselined; 0 new; no growth vs a57fb8cbe161`**, exit 0.
- Affected tests: `./node_modules/.bin/vitest run src/features/home/home-copy.test.ts src/i18n/__tests__/catalogues.test.ts src/i18n/__tests__/runtime.test.ts` → **3 files passed, 78 tests passed**. Because zh-CN is now shipped, the chip test enforces `SUGGESTION_CHAR_BUDGET["zh-CN"] = 14` against the actual pool; the longest zh chip is 12 characters (`设置Linear MCP`), so it passes.
- JSON valid; keys exactly **27/27/27** (en / zh-CN / context); no key added, dropped or reordered. Parsed through the app's own parser: **27/27**, **0 keys with params** — no placeholders, ICU structures or markup to preserve.
- No bidi/control (`Cc`/`Cf`) characters; no ASCII punctuation in prose; all full stops U+3002; quotes U+201C/U+201D balanced; no `请`, `您` or `！`; no CJK–Latin spaces (guide-compliant `设置Linear MCP`).
- Ellipses: `starting`, `startup_queue.sending`, `transcript.waiting` — each exactly two U+2026 and final.
- Fit against the context hints: every suggestion chip ≤ 12 characters (source hint 24; shipped zh budget 14) and every tip ≤ 15 characters (hint 48). `options.fixed` is the longest value at 29 characters / 58 cells, a wrapping help sentence with no `maxCells` hint and the same 58 cells before and after the fix. No fit risk; no rendered frame is claimed.

## Second independent pass (reconciled)

Reviewer job `9b2d25113c21` (`radient/auto`) read both namespaces independently and reached the same result: H-01 resolved; **H-02 still open** because the sidecar's kept-English note was not honoured and no guide record exists; no fix introduced a new problem; `mobile.home` passed with one carried MINOR under the no-blocker/major gate. It independently verified the 41/41 values, the 27/27/27 key set, the destination code points, the absence of 请/您/！, balanced quotes, doubled ellipses, and the chip widths. No reconciliation difference exists.

## Notes and limits

- No human native-speaker review; **no rendered frame**. Width statements are Unicode cell arithmetic, not CoreText; the only changed value is width-neutral against round 1 (58 cells both), so no new clipping risk is introduced.
- The H-02 guide record was checked against the repository bytes, not recall: `~/local-operator/i18n/style-guides/zh-CN.md` has no `repo` or `仓库` line, its last commit is `ad1de332210`, and it is identical to `origin/main`.
- Translator provenance is as supplied by the requesting manager; the run was not observed by this auditor.
- This repository has no i18n ledger and no audit-ledger command (verified: `package.json` scripts, `scripts/i18n/`, `docs/i18n.md`); the bundle is the durable record and a proposed ledger row is recorded in `record.json.ledger`.
- `audit_notes_not_execution_log`: this report is judgement; `audit.log` holds the actual commands and their actual output.
