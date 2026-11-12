# M2 audit — zh-CN, lane B (round 1)
Auditor: i18n-auditor (lane B), model anthropic/claude-sonnet-5-5 (actual served). Candidate: m2-prep/zh-CN.v1.json (27 keys). Read-only; no repo/ledger edits.

## Mechanical (python, run here)
- Key set + order == keys27.json: yes (27/27). Valid JSON, NFC, no empties, no stray whitespace.
- Placeholders identical to source for all keys ({baseUrl}, {host}, {percent}x4, {labels}, {name}); no ICU plural/select needed.
- Glyph parity (↑ ↓ · %) with source: all keys match. English-identical: only mobile.settings.account.app_name = "Local Operator" (deliberate). Radient kept in Latin.
- Wiring checked via git show on feat/i18n-app-scan-expression-literals (settings.tsx, computers.tsx, session/[id].tsx): all 27 keys are consumed as the notes describe.

## Terminology recount vs shipped zh-CN catalogue (grep, not claims)
- 在线 (live) = relay.health.live; 空闲 (idle) = relay.chrome...idle; 未响应 (not answering) = relay.chrome...not_answering; 连接中 = mobile.computers.badge.connecting. Candidate stays consistent.
- 电脑 is the shipped noun throughout (dozens of uses); candidate uses it everywhere. One pre-existing outlier "计算机" in shipped mobile.computers.connect_refused.generic (not this slice; mention to manager).
- 会话 per style guide; 隧道 / 连接路径 match M1 (route_radient, diagnostics.route). Style-guide register (你, no sentence-final 。 on labels, full sentences keep 。) respected: host_answering/answering/connected_to end in 。, pills do not.

## Findings
No BLOCKER, no MAJOR.

MINOR-1  mobile.computers.wait.host_answering (also mobile.settings.account.route_direct)
 current: 正在等待位于{host}的电脑响应。… / 已直连{baseUrl}
 problem: a host name/URL abuts CJK with no boundary. "example.com的电脑" runs the Latin token straight into 的, and phone link-detection / a reader's eye can fold "的" into the hostname. The style guide says no space, but the shipped catalogue itself already spaces placeholders (mobile.chrome.home.connecting "正在连接 {host}…", reconnecting likewise, "返回 Local Operator"), so a spaced form is established precedent for host tokens.
 suggested: 正在等待 {host} 上的电脑响应。连接路径已配置，不代表电脑正在运行。 and 已直连 {baseUrl}. (Judge call: if the manager prefers strict no-space, keep as is; the second sentence is fine either way.)

MINOR-2  mobile.session.region.below_labels — cross-lane/wiring note, not a translation defect
 current: {labels}在下方 · 向下滚动 ↓
 problem: hiddenRegionLabels comes from a hard-coded English map (activity/agents/tasks/status in session/[id].tsx ~L1100), so zh renders "tasks · status在下方 · …" — English words glued to 在下方 with no space and not localised. The 27-key translation cannot fix this. Either localise REGION_LABEL (new keys) or accept a spaced form "{labels} 在下方 · 向下滚动 ↓" for the interim. Recommend manager records the English-label gap as a known limitation for all locales.

NIT-1  mobile.session.region.more_below
 current: 下方还有更多 · 向下滚动 ↓ — "更多" with no noun is slightly bare; 下方还有内容 · 向下滚动 ↓ reads more naturally (same width). Acceptable as is.

NIT-2  mobile.settings.diagnostics.stream_degraded
 current: 未响应 — faithful to the sidecar ("open but not answering") and consistent with relay's 未响应, but identical to status.not_answering, so the Diagnostics row loses the English enum distinction (degraded vs a separate state). If a diagnostic-enum feel is wanted: 响应异常. Keeping 未响应 is defensible for consistency; not a defect.

## Checked and fine
- connected_to + fallback_name: "已连接到{name}。" with 你的电脑 → "已连接到你的电脑。" natural; with a Latin computer name "已连接到MacBook Pro。" acceptable. No case/article issue in zh.
- tray: 上下文{percent}% and short forms identical on purpose (already 3 CJK chars ≈ 6 cells + %, no narrower idiom than 上下文; "ctx" has no zh abbreviation). （估算）full-width parens is the zh convention; source asks to "keep the parentheses" — satisfied. Width ~ 18 cells max for "上下文100%（估算）", fits a tray.
- region cues: 已到底部 · 向上滚动 ↑ and 下方还有更多 · 向下滚动 ↓ keep the middle dot and arrows, terse.
- Status pills: 尚未连接 / 未连接 / 离线 / 未响应 / 已连接 distinct and short; 尚未连接 (never chosen) vs 未连接 (refused) preserves the nuance. Diagnostics words 空闲/连接中/在线/未响应/离线 are 2–3 chars each.
- not_signed_in 未登录Radient账户 / route_radient 通过你的Radient隧道 — meaning preserved, no stray particle, Latin brand intact. (Shipped has both "Radient账户" and "Radient 账户" spellings; candidate follows guide + M1.)
- computers.wait.host_answering second sentence: "provisioned route ≠ machine up" → "连接路径已配置，不代表电脑正在运行" accurate.
- video 视频, session 会话: bare nouns, OK.

## Verdict: clean-with-findings (0 BLOCKER, 0 MAJOR, 2 MINOR, 2 NIT). Passable as is; MINOR-1 is the only suggested wording change.
