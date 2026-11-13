# ur — M3 S2b-1 (mobile.computers + mobile.common + mobile.settings, 41 keys) — independent translation audit `urs2b1`

**Verdict: FAIL (`changes_requested`).** There are 0 BLOCKER, 2 MAJOR, 2 MINOR and 2 NIT findings. One further render-site code finding (C1) does not gate the translation.

- **Auditor:** i18n-auditor (lopdev), session b0aad2d5d851. **Model (actual):** anthropic/claude-opus-5-5, read from the session header. No fallback was used.
- **Translator:** translator job 6923cbfd363b. The auditor is independent of it.
- **Source commit:** 254e6fba.
- **Brief sha256:** d694b10a…b88e9. Recomputed; it matches.
- **Draft sha256:** 637ae2ca…b4a34. Recomputed; it matches.
- **Read route:** ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
- **Translation tools:** no MT service was used. One web search confirmed that iOS 26 offers Urdu as a system language.

## Mechanical — PASS
- **hashes:** brief and draft recomputed; both match
- **parse:** 41/41 ur and en parse with the repo's parseMessage (an identical copy of src/i18n/messages.ts @254e6fba, sha256 c1831406…), run with node 24 type-stripping and --max-old-space-size=256 in 0.4 s; formatMessage renders all 41
- **placeholders:** names and kinds are identical to English for every key
- **plurals:** Intl.PluralRules('ur') returns [one, other]. verdict_sessions and verdict_timeout have exactly one/other with # in both arms; rendered for n=0,1,2,8. سیکنڈ is invariant, which the style guide allows
- **negative_controls:** an unterminated plural, an arm without braces and an unclosed placeholder each throw RangeError
- **keys:** 41 = brief order; none added or dropped; none already in ur @254e6fba; the brief's English = en catalogue @254e6fba (41/41)
- **bidi_controls:** 0 in all 41 values (U+200E U+200F U+202A–202E U+2066–2069 U+061C)
- **ascii_punct:** none outside ICU syntax; Urdu ۔ ، ؛ ؟ and “ ” used
- **latin_initial:** only verdict_offline_detail ({detail}); confirmed by script; agrees with the translator
- **bidi_hazard_scan:** after substituting sample values, the only L+neutral+AL sequence is verdict_tls 'https:// پتہ' (URS2B1-01); {address} digits become AN after AL (W2) and stay intact; {command} at line end is clean
- **redaction_hits:** 0 literal in brief+draft; no harness masking seen in this session

## Findings

### URS2B1-01 — MAJOR — `mobile.computers.own_tunnel.verdict_tls`
- Current: اس ٹنل کا سرٹیفکیٹ مسترد ہو گیا۔ ٹنل کا دکھایا ہوا {scheme} پتہ استعمال کریں، ایسی ٹنل منتخب کریں جس کے سرٹیفکیٹ پر فون بھروسا کرے، یا اپنی چلائی ہوئی ٹنل کا خود دستخط شدہ سرٹیفکیٹ بدل دیں — ایپ یہ جانچ نہیں چھوڑے گی۔
- Problem: {scheme}='https://' is followed by a space and Urdu «پتہ». Under the UBA the neutrals '://' sit between L (https) and AL, so they take the RTL paragraph direction and render as '//:https' — the exact reorder the ur bidi-control exception records for http:// (bidi-controls.test.ts header). Controls are banned here, and {scheme} is not isolated at the call site (tunnel-verdict.ts:150, Alert body without dir). The reader is told to use the scheme they then see reversed.
- Suggested: اس ٹنل کا سرٹیفکیٹ مسترد ہو گیا۔ ٹنل کا دکھایا ہوا {scheme} URL استعمال کریں، ایسی ٹنل منتخب کریں جس کے سرٹیفکیٹ پر فون بھروسا کرے، یا اپنی چلائی ہوئی ٹنل کا خود دستخط شدہ سرٹیفکیٹ بدل دیں — ایپ یہ جانچ نہیں چھوڑے گی۔
- Why the fix works: 'https:// URL' keeps the neutrals between two L runs, so they resolve L; same shape as cloudflare_note/ngrok_note, which are clean, and URL is the catalogue's term in verdict_unreachable.

### URS2B1-02 — MAJOR — `mobile.computers.own_tunnel.verdict_local_network_ios`
- Current: … ترتیبات → رازداری اور سیکیورٹی → مقامی نیٹ ورک …
- Problem: U+2192 is bidi class ON and Bidi_Mirrored=No. In the RTL paragraph ترتیبات sits rightmost and each → points right, back at the item before it, so the arrows show the path backwards. This is the 'arrow mirrored wrongly' class from the RTL checklist. Apple's English source uses '>', which is mirrored; '→' is not.
- Suggested: … ترتیبات ← رازداری اور سیکیورٹی ← مقامی نیٹ ورک میں Local Operator کو اجازت دیں، پھر “{action}” پر ٹیپ کریں۔
- Note: iOS 26 added Urdu as a system language (source: netmag.pk, found by web search; the auditor has not checked it on a device). The three labels are plausible, but nobody has checked them against an Urdu iOS UI, so check them on a device. This does not gate.

