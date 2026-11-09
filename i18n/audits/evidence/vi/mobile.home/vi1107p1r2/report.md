# vi1107p1r2 — vi mobile.home DELTA re-audit (round 2)

| | |
|---|---|
| Round-1 bundle | `i18n/audits/evidence/vi/mobile.home/vi1107p1/` |
| Remediation receipt | `i18n/audits/evidence/vi/mobile.home/vi1107p1-remediation/record.json` |
| Audited revision | `504df8f5` (PR #192 head), base `b5a2f4a1` |
| Target | `src/i18n/catalogues/vi/mobile.home.json` sha256 `48f55488d35e4fe001e6f76a20f70a8706574363bec08366b5d37a42cbc96a1c` |
| Auditor | reviewer (lopdev team), session c9f52501c938, anthropic/claude-opus-5-5, no fallback. Independent of the translator and of the round-1 auditor (27cb86d0ecef) and the implementer (f76f34aff586) |
| Verdict | **passed**: 0 BLOCKER, 0 MAJOR, 0 new findings |

## Delta
- en and en context are byte-identical to round 1 (`12d5edd75b0e2a6e…`, `aa5060ffb2c38f9e…`).
- The base file hash equals round 1's target hash (`1dcd42a6510ce817…`). Reverting the 9 changed key(s) to their base text in the head bytes reproduces it exactly, so no other key moved.
- Changed keys = finding keys + beyond-finding `mobile.home.picker.effort_unsupported`. No finding key was left unchanged.
- The round-1 auditor's `mech.py`, re-run unmodified at head, reports 0 placeholder, bidi, brace, ellipsis, final-stop or product-name issues.

## Round-1 findings, re-judged on the current bytes
- **VI-H01** (MINOR): Verified. «thư mục home» matches core (relay.chrome.session.ended_hint, relay.health.ended_detail). The badge «Home» is its short form. It is identical to the English by design, and the PR adds it to catalogues.test.ts IDENTICAL_BY_DESIGN with that reason.
- **VI-H02** (MINOR): Verified on all 6 listed keys. «Mức suy luận» is core's relay.chrome.model.effort.

## Beyond the findings
- `mobile.home.picker.effort_unsupported`: CONFIRMED (kept, not reverted). It was the last «mức nỗ lực» in vi mobile (residue scan 0 after the change). Without it, the effort sheet would name the setting two ways, which is exactly what VI-H02 removes. It is the same term substitution and nothing else in the sentence moved.

## Limits
- I captured no rendered frame. Round 1's length notes (es effort chip, 23 chars; vi chip, 21 chars after the change) still need a 320 pt rendered check, which is outside a text audit.
- `audit.log` is the shared execution transcript. This report is judgement, not command output.
