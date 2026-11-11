# hi — slice M2 (native phone-app expression literals) — ROUND 2 delta audit

- **Locale:** `hi` (Hindi, Devanagari, LTR)
- **Lane:** independent auditor, round 2 (delta). Round 1 was two independent audits (A `deepseek/deepseek-flash`, B `anthropic/claude-sonnet-5-5`).
- **Candidate under audit:** `hi.v3.json` (33 keys), the final candidate for slice M2.
- **Translator:** `i18n-translator`, session `2006a3a729b8` / `7051988689fd`, ACTUAL `openai/gpt-6.1-sol`.
- **Auditor:** `i18n-auditor`, session `305a7a7c8380`, ACTUAL served model **`deepseek/deepseek-flash`** (session model header). No fallback, no MT service, no back-translation. Every judgement below is reasoning from the English source, the shipped Hindi catalogues and the call sites.
- **Date:** 2026-11-11.

## Verdict

**changes-requested** — 1 BLOCKER, 1 MAJOR, 1 MINOR, 3 NIT.

Both round-1 streams' substantive findings are genuinely fixed, and the new region/back-to values are mostly good Hindi. But the delta introduces one **mechanical blocker that would nullify a fifth of the slice** (four translated keys are keyed `region.label.working` where the source and the code use `region.label_working`), and one **meaning/register regression** (`stream_degraded` now carries "not answering" where the source word is `degraded`, collapsing the diagnostics-vs-status distinction the code deliberately keeps).

Ledger status for `hi` + this group: **not `passed`** until the BLOCKER and the MAJOR are resolved.

## Inputs and provenance

| Input | Path | sha256 |
|---|---|---|
| English source + context/meta sidecar (33 keys) | `…/sessions/3ef6295a5545/scratchpad/m2-prep/keys33.json` | `f3a96f9a9d92cfdb7be5e981b02c3ad9be6bc15b0eba96e4967223ea85bc4a8f` |
| Final candidate | `…/m2-prep/hi.v3.json` | `9d7bb518fdfec9867824730958197dff116e6d4d786b1f71a60696fc8fb42762` |
| v1 (round-1 candidate) | `…/m2-prep/hi.v1.json` | `b399886745568752b430bb6bdcc2b4d8f70dc96d83bfee575e120cccda4936bf` |
| Round-1 report A | `…/m2-prep/r1/audit-hi-A.md` | `8b7b67c3dfc31a13b23652dd108660dd026dd0223b3f81f221978c54c1c08bf7` (staged copy) |
| Round-1 report B | `…/m2-prep/r1/audit-hi-B.md` | `1a347c87872cc6c9144f78948dcb46eeddf3b68e299deb0f781372d3cb91c3ed` (staged copy) |
| Translator dispositions v2 / v3 | `…/m2-prep/hi.v2-changes.md`, `hi.v3-changes.md` | `a636b87e094c6bc49b01839648fc060128ca5cd8e1a1cfba53a68675a3ee87bb`, `866fe0a93082221098b044cd154193e30194ebf6d48f31dee6671dbda89feea6` |
| hi style guide | `~/local-operator/i18n/style-guides/hi.md` | `82292dc8d13fcc93dc752457719264aed3cc20bb65ecfaba0f0e5a31f4cb40d5` |
| glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

I read the originals read-only through the `read` tool; the copies named above were staged byte-for-byte into this session's scratch
(`…/sessions/305a7a7c8380/scratchpad/m2hi/`) for hashing and execution, because every tool call that hands the ancestor session's path to a
program is refused by this harness's guardrail (verbatim refusals are in `audit.log`). The staged `hi.v1.json` hashes to exactly the value
report A recorded for the original (`b3998867…`), which is the cross-check that the copies are byte-identical.

Heads read: mobile worktree `~/local-operator-mobile/.worktrees/i18n-app-scan` at **`b783c878`** (branch
`feat/i18n-app-scan-english-closure`) for the shipped Hindi catalogue recount as the brief directs; the M2 wiring branch
**`feat/i18n-app-scan-expression-literals` @ `9d99fa0f`** (commits `deeb8bc4`, `d349df3c`, `b6b890e0`, `5fc0eeea`, `9d99fa0f`) for the English
source, the generator's key union and the call sites; core `b42471d3935c` for `relay.chrome`. Origin/main is `d78ca861`.

