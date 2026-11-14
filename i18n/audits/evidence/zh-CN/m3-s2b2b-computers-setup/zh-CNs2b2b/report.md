# zh-CN audit — mobile i18n M3 S2b-2b (computers setup + route_invalid)

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT). Auditor: Local Operator i18n-auditor, session 6877c6310b02, model anthropic/claude-opus-5-5 (no fallback). Independent of translator job 40852865913c.

Inputs: brief sha256 9b37cb3d…6c67 (redaction hits 0), draft sha256 b53ea377…b99c, source commit e0027e61.

## Mechanical
- 27/27 keys, none added/dropped; all parse with repo messages.ts; params identical to English (amount, command, scheme, insecure, example; all `text`); no ICU plurals in this slice; no bidi controls; no zero-width/control chars; rendered with real values (see audit.log).

## Findings
- **ZH-F1 MINOR** `mobile.computers.setup.address_help` — current: 如果你的中继可以通过某个已知的URL访问，请使用中继自己的密码连接。这种方式适用于完全不使用Radient的电脑。 — '某个已知的URL' (some known URL) drops 'you already know'; the condition is that the reader already knows the relay's URL. → **如果你已知道可访问中继的URL，请使用中继自己的密码连接。这种方式适用于完全不使用Radient的电脑。**
- **ZH-N1 NIT** `mobile.computers.setup.watching` — current: 正在检测隧道 — '检测' reads as actively testing the tunnel; the state is waiting for the new tunnel to appear (spinner). Catalogue's wait.* strings use 正在等待…. → **正在等待隧道**

## Rulings requested
- **no_tunnel_id 凭据 vs 令牌**: Accept 凭据. 重新签发登录凭据 is accurate for re-minting a session token and user-readable; 令牌 is acceptable but more technical (catalogue uses 令牌 only in a diagnostics privacy note). Avoiding 会话 is right: it already means agent sessions on this screen family.
- **amount_note 'refuses anything else'**: Accept 不接受其他金额: the command rejects any amount other than the console price, so naming 金额 is a faithful explicitation, not an addition.
- **关联 (attach)**: Accept. Distinct from 连接 used on the ran_it button (开始连接) and in route copy; the CLI verb `lop tunnel connect` is shown verbatim in the block, so no conflict.
- **隧道ID**: Accept; ID is standard zh-CN UI.
- **查询字符串/片段标识符**: Accept; standard URL terminology (RFC 3986 zh renderings).
- **重新签发登录凭据**: Accept (see no_tunnel_id).
- **重新获取电脑列表**: Accept; describes the action plainly. signin.stage_discovering uses 查找你的电脑 — either is fine for this reserved string.
- **route_invalid.credentials masking**: Not masked: code points U+8BF7 U+4ECE U+5730 U+5740 U+4E2D U+5220 U+9664 U+7528 U+6237 U+540D U+548C U+5BC6 U+7801 U+3002 = 请从地址中删除用户名和密码。 (the existing catalogue's password keys DISPLAY as masked in tool output; not inspected further, out of scope).

## Other keys
All other keys read as native product copy, consistent with the zh-CN catalogue (隧道, 中继, 中继密码, Radient控制台, 电脑, 连接器 = refusal.offline_next, 你的电脑 = added.fallback_name, insecure_off names the on-screen switch “允许明文http://地址”). Buttons/labels short (终端, TUI, 关联, 隧道ID, 已运行，开始连接); no overflow risk. Mixed CJK–Latin spacing is pre-existing catalogue variance; the draft follows the no-space majority.
