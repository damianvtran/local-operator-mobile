# zh-CN — M3 S2a — round 2 delta re-audit (`zhcns2a2`)

**Verdict: PASS (`passed`).** There are no new findings, and all 5 round-1 findings (ZHS2A-01..05) are resolved. 0 BLOCKER/MAJOR remain.

- **Auditor:** i18n-auditor (lopdev), session 18935f868a69. **Model (actual):** `anthropic/claude-opus-5-5`, read from the session header, with no fallback. It is independent of the translator (jobs 58e08aabd2d5/660497d4cc28, session 89bf28b0cac4) and of the round-1 auditor (job 4584e10b4759).
- **Hashes recomputed (all match):** brief `e64f41af7e262a49a92ddf6a2f9fe519bc046c771833ca58a2d622dfeeeba563`, v1 `f38550f3bf07fccab7c04c35b62567d371fa2c60708be470bfacbe9a01979a68`, v2 `f9bd1fed3bfeddc26d01c2f0e7e8c3ecde0dd47ff5a1833515f46e4b25fc1966`.
- **Read route:** ordinary git/scratchpad reads. read_public_copy was not used because the core route refuses mobile catalogue paths, and the context sidecars are nested JSON, which it cannot route. No MT service was used.

## 1. Delta proof: PASS
v1 and v2 have the same 37 keys in the same order. Only 5 values differ, and they are exactly the five finding keys. Writing those 5 v2 values into the v1 bytes gives a result **byte-identical to v2**, so nothing else changed. Redaction markers: 0 in v1 and 0 in v2.

## 2–3. Changed keys: all PASS, all round-1 findings resolved
All five keys:
- have no placeholders in the source or the target;
- keep `http://`/`https://` counts that match the English;
- use 你;
- use full-width punctuation with no CJK/Latin spacing;
- are shorter than the English, with no maxCells hint.

| key | v2 | finding | result |
|---|---|---|---|
| `mobile.computers.own_tunnel.insecure_off_help` | 使用http://时，中继密码会以明文在网络中传输，因此除非你手动开启，否则此选项保持关闭。只要地址支持，请始终使用https://。 | ZHS2A-03 | resolved — 除非你手动开启，否则此选项保持关闭 correctly says "off unless you turn it on", and 此选项 correctly points to the opt-in. http:// and https:// are unchanged, with counts 1/1. |
| `mobile.computers.own_tunnel.private_host` | 此地址位于你自己的网络内，因此暴露范围仅限于该网络。 | ZHS2A-05 | resolved — 暴露范围 translates "exposure" exactly and matches the security body. |
| `mobile.computers.own_tunnel.public_host` | 此地址不是私有地址——从此手机到该地址途经的任何网络或设备都能读取密码。 | ZHS2A-01 | resolved — Names the networks and devices on the path between the phone and the address (途经的任何网络或设备). The "either party" misreading is gone, the warning stays strong, and the paired dash —— is kept. |
| `mobile.computers.own_tunnel.step_test_help` | 保存前，会先通过你的隧道发送一次真实请求。 | ZHS2A-04 | resolved — The calqued subject is gone. 保存前 is accurate for "before anything is saved", and the subjectless 会先 reads naturally as UI help. |
| `mobile.computers.own_tunnel.security_heading` | 暴露到公网前须知 | ZHS2A-02 | resolved — 暴露 now matches the body (暴露到互联网上) and 公网 matches url_label (公网URL). Leaving out the object 电脑 is fine in a heading, because the body directly below names the computer. No final full stop; 8 CJK characters. |

Translator's security_heading modification (暴露到公网前须知 instead of the suggested 将电脑暴露到公网前须知): **accepted.** It fixes the collocation and the term mismatch that made ZHS2A-02 a finding. It is also shorter for a narrow heading, and "it" stays clear from the body directly below.
