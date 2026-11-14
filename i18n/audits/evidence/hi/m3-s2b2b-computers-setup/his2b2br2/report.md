# Hindi (hi) round-2 delta audit — M3 S2b-2b computers setup

Auditor: i18n-auditor (lopdev), session b5334e435051, model anthropic/claude-opus-5-5 (no fallback observed). Independent of translator jobs b8d8cd17b9d9 / 72960e7a07ef and of round-1 auditor session 49ff9c33b2d7.

**Verdict: passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT on the delta. All 3 round-1 findings resolved.

Scope: v1 (draft-hi.json 702c6790…5cc4) → v2 (draft-hi-v2.json 2beb40d0…1a5d). Brief 9b37cb3d…6c67 verified. Redaction-marker count 0 (brief, v2).

Written to the auditor's own scratchpad because a guardrail refused writes to the lane's audits/hi-r2/ directory; the lane copies them.

## Mechanical
- v1→v2: exactly 3 lines differ (lines 11, 24, 27); the other 26 lines are byte-identical; key order identical; 27 keys in brief order; none missing or extra.
- The changed keys are exactly the three listed in notes-hi-v2.md.
- parseMessage (messages.ts @ e0027e61, sha256 c1831406…bba0): 27/27 OK, 0 issues; http_public placeholders = {example,insecure,scheme}, identical to English; no bidi controls; NFC; no plurals in slice.

## Round-1 findings
- HI-1 MINOR `route_invalid.http_public` — RESOLVED. Now `{insecure} की अनुमति सिर्फ़ निजी पते के लिए है। {scheme} का उपयोग करें, या {example} जैसे किसी निजी होस्ट का।` The elliptical `… का [उपयोग करें]` is natural Hindi; the oblique `जैसे किसी` is correct; placeholders untouched; Latin runs stay LTR without control characters.
- HI-2 MINOR `route_invalid.no_tunnel_id` — RESOLVED. Now `इसका साइन-इन नए सिरे से नहीं बनाया जा सकता।` This removes the issue/continue ambiguity of जारी. The meaning ("cannot produce a fresh sign-in") matches the note (re-mint = issue a new session token). Reserved string; wording acceptable.
- HI-3 NIT `setup.watching` — RESOLVED. Now `टनल का इंतज़ार हो रहा है` (24 chars, ≤ sibling ran_it at 28 chars, same full-width button). The progressive form matches the catalogue's in-progress labels; no full stop, per the note. Omitting the ellipsis matches the English, and the spinner shows progress.

## New findings on the delta
None.
