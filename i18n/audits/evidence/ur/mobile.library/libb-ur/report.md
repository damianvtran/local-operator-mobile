# libb-ur - mobile.library (Urdu) - independent audit

Verdict: **changes_requested** — 3 MAJOR, 1 MINOR, 0 BLOCKER. 29/29 keys audited. Every value was rendered
through the repo's own `parseMessage` + `formatMessage` (`src/i18n/messages.ts`) at the arguments its call site
passes — `{limit}` = 12 for `editor.tag_limit`, `{count}` for `browse.filters_count`, none elsewhere — and read as
rendered. Raw output: `audit.log`.

Not the translator of this text. Route: ordinary reads of files in the session worktree. `read_public_copy` is
refused for `src/i18n/**` and was not used; the context sidecar is not routable (nested `{role,note}` objects, not
message strings); no copy-route receipt was obtained or is claimed.

## Mechanical (executed — see `audit.log`)
- `node scripts/i18n/generate.ts --check` -> exit 0, "catalogue.gen.ts is current (178 keys, 12 namespaces, ...)".
  Run only with `--check`: nothing generated, and this auditor wrote no catalogue or source byte.
- 29 keys = the English key set exactly; valid JSON; NFC-stable; no leading/trailing whitespace.
- Placeholders: `{limit}` (`editor.tag_limit`) and `{count}` (`browse.filters_count`) are present byte-identically;
  no other value carries one; no value carries a plural/select arm — correct, because the sidecar fixes both
  numbers as counts of a labelled quantity.
- Full stops: the 5 values whose English is a sentence (`browse.no_tags`, `detail.missing_file`, `detail.no_source`,
  `detail.no_tags`, `editor.tag_limit`) end in Urdu `۔`; the 24 fragments gain none; no ASCII `.` anywhere; the
  question mark in `editor.discard_title` is `؟`.
- **Bidi/zero-width controls: 0** — scanned for U+200B-200F, U+202A-202E, U+2060, U+2066-2069, U+061C, U+FEFF and
  any `Cf`/`Cc` code point. Also 0 Arabic-form yeh/kaf (U+064A/U+0643) where Urdu yeh/kaf (U+06CC/U+06A9) belongs.

## (a) Composed sentences, read against what the call site renders around them

- `detail.seen_in` is a heading above the conversation list (library-detail.tsx:346-352), or above the
  `detail.no_source` line — **libb-ur-2**.
- `browse.no_tags` renders inside the tag filter under the `browse.tag` label, in place of the chips; its second
  sentence mixes a masculine participle with a feminine main verb — **libb-ur-3**.
- `detail.no_tags` renders under the tag chips: «تفصیلات میں ترمیم کریں» is byte-identical to the `editor.title`
  sheet title and consistent with `action.edit` «ترمیم کریں» — the sidecar requirement holds.
- `editor.tag_limit` renders as a status line under the chips when 12 are assigned: a full sentence, `۔` kept,
  `{limit}` not hard-coded.
- `browse.filters_count` is the chip label beside the plain `browse.filters` chip: same word, middle dot kept, count
  appended. Fine.

## (b) The two counted messages at 0, 1, 2 and 21

| message | 0 | 1 | 2 | 21 | grammatical? |
|---|---|---|---|---|---|
| `editor.tag_limit` | ...حد 0 ہے۔ | ...حد 1 ہے۔ | ...حد 2 ہے۔ | ...حد 21 ہے۔ | yes at every value |
| `browse.filters_count` | فلٹرز · 0 | فلٹرز · 1 | فلٹرز · 2 | فلٹرز · 21 | yes at every value |

Both stay grammatical at all four numbers because the number is a *labelled quantity* — a ceiling, a count — not a
noun-agreeing quantity: `حد … ہے` stays singular and `ٹیگز` stays plural whatever the value. Neither message has ICU
arms, so Urdu's `0 -> other` rule cannot be applied wrongly here; there is no arm to choose. Only `{limit}` = 12 ever
renders at the call site (`MAX_ASSET_TAGS = 12`, library-detail.tsx:97,884) and only `{count}` > 0
(`filterCount > 0`, library-screen.tsx:289).

