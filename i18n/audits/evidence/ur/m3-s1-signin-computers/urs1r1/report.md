# ur (Urdu, RTL) — M3 slice S1 independent translation audit

- **Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 5 MINOR, 3 NIT. No copy change is required to ship;
  the five MINORs are cheap and belong in the manager's single remediation wave while this is
  still a draft.
- Auditor `i18n-auditor`, instance `5ac1a4a06448`, model **`deepseek/deepseek-flash`**
  (session default, no fallback, no role/model pin — disclosed as such).
- Independent of the translator (translator session `5dd57cd8d43e`, draft authored there).
  I did not translate, edit or resolve any value; the worktree was read-only for me.
- Locale: `ur` · namespace `mobile.computers+mobile.signin` · head
  `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (base `origin/main` `9e193b57`).
- Draft audited: `draft-ur-s1.json` sha256
  `d1817d7bbef44516207eda3e4713058d4f5f21dd5bdc4aad11390ffda3b66bca`
  (matches the digest in the task, verified before reading a value).
- Brief: sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`.
- Style guide `i18n/style-guides/ur.md` sha256 `7276e962…6eddc4` and glossary
  `i18n/glossary.md` sha256 `0eb34437…a962f8`, both at `~/local-operator` `origin/main`
  `8459804f56dd704d5c3a680ef68f53b7182786ab`.
- Translator notes read **after** my own first pass on all 44 values.

## 1. Mechanical — all clean

| Check | Result |
|---|---|
| JSON | valid, 44 keys, UTF-8, every value NFC |
| Key set | 44/44 vs brief; nothing missing, nothing extra, order identical, no duplicates; each brief English string equals the `en` catalogue value; every sliced key has an `en` context note |
| Placeholders | all 44 values parsed with the repo's own `parseMessage` (`src/i18n/messages.ts`): 4 values carry params, **names and kinds identical** to English (`status:text`; `name`/`status`/`reach`:text ×3) |
| ICU | no `plural`/`select` in this slice → no CLDR category requirement to satisfy (ur is `one`/`other` where plurals appear) |
| Punctuation parity | 16/16 full stops (`۔`) matching the English full stops; 2/2 ellipses (U+2026, single, no ASCII `...`, no `……`); no ASCII `.`/`)` leakage |
| Bidi controls | none — no U+200E/200F/202A–202E/2066–2069/061C; the ur guide forbids them and the draft is clean |
| Markup / code / flags | none in this slice; Latin tokens (`Local Operator`, `Radient`, `URL`) byte-identical |
| Coverage | after this slice `ur` is **complete** in both namespaces — 0 missing keys (computers 75/75, signin 32/32). Only value equal to English: `mobile.computers.transport.radient` = "Radient" (brand, correct) |

Repo validator: `node scripts/i18n/generate.ts --check` **cannot read a draft outside the repo**
and it stops at the first disagreeing locale — in this English-first worktree it exits 1 on
`es/mobile.computers.json` (the untranslated slice), before reaching `ur`. So the validator
result here is not evidence about this draft; the same parser and the same key/parameter parity
rules were applied directly to the draft instead — `audit-ur.mts` reports
`placeholder problems: none`, `missing vs brief: []`, `extra vs brief: []`,
`draft order == brief order: true` (its full output is in `audit.log`).
The real `i18n:check` must run when the implementer lands the values — a failure there would be
mine to answer.

## 2. Rulings asked for

**«سائن ان» vs «سائن اِن» — ship `سائن ان` (plain, no diacritic).** Measured in the shipped ur
catalogues: **21 occurrences plain vs 6 with the kasra** (`mobile.home` 1, `mobile.oauth` 3,
`mobile.signin` 2). The plain form carries every verb construction (`سائن ان کریں`,
`سائن ان ہو گیا`). The six kasra instances are the drift and should be normalised in a later
wave — the draft should not reintroduce the diacritic to match them.
Also: the notes claim "4 keys" in `mobile.signin.json`; the real split is 2 there and 4 elsewhere
(6 total). Correct the number in the ledger note, not the wording.

**«پیش رفتہ» — endorsed.** `پیش رفتہ ٹیکنالوجی` / `پیش رفتہ ممالک` are ordinary Urdu
collocations for "advanced"; `جدید` would say "modern". The translator's ruling stands and needs
no change.

**«طریقہ» vs «راستہ» — endorsed.** `راستہ` is already the shipped word for the control-plane
route (`mobile.settings.diagnostics.route` «راستہ», `mobile.computers.wait.host_answering`
«راستہ تیار»), and `طریقہ` has no shipped use that would collide (one, for "how to"). The pair
holds: route → `راستہ`, path → `طریقہ`.

