# Hindi (`hi`) audit — `mobile.schedules` (group B, round 1)

`hi30s1` · audit date 2026-10-30 · 38 keys · verdict **changes_requested**

## Scope and provenance

Independent audit of the Hindi catalogue against the English source and its context sidecar. The auditor did not translate these files and did not edit them: no catalogue byte was changed and nothing was committed or pushed.

- Audited revision: `647581a4abd5eafce09914b5b1936982749c16c4` (`feat/i18n-hindi`), worktree `/Users/damian/workspace/hi-wave`.
- The Hindi catalogue is an UNTRACKED working-tree directory at that HEAD; the audited bytes are identified by the sha256 values below, not by a commit.
- Auditor: `i18n-auditor` (lopdev team), session `a98ed4a82f18`, independent of the translator by agent and session (the translator's identity and model were not visible here).
- Actual model: `radient/auto`, after provider quota moved this session off `anthropic/claude-sonnet-5-5` via `openai/gpt-6-astra` and `kimi/k3.1-pro`; every command in `audit.log` ran under the final model. Fallback is disclosed, not hidden.
- Inputs: `src/i18n/catalogues/en/mobile.schedules.json` `0459a0485ceb2594c60a152a8dbdc5035689ade05ac370134f8e37be6abc575f`; `src/i18n/catalogues/en/mobile.schedules.context.json` `d3f0d3bba057aacf4d3495b3d5eec2471d66b6d6c011b50834a1f58a0839aa92`; `src/i18n/catalogues/hi/mobile.schedules.json` `88ac1b6ab0849e1270711d185172fb459a7198ac0521818b5922e0e37d291163`.

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
| `cadence.every` | हर 1d | accept — matches the glossary's 'हर {duration}' row |
| `cadence.left` | हर 1d · 3 शेष | accept — count word शेष is invariant, so 1 and 3 both read correctly |
| `cadence.once` | एक बार | accept — glossary's 'एक बार' |
| `cadence.spent` | हर 1d · अब कोई डिलीवरी शेष नहीं | accept — keeps the source's choice not to say '0 left' |
| `count.monitors` | 2 मॉनिटर | accept — मॉनिटर does not inflect in the direct plural, so 0/1/2/21 all read correctly |
| `count.wakes` | 2 जागृतियाँ | HI-B-5 — zero renders the singular जागृति; decision recorded |
| `due.ahead` | 4m में | accept — postpositional 'in X' is the native order |
| `due.overdue` | 4m विलंबित | accept — विलंबित is the standard word for an overdue instant; the sidecar's ban is on 'late'/'missed', which this is not |
| `empty.body` | चैट में किसी एजेंट से कोई काम नियमित रूप से करने को कहें, तो वह यहाँ दिखेगा। जागृति तय समय पर बातचीत में एक प्रॉम्प्ट भेजती है; मॉनिटर एक चीज़ पर नज़र रखता है और बताता है कि क्या बदला। | accept — both sentences preserved; जागृति fem. / मॉनिटर masc. agreement correct |
| `empty.title` | कुछ भी सक्रिय नहीं | accept — short heading, no final stop |
| `empty_line.monitors` | कोई मॉनिटर सक्रिय नहीं। | HI-B-2 — सक्रिय here vs चालू in the counter |
| `empty_line.wakes` | कोई जागृति शेड्यूल नहीं की गई। | HI-B-3 — शेड्यूल here vs निर्धारित in the counter |
| `gone.monitors` | अब मौजूद नहीं — इसकी बातचीत इस मशीन पर नहीं रही, इसलिए इसकी जाँच नहीं होती | HI-B-7 — double इसकी with two referents; stiff nominalisation |
| `gone.wakes` | अब मौजूद नहीं — इसकी बातचीत इस मशीन पर नहीं रही, इसलिए कोई जागृति नहीं जागेगी | accept — कोई जागृति नहीं जागेगी follows the guide's endorsed जाग- verb form |
| `head.next` | 3 जागृतियाँ · अगली बार 4m | accept — 'अगली बार' carries 'next' against a relative label |
| `head.overdue` | 3 जागृतियाँ · 4m | accept — matches English structurally, which is intended: no forward word |
| `parked.monitors` | रुका हुआ — बातचीत दोबारा चलने पर इसके मॉनिटर फिर शुरू होते हैं | HI-B-6 — sibling of parked.wakes; resume verb differs |
| `parked.wakes` | रुका हुआ — अगले टर्न के बाद इसकी जागृतियाँ फिर चालू हो जाती हैं | HI-B-6 — resume verb differs from parked.monitors |
| `read_error.monitors` | इस मशीन के मॉनिटर पढ़े नहीं जा सके। | accept — names the family; never reads as an empty list |
| `read_error.wakes` | इस मशीन की जागृतियाँ पढ़ी नहीं जा सकीं। | accept — feminine agreement correct (पढ़ी … सकीं) |
| `read_unreachable` | हम अभी इस मशीन के शेड्यूल नहीं पढ़ सके। | accept — the app's 'we' voice, consistent with हम in this key |
| `show_less.monitors` | कम मॉनिटर दिखाएँ | accept — compact collapse label |
| `show_less.wakes` | कम जागृतियाँ दिखाएँ | accept — compact collapse label |
| `show_more.monitors` | 2 और मॉनिटर दिखाएँ | accept — both arms identical because मॉनिटर is invariant |
| `show_more.wakes` | 2 और जागृतियाँ दिखाएँ | accept — singular/plural arms correct; zero cannot render (hidden > 0 gate) |
| `state.disabled` | बंद | accept — one word, no stop |
| `state.dormant` | निष्क्रिय | accept — pairs with सक्रिय/निष्क्रिय |
| `state.expired` | समाप्त | accept — one word |
| `state.stale` | पुराना | accept — same word as the project badge's पुरानी |
| `state.waiting` | प्रतीक्षारत | accept — one word; 9 cells, fits the due slot |
| `summary.monitors_armed` | 2 चालू | HI-B-2 — चालू vs सक्रिय |
| `summary.monitors_attention` | 3 में से 1 को ध्यान चाहिए | accept — argument order flipped to Hindi idiom; reads correctly after 'Monitors' |
| `summary.wakes` | 2 निर्धारित | HI-B-3 — निर्धारित vs शेड्यूल |
| `supervisor.not_running` | जागृतियों का सुपरवाइज़र इंस्टॉल तो है पर चल नहीं रहा, इसलिए नीचे दी जागृतियाँ नहीं जागेंगी। | HI-B-4 — missing perfect participle गई |
| `supervisor.unsupported` | इस प्लैटफ़ॉर्म पर जागृतियों की निगरानी अभी नहीं होती, इसलिए नीचे दी जागृतियाँ केवल तब जागेंगी जब उनकी बातचीत चल रही हो। | HI-B-4 — missing perfect participle गई |
| `supervisor.unverifiable` | इन जागृतियों पर कोई निगरानी नहीं — ये केवल तब जागेंगी जब इनकी बातचीत चल रही हो। | accept — does not claim the probe looked at a supervisor, as the sidecar requires |
| `tail.failed` | 2 विफल | accept — count + one word |
| `truncated` | जागृतियाँ वाली कुल 3 बातचीत में से 2 दिखा रहे हैं। | HI-B-1 — non-oblique family noun and a singular counted noun under a numeral |

## Findings

### HI-B-1 — MAJOR

- Key: `mobile.schedules.truncated`
- Current: {family, select, wakes {जागृतियाँ} other {मॉनिटर}} वाली कुल {total} बातचीत में से {shown} दिखा रहे हैं।
- Problem: Two case/number errors. The family arm is the direct plural, but the frame puts it before वाली, which takes the oblique (जागृतियों / मॉनिटरों; compare किताबों वाली अलमारी). The counted noun is singular where a numeral of two or more needs the plural, and में से needs the oblique plural: the shipped sentence renders कुल 42 बातचीत में से 10, not कुल 42 बातचीतों में से 10. The sidecar says the family select exists so the noun can take the form the sentence needs; it did not.
- Replacement: {family, select, wakes {जागृतियों} other {मॉनिटरों}} वाली कुल {total, plural, one {# बातचीत} other {# बातचीतों}} में से {shown} दिखा रहे हैं।
- Evidence: Rendered at four counts through the app's own parser: shipped 'जागृतियाँ वाली कुल 2 बातचीत में से 1 दिखा रहे हैं।' / '… कुल 42 बातचीत में से 10 …'; replacement 'जागृतियों वाली कुल 2 बातचीतों में से 1 दिखा रहे हैं।' / '… कुल 42 बातचीतों में से 10 …' / 'मॉनिटरों वाली कुल 9 बातचीतों में से 5 दिखा रहे हैं।'. node scripts/i18n/generate.ts --check exits 0 on the replacement (raising {total} to a plural is the escalation the generator's own comment permits for an inflecting noun). The remediation round must treat that kind escalation as reviewed, not as the auditor's strict kind comparison failing.

### HI-B-2 — MINOR

- Key: `mobile.schedules.summary.monitors_armed`
- Current: {count} चालू
- Problem: One English word, two Hindi renderings on one surface: the counter says चालू while empty.title and empty_line.monitors say सक्रिय. चालू also carries the 'running' sense that supervisor.not_running uses for the supervisor being down, so 'Monitors · 2 चालू' beside a sentence about चल नहीं रहा can read as the same claim. Two of the three occurrences already use सक्रिय.
- Replacement: {count} सक्रिय
- Evidence: Rendered 'Monitors · 2 सक्रिय' and 'Monitors · 22 सक्रिय'; no placeholder or structure touched.

### HI-B-3 — MINOR

- Key: `mobile.schedules.empty_line.wakes`
- Current: कोई जागृति शेड्यूल नहीं की गई।
- Problem: The same English word 'scheduled' appears as शेड्यूल here and निर्धारित in summary.wakes, and both are visible on one screen when the wakes family is empty. A counter cannot take the शेड्यूल noun, so the empty line is the one to align.
- Replacement: कोई जागृति निर्धारित नहीं।
- Evidence: Rendered value checked; no placeholder; the sentence keeps its full stop and its 'no wake' polarity.

### HI-B-4 — MINOR

- Key: `mobile.schedules.supervisor.not_running + supervisor.unsupported`
- Current: …इसलिए नीचे दी जागृतियाँ नहीं जागेंगी। / …इसलिए नीचे दी जागृतियाँ केवल तब जागेंगी जब उनकी बातचीत चल रही हो।
- Problem: नीचे दी जागृतियाँ drops the perfect participle; standard Hindi is नीचे दी गई जागृतियाँ. Core's committed Hindi uses the same elliptical नीचे दी उम्र in wire.settings, so this is a programme habit rather than a wave invention; the fix is local and correct here, and core can follow.
- Replacement: …इसलिए नीचे दी गई जागृतियाँ नहीं जागेंगी। / …इसलिए नीचे दी गई जागृतियाँ केवल तब जागेंगी जब उनकी बातचीत चल रही हो।
- Evidence: No placeholder or structure touched; the supervisor precedence the sidecar demands is unchanged.

### HI-B-5 — MINOR

- Key: `mobile.schedules.count.wakes`
- Current: {count, plural, one {# जागृति} other {# जागृतियाँ}}
- Problem: At count 0 the CLDR hi rule selects one (Intl.PluralRules('hi').select(0) === 'one'), so this renders '0 जागृति' — a singular noun after zero, where '2 जागृतियाँ' is plural. The hi style guide records singular for zero ('one covers 0 and 1: "0 फ़ाइल" is singular'), core's committed Hindi ships the identical arms, and the second independent pass reads the singular as correct native Hindi, so this audit does NOT raise it to MAJOR even though a brief that classes a singular zero as major would. It is recorded as an open decision: if the programme prefers the plural reading, the verified replacement below needs no runtime change. Reachability: the count is entry.schedules.length (schedules-copy.ts:377) and the schema allows an empty array; show_more.* cannot render at zero (the control is gated on hidden > 0, schedules.tsx:385/456), and count.monitors / projects.sessions.count are unaffected because those nouns do not inflect in the direct plural.
- Replacement: {count, plural, =0 {# जागृतियाँ} one {# जागृति} other {# जागृतियाँ}}
- Evidence: Shipped renders 0 जागृति / 1 जागृति / 2 जागृतियाँ / 21 जागृतियाँ; the replacement renders 0 जागृतियाँ / 1 जागृति / 2 जागृतियाँ / 21 जागृतियाँ and node scripts/i18n/generate.ts --check exits 0 on it, so an explicit =0 arm is available without a code change.

### HI-B-6 — NIT

- Key: `mobile.schedules.parked.wakes + parked.monitors`
- Current: …इसकी जागृतियाँ फिर चालू हो जाती हैं / …इसके मॉनिटर फिर शुरू होते हैं
- Problem: The sibling sentences render 'resume' with two different verbs. Both are correct; the pair is read in one list, so one verb would be tidier.
- Replacement: …इसकी जागृतियाँ फिर शुरू हो जाती हैं / …इसके मॉनिटर फिर शुरू होते हैं
- Evidence: Feminine/masculine agreement preserved in both.

### HI-B-7 — NIT

- Key: `mobile.schedules.gone.monitors`
- Current: अब मौजूद नहीं — इसकी बातचीत इस मशीन पर नहीं रही, इसलिए इसकी जाँच नहीं होती
- Problem: इसकी appears twice with two different referents (the conversation, then the monitor), and the nominalised जाँच नहीं होती is stiffer than the sibling gone.wakes. Meaning is preserved, which is why this is a nit rather than a finding.
- Replacement: अब मौजूद नहीं — इसकी बातचीत इस मशीन पर नहीं रही, इसलिए इसे कोई जाँचता नहीं
- Evidence: Same claim (nothing checks it); no placeholder.

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

**changes_requested** — 0 BLOCKER, 1 MAJOR (HI-B-1). The group passes mechanically; the truncated strip needs the oblique family noun and a plural counted noun, and the two term-drift minors are one-line fixes.

`passed` is claimed only where no BLOCKER or MAJOR is unresolved; open MINOR/NIT items are listed above and do not change the status.