## What I ran (execution, not notes)

1. **v1 → v3 delta** (`validate.py`): `33 keys; order-equal=true; missing=[]; extra=[]; 12 changed, 6 added, 0 dropped`. Changed keys:
   `route_radient`, `status.no_connection`, `stream_idle`, `stream_connecting`, `stream_live`, `stream_degraded`, `wait.host_answering`,
   `tray.context_short`, `tray.context_short_estimate`, `region.end`, `region.below_labels`, `region.more_below`. Added:
   `region.label.working`, `region.label.subagents`, `region.label.todos`, `region.label.strip`, `session.back_to`, `session.back_to_session`.
2. **The repository's own message parser** (`src/i18n/messages.ts`, imported at `9d99fa0f` by `node --experimental-strip-types`) over all 33
   values: `parsed: 33/33, problems: 0` — every value parses, and each key's parsed parameter set and kind equals the sidecar's
   `placeholders` (0 diffs). No key in this group carries `plural` or `select`, so there are no CLDR arms to check for `hi` (`one`/`other`).
3. **Render probe** (same parser, `formatMessage`) with real arguments:
   ```
   नीचे: गतिविधि · उप-एजेंट · कार्य · स्थिति · स्क्रॉल करें ↓
   नीचे और भी है · स्क्रॉल करें ↓ / अंत · स्क्रॉल करें ↑
   42% संदर्भ / 42% संद. / 42% संद. (अनुमान)
   आपके कंप्यूटर से कनेक्ट हो गया। | Atlas से कनेक्ट हो गया।
   Atlas पर वापस जाएँ | सत्र पर वापस जाएँ | मेरा काम पर वापस जाएँ | सत्र पर वापस जाएँ (back_to_session)
   सीधे atlas.local:7878 से कनेक्ट है
   atlas.local पर मौजूद आपके कंप्यूटर के जवाब का इंतज़ार है। रूट बन जाने का मतलब यह नहीं है कि कंप्यूटर चालू है।
   ```
4. **Key contract against the English source at `9d99fa0f`**: for all 33 candidate keys, the English catalogue entry exists with
   **byte-identical** English (`ENGLISH MISMATCH: none`) for 29 of them; the four `region.label.*` keys are **absent**
   (`MISSING in en source: mobile.session.region.label.working|subagents|todos|strip`) and the source's four
   `mobile.session.region.label_working|_subagents|_todos|_strip` are **absent from the candidate**.
5. **Hygiene** (`validate.py`): no empty/non-string values; all NFC; no edge/double spaces; zero ZW/bidi controls (U+200B–200F, U+202A–202E,
   U+2066–2069, U+061C, U+FEFF) — `ur`-only concern, but scanned anyway; no Devanagari digits; English-identical values = exactly
   `mobile.settings.account.app_name` (required byte-identical); glyph parity `·` 3/3, `↑` 1/1, `↓` 2/2, `%` 4/4, `(` 2/2, `)` 2/2 against
   English.
