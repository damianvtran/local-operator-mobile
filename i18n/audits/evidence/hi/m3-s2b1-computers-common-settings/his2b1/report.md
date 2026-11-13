# hi — M3 S2b-1 (mobile.computers + mobile.settings + mobile.common, 41 keys) — independent translation audit `his2b1`

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 6 MINOR, 2 NIT.

- **Auditor:** i18n-auditor (team lopdev), session 3c631e8c8e6f. **Model (actual):** anthropic/claude-opus-5-5 (session header); no fallback used.
- **Translator:** translator job 1cd7f1f0d760 — auditor is independent of it.
- **Source commit:** 254e6fba (worktree HEAD verified).
- **Brief sha256:** d694b10abcfb07f94aebdaca55fb5a80929575f90282661f20cfae4f1b0b88e9 — recomputed, matches.
- **Draft sha256:** 2ff6e86a39a38e670efd4266b809744e989b4a809f42a8a4f3dde395212b8d2c — recomputed, matches.
- **Read route:** ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
- **Redaction hits:** 0 (brief, draft, files read). No MT/translation service used.

## Mechanical — PASS (executed; see audit.log)
- 41/41 en and hi parse with repo `parseMessage`; keys identical and in brief order; none already in the hi catalogue; brief English == en catalogue at 254e6fba (41/41).
- Placeholder names identical per key; `#` counts identical; plurals render with `formatMessage` locale hi at 0,1,2,10 (0,1→one; 2,10→other) — hi CLDR categories one/other both present.
- Negative controls (3 malformed messages) throw RangeError.
- 0 bidi/zero-width controls; macOS, ngrok, HTTPS, URL, Local Operator kept Latin; no तुम, कृपया, “!”.
- No maxCells/maxChars hints in brief or en sidecars; widths estimated (below).

## Findings
### HIS2B1-01 — MINOR — `mobile.common.copy_command_hint`
- Current: {label} वाली कमांड कॉपी करता है
- Problem: Translator flag confirmed: with an imperative label the hint reads as two run-together verbs ('कंप्यूटर पर इंस्टॉल करें वाली कमांड कॉपी करता है'). Quoting the label marks it as a name; works for product names too.
- Suggested: “{label}” वाली कमांड कॉपी करता है

### HIS2B1-02 — MINOR — `mobile.computers.own_tunnel.verdict_refused`
- Current: उस पते ने जवाब दिया, लेकिन इस तरह नहीं जिसे यह ऐप समझ सके।
- Problem: Mismatched correlative: 'इस तरह नहीं जिसे' (तरह … जिसे) is ungrammatical/stiff.
- Suggested: उस पते ने जवाब दिया, लेकिन ऐसा जवाब नहीं जिसे यह ऐप समझ सके।

### HIS2B1-03 — MINOR — `mobile.settings.own_tunnel.remove_body`
- Current: इससे इस फ़ोन पर सहेजा गया पता और पासवर्ड हट जाता है। आपके कंप्यूटर, आपकी चलाई टनल या किसी खाते पर इसका कोई असर नहीं पड़ता।
- Problem: Agreement: conjoined subject 'पता और पासवर्ड' takes plural; draft has singular 'हट जाता है' while kept_secure uses plural 'रखे हैं' for the same pair.
- Suggested: इससे इस फ़ोन से पता और पासवर्ड, दोनों हट जाते हैं। आपके कंप्यूटर, आपकी चलाई टनल या किसी खाते पर इसका कोई असर नहीं पड़ता।

### HIS2B1-04 — MINOR — `mobile.computers.own_tunnel.rotate_note`
- Current: यह कमांड पासवर्ड आपसे अलग से पूछती है, ताकि वह कभी शेल हिस्ट्री या प्रोसेस सूची में न पहुँचे। ऐप नीचे यही पासवर्ड माँगता है।
- Problem: 'अलग से पूछती है' (asks separately) blurs 'interactively' — the point is the command prompts in the terminal rather than taking the value on the command line. Also 'प्रोसेस सूची' half-translates next to the loan 'शेल हिस्ट्री'.
- Suggested: यह कमांड पासवर्ड टर्मिनल में आपसे पूछती है, ताकि वह कभी शेल हिस्ट्री या प्रोसेस लिस्ट में न पहुँचे। ऐप नीचे यही पासवर्ड माँगता है।

### HIS2B1-05 — MINOR — `mobile.settings.own_tunnel.runtime_body`
- Current: इस बिल्ड में कोई सुरक्षित कीस्टोर नहीं है, इसलिए टनल सिर्फ़ इसी रन के लिए रखी जाती है। फ़ोन पर यह मान प्लेटफ़ॉर्म के सुरक्षित स्टोरेज में रखा जाता है।
- Problem: 'इसी रन के लिए' is a calque of 'this run'; 'रन' is not a settled loan in this catalogue. 'यह मान' (value) is technical where the subject is the saved tunnel.
- Suggested: इस बिल्ड में कोई सुरक्षित कीस्टोर नहीं है, इसलिए टनल सिर्फ़ ऐप के इस बार चलने तक रहती है। फ़ोन पर इसे प्लेटफ़ॉर्म के सुरक्षित स्टोरेज में रखा जाता है।

