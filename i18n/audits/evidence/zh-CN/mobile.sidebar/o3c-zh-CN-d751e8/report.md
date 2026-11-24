# O3-c audit — zh-CN · mobile.sidebar (9 keys) · revision 2

Auditor: i18n-auditor (team lopdev), session d751e813fdef, model anthropic/claude-opus-5-5. The model comes from the session's system prompt; no fallback. The translator was session 6323bd03d1a2, so this audit is independent of the translator and of the prior auditor (de40a5).
Supersedes **o3c-zh-CN-de40a5** (failed: ZH-C1 MAJOR). Source e7ebc391. Draft sha256 e203a3c0…edbf and brief sha256 e88beb09…fd17 both verified. Read route: ordinary file reads; no MT service. All 9 keys were re-audited from scratch.

**Verdict: passed (0 BLOCKER/MAJOR; 4 NIT).**

## Mechanical
The checker ran the repo's `parseMessage`/`formatMessage` through the worktree's tsx (read-only):
- Params and select arms match en on 9/9 keys. `kind: approval|other` is kept, and an unknown kind falls to `other`. `{device}` is kept.
- 5/5 negative controls were caught.
- Text: NFC; no trailing punctuation; no leading or trailing spaces.
- 0 redaction markers in the draft, en and context. The brief also shows 0 once its `redaction_scan.pattern` field is excluded.
- The 9 keys don't overlap the shipped zh-CN mobile.sidebar (42 keys).
- Every string is within its width hint.

`npm run i18n:check` was not run, because the draft sits outside the catalogue tree.

## Per key
- row_status.approval **待审批**: ZH-C1 is resolved. 审批 is the glossary/style-guide noun for approvals (style guide :29) and the shipped word for the state (需要审批, 等待审批). The 待- prefix marks it as pending. 3ch.
- row_status.question **待回答**: 问题 on its own also means "problem", so this avoids an error reading. It pairs with 待审批 and matches 等待回答 (relay.asks.dock.waiting).
- not_reachable **无法连接** / ended **已结束** / not_answering **未响应** / working **工作中**: reused from shipped terms; neutral, not alarming.
- row_label.waiting: 等待你批准 / 等待你回答问题. Each arm is a whole phrase, as the brief asks. 批准 is right here: it is the verb ("for you to approve"), just as the button relay.asks.pending.approve uses 批准. Splitting chip noun and spoken verb matches the corpus, and the two strings never render together, because the label carries the waiting fragment instead of the chip word. Register (你) matches 等待你处理.
- on_device **在{device}上**: ZH-C2 is resolved. There is no CJK–Latin spacing (style guide :67), which matches the computers and refusal families.
- open **当前已打开**: 当前 marks this as the conversation on screen now, and avoids the imperative reading.
- Assembled label sample: 支付对账, 等待你批准, 在Studio Mac上, 无法连接, 当前已打开. It reads naturally.

## Findings (none gate)
- **ZH-R2-N1 NIT** (note) The question note still says "parallels 待批准". It should say 待审批.
- **ZH-R2-N2 NIT** (note) The on_device note calls subtitle_owner "the outlier", but the corpus is split: 8 unspaced keys (computers/refusal) vs 7 spaced (remote_sessions {owner} family). The value follows the style guide. The spaced family is pre-existing drift.
- **ZH-R2-N3 NIT** (note) The open note cites relay.chrome.drawer.open as a bare 打开, but it is actually 打开导航. The reasoning still stands.
- **ZH-R2-N4 NIT** (code, carried from ZH-C3) list-row-meta.ts:505 joins fragments with ASCII `, `. A future keyed separator could give `，`. Recorded only.

## Ledger
Not appended. This bundle is in the auditor's scratchpad; the manager or the landing commit records the ledger row and the tracked evidence path.