### URS2B1-03 — MINOR — `mobile.computers.own_tunnel.install_note`
- Current: … اور اسے آپ کی کی چین میں رکھتی ہے۔
- Problem: «آپ کی کی چین»: the genitive particle کی is directly followed by کی (key), so the phrase reads as a stutter and parses ambiguously. The auditor found no Urdu macOS UI term to match, so Apple's own Latin name is the recognisable choice, as with macOS in the same sentence.
- Suggested: یہ کمانڈ macOS پر نگرانی میں چلنے والا ڈیمن انسٹال کرتی ہے جو رکنے پر خود دوبارہ شروع ہو جاتا ہے، ریلے کا پاس ورڈ بناتی ہے اور اسے Keychain میں رکھتی ہے۔

### URS2B1-04 — MINOR — `mobile.settings.own_tunnel.runtime_body`
- Current: اس بلڈ میں کوئی محفوظ کی اسٹور نہیں، …
- Problem: «محفوظ کی اسٹور» has the same particle collision: it can read as 'of the saved … store'. The note says keystore and secure store are one concept, and the catalogue term is محفوظ اسٹوریج.
- Suggested: اس بلڈ میں کوئی محفوظ اسٹوریج نہیں، اس لیے ٹنل صرف ایپ کے اس بار چلنے تک رکھی جاتی ہے۔ فون پر یہ معلومات پلیٹ فارم کے محفوظ اسٹوریج میں رکھی جاتی ہیں۔

### URS2B1-05 — NIT — `mobile.computers.own_tunnel.verdict_refused`
- Current: اس پتے نے جواب تو دیا، لیکن اس طرح نہیں جو یہ ایپ سمجھ سکے۔
- Problem: «اس طرح نہیں جو» is the wrong relative form; the natural form is جسے.
- Suggested: اس پتے نے جواب تو دیا، لیکن اس طرح نہیں جسے یہ ایپ سمجھ سکے۔

### URS2B1-06 — NIT — `mobile.common.copy_command_hint`
- Current: یہ {label} کی کمانڈ کاپی کرتا ہے
- Problem: {label} is usually an imperative phrase, so the hint becomes «یہ کمپیوٹر پر انسٹال کریں کی کمانڈ…», which is clumsy. والی reads better with a phrase.
- Suggested: یہ “{label}” والی کمانڈ کاپی کرتا ہے

### URS2B1-C1 — MAJOR (code, not translation; does not gate this locale's translation verdict) — `mobile.computers.own_tunnel.verdict_offline_detail`
- Current: {detail}۔ اس کمپیوٹر پر چلائیں: {command}
- Problem: This is the only Latin-initial value of the 41. {detail} is English server text, so dir=auto or natural resolves the paragraph LTR, and «۔ اس کمپیوٹر پر چلائیں:» then lands in the wrong place. There are three render sites and none spreads useComposedDir: own-tunnel.tsx:572 (VerdictBlock → Alert), own-tunnel-settings.tsx:138 and :237 (Alert). The Alert body Text (alert.tsx:100) takes no dir. The translation is correct and must keep {detail} first, because a prefix would invent copy. Fix: give the Alert a dir or labelDir pass-through from useComposedDir() at those three sites, and add offline_detail to the Q-02 Latin-initial premise in ur-latin-initial-sites.test.ts.
- Suggested: (code) <Alert … bodyDir={composedDir}>; no catalogue change

## Rulings on the translator's flags and the brief's questions
- **verdict_local_network_ios arrows:** Change → to ←; see URS2B1-02. → is not bidi-mirrored, so it points backwards in an RTL paragraph.
- **کی چین (keychain):** Replace it with Latin 'Keychain'; see URS2B1-03. The transliteration collides with the genitive کی, and no Urdu Apple term for keychain was found.
- **ماخذ (origin):** Accept it. ماخذ = source/origin, and the Latin '(origin)' gloss pins the web sense. The brackets resolve RTL by UBA N0 because the context before them is AL, so they mirror correctly. The meaning matches the trap: «کسی دوسرے ماخذ (origin) سے آنے والی ہر درخواست مسترد کرتا ہے» = refuses requests from any other origin.
- **کاپی کریں / ترمیم کریں widths:** Keep both. These are estimates, not measurements: Figtree has no Arabic glyphs, so a system Arabic or Nastaliq fallback font draws them. At about 15 pt each label is roughly 55–70 pt plus 24 pt padding, so about 80–95 pt, against about 55 pt for 'Copy'. Both rows are flex-wrap (command-block.tsx:55; own-tunnel-settings.tsx button row), so they wrap rather than clip. «کاپی کریں» and «کاپی ہو گیا» are nearly the same width, so the copied-state swap barely reflows. The bare «کاپی» would grow by about 2x on press. The …کریں form is the catalogue convention (محفوظ کریں، منسوخ کریں، استعمال کریں). Shorter forms are not better. Check the Nastaliq line height on a device.
- **verdict_offline_detail Latin-initial:** Keep the translation. The fix belongs at the render site; see URS2B1-C1.
- **install_note 'portal password' → ریلے کا پاس ورڈ:** Accept it. It is the relay password, which is the catalogue term.
- **verdict_local_network دبائیں vs _ios ٹیپ کریں:** Accept it. The iOS-only verb appears only on the _ios key.

