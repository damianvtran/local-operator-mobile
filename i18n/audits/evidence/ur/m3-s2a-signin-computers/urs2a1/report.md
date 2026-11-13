# ur audit — M3 S2a (37 keys) — audit_id urs2a1

Auditor: i18n-auditor (lopdev), session a8e16e74ea5e, model anthropic/claude-opus-5-5 (no fallback observed). Translator: translator job 0c099a230364 (not me). Source 59ec5184. Brief e64f41af…a563 and draft c19ceeb7…e464 recomputed: match. Style guide ur.md 7276e962…, glossary 0eb34437… (~/local-operator origin/main 73dc4157).

**Verdict: PASSED (catalogue copy)** — 0 BLOCKER, 0 MAJOR in copy; 1 MINOR, 3 NIT. **Plus two render-site MAJORs (R1, R2) and one fit risk (R3) for the coder; none needs a catalogue change.**

## Mechanical
parseMessage@59ec5184: 37/37 parse, param sets identical ({name}, `{command}` with backticks, ({module}) — all text). Tokens Radient/http:///https:///HTTPS/URL counts equal to English; 0 bidi control chars; no keys added/dropped; ۔ for every English full stop, … kept, none on headings; آپ register throughout.

**Latin-initial (test rule: drop ICU slots, first letter):** 0 of 37 — translator claim CONFIRMED. Placeholder-initial: `own_tunnel.password_for` (see R1).

## Copy findings
- **U1 MINOR** `mobile.computers.banner.unreachable_empty` — "کی فہرست کے لیے ... رابطہ" reads "contact for the list" — the purpose verb is missing, so the clause is slightly ungrammatical-sounding.
  - Current: آپ کے کمپیوٹرز کی فہرست کے لیے Radient سے رابطہ نہیں ہو سکا۔ اس ڈیوائس کا کنکشن جانچیں۔
  - Suggested: آپ کے کمپیوٹرز کی فہرست لانے کے لیے Radient سے رابطہ نہیں ہو سکا۔ اس ڈیوائس کا کنکشن جانچیں۔
- **U2 NIT** `mobile.computers.own_tunnel.intro` — "اس سب کے لیے" is a calque of "for any of this"; "اختیار" (control) collides with the same word used two steps later for the plain-http opt-in ("یہ اختیار", "اوپر والا اختیار"); "کے ذریعے" twice in one sentence.
  - Current: اس سب کے لیے Radient اکاؤنٹ درکار نہیں۔ آپ اپنے کمپیوٹر پر چلنے والے ریلے کو ایسی ٹنل کے ذریعے دستیاب کرتے ہیں جو آپ کے اپنے اختیار میں ہو، اور ایپ اس پتے کے ذریعے اس سے رابطہ کرتی ہے جو آپ نیچے چسپاں کریں گے۔
  - Suggested: اس میں کہیں بھی Radient اکاؤنٹ درکار نہیں۔ آپ اپنے کمپیوٹر پر چلنے والے ریلے کو ایسی ٹنل سے دستیاب کرتے ہیں جسے آپ خود چلاتے ہیں، اور ایپ اس سے اس پتے کے ذریعے رابطہ کرتی ہے جو آپ نیچے چسپاں کریں گے۔
- **U3 NIT** `mobile.computers.own_tunnel.step_publish` — Accepted (consistent with paths.own_body «دستیاب کرتے»); a bare «اسے» heading under numeral 2 does not say WHERE it becomes available.
  - Current: اسے دستیاب کریں
  - Suggested: اسے انٹرنیٹ پر دستیاب کریں
- **U4 NIT** `mobile.computers.own_tunnel.security_heading` — Object ("it" = the computer) dropped; the heading reads "before bringing onto the internet" with no subject.
  - Current: انٹرنیٹ پر لانے سے پہلے
  - Suggested: اسے انٹرنیٹ پر لانے سے پہلے

