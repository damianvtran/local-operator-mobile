# ur (Urdu) — M3 slice S1 notes — sign-in + computers

Translator: `i18n-translator` subagent, model `deepseek/deepseek-flash` (actual, no fallback used).
Locale: `ur` — RTL. Scope: the 44 entries in
`translation-brief-s1.json` (sha256 prefix `531e6edd8e5f9af5`, verified full digest
`531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`).
Namespaces: `mobile.computers` (31), `mobile.signin` (13).

Inputs read: en source + context sidecars (`src/i18n/catalogues/en/mobile.computers{,.context}.json`,
`mobile.signin{,.context}.json`), the call sites (`src/features/auth/computers.tsx`,
`tunnel-paths.tsx`, `sign-in-panel.tsx`, `welcome.tsx`), the existing `ur` catalogues
(`mobile.computers`, `mobile.signin`, `mobile.common`, `mobile.chrome`,
`mobile.account_routing`, `mobile.team_bridge`, `mobile.projects`, `mobile.settings`,
`mobile.session`), `i18n/style-guides/ur.md`, `i18n/glossary.md` (both at
`~/local-operator` `origin/main`), `docs/i18n.md` (mobile).

## Register

- **آپ** throughout, respectful imperative (`کریں` forms); no `تم`/`تو`. Per the `ur`
  style guide (§ Formality & tone) and consistent with every existing `ur` catalogue.
- Terse product voice: badge words stay single words; buttons one verb or a short
  verb phrase; no `!`, no padding honorifics, no `براہ کرم` (the English never says
  "please" in these strings).
