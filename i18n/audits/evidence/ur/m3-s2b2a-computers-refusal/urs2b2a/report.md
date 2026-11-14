# Urdu (ur) audit — M3 S2b-2a mobile.computers.refusal.* (24 keys)

**Verdict: changes_requested** — BLOCKER 0 · MAJOR 1 · MINOR 1 · NIT 2 · CODE 2

Brief sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` · Draft sha256 `46211c4e2757deca94e7eab22fd61c95c49f20a83e419929d71d2b5ea7e1233b` · translator job 3e9cacebe527 · auditor anthropic/claude-opus-5-5 (session ae9561e2347a, no fallback) · redaction-marker hits in brief: 0

## Mechanical (executed; see audit.log)
Key set and order match (24/24). Placeholders match for every key. All 24 parse with the repo's messages.ts. The ur CLDR categories are one/other, and wait_seconds has both arms with #. No bidi controls (U+200E/F, U+202A–E, U+2066–9, U+061C) in any value. Text is NFC. No Arabic yeh/kaf/heh variants and no Devanagari. Every sentence ends with ۔.

## Findings
### UR-F1 MAJOR — `mobile.computers.refusal.sign_in_next`
- Current: دوبارہ منسلک ہونے کے لیے پھر سے سائن ان کریں۔ اس سے پہلے ٹائپ کیا گیا سب کچھ قرنطینہ میں رکھ دیا گیا ہے، بھیجا نہیں گیا۔
- Problem: Accuracy on a data-safety promise. 'بھیجا نہیں گیا' (past: 'has not been sent') states only what has happened so far. Right after 'sign in again to reconnect', an Urdu reader can take it as 'not sent yet, it will go once you reconnect'. The context note forbids exactly that reading: the text is held aside and will NOT be sent, even after signing back in.
- Replace with: دوبارہ منسلک ہونے کے لیے پھر سے سائن ان کریں۔ اس سے پہلے ٹائپ کیا گیا سب کچھ قرنطینہ میں رکھ دیا گیا ہے اور بھیجا نہیں جائے گا۔

### UR-F2 MINOR — `mobile.computers.refusal.console_title`
- Current: اس وقت Radient میں {subject} پر توجہ درکار ہے۔
- Problem: The 'اس وقت' (at the moment) opener was added only so the line does not start with Latin. It brings in a sense of something temporary that the source and context lack: the fix is in the console and does not clear on its own. The retry/offline titles mean temporary; this one does not.
- Replace with: آپ کو Radient میں {subject} پر توجہ دینی ہوگی۔

### UR-F3 NIT — `mobile.computers.refusal.sign_in_title`
- Current: … {subject} سے دوبارہ منسلک ہونے کے لیے سائن ان کریں۔
- Problem: The existing catalogue translates the same English phrase 'Sign in to reconnect' (mobile.chrome.home.sign_in) as 'دوبارہ رابطے کے لیے سائن ان کریں'. Both terms are idiomatic, so aligning on one is optional.
- Replace with: آپ کے Radient سیشن کی میعاد ختم ہو گئی ہے۔ {subject} سے دوبارہ رابطے کے لیے سائن ان کریں۔

### UR-F4 NIT — `mobile.computers.refusal.offline_next`
- Current: … جانچیں کہ کنیکٹر چل رہا ہے۔ اس کی آخری معلوم حالت اوپر دی گئی ہے۔
- Problem: 'اس کی' directly follows کنیکٹر, so it reads as the connector's state. The context says it is the computer's last known state.
- Replace with: اس کمپیوٹر کو جگائیں، اور جانچیں کہ کنیکٹر چل رہا ہے۔ کمپیوٹر کی آخری معلوم حالت اوپر دی گئی ہے۔

## Code items (not translation findings)
### UR-C1 — src/ui/components/refusal-surface.tsx (open_console <Button>, component lines ~162-168)
- The value 'Radient کنسول کھولیں' starts with Latin, and the Button is rendered without labelDir. RN-web dir="auto" takes the first strong character (R) and lays the label out LTR. 'کنسول کھولیں' then sits to the right of 'Radient', so read right-to-left it comes out as 'کنسول کھولیں Radient'. Button.labelDir exists for exactly this case.
- Fix: Pass labelDir={composedDir} to the open_console Button. composedDir is already in scope through useComposedDir(); sign-in.tsx:92 and welcome.tsx:98 do the same. Verify with an Urdu RTL frame.

### UR-C2 — src/features/auth/connection-provider.tsx:2358
- The {subject} fallback 'Your computer' is a hard-coded English literal. Six of these Urdu headlines would render e.g. 'اس وقت Your computer سے کوئی جواب نہیں مل رہا۔'. The translated surface is incomplete no matter how good the catalogue values are.
- Fix: Move 'Your computer' into a catalogue key (e.g. mobile.computers.refusal.subject_your_computer; ur suggestion 'آپ کا کمپیوٹر') and resolve it with t(). Out of this translation slice; it is on the operator's 'entire UI' path.

## Rulings
- **connector_term**: کنیکٹر accepted. It is a standard Urdu tech transliteration (a parallel spelling کنکٹر also exists), the catalogue has no prior term, and the context sentence makes it clear.
- **console_title_opener**: 'اس وقت' is acceptable mechanically, but it adds a sense of temporariness (UR-F2, MINOR). A Latin opener with no code change on the headline <Text> would flip the line LTR, so the fix is the آپ-led wording, not removing the opener.
- **try_again_same_as_common**: Accepted. The English strings are identical too. The separate key allows the two to diverge later, and the screen context makes clear it retries the connection. A longer button text would gain nothing.
- **sign_in_next_past**: Rejected as written (UR-F1, MAJOR). The past tense 'بھیجا نہیں گیا' does not carry the 'will not be sent' promise. Use the future 'بھیجا نہیں جائے گا'.

## Bidi
- **values_starting_latin_or_placeholder**: ['mobile.computers.refusal.open_console']
- **render_site_dir**: Headline <Text> (HEADLINE[kind](subject)), NEXT <Text> and the wait_seconds <Text> set no dir, so RN-web dir=auto applies. All of their ur values start with an Urdu letter (checked by code point), so each resolves RTL. Only `detail` gets {...composedDir}. The open_console Button has no labelDir → UR-C1.
- **certificate_next**: Rendered: '…دکھایا ہوا https:// URL استعمال کریں…'. Paragraph level is RTL (first strong ٹ). In 'https:// URL', ':' and '/' are CS and the space is WS. W4 does not apply (no numbers), so W6 makes them ON. N1: ON between L(s) and L(U) → L. 'https:// URL' is therefore one LTR run, and the spaces between it and the Urdu (R…L, L…R) resolve to the embedding level (N2). Visual order is correct. If {scheme} were followed directly by Urdu, '://' would sit between L and R, resolve R, and display as '//:https'. The 'URL' token prevents that. Same structure as the shipped verdict_tls.
- **subject_titles_with_url**: For example offline_title with 'https://abc.trycloudflare.com': paragraph RTL (first strong ا). The CS characters inside the URL (: / .) sit between L characters, so N1 → L and the URL is one LTR run, placed between Urdu runs in correct logical order. A trailing slash would be a hazard, but base URLs are normalized without it (src/connection/profile.ts:54). A port or IP digit run follows L (W7 → L) or forms an EN CS EN chain, which displays correctly. No hazard found in the six {subject} titles.

## Accepted without findings
relay_stopped_title, tunnel_gone_title, password_title, retry_title, certificate_title, host_title, relay_stopped_next, tunnel_gone_next, console_next, password_next, retry_next, certificate_next, host_next, wait_seconds, try_now, try_again, sign_in_again, open_console (copy), another_address, offline_title. Terms agree with the existing catalogue: certificate/host strings match verdict_tls/verdict_host; ریلے is masculine and ٹنل feminine throughout; Radient کنسول follows billing_help/harness_help. Buttons are 14–22 characters, under the ~24 limit.

## Non-gating observation
The existing ur catalogue (mobile.computers.own_tunnel.insecure_allow / insecure_off_help) contains U+2066/U+2069 isolates around http:// and https://, contrary to the no-bidi-control rule and docs/direction.ts ('never a control character in the catalogue'). This predates the slice and is outside its scope.
