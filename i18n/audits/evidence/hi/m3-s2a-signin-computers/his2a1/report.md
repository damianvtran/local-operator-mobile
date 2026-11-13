# hi audit — M3 S2a (37 keys) — audit_id his2a1

Auditor: i18n-auditor (lopdev), session 0716fa1a942c, model anthropic/claude-opus-5-5 (no fallback). Translator: translator job 4753e146fd04. Source 59ec5184. Brief e64f41af…a563 and draft 8f1e2d15…ce0 recomputed: match.

**Verdict: PASSED** — 0 BLOCKER, 0 MAJOR; 2 MINOR, 2 NIT (suggested replacements below, non-gating).

## Mechanical
parseMessage@59ec5184: 37/37 parse, params identical ({name}, `{command}`, ({module}) all text). Tokens Radient, http://, https://, HTTPS, URL intact; no keys added/dropped; order = brief; NFC; । for every English full stop, … kept, no stop on headings; आप register throughout.

## Findings
- **H1 MINOR** `mobile.computers.own_tunnel.insecure_off_help` — In "जब भी पता इसे सपोर्ट करे, https:// का ही उपयोग करें" the fronted clause puts इसे before its referent, so it first reads as "this option" (the http opt-in) from the previous sentence.
  - Current: http:// पर आपका रिले पासवर्ड नेटवर्क से बिना एन्क्रिप्शन के गुज़रता है, इसलिए यह विकल्प डिफ़ॉल्ट रूप से बंद रहता है। जब भी पता इसे सपोर्ट करे, https:// का ही उपयोग करें।
  - Suggested: http:// पर आपका रिले पासवर्ड नेटवर्क से बिना एन्क्रिप्शन के गुज़रता है, इसलिए यह विकल्प डिफ़ॉल्ट रूप से बंद रहता है। जब भी पता https:// सपोर्ट करे, उसी का उपयोग करें।
- **H2 MINOR** `mobile.computers.title.set_up` — Note asks for an imperative title; "New computer" is a noun phrase and reads oddly when the account has no computers. Width is not the constraint: imperative options fit.
  - Current: नया कंप्यूटर
  - Suggested: कंप्यूटर जोड़ें (= mobile.computers.add; est 126.8 dp vs 226.2) — or कंप्यूटर सेट अप करें (est 200.6 dp, unshaped upper bound)
- **H3 NIT** `mobile.computers.own_tunnel.intro` — ज़रिये repeated within one sentence.
  - Current: …टनल के ज़रिये प्रकाशित करते हैं, और ऐप उससे उसी पते के ज़रिये बात करता है…
  - Suggested: …और ऐप उससे उस पते से बात करता है जिसे आप नीचे चिपकाते हैं।
- **H4 NIT** `mobile.computers.own_tunnel.step_computer_help` — Catalogue and this draft elsewhere use उपयोग.
  - Current: ऐप इस्तेमाल करते समय…
  - Suggested: ऐप का उपयोग करते समय कंप्यूटर को स्लीप में न जाने दें।