## Render-site findings (code, not catalogue)
- **R1 MAJOR (render site, not catalogue)** `mobile.computers.own_tunnel.password_for` — site src/features/auth/own-tunnel.tsx:342 (heading Text, no dir). Placeholder-initial: the first-letter rule in ur-latin-initial-sites.test.ts drops {name} so it cannot see this. With a Latin computer name the paragraph base resolves LTR (first strong char). Derived visual order (UBA, LTR base): "Studio Mac ںیرک جرد ڈرو ساپ اک" — an Urdu reader reads «کا پاس ورڈ درج کریں» first and the name last, the D2 class; heading ragged to the wrong edge. RTL base gives the correct order.
  - Fix: Spread {...composedDir} (useComposedDir, already in scope at own-tunnel.tsx:93) onto that Text; add the key to the test as a placeholder-initial site (own list), since the catalogue value is correct and must not change. Pre-existing same-class value (not this slice): added.connected_to «{name} سے منسلک ہو گیا۔».
- **R2 MAJOR (render site, not catalogue)** `mobile.computers.own_tunnel.insecure_allow, mobile.computers.own_tunnel.insecure_allowed, mobile.computers.own_tunnel.insecure_off_help, mobile.computers.own_tunnel.unencrypted_body` — site own-tunnel.tsx:460-483 (Button label, help Text, Alert body). Literal scheme followed by Urdu: the "://" neutrals sit between L ("http") and R (Urdu) and take the RTL paragraph direction (UBA N1/N2), so the token renders "//:http" / "//:https" (derived with a minimal UBA pass: insecure_allow -> "//:http ہداس", unencrypted_body -> "//:https یئوک"). Brief notes require these schemes "unchanged and left-to-right". No ur value at 59ec5184 contains "://", so this is new with S2a.
  - Fix: Isolate the scheme as an LTR island at the render site (nested Text with LTR_WRITING / web unicode-bidi isolate), per docs/i18n.md "needs explicit isolation at the component"; no bidi controls in the catalogue (ur style guide). Android ignores writingDirection — needs a device frame.
- **R3 MINOR-to-MAJOR (fit, estimate only; engineering)** `mobile.computers.title.set_up, mobile.computers.title.list` — site src/ui/size-class.ts:457 computersHeaderStackWidth uses English widths 227/138. Figtree (all 3 weights) has 0 Arabic-script glyphs (cmap parsed: 392 codepoints), so Urdu falls back to a system face. Unshaped isolated-form advance sums at 28 dp −0.02 em: set_up 242 (Geeza/Nastaliq UI) – 291 (SF Arabic) – 353/376 (Noto Nastaliq Urdu reg/bold) vs 227 budget; list 114–184 vs 138. Shaping narrows Naskh joins, so real widths are lower but likely at/over budget for set_up -> the D10 "Comp…" clip can recur. Nastaliq is also taller (line-height clip risk). Not measured on a device.
  - Fix: No copy change recommended (wording is natural and glossary-consistent with paths.own_title). Measure the title per locale (or stack on measured overflow) and take a ur device frame. Shorter fallback only if engineering declines: «کمپیوٹر جوڑیں» (est 152–274 dp) — weaker meaning.

