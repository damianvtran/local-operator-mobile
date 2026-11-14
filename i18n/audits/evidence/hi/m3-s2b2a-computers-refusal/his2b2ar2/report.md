# Hindi (hi) audit — round 2 (delta) — m3-s2b2a-computers-refusal (24 keys)

Auditor: i18n-auditor (lopdev), session fdb2ce531d10, model anthropic/claude-opus-5-5 (no fallback observed). Independent of translator (ee0b2003be8e / 35d709c49b96) and of the round-1 auditor (session 42a9d3be53a4, job accb079fa58e).
Brief sha256 d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40 · v1 e24b300418f841277a2d3c6cab80d3086a92ff3b765d2fe7eaaaf0a87a35dd03 · v2 9cc1892c9da83f945aa8fe8af90d9f57dde0462ecd8dcf6d8f086ebd8c2be5b7 (all recomputed, all match) · redaction marker hits: brief 0, v2 0.

## Verdict: **passed** (0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT)

## Delta (v1 → v2)
- Keys 24/24, same order. Changed values: exactly the 4 the notes list — console_title, tunnel_gone_next, password_next, sign_in_next. Other 20 values equal; raw file lines 26/26 with exactly 4 lines differing.
- Each changed value parses with the worktree's `src/i18n/messages.ts` (HEAD cd249ed1); all 24 parse (0 failures). Placeholders equal English (console_title {subject}; the other three none). hi plural 0/1/5 → one/one/other (wait_seconds unchanged).
- v2: 0 bidi/zero-width controls, NFC.

## Round-1 findings
- **HI-1 MAJOR console_title — RESOLVED.** `{subject} को Radient में आपके ध्यान की ज़रूरत है।` = "{subject} needs your attention in Radient." The 'X को Y की ज़रूरत है' construction now makes {subject} the one with the need and the reader the one who acts. Meaning is right, it reads naturally, and {subject} stays a separate token at the start of the line.
- **HI-2 MINOR sign_in_next — RESOLVED.** The medical-sounding क्वारंटीन is gone. Future tense `भेजा नहीं जाएगा` states the promise the note asks for (it will not be sent, even after signing in). Nothing softens it to "saved". See HI-R2-N1 for a non-gating wording note.
- **HI-N1 NIT password_next — RESOLVED.** `कंप्यूटर पर रिले पासवर्ड जाँचें और फिर से कोशिश करें।` uses the exact wording of the try_again button that follows (`फिर से कोशिश करें`, v2 line 22).
- **HI-N2 NIT tunnel_gone_next — RESOLVED.** `Radient में नई टनल बनाएँ, फिर यह कंप्यूटर जोड़ें।` The repeated फिर is gone. The feminine नई agrees with how the catalogue treats टनल (अपनी टनल, चलाई हुई टनल, टनल … दिखाती).

## New findings (delta only)

### HI-R2-N1 — NIT — `mobile.computers.refusal.sign_in_next`
- Current: …इससे पहले टाइप किया गया सब कुछ अलग रोक दिया गया है और भेजा नहीं जाएगा।
- Problem: `अलग रोक दिया गया है` is understandable but a slightly unusual collocation. रोक देना suggests "stopped/blocked", and अलग sits loosely next to it. The more natural phrase for "held aside" is रोककर अलग रखा गया है. `और भेजा नहीं जाएगा` keeps the not-sent promise, so this does not soften the meaning. Non-gating.
- Suggested (optional): …इससे पहले टाइप किया गया सब कुछ रोककर अलग रखा गया है और भेजा नहीं जाएगा।

## Fit
console_title is 1.32× English. It is a heading that may wrap to 2–3 lines. sign_in_next is help text that wraps freely. No button changed (still 14–20 chars against a budget of 24).

Execution log: audit.log. Record: record.json.
