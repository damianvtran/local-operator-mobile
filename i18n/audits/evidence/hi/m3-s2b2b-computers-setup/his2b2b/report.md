# Hindi (hi) audit — M3 S2b-2b computers setup

Auditor: i18n-auditor (lopdev), session 49ff9c33b2d7, model anthropic/claude-opus-5-5 (no fallback observed). Independent of translator job b8d8cd17b9d9.

**Verdict: passed** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT.

Mechanical: 27/27 keys, same order, parseMessage OK for all, placeholders identical, no bidi controls, NFC, no ICU plurals in slice (hi CLDR one/other not exercised). Redaction-marker count 0 (brief and draft).

## Findings
### HI-1 MINOR — `mobile.computers.route_invalid.http_public`
- Current: {insecure} की अनुमति सिर्फ़ निजी पते के लिए है। {scheme} का उपयोग करें, या {example} जैसा कोई निजी होस्ट।
- Problem: Second sentence leaves 'या {example} जैसा कोई निजी होस्ट' dangling after the verb; reads as an unfinished clause in Hindi.
- Suggested: {insecure} की अनुमति सिर्फ़ निजी पते के लिए है। {scheme} का उपयोग करें, या {example} जैसे किसी निजी होस्ट का।

### HI-2 MINOR — `mobile.computers.route_invalid.no_tunnel_id`
- Current: इस टनल की कोई आईडी नहीं है, इसलिए इसका साइन-इन दोबारा जारी नहीं किया जा सकता। कंप्यूटर फिर से खोजें।
- Problem: 'साइन-इन दोबारा जारी' is an awkward collocation (a sign-in is not 'issued'), and जारी also reads as 'continued'. Reserved string, meaning still recoverable.
- Suggested: इस टनल की कोई आईडी नहीं है, इसलिए इसका साइन-इन नए सिरे से नहीं बनाया जा सकता। कंप्यूटर फिर से खोजें।

### HI-3 NIT — `mobile.computers.setup.watching`
- Current: टनल का इंतज़ार है
- Problem: Acceptable colloquially; a progressive form matches the catalogue's in-progress labels (जाँच हो रही है…, सहेजा जा रहा है…).
- Suggested: टनल का इंतज़ार हो रहा है

## Rulings requested
- **mobile.computers.your_computer**: ACCEPT bare 'कंप्यूटर'. Verified against the six hi refusal headlines on origin/feat/i18n-m3-s2b2 (offline, relay_stopped +पर, tunnel_gone, console +को, sign_in +से, retry): all grammatical. 'आपका' would break the postposition headlines. Other {subject} values (computer name, base URL, 'Radient') are also bare nouns, so it is consistent. Pre-existing tunnel_gone_title mirrors odd English ('is no longer a tunnel') — out of scope, known CODE item.
- **mobile.computers.setup.attach_label**: ACCEPT जोड़ें. Matches attach_title and tunnel_gone_next (यह कंप्यूटर जोड़ें); copy hint renders “जोड़ें” वाली कमांड कॉपी करता है, which reads fine.
- **आईडी**: ACCEPT — standard Hindi UI rendering; consistent across attach_help, tunnel_id_label, no_tunnel_id.
- **क्वेरी स्ट्रिंग / फ़्रैगमेंट**: ACCEPT — usual transliterated technical terms; no native equivalent in use.
- **re-mint**: CHANGE wording, see HI-2 (MINOR).
- **discovery (कंप्यूटर फिर से खोजें)**: ACCEPT — describes what discovery does (re-reading the account's computers) in reader terms.

## Other keys
All remaining 23 keys accepted: meaning faithful, register matches existing hi catalogue (रिले, टनल f., कंप्यूटर, पासवर्ड, कंसोल, कनेक्टर, कमांड f., स्लीप में नहीं जाना, सपोर्ट, ऐक्सेस, उपयोग करें), Radient/Local Operator/TUI/URL/http:// kept Latin. insecure_off quotes on-screen switch label own_tunnel.insecure_allow verbatim (correct label while switch is off). Buttons ran_it/watching fit a 320 pt full-width button.

Read route: ordinary git/scratchpad reads; read_public_copy not used (core route refuses mobile catalogue paths); context sidecars are nested JSON and not routable.
