# O3-c audit — zh-CN · mobile.sidebar (9 keys)

Auditor: i18n-auditor (team lopdev), session de40a5fa6cff, model anthropic/claude-opus-5-5 (from the session's system prompt; no fallback). Translator session 702e8c7d168e — independent.
Source e7ebc391 · draft sha256 c0196941…5912 (verified) · brief sha256 e88beb09…fd17 (verified). Read route: ordinary file reads + git show; no MT.

**Verdict: changes_requested (1 MAJOR).**

## Mechanical
Repo `parseMessage` (tsx, read-only): params and select arms identical to en for all 9; `kind: approval|other` kept; `{device}` kept; 5/5 negative controls caught. NFC pass, no trailing punctuation, no added separators, redaction markers 0 (brief counted excluding its `redaction_scan.pattern`). Widths all inside hints. `npm run i18n:check` not run (draft outside tree).

## Findings
- **ZH-C1 MAJOR** `row_status.approval` 待批准 → **待审批**. The glossary and style guide fix the noun 'approval(s)' as 审批, and shipped zh-CN uses 审批 for the *state* (需要审批, `lo !`等待审批, 审批已不再待处理). It uses 批准 only for the approve *verb*/button (批准, 批准——有请求等待你处理). The chip names a pending state. The translator's anchor (`owner_only`) is a verb in a list of actions. Same width.
- **ZH-C2 NIT** `row_label.on_device` 在 {device} 上 → 在{device}上. The style guide says no CJK–Latin spacing. This one is spoken only, so it doesn't gate.
- **ZH-C3 NIT** (code, out of scope) the label joins with ASCII `, `. A sibling zh a11y label uses `，`. Recorded only.

## Accepted as is (reasoned)
- question 待回答: better than bare 问题 (also "problem"). Matches 等待回答 in relay.asks.dock.waiting and parallels the chip.
- not_reachable 无法连接, ended 已结束, not_answering 未响应, working 工作中: identical to shipped terms, neutral, not alarming.
- waiting: whole-phrase arms 等待你批准 (verb sense, so 批准 is right here) / 等待你回答问题. Natural, matching 等待你处理.
- open 当前已打开: 当前 avoids reading as the imperative 打开 or as "was opened". Fine for a spoken fragment.
- Label sample: 支付对账, 等待你批准, 在 Studio Mac 上, 无法连接, 当前已打开. Reads correctly.