6. **Widths** with `rich.cells.cell_len` (the guide's optimistic Devanagari model) — table below.
7. **Shipped-vocabulary recount, derived here** across all 22 mobile `hi` catalogue files at the worktree head `b783c878`, cross-checked at
   origin/main `d78ca861` and at the M2 tip `9d99fa0f` (identical for every term I judge on except where noted):
   `कनेक्ट हो रहा` 4 · `जुड़ रहा` 1 (`mobile.chrome.home.reconnecting`) · `आइडल` 1 (`relay.chrome.session.subtitle.idle`) ·
   `निष्क्रिय` 1 (`mobile.schedules.state.dormant`) · `ऑनलाइन` 1 (`relay.health.live`) · `सक्रिय` 7 · `उत्तर नहीं दे रहा` 1
   (`relay.chrome.session.subtitle.not_answering`, byte-identical) · `जवाब` 1 on main / 4 on the sibling english-closure branch ·
   `वीडियो` 1 (`highlights.video_open`) · `संदर्भ` 2 · `संद.` **0** · `गतिविधि` **0** · `उप-एजेंट` 2 (6 on english-closure) · `कार्य` 8 ·
   `स्थिति` 6 · `कनेक्ट है` **0** · `कनेक्टेड` **0** · `ऑफ़लाइन` **0** (core `hi` has `ऑफ़लाइन` 3×, `कनेक्ट हो रहा` 10×, `आइडल` 8×,
   `उप-एजेंट` 32×, `कार्य` 25×, `स्थिति` 13×, `उत्तर नहीं दे रहा` 3×, `संदर्भ` 22×, `रूट` 15×, `गतिविधि` 0×). No value in the whole shipped
   Hindi set uses a Devanagari abbreviation with a period (`[क-ह]{1,5}\.` → 0 hits in both mobile and core), and `॰` (U+0970) appears
   nowhere in the catalogues (the style guide's own date example, `10 अक्टू॰ 2026`, is the only attestation of the sign).
8. **Round-1 findings adjudicated one by one** against the v3 value — table below.

## Round-1 adjudication (all 6 A findings, all 8 B bullets)

| # | Round-1 finding | v3 value | Decision |
|---|---|---|---|
| A `H-A-01` | `stream_connecting` = `जुड़ रहा` off the product's connect vocabulary | `कनेक्ट हो रहा` | **fixed correctly** — byte-identical to `mobile.computers.badge.connecting`; `कनेक्ट हो रहा` 4× mobile / 10× core vs `जुड़ रहा` 1×/0×, recounted |
| A `H-A-02` | `host_answering` lost its copula | `…इंतज़ार है। रूट बन जाने का मतलब यह नहीं है कि कंप्यूटर चालू है।` | **fixed correctly** — `है` restored, `रूट बन जाने` is a faithful "provisioned", second sentence keeps the "route ≠ machine up" warning |
| A `H-A-03` | `route_radient` a bare postpositional fragment | `आपकी Radient टनल से कनेक्ट है` | **fixed correctly** — verb supplied, feminine `आपकी … टनल` agreement kept, no final full stop, 24 cells ≤ English 27 |
| A `H-A-04` | `नीचे` twice in one cue; `और है` clipped | `नीचे: {labels} · स्क्रॉल करें ↓` / `नीचे और भी है · स्क्रॉल करें ↓` | **fixed** on both counts; the colon is judged fresh below (NIT `H-D-01`) |
| A `H-A-05` | narrow context forms identical to the full forms | `{percent}% संद.` / `{percent}% संद. (अनुमान)` | **fixed** — now 7 and 14 cells vs 8 and 16, i.e. equal to the English narrow forms instead of +1/+3; the abbreviation itself is judged fresh below (MINOR `H-D-02`) |
| A `H-A-06` (NIT) | keep `निष्क्रिय` for `stream_idle` | `आइडल` | **overturned** — the translator's change is right: `आइडल` is the shipped session-state word (`relay.chrome.session.subtitle.idle`, 1× mobile / 8× core), `निष्क्रिय` is shipped for a *different* state (`schedules.state.dormant`), and A's pairing argument (`सक्रिय` for live) no longer applies now that live is `ऑनलाइन` |
| B 1 | `और है` has no noun; suggested `पंक्तियाँ` | `नीचे और भी है` | **fixed**; B's noun was **correctly declined** — "rows" adds a referent the English "more below" does not have |
| B 2 | second `नीचे`; redundant `ऊपर` in `region.end` | `अंत · स्क्रॉल करें ↑` | **fixed correctly** — English is `end · scroll ↑`, so dropping `ऊपर` restores parity rather than losing information (14 cells = English 14) |
| B 3 | `connecting` vocabulary | `कनेक्ट हो रहा` | **fixed correctly** (same as A-01) |
| B 4 | `निष्क्रिय`/`सक्रिय` vs shipped `आइडल`/`ऑनलाइन` | `आइडल` / `ऑनलाइन` | **fixed correctly** — both now match shipped relay words byte-for-byte; `सक्रिय` is released back to `computers.badge.active` / schedules. Enum check: the five stream values are pairwise distinct |
| B 5 | narrow forms do not narrow; suggested `(अनु.)` | `संद.` / `(अनुमान)` | **fixed** in substance; `(अनुमान)` is the better half — `अनु.` would read as `अनुसार`/`अनुच्छेद` and `अनुमान` is the shipped estimate noun (`tui.projects_edit.refusal_estimate_*`). The abbreviation is judged fresh in `H-D-02` |
| B 6 | "provisioned" loose; `{host} पर` read as the waiting place | `…{host} पर मौजूद आपके कंप्यूटर…`, `रूट बन जाने…` | **fixed correctly** — `मौजूद` binds the host to the machine, `बन जाने` replaces `तैयार` |
| B 7 (no change requested) | `बाधित` was acceptable for `degraded` | `उत्तर नहीं दे रहा` | **B upheld, translator's change overturned** — a regression, filed as MAJOR `H-D-03` |
| B 8 | video/agent-job screens still built `Back to ${parentName}` in English | `back_to` + `back_to_session` keys exist | **fixed in code, verified** — at `9d99fa0f`, `src/features/session/back-label.ts` `backToParentLabel()` renders `mobile.session.back_to` with a name and `mobile.session.back_to_session` when the name is null/undefined/empty, and both `video.tsx` and `agent/[jobId].tsx` pass it as the back button's `accessibilityLabel`. Translating `back_to_session` was therefore the right response |

## Findings

### BLOCKER

**H-D-01 · BLOCKER · four `mobile.session.region.label.*` keys do not exist in the source**
Current keys/values: `mobile.session.region.label.working` = `गतिविधि`, `.label.subagents` = `उप-एजेंट`, `.label.todos` = `कार्य`,
`.label.strip` = `स्थिति`
Problem: the English catalogue at the reviewed head (`9d99fa0f:src/i18n/catalogues/en/mobile.session.json:58-61`) and the generator's key
union (`src/i18n/catalogue.gen.ts:382-385, 976-979, 1573-1576`) spell these `mobile.session.region.label_working` / `label_subagents` /
`label_todos` / `label_strip`, and that is what the code asks for: `app/(app)/session/[id].tsx:1100-1103` calls
`t("mobile.session.region.label_working")` … `t("mobile.session.region.label_strip")`. The four Hindi values are therefore keyed to
nothing: the shipped cue line would read `नीचे: activity · agents · tasks · status · स्क्रॉल करें ↓` — English nouns inside a Hindi
sentence — which is precisely the defect this slice exists to remove. The dot spelling comes from the sidecar (`keys32.json`, `keys33.json`),
not from the translator, so the fix belongs with the manager's integration lane as much as with the translator: **rename the four keys in the
candidate (and the sidecar) to the source spelling `region.label_working` / `label_subagents` / `label_todos` / `label_strip`.**
Suggested: values unchanged; keys `mobile.session.region.label_working|_subagents|_todos|_strip`.

### MAJOR

**H-D-03 · MAJOR · `mobile.settings.diagnostics.stream_degraded` now says "not answering", where the source word is `degraded`**
Current: `उत्तर नहीं दे रहा` (v1 was `बाधित`, which both round-1 audits accepted)
Problem: three things, in ascending weight.
(a) *Form*: the sidecar asks for a lower-case one-word diagnostic token (`english: "degraded"`, "one word, no final full stop"). The enum now has
two multi-word members (`कनेक्ट हो रहा` and `उत्तर नहीं दे रहा`); `कनेक्ट हो रहा` is defensible because it is the shipped state word for exactly that
state (`mobile.computers.badge.connecting`, byte-identical), whereas `उत्तर नहीं दे रहा` is the shipped *status sentence* borrowed onto a surface
whose English token is a single state name.
(b) *Collapse*: the value is byte-identical to `mobile.settings.status.not_answering`. English deliberately keeps those two surfaces
different — `statusFor()` maps health `degraded` to the words *Not answering* (`settings.tsx:741-747`) while `streamWord()` shows the raw enum
word *degraded* (`settings.tsx:765-766`), and the file's own comment says "a diagnostic value is a path, a hostname, a model id or a version"
and "`degraded` alone tells a reader nothing to act on". Rendering both as the same Hindi sentence destroys that deliberate split: the
diagnostics row can no longer be told apart from the status pill, which is the one place a reader looks when the pill is already telling them
the computer is not answering.
(c) *Meaning*: `उत्तर नहीं दे रहा` is a claim about answering; `degraded` is a claim about the stream being unhealthy. They overlap in this
state machine (health `degraded` *is* "open but not answering"), so this is not a polarity or safety error and not a BLOCKER — but it is a
narrowed meaning, and it replaces a word both independent round-1 audits judged correct.
Suggested: `बाधित` (v1, 3 cells, already accepted twice). If the manager wants the enum to read as a state rather than a disruption,
`क्षीण` is the other one-word option — but revert the collapse either way.

### MINOR

**H-D-02 · MINOR · `mobile.session.tray.context_short` / `context_short_estimate` — invented abbreviation ending in an ASCII full stop**
Current: `{percent}% संद.` / `{percent}% संद. (अनुमान)`
Problem: the narrowing is real and correct (7 and 14 cells vs 8 and 16 — equal to the English narrow forms, and narrower than the full forms,
so the D17 reason for these keys is served). The vehicle is not: `संद.` appears **nowhere** in the shipped Hindi corpus (0 hits in 59
catalogue files), no Devanagari abbreviation with a period exists anywhere in it, and the ASCII `.` inside a "42% …" chip reads as a
sentence terminator rather than an abbreviation mark. Hindi marks abbreviations with `॰` (U+0970) — the same sign the product's own formatter
emits in `10 अक्टू॰ 2026` — and `संद.` also brushes against `संदेश` (message), a first-class term on this very screen.
Suggested: `{percent}% संद॰` and `{percent}% संद॰ (अनुमान)` — same 7/14 cells, correct abbreviation mark, no sentence-stop illusion. If the
manager would rather not have an abbreviation at all, the sidecar explicitly permits the full word (`{percent}% संदर्भ`, 8 cells — one over
the English narrow form).

### NIT

**H-D-04 · NIT · `mobile.session.region.below_labels` — the imperative sits inside the colon's list**
Current: `नीचे: {labels} · स्क्रॉल करें ↓` → `नीचे: गतिविधि · उप-एजेंट · कार्य · स्थिति · स्क्रॉल करें ↓` (41 cells; English 51)
Problem: the colon is a defensible fix for the real problem A found (a postposed `नीचे` after a `·`-joined noun list binds to the last noun
only, which is why labels-first reads worse), and I am not asking for a change to the meaning. But the colon's scope now swallows the action:
`· स्क्रॉल करें ↓` parses as a fifth member of the enumeration. The reader still recovers, because the imperative and the arrow stand out.
Suggested: keep the colon and separate the action, e.g. `नीचे: {labels} — स्क्रॉल करें ↓`; or accept as-is. No blocker.

**H-D-05 · NIT · `mobile.settings.status.connected` = `कनेक्ट है` where core ships `कनेक्टेड`**
Current: `कनेक्ट है` (`कनेक्टेड`: 0 hits in mobile `hi`, 1 key in core `hi`, `relay.chrome.drawer.status` online arm)
Problem: none in Hindi — `कनेक्ट है` completes a coherent trio with the shipped `कनेक्ट नहीं` and the new `कनेक्ट हो रहा`, and the
adjective loan `कनेक्टेड` would break that parallelism. Recording the divergence so a later auditor does not "fix" it back.
Suggested: keep `कनेक्ट है`.

**H-D-06 · NIT · `mobile.session.region.label.working` = `गतिविधि` is a first-use term**
Current: `गतिविधि` (0 hits in mobile and core `hi`); the shipped session hint calls the same band `कार्यरत पंक्ति`
(`mobile.session.status_tray.hint`), and `relay.chrome.session.subtitle.working` = `कार्यरत`.
Problem: none — `गतिविधि` is the standard noun for "activity", it reads correctly inside `नीचे: …`, and it is the only candidate that does not
collide with `कार्य`, which is already the shipped word for the *tasks* band listed next to it. Recording it so the ledger note is deliberate
rather than accidental.
Suggested: keep `गतिविधि`.

## New and changed values judged fresh

| Key | v3 | Judgement |
|---|---|---|
| `region.end` | `अंत · स्क्रॉल करें ↑` | good — `अंत` is the right noun, arrow and `·` kept, 14 cells = English |
| `region.below_labels` | `नीचे: {labels} · स्क्रॉल करें ↓` | grammatical and clear at the call site (the payload arrives pre-joined: `hiddenRegionLabels.join(" · ")`, `[id].tsx:1399-1404`); colon-scope nit `H-D-04` |
| `region.more_below` | `नीचे और भी है · स्क्रॉल करें ↓` | good — idiomatic `और भी है`, no invented noun |
| `region.label.todos` | `कार्य` | good — shipped tasks word (`relay.chrome.session.tray.tasks`, `tasks_title`) |
| `region.label.subagents` | `उप-एजेंट` | good — glossary §2 binding (child/subagent → `उप-एजेंट`), and the right band word: English shortens to "agents", but `एजेंट` alone would collide with the main agent |
| `region.label.strip` | `स्थिति` | good — shipped status noun (`settings.connection.status`, `library.browse.status`) |
| `region.label.working` | `गतिविधि` | good, first-use term (NIT `H-D-06`); all four keys are keyed wrongly (`H-D-01`) |
| `session.back_to` | `{name} पर वापस जाएँ` | good — renders grammatically with a real name (`Atlas पर वापस जाएँ`), with the fallback (`सत्र पर वापस जाएँ`) and with a multi-word Hindi name (`मेरा काम पर वापस जाएँ`); `पर` takes the direct case, so no oblique trap; polite imperative `जाएँ` per the style guide. It is the back button's `accessibilityLabel`, so a spoken imperative is the right register |
| `session.back_to_session` | `सत्र पर वापस जाएँ` | good — identical to what `back_to` produces with the fallback, which is what the code's `backToParentLabel()` renders for an unnamed parent; `सत्र` is the glossary term |
| `session.fallback_name` | `सत्र` | good — unchanged, no revision needed; it is now used only as the agent-job screen's title fallback (`agent/[jobId].tsx:70`), a bare noun, which `सत्र` is |
| `computers.added.connected_to` + `added.fallback_name` | `{name} से कनेक्ट हो गया।` + `आपके कंप्यूटर` | good — executed renders: `आपके कंप्यूटर से कनेक्ट हो गया।` and `Atlas से कनेक्ट हो गया।`; `से` is the shipped pattern (`इस कंप्यूटर से कनेक्ट नहीं हो सका`), the danda is present as the sidecar requires, and the fallback is a bare noun phrase that fits |
| `tray.context_short` / `_short_estimate` | `{percent}% संद.` / `{percent}% संद. (अनुमान)` | genuinely narrower (7/14 vs 8/16); abbreviation defect MINOR `H-D-02` |

## Checks the brief asked for by name

- **The "not answering" pair.** `mobile.settings.status.not_answering` = `उत्तर नहीं दे रहा`, byte-identical to the shipped core *and*
  mobile `relay.chrome.session.subtitle.not_answering` — the sidecar's requirement is met exactly, and masculine agreement is right for
  `कंप्यूटर`. The pair is *not* the same key as the diagnostics one in English, which is exactly why `stream_degraded` must not share the
  string (`H-D-03`).
- **`no_connection` vs `offline` distinctness.** `अभी तक कनेक्शन नहीं` (14 cells) / `ऑफ़लाइन` (5) / `कनेक्ट नहीं` (7) are three clearly
  different strings for three different states, and the *yet* survives in `अभी तक`; `not_connected` is byte-identical to the shipped
  `mobile.home.picker.not_connected` (`कनेक्ट नहीं`). No state pair is confusable, none is inverted.
- **Safety of terse labels.** No negation error anywhere in the group: `not_signed_in` negates the shipped `साइन इन है` correctly in the
  shipped `X में साइन इन` frame; `कनेक्ट नहीं` / `कनेक्ट हो रहा` / `कनेक्ट है` are three visibly different states; `उत्तर नहीं दे रहा`
  cannot be read as healthy. Nothing destructive, permission-related or error-bearing in this group is softened.

## Mechanical pass (33 keys)

`33 keys, order == keys33.json; placeholders per key == sidecar (params+kinds, 0 diffs, via the repo parser); no empties; all NFC; no
double/edge spaces; no ZW or bidi controls; no Devanagari digits; `·`/`↑`/`↓`/`%`/`()` counts equal to English; danda present on every
sentence-final key and absent elsewhere except the `संद.` abbreviation period (H-D-02); English-identical only
`mobile.settings.account.app_name` (required); no ICU plural/select in the group, so no CLDR arms apply.

Keys added/dropped vs source: 4 added + 4 missing (H-D-01). Duplicate values: `stream_degraded` == `status.not_answering` (H-D-03);
`stream_offline` == `status.offline` (= `ऑफ़लाइन`), which mirrors the source's own `offline`/`Offline` pair and is correct.

I could not run the repository catalogue validator on the candidate: it is a scratch file, not a catalogue, and this lane forbids repo edits.
What I ran instead is the same parser and the same key contract the validator uses (§"What I ran" 2 and 4), executed against the candidate.

## Fit (measured, not guessed)

| Surface / key | en cells | hi cells | delta |
|---|---:|---:|---:|
| `tray.context_short` (`42% ctx`) | 7 | 7 | 0 |
| `tray.context_short_estimate` | 14 | 14 | 0 |
| `region.below_labels` (4 labels) | 51 | 41 | −10 |
| `region.more_below` | 21 | 21 | 0 |
| `region.end` | 14 | 14 | 0 |
| `status.not_answering` | 13 | 12 | −1 |
| `diagnostics.stream_degraded`, suggested revert (`बाधित`) | 13 | 3 | −10 |
| `computers.added.connected_to` (real name / fallback) | 19 / 27 | 18 / 22 | −1 / −5 |
| `session.back_to` (real name) | 13 | 15 | +2 |
| `settings.account.route_direct` | 38 | 28 | −10 |
| `computers.wait.host_answering` | 106 | 76 | −30 |

Nothing in this group exceeds its English width except `back_to` with a short Latin name (+2 cells) on a back button's accessibility label,
which has no width budget; the narrow tray forms are exactly the English width, which is what D17 needs. No overflow risk found.

## Second independent pass (high-visibility settings group)

The brief asks for a second pass over the settings group rather than trusting the first. I re-read all 14 `mobile.settings.*` values cold
after the first pass. It added no new defect: it re-confirmed the first pass's `stream_degraded` finding (and sharpened its "collapse" argument
by reading `statusFor`/`streamWord` side by side), and it found nothing in `not_signed_in`,
`route_radient`, `route_direct`, `no_connection`, `not_connected`, `offline`, `not_answering`, `connected`, `stream_idle`,
`stream_connecting`, `stream_live`, `stream_offline`, `app_name`.

## Non-translation observation (verified, not a finding against the text)

The M2 branch `feat/i18n-app-scan-expression-literals` (`9d99fa0f`) and the sibling branch `feat/i18n-app-scan-english-closure`
(`b783c878`) are both cut from origin/main `d78ca861` and both key literals on the same Settings screen and the same add-a-computer wait
panel **with different key names and different copy** (e.g. M2's `wait.host_answering` / `added.connected_to` vs english-closure's
`wait.nothing_answered` / `wait.paused`; M2's `settings.status.*` vs english-closure's `settings.connection.status` + inline status words).
Whichever merges second will have to reconcile that by hand, and the candidate's 14 settings keys and its wait-panel keys must be re-checked
against the merged English catalogue afterwards. This does not change any judgement above (the candidate matches its own M2 source, which is
what the brief scopes), but the manager should know before integrating.

## Provenance and limits

- Session `305a7a7c8380`, `i18n-auditor`, ACTUAL served model **`deepseek/deepseek-flash`** — the model in this session's header. **No
  fallback model was used**; `actual_model_source` = session header.
- I did not translate these files, cannot edit them, and did not patch any repo file, catalogue, ledger or the candidate. No translation/MT
  service was consulted; no back-translation was used.
- `audit_notes_not_execution_log`: every count, render and width above comes from a command actually run in this session; the commands are
  in `audit.log` beside this file, and the helper scripts are `validate.py` and `parse_check.mjs`. Anything I could not execute (the repo
  catalogue validator, RN pixel layout) is named as unrun rather than implied.
- No ledger row and no `i18n/audits/evidence/` bundle was written by me: this lane forbids repo and ledger edits, and the note must therefore
  not claim one. Machine-readable companion: `record.json` in this directory, next to `audit.log`, for the manager to file.
