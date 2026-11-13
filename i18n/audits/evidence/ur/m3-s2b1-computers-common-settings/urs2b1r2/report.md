# ur — M3 S2b-1 round 2 (delta) — independent re-audit `urS2b1r2`

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT (non-gating). All six round-1 translation findings are resolved. C1 is a code item outside translation scope.

- Auditor: i18n-auditor (lopdev), session d01093cb1830. Actual model: anthropic/claude-opus-5-5, from the session header; no fallback observed. Independent of translator jobs 6923cbfd363b/bc28c3249e3f and of round-1 auditor job 3548ebc82dc6.
- Hashes recomputed and matching: brief d694b10a…b88e9, v1 637ae2ca…b4a34, v2 9fa9f1df…73d07. notes-ur-v2 c0b3d773…d7ca (not pinned in the brief).
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. No MT service was used.
- Redaction: 0 literal `[redacted]` in inputs; no harness masking seen.

## Mechanical
- **Equality proof:** the key order of v1, v2 and the brief is identical (41 keys). Exactly 6 keys differ, and they are the 6 the notes list. 35 keys are byte-identical.
- **Parse:** the repo's parseMessage (src/i18n/messages.ts @254e6fba, sha256 c1831406…) was run with node 24.22.1, strip-types and heap 256 MB. 41/41 v2 values parse, and the param name/kind maps equal the English parse for all 41. All 6 changed values format with sample args. 3 negative controls throw RangeError.
- **Bidi controls:** 0 in all 41 values. 0 U+2192 remain. «کی کی» does not appear.
- **Latin-initial:** only verdict_offline_detail. install_note starts AL (یہ) with Keychain mid-sentence.
- **Plurals:** no changed key carries a plural. verdict_sessions and verdict_timeout are byte-identical to v1.

## RTL — reasoned with the UBA, using `unicodedata.bidirectional` classes (no layout engine)
- **verdict_tls** with scheme='https://' (literal at tunnel-verdict.ts:150): the class sequence is `AL WS L L L L L CS CS CS WS L L L WS AL`.
  - W4 does not apply because there is no EN/AN, and W6 turns the CS into ON.
  - N1: the neutrals `:// ` lie between L (https) and L (URL), so they resolve to L.
  - Result: one LTR run, `https:// URL`, set inside the RTL paragraph, so the scheme keeps its logical order and does not render as `//:https`.
  - The spaces at the AL|L boundaries resolve to the embedding direction R (N2), which is harmless.
- **← separators:** the class sequence is `AL WS ON WS AL`, so N1 resolves them to R. U+2190 has Bidi_Mirrored=No, so the glyph points left, which is the next item in RTL reading. ترتیبات sits rightmost, then ← رازداری اور سیکیورٹی ← مقامی نیٹ ورک. Correct.
- **install_note:** `AL WS L…L WS AL`. Keychain is an isolated L run with no neutral at risk.

## Per changed key
| key | v2 | result |
|---|---|---|
| install_note | …اور اسے Keychain میں رکھتی ہے۔ | pass. Apple's Latin name; the stutter is gone; "your" is implied, which is natural Urdu |
| verdict_tls | …دکھایا ہوا {scheme} URL استعمال کریں… | pass. URL is kept Latin per the style guide and agrees with masculine دکھایا ہوا; matches «عوامی URL» in the catalogue |
| verdict_local_network_ios | ترتیبات ← رازداری اور سیکیورٹی ← مقامی نیٹ ورک | pass. Only the arrow changed; "may" is kept (ممکن ہے) |
| verdict_refused | …اس طرح نہیں جسے یہ ایپ سمجھ سکے۔ | pass. Correct oblique relative |
| copy_command_hint | یہ “{label}” والی کمانڈ کاپی کرتا ہے | pass, with NIT N1 |
| runtime_body | اس بلڈ میں کوئی محفوظ اسٹوریج نہیں… | pass. Uses the catalogue term (storage_refused.*); the brief note says keystore and secure store are one concept |

## Findings
### URS2B1R2-N1 — NIT (non-gating) — `mobile.common.copy_command_hint`
- Current: یہ “{label}” والی کمانڈ کاپی کرتا ہے
- Issue: tunnel-commands.ts:106/113 passes {label} as the product names Cloudflare and ngrok. In those cases the value wraps a product name in Urdu quotes. The ur style guide's product-name policy says «Never wrap them in Urdu punctuation». The value is an accessibilityHint, so it is spoken, not shown, and the quotes do help the four translated imperative labels.
- Suggested: keep v2 as written. Optionally, the style guide could record that quoting an interpolated label in a spoken hint is allowed. Changing the value is not required.

## Round-1 findings
- URS2B1-01 MAJOR verdict_tls: **resolved**. The suggested wording was applied byte-for-byte, and the bidi check above confirms it.
- URS2B1-02 MAJOR verdict_local_network_ios: **resolved**. → was replaced by ← twice. Checking the three labels on an Urdu iOS 26 device is still non-gating, as before.
- URS2B1-03 MINOR install_note: **resolved**.
- URS2B1-04 MINOR runtime_body: **resolved**.
- URS2B1-05 NIT verdict_refused: **resolved**.
- URS2B1-06 NIT copy_command_hint: **resolved**. See N1.
- URS2B1-C1 (code) verdict_offline_detail: the value is unchanged, which is correct. The render-site dir pass-through is still a code item and does not gate this translation.