## Cross-locale traps — checked
- **verdict_forbidden:** the relay refuses requests from any other origin. Correct.
- **Loopback:** «صرف اسی کمپیوٹر سے قابلِ رسائی». Correct.
- **Exposure and TLS warnings** keep their strength: «ایپ یہ جانچ نہیں چھوڑے گی». No copy nudges the reader to an insecure choice.
- **Register:** آپ throughout, with respectful imperatives.
- **Hindi-isation:** none (درکار، بشرطیکہ، قابلِ رسائی).
- **ٹنل:** feminine and consistent with the own_tunnel.* glossary.
- **ریلے:** masculine.
- **iOS verb:** ٹیپ کریں appears only on the _ios key.

## Per-key
| # | key | result | findings |
|---|---|---|---|
| 1 | computers.own_tunnel.install_label | ok |  |
| 2 | computers.own_tunnel.foreground_label | ok |  |
| 3 | computers.own_tunnel.check_label | ok |  |
| 4 | computers.own_tunnel.rotate_label | ok |  |
| 5 | computers.own_tunnel.install_note | ok_with_minor | URS2B1-03 |
| 6 | computers.own_tunnel.foreground_note | ok |  |
| 7 | computers.own_tunnel.check_note | ok |  |
| 8 | computers.own_tunnel.rotate_note | ok |  |
| 9 | computers.own_tunnel.cloudflare_note | ok |  |
| 10 | computers.own_tunnel.ngrok_note | ok |  |
| 11 | computers.own_tunnel.tunnel_rule | ok |  |
| 12 | computers.own_tunnel.verdict_sessions | ok |  |
| 13 | computers.own_tunnel.verdict_password | ok |  |
| 14 | computers.own_tunnel.verdict_forbidden | ok |  |
| 15 | computers.own_tunnel.verdict_offline_detail | ok (render-site code finding C1) | URS2B1-C1 |
| 16 | computers.own_tunnel.verdict_offline | ok |  |
| 17 | computers.own_tunnel.verdict_tls | changes_requested | URS2B1-01 |
| 18 | computers.own_tunnel.verdict_host | ok |  |
| 19 | computers.own_tunnel.verdict_unreachable | ok |  |
| 20 | computers.own_tunnel.verdict_timeout | ok |  |
| 21 | computers.own_tunnel.verdict_local_network_ios | changes_requested | URS2B1-02 |
| 22 | computers.own_tunnel.verdict_local_network | ok |  |
| 23 | computers.own_tunnel.verdict_refused | ok_with_minor | URS2B1-05 |
| 24 | computers.own_tunnel.remedy | ok |  |
| 25 | computers.own_tunnel.password_slot_other | ok |  |
| 26 | computers.own_tunnel.password_slot_empty | ok |  |
| 27 | computers.own_tunnel.password_slot_this | ok |  |
| 28 | common.copy | ok |  |
| 29 | common.copied | ok |  |
| 30 | common.copy_command_hint | ok_with_minor | URS2B1-06 |
| 31 | settings.own_tunnel.not_saved | ok |  |
| 32 | settings.own_tunnel.kept_secure | ok |  |
| 33 | settings.own_tunnel.edit | ok |  |
| 34 | settings.own_tunnel.test_again | ok |  |
| 35 | settings.own_tunnel.remove | ok |  |
| 36 | settings.own_tunnel.password_placeholder | ok |  |
| 37 | settings.own_tunnel.runtime_title | ok |  |
| 38 | settings.own_tunnel.runtime_body | ok_with_minor | URS2B1-04 |
| 39 | settings.own_tunnel.before_saving | ok |  |
| 40 | settings.own_tunnel.remove_title | ok |  |
| 41 | settings.own_tunnel.remove_body | ok |  |

## Notes
- The audit-ledger row was **not** written; the task restricted writes to this directory. The manager records it when the bundle lands under `i18n/audits/evidence/ur/`.
- Pre-existing, outside this audit: the offline verdict sentence already contains «On that computer: {command}», and VerdictBlock (own-tunnel.tsx:553) prints the remedy line again underneath. This happens in English too.
