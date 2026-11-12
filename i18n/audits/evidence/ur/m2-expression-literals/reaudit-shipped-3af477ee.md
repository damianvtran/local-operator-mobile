# M2 expression-literal slice — `ur` (RTL) — re-audit of the SHIPPED bytes

- Task: `m2-reaudit-ur` — independent re-audit of the 33 M2 keys as they ship in PR #236.
- Locale / group: `ur` (RTL) · M2 expression literals (4 `mobile.computers`, 15 `mobile.session`, 14 `mobile.settings`).
- Worktree read: `~/local-operator-mobile/.worktrees/i18n-m2-scanner` @ `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a`; base `fa2bc5e0`.
- Auditor: agent `i18n-auditor`, session `7747531ffee4`. Served model: `deepseek/deepseek-flash` (the model this
  session runs on; no provider error or fallback surfaced in the run). Independent of the translator
  (`i18n-translator`, `openai/gpt-6.1-sol`, sessions `eda2ad82b76a` / `c716c95097e5`) and of every earlier auditor of
  this slice (round 1 `deepseek-flash` + `claude-sonnet-5-5`, round 2 `claude-sonnet-5-5`). No translation/MT service
  used; nothing edited (repo, catalogues, bundle, ledger). Read-only per brief.

## Verdict: **clean-with-findings** — 0 BLOCKER · 0 MAJOR · 2 MINOR · 4 NIT

`passed` is available under the ledger rule (no BLOCKER/MAJOR). Both MINOR findings are **bidi/isolation wiring, not
copy**: no Urdu value needs a wording change for them. Neither requires a translator change; they need a call-site
edit (`useComposedDir()` / the `LTR_WRITING` pin) in the app lane, or an explicit acceptance.

## 1. The shipped bytes I audited (hashes)

Canonicalisation for the two aggregate hashes: sorted keys, `ensure_ascii=False`, separators `,`/`:`, UTF-8, no
trailing newline.

- **target** (33 shipped `ur` key→value pairs): `fe3e3520bcda0baa785a598f74974a8a7abd4bba06a306aa2dfa5e020f9df737`
- **source** (the same 33 keys from `en`): `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528`

| file | sha256 |
|---|---|
| `src/i18n/catalogues/ur/mobile.computers.json` | `d0e22582731fcafc91aae4e817e4a77f7d486cadad4673c43f0dbef9b4c67db3` |
| `src/i18n/catalogues/ur/mobile.session.json` | `76c26e12caf9993464403f57473ecaa4e6601870f8f036c02163a40f9b6b8147` |
| `src/i18n/catalogues/ur/mobile.settings.json` | `66378236b2e25b533ee032e70a966c4e4ff0fecc96724c45028fbbade8830da0` |
| `src/i18n/catalogues/en/mobile.computers.json` | `713827837aab9d75611441155d50522ccce9d8b410d88c1b7bd27e528776aff3` |
| `src/i18n/catalogues/en/mobile.computers.context.json` | `cc2973003f79db729001df88189b1f1ba52a0609e117fe384396a406437637e0` |
| `src/i18n/catalogues/en/mobile.session.json` | `8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3` |
| `src/i18n/catalogues/en/mobile.session.context.json` | `a988f1c90c380802bef31c8f8737cc9a6f32334518c652283a3d3dd210520ae5` |
| `src/i18n/catalogues/en/mobile.settings.json` | `d7e1d85b68773871a578791ad57e0a08e421a220738e561b9e09ce22f9aee23d` |
| `src/i18n/catalogues/en/mobile.settings.context.json` | `67691ab95fba5cbcc86596899504ce2b9ba1acd518b3a9bdc1048dcc22b54c12` |
| `i18n/audits/evidence/ur/m2-expression-literals/final.json` | `0e2d233310ad774bc2da4beafa6ca34da46d16f641772e93768e359191f1dc2b` |

Reference inputs read: style guide `~/local-operator/i18n/style-guides/ur.md`, glossary `~/local-operator/i18n/glossary.md`,
the six tracked bundle files in `i18n/audits/evidence/ur/m2-expression-literals/` and `…/NOTE-m2-expression-literals.md`.
The bundle's own manifest rows for `ur` verify against the committed bytes (6/6); `round1-B.md`'s *original* hash differs
from its committed hash exactly as the note's "home prefixes normalised, trailing whitespace stripped" disclosure predicts.

