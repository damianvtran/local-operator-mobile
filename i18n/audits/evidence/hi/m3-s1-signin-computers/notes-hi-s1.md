# hi — M3 S1 (sign-in + computers) translator notes

Draft: `draft-hi-s1.json` (44 keys, brief key order preserved)
Brief: `…/sessions/d5aaf8ba6ba5/scratchpad/translation-brief-s1.json`, sha256 prefix `531e6edd8e5f9af5` (verified: `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`)
Draft sha256: `768194117988c474607c705793c046c12217d1833d38c07a4ca9f9b42d1ce7d8`
Locale: hi · Translator model: deepseek/deepseek-flash (this session)

## Register

- **आप** throughout, polite imperative ("हटाएँ", "करें", "आएँ") — hi style guide §Formality.
- Sentence-final **।** (danda) for full stops, `?`/`…`/`—` as in the source; no ASCII `.` at the end of prose. Danda already the norm in the existing hi mobile catalogues.
- Nukta kept consistently: फ़ोन, ब्राउज़र, कॉन्फ़िगर, रीफ़्रेश, ख़ुद, ज़रिये, ज़रूरत, फ़. `कंप्यूटर` stays without nukta (matches existing hi).
- No ZWJ/ZWNJ, no bidi controls (checked: zero `Cf` characters).

## Settled terms reused (no re-invention)

Terminology was taken from the existing **hi** mobile catalogues, not from the English:

| Term | Hindi | Evidence |
|---|---|---|
| tunnel | **टनल** (fem. — "इस टनल की बिलिंग") | mobile.computers.billing_help, mobile.settings.account.delete_help |
| relay | **रिले** | mobile.computers.connect_refused.password, mobile.settings.about.blurb |
| route | **रूट** | mobile.computers.wait.host_answering, mobile.settings.diagnostics.route |
| connect (verb) | **कनेक्ट करें / कनेक्ट हो** | badge.connecting "कनेक्ट हो रहा", account_help |
| sign in / sign-in | **साइन इन करें** (verb) · **साइन-इन** (noun/status) | sign_out, stage_signed_in, signin.stage_* |
| computer | **कंप्यूटर** | whole namespace |
| account | **खाता** | account_mismatch |
| list | **सूची** | added.stays_listed |
| address | **पता** | transport.custom "आपका पता" |
| phone | **फ़ोन** | none_on_phone |
| session | **सत्र** | glossary §2 |
| agent | **एजेंट** | glossary §2 |
| remote access | **रिमोट ऐक्सेस** | billing_help |
| billing | **बिलिंग** | billing_help |
| refresh | **रीफ़्रेश करें** | mobile.settings.connection.refresh (the brief names it as the twin key) — chosen over library's "ताज़ा करें" for term consistency with the connection surfaces |
| cancel | **रद्द करें** | mobile.common.cancel |

Transliterated loans kept in Devanagari where they are the living term (style guide §Product-name policy): टनल, रिले, कंप्यूटर, फ़ोन, ब्राउज़र, पासवर्ड, खाता, बिल्ड, कॉन्फ़िगर, रीफ़्रेश, स्टोरेज-style loans. Kept Latin, untouched: **Local Operator**, **Radient**, **URL**, `{status}`/`{name}`/`{reach}`.

## Per-key rationale (non-obvious ones)