## Rulings
- `mobile.computers.title.list` — ACCEPT. Kohinoor Devanagari Semibold (iOS fallback; Figtree has 0 Devanagari glyphs) unshaped estimate 77.9 dp vs 137.8 budget.
- `mobile.computers.title.set_up` — H2 MINOR: noun phrase "New computer" where the note asks for an imperative; fits (123.9 dp est vs 226.2).
- `mobile.computers.own_tunnel.intro` — H3 NIT: ज़रिये twice in one sentence.
- `mobile.computers.own_tunnel.step_computer_help` — ACCEPT meaning: loopback = connections from its own (same) computer, not LAN; 1.37x is wrapping help text. H4 NIT: इस्तेमाल vs catalogue/draft उपयोग.
- `mobile.computers.own_tunnel.step_publish` — ACCEPT 1.80x: explicit object रिले resolves "it"; wrapping step heading; ~110.6 dp at 16 dp est.
- `mobile.computers.own_tunnel.insecure_off_help` — Ruling: "डिफ़ॉल्ट रूप से बंद रहता है" ACCEPT — no nudge; the only action changing it is the user's toggle, so off-by-default = off unless you turn it on. H1 MINOR: fronted clause makes इसे cataphoric and briefly readable as the http opt-in.
- `mobile.computers.own_tunnel.unencrypted_body` — ACCEPT: "इस पते का उपयोग" = it is the address; ऊपर वाला विकल्प = the opt-in; टनल fem agreement दिखाती ✓.
- `mobile.computers.own_tunnel.public_host` — ACCEPT: names the whole path phone→address; anything on it can read the password; strong.
- `mobile.computers.own_tunnel.step_test` — Ruling ACCEPT जाँच करें: natural step heading; distinct from button like English; need_test reuses the button wording as required.
- `mobile.computers.own_tunnel.security_body` — ACCEPT: tunnel-auth clause = turn on your tunnel's own authentication if it offers one; consistent; `{command}` intact.
- `mobile.computers.own_tunnel.testing` — ACCEPT 1.88x: busy label of the same button, 95.7 vs idle कनेक्शन जाँचें 86.4 (16 dp est).
- `mobile.computers.own_tunnel.saving` — ACCEPT 2.29x: matches catalogue सहेजा जा रहा है; 108.4 < idle सहेजें और कनेक्ट करें 130.4 (16 dp est).
- `mobile.computers.own_tunnel.save_connect` — ACCEPT 1.31x: button label, same width class as catalogue buttons.
- `mobile.computers.own_tunnel.verdict_ok` — ACCEPT 1.44x: wrapping box title; matches catalogue कनेक्ट हो गया.
- `mobile.signin.panel.unavailable_detail` — ACCEPT: ({module}) directly after लूपबैक लिसनर; Radient kept.

## Width
Figtree SemiBold has **no Devanagari glyphs** (0 in U+0900–097F): all Hindi renders in the platform fallback. Calibration reproduces Computers 137.8 / Set up a computer 226.2 dp. Hindi titles ESTIMATED with Kohinoor Devanagari Semibold (iOS fallback), unshaped advance sums at 28 dp −0.02 em (upper-ish bound; shaped conjuncts are narrower): कंप्यूटर 77.9 vs 137.8; नया कंप्यूटर 123.9 vs 226.2. Both fit. Android (Noto Sans Devanagari) not measured.

