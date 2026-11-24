# Independent Urdu A translation audit

Audit: `move-pick-ur-3ebdc948-r1-a` · Session `3ebdc948939c` · 2026-11-22

Frozen worktree: `/Users/damian/local-operator-mobile/.worktrees/i18n-move-sheet-copy` @ `9362cce8a631791b676b2d2c9eda90c43fc7e11c` (read-only).

## Verdict
**mobile.remote_sessions, seven move_pick keys: PASS WITH MINORS. Overall A: PASS WITH MINORS.** Seven keys read side by side against English, actual nested context and usage; no blocker/major or linguistic defect found. Three non-gating width/render risks deferred. This does not clear the rest of the namespace. Fresh independent B is pending; A is NOT paired clearance. Source-hook evidence GAP remains OPEN.

## Identity and scope
Auditor is independent of translator `bd4d8a762e59`. Verified serving model: **UNKNOWN**. Visible user [model switch] notice reports temporary openai/gpt-6.1-sol fallback from anthropic/claude-opus-5-5 due to provider quota failure. Audit executed after notice. No independent serving receipt is available; actual serving model remains UNKNOWN.

Bounded artifact lane, no repo edits/commits/hooks/testsuite/compiler/install/build/browser/native/push. Human native review waived by delegation, not performed. Ordinary approved copy reads; no fake keyed public receipt. Nested context role/note is not routed as public-copy keys. Shared Urdu style/glossary and current mobile remote/sidebar catalogues read directly. Respectful آپ-register imperatives, settled Urdu software loanwords, Latin product name and logical Unicode storage are consistent.

## Per-key linguistic review

### `mobile.remote_sessions.move_pick.cannot_reach` — passed_with_minor_width_risk
- English: Can't reach {device}
- Current Urdu: {device} سے رابطہ نہیں ہو رہا
- Reasoning: Natural calm reachability wording, matching existing مالک کمپیوٹر سے رابطہ نہیں ہو رہا. The postposition سے follows the opaque device name with a space; it neither translates nor inflects that name. StudioMac, Mac(2), and mixed Urdu/Latin examples preserve bytes. Name-first first-strong class can vary; this is a renderer risk, not evidence of incorrect native order.
- Source-codepoint risk measurement: EN 20, UR 29, ratio 1.45. Not glyph width or fit proof.

### `mobile.remote_sessions.move_pick.destination_heading` — passed_with_minor_width_risk
- English: Move or copy to
- Current Urdu: منتقل یا کاپی کرنے کی جگہ
- Reasoning: منتقل یا کاپی retains both operations using the existing row hint terms منتقل کریں / کاپی کریں. کرنے کی جگہ is a natural nominal destination heading (place to move or copy to), not a command or claim of progress. No final punctuation. Longer source text needs a narrow-screen check.
- Source-codepoint risk measurement: EN 15, UR 25, ratio 1.6667. Not glyph width or fit proof.

### `mobile.remote_sessions.move_pick.discovery_help` — passed_with_minor_width_risk
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Current Urdu: یہ ایپ صرف وہ ڈیوائسز دکھا سکتی ہے جن کے سیشن فہرست میں نظر آتے ہیں۔ جس ڈیوائس کا کوئی سیشن نظر نہیں آ رہا، اسے ابھی منتخب نہیں کیا جا سکتا — دوسرے کمپیوٹر پر Local Operator کھولیں، پھر سیشن کی فہرست کو نیچے کھینچ کر تازہ کریں۔
- Reasoning: صرف وہ ڈیوائسز ... جن کے سیشن فہرست میں نظر آتے ہیں preserves the visible-session-only discovery limit; اسے ابھی منتخب نہیں کیا جا سکتا retains cannot be picked yet. دوسرے کمپیوٹر correctly identifies the other computer, not the phone. کھولیں then نیچے کھینچ کر تازہ کریں are polite respectful imperatives and preserve the ordered open/pull-to-refresh steps. Local Operator stays exact Latin. ڈیوائسز is a grammatical plural of glossary ڈیوائس, not term drift; سیشن / فہرست تازہ کریں match current Urdu copy.
- Source-codepoint risk measurement: EN 178, UR 227, ratio 1.2753. Not glyph width or fit proof.

### `mobile.remote_sessions.move_pick.no_answer` — passed
- English: It did not answer when this computer asked.
- Current Urdu: جب اس کمپیوٹر نے رابطہ کیا تو اس نے جواب نہیں دیا۔
- Reasoning: جب اس کمپیوٹر نے رابطہ کیا تو اس نے جواب نہیں دیا naturally expresses a computer making contact and the remote machine not answering; it avoids a literal anthropomorphic translation of asked as a spoken question. The preceding unreachable status identifies the remote referent. This computer remains کمپیوٹر, not فون. Source shows this sentence is client fallback only after absent/blank trimmed server reason; the server reason is not translation input.
- Source-codepoint risk measurement: EN 43, UR 50, ratio 1.1628. Not glyph width or fit proof.

### `mobile.remote_sessions.move_pick.no_devices` — passed
- English: No other devices are visible.
- Current Urdu: کوئی اور ڈیوائس نظر نہیں آ رہی۔
- Reasoning: کوئی اور preserves no other; نظر نہیں آ رہی means not visible, not offline or nonexistent. Feminine singular agreement with ڈیوائس is idiomatic after کوئی and matches the singular form used in discovery. No count exists, so plural ICU branches would be spurious.
- Source-codepoint risk measurement: EN 29, UR 31, ratio 1.069. Not glyph width or fit proof.

