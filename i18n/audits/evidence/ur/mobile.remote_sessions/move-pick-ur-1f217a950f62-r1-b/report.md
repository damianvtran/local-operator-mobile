# Independent fresh Urdu B audit

Audit `move-pick-ur-1f217a950f62-r1-b` · Session `1f217a950f62` · 2026-11-22

## Verdict
**mobile.remote_sessions / seven move_pick keys: PASS WITH MINORS. Overall B: PASS WITH MINORS.**
Seven keys read side by side against actual English, nested context, picker usage and existing Urdu terminology. **0 unresolved blocker/major; 3 deferred minor width/RTL-render risks; no linguistic correction required.** This verdict covers exactly seven keys, not the complete namespace, broader Arabic or whole app.

Frozen worktree: `/Users/damian/local-operator-mobile/.worktrees/i18n-move-sheet-copy` @ `9362cce8a631791b676b2d2c9eda90c43fc7e11c`. Brief SHA-256 `5a72dfd72dc820b1fa8e73d78b97807581572334ee0fd25eb2eab346e759ebca`; draft SHA-256 `e4da7bd8528a3f24622878a2d93e7c1b820771b01d16cf6ba23b639176ff068b`. All three frozen authoring hashes matched actual bytes.

## Independence and model
Translator `bd4d8a762e59`, A auditor `3ebdc948939c`, B auditor `1f217a950f62`: separate actors. I froze my per-key judgment before reading A's verdict. I did not author or alter translation copy or edit the worktree. A's report subsequently read from `/Users/damian/.local-operator/sessions/3ebdc948939c/scratchpad/bundles/ur/mobile.remote_sessions/move-pick-ur-3ebdc948-r1-a/report.md` reports PASS WITH MINORS; my conclusion agrees independently.

Verified serving model **UNKNOWN**, no independent serving receipt. Visible switch notice reports temporary **openai/gpt-6.1-sol** fallback from anthropic/claude-opus-5-5 due to quota failure; this audit ran after that notice. No unsupported model-verification claim. Human native review waived, not performed; this is an LLM linguistic judgment, not human-native certification.

## Per-key English/Urdu and judgment

### `mobile.remote_sessions.move_pick.cannot_reach` — PASS_WITH_DEFERRED_MINOR_RISK
- English: Can't reach {device}
- Current Urdu: {device} سے رابطہ نہیں ہو رہا
- B judgment: Natural ongoing-contact failure: رابطہ نہیں ہو رہا matches the existing unreachable wording. The named remote computer remains the target; it does not blame the phone.
- Mechanical: placeholders ['{device}'], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

### `mobile.remote_sessions.move_pick.destination_heading` — PASS_WITH_DEFERRED_MINOR_RISK
- English: Move or copy to
- Current Urdu: منتقل یا کاپی کرنے کی جگہ
- B judgment: منتقل یا کاپی کرنے کی جگہ is a natural nominal destination heading, not an imperative. Both operations are preserved. Longer than English: rendered wrapping check deferred, not a semantic defect.
- Mechanical: placeholders [], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

### `mobile.remote_sessions.move_pick.discovery_help` — PASS_WITH_DEFERRED_MINOR_RISK
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Current Urdu: یہ ایپ صرف وہ ڈیوائسز دکھا سکتی ہے جن کے سیشن فہرست میں نظر آتے ہیں۔ جس ڈیوائس کا کوئی سیشن نظر نہیں آ رہا، اسے ابھی منتخب نہیں کیا جا سکتا — دوسرے کمپیوٹر پر Local Operator کھولیں، پھر سیشن کی فہرست کو نیچے کھینچ کر تازہ کریں۔
- B judgment: Accurately restricts selectable devices to those with visible sessions. دکھا سکتی ہے is appropriate for offering visible choices here, not a promise of complete discovery. ابھی preserves the temporary limitation; کھولیں and تازہ کریں are respectful imperatives. The other-computer instruction and downward pull-to-refresh instruction both survive. Local Operator stays Latin.
- Mechanical: placeholders [], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

### `mobile.remote_sessions.move_pick.no_answer` — PASS
- English: It did not answer when this computer asked.
- Current Urdu: جب اس کمپیوٹر نے رابطہ کیا تو اس نے جواب نہیں دیا۔
- B judgment: جب اس کمپیوٹر نے رابطہ کیا تو اس نے جواب نہیں دیا۔ naturally contrasts the contacting current computer with the remote non-answering subject. The second اس refers back to the remote status immediately above, as English It does. No phone substitution or invented cause.
- Mechanical: placeholders [], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

### `mobile.remote_sessions.move_pick.no_devices` — PASS
- English: No other devices are visible.
- Current Urdu: کوئی اور ڈیوائس نظر نہیں آ رہی۔
- B judgment: کوئی اور ڈیوائس نظر نہیں آ رہی۔ means no other device is visible, not that no device exists or is online. Singular agreement under کوئی is idiomatic Urdu and preserves the English empty-set claim.
- Mechanical: placeholders [], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