## Per-key results
| Key | hi | Result |
|---|---|---|
| `title.list` | कंप्यूटर | pass |
| `title.set_up` | नया कंप्यूटर | pass_with_minor |
| `banner.unreachable_stale` | Radient से संपर्क नहीं हो सका, इसलिए यह सूची पुरानी हो सकती है। | pass |
| `banner.unreachable_empty` | आपके कंप्यूटरों की सूची लाने के लिए Radient से संपर्क नहीं हो सका। इस डिवाइस का कनेक्शन जाँचें। | pass |
| `banner.unreadable_stale` | Radient का जवाब पढ़ा नहीं जा सका, इसलिए यह सूची पुरानी हो सकती है। | pass |
| `banner.unreadable_empty` | Radient का जवाब पढ़ा नहीं जा सका, इसलिए आपके कंप्यूटरों की सूची नहीं बन सकी। | pass |
| `own_tunnel.title` | अपनी टनल | pass |
| `own_tunnel.password_for` | {name} का पासवर्ड डालें | pass |
| `own_tunnel.password_label` | रिले पासवर्ड | pass |
| `own_tunnel.intro` | इसमें कहीं भी Radient खाते की ज़रूरत नहीं है। आप रिले को अपने कंप्यूटर पर, अपने नियंत्रण वाली टनल के ज़रिये प्रकाशित करते हैं, और ऐप उससे उसी पते के ज़रिये बात करता है जिसे आप नीचे चिपकाते हैं। | pass_with_nit |
| `own_tunnel.step_computer` | कंप्यूटर पर | pass |
| `own_tunnel.step_computer_help` | रिले सिर्फ़ अपने ही कंप्यूटर से आए कनेक्शन स्वीकार करता है, इसलिए उसे इसी कंप्यूटर पर चलाना होगा। ऐप इस्तेमाल करते समय कंप्यूटर को स्लीप में न जाने दें। | pass_with_nit |
| `own_tunnel.step_publish` | रिले प्रकाशित करें | pass |
| `own_tunnel.step_app` | ऐप में | pass |
| `own_tunnel.url_label` | सार्वजनिक URL | pass |
| `own_tunnel.insecure_allow` | सादे http:// पते की अनुमति दें | pass |
| `own_tunnel.insecure_allowed` | सादे http:// की अनुमति है | pass |
| `own_tunnel.insecure_hint` | सिर्फ़ http वाले पते के लिए ज़रूरी, जो पासवर्ड बिना एन्क्रिप्शन के भेजता है | pass |
| `own_tunnel.insecure_on_help` | चालू: रिले पासवर्ड और आपकी भेजी हर चीज़ इस नेटवर्क से बिना एन्क्रिप्शन के गुज़रती है। ऐसा सिर्फ़ भरोसेमंद नेटवर्क पर करें। | pass |
| `own_tunnel.insecure_off_help` | http:// पर आपका रिले पासवर्ड नेटवर्क से बिना एन्क्रिप्शन के गुज़रता है, इसलिए यह विकल्प डिफ़ॉल्ट रूप से बंद रहता है। जब भी पता इसे सपोर्ट करे, https:// का ही उपयोग करें। | pass_with_minor |
| `own_tunnel.unencrypted_title` | यह पता एन्क्रिप्टेड नहीं है | pass |
| `own_tunnel.unencrypted_body` | इस पते का उपयोग करने के लिए ऊपर वाला विकल्प चालू करें, या https:// पता दें — टनल आम तौर पर ऐसा पता दिखाती है। | pass |
| `own_tunnel.private_host` | यह पता आपके अपने नेटवर्क पर है, इसलिए जोखिम उसी नेटवर्क तक सीमित है। | pass |
| `own_tunnel.public_host` | यह पता निजी नहीं है — इस फ़ोन से उस पते तक के रास्ते में मौजूद कोई भी चीज़ पासवर्ड पढ़ सकती है। | pass |
| `own_tunnel.step_test` | जाँच करें | pass |
| `own_tunnel.step_test_help` | कुछ भी सहेजने से पहले यह आपकी टनल के ज़रिये एक असली अनुरोध भेजता है। | pass |
| `own_tunnel.security_heading` | इंटरनेट पर खोलने से पहले | pass |
| `own_tunnel.security_body` | आप अपने ही कंप्यूटर को इंटरनेट पर खोल रहे हैं, और उसकी सुरक्षा में सिर्फ़ रिले पासवर्ड खड़ा है। HTTPS को प्राथमिकता दें, अगर आपकी टनल अपना प्रमाणीकरण देती है तो उसे चालू करें, और अगर पासवर्ड किसी के साथ साझा हुआ है तो उसे `{command}` से बदल दें। जिसके पास वह पासवर्ड और आपका URL है, वह उस मशीन के सत्र चला सकता है। | pass |
| `own_tunnel.test` | कनेक्शन जाँचें | pass |
| `own_tunnel.testing` | जाँच हो रही है… | pass |
| `own_tunnel.save_connect` | सहेजें और कनेक्ट करें | pass |
| `own_tunnel.saving` | सहेजा जा रहा है… | pass |
| `own_tunnel.need_address` | जारी रखने के लिए अपनी टनल का पता चिपकाएँ। | pass |
| `own_tunnel.need_test` | पहले कनेक्शन जाँचें — जिस टनल ने एक बार भी जवाब नहीं दिया, उसे सहेजना ठीक नहीं। | pass |
| `own_tunnel.verdict_ok` | कनेक्ट हो गया | pass |
| `own_tunnel.verdict_not_yet` | अभी नहीं | pass |
| `signin.panel.unavailable_detail` | Radient से साइन इन करने के लिए एक लूपबैक लिसनर ({module}) चाहिए, जो इस बिल्ड में शामिल नहीं है। | pass |