## 2. Shipped == audited text? (step 3 — the reason this re-audit exists)

**Yes, with one key re-read in full and none of the text changed by the four-key rename.**

- `final.json` is **byte-identical as a mapping** to the 33 shipped pairs (`final == shipped` → `True`, 33/33 keys, 0
  differing values, 0 missing, 0 extra). Its own sha256 is in the table above.
- 32 of the 33 shipped values appear **verbatim** in a tracked round report: 28 in `round2.md` (the last
  round, `anthropic/claude-sonnet-5-5`, `0B/0M/0m/1n`) — per-key citation list in §9.
- The 33rd, `mobile.computers.wait.host_answering`, is quoted in two audited halves and reconstructs exactly:
  sentence 1 `آپ کے کمپیوٹر ({host}) سے جواب آنے کا انتظار ہے۔` is the value recorded in `translator-v2-changes.md`
  (it is round-1 A's own suggested wording, applied as A-F8), and sentence 2 `راستہ تیار ہونے کا مطلب یہ نہیں کہ
  کمپیوٹر بھی چل رہا ہے۔` is byte-identical to the sentence round 1 A quoted in the v1 value it reviewed.
  Concatenation check (`s1 + " " + s2 == shipped`) → `True`. **No unaudited new text anywhere in the 33.**

**The rename.** The four region-label keys audited as `region.label.{working,subagents,todos,strip}` in round 2 ship
under those same names; the pre-rename defect the note describes was `label.working`-style dotted names, which appear
**nowhere** in this PR's history (`git log -S label_activity --all` → empty; `git grep 'region\.label_(activity|agents|tasks|status)'` → empty). Values are unchanged by the rename, and I checked that the rename did not **swap** values between keys:

| key | shipped `ur` | English source | attached to |
|---|---|---|---|
| `mobile.session.region.label_working` | `سرگرمی` (activity) | `activity` | `workingLineView` (`RegionKey` `working`) |
| `mobile.session.region.label_subagents` | `ایجنٹس` (agents) | `agents` | `subagentsPanel` (`subagents`) |
| `mobile.session.region.label_todos` | `کام` (tasks) | `tasks` | `todosPanel` (`todos`) |
| `mobile.session.region.label_strip` | `حالت` (status) | `status` | `statusStrip` (`strip`) |

Key names ↔ sidecar keys (`en/mobile.session.context.json`, all four present with notes naming the same bands) ↔ call
sites (`app/(app)/session/[id].tsx:1099-1104`, the `Record<RegionKey, string>`, with
`RegionKey = "working"|"subagents"|"todos"|"strip"` in `src/ui/size-class.ts:328` and
`regionNodes` at `[id].tsx:1049-1054`): **all four agree**. Each Urdu word is the semantically matching term for its
own English source, so a mis-pairing would have been visible — none is.

## 3. Mechanical pass — PASS (commands actually run, output quoted)

| Check | Command / method | Actual result |
|---|---|---|
| Catalogue generator (parses every value with `src/i18n/messages.ts`, enforces placeholder NAME **and** kind parity across locales) | `node scripts/i18n/generate.ts --check` | exit 0 — `catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)` |
| String ratchet | `node scripts/i18n/check-strings.ts` | exit 0 — `212 finding(s), all baselined; 0 new` |
| The diff's own tests | `vitest run src/i18n/__tests__/catalogues.test.ts src/i18n/__tests__/expression-literals.test.ts` | `Test Files 2 passed (2) · Tests 88 passed (88)` |
| App parser over the shipped `ur` values (independent harness, `tsx`) | `parseMessage` + `formatMessage` on all 33, params vs `en`, render with real args (`{host:"mac.local"}`, `{baseUrl:"https://10.0.0.2:8787"}`, `{percent:42}`, `{labels:"سرگرمی · کام"}`, `{name:"Office Mac"}`) | `parsed and rendered 33 keys; problems=0` — 0 param diffs, 0 leaked braces, 0 parse errors |
| Key set / parity / JSON | python: keys added vs `fa2bc5e0` = 33 (4/15/14); `en` vs `ur` key sets per namespace | 45=45, 78=78, 59=59 keys; all three files valid JSON |
| Placeholders vs English | python regex set + repo `parseMessage` params | identical per key: `{percent}`×4, `{host}`, `{baseUrl}`, `{labels}`, `{name}`×2; `back_to_session` and 22 others take none, as in English |
| ICU plural/select in the 33 | scan for `,\s*(plural\|select),` | **none** — so the CLDR-arm question is n/a here. (`ur` requires `one`/`other`; the only plural in these namespaces, `mobile.computers.wait.relay_sessions`, is pre-existing and ships `one`+`other` correctly.) |
| NFC / padding / emptiness | python `unicodedata` + strip compare | all NFC, none padded or empty |
| Manual bidi controls (RLM/LRM/FSI/PDI/LRI/RLI/ALM) | codepoint scan for `Cf` set | none — as `ur.md` "RTL & bidi" requires (the render layer isolates) |
| Wrong-script letters (`ي ك ى ة`) | codepoint scan | none (correct Urdu `ی ک`; no Arabic variants) |
| Digits policy | scan for `٠-٩`/`۰-۹` | none — Latin digits only, per `ur.md` "Numbers" |
| Punctuation inventory | codepoint set | `۔`×4 in the 3 sentence values (`host_answering` carries two sentences), `%`×4 (U+0025 ASCII), `·`×3 (U+00B7, space either side), `↑`×1 / `↓`×2 (U+2191/U+2193, unmirrored verticals), ASCII `(`/`)`×3 pairs; **no ASCII `.`**, no `،`, no `؟` |
| English residue | Latin-token scan + English-identical compare | only `Radient`×2, `Local Operator`, and placeholder names. `app_name` = `Local Operator` is the one English-identical value and is mandated (sidecar: "Never translated"). Allowed exceptions, named: **product names `Radient` and `Local Operator`** (glossary §1 / `ur.md` product-name policy), and the two pre-existing `mobile.computers.transport.radient` = `Radient` (product name, not this PR). |
| Namespace-wide English sweep (context for the operator's acceptance) | English-identical compare across the three namespaces | `computers`: only `transport.radient` (`Radient`); `session`: none; `settings`: only `app_name` (`Local Operator`). **No stray English in these three screens.** |

Disclosure: my first key-extraction pass counted 36 keys, because three pre-existing trailing rows (`wait.relay_sessions`,
`composer.retained_instruction`, `diagnostics.privacy_note`) appear as `-`/`+` in the diff when their line gains a comma.
Corrected by diffing the base catalogue (`git show fa2bc5e0:…`) instead of the diff text; every hash and count above is the
corrected 33.

## 4. Negative control — the checker bites (and one blind spot it had)

`tsx` harness over in-memory mutations; a mutation must be flagged or the audit is void.

```
CAUGHT  placeholder renamed :: placeholder parity(params ur(pct:text) en(percent:text))
CAUGHT  placeholder dropped :: placeholder parity(params ur(none) en(name:text))
CAUGHT  plural lost (arm removed) :: plural arms(ur one/other: missing); parse(throws: Invalid message …)
CAUGHT  RLM injected :: bidi control(CF char)
CAUGHT  left in English :: english residue(identical to English)
CAUGHT  unbalanced brace :: placeholder parity(ur PARSE-ERROR); parse(throws: Invalid message "{name پر واپس جائیں")
controls=6 uncaught=0
```

Honest note: the **first** run of this control reported `MISSED left in English`, because my English-residue rule carried
an over-broad `^[A-Za-z .]+$` exemption (meant for `Local Operator`) that also exempted a one-word English value. Fixed to
exempt exactly `mobile.settings.account.app_name` and re-run → all 6 caught. The python-side controls (placeholder
rename, missing plural arm, RLM, English, wrong Urdu letter) also all flagged.

## 5. Findings

### F1 · MINOR · bidi base direction not applied where the shipped value starts with a Latin token
- Keys: `mobile.settings.account.not_signed_in` (`Radient میں سائن ان نہیں ہے` — Latin-initial **always**);
  `mobile.computers.added.connected_to` (`{name} سے منسلک ہو گیا۔` — Latin-initial whenever the computer's own name is
  Latin, e.g. `Office Mac`). Same class, a11y-only: `mobile.session.back_to` (`{name} پر واپس جائیں`) — used purely as an
  `accessibilityLabel` (`video.tsx:168`, `agent/[jobId].tsx:95`), so no visual layout is affected.
- Evidence (source, derived here): react-native-web writes `dir="auto"` on every root `<Text>` without `dir`
  (`node_modules/react-native-web/dist/exports/Text/index.js:105-108`), which makes the browser resolve the paragraph base
  from the **first strong character** — Latin here — so the Urdu run lays out after (to the right of) `Radient` under an LTR
  base, inverting the intended right-to-left sentence order and `text-align: start`. The app has the exact mechanism for
  this (`useComposedDir()` / `composedDirection()` in `src/ui/direction.tsx`, whose own doc names this defect D1/D2), and
  **neither visible call site spreads it**: `git grep useComposedDir` finds `schedules.tsx`, `fold-bar.tsx`,
  `quiet-group-bar.tsx` only; `settings.tsx:308-310` (the `not_signed_in` line) and `computers.tsx:628-632` (`connected_to`) render root `<Text>` with no `dir`.
- What is *not* wrong: the Urdu wording. Name-first is the correct Urdu order (verb-final; the name is the anterior
  constituent), and `ur.md` forbids hand-inserting bidi controls — so no copy change is proposed. `useComposedDir` emits
  `{}` on native by design (its comment says native base comes from Yoga's layout direction); that claim is
  comment-level, not measured here, and I did not run a device/simulator frame (read-only, no rig).
- Suggested (wiring, app lane): spread `{...useComposedDir()}` on the two visible `<Text>`s; if the native claim is to be
  relied on, take one iOS + one Android RTL frame with a Latin computer name and record it.
- Why MINOR and not MAJOR: no wrong meaning, no broken placeholder, no glossary breach — the taxonomy's MAJOR set does not
  cover a base-direction wiring gap; and the copy is right. Flagged MINOR so it cannot be lost.

### F2 · MINOR · the Diagnostics row pins `writingDirection: "ltr"` on a premise this slice makes false
- Key group: `mobile.settings.diagnostics.stream_{idle,connecting,live,degraded,offline}` (all five are now Urdu words).
- Evidence: `DiagnosticRow` (`src/features/settings/settings.tsx:773-798`, the pin at `:793`) documents the pin as "a
  diagnostic value is a path, a hostname, a model id or a version — left-to-right by its own grammar" and spreads
  `LTR_WRITING` (`writingDirection:"ltr"`) on the value `<Text>`. For the Stream row that premise is no longer true:
  `فارغ`, `منسلک ہو رہا`, `آن لائن`, `جواب نہیں دے رہا`, `آف لائن` are translated RTL words. `LTR_WRITING`'s own doc
  (`src/ui/direction.tsx`) reserves it for values that "must still sit against the sentence's trailing edge … a diagnostic
  value column" — i.e. the path/host case, not prose in the reader's language.
- Expected impact: for a single all-Urdu run the words keep their internal order, so I expect no visible reordering —
  the defect is that the base is asserted LTR for text that is not; a mixed value in that cell (e.g. a state word plus a
  host) would flip. Stated as expectation, not proof: I ran no frame.
- Suggested (wiring): keep `LTR_WRITING` for the route/model/host rows and drop it (or branch on the row) for the Stream
  value; or state the stream value through `TEXT_END_CLASS` alone.

### NIT-1 · `mobile.session.region.end` `آخر · اسکرول کریں ↑`
`آخر` is also the everyday adverb "finally/after all", so the bare noun can read as an interjection for a beat; with
`· اسکرول کریں ↑` beside it the cue is unambiguous. Carried from round 2's NIT-1 (unchanged), non-gating; `اختتام` would
be heavier. No change requested.

### NIT-2 · `mobile.session.tray.context_short` is identical to the wide form
`{percent}% سیاق` for both, so the under-340 pt form buys nothing. I re-checked the recorded exception: the full word is
4 letters (`سیاق`, the shipped context term), `کنٹیکسٹ` is longer, and inventing a clipped fragment or Latin `ctx` would
abandon the shipped term. Accepting the exception is correct; it is a layout-QA carry, not a copy defect.

### NIT-3 · `mobile.session.region.label_subagents` `ایجنٹس` vs glossary `subagent → ذیلی ایجنٹ`
Correct as shipped: the English key is `agents`, the sidecar says "reuse the shipped agents/subagents term", and the
shipped relay tray is `ایجنٹس {running}/{total}` — the reader meets the same word in the tray above. Recorded only so a
future surface that says *subagent* does not reuse this value (it would contradict glossary §2).

### NIT-4 · `mobile.settings.diagnostics.stream_live` `آن لائن`
"live" for a *stream* is the stream being active; `آن لائن` is the online-ness of a link. Kept deliberately to match the
shipped `relay.health.live` = `آن لائن`, which is the right call for cross-surface consistency (`آن لائن`/`آف لائن` are a
recognised pair in this catalogue). No change requested; noted so the pair is not read as an oversight.

## 6. Checked on merits — correct, no finding

- **Accuracy/polarity**: every negation is single and correct — `نہیں ہے` (not signed in), `ابھی کنکشن نہیں` (no
  connection *yet*; the "yet" is kept, which is what keeps the `inactive` state from reading as a failure), `منسلک نہیں`,
  `جواب نہیں دے رہا`, and `… مطلب یہ نہیں کہ کمپیوٹر بھی چل رہا ہے` (route provisioned ≠ machine up — meaning preserved,
  including the "not the same as" turn). No omission or addition found; no destructive/permission text in the slice.
- **Register/tone**: `آپ` address throughout; respectful imperative `واپس جائیں`, `اسکرول کریں`; no `تم/تو`, no `!`, no
  padding honorifics; terse status words, sentence stops only on the three sentence-valued keys (four `۔`) and none on pill/status/label
  values (sidecars say "no final full stop" — all five pills and all four bands comply).
- **Terminology (glossary + shipped precedent)**: `سیشن` (§2), `ریلے`, `ایجنٹ`/`ایجنٹس`, `کام`, `حالت`, `سیاق`
  (shipped composer usage), `ویڈیو`, `ٹنل` (shipped diagnostics route), `منسلک`/`منسلک ہو رہا` (shipped badge/connecting),
  `جواب نہیں دے رہا` (shipped relay subtitle — the round-1 MAJOR is genuinely fixed and byte-identical),
  `فارغ` (shipped relay idle), `آن لائن` (shipped live), `سائن ان شدہ` family kept for the negative line.
  `subagents` note → NIT-3.
- **Idiom**: `{labels} نیچے` is the correct Urdu postpositional order for "below {labels}"; `{name} سے منسلک ہو گیا۔` uses the
  shipped event collocation (`ہو گیا` perfective); `براہ راست {baseUrl} سے منسلک` reuses the shipped `منسلک … سے`;
  `{name} پر واپس جائیں` matches the shipped `Local Operator پر واپس جائیں`; `(تخمینی)` is the adjective the parenthetical
  needs (round-1 F7 fixed, confirmed); `آپ کے کمپیوٹر ({host})` attaches the host to the computer as the sidecar intends.
- **Fit/length** (cells, combining=0, W/F=2 else 1, percent≈50): nothing exceeds its English counterpart where a hard cap
  exists — the only capped line is the account card's second line (`numberOfLines={1}`, tail ellipsis,
  `settings.tsx:311-323`): `route_direct` 28 vs 31, `route_radient` 26 vs 27, `no_connection` 15 vs 17 — all shorter than
  English. Growths elsewhere are on wrapping surfaces: `stream_degraded` +8 (16 cells, `numberOfLines={2}` + `flex-1` +
  `minWidth:0` in `DiagnosticRow`), `region` cues +4/+5 (19–29), `back_to` +6 (a11y label only), `not_signed_in` +1 (27,
  uncapped, wraps in a `flex-1` column), `wait.host_answering` −1. No sidecar carries `maxCells`/`maxChars` for this slice.
  Wide-glyph risk: none (no CJK/W/F characters in any value; Nastaliq width ≈1 cell per character per `ur.md`).
- **Shipped-vs-shipped consistency**: `status.not_connected` = `منسلک نہیں` is byte-identical to `mobile.home.picker.not_connected`;
  the five stream words are five different strings; `offline`/`stream_offline` agree; `not_answering`/`stream_degraded` are
  deliberately identical (sidecar defines degraded as open-but-not-answering, and the shipped relay maps both to this phrase).

## 7. RTL / bidi pass (the extra brief for `ur`)

Storage is logical order; `ur.md` forbids manual controls (confirmed: no `Cf` characters). Every Latin/digit island, by
resolution class:

| island | where | base resolves | note |
|---|---|---|---|
| `{percent}%` ×4 | `tray.context*` | **RTL, correct** | digits are `EN` and `%` is `ET`, neither is a strong character, so the first strong char is still `سیاق`; the island sits at the string start = right edge in RTL. Reads `42% سیاق`. |
| `Radient` | `route_radient` (mid), `not_signed_in` (**initial**) | mid: RTL ✓ · initial: **LTR — F1** | `آپ کے Radient ٹنل کے ذریعے`: Urdu on both sides, spaces both sides → isolated, no adjacency flip. |
| `{baseUrl}` | `route_direct` (mid) | RTL ✓ | URL is a strong LTR run with spaces both sides; `normaliseBaseUrl` strips the trailing slash, so no neutral at the run edge. |
| `{host}` | `host_answering` (mid, ASCII parens) | RTL ✓ | `(` sits between an Urdu letter and a Latin one → takes the RTL base and mirrors to `)` visually; `)` sits before ` سے` → mirrors to `(`. Net display `کمپیوٹر (mac.local) سے`, correct on both sides. |
| `{name}` | `connected_to` (**initial**), `back_to` (**initial**) | **LTR — F1** (back_to a11y-only) | with the fallback (`آپ کے کمپیوٹر`) the same strings are Urdu-initial and correct — the hazard exists only with a Latin name. |
| `Local Operator` | `app_name` | LTR, correct | whole value is the product name; used only to derive avatar initials. |
| `{labels}` | `below_labels` | **RTL, correct — fixed by this PR** | round 1's out-of-lane observation (English `activity/agents/tasks/status` spliced into the Urdu cue) is resolved: `REGION_LABEL` now resolves through `t()` to `سرگرمی/ایجنٹس/کام/حالت`, and the splice renders `سرگرمی · کام نیچے · اسکرول کریں ↓`. |

**Where the isolation actually happens (settles the round-1 dispute).** `ur.md` "RTL & bidi" states that the render
layer wraps each translated string in FSI/PDI and that manual controls would be double-applied. That is **not** what this
app does: there is no FSI/PDI (U+2066/U+2068/U+2069) anywhere under `src/` or `app/` (`grep` over `*.ts`/`*.tsx` → empty),
and `src/ui/direction.tsx` documents the real mechanism — `dir` on the web `<Text>` (`dir="auto"` unless a component passes
`dir`) plus the Yoga layout direction on native. So the translator's instruction (add no bidi controls) is still the right
call, but for a different reason: the isolation is a per-component `dir` prop, which is exactly why F1 is a call-site gap
and not a copy gap. The style-guide sentence should be corrected so a future translator is not told a mechanism exists
that does not.

Mirroring: no left/right arrow glyph appears in any value; `↑`/`↓` are vertical and must not be mirrored — they are not.
The `·` joiner is neutral with spaces either side (verified per character), so it takes the RTL base and stays between the
items. Sentence order is RTL-correct throughout (verb/postposition final, e.g. `سے منسلک`, `پر واپس جائیں`) — no mirrored
wrongly-ordered phrasing found.

## 8. Second independent pass (high-visibility settings group, 14 keys)

Re-read in reverse order against each sidecar note, after the first pass. Outcome: no finding was withdrawn, and **F2 was
added** by this pass (the first pass had only read `DiagnosticRow` for its line cap; the second read caught that the same
`<Text>` pins `writingDirection:"ltr"`, which the new Urdu stream words contradict). Adjudication kept unchanged:
`not_signed_in` (sidecar wants a name-line value, "no final full stop" — met; preposition `میں` idiomatic), `no_connection`
(vs `not_connected` vs `offline`: three distinguishable strings, "yet" retained), `stream_idle` `فارغ` (fits "no live
stream started", matches shipped relay), `route_*` (all shorter than English; `Radient` Latin per sidecar),
`app_name` (untranslated by instruction). Settings verdict after both passes: 0 BLOCKER, 0 MAJOR, 1 MINOR (F2), 1 NIT (NIT-4).

## 9. Per-key citation — where each shipped value was read by an auditor

A bare substring match is too weak for one-word values (`سیشن`, `کام`, `حالت`), so I required the value to appear within
260 characters of its own key name or its English source text. **33/33 keys pass that test.**

- `round2.md` (last round, claude-sonnet-5-5): `added.connected_to`, `added.fallback_name`, `back_to`, `back_to_session`,
  `fallback_name`, `region.end`, `region.label_{working,subagents,todos,strip}`, `region.more_below`, `tray.context`,
  `tray.context_{estimate,short,short_estimate}`, `video.title_fallback`; and 12 of the 14 settings keys (all but
  `route_direct` / `route_radient`, cited in round 1 A).
- `round1-A.md` (deepseek-flash): `wait.answering`, `region.below_labels`, `account.route_direct`, `account.route_radient`
  (plus `wait.host_answering` sentence 2).
- `translator-v2-changes.md`: `wait.host_answering` sentence 1 (the applied A-F8 wording).

Nothing in the 33 is unquoted in the bundle, and no key's audited text differs from the shipped text.

## 10. Ledger row — proposed, NOT written (read-only brief; ledger lives in the core repo)

```json
{"locale":"ur","namespace":"m2-expression-literals","source_sha256":"c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528",
 "translator":{"agent":"i18n-translator","model":"openai/gpt-6.1-sol","date":"2026-11-11"},
 "auditor":{"agent":"i18n-auditor (session 7747531ffee4)","model":"deepseek/deepseek-flash","date":"2026-11-11","result":"passed","findings":2},
 "status":"passed",
 "note":"Shipped-bytes re-audit at 3af477ee (rename unread by any round): 33/33 == final.json, all values cited in bundle. 0B/0M/2m bidi wiring (Latin-initial texts lack useComposedDir; DiagnosticRow pins ltr)/4n. target fe3e3520; final 0e2d2333."}
```

(`findings:2` counts MINORs only, matching the "no BLOCKER/MAJOR" `passed` rule; the note is 237 chars, under the
280-character cap, and carries the target hash (`fe3e3520`) and `final.json`'s (`0e2d2333`) so it can be checked against
this record. The tracked record the manager creates should carry the full finding list and the per-file hashes.)

## 11. Limits / what I did not prove

- No rendered frame: I ran no simulator/device/browser, so F1's native half and F2's visible impact are reasoned from
  source (RNW `dir="auto"`, `writingDirection` semantics, CSS `dir`), not captured. A frame with a Latin computer name is
  the missing proof, and it is a QA/design deliverable, not a copy fix.
- No MT service and no back-translation: judgement is native reading against the sidecar, the shipped catalogue and the
  glossary.
- I could not open the translator's candidate files (`~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/…`):
  a guardrail blocked reading another session's scratchpad (it read my `python3`/`head` as a write path) and its refusal
  is final. This did not affect the verdict — every claim above is derived from the shipped bytes, the tracked bundle and
  the source — but it is why the v1→v3 diff is cited from `round2.md`/`translator-v*-changes.md` rather than re-derived.
- Reproduction: `python3 audit_ur_m2.py`, `tsx validate-ur.ts`, `tsx negative-controls.ts` (this scratchpad), plus
  `node scripts/i18n/generate.ts --check`, `node scripts/i18n/check-strings.ts`, and the two `vitest` files, all run in the
  worktree at `3af477ee`.

## 12. Companions (scratchpad; the manager should move these into the tracked bundle)

| file | sha256 | what it is |
|---|---|---|
| `audit.log` | `0e84b1496b5554f27e0b1e887a5f4d76541b4ef470d13864b62f2a592e2ee830` | execution log — the real command runs (exit codes as printed) |
| `audit_ur_m2.py` | `c8a44c615f1c9ad337edf558825ef0a8e00c6d3e4d969a2db565c14c7cd85383` | mechanical pass (keys, hashes, placeholders, script, digits, punctuation, widths, controls) |
| `validate-ur.ts` | `5c317fbe7161038e4a19566c803dd64377623974f724a9414f366efbb598d4a6` | repo parser (`parseMessage`/`formatMessage`) over the 33 shipped values |
| `negative-controls.ts` | `c38ce8a7a065ae7422c237f80e16f50427899747c3c5f5d9e281d3b1b07c6f88` | mutation controls proving the checker bites |
| `shipped.json` | `50e790a396c4be898008c6affb1786979296d72198f7b94a1593ff36feb6ffb3` | snapshot of the 33 shipped ur pairs this audit read |
| `en.json` | `2a195aaa8691aa34d64fae79d6912aa238c41148f62e15f61d24a1bb41a09e12` | snapshot of the 33 English source pairs it read |

Hashes of *this report* and of `record.json` are carried inside `record.json` (a file cannot carry its own). `record.json`
holds the input hashes (en, context sidecars, target, bundle), the two aggregate hashes, the auditor identity, the verdict
and the finding ids. `audit.log` is real command output; the prose above is audit notes, not an execution log.

Nothing here is in the repo: the brief is read-only, so the ledger row in §10 and the tracked copy of these companions are
the manager's to write. The expected tracked location is
`i18n/audits/evidence/ur/m2-expression-literals/ur-m2-r3-shipped/` (`record.json` + `audit.log` + this report).
