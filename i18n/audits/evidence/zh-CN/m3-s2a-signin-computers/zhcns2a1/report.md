# zh-CN — M3 S2a (mobile.computers + mobile.signin, 37 keys) — independent translation audit `zhcns2a1`

**Verdict: FAIL — `changes_requested`.** 1 MAJOR, 2 MINOR, 2 NIT. No BLOCKER.

- **Auditor:** `i18n-auditor` (lopdev), session `466817b58ea5`. **Model (actual):** `anthropic/claude-opus-5-5`, read from the session header. No fallback was used or observed.
- **Translator:** translator job 58e08aabd2d5 (its notes give session 89bf28b0cac4). The auditor is independent of that session.
- **Source commit:** `59ec51843f05f93706492756b1a89ef53004179a`
- **Brief sha256:** `e64f41af7e262a49a92ddf6a2f9fe519bc046c771833ca58a2d622dfeeeba563`. Recomputed; it matches.
- **Draft sha256:** `f38550f3bf07fccab7c04c35b62567d371fa2c60708be470bfacbe9a01979a68`. Recomputed; it matches.
- **Read route:** ordinary git/scratchpad reads. read_public_copy was not used because the core route refuses mobile catalogue paths, and the context sidecars are nested JSON, which it cannot route.
- **Translation tools:** no MT service, API or SDK was used. Judgements are reasoned against the English, the brief notes, the shipped zh-CN catalogues @59ec5184, and the zh-CN style guide.

## Mechanical — PASS
These checks ran with the repo's `parseMessage` (src/i18n/messages.ts @59ec5184) under node.
- All 37 values parse, in both English and zh.
- Placeholder names and kinds match the en catalogue exactly: `{name}`, `` `{command}` `` (backticks preserved) and `{module}`.
- Every brief English string equals the en catalogue string.
- Key order equals the brief. No key was added or dropped, and none is already shipped.
- The slice has no plural or select messages.
- Punctuation is clean: no ASCII `...`, no single `…`, no CJK–Latin spaces, no bidi controls.
- Tokens are intact: `Radient`, `URL`, `HTTPS`, `http://` and `https://`.
- Negative controls: an unbalanced brace throws. A renamed or dropped placeholder parses, so names were compared against English.
- Width: the sidecars give no `maxCells` hints. Only the short labels grow — `testing` and `saving` (because of ……), `step_test` and `verdict_not_yet` — and none of them is at overflow risk.
- Redaction markers: 0 in the brief and 0 in the draft. The notes contain only literal mentions in the translator's scan description.

## Findings

### ZHS2A-01 — MAJOR — `mobile.computers.own_tunnel.public_host`
- English: This address is not a private one — anything between this phone and it can read the password.
- Current: 此地址不是私有地址——此手机与它之间的任何一方都能读取密码。
- Problem: “此手机与它之间的任何一方” is not idiomatic: “任何一方” evokes “either party” (of the phone and the address), so the warning about anything on the path in between can be misread and is weakened; “它” is also vague. The note asks for a strong warning.
- **Suggested:** 此地址不是私有地址——从此手机到该地址途经的任何网络或设备都能读取密码。

### ZHS2A-02 — MINOR — `mobile.computers.own_tunnel.security_heading`
- English: Before you expose it
- Current: 公开电脑前须知
- Problem: “公开电脑” (publicise/disclose the computer) is an unusual collocation for “expose”; the body under it says 暴露到互联网上 and the URL label uses 公网. Understandable, but the heading and body use different terms.
- **Suggested:** 将电脑暴露到公网前须知

### ZHS2A-03 — MINOR — `mobile.computers.own_tunnel.insecure_off_help`
- English: Over http:// your relay password crosses the network in the clear, so it is off unless you turn it on. Use https:// whenever the address supports it.
- Current: 使用http://时，中继密码会以明文在网络中传输，因此默认关闭，需你手动开启。只要地址支持，请始终使用https://。
- Problem: “需你手动开启” can be read as “you need to turn it on”, which nudges toward the unsafe option. The English says it stays off unless you turn it on.
- **Suggested:** 使用http://时，中继密码会以明文在网络中传输，因此除非你手动开启，否则此选项保持关闭。只要地址支持，请始终使用https://。

### ZHS2A-04 — NIT — `mobile.computers.own_tunnel.step_test_help`
- English: This makes a real request through your tunnel before anything is saved.
- Current: 在保存任何内容之前，这会先通过你的隧道发送一次真实请求。
- Problem: The subject “这会先” is a calque of “This makes”. Chinese drops it.
- **Suggested:** 保存前，会先通过你的隧道发送一次真实请求。

### ZHS2A-05 — NIT — `mobile.computers.own_tunnel.private_host`
- English: This address is on your own network, so the exposure is limited to it.
- Current: 此地址位于你自己的网络内，因此风险仅限于该网络。
- Problem: “风险” generalises “exposure”. “暴露范围” is more exact and matches the security body.
- **Suggested:** 此地址位于你自己的网络内，因此暴露范围仅限于该网络。

## Rulings on the translator's three flags

- `mobile.computers.own_tunnel.title`: ACCEPT 自建隧道: idiomatic short title, accurate (paths.own_body: 自行运行隧道), shares 自/隧道 with entry points 设置自己的隧道 / 使用我自己的隧道. Not a finding.

- `mobile.computers.own_tunnel.step_test`: ACCEPT 测试连接 for both step heading and button: the English pair is near-identical too, the verb+object matches 发布中继, and need_test must name the button (it does). The repetition is harmless. Not a finding.

- `mobile.computers.own_tunnel.security_heading`: CHANGE suggested (ZHS2A-02, minor): 公开电脑 → 将电脑暴露到公网前须知.


