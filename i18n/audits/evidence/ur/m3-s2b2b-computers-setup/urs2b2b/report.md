# ur audit — M3 S2b-2b (mobile.computers.setup / route_invalid / your_computer)

Auditor: i18n-auditor (lopdev), session e12483c5cbc6, model anthropic/claude-opus-5-5 (no fallback). Translator job 21e12a3778c1 (independent).
Brief sha256 9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67 ✔ · Draft sha256 aa7a5029f089a8920eb21700b64f01b8a45ee492fce87f4f845a10a1fd121c63 ✔ · redaction markers: brief 0, draft 0.

**Verdict: passed** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT.

## Mechanical
- 27/27 keys, brief order; NFC; placeholders identical per key; no plural/select in slice; all 27 parse with e0027e61 messages.ts; formatted outputs in audit.log.
- 0 bidi controls (U+200E/F, U+202A–E, U+2066–9, U+061C) in all 27 values.
- Urdu letters (ک ی ہ), no Arabic kaf/yeh/heh, no Devanagari; Urdu punctuation ۔ ، only; no ASCII . , after Urdu letters.
- Latin-initial values: only setup.tui_label = "TUI".

## Findings
- **UR-S2B2B-1 MINOR** `mobile.computers.route_invalid.not_address`
  - current: یہ پتہ نہیں لگتا۔ یہ {scheme} URL ہونا چاہیے۔
  - problem: 'یہ پتہ نہیں لگتا' collides with the very common idiom 'پتہ نہیں لگتا' (= 'one can't tell / can't make out'); a native reader can first parse it as 'this can't be figured out'. Context recovers the meaning, so not MAJOR. Second sentence ('should be a {scheme} URL' for 'should start with {scheme}') is an acceptable, bidi-driven equivalent.
  - replacement: یہ کسی پتے جیسا نہیں لگتا۔ یہ {scheme} URL ہونا چاہیے۔
- **UR-S2B2B-2 MINOR** `mobile.computers.setup.address_help`
  - current: اگر آپ کا ریلے کسی ایسے URL پر دستیاب ہے جو آپ پہلے سے جانتے ہیں، تو ریلے کے اپنے پاس ورڈ سے اس سے منسلک ہوں۔ یہ اس مشین کا راستہ ہے جو Radient پر بالکل نہیں ہے۔
  - problem: 'یہ اس مشین کا راستہ ہے' reads as 'this is that (specific) machine's path/way', not 'this is the route for a machine that…'; and 'پاس ورڈ سے اس سے منسلک ہوں' stacks two سے and is clunky.
  - replacement: اگر آپ کا ریلے کسی ایسے URL پر دستیاب ہے جو آپ پہلے سے جانتے ہیں، تو ریلے کے اپنے پاس ورڈ کے ساتھ اس سے منسلک ہوں۔ یہ طریقہ ایسی مشین کے لیے ہے جو Radient پر بالکل نہیں ہے۔
- **UR-S2B2B-3 NIT** `mobile.computers.route_invalid.insecure_off`
  - current: یہ پتہ خفیہ کاری کے بغیر ہے، اس لیے ریلے کا پاس ورڈ نیٹ ورک پر کھلے عام جاتا ہے۔ جاری رکھنے کے لیے سادہ http کی اجازت والا اختیار آن کریں۔
  - problem: Switch naming is acceptable (bare 'http' renders as one LTR run; the on-screen label needs isolates this key may not carry). Adding 'پتے' tracks the visible label 'سادہ http:// پتے کی اجازت دیں' more closely.
  - replacement: یہ پتہ خفیہ کاری کے بغیر ہے، اس لیے ریلے کا پاس ورڈ نیٹ ورک پر کھلے عام جاتا ہے۔ جاری رکھنے کے لیے سادہ http پتے کی اجازت والا اختیار آن کریں۔

## Rulings (bidi/terminology)
- **http_public_IP_addition**: ACCEPTED. 'IP' is meaning-exact (192.168.x.x is an IP address) and necessary: CoreText probe shows 'مثلاً IP 192.168.x.x' renders as one LTR run, while the control without 'IP' renders the digits as AN and displays 'x.x.192.168'.
- **scheme_URL_pattern**: ACCEPTED. '{scheme} URL' / 'سادہ {insecure} URL' keep '://' between two L runs → resolved L; CoreText shows 'https:// URL' and 'http:// URL' intact. Control 'یہ https:// سے…' displays '://' as an RTL run left of 'https' (i.e. //:https).
- **amount_placeholder**: OK. '<amount>' angle brackets resolve R and are glyph-mirrored → displays '<amount>'; 'lop tunnel create' one LTR run.
- **insecure_off_switch_name**: ACCEPTED (see NIT UR-S2B2B-3).
- **your_computer**: ACCEPTED. Bare 'کمپیوٹر' is invariant direct/oblique singular and reads grammatically in all six ur refusal headlines at origin/feat/i18n-m3-s2b2; loss of 'your' is the stated trade-off. Headline {subject} grammar is a known CODE item, not judged here.
- **tui_label**: Only Latin-initial value. setup-computer.tsx@e0027e61 sets no direction on the CommandBlock label (command-block.tsx label Text has no LTR_TEXT); a single strong-L token has nothing to reorder (CoreText: one LTR run) and aligns to the row start under the RTL root. No CODE item needed. Android native unverified (docs/i18n.md known gap).
- **billing_fallback_reorder**: ACCEPTED: reorder avoids a Latin-initial paragraph. Observation (pre-existing, out of slice, non-gating): existing ur mobile.computers.disabled_help starts with 'Radient'; on native iOS an un-directed Text with natural base direction would take an LTR paragraph from it — unverified on device.

## Per-key notes (no finding)
intro, billing_title (matches billing_help 'ریموٹ رسائی فعال'), create_title (ٹنل f.), create_help, terminal_label, amount_note (imperative reframing preserves meaning; کمانڈ f. 'کرتی' consistent with catalogue), tui_help, watching, ran_it (first person kept; 27 chars on full-width button), attach_title, attach_help (آئی ڈی f.), tunnel_id_label, attach_label (imperative label consistent with existing install_label; hint '“جوڑیں” والی کمانڈ' reads fine), address_title, empty, scheme, credentials (صارف نام per catalogue), query, http_public, not_radient, no_tunnel_id (reserved; 'نیا سیشن جاری' = re-mint), your_computer. Register آپ throughout; no Hindi-isation. Width: no button/label overflow risk.
