# Hindi independent A audit — move-pick-hi-94bfc6fb-r1

**Verdict: passed with minors; linguistic PASS, 7/7 keys read; 0 blocker/major.**
Namespace: `mobile.remote_sessions`, restricted to the seven `move_pick` keys. No whole-namespace or shipping clearance.

Frozen worktree: `/Users/damian/local-operator-mobile/.worktrees/i18n-move-sheet-copy` @ `9362cce8a631791b676b2d2c9eda90c43fc7e11c`.
Draft: `/Users/damian/.local-operator/sessions/6b48875431ee/scratchpad/draft-hi.json` SHA-256 `eedec3de1f87567b35790e88eb62109718fa268fd7654b7592d33ff509cd7f8d`.
Brief SHA-256: `5a72dfd72dc820b1fa8e73d78b97807581572334ee0fd25eb2eab346e759ebca`. All three authoring-file hashes independently matched.

## Independence and model
Auditor session `94bfc6fb7b61` is not translator `6b48875431ee`. Actual model **UNKNOWN**: no per-execution receipt. Visible fallback notice: `openai/gpt-6.1-sol`, from `anthropic/claude-opus-5-5`, provider quota; not asserted as independently verified execution model. Human-native review waived, not performed.

## Per-key assessment

### `mobile.remote_sessions.move_pick.cannot_reach` — passed_with_minor_width_risk
English: Can't reach {device}
Hindi: {device} से संपर्क नहीं हो पा रहा
Natural calm contact-failure status, using the existing संपर्क नहीं हो पा रहा wording; not a phone connection diagnosis. {device} remains once, opaque and uninflected internally. The postposition से follows the entire name.
Severity: minor. Codepoint proxy: 33 hi / 20 en; not native width.

### `mobile.remote_sessions.move_pick.destination_heading` — passed_with_minor_width_risk
English: Move or copy to
Hindi: ले जाने या कॉपी करने की जगह
ले जाने या कॉपी करने की जगह is an idiomatic nominal destination heading: it preserves both operations, matches existing ले जाएँ / कॉपी करें, and neither commands an action nor claims one started. No final punctuation.
Severity: minor. Codepoint proxy: 27 hi / 15 en; not native width.

### `mobile.remote_sessions.move_pick.discovery_help` — passed_with_minor_width_risk
English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
Hindi: यह ऐप सिर्फ़ उन डिवाइसों को दिखा सकता है जिनके सत्र आपकी सूची में दिखते हैं। जिस डिवाइस का कोई सत्र नहीं दिखता, उसे अभी नहीं चुन सकते — दूसरे कंप्यूटर पर Local Operator खोलें, फिर सत्रों की सूची नीचे खींचकर रीफ़्रेश करें।
Accurately limits selectable devices to visible sessions; does not claim network-wide discovery. जिस डिवाइस का कोई सत्र नहीं दिखता preserves the negative eligibility condition and अभी preserves yet. Polite खोलें then करें keeps आप-register and the required order: open Local Operator on the other computer, then pull the session list down to refresh. डिवाइसों/सत्रों are natural oblique inflections, not glossary drift; रीफ़्रेश matches the computer catalogue. Product name is Latin verbatim.
Severity: minor. Codepoint proxy: 221 hi / 178 en; not native width.

### `mobile.remote_sessions.move_pick.no_answer` — passed
English: It did not answer when this computer asked.
Hindi: इस कंप्यूटर के अनुरोध पर उसने जवाब नहीं दिया।
इस कंप्यूटर के अनुरोध पर उसने जवाब नहीं दिया naturally distinguishes the requesting relay computer from the previously identified remote computer. अनुरोध is standard UI Hindi, not an invented technical term; जवाब agrees with existing computer-response vocabulary. Source inspection, not execution, confirms this is only the absent/blank server-reason fallback.
Severity: none. Codepoint proxy: 45 hi / 43 en; not native width.

### `mobile.remote_sessions.move_pick.no_devices` — passed
English: No other devices are visible.
Hindi: कोई दूसरा डिवाइस नहीं दिख रहा।
कोई दूसरा डिवाइस नहीं दिख रहा preserves other and visibility; it does not claim offline devices or absence from the network. Singular grammar under कोई is natural and requires no numeric ICU plural.
Severity: none. Codepoint proxy: 30 hi / 29 en; not native width.

