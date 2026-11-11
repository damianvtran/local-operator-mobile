# i18n audit — M2 slice, `ur`, lane A (round 1)

- Task: M2 / native phone-app expression literals, ROUND 1 audit — `m2-au-ur-A`
- Locale: `ur` (RTL) · Lane: A (the 27-key candidate only; lane B is a separate audit)
- Candidate: `~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/ur.v1.json`
  - sha256 `4f5005aa89d6e682cde166336791372895c23e18607daf2e7749570299066483`
- Source + context: `…/m2-prep/keys27.json` — sha256 `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e`
- Reference (read-only): M1 `…/m1-prep/ur.v2.json` — sha256 `b6f343ef3320719247487c4dc932ddacea0214ce64d49bb0c92ba25e31fbd3cd`
- Style guide `~/local-operator/i18n/style-guides/ur.md` — sha256 `c0eecf7f7b5e89956b7de9ab7a9eb647ff1a7ef701ccf2a7f0264d5eea15ca60`
- Glossary `~/local-operator/i18n/glossary.md` — sha256 `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`
- Shipped `ur` catalogue counted (worktree `~/local-operator-mobile/.worktrees/i18n-app-scan`):
  `mobile.settings.json` `c1ee8429…`, `mobile.session.json` `b72a0109…`, `mobile.computers.json` `616eba92…`,
  `mobile.chrome.json` `bcc6bb23…`, `relay.chrome.json` `0c5a8921…`
- Wiring read from branch `feat/i18n-app-scan-expression-literals` (`d349df3c`, `b6b890e0`).
- Auditor: independent; did not translate and did not edit the candidate. No translation/MT service
  was used for comparison or back-translation — judgement is from the source sidecar, the shipped
  catalogue and native reading.
- Auditor model actually served: `deepseek/deepseek-flash` (no fallback observed this run).
- Independent of the translator session (`i18n-translator`, `openai/gpt-6.1-sol`).

## Verdict

**changes_requested** — 0 BLOCKER, **1 MAJOR**, 7 MINOR, 1 NIT.
`passed` is not available while the MAJOR stands.

## 1. Mechanical pass — PASS

Ran the app's own message parser (`src/i18n/messages.ts` → `parseMessage`) over all 27 candidate
values via `tsx`, then re-checked independently with `python3`. Log: `audit.log` (this directory);
script: `validate.ts`.

| Check | Result |
|---|---|
| Key set and order vs sidecar | identical, 27/27 |
| Every value parses (placeholders/ICU) | 27/27, no parse error |
| Placeholder names vs English, per key | identical for all 8 placeholder uses (`{percent}`×4, `{baseUrl}`, `{host}`, `{labels}`, `{name}`) |
| Placeholders vs sidecar `placeholders` field | identical |
| ICU plural/select in slice | none — no CLDR arm question for `ur` |
| Keys added / dropped | none |
| Empty or whitespace-padded values | none |
| English-identical values | `mobile.settings.account.app_name` only — required (product name) |
| NFC | all values already NFC |
| Bidi controls (`RLM/LRM/FSI/PDI`) or other `Cf` chars | none — correct per `ur.md` "RTL & bidi" |
| Urdu (Arabic-Indic/extended) digits | none — Latin digits per guide §"Numbers" |
| Latin runs | `Radient`×2, `Local Operator` (product names) + the 5 placeholder names only |
| Wrong-script letters (Arabic `ي ك ى ة` for Urdu `ی ک`) | none |
| Punctuation inventory | `۔`×4, `%`×4, `·`×3, `↑`×1, `↓`×2, half-width `(`/`)`×2 pairs, no ASCII `.` — matches `ur.md` "Punctuation & typography" |
| Every key present in the branch's `en` catalogues with the sidecar's English | yes, 27/27 exact (checked at `b6b890e0`) |
| Key-shape rule (`<namespace>.<name>` / `<namespace>.<group>.<name>`) | all 27 valid |

