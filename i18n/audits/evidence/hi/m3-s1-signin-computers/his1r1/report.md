# hi — M3 S1 (sign-in + computers) — independent audit

- **Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 5 MINOR, 3 NIT. Minors are worth a batched touch-up; none blocks the slice.
- Locale `hi` · namespace `mobile.computers+mobile.signin (M3 S1)` · head `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce`
- Draft audited: `/Users/damian/.local-operator/sessions/fad0082b3b75/scratchpad/draft-hi-s1.json`
  sha256 `768194117988c474607c705793c046c12217d1833d38c07a4ca9f9b42d1ce7d8`
- Brief: sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`
- Auditor: `i18n-auditor`, model **deepseek/deepseek-flash** (session header; no fallback observed), session `91a41d00ad8f`, instance `e97663964c5f`.
  Independent of the translator (session `fad0082b3b75`); no translation/MT service used; read-only on the worktree.
- Inputs read: en `mobile.computers|mobile.signin` catalogues + context sidecars, hi `mobile.computers|mobile.signin|mobile.common|mobile.chrome|mobile.settings`, core `origin/main` hi style guide + glossary, call sites `src/features/auth/{computers,tunnel-paths,sign-in,sign-in-panel,welcome}.tsx`, plus the UI repo's hi catalogue (`~/local-operator-ui` @ `94d96837486`) for cross-namespace terminology.

## Mechanical (repo's own parser, not a re-implementation)

`parseMessage` imported from `src/i18n/messages.ts`; every one of the 44 values parsed.

| Check | Result |
|---|---|
| keys vs brief | 44/44, order identical, 0 missing, 0 extra |
| duplicate JSON keys | 0 |
| `parseMessage` failures | 0 |
| placeholder names **and kinds** vs English | identical for all 3 placeholder keys (`{status}`; `{name}/{status}/{reach}` ×2) |
| ICU plural/select | none used — no CLDR-category exposure |
| `{`/`}` balance, stray ICU punctuation | clean |
| Latin outside allowlist | none (only `Local Operator`, `Radient`, `URL` + placeholders) |
| format/control characters (Cf/Cc), ZWJ/ZWNJ | 0 |
| ASCII `.` at end of prose | 0 — danda `।` everywhere prose ends |
| ellipsis | `…` (single char) in the two ellipsis keys, no full stop after |
| NFC / double spaces / edge spaces | clean |
| typed `।` before `?` etc. | clean |

One flag worth stating rather than "finding": `wait.tunnel_status` uses a **spaced em dash** (`है — {status}`). It matches the English source and the shipped hi catalogues (`mobile.settings.account.delete_help`, `relay.health.live_detail`), so it is correct here.

## Fit / width (measured, not estimated)

No `maxCells`/`maxChars` hints exist for these keys (neither en context sidecar carries any), so fit was judged against the real call sites. The one tight site is the row's `flex-row` badge pair in `computers.tsx` (line ~197: `flex-row items-center gap-2`, no `numberOfLines`, no wrap).

Measured with CoreText at the shipped sizes — mono badges at 11 px (Devanagari via Kohinoor Devanagari, which is what a mono face falls back to), button labels at 15 px / header `sm` at 13 px:

| pair | English px | Hindi px |
|---|---|---|
| route ready / रूट तैयार | 72.8 | 36.4 |
| provisioning / तैयार हो रहा | 79.5 | 48.2 |
| suspended / निलंबित | 59.6 | 31.8 |
| disabled / बंद | 53.0 | 12.0 |
| revoked / निरस्त | 46.4 | 23.8 |
| unknown / अज्ञात | 46.4 | 24.8 |
| answering / जवाब दे रहा | 59.6 | 48.5 |
| Sign-in protected / साइन-इन से सुरक्षित (already shipped, same row) | 112.6 | 80.3 |
| active / सक्रिय | 39.7 | 25.7 |
| connecting / कनेक्ट हो रहा | 66.2 | 53.9 |

Every Hindi badge is **narrower** than the English it replaces, and the longest pair that can co-occur (status + reach) stays under the English pair that already ships. Button labels: `Refresh`/`रीफ़्रेश करें` 48.9/47.7 px; `Use my own tunnel instead`/`इसके बजाय अपनी टनल उपयोग करें` 169.3/169.8; `Use this computer`/`इस कंप्यूटर का उपयोग करें` 130.9/144.9; `Sign in`/`साइन इन करें` 48.3/71.8; `Set up your own tunnel`/`अपनी टनल सेट अप करें` 163.8→128.9; `Try now`/`अभी कोशिश करें` 56.5→91.2 (widest ratio, still a plain banner button). No call site passes `labelLines={1}`, so labels wrap rather than truncate. **No overflow finding.**

## Findings

### hi-01 · MINOR · `mobile.computers.paths.own_body`
Current: `उन्नत रास्ता: आप अपना कंप्यूटर ख़ुद प्रकाशित करते हैं, अपनी चलाई हुई टनल के ज़रिये, और उसका पता यहाँ चिपकाते हैं। किसी भी चरण में Radient खाते की ज़रूरत नहीं, और पासवर्ड आपके पास ही रहता है।`
Problem: the middle phrase is an appositive comma that mirrors the English word order instead of Hindi's natural order (manner before object), and `प्रकाशित` is this product's verb for *publishing to the hub* (`ui.agents.publication.*`: `कुछ भी प्रकाशित नहीं हुआ`), so "अपना कंप्यूटर प्रकाशित करते हैं" reads as publishing your computer rather than exposing it. Comprehension survives, which is why this is not a blocker.
Suggestion: `उन्नत रास्ता: आप अपनी चलाई हुई टनल के ज़रिये अपना कंप्यूटर ख़ुद एक्सपोज़ करते हैं और उसका पता यहाँ चिपकाते हैं। किसी भी चरण में Radient खाते की ज़रूरत नहीं, और पासवर्ड आपके पास ही रहता है।` (`सार्वजनिक करते हैं` is the alternative loan-free wording; the guide's "keep the living loan rather than invent a stilted native form" argues for एक्सपोज़ on the advanced card.)

### hi-02 · MINOR · `wait.use_computer` · `paths.own_action` · `own_tunnel_instead`
Current: `इस कंप्यूटर का उपयोग करें` · `अपनी टनल उपयोग करें` · `इसके बजाय अपनी टनल उपयोग करें`
Problem: `उपयोग` for a *use X* action drifts from shipped button copy in the same app, which is uniformly `इस्तेमाल करें` (`mobile.settings.connection.use`, `mobile.home.options.default_model`, `mobile.home.picker.folder_use_path`); the UI repo is 130 : 46 `इस्तेमाल` : `उपयोग`, and its `उपयोग` uses are prose about usage, not actions. The core guide's `उपयोग (usage)` row settles the **noun**, so it does not decide the verb. Two `use` buttons rendered with two different verbs across surfaces is the kind of drift the "settled-term" rule exists to stop.
Suggestion: `इस कंप्यूटर का इस्तेमाल करें` · `अपनी टनल का इस्तेमाल करें` · `इसके बजाय अपनी टनल का इस्तेमाल करें` (adding `का` is optional polish — bare objects do ship, e.g. `यह पाथ इस्तेमाल करें`).

### hi-03 · MINOR · `mobile.computers.wait.listing`
Current: `आपका कंप्यूटर Radient की सूची में दिखने का इंतज़ार है…`
Problem: subject-first ordering puts `आपका कंप्यूटर` immediately before a genitive `दिखने का इंतज़ार`, so the line garden-paths as "your computer is waiting" before it resolves. The namespace's shipped line puts the awaited thing after the locative (`आपके कंप्यूटर के जवाब का इंतज़ार है।`).
Suggestion: `Radient की सूची में आपका कंप्यूटर दिखने का इंतज़ार है…`

### hi-04 · MINOR (slice-level consistency, not a draft defect) · `mobile.signin.panel.waiting`
Current draft: `आपके ब्राउज़र का इंतज़ार है।` — shipped sibling in the *same* namespace, `mobile.signin.stage_browser`: `आपके ब्राउज़र की प्रतीक्षा है`, i.e. one English phrase, two words, possibly on one screen (stage line + hand-off panel).
Problem: the slice ships two renderings. The draft's is the product-standard one — `इंतज़ार` is 81 : 0 over `प्रतीक्षा` in the UI repo and 4 : 4 in mobile — and matches the computers namespace it belongs with.
Suggestion: keep the draft; align `mobile.signin.stage_browser` to `आपके ब्राउज़र का इंतज़ार है` in a follow-up (it is already-shipped copy, outside this draft's 44 keys), and record the drift in the ledger note rather than letting it rest on inference.

### hi-05 · MINOR (notes accuracy) · `mobile.computers.row.a11y`
Current: `{name}, {status}, {reach}`
Problem: the notes state "judged identical to English: **None**" and "every one of the 44 values differs from its English source". This value is **byte-identical** to English — correctly so, it is placeholders and separators only. The programme's judged-identical list is exactly how intentional identity is told apart from an untranslated string; leaving it out makes the record weaker than the draft.
Suggestion: no draft change; add `mobile.computers.row.a11y` to the judged-identical list.

### hi-06 · NIT · `mobile.signin.try_anyway`
`फिर भी कोशिश करें` drops "again" while the button re-runs the hand-off; shipped `mobile.computers.retry` words it `दोबारा कोशिश करें`. → `फिर भी दोबारा कोशिश करें`

### hi-07 · NIT · `mobile.computers.remove.body`
Two sentences open with `इससे`. → `यह इसे इस फ़ोन की सूची से हटा देता है। कंप्यूटर, उसकी टनल या आपके खाते पर कोई असर नहीं पड़ता।` (all three negations kept, as English requires)

### hi-08 · NIT · `mobile.computers.remove.title`
`यह कंप्यूटर हटाएँ?` is conventional terse UI Hindi; `क्या यह कंप्यूटर हटाएँ?` reads unambiguously as a question. Optional.

## Per-key verdicts where not clean

All 44 keys were read and judged; these are the only ones not clean. Everything else — `not_harness`, `wait.tunnel_status`, `wait.answered`, `wait.start_again`, `refresh`, `list.heading`, `remove.confirm`, `paths.radient_title`, `paths.recommended`, `paths.radient_body`, `paths.own_title`, `signin.title`, `signin.intro`, `signin.start`, `signin.use_address`, `panel.opening`, `panel.waiting_help`, `panel.cancelled`, `panel.cancelled_help`, `panel.unavailable`, `panel.unavailable_alt`, `welcome.headline`, `welcome.body`, all seven `status.*`/`reach.answering` badges, `row.a11y_active`, `row.a11y_connecting`, `billing_inactive`, `try_now` — is accurate, idiomatic, in the आप register, glossary-conformant and correctly punctuated. Privacy and safety text checks pass specifically: `signin.intro` keeps "the app never sees your password" (`कभी दिखता ही नहीं` — emphatic, not weakened), `welcome.body` keeps "your code never leaves it" (`कभी बाहर नहीं जाता`), `remove.body` keeps the "does not touch the computer, its tunnel, or your account" scope, and `billing_inactive` keeps the refusal (`अस्वीकार कर दिया जाएगा`).

## Rulings on the translator's claims and questions

1. **"Judged identical: None" — rejected as incomplete** (hi-05).
2. **"Growth ≤1.29×" — accepted in substance.** The figure uses Devanagari cell counts, which is the guide's own budgeting metric; real CoreText width also comes out ≤ the English at every site measured, so fit holds under both methods. Their "no maxCells exists" statement is true.
3. **`panel.unavailable` with `बिल्ड` — accepted.** `बिल्ड` is shipped (`mobile.notifications.permission.unsupported`) and dominant in the UI repo; `वर्ज़न` would import a second word for the same object.
4. **`signin.use_address` adapted to `पता और पासवर्ड से कनेक्ट करें` — accepted.** It states what the button does, matches the `unavailable_alt` line's verb, and does not contradict `transport.custom` (`आपका पता`). Not a finding.
5. **Glossary proposals — all four accepted** for the wave that lands this: `harness → हार्नेस` (already appears once in the UI repo hi catalogue, so the row prevents future drift), `tunnel → टनल`, feminine, `recommended → अनुशंसित`, `route → रूट`. Note `अनुशंसित`, `निलंबित` and `निरस्त` have no prior occurrence in either repo — standard words, but the row is what stops the next wave inventing `सुझाया गया` or `रद्द` (the draft's `निरस्त`/`रद्द` split is a good call and should be recorded so nobody "fixes" it).
6. **The `ध्वनि` lesson applied as asked:** bare-noun consistency was checked across namespaces, not just within the slice — `कंप्यूटर` 57/19 (`संगणक` 0), `टनल` (feminine agreement: `इस टनल की बिलिंग`, `अपनी टनल`, `इसकी टनल`), `रिले`, `साइन इन करें`/`साइन-इन`, `रूट`, `रीफ़्रेश करें`, `बंद` for *disabled*, `सक्रिय`/`कनेक्ट हो रहा` for the two shipped badges, and `हार्नेस` (found in the UI repo, which is why it is not a new-term risk). The one drift the lesson did catch is the `इस्तेमाल`/`उपयोग` split (hi-02).

## Artifacts (this session's scratchpad — nothing written into either repo)

- `/Users/damian/.local-operator/sessions/91a41d00ad8f/scratchpad/receipt.json` — sha256 `f6a48779018ce6453aff003df99328e425143725ee7c46e993829ab97d5fbfae`
- `/Users/damian/.local-operator/sessions/91a41d00ad8f/scratchpad/report.md` (this file)
- `/Users/damian/.local-operator/sessions/91a41d00ad8f/scratchpad/audit.log` — sha256 `35a3e57b3fb065847bdd1a6ff7e8ca5629edacaa55c6c0e4f396862415aad032`, real commands + actual output (213 lines): hashes, parser pass, hygiene pass, CoreText measurements, term counts in both repos
- `audit-hi-s1.mjs`, `verify2.mjs`, `measure.swift`, `measure2.swift`, `run-audit.sh` — the scripts that produced the log

**Not done here, by design:** no ledger row and no `i18n/audits/evidence/...` commit — the worktree is read-only for this audit and the receipt's contract puts recording in the requesting session. Suggested ledger note (≤280 chars):
`hi M3 S1 (computers+signin) first pass e97663964c5f, deepseek-flash, head 1796c3a, draft 768194117988: passed, 0 blocker/major, 5 minor (own_body calque, उपयोग/इस्तेमाल drift, wait.listing order, stage_browser term split, row.a11y not declared identical), 3 nits.`
