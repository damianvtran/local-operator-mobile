# zh-CN — M3 S2b-1, round 2 (delta) — independent re-audit `zhcns2b1-r2`

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 0 MINOR in the catalogue; 1 NIT on the translator's notes (process artifact).

- Auditor: i18n-auditor (lopdev), session 6c75aa81f382. Actual model: anthropic/claude-opus-5-5 (session header); no fallback. Independent of translator jobs 3ceed9e5fc3c / 02528922752a and round-1 auditor job 13ed573c5a51.
- Source: 254e6fba (feat/i18n-m3-s2b1). Parser src/i18n/messages.ts sha256 c1831406…5bdba0 (same as round 1).
- Inputs recomputed, all match: brief v1 d46b2d44…dc4df · brief v2 d694b10a…88e9 · draft v1 83f029af…afe8 · draft v2 e6024352…49f4.
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. No MT service.

## 1. Mechanical delta proof — PASS
- Brief v1→v2: 41 entries each; only `verdict_forbidden` differs, and only in `english` + `note` ("requests it did not come from" → "requests from any other origin").
- Draft v1→v2: 41 keys, same order; exactly 8 values changed, equal to the notes' list: install_note, check_note, verdict_password, verdict_forbidden, verdict_tls, verdict_timeout, verdict_local_network_ios, verdict_local_network. The other 33 are byte-equal (not re-audited).
- All 8 parse with the repo `parseMessage` (node, heap 256 MB); placeholder names/kinds equal the v2 English; `verdict_timeout` stays `{seconds, plural, other {# 秒}}`, zh-CN CLDR → only `other` (0/1/2/10 checked).
- Changed values: full-width punctuation only, no CJK–Latin spaces, no bidi controls, 你-register, no 您, no 请 (the only 请 is inside 请求 = "request").

## 2. Per-key judgement (all OK)
| key | v2 | ruling |
|---|---|---|
| install_note | macOS：安装可自动重启的守护进程，生成中继密码并存入钥匙串。 | Natural verb, pronoun dropped. |
| check_note | 运行状况、密码验证的状态，以及手机将看到的会话。 | Matches the note (auth gate = password check). |
| verdict_password | 密码被拒绝。检查电脑上设置的中继密码。 | Plain; parallel to 证书被拒绝. |
| verdict_forbidden | …需放行本应用；中继本身也会拒绝来自其他来源的请求，因此务必确保隧道直接转发到{address}… | Matches v2 English: 其他来源 = "any other origin" (任何 is implied by 其他); 来源 is the lay-readable word for origin, fits the note. 务必 is an emphatic imperative without 请, consistent with sibling verdicts. |
| verdict_tls | …改用…{scheme}地址，或换用…；如果隧道由你自己运行，则需替换其自签名证书——应用不会跳过证书校验。 | All three remedies and the refusal kept. |
| verdict_timeout | …以及电脑是否处于唤醒状态。 | 唤醒 agrees with the glossary call wake → 唤醒. |
| verdict_local_network_ios | …检查电脑是否处于唤醒状态且正在运行中继…然后轻点“{action}”。 | 可能 ("may") kept. |
| verdict_local_network | …检查电脑是否处于唤醒状态且正在运行中继，然后点按“{action}”。 | See the tap ruling. |

### Tap ruling (轻点 vs 点按)
Call sites in src/features/auth/tunnel-verdict.ts: `verdict_local_network_ios` is returned only when `platform === "ios"` (line ~176), and `verdict_local_network` covers everything else, Android and web (line ~190; the code comment says "Web keeps this same sentence"). The split is **correct**. 轻点 is Apple's zh-CN gesture verb. 点按 is the Android zh-CN verb, and the shipped zh-CN catalogue already uses it (`mobile.composer_input.paste.denied`). For desktop web, 点击 would be slightly better. Because one key serves both platforms and the app is touch-first, 点按 is the right default. This is not a finding.

## 3. Round-1 findings
- ZHS2B1-01 resolved (点按 on the Android/web key).
- ZHS2B1-02 resolved.
- ZHS2B1-03 resolved (exact suggested text).
- ZHS2B1-04 resolved. 务必确保 replaced the suggested 须确保; the two are equivalent and neither uses 请.
- ZHS2B1-05 resolved in all three keys.
- ZHS2B1-06 resolved (exact suggested text).
- ZHS2B1-S1 resolved by source commit 254e6fba. The zh text now matches it.

## 4. Redaction in the round-1 bundle
Literal `[redacted]` appears in audits/zh-CN/record.json:64 (the masked quotation of the v1 verdict_password text) and in audit.log:65 (the description of a check). report.md:54 and the audit.log render line are masked only on display; they contain 0 literal hits. In every case, the masked text is a quotation of the v1 value. I recovered that value from the hashed v1 draft by codepoints (密码未被接受。检查电脑上…, 20 chars). No problem statement, suggestion, key or verdict is masked, so **the redaction has no effect on any finding**.

## Findings
- **ZHR2-N1 — NIT — notes-zh-CN-v2.md** (process note, not shipped copy). The notes say "every changed value is shorter than or equal to v1". That is false: verdict_forbidden, verdict_timeout, verdict_local_network_ios and verdict_local_network are each +3 characters. There is no fit impact, because these are body texts and the brief sets no maxCells/maxChars. The line should be corrected if the notes are retained.
