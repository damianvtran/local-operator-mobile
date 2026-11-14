# Urdu (ur): round-2 delta audit, M3 S2b-2a mobile.computers.refusal.* (24 keys)

**Verdict: passed.** BLOCKER 0 · MAJOR 0 · MINOR 0 · NIT 2. All round-1 findings (UR-F1 to UR-F4) are resolved. The code items UR-C1 and UR-C2 are still open on the lane, as round 1 expected; they are not translation findings.

Auditor: i18n-auditor (team lopdev), session 75699937d8a2, model anthropic/claude-opus-5-5 (taken from the session system prompt; no fallback observed). This auditor is independent of the translator sessions (3e9cacebe527, 3b60246e93b4) and of the round-1 auditor (session ae9561e2347a, job 4a3c2147bb9b).

## Inputs (recomputed, all match the brief)
- brief-s2b2a.json `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40`. Redaction-marker count: 0.
- v1 ur/draft-ur.json `46211c4e2757deca94e7eab22fd61c95c49f20a83e419929d71d2b5ea7e1233b`
- v2 ur/draft-ur-v2.json `635d03a2df1490804485455d07522192a9e29c09b17c65975447798520166c20`
- notes ur/notes-ur-v2.md `e8eceb8dfd43e80a18e439ee6258b47bc35109220b6fcd1c69f0f3f1ec4194d2`
- round-1 audits/ur/report.md `e9e8fe88886f519de8cb0952d6812560f0403a1e3f966917d04cb744d1216736`
- messages.ts at worktree HEAD cd249ed1 `c1831406332e907c9a914b3db0ec35fc9fd2cddd44c18cd2861b77667c5bdba0`

## Mechanical delta (executed, see audit.log)
- `diff v1 v2` changes exactly 4 lines (5, 7, 11, 16): console_title, sign_in_title, offline_next and sign_in_next. These are the 4 keys the notes list. The other 20 values are byte-identical (compared as JS strings). Key order equals the brief in both v1 and v2. Each file has 26 lines.
- All 24 v2 values parse with messages.ts `parseMessage`. Each value's placeholder map (name and kind) equals the English one; the 4 changed values have `subject:text` / none, matching English. wait_seconds is unchanged and still has ur `one`/`other`: 1 → one, 0/2/21 → other.
- There are 0 bidi controls (U+200E/F, U+202A–E, U+2066–9, U+061C) in any of the 24 values. All values are NFC.
- First strong character by code point: open_console starts with `R` (U+0052), the only Latin start. console_title and sign_in_title start with آ (U+0622, bidi AL). offline_next starts with ا (U+0627) and sign_in_next with د (U+062F). The open_console case is code item UR-C1 (Button labelDir), not a translation finding.

## Round-1 dispositions
| ID | Sev | v2 text | Ruling |
|---|---|---|---|
| UR-F1 | MAJOR | …قرنطینہ میں رکھ دیا گیا ہے اور بھیجا نہیں جائے گا۔ | **Resolved.** The future negative states that the text will not be sent, which covers "even after signing back in" with no reading of "not yet". It does not soften the text into "saved". |
| UR-F2 | MINOR | آپ کو Radient میں {subject} پر توجہ دینی ہوگی۔ | **Resolved.** The temporary sense is gone. The grammar is correct (توجہ is feminine, so دینی ہوگی agrees). Shifting from "{subject} needs" to "you will need to attend to {subject}" suits a screen that tells the reader where the fix is. See N2 for spelling. |
| UR-F3 | NIT | …{subject} سے دوبارہ رابطے کے لیے سائن ان کریں۔ | **Resolved** as requested. It does introduce N1. |
| UR-F4 | NIT | …کمپیوٹر کی آخری معلوم حالت اوپر دی گئی ہے۔ | **Resolved.** The owner is now unambiguous. اوپر keeps the meaning "earlier on this screen" in RTL. |
| UR-C1, UR-C2 | code | (none) | Open; owned by the lane. No translation change is needed. |

## New findings (delta only)
### UR2-N1 NIT: `sign_in_title` versus `sign_in_next`
- Current: the title says "دوبارہ رابطے کے لیے". The next line, directly below it on the same screen, says "دوبارہ منسلک ہونے کے لیے".
- Problem: Applying F3 makes the screen use two different words for one English verb ("reconnect"), one line apart. The ur catalogue uses منسلک for connect/connected in more than 20 strings; رابطے appears only in mobile.chrome.home.sign_in. رابطہ also leans toward "contact" more than "connect". Both readings are understandable, so this does not gate.
- Option, and my mild preference: go back to "{subject} سے دوبارہ منسلک ہونے کے لیے سائن ان کریں۔" (the v1 wording) to keep the screen consistent. Alternatively, keep v2 as it is.

### UR2-N2 NIT: `console_title` orthography
- Current: "ہوگی" (joined).
- Problem: The ur catalogue spells the feminine future auxiliary "ہو گی" 15 times and "ہوگی" 0 times. The masculine "ہوگا" appears joined 4 times, so the catalogue mixes styles, but for the feminine form it is consistent.
- Suggest: "آپ کو Radient میں {subject} پر توجہ دینی ہو گی۔"

## Bidi reasoning for the changed headlines (subject = `https://abc.trycloudflare.com`)
Rendered by formatMessage (executed):
- console_title → `آپ کو Radient میں https://abc.trycloudflare.com پر توجہ دینی ہوگی۔`
- sign_in_title → `آپ کے Radient سیشن کی میعاد ختم ہو گئی ہے۔ https://abc.trycloudflare.com سے دوبارہ رابطے کے لیے سائن ان کریں۔`

The headline `<Text>` sets no dir, so dir=auto applies. P2/P3 pick the first strong character, آ (AL), which makes the paragraph level 1 (RTL). Both values are a single paragraph (۔ U+06D4 is AL, not B), so the second sentence of sign_in_title does not restart detection.

In the URL, `:` `/` `.` are CS. W4 does not apply because there are no EN neighbours, so W6 turns them into ON. Every ON run inside the URL sits between L characters (`s…a`, `c…t`, `e…c`), so N1 resolves it to L. The whole URL becomes one level-2 LTR run.

"Radient" is a separate L run. In console_title it is followed by the R word میں, which separates it from the URL. Their order is right-to-left: آپ کو ← Radient ← میں ← URL ← پر توجہ…, which matches the logical order. The spaces at the L/R boundaries take the embedding direction under N2, which is correct.

In sign_in_title, the URL follows "۔ " (AL, WS) and precedes " سے" (R). The boundaries are clean and nothing is reordered.

Variants:
- With a port, `https://h:8443`, W7 makes the digits L, so `:` lies between L and L and resolves to L.
- A bare IP `192.168.1.5:7000` placed after میں / ۔ becomes one EN run under W4 (CS between EN), displays LTR in correct order, and keeps W7's EN.
- A trailing `/` would sit between L and R and resolve R. That would display at the wrong end, but base URLs are normalized without a trailing slash (per round 1, src/connection/profile.ts:54).

No hazard was introduced by the delta.

## Fit
console_title is 46 characters plus the subject, and sign_in_title is 89 characters plus the subject. The note allows wrapping to 2–3 lines. offline_next (96) and sign_in_next (127) wrap freely.