**"Judged identical" list — confirmed empty, correctly.** No draft value is byte-identical to
its English source. The Latin tokens inside values (`Local Operator`, `Radient`, `URL`,
`{status}`/`{name}`/`{reach}`) are keep-as-is per glossary §1 and the ur guide; none is an
untranslated string.

**zh-CN spacing / ellipsis** is not this locale's call — that ruling belongs to the zh-CN auditor.

## 3. Findings

### MINOR

**UR-S1-01 `mobile.computers.paths.own_body`** — «… آپ اپنا کمپیوٹر خود دستیاب کرتے ہیں، اپنی
چلائی ہوئی ٹنل کے ذریعے، اور اس کا پتہ یہاں چسپاں کرتے ہیں۔»
Two things read as translation: (a) the bracketed appositive «، اپنی چلائی ہوئی ٹنل کے ذریعے،»
interrupts the verb phrase the way the English dash-clause does — Urdu takes the instrument
inside the clause; (b) "paste" is `چسپاں کرتے ہیں` while shipped ur uses **`پیسٹ کریں`** for the
same action in 3 keys (`composer_input.paste.image`, `paste.denied`, `team_bridge.attachment.paste`).
Better: «پیش رفتہ طریقہ: آپ اپنا کمپیوٹر اپنی چلائی ہوئی ٹنل کے ذریعے خود دستیاب کرتے ہیں اور اس
کا پتہ یہاں پیسٹ کرتے ہیں۔ کسی بھی مرحلے پر Radient اکاؤنٹ درکار نہیں، اور پاس ورڈ آپ کے پاس
رہتا ہے۔»

**UR-S1-02 `mobile.computers.status.revoked`** — «منسوخ»
Not a mistranslation: shipped `mobile.settings.sign_out.done` already renders English "revoked"
as `منسوخ کر دیا گیا`. But the same word is the shipped word for **Cancel**
(`mobile.common.cancel` «منسوخ کریں»), and the remove dialog that carries Cancel is rendered on
the **same screen** as this badge (`computers.tsx:662` dialog vs the badges at `:199`/`:203`),
opened by long-pressing that very row — so the translator's justification ("the two never share
a screen") is factually wrong for this surface. Better as a state word: **`منسوخ شدہ`** (keeps
`منسوخ کریں` free for Cancel), or `کالعدم` (void/revoked, as a revoked licence). Whichever is
chosen must become a glossary row: this is the first surface in any locale that needs "revoked",
and six locales will otherwise diverge.

**UR-S1-03 `mobile.computers.refresh`** — «ریفریش کریں»
A second rendering of the same English word already ships: `mobile.settings.connection.refresh`
is «تازہ کریں», while `mobile.team_bridge` uses «ریفریش». The brief says the key is separate
because the **surface** differs, not the wording. **Keep `ریفریش کریں`** (loanword policy, and
the shipped noun `ریفریش`), record it, and normalise `settings.connection.refresh` later — do not
revert this key.

**UR-S1-04 `mobile.signin.panel.cancelled`** — «سائن ان منسوخ ہو گیا تھا۔»
The past-perfect `تھا` was added to force a distinction from the stage word
(`stage_cancelled` «سائن ان منسوخ ہو گیا»). As a headline shown the moment the reader dismisses
the browser sheet it reads as reporting an *earlier* completed cancellation; English is simple
past, and the full stop already separates the two strings. Better: «سائن ان منسوخ ہو گیا۔»

**UR-S1-05 `mobile.computers.paths.radient_title`, `mobile.signin.panel.unavailable_alt`** —
«Radient سے جڑیں» / «… سے جڑ سکتے ہیں»
Introduces `جڑنا` as a third verb for "connect". The corpus settles on **`منسلک`** for this
relation (`account_routing.disconnected`, `home.connect_disabled_reason`,
`session.not_connected.*`, `settings.status.connected`), `رابطہ` for an attempt in progress, and
`جوڑیں` only for pairing. Neither string is wrong Urdu — the cost is one concept with two names.
If aligning: «Radient سے منسلک ہو جائیں» · «آپ پھر بھی ریلے کے پتہ اور پاس ورڈ سے منسلک ہو سکتے
ہیں۔» If brevity wins, keep `جڑنا` and record it as the CTA verb — but decide once.

### NIT (3)

- **UR-S1-N1 `mobile.signin.intro`** — fronting «سائن ان» ahead of the subject is a mild garden
  path in a reassurance line (English fronts "Your browser"). Suggest «آپ کا براؤزر سائن ان مکمل
  کرتا ہے، اس لیے ایپ کو آپ کا پاس ورڈ کبھی نظر نہیں آتا۔»