Fit: the slice declares no `maxChars`/`maxCells` hints, and the surfaces that could overflow wrap by
design — `DiagnosticRow` value is `numberOfLines={2}` with `flex-1` (settings.tsx:774-781), the
account-card name line (where `not_signed_in` renders) has no line cap and wraps inside a `flex-1`
column, `ConnectionPill` is `max-w-full` with a shrinking, wrapping label (`connection-pill.tsx`).
One line IS capped: the account card's second line — `route_radient` / `route_direct` /
`no_connection` — is `numberOfLines={1}` with `ellipsizeMode="tail"` (settings.tsx:312-315), so
length there is a real budget; the F5 suggestion (+4 cells) stays well inside it.
No overflow finding; the suggestions below therefore stay inside the shipped budgets (the longest,
`جواب نہیں دے رہا` = 17 chars ≈ 17 cells, already shipped in a relay subtitle line).

## 2. Accuracy, idiom, terminology — findings

### F1 · MAJOR · `mobile.settings.status.not_answering`
- Current: `بے جواب`
- Problem: the sidecar note is binding — "Matches the relay's \"Not answering\" wording" — and the
  shipped `ur` catalogue renders exactly that English as **`جواب نہیں دے رہا`**
  (`relay.chrome.json:2`, `relay.chrome.session.subtitle.not_answering`; the same phrase is in
  `mobile.session.json:56` «کمپیوٹر جواب نہیں دے رہا»). `بے جواب` is a different term: it says
  "unanswered / left without a reply" (a question, or a person struck dumb), not "a machine that has
  stopped responding", so the Settings pill and the session subtitle would name one condition two ways.
  Length is not the reason to keep it: the pill wraps by design and the relay already ships the longer
  phrase in a subtitle.
- Suggested: `جواب نہیں دے رہا`

### F2 · MINOR · `mobile.settings.diagnostics.stream_degraded`
- Current: `بے جواب`
- Problem: same condition as the Status row (sidecar: "the stream is open but not answering"). With F1
  applied, this row would hold the last `بے جواب` for that state — two names for one state, one screen.
- Suggested: `جواب نہیں دے رہا`

### F3 · MINOR · `mobile.settings.diagnostics.stream_connecting`
- Current: `جڑ رہا`
- Problem: the same screen's pill says `منسلک ہو رہا ہے…` (`mobile.computers.json:6`, used by
  `statusFor` for the minting/connecting cases), and `منسلک ہو رہا` is the catalogue's dominant word
  for a connection coming up (`mobile.computers.json:5`, `relay.health.json:4`). `جڑ رہا` is
  understandable — the Team Bridge gate ships `Radient سے جڑ رہے ہیں` (`mobile.team_bridge.json:63`) —
  but a diagnostics row read beside the pill should not introduce the second word.
- Suggested: `منسلک ہو رہا`

### F4 · MINOR · `mobile.settings.diagnostics.stream_idle`
- Current: `غیرفعال`
- Problem: the app already renders the English `idle` as `فارغ` (`relay.chrome.json:9`,
  `relay.chrome.session.subtitle.idle`). `غیرفعال` reads "inactive / not enabled", which this
  catalogue uses for disabled/off (`mobile.computers.json:19` «فعال نہیں», `mobile.schedules.json:11`
  «کچھ بھی فعال نہیں»), so the row can be read as "switched off" rather than "no stream started yet".
- Suggested: `فارغ`

### F5 · MINOR · `mobile.settings.status.no_connection`
- Current: `کنکشن نہیں`
- Problem: English is "No connection **yet**"; the "yet" (nothing chosen so far, still open) is dropped.
  This catalogue keeps it: `یہاں ابھی کچھ نہیں` (`mobile.session.json:57`), `یہ سیشن ابھی منسلک نہیں ہے`
  (`mobile.session.json:55`). Without it the pill reads as a failure, which is precisely what the
  `inactive` state exists to avoid (`connection-pill.tsx`: "Nothing failed, so there is no cause to
  colour"). Fit check: this value renders on the card's capped second line (`numberOfLines={1}`,
  tail ellipsis, settings.tsx:312-315); the suggestion is ≈14 cells (the guide's ≈1 cell per
  Arabic-script character) against a body-sm line on the narrowest phone, i.e. inside the budget, and
  it is also the pill's text, which wraps.
