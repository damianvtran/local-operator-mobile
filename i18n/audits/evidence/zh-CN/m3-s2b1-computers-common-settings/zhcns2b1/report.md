# zh-CN — M3 S2b-1 (mobile.computers + mobile.common + mobile.settings, 41 keys) — independent translation audit `zhcns2b1`

**Verdict: PASS (`passed`).** There are 0 BLOCKER and 0 MAJOR findings, plus 4 MINOR and 2 NIT. One SOURCE finding concerns the English, not the translation.

- **Auditor:** i18n-auditor (lopdev), session a0c991a5009f. **Model (actual):** anthropic/claude-opus-5-5, read from the session header. No fallback was used.
- **Translator:** translator job 3ceed9e5fc3c. The auditor is independent of it.
- **Source commit:** ce336e4a.
- **Brief sha256:** d46b2d448e668e778935279b3d9ec2cae4552c2fa74da49f3255852f087dc4df. Recomputed; it matches.
- **Draft sha256:** 83f029af21948f4c18c165e1470d6dc28e1c876bf7652042a1d80dd0f031afe8. Recomputed; it matches.
- **Read route:** ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
- **Translation tools:** no MT service, API or SDK was used.

## Mechanical — PASS
- **parse:** 41/41 en and zh parse with repo parseMessage; formatMessage renders all with sample args under zh-CN
- **placeholders:** names and kinds identical to English for every key
- **plurals:** verdict_sessions and verdict_timeout use other-only with #; zh-CN CLDR yields only 'other' (checked 0,1,2,10)
- **negative_controls:** unterminated plural, plural option without braces and unbalanced brace all throw RangeError
- **brief_vs_en_catalogue:** all 41 equal at ce336e4a
- **keys:** 41 = brief order; none added, dropped or already shipped in zh-CN
- **punctuation:** no half-width punctuation adjacent to CJK, no CJK–Latin spaces, curly quotes only
- **bidi_controls:** 0
- **tokens:** lop/macOS/Cloudflare/ngrok/HTTPS/URL/Local Operator/shell untouched; commands are placeholders
- **width:** no maxCells/maxChars in the brief; every button, heading and status is shorter than the English (max 10 CJK chars, runtime_title)

## Findings

### ZHS2B1-01 — MINOR — `mobile.computers.own_tunnel.verdict_local_network`
- Current: 此网络中该地址没有任何响应。检查电脑是否未休眠且正在运行中继，然后轻点“{action}”。
- Problem: This key is shown on Android and the web (the iOS variant is a separate key). 轻点 is Apple's iOS verb; Android zh-CN uses 点按 and the web uses 点击, so the copy names the wrong platform's gesture.
- Suggested: 此网络中该地址没有任何响应。检查电脑是否未休眠且正在运行中继，然后点按“{action}”。

### ZHS2B1-02 — MINOR — `mobile.computers.own_tunnel.check_note`
- Current: 运行状况、身份验证门禁的状态，以及手机将看到的会话。
- Problem: 门禁 is a physical access-control gate, so 身份验证门禁 is a calque of 'auth gate' that reads oddly in software copy. The note defines it as the password check in front of the relay.
- Suggested: 运行状况、密码验证的状态，以及手机将看到的会话。

### ZHS2B1-03 — MINOR — `mobile.computers.own_tunnel.install_note`
- Current: macOS：写入可自动重启的守护进程，生成中继密码并存入你的钥匙串。
- Problem: 写入…守护进程 is a literal rendering of 'writes the daemon'. Chinese installs or configures a daemon; it does not write one. 你的钥匙串 also breaks the style guide's pronoun-drop rule. The 中继密码 choice is correct (see the ruling).
- Suggested: macOS：安装可自动重启的守护进程，生成中继密码并存入钥匙串。

### ZHS2B1-04 — MINOR — `mobile.computers.own_tunnel.verdict_forbidden + verdict_tls`
- Current: …请放行本应用…请确保… / 请使用…请替换…
- Problem: The zh-CN style guide uses 请 only where the English says please (blocking dialogs). These two verdicts add 请 while their sibling verdicts (host, unreachable, timeout, local_network, password) do not, so the same failure box shifts register. The meaning is correct.
- Suggested: verdict_forbidden: …需放行本应用；中继本身也会拒绝来源不符的请求，因此须确保隧道直接转发到{address}，而不是转发到某个控制面板或其他应用。 verdict_tls: …改用隧道输出的{scheme}地址，或换用证书能被手机信任的隧道；如果隧道由你自己运行，则替换其自签名证书——应用不会跳过证书校验。