## Per-key rulings
- `mobile.computers.title.list` — ACCEPT. Matches list.heading «آپ کے کمپیوٹرز». Fit: see R3.
- `mobile.computers.title.set_up` — ACCEPT copy (imperative, = paths.own_title «ترتیب دیں»). Fit risk R3 is engineering.
- `mobile.computers.banner.unreachable_stale` — ACCEPT. Reordered to open in Urdu; «شاید پرانی ہو» = may be out of date; no retry promise.
- `mobile.computers.banner.unreachable_empty` — U1 MINOR.
- `mobile.computers.banner.unreadable_stale` — ACCEPT.
- `mobile.computers.banner.unreadable_empty` — ACCEPT. «فہرست نہیں بن سکی» = could not be listed; no retry promise.
- `mobile.computers.own_tunnel.title` — ACCEPT. ٹنل feminine per catalogue («اپنی ٹنل»).
- `mobile.computers.own_tunnel.password_for` — ACCEPT copy; {name} intact (parseMessage name:text). Direction: R1 (render site).
- `mobile.computers.own_tunnel.password_label` — ACCEPT. = ریلے glossary.
- `mobile.computers.own_tunnel.intro` — ACCEPT meaning; U2 NIT.
- `mobile.computers.own_tunnel.step_computer` — ACCEPT. No numeral added.
- `mobile.computers.own_tunnel.step_computer_help` — ACCEPT. «صرف اپنے ہی کمپیوٹر سے کنکشن قبول کرتا ہے» = same machine only, not LAN; «سونے نہ دیں» = keep awake, object «اس کمپیوٹر».
- `mobile.computers.own_tunnel.step_publish` — RULING on translator uncertainty: ACCEPT «اسے دستیاب کریں» (glossary continuity with paths.own_body); optional U3 NIT. Wrapping step heading, width not a constraint.
- `mobile.computers.own_tunnel.step_app` — ACCEPT.
- `mobile.computers.own_tunnel.url_label` — ACCEPT. URL kept Latin per style guide; Urdu-initial.
- `mobile.computers.own_tunnel.insecure_allow` — ACCEPT copy; token intact. Bidi R2.
- `mobile.computers.own_tunnel.insecure_allowed` — ACCEPT copy. Bidi R2.
- `mobile.computers.own_tunnel.insecure_hint` — ACCEPT. «بغیر خفیہ کاری کے» = in the clear (avoids «غیر خفیہ»); http kept.
- `mobile.computers.own_tunnel.insecure_on_help` — ACCEPT. States «آن:» first; warning direct; nearest-conjunct agreement «ہر چیز … گزرتی ہے» is grammatical.
- `mobile.computers.own_tunnel.insecure_off_help` — ACCEPT. «تب تک بند رہتا ہے جب تک آپ اسے آن نہ کریں» is neutral (no nudge); «اسے» -> «یہ اختیار» (opt-in); «وہی» -> https://. Bidi R2 (two schemes).
- `mobile.computers.own_tunnel.unencrypted_title` — ACCEPT.
- `mobile.computers.own_tunnel.unencrypted_body` — ACCEPT. «اس پتے کو استعمال کرنے کے لیے» = it is the address; «اوپر والا اختیار» = the opt-in above; «دکھاتی» fem ٹنل. Bidi R2.
- `mobile.computers.own_tunnel.private_host` — RULING on translator uncertainty: ACCEPT «خطرہ» — in a warning line "the exposure is limited to it" is natively «خطرہ اسی نیٹ ورک تک محدود ہے»; scope (that network) preserved.
- `mobile.computers.own_tunnel.public_host` — ACCEPT. Strong: anything on the path phone->address can read the password.
- `mobile.computers.own_tunnel.step_test` — ACCEPT. «جانچ کریں» avoids repeating the button label.
- `mobile.computers.own_tunnel.step_test_help` — ACCEPT.
- `mobile.computers.own_tunnel.security_heading` — ACCEPT; U4 NIT.
- `mobile.computers.own_tunnel.security_body` — ACCEPT. Tunnel-auth clause conditional («اگر آپ کی ٹنل … دیتی ہے تو اسے بھی فعال کریں») = "where yours does"; `{command}` with backticks intact; HTTPS/URL Latin; «اس کمپیوٹر کے سیشن چلا سکتا ہے» = drive sessions.
- `mobile.computers.own_tunnel.test` — ACCEPT. Same wording reused in need_test.
- `mobile.computers.own_tunnel.testing` — ACCEPT. Full-row stacked button (own-tunnel.tsx:255), est 92–142 dp at 16 dp: no overflow.
- `mobile.computers.own_tunnel.save_connect` — ACCEPT. Full-row stacked button, est 163–257 dp unshaped vs ~343 dp column: fits. «منسلک ہوں» correct آپ imperative.
- `mobile.computers.own_tunnel.saving` — ACCEPT. = existing «محفوظ ہو رہا ہے»; est 96–150 dp: fits.
- `mobile.computers.own_tunnel.need_address` — ACCEPT.
- `mobile.computers.own_tunnel.need_test` — ACCEPT. Names the button «کنکشن جانچیں» identically; ergative «جس ٹنل نے … جواب نہ دیا ہو» correct.
- `mobile.computers.own_tunnel.verdict_ok` — ACCEPT. = existing value.
- `mobile.computers.own_tunnel.verdict_not_yet` — ACCEPT. Calm.
- `mobile.signin.panel.unavailable_detail` — ACCEPT. Urdu-initial; «لوپ بیک لسنر ({module})» keeps the id beside the listener term; parentheses resolve correctly around an LTR id (both brackets between L and R take R and mirror).

## Not verified
No device/browser frame (catalogue audit, read-only); R1/R2 derived from the Unicode bidi algorithm, R3 from unshaped advances. The RTL design/QA round owns the frames.

