# i18n audit — `ur` — mobile.session.user_message.show_more / show_less

Auditor: `i18n-auditor` (agent), session `ba46c71f2521`, model **deepseek/deepseek-flash**
(model declared by the harness system prompt; no fallback in play, no model swap).
Independent of the translator (`translator`, anthropic/claude-sonnet-5-5) and of every
earlier auditor. Read-only: no repo edits, no commits, no PR posts. Scratch only.

- Locale: `ur` (RTL, Perso-Arabic, Pakistan register)
- File group / namespace: `mobile.session`
- Keys (2): `mobile.session.user_message.show_more`, `mobile.session.user_message.show_less`
- Source: `en` catalogue + `mobile.session.context.json` at PR **#237** head `8fdfb2e9`
  (base `fa2bc5e0` = `origin/main`)
- Call site: `src/features/session/components/user-message-clamp.tsx:96-121` — `Pressable`,
  `accessibilityRole=button`, `accessibilityState={{expanded}}`, full-width centred,
  `minHeight: TOUCH_FLOOR`, text `text-meta`, **string doubles as `accessibilityLabel`**
- Style guide / glossary: **no glossary or locale style guide exists in this repository**
  (`git ls-tree -r origin/main -- i18n docs` → only `docs/i18n.md` and audit evidence;
  the core repo's `i18n/` guide is not present in this checkout). Terminological
  authority is therefore the shipped catalogue itself. That is what I judged against.

## Verdict — CHANGES REQUESTED

counts: **{blocker: 0, major: 1, minor: 0, nit: 0}** (1 major covering both keys of the pair)

Short form: **do not ship the candidate pair.** The Urdu pair that is *already on the
same PR head* — `مزید دکھائیں` / `کم دکھائیں` — is correct and is the catalogue-consistent
wording. The candidate `مزید دیکھیں` / `کم دیکھیں` is a regression on both counts below.

---

## F0 (process, blocking on the slice's premise — not a string finding)

**Fact: these two keys are NOT English-only at head `8fdfb2e9`.** PR #237's own feature
commit `0beb4dd3` ("fix(transcript): show more/less with fade for long user messages,
including condensed turns") added them, translated, to all seven locale catalogues.

```
$ git show 8fdfb2e9:src/i18n/catalogues/ur/mobile.session.json | grep user_message
20:	"mobile.session.user_message.show_more": "مزید دکھائیں",
21:	"mobile.session.user_message.show_less": "کم دکھائیں",
$ git show 0beb4dd3 -- src/i18n/catalogues/ur/mobile.session.json
+	"mobile.session.user_message.show_more": "مزید دکھائیں",
+	"mobile.session.user_message.show_less": "کم دکھائیں",
$ git merge-base --is-ancestor 0beb4dd3 origin/pr/237 && echo yes   # yes
```

The same grep returns populated values for `es fr zh-CN ru vi hi` too. Consequences the
manager has to settle before this slice can be recorded as an audit of shipped strings:
the follow-on translation pass is not filling an English hole in #237; for `ur` it would
**replace a shipped value with a wording the shipped catalogue contradicts.** The
operator's acceptance test ("no English anywhere") already passes for this key pair at
`8fdfb2e9`.

## F1 — MAJOR — both keys: `دیکھیں` (see) where this catalogue's established verb for a *show* control is `دکھائیں` (show)

| key | current (candidate) | problem | suggested |
| --- | --- | --- | --- |
| `mobile.session.user_message.show_more` | `مزید دیکھیں` | `دیکھیں` is this catalogue's verb for **View**, not **Show**; three button precedents put `دکھائیں` under a `Show …` source | `مزید دکھائیں` |
| `mobile.session.user_message.show_less` | `کم دیکھیں` | same verb divergence, plus a real ambiguity: `کم دیکھنا` is a set idiom ("to look down on / underestimate"), and this string ships as a **context-free `accessibilityLabel`**, where that reading is available with no visual context to suppress it | `کم دکھائیں` |

Evidence (every `ur` value in the shipped catalogues containing either verb, with the
`en` role from the context sidecar):

| role | key | en | ur |
| --- | --- | --- | --- |
| button | `mobile.schedules.show_more.monitors` | Show # more monitors | `{hidden, plural, one {# مزید نگرانی دکھائیں} other {# مزید نگرانیاں دکھائیں}}` |
| button | `mobile.schedules.show_more.wakes` | Show # more wakes | `… # مزید بیداریاں دکھائیں` |
| button | `mobile.schedules.show_less.monitors` | Show fewer monitors | `کم نگرانیاں دکھائیں` |
| button | `mobile.schedules.show_less.wakes` | Show fewer wakes | `کم بیداریاں دکھائیں` |
| button | `mobile.computers.show_details` | Show details | `تفصیلات دکھائیں` |
| button | `mobile.signin.show_diagnostics` | Show sign-in details | `سائن ان کی تفصیلات دکھائیں` |
| button | `mobile.session.subagents_hint` | Show the subagents | `ذیلی ایجنٹس دکھائیں` |
| button | `mobile.home.suggestion.last_turn` | Show me the last turn | `آخری ٹرن دکھائیں` |
| meta | `mobile.notifications.filter_label` | Show | `دکھائیں` |
| button | `mobile.home.queue.view` | **View** queued messages | `قطار میں لگے پیغامات **دیکھیں**` |
| button | `mobile.team_bridge.profile.open` | **View** profile for {name} | `{name} کی پروفائل **دیکھیں**` |

The split is clean and already encoded in the product: **Show → `دکھائیں`, View →
`دیکھیں`**. Ten values use `دکھائیں`, all of them rendering a source `Show`/`Hide`
control (`چھپائیں` for Hide); the two `دیکھیں` buttons in the whole app are `View …`.
The source here is `Show more` / `Show less`, and the control's function is the same
reveal/collapse as `mobile.schedules.show_more.*` — the nearest possible precedent,
same role, same meaning, same script. Precedents beat taste, and the translator's stated
reason for rejecting `مزید دکھائیں` ("less usual in apps") is contradicted by the app.

Why this is MAJOR and not MINOR: the terminology deviation is systematic (Show/View),
not a one-off preference, it lands in a **screen-reader label** where `کم دیکھیں` reads
at best as "see less" and at worst invites the `کم دیکھنا` idiom, and the candidate is a
regression from the value already on the branch.

Why not BLOCKER: meaning is still recoverable in context, nothing is unsafe, and no
placeholder/plural/code structure is involved.

### Recommended shipped values

```
mobile.session.user_message.show_more = مزید دکھائیں     (12 cells, ≤14 budget)
mobile.session.user_message.show_less = کم دکھائیں      (10 cells, ≤14 budget)
```
sha256 of the sorted-key JSON of that pair: `948d52d664df14605426241f518d89baa19f1d898be433e5cf3f80078a0a4050`
— byte-identical to what `8fdfb2e9` already carries, i.e. **no change is needed to the
branch for `ur`; the candidate pair is the only thing that would move it.**

---

## Per-check results (candidate values)

1. **Mechanical — PASS.** No placeholders in source (both keys `NoParams`,
   `catalogue.gen.ts:1624-1625`), none in the values; no ICU/`{}`; no markup, backticks,
   commands or identifiers; both keys present exactly once in the candidate file; valid
   JSON; key set identical to the brief. Repo validator (`npm run -s i18n:check`) is
   **not runnable against unmerged candidate values** (it compares catalogues in a tree);
   what I verified instead is that both keys *with the shipped pair* are already in the
   head tree for all seven locales, so the gate's parity condition holds there.
2. **Accuracy — PASS.** Polarity preserved (more/less, reveal/clip); no omission or
   addition; the toggle's direction is unambiguous in `show_more` vs `show_less`.
3. **Idiom / register — FAIL for `show_less` (F1).** `مزید` is the catalogue's word for
   "more" (`mobile.chrome.composer.more` `مزید سیاق`, `mobile.library.browse.more_kinds`
   `مزید اقسام`) — consistent, no finding there. Sentence case, no final full stop: PASS.
4. **Terminology — FAIL (F1).** See table above.
5. **Fit — PASS.** 320pt column, full-width centred control, `text-meta`,
   `minHeight: TOUCH_FLOOR`. No numeric budget exists for these keys: the native context
   schema has no `maxCells` field — budgets survive only as prose in a few notes
   (`mobile.session_health.ended_placeholder` "36 cells", `relay.health.live` "16 cells") —
   and neither of these two keys carries one. The binding constraint is the manager's
   ~14-character pill budget. Cell widths (East Asian width, combining marks merged):
   candidate `11` / `9`, recommended `12` / `10`, English `9` / `9`; budget ≈14 → all fit
   with margin. Arabic script is width-1, no wide glyphs, no combining marks in either
   string, so no terminal/wide-glyph risk.
6. **RTL — PASS.** Both values are pure Perso-Arabic, **no Latin, no digits, no paths**,
   so no embedded-LTR bidi hazard and no mirrored arrows/glyph hints. Word order reads
   naturally RTL ("مزید دیکھیں" = more-see, correct Urdu imperative order).
   **Script correctness — PASS:** verified code points — `ی` U+06CC FARSI YEH (not U+064A),
   `ک` U+06A9 KEHEH (not U+0643), `ھ` U+06BE HEH DOACHASHMEE, `ں` U+06BA NOON GHUNNA;
   NFC; single U+0020 spaces; zero bidi controls (U+200E/F, U+061C, U+202A-E, U+2066-9);
   zero ZWNJ/ZWJ/NBSP.
7. **Nothing left English — PASS** for the candidate values and for the shipped pair.

## Negative control (checker proves it bites)

Baseline candidate PASS; every in-memory mutation FLAGGED:

| mutation | flagged as |
| --- | --- |
| empty value | EMPTY, NO-ARABIC-SCRIPT |
| whitespace only | EMPTY, NO-ARABIC-SCRIPT, LEADING/TRAILING-SPACE |
| Latin leftover `مزید دیکھیں (Show more)` | LATIN-LEFT |
| identical to English (`Show less`) | LATIN-LEFT, IDENTICAL-TO-ENGLISH, NO-ARABIC-SCRIPT |
| RTL mark U+200F injected | BIDI-CONTROL U+200F |
| ZWNJ U+200C injected | ZWNJ/ZWJ U+200C |
| Arabic yeh U+064A for Farsi yeh | ARABIC-VARIANT U+064A |
| decomposed alef+maddah (NFD) | NOT-NFC |
| stray `{count}` | LATIN-LEFT, ICU/BRACE, PLACEHOLDER-MISMATCH |
| final `۔` | FINAL-FULL-STOP |
| transliterated `kam dekhein` | LATIN-LEFT, NO-ARABIC-SCRIPT |
| NBSP for space | NBSP |

Checker is a stdlib-only Python function (`unicodedata` + regex); no MT service, no
back-translation, no translation API used anywhere in this audit.

## Hashes (sha256)

| what | path / rev | sha256 |
| --- | --- | --- |
| English pair (sorted-key JSON) | `{show_more:"Show more", show_less:"Show less"}` | `b285de7371f1a73b6c5adc4d70d999acbc7a6a8eea4a4057f2775c618aa5beef` |
| shipped-candidate pair (the candidate values) | sorted-key JSON | `71616db9a927f0a17877fdee72f7c1f34e515bb67ec11b99a3231a92eaf844cc` |
| recommended pair (== head) | sorted-key JSON | `948d52d664df14605426241f518d89baa19f1d898be433e5cf3f80078a0a4050` |
| `src/i18n/catalogues/en/mobile.session.json` | `8fdfb2e9` | `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0` |
| `src/i18n/catalogues/en/mobile.session.context.json` | `8fdfb2e9` | `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102` |
| `src/i18n/catalogues/ur/mobile.session.json` | `8fdfb2e9` | `06e6da40aa6a9819734af490f84acb9112e3ce8e75c80ba8daaa0975ffe6e89b` |
| candidate `ur.json` | manager scratchpad `followon-show-more/ur.json` | `83fa982648350672a1a745eb9d95c2f4526bc2fa7480049e13e0bb15415e4b72` |
| `ur.notes.md` (translator provenance note) | same dir | `75f7792ff6c06efc4a58412e54a4ac4fb9a820cd35f511943b55f83ad220274f` |
| translator brief | manager scratch root | `7b9e37ed85d2992605f84e35efd3a22c976b294c3c19c29c2ce69f5f9e1b95f0` |

## Not done, deliberately

- **No ledger write.** The RFC's audit-ledger command (`i18n/audits/…` record) is a repo
  write; this audit is read-only by mandate. The record content is supplied in the
  companion `audit-showmore-ur.record.json` so the manager's non-read-only lane can
  record it: verdict `changes_requested`, `unresolved_blocker_major_count: 1`.
- No evidence bundle committed to `i18n/audits/evidence/ur/…` — same reason; the files
  here are the served artifact of record and must be attached/committed by that lane.
- No rendered frame. The finding is lexical and the values are identical in geometry to
  the shipped pair (11/12 cells at a 14-cell budget); a screenshot would not
  discriminate, and capturing one is not in this lane's brief.
