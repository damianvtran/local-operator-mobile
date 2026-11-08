# zh1107p1r2 — zh-CN mobile.home DELTA re-audit (round 2)

| | |
|---|---|
| Round-1 bundle | `i18n/audits/evidence/zh-CN/mobile.home/zh1107p1/` |
| Remediation receipt | `i18n/audits/evidence/zh-CN/mobile.home/zh1107p1-remediation/record.json` |
| Audited revision | `504df8f5` (PR #192 head), base `b5a2f4a1` |
| Target | `src/i18n/catalogues/zh-CN/mobile.home.json` sha256 `bf92f94ee6474dff4594cb6fde40ab8b771228ebe2cecb4e77e20362d6d2b7fb` |
| Auditor | reviewer (lopdev team), session c9f52501c938, anthropic/claude-opus-5-5, no fallback. Independent of the translator and of the round-1 auditor (27cb86d0ecef) and the implementer (f76f34aff586) |
| Verdict | **passed**: 0 BLOCKER, 0 MAJOR, 0 new findings |

## Delta
- en and en context are byte-identical to round 1 (`12d5edd75b0e2a6e…`, `aa5060ffb2c38f9e…`).
- The base file hash equals round 1's target hash (`b0c97e5e20b21828…`). Reverting the 4 changed key(s) to their base text in the head bytes reproduces it exactly, so no other key moved.
- Changed keys = finding keys. No finding key was left unchanged.
- The round-1 auditor's `mech.py`, re-run unmodified at head, reports 0 placeholder, bidi, brace, ellipsis, final-stop or product-name issues.

## Round-1 findings, re-judged on the current bytes
- **ZH-H01** (MINOR): Verified. «已为此对话选择» marks a completed choice and matches the chip's other states. All three keys moved together.
- **ZH-H02** (MINOR): Verified. «超高» sits cleanly between «高» and «最高» in the level scale (低/中/高/超高/最高). «很高» read as an intensifier of «高», not as a distinct level.

## Limits
- I captured no rendered frame. Round 1's length notes (es effort chip, 23 chars; vi chip, 21 chars after the change) still need a 320 pt rendered check, which is outside a text audit.
- `audit.log` is the shared execution transcript. This report is judgement, not command output.