- Suggested: `ابھی کنکشن نہیں`

### F6 · MINOR · `mobile.settings.account.not_signed_in`
- Current: `Radient سے سائن ان نہیں`
- Problem: `سائن ان` is nominal, so the line ends on a bare negation; the participles this catalogue
  negates without a copula are adjectives (`منسلک نہیں`, `فعال نہیں`), not nouns. The line this key
  replaces when a name is known is `سائن ان شدہ` (`mobile.settings.json:24`), so the negative should be
  built from the same predicate.
- Suggested: `Radient سے سائن ان نہیں ہے` — or `سائن ان شدہ نہیں`, which keeps the pair parallel with
  `سائن ان شدہ`. Keep `Radient` Latin. Fit: this line has no line cap and wraps in a `flex-1` column,
  so +4 cells costs nothing (it is not the tail-ellipsised line below it).

### F7 · MINOR · `mobile.session.tray.context_estimate` and `…context_short_estimate`
- Current: `{percent}% سیاق (تخمینہ)`
- Problem: `(est.)` modifies the figure/context, so the parenthetical wants the adjective `تخمینی`;
  `تخمینہ` is the noun ("an estimate") and reads as a label stapled to the phrase. Both keys take the
  same fix (they are legitimately identical otherwise — the sidecar allows the full word where no
  shorter form exists, and `سیاق` is already 4 letters).
- Suggested: `{percent}% سیاق (تخمینی)`

