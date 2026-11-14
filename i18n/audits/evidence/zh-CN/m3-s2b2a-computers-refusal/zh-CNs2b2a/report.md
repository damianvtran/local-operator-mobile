# zh-CN audit — m3-s2b2a-computers-refusal (24 keys)

Verdict: **changes_requested** — 0 BLOCKER, 2 MAJOR, 2 MINOR, 2 NIT.
Auditor: i18n-auditor, session e1685cdf64ae, model anthropic/claude-opus-5-5 (no fallback). Translator job 67e397a5ab7f.
Brief sha256 d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40; draft sha256 04cc9ee2e3237467c9e542bf708820196bfd8a8308e3172f6592cff790f57bdd. Redaction markers: brief 0, draft 0.

## Mechanical
All 24 keys present, no extras; placeholders identical (parsed with repo messages.ts); zh CLDR categories = [other], wait_seconds has `other {# 秒}`; no bidi controls; NFC. Pass.

## Findings
### F1 MAJOR — `mobile.computers.refusal.tunnel_gone_title`
- Current: `{subject}已不再是隧道。`
- Problem: Calque of "is no longer a tunnel"; in Chinese an address (or a computer name, which {subject} may also be) "已不再是隧道" reads as if the thing changed type. The note gives the meaning: the address no longer belongs to any tunnel (deleted/replaced). Rules on the translator's open question.
- Suggested: `{subject}已不再对应任何隧道。`

### F2 MAJOR — `mobile.computers.refusal.sign_in_title`
- Current: `你的Radient会话已过期。请登录以重新连接到{subject}。`
- Problem: Terminology collision: 会话 is the zh-CN catalogue's term for agent sessions (51 occurrences across 12 namespaces, all agent sessions, e.g. "# 个会话正在运行", "返回会话列表"). On this screen a reader can take "会话已过期" as their agent session being lost. The source means the Radient sign-in expired.
- Suggested: `你的Radient登录已过期。请登录以重新连接到{subject}。`

### F3 MINOR — `mobile.computers.refusal.offline_next`
- Current: `请唤醒那台电脑，并确认连接器正在运行。其最后已知状态显示在上方。`
- Problem: "其最后已知状态显示在上方" is stiff written register (其 + literal word order); the rest of the screen uses plain 它.
- Suggested: `请唤醒那台电脑，并确认连接器正在运行。上方显示的是它最后已知的状态。`

### F4 MINOR — `mobile.computers.refusal.console_next`
- Current: `请打开Radient控制台进行处理。在此手机上登录无法解决这个问题。`
- Problem: Note: re-signing in on the phone does not help, say so plainly. "在此手机上登录" loses "again" and reads as if signing in were the action just offered; 重新…也 states the futility plainly.
- Suggested: `请打开Radient控制台进行处理。在此手机上重新登录也无法解决这个问题。`

### F5 NIT — `mobile.computers.refusal.relay_stopped_title`
- Current: `{subject}上的中继未在运行。`
- Problem: "未在运行" is slightly stiff; 没有运行 is the natural spoken-product form and matches 没有响应 in offline_title.
- Suggested: `{subject}上的中继没有运行。`

### F6 NIT — `mobile.computers.refusal.another_address`
- Current: `使用其他地址`
- Problem: The button switches away from the failed address; 改用 says "use instead" and matches the catalogue's "改用我自己的隧道".
- Suggested: `改用其他地址`

## Rulings on translator questions
- **tunnel_gone_title**: 已不再对应任何隧道 (see F1); 已不再是隧道 is a calque.
- **try_again**: 重试 accepted. English labels are identical too; the screen context disambiguates, password_next ("然后重试") points at this button, and the diagnostic kind on the same surface shows mobile.computers.retry=重试, so a different label would split one action into two words.
- **connector_连接器**: Accepted. grep of all zh-CN catalogues: 0 prior hits for 连接器, so no collision; it is the standard zh term for a tunnel connector program and reads naturally next to 中继/隧道.
- **spacing**: Unspaced is correct: Han<->Latin/digit/brace adjacency in zh-CN mobile.computers.json is 64 unspaced vs 12 spaced; across all zh-CN mobile.* 205 vs 71. wait_seconds "# 秒" keeps the space exactly like own_tunnel.verdict_timeout, consistent; no finding.

## Keys judged clean
offline_title, console_title, password_title, retry_title, certificate_title, host_title, relay_stopped_next, tunnel_gone_next, password_next, sign_in_next (隔离 keeps the not-sent promise, not softened), retry_next (no auto-retry promise), certificate_next (matches verdict_tls), host_next, wait_seconds, try_now, try_again, sign_in_again, open_console. Buttons 2–12 chars, no overflow risk.