### ZHS2B1-05 — NIT — `verdict_timeout, verdict_local_network_ios, verdict_local_network`
- Current: 检查…电脑是否未休眠
- Problem: 是否未休眠 is a double negative ('whether it is not asleep') and is slightly clumsy.
- Suggested: 检查…电脑是否处于唤醒状态

### ZHS2B1-06 — NIT — `mobile.computers.own_tunnel.verdict_password`
- Current: 密码未被接受。检查电脑上设置的中继密码。
- Problem: 未被接受 is a passive calque. 被拒绝 is the natural verb and matches 证书被拒绝 in verdict_tls.
- Suggested: 密码被拒绝。检查电脑上设置的中继密码。

## SOURCE findings (the English, not the translation)

### ZHS2B1-S1 — MINOR — src/i18n/catalogues/en/mobile.computers.json:126 (call site src/features/auth/tunnel-verdict.ts:133; text originates d1fd63d3)
- 'the relay itself also refuses requests it did not come from' is garbled: 'it' has no sensible referent. The relay's real behaviour (~/local-operator local_operator/mobile/daemon.py:5698-5715, cross_origin_mutation) is a same-origin check that returns 403 'same-origin request required'. The translator's 来源不符的请求 carries the intended meaning, so this is not a translation fault.
- Suggested English: …the relay itself also refuses requests from any other origin, so make sure the tunnel forwards straight to {address} rather than to a dashboard or another app.

## Rulings on the translator's uncertain keys
- **verdict_forbidden:** ACCEPT 来源不符的请求: it renders the intended same-origin rule faithfully. The English source is defective; see ZHS2B1-S1. The 请 register is covered by ZHS2B1-04.
- **install_note:** ACCEPT 'portal password' → 中继密码. It is the same secret the screen's password field labels 中继密码 (own_tunnel.password_label) and the one rotate_note says the app asks for. 'Portal password' is the daemon CLI's own wording (tunnel-commands.ts:7-8), so its English output will still say 'portal password'. A second Chinese term would add confusion, not clarity.
- **verdict_offline_detail:** ACCEPT {detail}。. The 。 is the Chinese message's own sentence separator, which the note asks to be localized, and {detail} carries no final stop. A half-width '. ' would put Latin punctuation and a space before CJK, against the style guide's punctuation and no-space rules. The rendered result is 'Tunnel temporarily unavailable。在该电脑上运行：lop mobile status'.

## Cross-locale traps
- **Loopback:** foreground_note says 只接受来自本机的连接 (only connections from this machine are accepted). That means same machine only, and it matches step_computer_help.
- **Exposure and TLS:** verdict_tls keeps the strong wording 应用不会跳过证书校验 (the app will not skip the certificate check). No key nudges the reader toward http or toward skipping a check.
- **Remove dialog:** remove_body states the scope correctly — it affects this phone only, not the computer, the tunnel or any account.
- **Pronouns:** 你 is used consistently; no key uses 您.

