# zh-CN audit — ROUND 2 (delta) — mobile i18n M3 S2b-2b

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT new; round-1 ZH-F1 and ZH-N1 resolved). Auditor: Local Operator i18n-auditor (team lopdev), session a7ef3ef01f5e, model anthropic/claude-opus-5-5 (no fallback). Independent of translator sessions 40852865913c / dc349a33aded and of round-1 auditor 6877c6310b02.

Inputs (recomputed, all match brief): brief 9b37cb3d…6c67 (redaction hits 0), v1 b53ea377…b99c, v2 6abc5a18…3d23, notes-zh-CN-v2.md; source commit e0027e61.

## Delta mechanics
- v2 key order == brief order == v1 order (27 keys). Changed keys exactly the 2 the notes list: `setup.watching`, `setup.address_help`. All other lines byte-identical (line diff with those 2 excluded is empty).
- Both changed values parse with messages.ts from e0027e61 (sha256 c1831406…ba0); params equal English (none); no bidi/zero-width/control chars; NFC. Full 27-key re-run: 0 failures. Redaction in v2: 0.

## Round-1 findings
- **ZH-F1 MINOR** `setup.address_help` — RESOLVED. Now 如果你已知道可访问中继的URL，请使用中继自己的密码连接。这种方式适用于完全不使用Radient的电脑。 = the suggested wording verbatim; restores "a URL you already know"; conditional and polarity intact; second sentence unchanged.
- **ZH-N1 NIT** `setup.watching` — RESOLVED. Now 正在等待隧道, matching the catalogue's wait.* 正在等待… pattern and the spinner state; short, no full stop, fits the button beside sibling ran_it (已运行，开始连接).

## Rulings
Round-1 rulings (凭据, 不接受其他金额, 关联, 隧道ID, 查询字符串/片段标识符, 重新获取电脑列表) were acceptances with no change requested; v2 leaves those keys byte-identical — acceptable.

## New findings on delta
None.
