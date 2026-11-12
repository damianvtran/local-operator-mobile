# hi — M2 expression-literal slice, SECOND INDEPENDENT RE-AUDIT (shipped bytes)

- **Locale:** `hi` (Devanagari, LTR). **Group:** `m2-expression-literals`, 33 keys across `mobile.settings` (14), `mobile.computers` (4), `mobile.session` (15).
- **Auditor:** `i18n-auditor` (lopdev team), session `27f18f49e621`, ACTUAL served model **`deepseek/deepseek-flash`** — the model in this session's header. **No fallback model was used**, `actual_model_source` = session header, not a fallback switch.
- **Fresh instance:** I did not write these translations, am not either earlier auditor of this slice, and cannot edit them. No translation API/SDK/MT service was used to compare or back-translate; every judgement below is my own reading against the English source, the sidecars, the glossary and the style guide.
- **Read-only:** no repo file, catalogue, ledger, evidence bundle or PR was modified. Artifacts live in my session scratch and are named below.
- **Head audited:** worktree `~/local-operator-mobile/.worktrees/i18n-m2-scanner` @ `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a` (PR #236). `git status --porcelain src/i18n/catalogues/hi/ i18n/audits/evidence/hi/` → empty.
- **Date:** 2026-11-11.

## Verdict

**clean-with-findings** — **BLOCKER 0 · MAJOR 0 · MINOR 0 · NIT 2**.

No wrong or unsafe meaning, no inverted polarity, no broken/absent placeholder, no key added or dropped, no ICU construct, no stray English outside the two permitted product names. Ledger status for `hi` + this group is therefore **`passed`**. The manager asked for a second independent pass because the region-key rename went unread; I re-derived every judgement rather than ratifying round 3, and the two NITs below are ones round 3 recorded as resolved/absent.

---

## 1. The assignment's question: which version did the last auditor read, and is it the shipped text?

**Answer: yes — the shipped bytes ARE the bytes round 3 read. The premise "the finals went to v4 after audit round 3" is not supported.** Proven, not assumed:

| Step | Evidence (executed) |
|---|---|
| Round 3's subject file | `i18n/audits/evidence/hi/m2-expression-literals/round3.md` (sha256 `44cc0a1d…`), which states it audited `hi.final.json` and that `hi.final == hi.v4`. |
| What `final.json` is | raw sha256 `86311dcd4ae93be093bf2e87f873ba33fc57e1a27d2e615df621606488a748cf`; its **33 key/value pairs are identical to `hi.v4.json`** (`fff35250…`, translator scratch) — dict equality `True`, key order identical — and **differ from `hi.v3.json`** (`9d7bb518…`, equality `False`). |
| Round 3 *proves* it read v4 | round3 describes its v3→final delta as "exactly 3 value changes + 4 renames". The actual v3→v4 diff is **exactly** those: value changes `stream_degraded` (`उत्तर नहीं दे रहा`→`बाधित`), `context_short` (`संद.`→`संद॰`), `context_short_estimate` (`संद.`→`संद॰`), plus the 4 dotted→underscore renames. A reader of v3 could not have described that set. |
| Shipped == audited | all 33 shipped `hi` values are byte-identical to `final.json` per key (`shipped == final` → `True`, 33/33, no missing keys). |
| Shipped bytes did not move after | `git log fa2bc5e0..HEAD -- src/i18n/catalogues/hi/` → **one** commit, `6b539d7a`, which predates the evidence commit `17e9e0f6`; `3af477ee` (the re-pin) touched neither the catalogues nor this bundle. |

**What no auditor had read is now read**: the four underscore region labels (`label_working|_subagents|_todos|_strip`) in their shipped form, with their call sites — see §2 and §3.

## 2. Mechanical (executed here; log: `hi-m2/audit.log`)

1. **Key set** — 33/33 present in `en` and in shipped `hi`; no extra, none missing; the 33 are exactly the genuinely-new keys of this PR (36 added lines in the file diff minus 3 pre-existing keys re-worded: `wait.relay_sessions`, `diagnostics.privacy_note`, `composer.retained_instruction`). No duplicate JSON keys in any of the three files (structured-pair load: 59/45/78 keys, all unique). JSON valid.
2. **Placeholders** — name-set equal to English for every key (`{percent}`, `{baseUrl}`, `{host}`, `{name}`, `{labels}`); **0 mismatches**.
3. **ICU** — no plural/select in this slice (`none in this slice`), so no CLDR arm question applies; the one adjacent plural key this PR re-words (`mobile.computers.wait.relay_sessions`, outside my 33) carries `one`/`other` only, valid for `hi`, placeholders intact, danda terminator — I checked it and it is sound.
4. **Markup / code / identifiers** — no Rich tags, backticks, commands, flags or paths in these values; the only Latin runs are `Radient` (×3, product name per sidecar/glossary §1), `Local Operator` (×1, explicitly required byte-identical), and placeholder tokens. **Values byte-identical to English: `mobile.settings.account.app_name` only** — the permitted exception.
5. **Unicode** — all NFC; no ZW/ZWJ/ZWNJ, no bidi controls, no bidi isolates (LTR locale; scanned anyway); no Devanagari digits (Latin digits per §2.8).
6. **Repo validators** — `node scripts/i18n/generate.ts --check` → exit 0, `catalogue.gen.ts is current (684 keys, 21 namespaces, …)`; `node scripts/i18n/check-strings.ts` → exit 0, `212 finding(s), all baselined; 0 new`. (The bundle's translator note cites 642 keys / 230 findings from an earlier base; the shipped head is 42 keys larger from other lanes — no effect on these 33, noted for the record.)
7. **Region-key rename** — `git grep` of the four names in `app/` resolves to `app/(app)/session/[id].tsx:1100-1103` (`REGION_LABEL`); **no** dotted `region.label.*` exists anywhere in `app/` or `src/`; the four names match `en/mobile.session.json:74-77` and their sidecar rows (`en/mobile.session.context.json:290-302`). Values sit against the right English source (`activity`→`गतिविधि`, `agents`→`उप-एजेंट`, `tasks`→`कार्य`, `status`→`स्थिति`), and the renamed pair is also exercised by `src/i18n/__tests__/expression-literals.test.ts:97-120`.
8. **Negative control (checker bites)** — on in-memory mutations only: break `{percent}`→`{pct}` → flagged; drop `{name}` → flagged; rename `{name}`→`{Name}` → flagged; replace a value with English → flagged; the same checker run on the shipped value → clean. 4/4 controls fired, 0 false positives.

## 3. Judgement, all 33 values

Formality/tone: आप-register, polite imperatives (`जाएँ`, `करें`), no तुम/तू, no `!`, no padding honorifics, danda only where the English ends a sentence — matches the `hi` style guide. Terminology held to the shipped set, recounted here: `उप-एजेंट` (glossary "subagent → उप-एजेंट"), `कार्य` for tasks (same word as `relay.chrome.session.tray.tasks` and `status_tray.hint`), `स्थिति` for status (`mobile.settings.connection.status`), `सत्र` (glossary), `संदर्भ` (glossary "compaction → संदर्भ संपीडन"), `कनेक्ट हो रहा` / `आइडल` / `ऑनलाइन` / `उत्तर नहीं दे रहा` (byte-identical to the shipped relay/computers wording). `गतिविधि` is new to the catalogues, but the English label is itself "activity" while the tray hint says "working line" (`कार्यरत पंक्ति`) — the English source carries that same two-name split, so the Hindi mirrors it rather than diverging.

The dangerous string is correct: `wait.host_answering` keeps **both** its copula and its negation — `रूट बन जाने का मतलब यह नहीं है कि कंप्यूटर चालू है।` = "a route having been created does not mean the computer is up" — polarity and the warning intact (this is the sentence where a polarity slip would have been a BLOCKER).

**Length / fit** — no sidecar in this slice carries `maxCells`, so fit is judged against the English and the D17 narrow constraint. Measured with two models I built here (`hi-m2/…`, codepoint and akshara-cluster; `rich` is not installed in this session, so round 3's cell numbers are not reproducible — see §5): every Hindi value is at or below the English cell count in the akshara model, and at most +3 codepoints in the widest (`tray.context_estimate` 22 cp vs 19) on the **wide** branch. The narrow branch is genuinely shorter than its full form in both models and never wider than English by more than 1 codepoint. `region.end` (12 aksharas vs 14 en) and `more_below` (19 vs 21) fit the same single-line meta slot (`app/(app)/session/[id].tsx:1395-1406`, no `numberOfLines` cap, wraps rather than truncates). No overflow finding.

**Arrows / bidi** — `↑` in `region.end` and `↓` in both downward cues keep the English directions; middle dots preserved (3 keys); LTR locale, so no bidi isolation requirement on `{baseUrl}`/`{host}`.

## 4. Findings

### NIT H-R1 — `mobile.session.region.below_labels` = `नीचे: {labels} · स्क्रॉल करें ↓`
- **Problem:** the sidecar joins the labels with ` · `, and the cue keeps the same dot before `स्क्रॉल करें ↓`. English interposes the word *below* between the list and the scroll cue, so the cue cannot be misread as a list member; the Hindi moves `नीचे` to the front behind a colon, leaving nothing that closes the list. At the widest case (4 hidden labels) the reader sees `नीचे: गतिविधि · उप-एजेंट · कार्य · स्थिति · स्क्रॉल करें ↓` — five dot-separated items, the fifth an instruction.
- **Severity:** NIT. The verb form plus the arrow disambiguate on a second read; meaning is not lost. Round 2 filed this as NIT `H-D-01`; **round 3 recorded it resolved, but the shipped text is unchanged from what round 2 queried** — so it is carried, not closed.
- **Suggested wording:** `{labels} नीचे · स्क्रॉल करें ↓` — mirrors the English order, and a postpositional `नीचे` closes the coordinated list (`गतिविधि · कार्य नीचे` is grammatical), keeping the placeholder, the middle dot and the arrow.

### NIT H-R2 — `mobile.settings.diagnostics.stream_connecting` = `कनेक्ट हो रहा`
- **Problem:** the row renders this value against the label `स्ट्रीम` (`src/features/settings/settings.tsx:598-600`, `DiagnosticRow label={t("mobile.settings.diagnostics.stream")} value={streamWord(...)}`). Hindi reads `स्ट्रीम` as feminine (flow/धारा class: `स्ट्रीम चल रही है`), while the participle is masculine `हो रहा`. The identical string is **correct** on `mobile.computers.badge.connecting`, where the subject is `कंप्यूटर` (masculine) — so the reuse is right there and only looks loose here.
- **Severity:** NIT, deliberately not MINOR: terse status fragments in Hindi routinely take default masculine (`कनेक्ट हो रहा है…` under a spinner) regardless of the governing noun, so this may be entirely acceptable register. It is the one value I would want a native render check on, on the Diagnostics screen itself.
- **Suggested wording if it is to agree:** `कनेक्ट हो रही` (separate key, so the computers badge keeps its masculine form untouched).

### Record-accuracy note (not a copy finding)
Round 3 justifies the `॰` in `context_short`/`context_short_estimate` with "shipped formatter data (`formats.json` `अक्टू॰`)". **There is no `formats.json` in this repo** (`git grep formats.json` → nothing; `git grep ॰` outside the catalogues returns only markdown/JSON evidence). The *substance* is nevertheless right, and I checked it at the source that actually exists: the runtime formatter emits the sign — `new Intl.DateTimeFormat('hi-IN',{day:'numeric',month:'short',year:'numeric'})` → `9 अक्टू॰ 2026`, `has U+0970: true`, and the app's dates already ship that glyph. So `संद॰` uses the product's own abbreviation mark and the glyph-support worry is moot; only the citation is wrong, and the ledger note should not repeat it.

## 5. Provenance of my own measurement limits

- Widths: `rich` is unavailable in this session, so I could not reproduce round 3's `7/8` and `14/15` cells. In my akshara model `संद॰` and `संदर्भ` both measure 3 aksharas (the abbreviation sign takes its own cell), while the codepoint model gives 4 vs 6; the claimed exact 1-cell saving is therefore model-dependent, but **`narrow ≤ full` holds in every model I ran**, and the D17 comment (`app/(app)/session/[id].tsx:130-135`) is the binding constraint, so I raise no fit finding. Terminal/grapheme models are not a native render; no device frame is claimed.
- A native-speaker frame and a rendered screenshot of the Diagnostics row are **not claimed** — nothing here was rendered on a device.
- The translator's model (`openai/gpt-6.1-sol` per the bundle) was not observed by me; I take it from the bundle.

## 6. Hashes (shipped head `3af477ee`)

| Input | sha256 |
|---|---|
| 33 `en` values, sorted-key JSON | `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528` |
| **33 shipped `hi` values, sorted-key JSON** | `e36177c90748fb8473929dd1f3aebbd2ba15850cb8712db94413b6c374cd8ea0` |
| `hi/mobile.settings.json` (59 keys) | `0b280b2a31908d2c80fce10440487d7e393350daf22ef32e5a775df0332c6a81` |
| `hi/mobile.computers.json` (45 keys) | `8f0280dfe5a4e8cc636ef6081215a3669c01f16d8837424e43f072688f973a36` |
| `hi/mobile.session.json` (78 keys) | `ceed71f00dc48800907885684c56d173e799364f3d2703e79bd947019c3341c4` |
| `en/mobile.settings.json` | `d7e1d85b68773871a578791ad57e0a08e421a220738e561b9e09ce22f9aee23d` |
| `en/mobile.computers.json` | `713827837aab9d75611441155d50522ccce9d8b410d88c1b7bd27e528776aff3` |
| `en/mobile.session.json` | `8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3` |
| `en/mobile.settings.context.json` | `67691ab95fba5cbcc86596899504ce2b9ba1acd518b3a9bdc1048dcc22b54c12` |
| `en/mobile.computers.context.json` | `cc2973003f79db729001df88189b1f1ba52a0609e117fe384396a406437637e0` |
| `en/mobile.session.context.json` | `a988f1c90c380802bef31c8f8737cc9a6f32334518c652283a3d3dd210520ae5` |
| bundle `final.json` (= `hi.v4.json` content) | `86311dcd4ae93be093bf2e87f873ba33fc57e1a27d2e615df621606488a748cf` |
| bundle `round3.md` / `round2.md` | `44cc0a1d…` / `885a2de3…` |
| `hi` style guide / glossary (core) | `82292dc8…` / `0eb34437…` |

## 7. Ledger row for the manager to file (I am read-only and file nothing)

- `locale` `hi` · `namespace` `m2-expression-literals` · `status` **`passed`** · `key_count` 33 · `audit_date` 2026-11-11.
- `auditor`: `i18n-auditor` (lopdev team), session `27f18f49e621`, model **`deepseek/deepseek-flash`** (`actual_model_source`: session header; no fallback), `independent_from_translator_session: true`.
- `source_hash` (en 33) `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528`; `target_hash` (hi 33) `e36177c90748fb8473929dd1f3aebbd2ba15850cb8712db94413b6c374cd8ea0`.
- Proposed note (255 chars, ≤280): `Shipped hi 33/33 == bundle final.json (86311dc) == hi.v4, so round 3 did read the shipped bytes; 4 renamed region labels re-verified against en+call sites. 0 B/M, 2 NIT (below_labels list flattening, stream_connecting participle).`
- **Evidence gap for the manager:** `i18n/audits/evidence/hi/m2-expression-literals/` ships `final.json` + round/translator reports but **no `record.json` and no `audit.log`**, unlike every other `hi` bundle in the tree. My machine-readable `record.json` + `audit.log` are staged in scratch (`hi-m2/`) and need filing under `i18n/audits/evidence/hi/m2-expression-literals/<audit-id>/` — they are **not** tracked and I make no claim that they are.

**My artifacts (session scratch, untracked):** `scratchpad/audit-hi.md` (this report), `scratchpad/hi-m2/record.json`, `scratchpad/hi-m2/audit.log` (actual command output), `scratchpad/hi-m2/verify.py` (the checker + negative controls).

### Per-key judgement (all 33; every value read in full, in Devanagari)

| # | key | shipped `hi` | judgement |
|---|---|---|---|
| 1 | `mobile.settings.account.not_signed_in` | Radient में साइन इन नहीं है | आप-register status; no final stop ✓ |
| 2 | `mobile.settings.account.route_radient` | आपकी Radient टनल से कनेक्ट है | fem. टनल agreement kept; verb supplied ✓ |
| 3 | `mobile.settings.account.route_direct` | सीधे {baseUrl} से कनेक्ट है | {baseUrl} intact; सीधे … से = "directly to" ✓ |
| 4 | `mobile.settings.status.no_connection` | अभी तक कनेक्शन नहीं | mirrors EN noun "connection"; no final stop ✓ |
| 5 | `mobile.settings.status.not_connected` | कनेक्ट नहीं | short pill form ✓ |
| 6 | `mobile.settings.status.offline` | ऑफ़लाइन | nukta kept (ऑफ़लाइन) ✓ |
| 7 | `mobile.settings.status.not_answering` | उत्तर नहीं दे रहा | masc. agrees with कंप्यूटर; matches relay wording ✓ |
| 8 | `mobile.settings.status.connected` | कनेक्ट है | pill form ✓ |
| 9 | `mobile.settings.diagnostics.stream_idle` | आइडल | matches shipped relay idle word ✓ |
| 10 | `mobile.settings.diagnostics.stream_connecting` | कनेक्ट हो रहा | see NIT H-R2 (स्ट्रीम gender) |
| 11 | `mobile.settings.diagnostics.stream_live` | ऑनलाइन | distinct from all four siblings; matches relay "live" ✓ |
| 12 | `mobile.settings.diagnostics.stream_degraded` | बाधित | बाधित = impaired/disrupted; distinct from status pill; accepted ✓ |
| 13 | `mobile.settings.diagnostics.stream_offline` | ऑफ़लाइन | ✓ |
| 14 | `mobile.computers.wait.host_answering` | {host} पर मौजूद आपके कंप्यूटर के जवाब का इंतज़ार है। रूट बन जाने का मतलब यह नहीं है कि कंप्यूटर चालू है। | BOTH copula and negation intact — polarity sound; {host} intact ✓ |
| 15 | `mobile.computers.wait.answering` | आपके कंप्यूटर के जवाब का इंतज़ार है। | ✓ |
| 16 | `mobile.computers.added.fallback_name` | आपके कंप्यूटर | oblique form fits "… से कनेक्ट हो गया" ✓ |
| 17 | `mobile.session.tray.context` | {percent}% संदर्भ | संदर्भ per glossary ✓ |
| 18 | `mobile.session.tray.context_short` | {percent}% संद॰ | narrow form; see §4 NIT on the sign |
| 19 | `mobile.session.tray.context_estimate` | {percent}% संदर्भ (अनुमानित) | parentheses kept ✓ |
| 20 | `mobile.session.tray.context_short_estimate` | {percent}% संद॰ (अनुमान) | noun/adjective asymmetry with wide form is the intended narrowing ✓ |
| 21 | `mobile.session.region.end` | अंत · स्क्रॉल करें ↑ | अंत · स्क्रॉल करें ↑ — direction and middle dot kept ✓ |
| 22 | `mobile.session.region.below_labels` | नीचे: {labels} · स्क्रॉल करें ↓ | see NIT H-R1 (list flattening) |
| 23 | `mobile.session.region.more_below` | नीचे और भी है · स्क्रॉल करें ↓ | idiomatic नीचे और भी है; dot + arrow kept ✓ |
| 24 | `mobile.session.video.title_fallback` | वीडियो | ✓ |
| 25 | `mobile.session.fallback_name` | सत्र | सत्र (glossary); composes with back_to ✓ |
| 26 | `mobile.settings.account.app_name` | Local Operator | Local Operator — permitted byte-identical ✓ |
| 27 | `mobile.computers.added.connected_to` | {name} से कनेक्ट हो गया। | danda full stop per sidecar; tense apt for just-added ✓ |
| 28 | `mobile.session.region.label_working` | गतिविधि | activity; new term but EN itself splits activity/working line ✓ |
| 29 | `mobile.session.region.label_subagents` | उप-एजेंट | उप-एजेंट per glossary ✓ |
| 30 | `mobile.session.region.label_todos` | कार्य | कार्य — same word as shipped tasks ✓ |
| 31 | `mobile.session.region.label_strip` | स्थिति | स्थिति — same word as shipped status ✓ |
| 32 | `mobile.session.back_to` | {name} पर वापस जाएँ | polite imperative; reads with any {name} ✓ |
| 33 | `mobile.session.back_to_session` | सत्र पर वापस जाएँ | identical frame to back_to; सत्र bare ✓ |

No key was judged by sampling: all 33 values were read against the English source, the sidecar row and the call site that renders them.
