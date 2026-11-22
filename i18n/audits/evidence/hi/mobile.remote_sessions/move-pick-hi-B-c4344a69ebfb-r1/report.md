# Hindi independent fresh B audit

Namespace: `mobile.remote_sessions` — ONLY seven `move_pick.*` draft values.
Source: `9362cce8a631791b676b2d2c9eda90c43fc7e11c`; translator `6b48875431ee`; A `94bfc6fb7b61`; independent B `c4344a69ebfb`.
Lane: hotfix audit, <=12 minutes. No repo writes.

## Provenance and limits
Executing-model verified receipt: **UNKNOWN**. Visible model-switch notice names `openai/gpt-6.1-sol`, temporary fallback from `anthropic/claude-opus-5-5` due to provider quota. That notice is not an independently verified per-execution receipt; no primary-model claim. Human-native review is waived by the brief; this is independent LLM judgement, not a human-native attestation.
Ordinary approved UTF-8 copy/context reads, dependency-free parsing and direct TSX usage inspection. Nested context/notes are metadata, not routable catalogue keys. No public-copy keyed-reader receipt is claimed. A conclusions were not treated as proof; independence identities come from the supplied ledger.

## Per-key side-by-side judgement

### `mobile.remote_sessions.move_pick.cannot_reach`
- English: Can't reach {device}
- Hindi: {device} से संपर्क नहीं हो पा रहा
- Linguistic verdict: CLEAN. से संपर्क नहीं हो पा रहा is idiomatic, calm reachability prose and matches existing unreachable. The opaque computer name remains exactly once, outside any translated spelling; it does not identify the phone as broken.

### `mobile.remote_sessions.move_pick.destination_heading`
- English: Move or copy to
- Hindi: ले जाने या कॉपी करने की जगह
- Linguistic verdict: CLEAN. ले जाने या कॉपी करने की जगह is a natural destination noun phrase, not an action button or a claim of progress. ले जाने is the grammatical infinitive of existing ले जाएँ, not a glossary substitution; कॉपी is unchanged.

### `mobile.remote_sessions.move_pick.discovery_help`
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Hindi: यह ऐप सिर्फ़ उन डिवाइसों को दिखा सकता है जिनके सत्र आपकी सूची में दिखते हैं। जिस डिवाइस का कोई सत्र नहीं दिखता, उसे अभी नहीं चुन सकते — दूसरे कंप्यूटर पर Local Operator खोलें, फिर सत्रों की सूची नीचे खींचकर रीफ़्रेश करें।
- Linguistic verdict: CLEAN. The visible-session restriction is explicit through सिर्फ़ and जिनके सत्र आपकी सूची में दिखते हैं. The next sentence preserves temporary non-selectability, another computer, opening Latin Local Operator, then pulling the session list downward to refresh. खोलें/करें maintain professional polite address; the generic नहीं चुन सकते does not introduce an informal तू/तुम register.

### `mobile.remote_sessions.move_pick.no_answer`
- English: It did not answer when this computer asked.
- Hindi: इस कंप्यूटर के अनुरोध पर उसने जवाब नहीं दिया।
- Linguistic verdict: CLEAN. इस कंप्यूटर के अनुरोध पर उसने जवाब नहीं दिया naturally distinguishes the asking relay computer from the non-answering remote computer. अनुरोध is an appropriate computer request, not an invented network diagnosis; server reasons retain precedence in the TSX.

### `mobile.remote_sessions.move_pick.no_devices`
- English: No other devices are visible.
- Hindi: कोई दूसरा डिवाइस नहीं दिख रहा।
- Linguistic verdict: CLEAN. कोई दूसरा डिवाइस नहीं दिख रहा states visibility only, not offline status or network nonexistence. Singular existential कोई is idiomatic for English plural no devices and does not require an ICU count.

### `mobile.remote_sessions.move_pick.on_this_computer`
- English: On this computer
- Hindi: इस कंप्यूटर पर
- Linguistic verdict: CLEAN. इस कंप्यूटर पर is an idiomatic location label using existing कंप्यूटर; its referent is the relay computer established by context, not a substituted phone.