### F8 · MINOR · `mobile.computers.wait.host_answering`
- Current: `آپ کے کمپیوٹر سے {host} پر جواب آنے کا انتظار ہے۔ راستہ تیار ہونے کا مطلب یہ نہیں کہ کمپیوٹر بھی چل رہا ہے۔`
- Problem: `…سے {host} پر جواب آنے کا انتظار…` attaches the locative to `جواب آنا` ("an answer arriving
  **at** {host}") before the reader reaches "from your computer", so the phrase is slower to parse than
  the English, which says the computer *at* {host} is the one being awaited. Meaning is recoverable, and
  the second sentence is accurate and well turned.
- Suggested: `{host} پر موجود آپ کے کمپیوٹر سے جواب آنے کا انتظار ہے۔ راستہ تیار ہونے کا مطلب یہ نہیں کہ کمپیوٹر بھی چل رہا ہے۔`
  (`آپ کے کمپیوٹر ({host}) سے جواب آنے کا انتظار ہے۔` is the shorter alternative.)

### N1 · NIT · `mobile.computers.added.fallback_name`
- Current: `آپ کے کمپیوٹر`
- Not a defect in this wave: it is the oblique form, which is exactly right in its only call site —
  `{name} سے منسلک ہو گیا۔` yields `آپ کے کمپیوٹر سے منسلک ہو گیا۔` (computers.tsx, `b6b890e0`).
- Flagged only as a reuse constraint: the key is now case-locked to a postpositional slot. If a later
  surface interpolates it where a nominative is needed (a `Back to <name>`-shaped line), it will read
  wrong and needs a second nominative value, not an edit to this one. No change requested.

## 3. Checked and correct (no finding)

- `mobile.settings.account.route_radient` `آپ کے Radient ٹنل کے ذریعے` — register and the
  `Radient ٹنل` compound match the shipped diagnostics row; `Radient` stays Latin, spaced either side
  (no bidi adjacency problem).
- `mobile.settings.account.route_direct` `براہ راست {baseUrl} سے منسلک` — `منسلک … سے` is the shipped
  collocation (`mobile.settings.json:30`), and the LTR URL island sits mid-sentence with spaces both
  sides, so it isolates cleanly.
- `mobile.settings.status.not_connected` `منسلک نہیں` — byte-identical to `mobile.home.json:43`.
- `mobile.settings.status.offline` / `…stream_offline` `آف لائن` — consistent with each other and with
  the settled loanword policy (`اسٹریم`, `ٹنل`, `ڈیوائس` all take Urdu script).
- `mobile.settings.status.connected` `منسلک`, `…stream_live` `آن لائن` (matches
  `relay.health.json:2` `آن لائن` for "live").
- `mobile.computers.wait.answering` `آپ کے کمپیوٹر سے جواب آنے کا انتظار ہے۔` — accurate, `آپ` formality
  correct, `۔` full stop, no drift from the English.
- `mobile.computers.added.connected_to` `{name} سے منسلک ہو گیا۔` — correct event sense ("Connected"),
  agrees with the shipped `منسلک ہو گیا` (`mobile.computers.json:33`) and with the fallback pair as
  analysed in N1. Bidi-safe: the sentence-initial `{name}` island is isolated by the renderer and the
  `۔` still closes the line on the left.
- `mobile.session.tray.context` / `…context_short` `{percent}% سیاق` — `سیاق` is the shipped word for
  context (`mobile.chrome.json:9,24`); number-then-`%` is the locale's convention
  (`mobile.settings.json:38` `{percent}%`), and the ET `%` attaches to the EN digits inside the isolate.
- `mobile.session.region.end` `اختتام · اسکرول کریں ↑`, `…below_labels`
  `{labels} نیچے · اسکرول کریں ↓`, `…more_below` `مزید نیچے · اسکرول کریں ↓` — the middle dot, both
  arrows and the absence of a final stop are preserved; the arrows are vertical, so the RTL mirror rule
  does not apply; `نیچے` matches the shipped use of `نیچے` as a position word. Order is correct: read
  right-to-left the label/`نیچے` precedes the dot and the cue. `اسکرول کریں` is a new but settled
  borrowing in this catalogue's style (`اسٹریم`-class loanwords).
- `mobile.session.video.title_fallback` `ویڈیو` — matches `mobile.session.json:14` (`ویڈیو {name} چلائیں`).
- `mobile.session.fallback_name` `سیشن` — glossary §2 and `ur.md` "Locale calls" exactly.
- `mobile.settings.account.app_name` `Local Operator` — glossary §1, never translated; correct as the
  only English-identical value.

## 4. Second independent pass (high-visibility settings group)

The 13 settings keys were re-read against their sidecar notes after the first pass. Two adjudications
changed and are disclosed:

- `not_answering`: first pass also considered the wording a meaning risk on its own; the settled ground
  is narrower and stronger — it is a **sidecar-binding cross-surface mismatch** with the shipped relay
  word, which is why it stays MAJOR (F1) rather than being split into two findings.
- `not_signed_in`: first pass read the missing copula as ungrammatical (MAJOR); on re-read, terse Urdu
  status strips do drop it after adjectival predicates, so it is a consistency/idiom point against the
  sibling `سائن ان شدہ`, i.e. MINOR (F6). It is not frozen under the MAJOR bar.

Everything else in the second pass agreed with the first: no additional MAJOR/BLOCKER, and no finding
was withdrawn.

## 5. Out-of-slice observation (not a defect of these 27 values; no severity)

`mobile.session.region.below_labels` splices `{labels}`, which at head `b6b890e0` is still built from
English literals — `REGION_LABEL` = `activity` / `agents` / `tasks` / `status`
(`app/(app)/session/[id].tsx:1099-1104`), and those strings are not keyed in this branch nor listed in
`scripts/i18n/strings-baseline.json`. In `ur` the cue will therefore render as
`activity نیچے · اسکرول کریں ↓`. The Urdu wording is right; the placeholder content is untranslated
upstream. Reported for the manager to route, not counted against this candidate.

## 6. Reproduce

```
cd ~/local-operator-mobile/.worktrees/i18n-app-scan
./node_modules/.bin/tsx ~/.local-operator/sessions/7a89d877a8cf/scratchpad/m2a/validate.ts
# and the independent python checks recorded in …/m2a/audit.log
```

Artifacts in this directory: `audit-ur-A.md` (this report), `audit.log` (execution log),
`validate.ts` (repo-parser harness), plus byte-identical copies of the candidate and sidecar
(`ur.v1.json`, `keys27.json`) used as inputs, verified equal to the originals before use.
These are session-scratch working artifacts, not the repo evidence bundle — per the brief, no repo
or ledger file was written.
