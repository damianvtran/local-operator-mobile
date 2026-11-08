# ur1107p1r2 — ur mobile.home DELTA re-audit (round 2)

| | |
|---|---|
| Round-1 bundle | `i18n/audits/evidence/ur/mobile.home/ur1107p1/` |
| Remediation receipt | `i18n/audits/evidence/ur/mobile.home/ur1107p1-remediation/record.json` |
| Audited revision | `504df8f5` (PR #192 head), base `b5a2f4a1` |
| Target | `src/i18n/catalogues/ur/mobile.home.json` sha256 `9c9b854e9448cfdd1ef68bb0758be28557c7a0c7abfce79064191ccf4fdaad7c` |
| Auditor | reviewer (lopdev team), session c9f52501c938, anthropic/claude-opus-5-5, no fallback. Independent of the translator and of the round-1 auditor (27cb86d0ecef) and the implementer (f76f34aff586) |
| Verdict | **passed**: 0 BLOCKER, 0 MAJOR, 0 new findings |

## Delta
- en and en context are byte-identical to round 1 (`12d5edd75b0e2a6e…`, `aa5060ffb2c38f9e…`).
- The base file hash equals round 1's target hash (`a596a55a248529e0…`). Reverting the 10 changed key(s) to their base text in the head bytes reproduces it exactly, so no other key moved.
- Changed keys = finding keys. No finding key was left unchanged.
- The round-1 auditor's `mech.py`, re-run unmodified at head, reports 0 placeholder, bidi, brace, ellipsis, final-stop or product-name issues.

## Round-1 findings, re-judged on the current bytes
- **UR-H01** (MAJOR): Verified. All 7 keys now use core's term «استدلال کی شدت» (relay.chrome.model.effort, wire.settings.model_effort.*). The narrow visible chip «ڈیفالٹ شدت» is an acceptable short form of core's «ڈیفالٹ استدلال کی شدت». The remaining «کوشش» hits in ur are all the unrelated 'try again / keeps trying' sense (scan: 0 outside it).
- **UR-H02** (MAJOR): Verified. «پاتھ» matches core (10 values) and hi. «راستہ» is gone from every ur mobile value. Postpositions and the final «۔» are unchanged.

## Limits
- I captured no rendered frame. Round 1's length notes (es effort chip, 23 chars; vi chip, 21 chars after the change) still need a 320 pt rendered check, which is outside a text audit.
- `audit.log` is the shared execution transcript. This report is judgement, not command output.
