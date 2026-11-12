# zh-CN M2 round-3 delta audit (m2-a3)
Auditor i18n-auditor, independent of translator; served model: anthropic/claude-sonnet-5-5 (session header, no fallback observed). Session 4cc8e99d0283.
Inputs: m2-prep/zh-CN.final.json sha256 14902070cb57b05d0cf776adabe1a3d74198391c837eb7be91b85633faaba739 (== zh-CN.v4.json); v3 sha256 31d8f924cdab0822cd1dde7dfab2f59b8900860d70e111e9ec17ffb1e5b97cfa; keys33.final.json (33).

## 1 Diff v3 -> final (python): exactly 6 entries differ; the other 27 identical, same order
- tray.context_short: ctx{percent}% -> 上下文{percent}%
- tray.context_short_estimate: ctx{percent}%（约） -> 上下文{percent}%（约）
- region.label.working '活动' -> region.label_working '动态'; label.subagents/todos/strip -> label_subagents/label_todos/label_strip (values 子智能体/任务/状态 unchanged)

## 2 Changed values vs shipped usage (recounted: mobile i18n-app-scan zh-CN 839 strings; core 3219)
- 上下文: mobile 2, core 25; ctx: 0/0. Full word is what the sidecar prescribes when no native short form exists.
- Cells (2 per CJK/full-width): context_short 上下文21% = 9 (== wide 9, no saving but none needed; 5 inside the 14-cell D17 fit anchor). context_short_estimate 上下文21%（约） = 15 vs wide （估算） 17: 2 narrower. At 100%: 16 vs 18; at 0%: 14 vs 16.
- Stream words 空闲/连接中/在线/未响应/离线: distinct, unchanged.
- 动态: natural noun for an activity feed; reads in 动态在下方 · 向下滚动 ↓ and in joined lists. Shipped 动态: core 1 (动态光泽, adjective), mobile 0 — no conflict. Shipped 活动 means "active" / "last-activity time" (core 12, mobile 1), so 动态 is the better noun. 4 cells either way.

## 3 Mechanical (executed, 33 keys)
Order == keys33.final order; no missing/extra; placeholders per key equal English and sidecar list; no empties; all NFC; no ICU plural/select; region keys use underscore names (code 9d99fa0f [id].tsx map, per R2 and translator note; I did not re-read that branch).

## 4 Round-2 items
- BLOCKER-1 region key names: RESOLVED.
- MAJOR-1 context_short: RESOLVED.
- MINOR-1 context_short_estimate: RESOLVED (the wording R2 proposed, 15 cells).
- MINOR-2 label_working: RESOLVED (动态).
- NIT-1 stale sidecar note on fallback_name: source-side, carried, not a candidate defect.

## Findings
- MINOR-A (unproven fit, non-gating): narrow estimate = 15 cells at 2 digits, 16 at 100%; proven anchors are 14 fits / 18 wraps (from the D17 code comment; not measured here). One rendered <340 pt frame with cost chip + subagents chip would confirm.
- NIT-A: context_short is now byte-identical to context in zh (no saving for the plain fact). Acceptable; note it in the ledger so it is not read as an omission.
- NIT-B: （约） has no shipped precedent as an estimate marker (core 约 = "about"); wide form uses 估算. Meaning correct; 估算 would be +2 cells (17), rejected on fit. Keep.

No BLOCKER, no MAJOR. Limits: no rendering; cell counts are arithmetic; repo validator not run (candidate unintegrated); no repo/ledger/candidate edits; no ledger row written.
Verdict: CLEAN-WITH-FINDINGS (0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT) -> ledger `passed` once integrated.