## The other 32 keys — OK
They are accurate, idiomatic, use 你, and match the glossary: 电脑, 隧道, 中继, 密码, 登录, 账户, 地址, 响应 and URL. Points of note:
- `verdict_not_yet` 尚未连通 is calm and is not a final failure.
- `step_computer_help` explains loopback plainly.
- `unavailable_detail` 本机回环监听器 is right for its developer audience.
- `security_body` keeps `{command}` with its backticks, and 更换密码 is a better choice than 轮换.
- 请 appears on plain imperatives, against the style guide's "请 only where the English says please". The shipped catalogue does the same and S1 passed with it, so this is not raised as a finding.

## Non-gating observations (pre-existing, outside this slice)
Pre-existing in the shipped zh-CN catalogue (not in this slice): 计算机 in connect_refused.generic vs glossary 电脑; spaces around Radient in account_mismatch/billing_help/disabled_help/harness_help; single … in signing_out and signin.progress. The draft follows the no-space and …… rulings.


## Per-key results
| key | zh | result |
|---|---|---|
| `mobile.computers.title.list` | 电脑 | ok  |
| `mobile.computers.title.set_up` | 设置电脑 | ok  |
| `mobile.computers.banner.unreachable_stale` | 无法连接Radient，此列表可能不是最新的。 | ok  |
| `mobile.computers.banner.unreachable_empty` | 无法连接Radient，未能列出你的电脑。请检查此设备的网络连接。 | ok  |
| `mobile.computers.banner.unreadable_stale` | 无法读取Radient的响应，此列表可能不是最新的。 | ok  |
| `mobile.computers.banner.unreadable_empty` | 无法读取Radient的响应，未能列出你的电脑。 | ok  |
| `mobile.computers.own_tunnel.title` | 自建隧道 | ok  |
| `mobile.computers.own_tunnel.password_for` | 输入{name}的密码 | ok  |
| `mobile.computers.own_tunnel.password_label` | 中继密码 | ok  |
| `mobile.computers.own_tunnel.intro` | 全程无需Radient账户。你通过自己掌控的隧道，在自己的电脑上发布中继；应用则通过你在下方粘贴的地址与它通信。 | ok  |
| `mobile.computers.own_tunnel.step_computer` | 在电脑上 | ok  |
| `mobile.computers.own_tunnel.step_computer_help` | 中继只接受来自本机的连接，所以必须在这台电脑上运行它。使用应用期间，请勿让电脑休眠。 | ok  |
| `mobile.computers.own_tunnel.step_publish` | 发布中继 | ok  |
| `mobile.computers.own_tunnel.step_app` | 在应用中 | ok  |
| `mobile.computers.own_tunnel.url_label` | 公网URL | ok  |
| `mobile.computers.own_tunnel.insecure_allow` | 允许明文http://地址 | ok  |
| `mobile.computers.own_tunnel.insecure_allowed` | 已允许明文http:// | ok  |
| `mobile.computers.own_tunnel.insecure_hint` | 仅在地址使用http时需要，此时密码将以明文发送 | ok  |
| `mobile.computers.own_tunnel.insecure_on_help` | 已开启：中继密码及你发送的所有内容都将以未加密形式经过此网络。请仅在可信网络中开启。 | ok  |
| `mobile.computers.own_tunnel.insecure_off_help` | 使用http://时，中继密码会以明文在网络中传输，因此默认关闭，需你手动开启。只要地址支持，请始终使用https://。 | ZHS2A-03 minor |
| `mobile.computers.own_tunnel.unencrypted_title` | 此地址未加密 | ok  |
| `mobile.computers.own_tunnel.unencrypted_body` | 开启上方选项即可使用此地址，或改填https://地址——隧道通常会提供一个。 | ok  |
| `mobile.computers.own_tunnel.private_host` | 此地址位于你自己的网络内，因此风险仅限于该网络。 | ZHS2A-05 nit |
| `mobile.computers.own_tunnel.public_host` | 此地址不是私有地址——此手机与它之间的任何一方都能读取密码。 | ZHS2A-01 major |
| `mobile.computers.own_tunnel.step_test` | 测试连接 | ok  |
| `mobile.computers.own_tunnel.step_test_help` | 在保存任何内容之前，这会先通过你的隧道发送一次真实请求。 | ZHS2A-04 nit |
| `mobile.computers.own_tunnel.security_heading` | 公开电脑前须知 | ZHS2A-02 minor |
| `mobile.computers.own_tunnel.security_body` | 你正在把自己的电脑暴露到互联网上，而中继密码是挡在它前面的唯一屏障。请优先使用HTTPS；如果你的隧道自带身份验证，请一并启用；如果密码曾被分享，请用`{command}`更换密码。任何人只要拿到该密码和你的URL，就能操控那台电脑上的会话。 | ok  |
| `mobile.computers.own_tunnel.test` | 测试连接 | ok  |
| `mobile.computers.own_tunnel.testing` | 正在测试…… | ok  |
| `mobile.computers.own_tunnel.save_connect` | 保存并连接 | ok  |
| `mobile.computers.own_tunnel.saving` | 正在保存…… | ok  |
| `mobile.computers.own_tunnel.need_address` | 粘贴隧道地址以继续。 | ok  |
| `mobile.computers.own_tunnel.need_test` | 请先测试连接——从未成功响应过的隧道不应保存。 | ok  |
| `mobile.computers.own_tunnel.verdict_ok` | 已连接 | ok  |
| `mobile.computers.own_tunnel.verdict_not_yet` | 尚未连通 | ok  |
| `mobile.signin.panel.unavailable_detail` | 此版本缺少使用Radient登录所需的本机回环监听器（{module}）。 | ok  |
