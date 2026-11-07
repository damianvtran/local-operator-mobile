# es1107p1r2 — es mobile.home DELTA re-audit (round 2)

| | |
|---|---|
| Round-1 bundle | `i18n/audits/evidence/es/mobile.home/es1107p1/` |
| Remediation receipt | `i18n/audits/evidence/es/mobile.home/es1107p1-remediation/record.json` |
| Audited revision | `504df8f5` (PR #192 head), base `b5a2f4a1` |
| Target | `src/i18n/catalogues/es/mobile.home.json` sha256 `11f65e0cbb229b0c4c11cf07f51c168f170580dd7a30cb3039f63f45c4f17789` |
| Auditor | reviewer (lopdev team), session c9f52501c938, anthropic/claude-opus-5-5, no fallback. Independent of the translator and of the round-1 auditor (27cb86d0ecef) and the implementer (f76f34aff586) |
| Verdict | **passed**: 0 BLOCKER, 0 MAJOR, 0 new findings |

## Delta
- en and en context are byte-identical to round 1 (`12d5edd75b0e2a6e…`, `aa5060ffb2c38f9e…`).
- The base file hash equals round 1's target hash (`ba51a71b7c16c79c…`). Reverting the 10 changed key(s) to their base text in the head bytes reproduces it exactly, so no other key moved.
- Changed keys = finding keys. No finding key was left unchanged.
- The round-1 auditor's `mech.py`, re-run unmodified at head, reports 0 placeholder, bidi, brace, ellipsis, final-stop or product-name issues.

## Round-1 findings, re-judged on the current bytes
- **ES-H01** (MAJOR): Verified. All 9 keys now say «máquina», with no other edits. «computadora» is gone from every es mobile value (residue scan 0). This matches core's relay.chrome.list.empty_hint «…en tu máquina». «esta máquina» keeps the feminine agreement «esta computadora» already had. source_default «Predeterminado de esta máquina» still uses the same words as the chip's spoken label, as the context note requires.
- **ES-H02** (MINOR): Verified. «Personal» is the short form of «carpeta personal», which core uses (relay.chrome.session.ended_hint). It no longer reads as the Start/Home screen. Sits beside the tmp badge «Temporal».
- **ES-H03** (MINOR): Verified, together with ES-H01 in the same value: «…dentro de tu carpeta personal o de su carpeta temporal.» The final stop is kept.

## Limits
- I captured no rendered frame. Round 1's length notes (es effort chip, 23 chars; vi chip, 21 chars after the change) still need a 320 pt rendered check, which is outside a text audit.
- `audit.log` is the shared execution transcript. This report is judgement, not command output.