### `mobile.remote_sessions.move_pick.on_this_computer` — PASS
- English: On this computer
- Current Urdu: اس کمپیوٹر پر
- B judgment: اس کمپیوٹر پر is concise and accurate for the current relay-computer location. کمپیوٹر matches the existing catalogue; no phone wording.
- Mechanical: placeholders [], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

### `mobile.remote_sessions.move_pick.right_now` — PASS
- English: Right now
- Current Urdu: اس وقت
- B judgment: اس وقت is idiomatic for present state under this section heading and avoids an urgent command reading.
- Mechanical: placeholders [], NFC true, no inserted bidi controls. ICU/CLDR plural categories and number/date skeletons N/A for this simple template.

## Glossary and register
Current remote-session/sidebar copy and shared glossary use کمپیوٹر, ڈیوائس, سیشن, منتقل, کاپی, رابطہ and تازہ کریں. ڈیوائسز in the discovery sentence is ordinary loanword plural inflection, not glossary drift from singular ڈیوائس. Commands کھولیں / تازہ کریں preserve respectful آپ register; no تم/تو mismatch. Local Operator remains exactly Latin. Full stops use ۔ and the compact headings/location fragment have no final punctuation. This is not an audit of unrelated existing copy.

## Findings — non-gating, no copy rewrite

### UR-B1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
- Current: {device} سے رابطہ نہیں ہو رہا
- Proposed: {device} سے رابطہ نہیں ہو رہا
- Reason: 29 versus 20 source codepoints (ratio 1.45) is an expansion-risk signal, not measured glyph width or proof of overflow. Arbitrary opaque names can expand without bound and alter first-strong direction.
- Translator recommendation: Retain accurate wording; do not shorten at the cost of meaning or insert bidi controls. Owning rendered lane should check narrow-phone wrapping/height.
- Disposition: deferred — non-gating width/render risk; no linguistic remediation required

### UR-B2 — minor — `mobile.remote_sessions.move_pick.destination_heading`
- Current: منتقل یا کاپی کرنے کی جگہ
- Proposed: منتقل یا کاپی کرنے کی جگہ
- Reason: 25 versus 15 source codepoints (ratio 1.6667) is an expansion-risk signal, not measured glyph width or proof of overflow.
- Translator recommendation: Retain accurate wording; do not shorten at the cost of meaning or insert bidi controls. Owning rendered lane should check narrow-phone wrapping/height.
- Disposition: deferred — non-gating width/render risk; no linguistic remediation required

### UR-B3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
- Current: یہ ایپ صرف وہ ڈیوائسز دکھا سکتی ہے جن کے سیشن فہرست میں نظر آتے ہیں۔ جس ڈیوائس کا کوئی سیشن نظر نہیں آ رہا، اسے ابھی منتخب نہیں کیا جا سکتا — دوسرے کمپیوٹر پر Local Operator کھولیں، پھر سیشن کی فہرست کو نیچے کھینچ کر تازہ کریں۔
- Proposed: یہ ایپ صرف وہ ڈیوائسز دکھا سکتی ہے جن کے سیشن فہرست میں نظر آتے ہیں۔ جس ڈیوائس کا کوئی سیشن نظر نہیں آ رہا، اسے ابھی منتخب نہیں کیا جا سکتا — دوسرے کمپیوٹر پر Local Operator کھولیں، پھر سیشن کی فہرست کو نیچے کھینچ کر تازہ کریں۔
- Reason: 227 versus 178 source codepoints (ratio 1.2753) is an expansion-risk signal, not measured glyph width or proof of overflow.
- Translator recommendation: Retain accurate wording; do not shorten at the cost of meaning or insert bidi controls. Owning rendered lane should check narrow-phone wrapping/height.
- Disposition: deferred — non-gating width/render risk; no linguistic remediation required

## Fresh mechanical evidence and limitations
`audit.log` contains the actual dependency-free Python command/output, exit 0, hash checks, seven-key English/context comparisons, exact placeholders/braces, NFC and Unicode-bidi-control checks. In-memory negative controls detect missing device, inserted RLM and missing key. No repo/runtime mutation occurred. Explicit marker patterns and separate source-copy, draft-copy, brief-copy and metadata scan counts are recorded; all zero. These are marker checks, not a secret audit. Ordinary approved file reads were used; no keyed public-copy receipt is invented. Nested context objects are not public-key-routable.

The actual picker source passes remoteDeviceLabel verbatim to {device}; a trimmed nonblank server unreachable_reason wins over the client fallback. This is a source inspection result, not app execution. Server-provided reasons are not translated here.

Source-logical traces cover StudioMac, Mac(2), دفتر-Mac(2), Mac-گھر ۲ and intact Local Operator. Device codepoints/bytes remain unchanged. Name-first first-strong direction can be L or AL: paragraph base direction requires the owning renderer's constraint and has not been verified here. Traces are NOT proof of native order, shaping, parentheses orientation, isolation, line wrapping or fit. No Unicode bidi controls were inserted. Codepoint expansion is a width RISK indicator, not pixel measurement, pseudo-render proof or native proof. No browser/native, testsuite, compiler, hooks, build, install or push was run.

**Source-hook evidence GAP remains OPEN.** B does not resolve it or claim paired-gate completion; parent must verify the paired artifacts and separate source-hook gate. No broader shipping approval.
