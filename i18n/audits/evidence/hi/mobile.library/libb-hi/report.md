# libb-hi - mobile.library (Hindi) - independent audit

Verdict: **changes_requested** — 3 MAJOR, 2 MINOR, 1 NIT, 0 BLOCKER. 29/29 keys audited. Every value was rendered
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
- Placeholders: `{limit}` and `{count}` present byte-identically; no other value carries one; no plural/select arm
  (correct — both are counts of a labelled quantity).
- Full stops: the 5 sentence values end in `।`; the 24 fragments gain none; no ASCII `.` anywhere; the question
  mark in `editor.discard_title` is `?` as in the source.
- **Bidi/zero-width controls: 0** — no `Cf`/`Cc` code point (scanned U+200B-200F, U+202A-202E, U+2060, U+2066-2069,
  U+061C, U+FEFF). ZWJ/ZWNJ: 0. Nukta spelling kept consistently (फ़िल्टर, फ़ाइल); 0 non-nukta `फिल्टर`.

## (a) Composed sentences, read against what the call site renders around them

- `detail.seen_in` «इन बातचीतों में दिखा» above the list: complete (oblique plural बातचीतों, masculine दिखा for
  संसाधन) and correct.
- `detail.no_tags` renders under the tag chips; «विवरण संपादित करें» is the same action the sheet title and the
  Edit button «संपादित करें» name — the sidecar requirement holds.
