# Hindi (`hi`) audit — `mobile.projects` (group B, round 1)

`hi30p1` · audit date 2026-10-30 · 15 keys · verdict **passed**

## Scope and provenance

Independent audit of the Hindi catalogue against the English source and its context sidecar. The auditor did not translate these files and did not edit them: no catalogue byte was changed and nothing was committed or pushed.

- Audited revision: `647581a4abd5eafce09914b5b1936982749c16c4` (`feat/i18n-hindi`), worktree `/Users/damian/workspace/hi-wave`.
- The Hindi catalogue is an UNTRACKED working-tree directory at that HEAD; the audited bytes are identified by the sha256 values below, not by a commit.
- Auditor: `i18n-auditor` (lopdev team), session `a98ed4a82f18`, independent of the translator by agent and session (the translator's identity and model were not visible here).
- Actual model: `radient/auto`, after provider quota moved this session off `anthropic/claude-sonnet-5-5` via `openai/gpt-6-astra` and `kimi/k3.1-pro`; every command in `audit.log` ran under the final model. Fallback is disclosed, not hidden.
- Inputs: `src/i18n/catalogues/en/mobile.projects.json` `a598ddc447a47476a54dc0510b156fd4d35d27bf15d79b44850a65a4bf6efc09`; `src/i18n/catalogues/en/mobile.projects.context.json` `5481687e7c4c089cf9ec39175630a5f3f5dd686c041561aceb671083933eed99`; `src/i18n/catalogues/hi/mobile.projects.json` `c2e2a90449d9295b1c8f8e15aa869d399ddb4d4e2cd93849c5e0447c8a53be55`.

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
| `delete_body` | Ram-laptop हटाएँ? प्रोजेक्ट की पंक्ति हमेशा के लिए चली जाएगी। उससे जुड़े सत्रों और उनकी ट्रांसक्रिप्ट को छुआ नहीं जाएगा। | accept — {name} survives, the row is named as what goes, and both halves of the promise are kept |
| `draft_kept_note` | पिछली बार से सुरक्षित रखा गया। नया कुछ शुरू करने के लिए फ़ील्ड खाली करें। | HI-B-8 — 'नया कुछ' word order |
| `milestone_slash_note` | पड़ाव के नाम में स्लैश नहीं हो सकता। स्लैश वाला पड़ाव कभी हटाया नहीं जा सकेगा। | accept — names the consequence, no route/path talk |
| `milestones.count` | 3 में से 1 पड़ाव | accept — पड़ाव is unmarked in the plural, so 0/1/3 read correctly; order flipped to Hindi idiom |
| `milestones.none` | कोई पड़ाव नहीं | accept — lower-case fragment, joins cleanly before a session count |
| `project_name_hint` | 1-64 वर्ण: अक्षर, अंक, बिंदु (.), अंडरस्कोर (_) या हाइफ़न (-)। स्पेस नहीं, और हाइफ़न से शुरुआत नहीं हो सकती। | accept — the added (.) (_) (-) glyphs are additive and make the grammar more exact; length and character set unchanged |
| `remove_milestone_body` | Ram-laptop को इस प्रोजेक्ट से हटाएँ? पड़ाव हमेशा के लिए चला जाएगा। प्रोजेक्ट के सत्रों और उसकी प्रगति पंक्ति को छुआ नहीं जाएगा। | accept — {name} survives; permanence and the untouched list both preserved |
| `session_state.filed_by` | दर्ज किया | HI-B-9 — finite verb as a metadata fragment |
| `session_state.missing` | गायब | accept — one word |
| `session_state.not_running` | नहीं चल रहा | accept — the ordinary end of a session, not an error word |
| `sessions.count` | 2 सत्र | accept — both arms identical because सत्र does not inflect in the direct plural |
| `sessions.live` | 3 सत्र · 1 सक्रिय | accept — composes as '4 सत्र · 1 सक्रिय' |
| `stale_badge` | प्रगति पुरानी | accept — names what is stale (progress), lower case |
| `write_receipt` | “beta” प्रोजेक्ट अपडेट किया गया। | HI-B-10 — also HI-B-11 (nested quotes) |
| `write_unknown_note` | आपके कंप्यूटर तक नहीं पहुँच सके, इसलिए यह नहीं बता सकते कि वह सहेजा गया या नहीं। दोबारा कोशिश करने से पहले प्रोजेक्ट जाँच लें। | accept — keeps the outcome unknown and never says nothing was saved |

## Findings

### HI-B-8 — MINOR

- Key: `mobile.projects.draft_kept_note`
- Current: पिछली बार से सुरक्षित रखा गया। नया कुछ शुरू करने के लिए फ़ील्ड खाली करें।
- Problem: नया कुछ is not Hindi word order; the indefinite is कुछ नया.
- Replacement: पिछली बार से सुरक्षित रखा गया। कुछ नया शुरू करने के लिए फ़ील्ड खाली करें।
- Evidence: No placeholder; the instruction and its purpose are unchanged.

### HI-B-9 — MINOR

- Key: `mobile.projects.session_state.filed_by`
- Current: दर्ज किया
- Problem: दर्ज किया is a finite transitive perfect ('[it] filed [it]'), so as a metadata fragment it reads as a truncated clause and never attaches the session as the filer — while the sidecar says the fragment marks the session as the one that filed the work. The component renders it AFTER the session name (project-detail.tsx:437-443), so the agent marker is what the sentence needs; दर्ज किया गया alone is not enough either, because it can be read as the session having been filed.
- Replacement: द्वारा दर्ज
- Evidence: Composes as '<session name> · द्वारा दर्ज' = 'filed by <session name>'. No placeholder; both words fit the existing meta slot (12 cells).

### HI-B-10 — NIT

- Key: `mobile.projects.write_receipt`
- Current: removed {हटाया गया} / deleted {हटाया गया}
- Problem: English separates Removed (a milestone detached, project-detail.tsx:254) from Deleted (a project deleted, project-detail.tsx:278); Hindi renders both हटाया गया. Comprehension survives because the kind noun differs (पड़ाव vs प्रोजेक्ट), so this is parity polish rather than a defect.
- Replacement: removed {हटाया गया} / deleted {मिटाया गया}
- Evidence: Rendered: '“beta” प्रोजेक्ट हटाया गया।' vs '“beta” प्रोजेक्ट मिटाया गया।'; generator --check exits 0. The second pass proposes the loan डिलीट किया गया instead; मिटाया गया keeps the guide's preference for the settled Hindi word and still distinguishes the destructive action.

### HI-B-11 — NIT

- Key: `mobile.projects.write_receipt`
- Current: “{subject}” प्रोजेक्ट …
- Problem: The added “ ” around {subject} does not break any arm or the sentence (checked at seven actions × three kinds), but a subject that itself contains double quotes nests them: '"अल्फा" योजना' renders as “"अल्फा" योजना”. Hindi convention for a quotation inside a quotation is single quotes, which the catalogue cannot substitute into user text.
- Replacement: leave as shipped, or wrap with ‘{subject}’ to keep one level
- Evidence: Rendered with a quoted subject through the app's formatter.

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

**passed** — 0 BLOCKER, 0 MAJOR. Two minors and two nits recorded for the next remediation commit; the destructive confirmations and the receipt are correct and safe.

`passed` is claimed only where no BLOCKER or MAJOR is unresolved; open MINOR/NIT items are listed above and do not change the status.

