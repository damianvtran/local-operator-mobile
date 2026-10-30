# Hindi (`hi`) audit — `mobile.notifications` (group B, round 1)

`hi30n1` · audit date 2026-10-30 · 14 keys · verdict **passed**

## Scope and provenance

Independent audit of the Hindi catalogue against the English source and its context sidecar. The auditor did not translate these files and did not edit them: no catalogue byte was changed and nothing was committed or pushed.

- Audited revision: `647581a4abd5eafce09914b5b1936982749c16c4` (`feat/i18n-hindi`), worktree `/Users/damian/workspace/hi-wave`.
- The Hindi catalogue is an UNTRACKED working-tree directory at that HEAD; the audited bytes are identified by the sha256 values below, not by a commit.
- Auditor: `i18n-auditor` (lopdev team), session `a98ed4a82f18`, independent of the translator by agent and session (the translator's identity and model were not visible here).
- Actual model: `radient/auto`, after provider quota moved this session off `anthropic/claude-sonnet-5-5` via `openai/gpt-6-astra` and `kimi/k3.1-pro`; every command in `audit.log` ran under the final model. Fallback is disclosed, not hidden.
- Inputs: `src/i18n/catalogues/en/mobile.notifications.json` `c6e58c6129727513a00b0c67abdfc6cd5284d326792f00886767a26a60778064`; `src/i18n/catalogues/en/mobile.notifications.context.json` `240ec6befb692d72ac51a346fbc70a6f79e5853ae03f62ce25654d81db7f21e6`; `src/i18n/catalogues/hi/mobile.notifications.json` `5ae9fea0068c1a150d39be50fb293c48f74989cd410ef4b42de1e9a13085d252`.

## What was executed

`audit.log` is the real `bash -x` transcript of every command behind this report (validator, gates, the auditor's verifier, five negative controls, glossary counts, typography/width metrics, the render matrix and the candidate-replacement probes); `renders.tsv` is the app-rendered matrix through the composition functions and `renders-all.tsv` is every group-B key rendered through `renderFor`; `verify.out.txt` is the verifier's positive and negative output. Notes in this file never stand in for execution.

Rendering path: a scratch copy of the worktree (session scratchpad) whose ONLY source edit is moving `hi` into `SHIPPED_LOCALES`, so `t()`/`renderFor()` resolve the real Hindi catalogue. Its four Hindi files were proved byte-identical to the audited worktree by sha256 before and after every probe.

## Mechanical results

| Check | Result |
|---|---|
| Repo validator (what CI runs) | `node scripts/i18n/generate.ts --check` -> exit 0, 'src/i18n/catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr, hi, ru, vi, zh-CN)' inside the scratch copy that ships hi; in the audited worktree the same run reports the same counts without hi in the shipped list. |
| Repo gate | `node scripts/i18n/check-strings.ts` -> exit 0, 'check-strings: 284 finding(s), all baselined; 0 new; no growth vs 647581a4abd5'. |
| What the repo validator does NOT check | It compares placeholder NAMES with kind escalation allowed. It does not compare select/plural arm sets, does not check CLDR category reachability, and does not check punctuation, NFC or width — which is why the auditor's own checker and the term/typography passes exist. |
| Auditor's structural verifier | 77 keys, 0 problems: placeholder names and kinds identical as a multiset on every key; every plural/select node's arm set identical to English at every node (write_receipt: kind {milestone, other, project} plus three action selects of the same eight arms; truncated: family {wakes, other}); every plural carries both CLDR hi categories {one, other}; key order identical to en; all values NFC; no ZWSP/ZWNJ/ZWJ/LRM/RLM or bidi controls; no doubled spaces. |
| Legitimate placeholder reordering | Four keys reorder named placeholders for Hindi word order (summary.monitors_attention, truncated, milestones.count, write_receipt). Named arguments make order irrelevant to the renderer, and the multiset check proves nothing was dropped or retyped. |
| Negative controls (proving the checks can fail) | Five mutations, all caught: dropping {total} from milestones.count -> placeholder parity FAIL; deleting the plural one arm from count.wakes -> arm-set FAIL; renaming a write_receipt kind arm to ms -> arm-set FAIL; inserting U+200D in computers.add -> control-character FAIL; decomposing U+0928 U+093C (ऩ) in notifications.priority_high -> NFC FAIL. The NFC control cannot use the nukta letters Hindi actually uses because the nukta letters Hindi actually uses (U+0958–U+095F) are composition exclusions: a decomposed ज़ / फ़ / ड़ is already NFC, so no NFC check can discriminate those spellings, and this audit does not claim it can. |
| Encoding and orthography | All 77 values NFC; no bidi or zero-width control; no doubled spaces; tabs and key order identical to en; every nukta letter in the group is the decomposed base+U+093C form (24 occurrences, 0 precomposed) — one form throughout: नज़र, चीज़, फ़ील्ड, हाइफ़न, पढ़ी, जुड़े, पड़ाव. |
| Punctuation | Every sentence-final position that English stops with '.' carries danda ।; the two question forms end with '?' as the guide requires; the one semicolon matches the English ';'; no ASCII full stop anywhere except the literal '.' glyph being named in project_name_hint. Em dashes keep the English ' — ' spacing. |
| Technical tokens | `lop mobile` (computers.password_placeholder) and `Radient` (computers.section.not_connected) are byte-identical to the source; no backticks, Rich tags or escapes anywhere in group B. |
| Width | Every group-B string is at or below its English cell width except three one-to-four-cell cases (connecting +3/+1, waiting +2, once +2). Group-B sidecars carry no maxCells budget, so this is a relative check, not a rendered one; the longest values are write_receipt (666 cells, three arm copies) and empty.body (158 against 181 English). |
| Zero boundary | Intl.PluralRules('hi') selects one for 0 and 1, other for 2 and 21. count.wakes therefore renders '0 जागृति'; count.monitors, projects.sessions.count and milestones.count use nouns that do not inflect in the direct plural, so 0/1/2/21 read correctly there; show_more.* cannot render at zero because the control is gated on hidden > 0. |

## Every key in this namespace, as the app renders it

| Key | Rendered Hindi | Judgement |
|---|---|---|
| `answer` | उत्तर दें | accept — imperative, one word |
| `back` | वापस | accept — accessibility label |
| `detail.answer_in_conversation` | बातचीत में उत्तर दें | accept — sentence case, no stop |
| `detail.conversation_asks` | इस बातचीत के सवाल | accept — सवाल used consistently for the product's 'ask' |
| `detail.earlier_updates` | पिछले अपडेट | accept — अपडेट matches the receipt's अपडेट किया गया |
| `detail.from` | स्रोत | accept — one-word noun header |
| `detail.no_asks` | इस बातचीत में कोई सवाल नहीं। | accept — full stop, empty state |
| `detail.nothing_to_dismiss` | इस बातचीत से हटाने के लिए कोई अपडेट नहीं। | accept — हटाने here matches the dismiss button हटाएँ |
| `detail.projects` | प्रोजेक्ट | accept — glossary term |
| `dismiss` | हटाएँ | accept — the standard Hindi UI word for dismissing a notification |
| `filter_label` | दिखाएँ | accept — verb as a label, one word |
| `load_failed` | सूचनाएँ लोड नहीं हो सकीं | accept — feminine agreement; reads as an error title, not as an empty list |
| `priority_high` | उच्च | accept — one word |
| `title` | सूचनाएँ | accept — plural सूचनाएँ |

## Findings

None. No BLOCKER, MAJOR, MINOR or NIT was found in this namespace, and no wording change is requested.

## Glossary conformance against core's committed Hindi

| Term | Core | This group | Note |
|---|---|---|---|
| पड़ाव (milestone) | 14 in core | 6 in group B | same term, same spelling |
| प्रोजेक्ट (project) | 16 in core | 6 in group B | same term; परियोजना never used |
| सत्र (session) | 135 in core | 4 in group B | same term; सेशन never used |
| जागृति (wake) | 36 in core | 16 in group B | noun label and जाग- verb forms both as the guide records |
| मॉनिटर (monitor) | 7 in core | 10 in group B | stored-object noun; निगरानी kept for the activity |
| हर {duration} | 63 in core | 1 in group B | cadence.every matches the glossary cell |
| एक बार (once) | 13 in core | 1 in group B | matches |
| निगरानी (monitoring) | 15 in core | 2 in group B | activity sense only, as the guide's split requires |
| शेड्यूल (schedule) | 8 in core | 2 in group B | term correct; the 'scheduled' counter drift is HI-B-3 |

Every glossary term the brief names is used consistently and in the same form core's committed Hindi uses; the rejected alternatives never appear (परियोजना 0, सेशन 0). The one term-level drift found is inside this wave, not against core (HI-B-2, HI-B-3).

## Second independent pass

A second independent pass (job 5aa633351b8d, model radient/auto) read 21 high-visibility group-B strings — empty state, every error sentence, both destructive confirmations, the receipt, the zero-count line and the truncated strip. It independently found the same two defects in truncated (non-oblique family noun, singular counted noun) and the missing गई in नीचे दी जागृतियाँ; it agreed on the armed/scheduled term drift, कुछ नया and द्वारा दर्ज. It disagrees in two places, both recorded rather than smoothed over: it reads '0 जागृति' as correct Hindi (so HI-B-5 stays minor here) and it accepts gone.monitors (so HI-B-7 stays a nit); it would use the loan डिलीट किया गया for the destructive receipt and retitle the confirm to डिलीट करें?, where this audit keeps मिटाया गया and the shipped हटाएँ? — हटाना is the standard Hindi UI verb and matches the dialog the user just read.

## What this audit could not verify

- No screenshot or pixel measurement: the audit ran without an app build or simulator, so width is judged from cell counts (combining marks 0, wide glyphs 2) against English. Group-B sidecars carry no maxCells budget, so the check is relative.
- The zero-count reachability argument comes from reading schedules-copy.ts and the zod schema; no relay fixture with an empty schedules array was rendered.
- Hindi morphology judgements (the oblique plural before वाली and में से, the standalone द्वारा दर्ज fragment, singular after zero) are native-reader judgements corroborated by the second pass, not by a reference grammar consulted in this session.
- No translation API, SDK, MT service or back-translation was used anywhere in this audit or the second pass.
- The translator's identity and model were not visible to this auditor; independence is by agent and session, not by model diversity.
- The hardcoded English section headings ('Wakes' / 'Monitors') in schedules.tsx:213-214 and 279-280 are source-side literals, not catalogue copy: they are outside this audit's remit but leave a Hindi reader mixed-script lines such as 'Wakes · 3 निर्धारित'. The Hindi fragments themselves read correctly after an English word.

## Verdict

**passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR. All 14 keys read as native product Hindi.

`passed` is claimed only where no BLOCKER or MAJOR is unresolved; open MINOR/NIT items are listed above and do not change the status.