## (c) Placeholders and full stops

Held: `{limit}` and `{count}` byte-identical to the source; the Urdu full stop `۔` on the 5 sentence values and
on none of the 24 fragments; no ASCII `.` where the locale has its own mark; the question mark in
`editor.discard_title` is `؟`. Nothing to report here.

## (d) RTL and bidi

Zero bidi control characters (counted above): no RLM/LRM/FSI/PDI/ALM and no zero-width space or joiner. That is what
the style guide requires — the render layer wraps each string in FSI/PDI, so a control inside the value would be
applied twice. 'zero bidi control characters, checked and reported' is therefore true of both locales.

The only Latin run in this namespace is the product name `Librarian` inside `browse.no_tags`; policy keeps it Latin
and untransliterated (core ships the same), and it is a single space-bounded word, so no isolation is needed in the
copy. No paths, commands, arrows or version numbers in this group, so there is no bidi reordering hazard to
mitigate: the strings are logical-order Urdu with Latin digits only where a count renders.

Direction of the counted chip: `فلٹرز · 2` is stored label-then-count (as English is), and under `dir=rtl` the digits
resolve to the left of the label, so an RTL reader still meets the label first. That is the intended order, not a
mirroring defect; the middle dot stays a neutral separator.

## (e) Glossary against core's committed `ur` catalogue

| term | this group | core (key cited) | verdict |
|---|---|---|---|
| Library | لائبریری | relay.chrome.drawer.library | ok |
| asset | اثاثہ / اثاثے / اثاثے کے | wire.errors.desktop.library_asset_not_found; relay.library.count | ok |
| tag | ٹیگ / ٹیگز | tui.tags.* | ok |
| status | حالت | tui.schedule.detail_status | ok |
| sort | ترتیب دیں | no core sort verb — no conflict | ok |
| kind | قسم / اقسام | tui.authoring.action_class; tui.viewer.unsupported | ok (core also uses نوعیت in tui.authoring.kind) |
| Librarian | Librarian (Latin) | wire.settings.librarian.title | ok — kept Latin by policy |
| description | تفصیل | tui.authoring.description_clear_unsupported (موجودہ تفصیل) | ok |
| refresh | تازہ کریں | tui.review.hint_refresh | ok |
| discard | تبدیلیاں چھوڑیں؟ | tui.authoring.discard | ok — byte-identical |

Evidence for every 'core' cell: the bounded grep printed in `audit.log`.

## (f) Fit - cell widths

The en sidecar carries **no** `maxCells`/`maxChars` hint for this namespace (checked: 0 occurrences), so fit is
judged on measured width (`rich.cells.cell_len`; `tools/fit.py`, whose output is in `audit.log`) against the widget
that renders each string. Nothing overflows:

- No value is wider than English in a slot that cannot grow: `browse.filters` 5 cells (en 7), `browse.status` 4
  (en 6), `editor.description` 5 (en 11), `title` 8 (en 7) - chip and heading width.
- The three largest relative growths sit in short slots with room: `action.add_tag` 9 cells (en 3; button beside a
  text field), `browse.sort` 9 (en 4; chip), `detail.seen_in` 24 (en 7; heading above a list).
- The longest value, `detail.missing_file` at 93 cells (en 83), is body text inside a full-width warning `Alert`
  (library-detail.tsx:254-259) that wraps; `browse.no_tags` 68 (en 60) and `editor.tag_limit` 54 (en 40) are
  likewise wrapping text, not clipped rows.

No fit finding in this group.

## Findings

