# M1 native-mobile English closure — `ur` round-2 delta audit

- Locale: `ur` (RTL) · file group: the 53-key M1 mobile slice
  (`mobile.common` 4, `mobile.computers` 6, `mobile.session` 16,
  `mobile.settings` 27)
- Round: **2 — delta audit** of the translator's revision (`ur.json` → `ur.v2.json`),
  not a re-audit of the 39 unchanged values.
- Translator under audit: a different agent (`i18n-translator` / m1-rm-ur,
  session `bac1ce0d95f8`, reported `openai/gpt-6.1-sol`); not observed here.
- Auditor: `i18n-auditor` (lopdev), session `67973ed5e595`,
  **actual served model `deepseek/deepseek-flash`** (this run's model header; no
  provider-fallback notice appeared in this transcript).
- Audited revision: mobile worktree `i18n-app-scan` at
  `84c4bee109d048e3dad0f996921e1b8ed561dfc8`.
- Read-only: no translation byte, catalogue value or translator file was edited.
  No translation/MT/API/dictionary service was used anywhere in this audit; no
  other round-2 report was read.
- Report path (this file): `<scratch>/m1-a2-ur/report.md`; bundle copies live in
  `i18n/audits/evidence/ur/<namespace>/ur1111m1r2/` (one per namespace, this
  slice's four).

## Verdict

**clean-with-findings** — ledger status `passed`.
0 BLOCKER · 0 MAJOR · 1 MINOR (process, not copy) · 4 NIT.
No wrong or unsafe meaning, no broken placeholder or plural arm, no key drift,
no stray English, no manual bidi controls, no glossary term used inconsistently
across files. The MINOR is a missing glossary/style-guide landing, not a wording
defect; nothing here blocks the catalogue commit.

## Scope actually judged

| Task item | What I did |
|---|---|
| (1) diff v1 → v2 | 14 changed keys (no key added or dropped; order and set identical to source). Judged those 14 for accuracy, idiom, register, terminology, fit and RTL; **not** re-audited the 39 unchanged values |
| (1b) neighbour contradiction | checked every changed value against its unchanged neighbours in the same namespace — no contradiction found |
| (2) declined findings | adjudicated both (B-N2, B-N4) with my own shipped-catalogue counts; both **upheld**; also ruled on the one deferred item (U-A-01) |
| (3) full mechanical pass on v2 | 53/53 keys — set/order, ICU argument names and kinds, plural arms against CLDR `ur`, `#` per arm, empties, source-identical values, bidi controls, script hygiene, punctuation, widths; plus a render of all 53 through the app's own parser |
| (4) the two sign-out safety lines | distinct, unambiguous, and neither reads as an agent/chat session — see below |
| (5) vi/es out-of-slice proposals | not applicable to `ur`; the slice's own out-of-slice observation (see Observations) was verified against shipped bytes |

## The 14 changed keys (delta), judged

| Key | v1 → v2 | Judgement |
|---|---|---|
| `mobile.common.not_found.action` | پر → میں | ur-M1-R2-02: grammatical, but no shipped precedent for «میں واپس» (0/649) and the shipped returning-navigation labels use «پر» |
| `mobile.common.not_found.next` | پر → میں | same ur-M1-R2-02 |
| `mobile.computers.wait.paused` | repeated «نگرانی» | **fixed correctly** — «نگرانی جاری رکھنے کے لیے» now names what resumes; matches EN "to keep watching" |
| `mobile.session.chip.effort_change_failed` | شدت → استدلال کی شدت | **fixed correctly** — matches the 6 shipped explanatory values; agreement `ہو سکی` with fem. «شدت» ✓ |
| `mobile.session.subagent.no_rows` | خالی ہے → کوئی سطر نہیں | **fixed correctly** — narrower claim preserved ("no rows of its own"), not "the transcript is empty" |
| `mobile.settings.about.blurb` | sentence order | accepted: all three claims, all four kept names and the (MIT) parenthetical survive; reorder is a first-strong mitigation (Observation 1) |
| `mobile.settings.account.delete` | میرا → اپنا | **fixed correctly** — «اپنا» agrees with masc. «اکاؤنٹ»; matches the one shipped «اپنا» imperative |
| `mobile.settings.account.delete_help` | «نہیں بدلتے» → «متاثر نہیں ہوتے»; delete-cause clause | **fixed correctly** for the reassurance (matches the 2 shipped «متاثر» values) and the deletion is now the stated cause, not the browser; ur-M1-R2-04 is a redundancy nit only |
| `mobile.settings.account.signed_in` | «سائن ان ہے» → «سائن ان شدہ» | **fixed correctly** — adjectival state, appropriate as a screen-reader accessible name |
| `mobile.settings.section.about` | «تعارف» → «ایپ کے بارے میں» | **fixed correctly** — idiomatic About heading; «متعلق» (round 1's other suggestion) would be an incomplete fragment. 5→15 cells is fine for a section header |
| `mobile.settings.sign_out.body` | rewritten | **fixed correctly** — see "Safety lines" below |
| `mobile.settings.sign_out.done` | + «سائن ان کا» | **fixed correctly** — the toast's "on your computer" claim is preserved and now names the sign-in session; ur-M1-R2-05 is a toast-fit question only |
| `mobile.settings.text_size.following` | «اسی کے مطابق ہے» → «ایپ اسی کے مطابق ہے» | subject fixed; ur-M1-R2-03 is an idiom preference for «پیروی کر رہی ہے» |
| `mobile.settings.text_size.overridden` | «اوپر منتخب سائز اس کی جگہ…» | acceptable — "the size chosen above is being used in its place" carries EN "Overridden above"; `{percent}` and `%` kept |

## (4) The two safety lines

DIALOG `mobile.settings.sign_out.body` (190 cells):
«اس سے کنٹرول پلین پر سائن ان کا سیشن ختم ہو جاتا ہے اور اس فون سے بھی اس کی
محفوظ معلومات ہٹ جاتی ہیں، اس لیے ٹنل اس فون سے درخواستیں قبول کرنا بند کر دیتا
ہے۔ آپ کا کمپیوٹر متاثر نہیں ہوتا۔» — control-plane session ends **and** this
phone forgets it, therefore the tunnel stops accepting this phone, computer
untouched. The causal «اس لیے» is kept; «محفوظ معلومات» attaches to the session
(«اس کی» agrees with fem. «معلومات»), not to the phone; nothing implies a tunnel
deletion or an agent session.

TOAST `mobile.settings.sign_out.done` (67 cells):
«سائن آؤٹ ہو گیا۔ آپ کے کمپیوٹر پر سائن ان کا سیشن منسوخ کر دیا گیا۔» — the
session was revoked **on your computer**. Distinct location from the dialog,
exactly as the English source is written (Observation 2).

Both name the object **سائن ان کا سیشن** (sign-in session), so neither can be read
as an agent/chat session; the unchanged dialog title/confirm («سائن آؤٹ کریں؟» /
«سائن آؤٹ کریں») name the *action*, which is the correct contrast. Requirement met.

## Findings

### MINOR

**ur-M1-R2-01 — glossary rows for the terms this slice introduces are still
unlanded** · keys `mobile.settings.sign_out.body`, `.done`
(«کنٹرول پلین», «سائن ان کا سیشن»), `mobile.session.chip.effort_change_failed`
(«استدلال کی شدت» vs the compact label «شدت»), `mobile.settings.diagnostics.route`
(«راستہ» vs «اکاؤنٹ روٹنگ»)
Current copy is mutually consistent and non-blocking, but `en.md` ("a new concept
needs a glossary row before it ships in copy") and `glossary.md` §4 ("new terms
are added by the wave that first needs them") are not yet satisfied: the four
proposals sit in `ur.v2-changes.md` §Glossary proposals only.
Fix (landing commit, not a re-wording): add the four rows to
`i18n/glossary.md` (`control plane`, `effort` prose-vs-label split, `sign-in
session`, `route` vs `account routing`) and record the `ur` calls in
`i18n/style-guides/ur.md` under "Locale calls".

### NIT

**ur-M1-R2-02** · `mobile.common.not_found.action` «سیشنز میں واپس جائیں» and
`mobile.common.not_found.next` «…اپنے سیشنز میں واپس جائیں» (the v2 change).
Grammatical («دفتر میں واپس جائیں» is fine Urdu), so this is precedent, not
meaning. Shipped `ur` has **0** values with «میں واپس» and its two
returning-navigation labels use «پر» («ایپ پر واپس جائیں», «Local Operator پر
واپس جائیں»). Suggested: «سیشنز پر واپس جائیں» (19 cells, one shorter than now)
— or, if the list should be named, «سیشنز کی فہرست پر واپس جائیں» (28 cells; the
catalogue already calls the destination «سیشن کی فہرست» in
`mobile.session.not_connected.next`).

**ur-M1-R2-03** · `mobile.settings.text_size.following` current
«…{percent}% ہے۔ ایپ اسی کے مطابق ہے۔» — the subject fix is right, but «مطابق»
governs a rule or standard, so the line reads faintly as "the app complies with
it". Suggested «… ایپ اسی کی پیروی کر رہی ہے۔» (57→64 cells; a help line that
already wraps).

**ur-M1-R2-04** · `mobile.settings.account.delete_help`, second sentence
«اکاؤنٹ حذف کرنے سے اس کے تمام ٹنلز بھی حذف ہو جاتے ہیں۔» repeats «حذف» twice in
one clause. Suggested «اکاؤنٹ کے ساتھ اس کے تمام ٹنلز بھی حذف ہو جاتے ہیں۔»
(55→51 cells, same claim: the account goes and its tunnels go with it).

**ur-M1-R2-05 (fit, unproven)** · `mobile.settings.sign_out.done` grew
53 (en) → 56 (v1) → **67 cells** (v2): two sentences in a toast, and no
`maxCells`/`maxChars` hint exists for any of the 53 keys (the `en` context
sidecars carry only `role`/`note` — verified). I have no rendered frame and
claim none. If the toast clips at the smallest supported width,
«…پر سائن ان کا سیشن منسوخ ہو گیا۔» saves 4 cells (63) without losing the claim.
This is a rendered-evidence question for the visual lane, not a wording defect.

## Adjudication of the translator's dispositions (my own counts)

Counts below are mine, recomputed over the shipped 649-key `ur` catalogue at
`84c4bee1` (not the translator's numbers, though they agree).

| ID | Disposition | My evidence | Ruling |
|---|---|---|---|
| U-A-01 `mobile.settings.connection.use` «استعمال کریں» | **deferred** (fit) | 12 cells vs en "Use" 3; no `maxCells` hint exists; the row also carries «تازہ کریں» (9 cells), so "Use" alone does not set its width; «استعمال» (7) as the round-1 suggestion would be a noun fragment and costs the respectful imperative | **Deferral upheld.** Shortening buys width by breaking the register; rendered proof is still owed by the visual lane — I do not claim it |
| B-N2 `mobile.settings.diagnostics.route` «راستہ» vs «روٹنگ» | **declined** | «روٹنگ» 5/649 keys, **all** `mobile.account_routing.*` (the feature name); «راستہ» 0/649. The English row is a concrete path ("Route" beside "Direct relay" / "Radient tunnel") | **Decline upheld** — conflating the feature with the path would be the error. (Round 1's own text also said "keep unless consistency wanted", so no change was asked for) |
| B-N4 `mobile.settings.diagnostics.route_radient` «Radient ٹنل» | **declined** | shipped `ur` writes the product name first with an Urdu head noun 5 times («Radient کنسول» ×5, «ٹنل» ×3 keys); the value is rendered in a deliberately LTR writing cell | **Decline upheld** — the order is the catalogue's own pattern, and no wording change was requested |

Nothing was overturned. Total: 2 declines upheld, 1 deferral upheld.

## Mechanical pass on v2 (53/53) — actually run

| Check | Result |
|---|---|
| key set / order | 53/53, identical to source order; 0 added, 0 dropped; valid JSON |
| ICU arguments | 5 parameterised keys; names and kinds identical to source (`{sessions}` plural, `{version}` simple, `{percent}` simple); arguments also equal the context sidecar's declared placeholders on the 51 keys that carry a record |
| plural arms (CLDR ur) | both plural keys carry `one` and `other` with `#` inside each arm; `Intl.PluralRules('ur')` via the app's `pluralCategory`: 0→other, 1→one, 2/11/21/100→other; rendered 0→«0 جاری سیشنز», 1→«1 جاری سیشن» ✓ |
| render through the app's own code | all 53 parsed and formatted with the checkout's `parseMessage`/`formatMessage` at locale `ur`: **53/53 OK**, 0 unexpanded braces, 0 failures |
| empties / source-identical | 0 empty; 0 identical to English (only the kept names Local Operator, Team Bridge, Radient, MIT appear in Latin, exactly as often as in source) |
| bidi controls | 0 code points from LRM/RLM/FSI/PDI/ALM/PDF/LRI/RLI, and 0 characters of Unicode category `Cf` anywhere in the 53 |
| script hygiene | 0 Arabic yeh/kaf/teh-marbuta/alef-maksura; 0 Urdu/Arabic-Indic/Devanagari digits (Latin digits per guide); 0 Hindi danda; 0 «!»; 0 ASCII `. , ? ; :` in translated prose; punctuation only ۔ ، ؟ with correct spacing; 0 space-before-punctuation; 0 double/leading/trailing spaces |
| widths | widest values: `sign_out.body` 190, `account.delete_help` 186, `about.blurb` 160 cells — all long help paragraphs that wrap; the only open fit question is ur-M1-R2-05 |
| repo validator | `npm run -s i18n:check` in the worktree → exit 0: `catalogue.gen.ts is current (649 keys, 21 namespaces, …)`; `check-strings: 212 finding(s), all baselined; 0 new`. **This proves repo state, not v2**: the staged values are not in the tree |
| landing target | all 53 shipped `ur` values are still byte-identical to English (53/53) — the acceptance gap the slice closes; every key exists, so the change is a replacement, not an addition |

## Observations (not findings)

1. **`about.blurb` reorder is a mitigation, not the fix.** `settings.tsx` renders
   that note in a plain `<Text>` without an explicit writing direction, so
   first-strong resolution decides the paragraph's base direction. Starting with
   Urdu works around it without any bidi control character; the durable fix is
   the render site. The value itself preserves all three claims.
2. **The two sign-out lines intentionally name different locations** — the
   control plane in the dialog, the computer in the toast. That asymmetry is in
   the English source; harmonising it would be a source change, not a
   translation fix. The translator kept it deliberately and said so.
3. **Out of slice, verified in shipped bytes:** `mobile.session.chip.effort_resume_hint`
   reads «کوشش بدلنے کے لیے یہ سیشن دوبارہ شروع کریں» — «کوشش» is "attempt"; the
   catalogue's term for effort is «استدلال کی شدت» (6 keys). Pre-existing, not one
   of the 53 keys, and not counted as fixed here. Recorded for a future `ur`
   pass; not a follow-up issue.
4. **Slice-assembly artifact, not a source gap:** `keys.json` has no context
   record for `mobile.computers.wait.nothing_answered_help` and
   `mobile.settings.sign_out.confirm`, but the repo's `en` context sidecars do
   carry notes for both (checked). No `en` context sidecar carries a width hint
   at all — `role` and `note` are the only fields — so fit can only be settled
   by a rendered frame.
5. **Spelling of sign-in:** this slice uses «سائن ان»; shipped `ur` also has
   «سائن اِن» (with kasra) in two `mobile.oauth.*` values. The slice is internally
   consistent and matches the dominant shipped form («سائن ان» in 17 keys), so I
   did not raise it; the split is pre-existing.

## Ledger and evidence

The RFC-named ledger command is `scripts/i18n/ledger.py append` (core repo). It is
present on the core `origin/main` (`2b89089`) but **absent from the checked-out
core branch** used here, and it appends per-key rows into the core catalogue's
`i18n/audit-history`: rows that assert audited *shipped* coverage. The bytes
audited here are the translator's **uncommitted** staged values, and the shipped
`ur` catalogue still holds English for all 53 keys, so appending now would claim
coverage the shipped catalogue does not have. **No ledger row was written and no
ledger CLI output is claimed.** The equivalent record is this bundle:

`i18n/audits/evidence/ur/<namespace>/ur1111m1r2/{record.json,report.md,audit.log}` —
one bundle for each of the slice's four namespaces, the same slice report and the
same executed `audit.log` in each, with per-namespace key counts. Whoever lands
the catalogue commit should append the ledger row (status `passed`) pointing its
`note` at these records.

Reproduction (scripts retained in `<scratch>/m1-a2-ur/`, hashed in the record):
`checks.py` (mechanical), `evidence.py` (shipped counts, hashes),
`render.mts` (renders through the app's own `src/i18n/messages.ts`). Every command
and its **actual** output is in `audit.log`; nothing above is quoted from memory.
Limits: no rendered frame, no native build, no human native-speaker review — this
is one independent second-pass audit's reading, and it is not design or RTL
sign-off.