### `mobile.remote_sessions.move_pick.right_now`
- English: Right now
- Hindi: अभी
- Linguistic verdict: CLEAN. अभी is a natural short temporal heading above current location, not an imperative to act now.

## Width findings (minor, deferred; no wording change recommended)

### HI-B-W1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
Current: {device} से संपर्क नहीं हो पा रहा
Proposed: retain `{device} से संपर्क नहीं हो पा रहा`; check wrapping in rendered parent QA.
Reason: 33 vs 20 source codepoints (+65%); arbitrary opaque device names can further expand the status. Retain accurate wording; parent should check narrow-phone wrapping. No rendered overflow demonstrated.

### HI-B-W2 — minor — `mobile.remote_sessions.move_pick.destination_heading`
Current: ले जाने या कॉपी करने की जगह
Proposed: retain `ले जाने या कॉपी करने की जगह`; check wrapping in rendered parent QA.
Reason: 27 vs 15 source codepoints (+80%); the compact radio-group heading may wrap. Retain accurate wording; parent should check narrow-phone wrapping. No rendered overflow demonstrated.

### HI-B-W3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
Current: यह ऐप सिर्फ़ उन डिवाइसों को दिखा सकता है जिनके सत्र आपकी सूची में दिखते हैं। जिस डिवाइस का कोई सत्र नहीं दिखता, उसे अभी नहीं चुन सकते — दूसरे कंप्यूटर पर Local Operator खोलें, फिर सत्रों की सूची नीचे खींचकर रीफ़्रेश करें।
Proposed: retain `यह ऐप सिर्फ़ उन डिवाइसों को दिखा सकता है जिनके सत्र आपकी सूची में दिखते हैं। जिस डिवाइस का कोई सत्र नहीं दिखता, उसे अभी नहीं चुन सकते — दूसरे कंप्यूटर पर Local Operator खोलें, फिर सत्रों की सूची नीचे खींचकर रीफ़्रेश करें।`; check wrapping in rendered parent QA.
Reason: 221 vs 178 source codepoints (+24.2%); multiline help has additional vertical-height risk. Retain accurate wording; parent should check narrow-phone wrapping. No rendered overflow demonstrated.

## Glossary, integrity and scope
Read actual existing Hindi remote_sessions and sidebar catalogues for कंप्यूटर, सत्र, रीफ़्रेश and move/copy usage. Existing `row_long_press_hint` is `वापस लाएँ, ले जाएँ या कॉपी करें`; new ले जाने/कॉपी matches it. डिवाइस is independently verified in existing `hi/mobile.composer_input.json`, key `mobile.composer_input.attach.camera_unavailable`: `इस डिवाइस पर कोई कैमरा उपलब्ध नहीं है।`; no competing new term is coined. This was a targeted glossary lookup, not an audit of that namespace. No wider diagnostic review is claimed.
Exact `{device}` once in cannot_reach; six argument-free messages. No count, plural/select branch, number/date skeleton or markup token in these seven English messages: ICU/CLDR plural/skeleton checks N/A. NFC and no bidi controls passed. Hindi is LTR: RTL-specific layout N/A. Latin Local Operator retained once. Source server reason trim-and-prefer branch preserved by direct source inspection, not runtime execution.
Source-codepoint measurements only; no native/render fit asserted. No pseudo catalogue in the inspected locale inventory, so pseudo measurement N/A, not fabricated. Redaction scan scope is the seven source/target/context rows, separate from path/hash/provenance metadata.

## Verdict
`mobile.remote_sessions` scoped seven-key namespace verdict: **PASS WITH THREE MINOR WIDTH RISKS**; 7/7 keys read, zero unresolved blocker/major findings. All seven are linguistically clean; the entire namespace/catalogue is NOT audited.
Overall B-only verdict: **PASS WITH MINORS**. This is NOT shipping approval. Pair acceptance awaits the parent verifying A+B bindings and all other gates. **SOURCEHOOKGAPOPEN remains OPEN** and is not fixed by this audit. No repo edit, commit, hook, test suite, compiler, build, dependency install, push, browser or native session was run.