### HIS2B1-06 — MINOR — `mobile.computers.own_tunnel.verdict_local_network_ios`
- Current: इस नेटवर्क पर उस पते से कोई जवाब नहीं आया। जाँचें कि कंप्यूटर स्लीप में नहीं है और उस पर रिले चल रहा है। अगर दोनों ठीक हैं, तो वजह लोकल नेटवर्क की अनुमति हो सकती है: सेटिंग्ज़ → गोपनीयता और सुरक्षा → स्थानीय नेटवर्क में Local Operator को अनुमति दें, फिर “{action}” पर टैप करें।
- Problem: Menu path 'सेटिंग्ज़ → गोपनीयता और सुरक्षा → स्थानीय नेटवर्क' matches my best knowledge of iOS Hindi labels (Apple writes सेटिंग्ज़ with nukta, not the app's own 'सेटिंग'), but I cannot verify on a device or Apple glossary here: UNVERIFIED, non-gating. Rest of sentence correct: 'हो सकती है' keeps 'may'; टैप only here.
- Suggested: Keep as drafted; verify the three labels on a Hindi-locale iPhone (or Apple's hi glossary) before release.

### HIS2B1-N1 — NIT — `mobile.computers.own_tunnel.verdict_forbidden`
- Current: उस टनल ने ऐप को अस्वीकार कर दिया। अगर आपने उसके आगे कोई एक्सेस पॉलिसी या लॉगिन पेज लगाया है, तो ऐप को गुज़रने दें; रिले ख़ुद भी किसी दूसरे ओरिजिन (साइट या ऐप) से आए अनुरोध अस्वीकार करता है, इसलिए पक्का करें कि टनल सीधे {address} पर फ़ॉरवर्ड करे, किसी डैशबोर्ड या दूसरे ऐप पर नहीं।
- Problem: 'एक्सेस' — catalogue has both spellings, majority 'ऐक्सेस' (रिमोट ऐक्सेस ×2 vs एक्सेस ×1).
- Suggested: …कोई ऐक्सेस पॉलिसी या लॉगिन पेज लगाया है…

### HIS2B1-N2 — NIT — `mobile.computers.own_tunnel.password_slot_other`
- Current: यह फ़ोन एक ही रिले पासवर्ड रखता है, और वह किसी दूसरे पते का है। इस कंप्यूटर का पासवर्ड डालें, उसे जाँचें, फिर सहेजें। यह पुराने पासवर्ड की जगह ले लेगा।
- Problem: 'एक ही' can read as 'the same'; final 'यह' is ambiguous (phone vs new password).
- Suggested: यह फ़ोन सिर्फ़ एक रिले पासवर्ड रखता है, और वह किसी दूसरे पते का है। इस कंप्यूटर का पासवर्ड डालें, उसे जाँचें, फिर सहेजें। नया पासवर्ड पुराने की जगह ले लेगा।

## Rulings on translator's uncertain keys
- **mobile.computers.own_tunnel.verdict_local_network_ios**: Plausible and matches my knowledge; unverified on device -> HIS2B1-06 (MINOR, non-gating).
- **mobile.computers.own_tunnel.install_note**: ACCEPT 'रिले पासवर्ड' for 'portal password': it is the same secret the app asks for (catalogue password_label = रिले पासवर्ड; rotate_note 'the password the app asks for below'); 'portal' is internal jargon. 'कीचेन' matches Apple's hi term (कीचेन ऐक्सेस) to my knowledge.
- **mobile.computers.own_tunnel.verdict_forbidden**: ACCEPT 'ओरिजिन (साइट या ऐप)': living web-dev loan, gloss makes it readable; polarity correct (relay refuses requests from any OTHER origin). Only the ऐक्सेस spelling nit.
- **mobile.common.copy_command_hint**: Stiffness confirmed -> HIS2B1-01 (MINOR).
- **mobile.common.copy/copied**: ACCEPT widths. Estimate (not measured): Figtree has no Devanagari glyphs, so system fallback (iOS Kohinoor Devanagari / Android Noto Sans Devanagari). At the sm label size ~14pt: 'Copy' ~33pt, 'कॉपी करें' ~60-65pt, 'कॉपी हो गया' ~75-80pt, plus padding; the label row is flex-wrap with no fixed button width, so no overflow even at 200% on 320pt. Visual check of matra/ascender clipping in the sm button is a design item, not a copy finding.

## Cross-locale traps — all clear
verdict_forbidden polarity correct; loopback rendered 'सिर्फ़ लूपबैक पर — यानी केवल इसी कंप्यूटर से'; verdict_tls keeps 'ऐप यह जाँच नहीं छोड़ेगा' and does not nudge to insecure options; आप throughout; 'टैप करें' only on _ios, 'दबाएँ' on the Android/web key; glossary terms (टनल f., रिले m., सत्र, जाँचें, सहेजें, हटाएँ, चिपकाएँ, डालें, उपयोग) consistent with ffbda180.

## Accepted as drafted (selected)
verdict_offline_detail: danda after the English `{detail}` is acceptable in a Hindi UI. verdict_sessions with 0 → 'one' arm per hi style guide.

## Claims not made
No rendered-frame measurement, no device check of iOS labels, no ledger command run (task restricted writes to this directory).