### libb-ur-1 - MAJOR - `mobile.library.editor.new_tag_placeholder`
- Current: `موضوع-کا-نام`
- Replacement: `topic-name`
- Rendered before: موضوع-کا-نام
- Rendered after: topic-name
- Why: Sidecar: the placeholder 'shows the form real tags take'. Core's server tag grammar is ^[a-z0-9][a-z0-9_-]{0,23}$ (local_operator/library/metadata.py:1289 `_normalise_tag_name`, applied by `create_tag`, which the phone's `create_tag_payload` calls). Proven on the real path in audit.log: a throwaway `MetadataStore.create_tag` REFUSES «موضوع-کا-نام» with TagRefused (the route maps it to 422 bad_tag_name and the editor shows 'That tag was not created.') and CREATES 'topic-name'. So the example teaches a form the product cannot save, inside the field beside «شامل کریں». The sidecar's 'a localised example is fine' rests on a premise the server contradicts. `mobile.library.editor.new_tag_placeholder` must be added to `IDENTICAL_BY_DESIGN.<locale>` in src/i18n/__tests__/catalogues.test.ts with a reason, because the 'no shipped value equals English' test (catalogues.test.ts:281-286) fails on a value identical to en. A different ASCII example (e.g. `weekly-notes`) needs no allowlist entry. Same defect in ru, vi and zh-CN (probed); not my bundles.
- Verified: tools/tagprobe.py: function-level gate + real MetadataStore.create_tag in a temp dir; tools/verify-repl.ts render — both in audit.log

### libb-ur-2 - MAJOR - `mobile.library.detail.seen_in`
- Current: `جن گفتگوؤں میں دیکھا گیا`
- Replacement: `ان گفتگوؤں میں دیکھا گیا`
- Rendered before: جن گفتگوؤں میں دیکھا گیا
- Rendered after: ان گفتگوؤں میں دیکھا گیا
- Why: Composed-sentence defect against the call site (library-detail.tsx:346-352: a heading completed by the list of conversation titles below it, or by the detail.no_source line). «جن … میں» is the relative half of an Urdu correlative pair and expects its «ان … میں» in a main clause that this heading does not have, so it dangles; the demonstrative «ان گفتگوؤں میں دیکھا گیا» ('seen in these conversations') is complete, points at the list, and matches shipped Hindi 'इन बातचीतों में दिखा'. Oblique plural گفتگوؤں and masculine دیکھا گیا (اثاثہ) unchanged.
- Verified: tools/verify-repl.ts render in audit.log; call site read at library-detail.tsx:346-352

### libb-ur-3 - MAJOR - `mobile.library.browse.no_tags`
- Current: `ابھی کوئی ٹیگ نہیں۔ Librarian اثاثے منظم کرتے ہوئے ٹیگ شامل کرتی ہے۔`
- Replacement: `ابھی کوئی ٹیگ نہیں۔ Librarian اثاثے منظم کرتے وقت ٹیگ شامل کرتی ہے۔`
- Rendered before: ابھی کوئی ٹیگ نہیں۔ Librarian اثاثے منظم کرتے ہوئے ٹیگ شامل کرتی ہے۔
- Rendered after: ابھی کوئی ٹیگ نہیں۔ Librarian اثاثے منظم کرتے وقت ٹیگ شامل کرتی ہے۔
- Why: One subject, two genders in one sentence. Core renders the Librarian as feminine ('Librarian عالمی Library منظم رکھتی ہے', wire.settings.librarian.description) and the main verb here is feminine (کرتی ہے), but the conjunctive participle کرتے ہوئے is the masculine(-plural) form; with a feminine subject standard Urdu wants کرتی ہوئی, which reads heavy in a status line. The gender-invariant 'کرتے وقت' ('while/at the time of') removes the clash without rewriting the sentence; meaning, the ۔ and the Latin name are untouched. Sentence 1 is byte-identical to core tui.tags.empty 'ابھی کوئی ٹیگ نہیں۔'
- Verified: tools/verify-repl.ts render in audit.log; core feminine rendering quoted from the bounded grep in audit.log