- **not_harness** — "इस कंप्यूटर पर Local Operator हार्नेस नहीं चल रहा है।" Chose the Devanagari loan **हार्नेस**: the neighbouring `harness_help` avoids the word altogether, and the sentence needs a noun. Renaming the product concept was not an option; proposal below.
- **wait.listing** — `आपका कंप्यूटर Radient की सूची में दिखने का इंतज़ार है…`. The English subject is Radient; Hindi product copy reads far better with the computer as topic and `इंतज़ार` as the predicate, matching the namespace's existing "… के जवाब का इंतज़ार है।" Ellipsis preserved, no full stop.
- **wait.tunnel_status** — `Radient के पास टनल है — {status}।` Keeps `{status}` as a final appositive after the em dash, so an untranslated English token (e.g. `active`) sits grammatically. Hindi needs no copula after it.
- **wait.use_computer** — "इस कंप्यूटर का उपयोग करें". "उपयोग" is the guide's settled word for *usage*; the button is a switch-to action, but "स्विच करें" is already `mobile.computers.switch` ("कंप्यूटर बदलें"), so reusing it here would blur two buttons.
- **own_tunnel_instead** — "इसके बजाय अपनी टनल उपयोग करें". `इसके बजाय` carries the contrast the note requires; kept the same verb as `paths.own_action` so the two read as one pair, differing only by *instead*.
- **remove.body** — "…इससे कंप्यूटर, उसकी टनल या आपके खाते पर कोई असर नहीं पड़ता।" All three negations are kept as one negation over a three-item list, which is how Hindi states "does not touch A, B or C"; a triple negative would read unnatural.
- **paths.radient_body** — three clauses kept in order; `निजी, प्रमाणित URL` for "private, authenticated URL"; the cost ("needs an account") stays in the first sentence, unsoftened.
- **paths.own_body** — "उन्नत रास्ता" for "the advanced path" (उन्नत is the settled word, not the stilted विकसित); `प्रकाशित करते हैं` for publish, `अपनी चलाई हुई टनल के ज़रिये` for "through a tunnel you run". "No account at any point" rendered as "किसी भी चरण में … ज़रूरत नहीं" (kept the point).
- **signin.title** — "साइन इन करें" (verb phrase) matching the note and existing hi stage strings.
- **signin.intro** — "…इसलिए ऐप को आपका पासवर्ड कभी दिखता ही नहीं।" `दिखता ही नहीं` carries "never" emphatically, as a guarantee should be.
- **signin.use_address** — **adapted, not literal**: "पता और पासवर्ड से कनेक्ट करें". A word-for-word "पता और पासवर्ड उपयोग करें" reads like "use an address" as an object and says nothing about what happens; the button opens the manual connect route, and the alternative line below uses the same verb (… `डालकर भी कनेक्ट कर सकते हैं`) so the pair stays coherent.
- **panel.waiting / waiting_help** — the English pair is a headline plus "there"; Hindi `वहाँ` resolves to the browser just opened, and `इस ऐप पर वापस आएँ` keeps the destination explicit.
- **panel.unavailable** — "यह बिल्ड Radient का साइन-इन पूरा नहीं कर सकता।" Kept `बिल्ड` (the surrounding state is technical; a runtime detail line renders beneath it) rather than inventing "ऐप का संस्करण". Flagged as a judgement call; an auditor may prefer "ऐप का यह वर्ज़न".
- **panel.unavailable_alt** — "आप रिले का पता और पासवर्ड डालकर भी कनेक्ट कर सकते हैं।" Verb form instead of "… के पता और पासवर्ड से कनेक्ट", which needs an awkward oblique for two joined nouns.
- **welcome.headline / body** — `एजेंट` and `सत्र` per glossary; "your own machine" → `आपकी अपनी मशीन`; the privacy promise is the second sentence with `कभी बाहर नहीं जाता` ("never leaves it"), `उस मशीन से`.
- **billing_inactive** — `निष्क्रिय` (the natural antonym of the badge's `सक्रिय`), `रिमोट ऐक्सेस अस्वीकार कर दिया जाएगा` for "remote access will be refused".

## Lower-case status badges

Hindi has no letter case, so the "keep lower case" instruction has no Devanagari expression — recorded here rather than silently ignored. Badges are kept **short and nominal/verbal**, mirroring the two existing badges (`सक्रिय`, `कनेक्ट हो रहा`):

| key | hi | note |
|---|---|---|
| status.route_ready | रूट तैयार | 9 cells — same shape as the English two-word badge |
| status.provisioning | तैयार हो रहा | verbal, parallel to `कनेक्ट हो रहा` |
| status.suspended | निलंबित | settled term |
| status.disabled | बंद | everyday word; `अक्षम` rejected as heavier than the English |
| status.revoked | निरस्त | chose over `रद्द` to keep *revoked* distinct from *cancelled* (`stage_cancelled`, `रद्द करें`) |
| status.unknown | अज्ञात | settled term |
| reach.answering | जवाब दे रहा | probe result as an activity, distinct from the status column |

`row.a11y*` keep `{name}, {status}, {reach}` byte-identical in order, with the trailing word translated (`सक्रिय`, `कनेक्ट हो रहा`) exactly as the note asks, so a screen reader hears the same badge words as the visible row.

## Judged identical to English

**None.** Every one of the 44 values differs from its English source. Brand words inside sentences (Local Operator, Radient, URL) are untranslated by policy but are not whole strings.

## Glossary proposals (new rows)

1. **harness** (as in "the Local Operator harness") — hi: **हार्नेस**, Devanagari loan; used in `mobile.computers.not_harness`. No glossary row exists, and the neighbouring `harness_help` sidesteps the word, so a row is needed to stop a future wave rendering it "फ़्रेमवर्क" or leaving it Latin.
2. **tunnel** — hi: **टनल**, feminine (`इस टनल की बिलिंग`, matching existing copy). Glossary has no `tunnel` row; the core glossary should record the gender so oblique forms don't drift.
3. **recommended** — hi: **अनुशंसित** (badge, `paths.recommended`), chosen over `सुझाया गया`; propose as a glossary row if other surfaces need it.
4. **route** — hi: **रूट** (already used in two existing keys); worth a row alongside `relay → रिले`.

## Width

Measured cell length against the English source with a Devanagari-aware estimate (matras zero-width). Growth is ≤1.29× and only on two tiny strings (title, `try_now`), which sit in a full-width header/button; every help paragraph is at or below the English cell length. No `maxCells`/`maxChars` values exist in these two context sidecars, so nothing had to be truncated. Known risk, not a defect: the Devanagari metric in the style guide *under*-counts conjunct width in a renderer, so the two long `paths.*_body` paragraphs (180 / 190 code points) will wrap to a line or two more than English on a phone. No wording was shortened to the point of losing meaning.

## Validator

`npm run -s i18n:check` is a repository gate that compares the *checked-in* `en` and `hi` catalogue directories; it cannot run against session drafts, and running it would only report the 44 keys as missing from `en`→`hi` parity anyway (`hi` has 47/77 and 19/33 lines today). Draft-level validation was therefore run against the brief with the same invariants the generator enforces:

- 44/44 keys, order identical to the brief, no missing/extra/renamed keys;
- every value a non-empty string, no leading/trailing whitespace;
- placeholder set and order identical to the English for all three placeholder keys (`{status}`, `{name}/{status}/{reach}`);
- `{`/`}` counts balanced, no stray ICU punctuation;
- no ASCII full stop in prose, no double danda, no bidi/format characters;
- no Latin text outside the allowed tokens (Local Operator, Radient, URL);
- output is valid UTF-8 JSON.

Result: **0 problems** on all checks above.

Additionally, the draft was parsed by the repository's **own** ICU parser
(`src/i18n/messages.ts → parseMessage`, the module the generator and the
renderer share) with a throwaway script in session scratch:

```
node …/scratchpad/check-hi.mjs
checked 44 values against en; problems: 0
```

Every value parses, and each one carries the same argument names, in the same
order, with the same `params` map as its English source. For the record, the
repository gate itself was also read once on the lane head:

```
node scripts/i18n/generate.ts --check
… es/mobile.computers.json disagrees with the English source — missing:
mobile.computers.not_harness … mobile.computers.remove.confirm
```

That is the expected pre-translation state of the sweep: the 30 new
`mobile.computers` keys (and the 14 `mobile.signin` ones) are in `en` and in no
locale yet, `es` being the first locale it reports. It is not a defect in this
draft, and it clears per locale as the drafts land. `generate.ts` reads the
checked-in catalogue directories only, so it cannot be pointed at session
drafts; nothing outside this scratchpad was written by the check.