### `mobile.remote_sessions.move_pick.on_this_computer` — passed
English: On this computer
Hindi: इस कंप्यूटर पर
इस कंप्यूटर पर is the natural location fragment, parallel to existing {device} पर; कंप्यूटर correctly refers to the relay rather than the phone. Compact and unpunctuated.
Severity: none. Codepoint proxy: 14 hi / 16 en; not native width.

### `mobile.remote_sessions.move_pick.right_now` — passed
English: Right now
Hindi: अभी
अभी is idiomatic current-time framing above the location; absent an imperative it does not command immediate action. Short, neutral, and no final punctuation.
Severity: none. Codepoint proxy: 3 hi / 9 en; not native width.

## Findings (all non-gating, deferred width checks)

### H1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
Current: {device} से संपर्क नहीं हो पा रहा
Proposed text: {device} से संपर्क नहीं हो पा रहा (retain)
33 versus 20 source codepoints (65.0% expansion); wrapping is permitted but native fit is unverified; Devanagari codepoints do not measure glyph/cell width.
Retain accurate wording; verify narrow-phone wrapping/height in the owning rendered-validation lane. No translator rewrite required by this evidence.
deferred — rendered validation outside this read-only A linguistic audit; no minor-only remediation round

### H2 — minor — `mobile.remote_sessions.move_pick.destination_heading`
Current: ले जाने या कॉपी करने की जगह
Proposed text: ले जाने या कॉपी करने की जगह (retain)
27 versus 15 source codepoints (80.0% expansion); wrapping is permitted but native fit is unverified; Devanagari codepoints do not measure glyph/cell width.
Retain accurate wording; verify narrow-phone wrapping/height in the owning rendered-validation lane. No translator rewrite required by this evidence.
deferred — rendered validation outside this read-only A linguistic audit; no minor-only remediation round

### H3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
Current: यह ऐप सिर्फ़ उन डिवाइसों को दिखा सकता है जिनके सत्र आपकी सूची में दिखते हैं। जिस डिवाइस का कोई सत्र नहीं दिखता, उसे अभी नहीं चुन सकते — दूसरे कंप्यूटर पर Local Operator खोलें, फिर सत्रों की सूची नीचे खींचकर रीफ़्रेश करें।
Proposed text: यह ऐप सिर्फ़ उन डिवाइसों को दिखा सकता है जिनके सत्र आपकी सूची में दिखते हैं। जिस डिवाइस का कोई सत्र नहीं दिखता, उसे अभी नहीं चुन सकते — दूसरे कंप्यूटर पर Local Operator खोलें, फिर सत्रों की सूची नीचे खींचकर रीफ़्रेश करें। (retain)
221 versus 178 source codepoints (24.2% expansion); wrapping is permitted but native fit is unverified; Devanagari codepoints do not measure glyph/cell width.
Retain accurate wording; verify narrow-phone wrapping/height in the owning rendered-validation lane. No translator rewrite required by this evidence.
deferred — rendered validation outside this read-only A linguistic audit; no minor-only remediation round

## Integrity and evidence
Actual dependency-free checks are recorded in audit.log: pinned inputs, exact seven-key mapping, source/context equivalence, sole exact {device}, six no-argument messages, NFC, no bidi controls, redaction copy/metadata separation, negative controls, six opaque names and seven synthetic padded examples. CLDR plural N/A; no number/date/markup structures. Hindi is LTR; embedded names are opaque, not transliterated or normalized by this audit.
Static TSX inspection confirms `remoteDeviceLabel(session)` passed verbatim and `session.unreachable_reason?.trim() || t(...)` preserves server-reason priority. This is not runtime verification. Local Operator stays Latin verbatim. Glossary: कंप्यूटर / डिवाइस / सत्र / ले जाना / कॉपी करना; naturally inflected forms are consistent. Polite खोलें/करें matches आप-register; danda in prose and punctuation-free headings follow the style guide.
Ordinary approved local reads only; nested context is not a routable key and no public-copy reader receipt is claimed. No repository modifications, hooks, tests, compiler, build, installs, browser/native runs, commits or pushes.

## Remaining boundaries
**Source-hook evidence GAP OPEN. Fresh high-visibility B PENDING; no paired clearance.** Native/rendered overflow, shaping, glyph/cell widths and runtime behavior unverified. Codepoint expansion plus synthetic pseudolocalization are only risk proxies, not measured native layout; width minors remain deferred to the owning rendered lane.

## Final verdict
Namespace slice `mobile.remote_sessions`: linguistically clean, seven keys read; passed_with_minors for three deferred unrendered width risks. Overall A verdict: passed_with_minors, 0 unresolved blocker/major; no release/whole-UI/native/paired-audit approval.