### libb-ur-4 - MINOR - `mobile.library.editor.tag_limit`
- Current: `ایک اثاثے کے لیے ٹیگز کی زیادہ سے زیادہ حد {limit} ہے۔`
- Replacement: `ایک اثاثے پر ٹیگز کی حد {limit} ہے۔`
- Rendered before: ایک اثاثے کے لیے ٹیگز کی زیادہ سے زیادہ حد 12 ہے۔
- Rendered after: ایک اثاثے پر ٹیگز کی حد 12 ہے۔
- Why: «زیادہ سے زیادہ حد» says 'maximum limit' — حد already is the ceiling — and «کے لیے» is looser than the پر core uses for the same rule (wire.errors.desktop.library_tag_limit: 'ایک اثاثے پر زیادہ سے زیادہ {max, number} ٹیگز ہو سکتے ہیں۔'). Honest caveat: core's relay.session.tags.limit_hint ships the same doubling in a different sentence, so this is entrenched elsewhere too; polish, not a violation. Grammatical at every {limit}.
- Verified: tools/verify-repl.ts render in audit.log

## Not findings (recorded so the next pass does not re-open them)
- `editor.discard_title` «تبدیلیاں چھوڑیں؟» is byte-identical to core's shipped confirmation; the destructive
  button is a separate string, so the title alone is safe.
- `browse.sort` «ترتیب دیں» shares a stem with `ترتیبات` (settings), but a sheet title plus the sidecar's "verb used
  as a title" make it unambiguous, and core has no competing sort verb.
- `browse.any_tag`, `browse.more_kinds`, `editor.new_tag`, `editor.tags`, `title`: no issue found.
- `detail.missing_file`: «منتقل ہو گئی ہے یا حذف کر دی گئی ہے» keeps both causes distinct, keeps them together, and
  implies no recovery — the sidecar's three constraints all hold.

## Checklist
- [x] every key rendered through the repo's own formatter at its call-site arguments before being judged
- [x] `generate.ts --check` (read-only) and the English key set compared
- [x] placeholders identical, full stops per locale, no key added or dropped, valid JSON
- [x] bidi / zero-width control characters counted and reported
- [x] glossary and term consistency against core's committed catalogue
- [x] composed-sentence reading against the call sites, not the strings alone
- [x] counted messages at 0, 1, 2 and 21

## Provenance
- agent `i18n-auditor`, session `31e9e2398db8`; **current ACTUAL model `radient/auto`** — a provider-quota
  fallback. Chain recorded from this session's model-switch notices: anthropic/claude-sonnet-5-5 -> anthropic/claude-opus-5-5 -> openai/gpt-6-astra -> kimi/k3.1-pro -> radient/auto.
  The readings were taken under the first of those; the bundle was assembled and re-verified after the last.
  `independent_from_translator_session: true` — this auditor translated none of these values.
- Inputs and their sha256 are in `record.json` and printed by `audit.log`:
  `src/i18n/catalogues/ur/mobile.library.json` `22e5cf3611f379dc53ff724228bf8b2ad6e68f218d3138e82fcc9617a91298ce`,
  `src/i18n/catalogues/en/mobile.library.json` `eae4550326593bb4da0773ccd5970583acbc7dd846dd3bd47af0c2030b756ad3`,
  `src/i18n/catalogues/en/mobile.library.context.json` `1c459b0eaa68e314edd5935619480b8f28a5b31d4d52cd9286d7a746e2a31d6c`.
- Worktree `4fd4ad7c` plus the translator's uncommitted catalogue; read-only for this auditor — no catalogue or
  source byte changed, no commit, `generate.ts` only with `--check`.
- `audit.log` is the real stdout/stderr of `tools/run.sh ur`; the prose here is judgement, not command
  output.
- Redaction scan of the bundle: 0 credential-shaped matches; the log carries real absolute scratch paths,
  not normalised — no secret material in them.