- Urdu punctuation only: `۔` full stop, `،` comma, `؟` question mark. No manual bidi
  controls (style guide § RTL & bidi; `docs/i18n.md` "No manual bidi control
  characters"). The render layer isolates each string, so LTR islands
  (`Local Operator`, `Radient`, `URL`, `{status}`) stay byte-identical Latin in
  logical order and are not wrapped or reordered.

## Glossary / terminology decisions (reused, not reinvented)

Reused verbatim from the existing `ur` catalogues:

| Term | `ur` | Where it already exists |
|---|---|---|
| computer | کمپیوٹر (pl. کمپیوٹرز) | every `ur/mobile.computers` value |
| tunnel | ٹنل | `mobile.computers.disabled_help`, `harness_help` |
| relay | ریلے | glossary §2 + `mobile.account_routing.unavailable` |
| route | راستہ | `mobile.settings.diagnostics.route`; `wait.host_answering` uses «راستہ تیار» |
| sign in / sign in with | سائن ان / سائن ان کریں | `mobile.signin.*`, `mobile.chrome.home.sign_in` |
| address and password | پتہ اور پاس ورڈ | `connect_refused.generic`, `save_refused.*` |
| refresh | ریفریش کریں | `mobile.team_bridge.list.directory_incomplete`, `thread.refresh_error` |
| remove / dismiss | ہٹائیں | `mobile.notifications.dismiss`, `mobile.projects.*` |
| unknown | نامعلوم | `mobile.session.chip.model_unknown` |
| active | فعال | `mobile.computers.badge.active` |
| connecting | منسلک ہو رہا | `mobile.computers.badge.connecting` |
| "in this build" | اس بلڈ میں | `mobile.team_bridge` (same idiom already shipped) |

New terms chosen this wave (proposed for `i18n/glossary.md` §2 — the rationale for
each is the "proposals" paragraph at the end of this file):

- **harness** → ہارنس (transliterated, declined with `کا` after the Latin product
  name). `Local Operator` itself stays Latin per glossary §1. No earlier `ur`
  rendering exists in core or mobile.
- **advanced (path)** → پیش رفتہ. «جدید» would read "modern" — wrong sense.
- **path** (the choose-a-path UI concept) → طریقہ, so it does not collide with
  **route** → راستہ (which the `status.route_ready` badge owns).
- **provisioning** → تیار ہو رہا · **suspended** → معطل · **disabled** → غیر فعال
  (contrast pair with فعال, and `disabled_help` already says «فعال نہیں») ·
  **revoked** → منسوخ (the `ur` word for revoking access; `منسوخ کریں` is also
  "Cancel", but the two never share a screen: this is a badge, Cancel is a dialog
  button) · **answering** (probe result) → جواب دے رہا, mirroring «منسلک ہو رہا»
  and `wait.answered`'s «جواب دیا».

Lower-case badge casing: the English `meta` badges are lower-case monospace. Urdu
has **no letter case**, so the "keep lower case" instruction has no direct
equivalent (style guide's CJK/Devanagari/Urdu note) and is recorded here rather
than faked with anything unnatural.

## Per-key rationale (non-obvious only; the rest are direct)

- `not_harness` — "This computer is not running the Local Operator harness."
  Kept the harness noun (ہارنس) instead of dropping it, so the row still says *what*
  is missing, with `کا` so the Latin product name is not declined itself.
- `wait.listing` — «انتظار ہے کہ Radient آپ کے کمپیوٹر کو فہرست میں شامل کرے…»
  uses Urdu's `انتظار ہے کہ <clause>` frame. The shipped `wait.answering` shape
  («جواب آنے کا انتظار ہے») would have forced a double genitive here
  («Radient کے آپ کے کمپیوٹر کو … لانے کا انتظار»), which reads clunky; the
  `کہ` clause says the same thing without it. Ellipsis kept, no full stop.
- `wait.tunnel_status` — «Radient کے پاس ٹنل ہے — {status}۔» "have the tunnel" is
  `کے پاس … ہے` in Urdu; `{status}` is left exactly where English puts it (final
  position, after the em dash) and untranslated. The closing `۔` sits at the end of
  the logical string, so bidi reserves it to the RTL end — no control characters
  added.
- `list.heading` — plural کمپیوٹرز for "Your computers" (the row fallback name
  `added.fallback_name` stays singular, as it names one computer).
- `own_tunnel_instead` / `own_action` — «اس کے بجائے» renders "instead"; both keep
  اپنی ٹنل so the two labels stay the same concept.
- `remove.title` / `remove.confirm` — «یہ کمپیوٹر ہٹائیں؟» follows the shipped
  confirm-question pattern (`mobile.settings.sign_out.title` «سائن آؤٹ کریں؟»,
  `mobile.library.editor.discard_title` «تبدیلیاں چھوڑیں؟»); the button is the bare
  verb ہٹائیں, like `mobile.notifications.dismiss`.
- `remove.body` — the object is spelled out («اس کمپیوٹر کو») instead of a bare
  Urdu `اسے`, because the same pronoun would then sit next to the dialog's own
  `یہ`. Kept all three negations in one clause: «کمپیوٹر، اس کی ٹنل یا آپ کے اکاؤنٹ
  پر کوئی اثر نہیں پڑتا» ("touches … not at all"), staying local-to-phone in the
  first sentence without adding an "only" the English does not have.
- `paths.recommended` — تجویز کردہ (adjective badge, 10 chars) rather than
  سفارش کردہ; the title row wraps (`flex-wrap`, U-06 in the source), so the longer
  Urdu title is safe beside it.
- `paths.radient_title` — «Radient سے جڑیں» (imperative "join/connect"), short
  enough for the title+badge row; منسلک ہو جائیں was rejected as a stative form.
- `paths.radient_body` — kept the honest cost first («Radient اکاؤنٹ درکار ہے»),
  then the three benefits; `URL` stays Latin; "authenticated" → تصدیق شدہ
  (existing `ur` verb for verify); "no relay password to keep" → «ریلے کا پاس ورڈ
  بھی نہیں سنبھالنا پڑتا» ("no password to look after either" — the negated verb
  with `بھی` carries the English "no … to keep").
- `paths.own_body` — «پیش رفتہ طریقہ» keeps "advanced" as expertise, not "modern";
  "publish your computer yourself" → «خود دستیاب کرتے ہیں» (make it available
  yourself) because «شائع کرنا» would read as publishing an article; "through a
  tunnel you run" → «اپنی چلائی ہوئی ٹنل کے ذریعے»; "no account needed at any
  point" and "you keep the password" both preserved.
- `signin.title` / `start` / `use_address` — «سائن ان» (no diacritic) is the form
  the shipped catalogues use in verb constructions (`mobile.chrome.home.sign_in`
  «سائن ان کریں», `stage_signed_in`, `stage_cancelled`). **Observation for the
  ledger, not mine to fix:** `ur/mobile.signin.json` mixes «سائن اِن» (4 keys:
  diagnostics, hide_diagnostics, progress, show_diagnostics) with «سائن ان»
  (9 keys). This wave follows the majority + the verb form; a later wave should
  normalise those four.
- `signin.intro` — the privacy guarantee is restated as a cause and effect: «سائن ان
  آپ کا براؤزر مکمل کرتا ہے، اس لیے ایپ کو آپ کا پاس ورڈ کبھی نظر نہیں آتا».
- `panel.waiting` — identical wording to the shipped `stage_browser` value, which
  is correct: the same fact, and the two are never on screen together.
- `panel.cancelled` — «سائن ان منسوخ ہو گیا تھا۔» uses the past-perfect `تھا` so the
  headline is distinguishable from the stage word `stage_cancelled`
  («سائن ان منسوخ ہو گیا», no full stop), as the brief asks.
- `panel.unavailable` — «اس بلڈ میں Radient کا سائن ان مکمل نہیں ہو سکتا» avoids
  assigning a gender to the Latin loan «بلڈ» by using the impersonal
  «… ہو سکتا» frame, and matches the shipped «اس بلڈ میں …» idiom.
- `panel.unavailable_alt` — «ریلے کے پتہ اور پاس ورڈ سے جڑ سکتے ہیں» reuses the
  shipped phrase in its correct oblique form.
- `welcome.body` — "drives the sessions" → «سیشن چلاتی ہے»; "your code never
  leaves it" spelled out as «اس مشین سے باہر نہیں جاتا», because Urdu `وہاں سے`
  ("from there") would leave the referent fuzzy.
- `row.a11y*` — order preserved (`{name} → {status} → {reach}`), separated by the
  Urdu comma `،`; the trailing word is byte-identical to the visible badge:
  فعال (`badge.active`) and منسلک ہو رہا (`badge.connecting`).
- `billing_inactive` — reuses «غیر فعال», «ریموٹ رسائی» and «مسترد» from
  `billing_help` / `connect_refused.*`.
- `try_now` — «ابھی کوشش کریں» ("try right now") rather than a bare «کوشش کریں», so
  the immediacy of "now" survives; it is the longest button in this slice at 14
  chars against English's 7 — a banner action with room to spare (see width).

## Judged-identical to English

**None.** No value in this slice is byte-identical to its English source. The
deliberately-Latin tokens and how they were judged:

- `Local Operator`, `Radient` — product/brand names, glossary §1 keep-as-is; they
  are *inside* translated sentences, not identical values.
- `URL` — kept Latin per the style guide's kept-Latin acronym list.
- `{status}`, `{name}`, `{reach}` — placeholders, inserted verbatim by design
  (`{status}` carries Radient's own English status word).

## Glossary proposals (for `i18n/glossary.md`)

None of these has a row today; each is a term six other locales will need in the
same strings, so recording one decision now stops six different answers.

| Proposed row | Policy | `ur` cell |
|---|---|---|
| harness | translate | ہارنس (declined with `کا`/`کی`; the product name before it stays Latin) |
| computer | translate | کمپیوٹر — pl. کمپیوٹرز |
| tunnel | translate | ٹنل |
| route | translate | راستہ (distinct from **path** → طریقہ) |
| provisioning | translate | تیار ہو رہا |
| suspended | translate | معطل |
| disabled | translate | غیر فعال (the negation of فعال) |
| revoked | translate | منسوخ |
| reachability / answering (probe result) | translate | جواب دے رہا (noun: جواب) |

`route` and `path` are the one pair worth a real decision rather than a default:
English separates the control-plane **route** from the **path** a reader chooses,
and Urdu can only keep them apart if `راستہ` is reserved for the route (as the
shipped `mobile.settings.diagnostics.route` already does) and the setup route is
called `طریقہ`.

## Width risks

Estimates are character counts, which the `ur` style guide measures as ≈1 cell per
char (FSI/PDI cost 0 and are applied by the render layer, not by me). No `maxCells`
exists in this brief; these are judgement calls from the call sites.

- `mobile.computers.try_now` — «ابھی کوشش کریں» 14 vs en 7. Banner `action` button;
  room available, but it is the one surface I would check first in a 320 pt frame.
- `mobile.signin.try_anyway` — «پھر بھی دوبارہ کوشش کریں» 24 vs en 16; quiet button
  at the bottom of the unavailable panel, wraps rather than clips.
- `mobile.signin.start` — «Radient کے ساتھ سائن ان کریں» 28 vs en 20; primary
  button, full width, two lines at worst.
- `mobile.computers.own_tunnel_instead` — 33 vs en 25; quiet `size="sm"` button, the
  longest label here. It wraps under the list, no `numberOfLines` cap.
- Badges are all ≤ 11 chars (route ready 10, provisioning 11, answering 11,
  suspended 4, revoked 5, disabled 8, unknown 7) — inside the `Badge` mono pill
  next to its sibling on one row at phone width.
- **Render risk (not a translation defect, for the design round):** the `status.*`
  and `reach.*` badges render `mono`. A monospace face may have no Arabic-script
  glyphs, so the platform falls back per run — worth a look in the Urdu frame
  alongside the truncation check.

## Catalogue validator

The English-first worktree `~/.worktrees/i18n-m3-s1` @ `1796c3a5` is **read-only for
me**, so I could not place the values in `src/i18n/catalogues/ur/` and run
`pnpm i18n:check` against them. Instead I ran the repo's OWN validator logic
directly against the draft:

- imported `parseMessage` from the worktree's `src/i18n/messages.ts` — the same
  parser `scripts/i18n/generate.ts` calls — and parsed all 44 values;
- compared each value's parameter **names and kinds** against the English source
  (generate.ts's "parameter parity" block);
- checked key set **and order** against the brief (44/44, order preserved);
- checked NFC, no manual bidi controls (U+200E/200F/202A–202E/2066–2069/061C), no
  Devanagari danda, full-stop and ellipsis parity with English, no stray
  leading/trailing whitespace, and byte-identical Latin tokens.

Result:

```
PASS: 44/44 values parse and match EN parameters
```

Script: `validate-ur-s1.mjs` (this scratchpad). No errors, nothing fixed after the
first run. The real `pnpm i18n:check` runs when the implementer applies the draft — a
key-set, namespace or parse failure there would most likely be mine, so it is worth
running before the PR.

## Deliverables

- `draft-ur-s1.json` — 44 key/value pairs, brief order, UTF-8, tabs.
- sha256 `d1817d7bbef44516207eda3e4713058d4f5f21dd5bdc4aad11390ffda3b66bca`
  (after the three wording refinements below; the pre-refinement draft was
  `46b571d9…954b1`, same 44 keys, same parameters).
- `validate-ur-s1.mjs`, this file.