- `browse.no_tags` (the tag filter's empty line) is a two-sentence status about the Librarian, with no field label
  in it; its masculine लाइब्रेरियन … जोड़ता है matches core and its own participle. Correct.
- `editor.tag_limit` renders as a status line under the chips when 12 are assigned: full sentence, danda kept.
- `browse.filters_count` is the chip label beside the plain `browse.filters` chip: same word, middle dot, count.

## (b) The two counted messages at 0, 1, 2 and 21

| message | 0 | 1 | 2 | 21 | grammatical? |
|---|---|---|---|---|---|
| `editor.tag_limit` | ...सीमा 0 है। | ...सीमा 1 है। | ...सीमा 2 है। | ...सीमा 21 है। | yes at every value |
| `browse.filters_count` | फ़िल्टर · 0 | फ़िल्टर · 1 | फ़िल्टर · 2 | फ़िल्टर · 21 | yes at every value |

Cells abbreviate the repeated sentence; the full render at each value is printed in `audit.log`.

Both stay grammatical at 0, 1, 2 and 21 because the number labels a quantity (`सीमा` = limit, a count), so there is
no numeral-driven oblique or plural to get wrong: `संसाधन` after `पर` is already the (unchanged) oblique, `टैग` is
invariant, and `सीमा … है` stays singular. Neither message has ICU arms, so Hindi's `0 -> one` rule cannot be applied
wrongly here — there is no arm to choose. Only `{limit}` = 12 renders at the call site and only `{count}` > 0.

## (c) Placeholders and full stops

Held: `{limit}` and `{count}` byte-identical to the source; the danda `।` on the 5 sentence values and on none
of the 24 fragments; no ASCII `.`; the question mark in `editor.discard_title` is the same `?` as the source.
Nothing to report here.

## (d) Bidi controls

Zero, counted above — reported for completeness: Hindi is LTR, so no control characters are expected or present,
and none were added.

## (e) Glossary against core's committed `hi` catalogue

| term | this group | core (key cited) | verdict |
|---|---|---|---|
| Library | लाइब्रेरी | relay.chrome.drawer.library; wire.settings.librarian.description | ok |
| asset | संसाधन (oblique संसाधनों) | wire.errors.desktop.library_* | ok |
| tag | टैग | tui.tags.*; wire.errors.desktop.library_tag_* | ok |
| status | स्थिति | tui.schedule.detail_status | ok |
| sort | क्रमबद्ध करें | no core sort verb — no conflict | ok |
| kind | प्रकार | tui.authoring.kind; tui.viewer.unsupported | ok |
| Librarian | लाइब्रेरियन | wire.settings.librarian.title | ok |
| description | वर्णन | core hi: विवरण for a description field; वर्णन only for narration | MAJOR — libb-hi-1, libb-hi-2 |
| refresh | रीफ़्रेश | core split: ताज़ा / ताज़ा करें / रीफ़्रेश / रिफ़्रेश | MINOR — libb-hi-5 |
| discard | छोड़ दें? | core: बदलाव छोड़ें? (tui.authoring.discard) | MINOR — libb-hi-4 |

Evidence for every 'core' cell: the bounded grep printed in `audit.log`.

## (f) Fit - cell widths

No `maxCells`/`maxChars` hint exists in the en sidecar for this namespace (0 occurrences), so fit is judged on
measured width (`rich.cells.cell_len`; `tools/fit.py`, output in `audit.log`) against the widget. Hindi is shorter
than English on almost every key - `browse.search_label` 10 cells (en 18), `detail.missing_file` 59 (en 83),
`detail.no_source` 34 (en 50) - so no button, chip or row is at risk. The three wider-than-source items sit in
short slots: `browse.sort` 9 (en 4), `action.edit` 7 (en 4), `detail.seen_in` 12 (en 7). No fit finding.

## Findings

### libb-hi-1 - MAJOR - `mobile.library.editor.description`
- Current: `वर्णन`
- Replacement: `विवरण`
- Rendered before: वर्णन
- Rendered after: विवरण
- Why: Core's committed hi word for a record's description is विवरण (tui.authoring.description_clear_unsupported: 'मौजूदा विवरण'); core's only use of वर्णन is narration (wire.settings.display_narration.label: 'टर्न के दौरान वर्णन'). In this sheet that split is also visible on one screen: the title is 'विवरण संपादित करें' while the field beside नाम would read वर्णन. वर्णन ('narration/portrayal') is a literary label for a file's description field in a form; विवरण is the standard UI term and core's choice. Meaning is not lost by the current word — the defect is cross-surface term divergence, which the brief classes MAJOR.
- Verified: bounded grep over core hi catalogues in audit.log + tools/verify-repl.ts render

### libb-hi-2 - MAJOR - `mobile.library.detail.missing_file`
- Current: `यह फ़ाइल ले जाई गई है या हटा दी गई है। इसका नाम, टैग और वर्णन अब भी यहाँ हैं।`
- Replacement: `यह फ़ाइल ले जाई गई है या हटा दी गई है। इसका नाम, टैग और विवरण अब भी यहाँ हैं।`
- Rendered before: यह फ़ाइल ले जाई गई है या हटा दी गई है। इसका नाम, टैग और वर्णन अब भी यहाँ हैं।
- Rendered after: यह फ़ाइल ले जाई गई है या हटा दी गई है। इसका नाम, टैग और विवरण अब भी यहाँ हैं।
- Why: Same root as libb-hi-1: the sentence names the fields the editor labels, so वर्णन must follow the field label विवरण. One word changes; both sentences and both dandas (।) are otherwise correct, and the warning stays a warning (it implies no recovery).
- Verified: tools/verify-repl.ts render in audit.log

### libb-hi-3 - MAJOR - `mobile.library.editor.new_tag_placeholder`
- Current: `विषय-नाम`
- Replacement: `topic-name`
- Rendered before: विषय-नाम
- Rendered after: topic-name
- Why: Same defect as libb-ur-1: core's server tag grammar ^[a-z0-9][a-z0-9_-]{0,23}$ refuses Devanagari tag names (probe in audit.log: «विषय-नाम» TagRefused, 'topic-name' created), so the example teaches a tag the field cannot save. `mobile.library.editor.new_tag_placeholder` must be added to `IDENTICAL_BY_DESIGN.<locale>` in src/i18n/__tests__/catalogues.test.ts with a reason, because the 'no shipped value equals English' test (catalogues.test.ts:281-286) fails on a value identical to en. A different ASCII example (e.g. `weekly-notes`) needs no allowlist entry. Same defect in ru, vi and zh-CN (probed); not my bundles.
- Verified: tools/tagprobe.py (function gate + real MetadataStore.create_tag) + tools/verify-repl.ts render

### libb-hi-4 - MINOR - `mobile.library.editor.discard_title`
- Current: `बदलाव छोड़ दें?`
- Replacement: `बदलाव छोड़ें?`
- Rendered before: बदलाव छोड़ दें?
- Rendered after: बदलाव छोड़ें?
- Why: Core ships this confirmation as «बदलाव छोड़ें?» (tui.authoring.discard, tui.team_authoring.discard). छोड़ दें? is grammatical and polite but adds a 'go ahead and' softener to a destructive title; aligning costs one word and keeps the confirm-dialog wording identical across desktop and phone. Not unsafe — the destructive button is a separate string.
- Verified: bounded grep over core hi catalogues in audit.log + render

### libb-hi-5 - MINOR - `mobile.library.browse.refresh`
- Current: `लाइब्रेरी रीफ़्रेश करें`
- Replacement: `लाइब्रेरी ताज़ा करें`
- Rendered before: लाइब्रेरी रीफ़्रेश करें
- Rendered after: लाइब्रेरी ताज़ा करें
- Why: Core hi ships three spellings of this verb — ताज़ा करें (tui.review.hint_refresh), रीफ़्रेश (relay.notifications.error.refresh), रिफ़्रेश (wire.errors.desktop.refresh_requires_live) — so the current value is not a glossary violation; it matches the relay family. Flagging the split for the programme to settle rather than a defect of this string: ताज़ा करें is the Hindi term core uses for a refresh control, रीफ़्रेश the loan the relay uses.
- Verified: bounded grep over core hi catalogues in audit.log

### libb-hi-6 - NIT - `mobile.library.browse.more_kinds`
- Current: `और प्रकार`
- Replacement: `अन्य प्रकार`
- Rendered before: और प्रकार
- Rendered after: अन्य प्रकार
- Why: Sheet title for the kinds that did not fit the segmented control. «और» can be read as the conjunction 'and' (and kinds); «अन्य» is unambiguously 'other/more'. Taste, either is understood.
- Verified: render in audit.log

## Not findings (recorded so the next pass does not re-open them)
- `detail.missing_file`'s first clause «ले जाई गई है या हटा दी गई है» keeps the two causes distinct and implies no
  recovery; only its second clause's वर्णन is wrong (libb-hi-2).
- `browse.any_tag`, `browse.more_kinds` (beyond the NIT), `editor.new_tag`, `editor.tags`, `title`, `browse.status`:
  no issue found.
- `detail.seen_in` «इन बातचीतों में दिखा» is correct — recorded because its Urdu sibling is not.

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
  `src/i18n/catalogues/hi/mobile.library.json` `50bd54a80febd6ca63e6ceaae9ea1bc6404d83b35e87cfec5e0aeb7607a34a20`,
  `src/i18n/catalogues/en/mobile.library.json` `eae4550326593bb4da0773ccd5970583acbc7dd846dd3bd47af0c2030b756ad3`,
  `src/i18n/catalogues/en/mobile.library.context.json` `1c459b0eaa68e314edd5935619480b8f28a5b31d4d52cd9286d7a746e2a31d6c`.
- Worktree `4fd4ad7c` plus the translator's uncommitted catalogue; read-only for this auditor — no catalogue or
  source byte changed, no commit, `generate.ts` only with `--check`.
- `audit.log` is the real stdout/stderr of `tools/run.sh hi`; the prose here is judgement, not command
  output.
- Redaction scan of the bundle: 0 credential-shaped matches; the log carries real absolute scratch paths,
  not normalised — no secret material in them.