## Per-key
- `mobile.computers.own_tunnel.install_label` — ok: 在电脑上安装
- `mobile.computers.own_tunnel.foreground_label` — ok: 或在前台运行
- `mobile.computers.own_tunnel.check_label` — ok: 检查状态
- `mobile.computers.own_tunnel.rotate_label` — ok: 设置或更换密码
- `mobile.computers.own_tunnel.install_note` — ok_with_findings (ZHS2B1-03): macOS：写入可自动重启的守护进程，生成中继密码并存入你的钥匙串。
- `mobile.computers.own_tunnel.foreground_note` — ok: 适用于其他任何平台，或你更想直接查看日志时。它在{address}上提供服务，只接受来自本机的连接。
- `mobile.computers.own_tunnel.check_note` — ok_with_findings (ZHS2B1-02): 运行状况、身份验证门禁的状态，以及手机将看到的会话。
- `mobile.computers.own_tunnel.rotate_note` — ok: 以交互方式询问密码，因此它绝不会出现在shell历史记录或进程列表中。应用在下方要求输入的就是这个密码。
- `mobile.computers.own_tunnel.cloudflare_note` — ok: 免费，使用快速隧道无需账户。它会输出一个{scheme}URL，将其粘贴到下方。
- `mobile.computers.own_tunnel.ngrok_note` — ok: 需要ngrok账户。它会输出一个{scheme}URL，将其粘贴到下方。
- `mobile.computers.own_tunnel.tunnel_rule` — ok: 任何隧道都可以，只要它能将公网HTTPS URL转发到那台电脑上的{address}。
- `mobile.computers.own_tunnel.verdict_sessions` — ok: 已连接——可以看到{sessions, plural, other {# 个会话}}。
- `mobile.computers.own_tunnel.verdict_password` — ok_with_findings (ZHS2B1-06): 密码未被接受。检查电脑上设置的中继密码。
- `mobile.computers.own_tunnel.verdict_forbidden` — ok_with_findings (ZHS2B1-04, ZHS2B1-S1(source)): 该隧道拒绝了本应用。如果你在隧道前设置了访问策略或登录页面，请放行本应用；中继本身也会拒绝来源不符的请求，因此请确保隧道直接转发到{address}，而不是转发到某个控制面板或其他应用。
- `mobile.computers.own_tunnel.verdict_offline_detail` — ok: {detail}。在该电脑上运行：{command}
- `mobile.computers.own_tunnel.verdict_offline` — ok: 隧道有响应，但其后的中继没有响应。在该电脑上运行：{command}
- `mobile.computers.own_tunnel.verdict_tls` — ok_with_findings (ZHS2B1-04): 该隧道的证书被拒绝。请使用隧道输出的{scheme}地址，或改用证书能被手机信任的隧道；如果隧道由你自己运行，请替换其自签名证书——应用不会跳过证书校验。
- `mobile.computers.own_tunnel.verdict_host` — ok: 找不到该主机名。检查地址是否有拼写错误，以及隧道是否仍在发布该名称。
- `mobile.computers.own_tunnel.verdict_unreachable` — ok: 无法访问该地址。检查URL是否为隧道输出的公网地址，以及隧道是否仍在运行。
- `mobile.computers.own_tunnel.verdict_timeout` — ok_with_findings (ZHS2B1-05): 该地址在{seconds, plural, other {# 秒}}内没有响应。检查隧道是否正在运行，以及电脑是否未休眠。
- `mobile.computers.own_tunnel.verdict_local_network_ios` — ok_with_findings (ZHS2B1-05): 此网络中该地址没有任何响应。检查电脑是否未休眠且正在运行中继。如果两者都没问题，可能是本地网络权限所致：前往“设置”→“隐私与安全性”→“本地网络”，允许Local Operator，然后轻点“{action}”。
- `mobile.computers.own_tunnel.verdict_local_network` — ok_with_findings (ZHS2B1-01, ZHS2B1-05): 此网络中该地址没有任何响应。检查电脑是否未休眠且正在运行中继，然后轻点“{action}”。
- `mobile.computers.own_tunnel.verdict_refused` — ok: 该地址有响应，但本应用无法识别其响应内容。
- `mobile.computers.own_tunnel.remedy` — ok: 在该电脑上运行：{command}
- `mobile.computers.own_tunnel.password_slot_other` — ok: 此手机只能保存一个中继密码，当前保存的属于另一个地址。输入这台电脑的密码，测试后再保存。保存后将替换原有密码。
- `mobile.computers.own_tunnel.password_slot_empty` — ok: 此手机尚未保存中继密码。输入这台电脑的密码，测试后再保存。
- `mobile.computers.own_tunnel.password_slot_this` — ok: 此手机已保存的中继密码对应此地址。测试后再保存。
- `mobile.common.copy` — ok: 复制
- `mobile.common.copied` — ok: 已复制
- `mobile.common.copy_command_hint` — ok: 复制“{label}”命令
- `mobile.settings.own_tunnel.not_saved` — ok: 密码未保存，因此应用每次启动时都会要求输入。
- `mobile.settings.own_tunnel.kept_secure` — ok: 地址和密码保存在此手机的安全存储中。
- `mobile.settings.own_tunnel.edit` — ok: 编辑
- `mobile.settings.own_tunnel.test_again` — ok: 重新测试
- `mobile.settings.own_tunnel.remove` — ok: 移除
- `mobile.settings.own_tunnel.password_placeholder` — ok: 启动中继时使用的密码
- `mobile.settings.own_tunnel.runtime_title` — ok: 当前环境无法保存隧道
- `mobile.settings.own_tunnel.runtime_body` — ok: 此版本没有安全密钥库，因此隧道仅在本次运行期间有效。在手机上，这些信息会保存在系统的安全存储中。
- `mobile.settings.own_tunnel.before_saving` — ok: 保存前先测试地址：从未响应过的隧道一旦保存，列表会一直为空，且无从得知原因。
- `mobile.settings.own_tunnel.remove_title` — ok: 移除此隧道？
- `mobile.settings.own_tunnel.remove_body` — ok: 此操作会清除此手机上的地址和密码，不会影响你的电脑、你运行的隧道或任何账户。