- **UR-S1-N2 `mobile.computers.paths.own_title`** — «اپنی ٹنل خود ترتیب دیں» doubles "own"
  (`اپنی` + `خود`) where English says it once; the reflexive belongs in the body, which has it.
  Suggest «اپنی ٹنل ترتیب دیں».
- **UR-S1-N3 `mobile.computers.status.provisioning`** — recorded so a later wave does not "fix"
  it blindly: `تیار` appears in both this badge and `route_ready` «راستہ تیار». Different fields,
  never rendered together, each correct alone. **No change.**

## 4. Per-key verdicts where not clean

Everything not listed here is clean on all six axes (mechanical, accuracy/polarity/safety,
idiom/register, terminology, fit, RTL):

`own_body` (UR-S1-01) · `status.revoked` (02) · `refresh` (03) · `panel.cancelled` (04) ·
`paths.radient_title` + `panel.unavailable_alt` (05) · `signin.intro` (N1) · `paths.own_title`
(N2) · `status.provisioning` (N3).

Safety-sensitive strings, read twice and clean: `remove.body` (all three negations intact, no
"only" added, nothing implies the computer itself changes), `remove.title`/`remove.confirm`,
`billing_inactive` ("remote access **will be refused**" — future passive preserved),
`signin.intro` and `welcome.body` (both privacy guarantees exact: the app never sees the password;
code never leaves the machine), `panel.cancelled_help` ("nothing was changed on your account").

## 5. Render notes — not copy defects, for the ur design/UX round

- **R1 badges in a monospace face with tracking.** `status.*`/`reach.*` render through `Badge
  mono` → `text-mono-label`: **JetBrains Mono 11px/1.2, weight 600, letter-spacing 0.06em**, in a
  fixed `leading-4` line box (`theme.css:137-140`, `variants.ts:516`). JetBrains Mono has no
  Arabic coverage, so every Urdu badge falls back to a system Arabic face — and tracking on joined
  Arabic breaks the cursive joins a native reader depends on. `list-row-meta.ts` already models
  this class for CJK (`WIDE_GLYPH`, `FALLBACK_ADVANCE_EM`) but its range stops short of
  U+0600–06FF, so Urdu is measured at the Latin 0.6 em advance. Fix is design/engineering
  (sans `meta` step or no tracking for ur badges; extend the wide-glyph range), never copy.
- **R2 strings that begin with a Latin token.** 4 values start with `Radient`
  (`wait.tunnel_status`, `paths.radient_title`, `paths.radient_body`, `signin.start`) and the 3
  `row.a11y*` values start with `{name}` (a hostname may be Latin). There is **no FSI/PDI
  isolation anywhere in `src/`**, and `src/ui/direction.tsx` documents that on native RN's
  paragraph base is Natural (first strong character). Under that reading these take an LTR base
  and lay the Urdu clause out from the wrong end. **Locale-wide, not new**: 87 of the 139
  mixed-script shipped ur values are Latin-initial. Unverified here (no device frame from this
  host) — the RTL round owns the frame check, and the fix would be render-layer for the whole
  locale.
- Badge width, measured: the two badge labels in a row are ≤11 characters each (Arabic script ≈1
  cell/char per the ur guide), inside the pill's `px-2` padding — no overflow at 100 % text size.
  At the 200 % text step the long pair (`تیار ہو رہا` + `جواب دے رہا`) estimates to ≈284 dp if the
  fallback face advances at 0.5 em, ≈334 dp at 0.6 em, and ≈362 dp once the token's 0.06 em
  tracking is added — against ≈343 dp of content width on a 375 pt phone, so the 200 % step can
  wrap or clip (the badges carry no `numberOfLines`). Treat that as a frame check, not a defect.

## 6. Note against the operator's "no English anywhere" bar

`mobile.computers.wait.tunnel_status` renders Radient's own untranslated status word by design:
«Radient کے پاس ٹنل ہے — active۔». That is the brief's intent (the note says {status} is inserted
verbatim), not a defect — but it is the one place an Urdu interface shows English and deserves an
explicit confirmation against the bar rather than being discovered later.

## 7. Evidence

All in this session's scratchpad
`/Users/damian/.local-operator/sessions/1e150ddd75d3/scratchpad/`:

- `receipt.json` — machine-readable receipt (hashes, findings, mechanical results, render notes)
- `report.md` — this report
- `audit.log` — execution log: each section is a real command and its actual output
- `audit-ur.mts`, `bidi-punct-ur.mts`, `coverage-ur.mts`, `build-audit-log.sh` — the scripts that
  produced those outputs (run from the worktree root against the worktree's own parser)

Nothing was written into the repo. The ledger row and the `i18n/audits/evidence/...` bundle are
the implementer's/manager's step — this brief made the worktree read-only for me.
