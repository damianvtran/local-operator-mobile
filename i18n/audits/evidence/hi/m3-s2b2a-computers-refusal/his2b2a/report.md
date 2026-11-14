# Hindi (hi) audit — m3-s2b2a-computers-refusal (24 keys)

Auditor: i18n-auditor (lopdev), session 42a9d3be53a4, model anthropic/claude-opus-5-5 (no fallback). Translator job ee0b2003be8e (independent).
Brief sha256 d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40 · draft sha256 e24b300418f841277a2d3c6cab80d3086a92ff3b765d2fe7eaaaf0a87a35dd03 · redaction hits 0/0.

## Verdict: **changes_requested** (1 MAJOR, 1 MINOR, 2 NIT)

Mechanical: 24/24 keys, order equal, ICU parse 24/24 via repo messages.ts, placeholders identical, hi plural one/other with # in each arm, 0 bidi/ZW controls, NFC, buttons 14–20 chars (budget 24).

## Findings

### HI-1 — MAJOR — `mobile.computers.refusal.console_title`
- Current: {subject} को Radient में ध्यान देने की ज़रूरत है।
- Problem: 'X को [verb]-ने की ज़रूरत है' makes X the agent: this reads 'X needs to pay attention in Radient' (the computer/address must attend), not 'X needs (your) attention'. Agency inverted; unidiomatic for the intended meaning.
- Suggested: {subject} को Radient में आपके ध्यान की ज़रूरत है।
- Alternative: {subject} पर Radient में ध्यान देना ज़रूरी है।

### HI-2 — MINOR — `mobile.computers.refusal.sign_in_next`
- Current: फिर से कनेक्ट करने के लिए दोबारा साइन इन करें। इससे पहले टाइप किया गया सब कुछ क्वारंटीन में है, भेजा नहीं गया।
- Problem: क्वारंटीन is understood but carries a medical (COVID) connotation and reads as a calque for text; 'भेजा नहीं गया' (was not sent) states only the past, while the note's promise is that it will NOT be sent even after signing in. A native phrase keeps the strong 'held aside' sense without softening to 'saved'.
- Suggested: फिर से कनेक्ट करने के लिए दोबारा साइन इन करें। इससे पहले टाइप किया गया सब कुछ अलग रोक दिया गया है और भेजा नहीं जाएगा।

### HI-N1 — NIT — `mobile.computers.refusal.password_next`
- Current: कंप्यूटर पर रिले पासवर्ड जाँचें, फिर दोबारा कोशिश करें।
- Problem: The button that follows says 'फिर से कोशिश करें' (try_again); echoing its exact wording ties the advice to the button, as the English does. 'फिर … फिर से' would double, so join with और.
- Suggested: कंप्यूटर पर रिले पासवर्ड जाँचें और फिर से कोशिश करें।

### HI-N2 — NIT — `mobile.computers.refusal.tunnel_gone_next`
- Current: Radient में फिर से टनल बनाएँ, फिर यह कंप्यूटर जोड़ें।
- Problem: 'फिर से … फिर' repeats फिर in one short sentence; the only fix is a new tunnel, which 'नई टनल' says directly.
- Suggested: Radient में नई टनल बनाएँ, फिर यह कंप्यूटर जोड़ें।

## Rulings

- **tunnel_gone_title**: Accepted. '{subject} अब कोई टनल नहीं है।' needs no gender agreement (copula है only), works for a name or a URL, and कोई carries 'no longer ANY tunnel'.
- **console_title**: Tone is calm and appropriate once fixed; current construction inverts agency → HI-1 MAJOR.
- **sign_in_next**: क्वारंटीन is not wrong (accurate, widely understood) so not MAJOR; native 'अलग रोक दिया गया है … भेजा नहीं जाएगा' preferred → HI-2 MINOR. Do NOT use सहेजा/रखा गया alone (softens to 'saved').
- **try_now_try_again**: Accepted reusing 'अभी कोशिश करें' / 'फिर से कोशिश करें'. Separate keys allow divergent wording but do not require it; on this screen each label sits under copy that names the connection, so the shared text is unambiguous. Note sibling diagnostic button mobile.computers.retry='दोबारा कोशिश करें' mirrors English Retry≠Try again — fine.
- **sign_in_title_session**: Accepted साइन-इन instead of glossary सत्र: here 'session' is the Radient auth sign-in, while सत्र on this surface means agent sessions (wait.relay_sessions). Justified, documented deviation; not a glossary violation of the agent-session concept.

## Per-key

- `mobile.computers.refusal.offline_title`: OK
- `mobile.computers.refusal.relay_stopped_title`: OK
- `mobile.computers.refusal.tunnel_gone_title`: OK
- `mobile.computers.refusal.console_title`: MAJOR HI-1
- `mobile.computers.refusal.password_title`: OK
- `mobile.computers.refusal.sign_in_title`: OK
- `mobile.computers.refusal.retry_title`: OK
- `mobile.computers.refusal.certificate_title`: OK
- `mobile.computers.refusal.host_title`: OK
- `mobile.computers.refusal.offline_next`: OK
- `mobile.computers.refusal.relay_stopped_next`: OK
- `mobile.computers.refusal.tunnel_gone_next`: NIT HI-N2
- `mobile.computers.refusal.console_next`: OK
- `mobile.computers.refusal.password_next`: NIT HI-N1
- `mobile.computers.refusal.sign_in_next`: MINOR HI-2
- `mobile.computers.refusal.retry_next`: OK
- `mobile.computers.refusal.certificate_next`: OK
- `mobile.computers.refusal.host_next`: OK
- `mobile.computers.refusal.wait_seconds`: OK
- `mobile.computers.refusal.try_now`: OK
- `mobile.computers.refusal.try_again`: OK
- `mobile.computers.refusal.sign_in_again`: OK
- `mobile.computers.refusal.open_console`: OK
- `mobile.computers.refusal.another_address`: OK