### `mobile.remote_sessions.move_pick.on_this_computer` — passed
- English: On this computer
- Current Urdu: اس کمپیوٹر پر
- Reasoning: اس کمپیوٹر پر is the natural compact locative fragment for the connected relay computer. کمپیوٹر matches existing remote-session copy; پر matches the reused sidebar locative. No phone substitution, punctuation or address-form drift.
- Source-codepoint risk measurement: EN 16, UR 13, ratio 0.8125. Not glyph width or fit proof.

### `mobile.remote_sessions.move_pick.right_now` — passed
- English: Right now
- Current Urdu: اس وقت
- Reasoning: اس وقت is idiomatic current-state labeling, not the urgent imperative ابھی کریں. It fits the section above current location; no final punctuation, extra honorific or register mismatch.
- Source-codepoint risk measurement: EN 9, UR 6, ratio 0.6667. Not glyph width or fit proof.

## Findings (all minor; no translator remediation required)

### UR-A1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
- Current: {device} سے رابطہ نہیں ہو رہا
- Proposed: {device} سے رابطہ نہیں ہو رہا
- Action: Retain accurate copy; defer narrow-phone rendered wrapping/height verification to the owning visual lane. Also inspect actual bidi/native punctuation with Latin and mixed-script opaque names; do not add translation bidi controls.
- Reason: 29 versus 20 source codepoints (+45.0%); actual synthetic 35% padding was generated, but neither counts nor pseudo text prove rendered overflow or fit.
- Disposition: deferred — non-gating rendered-risk check outside this read-only linguistic lane; no translator remediation required on current evidence

### UR-A2 — minor — `mobile.remote_sessions.move_pick.destination_heading`
- Current: منتقل یا کاپی کرنے کی جگہ
- Proposed: منتقل یا کاپی کرنے کی جگہ
- Action: Retain accurate copy; defer narrow-phone rendered wrapping/height verification to the owning visual lane. 
- Reason: 25 versus 15 source codepoints (+66.7%); actual synthetic 35% padding was generated, but neither counts nor pseudo text prove rendered overflow or fit.
- Disposition: deferred — non-gating rendered-risk check outside this read-only linguistic lane; no translator remediation required on current evidence

### UR-A3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
- Current: یہ ایپ صرف وہ ڈیوائسز دکھا سکتی ہے جن کے سیشن فہرست میں نظر آتے ہیں۔ جس ڈیوائس کا کوئی سیشن نظر نہیں آ رہا، اسے ابھی منتخب نہیں کیا جا سکتا — دوسرے کمپیوٹر پر Local Operator کھولیں، پھر سیشن کی فہرست کو نیچے کھینچ کر تازہ کریں۔
- Proposed: یہ ایپ صرف وہ ڈیوائسز دکھا سکتی ہے جن کے سیشن فہرست میں نظر آتے ہیں۔ جس ڈیوائس کا کوئی سیشن نظر نہیں آ رہا، اسے ابھی منتخب نہیں کیا جا سکتا — دوسرے کمپیوٹر پر Local Operator کھولیں، پھر سیشن کی فہرست کو نیچے کھینچ کر تازہ کریں۔
- Action: Retain accurate copy; defer narrow-phone rendered wrapping/height verification to the owning visual lane. 
- Reason: 227 versus 178 source codepoints (+27.5%); actual synthetic 35% padding was generated, but neither counts nor pseudo text prove rendered overflow or fit.
- Disposition: deferred — non-gating rendered-risk check outside this read-only linguistic lane; no translator remediation required on current evidence

## Mechanical and RTL evidence
Executed stdlib JSON, source/brief/draft SHA-256, exact seven-key set/context, simple braces/placeholder and NFC checks. `{device}` once in cannot_reach; six no-argument messages. No plural/select, number/date skeleton or markup syntax; CLDR plural branches N/A. Missing/renamed/extra arguments, RLM injection, missing key and malformed braces were rejected by negative controls. No bidi controls added. Local Operator is exact Latin. Redaction marker scans: semantic copy hits 0, raw draft including metadata hits 0; patterns in record/log. Not a secret scan.

Actual logical traces for StudioMac, Studio-Mac 14, Mac(2), دفتر Mac(2), Mac دفتر 2 preserve opaque UTF-8 names and place the Urdu postposition سے after the complete name with a space. The Latin product run remains intact. First-strong L versus AL varies with names. These traces do NOT prove paragraph base, font shaping, native visual order, punctuation placement or wrapping. No global bidi/font changes recommended.

Actual synthetic bracket + 35% tilde-padding strings for all seven are in record.json/audit.log; arguments survive. These are expansion RISK samples, not pseudo-render or native-fit proof. Compact heading expansion and arbitrary name length require a future rendered check; discovery help must not be abbreviated at the expense of either instruction.

Source inspection at move-sheet.tsx:466–508 confirms labels/status roles; `unreachable_reason?.trim() || t(no_answer)` leaves server reason unmodified and uses client fallback only for absent/blank text. Existing sidebar on_device is reused. This is source evidence, not executed behavior.

## Remaining gates
Fresh independent B pending. Source-hook evidence GAP OPEN. Native/render/layout evidence unverified and outside this lane. Human native waived. If a later audit finds a major, translator remediation and fresh audit are required; this auditor never edits the translation. No shipping/paired clearance claimed.
