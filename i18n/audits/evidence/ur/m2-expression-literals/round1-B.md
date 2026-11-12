# M2 round 1 — ur (RTL), lane B — independent audit

Auditor: i18n-auditor (session 25d4f61fffe4), served model anthropic/claude-sonnet-5-5 (no fallback).
Candidate: m2-prep/ur.v1.json (27 keys). Verdict: **changes-requested** (0 BLOCKER, 1 MAJOR, 4 MINOR, 3 NIT).

## Mechanical (python, derived here)
- 27 keys, same set and order as keys27.json: PASS.
- Placeholder parity ({baseUrl},{host},{percent},{labels},{name}): PASS (set-equal per key).
- Empty / English-identical: none except app_name (deliberate "Local Operator").
- NFC: PASS. Manual bidi controls (LRM/RLM/FSI/PDI/ZWNJ/ZWJ): none. Latin residue: only Radient / Local Operator / placeholders.
- Punctuation: ۔ at sentence ends; ↑ ↓ · and parentheses preserved; digits Latin ({percent} only). PASS.
- Terminology recount against shipped ur catalogue (649 keys): سیاق = context (mobile.chrome.composer.row_usage/more) OK; سیشن OK; ٹنل OK (route_radient "Radient ٹنل"); براہ راست OK (route_direct); راستہ=route; آن لائن = relay.health.live OK; ویڈیو OK; کنکشن noun OK. Divergences are in F1, F3, F4 below.

## Findings

### F1 MAJOR — mobile.settings.status.not_answering
Current: `بے جواب`. English "Not answering"; the key note says it "matches the relay's 'Not answering' wording", and the shipped catalogue has that wording twice: relay.chrome.session.subtitle.not_answering = `جواب نہیں دے رہا`, mobile.session.subagent.unavailable_next "…کمپیوٹر جواب نہیں دے رہا".
Problems: (a) glossary/terminology divergence on the same state across screens; (b) idiom hazard — in everyday Urdu `بے جواب` is chiefly "matchless / unrivalled" (بے جواب کارکردگی), only secondarily "without reply". As a status pill for a *degraded* link it can read as praise, a polarity risk.
Suggest: `جواب نہیں دے رہا` (16 cells; same drop-of-ہے convention as the relay and this style guide's recorded sibling). Evidence: shipped string above; style guide ur.md width section records the same pattern.

### F2 MINOR — mobile.settings.diagnostics.stream_degraded
Current: `بے جواب` (same word, same hazard, and identical to the Status row on the same Settings screen, so "degraded" and "Not answering" are indistinguishable — English keeps them apart only mildly, but the note says degraded = open yet not answering). Suggest `جواب نہیں دے رہا` (follow F1).

### F3 MINOR — mobile.settings.diagnostics.stream_connecting
Current: `جڑ رہا` (also no auxiliary, unlike every sibling). Shipped connecting state is `منسلک ہو رہا` (mobile.computers.badge.connecting; style guide ur.md records «دوبارہ منسلک ہو رہا» as the consistent form), and the Settings Status pill on the same screen renders `منسلک ہو رہا ہے…` (statusFor → mobile.computers.connecting). Two lexemes for one state on one screen. Suggest `منسلک ہو رہا`.

### F4 MINOR — mobile.settings.status.no_connection
Current: `کنکشن نہیں`. Drops "yet" (the state is "no computer chosen *yet*", not a failure) and sits one word from not_connected `منسلک نہیں` (= shipped mobile.home.picker.not_connected) in the same pill slot; the two states (nothing chosen vs refused) read as near-synonyms. Slot is a value half-row/account line with numberOfLines=1, 20 chars fits. Suggest `ابھی کوئی کنکشن نہیں`.

### F5 MINOR (unverified on device) — string-initial Latin runs: mobile.session.region.below_labels, mobile.computers.added.connected_to, mobile.settings.account.not_signed_in
These open with a Latin placeholder/name ({labels}, {name}, "Radient"). The mobile runtime does not FSI-wrap (grep of src/i18n finds no isolation; direction is a root Yoga `direction`), so on iOS a Text whose first strong char is Latin may paint left-aligned/LTR-based, which for connected_to puts the closing `۔` on the wrong side of the Urdu run. Shipped precedent exists (chrome.home.connecting "{host} سے رابطہ ہو رہا ہے…", projects `{base} · {live} فعال`), so not wording-blocking; recommend one RTL device/simulator frame for a Latin computer name before sign-off. No manual bidi controls should be added (style guide). Placeholders mid-string ({host} in wait.host_answering, {baseUrl} in route_direct) are fine: URL is trailing-slash-stripped (saved-computers.ts normaliseBaseUrl), hostname ends in a letter/digit, so no neutral-at-run-edge flip.

### NITs
- N1 mobile.session.region.end `اختتام · اسکرول کریں ↑`: correct, but literary for a scroll cue; `آخر` is lighter (`آخر · اسکرول کریں ↑`). Keep if you prefer the unambiguous noun.
- N2 tray.context_estimate / context_short_estimate `(تخمینہ)`: noun ("estimate") for an adjective-like "(est.)"; `(تخمینی)` or `(اندازاً)` is tighter, and `اندازاً` also gives the narrow variant a genuinely shorter form (context_short currently equals context, acceptable as no Urdu "ctx" exists).
- N3 mobile.settings.account.not_signed_in `Radient سے سائن ان نہیں`: understood, but shipped signed_in is `سائن ان شدہ` and the usual Urdu is "میں سائن ان" for an account; `Radient میں سائن ان نہیں`.

## Checked and fine (no finding)
route_radient (oblique agreement OK); route_direct word order; offline/connected/live/idle(`غیرفعال` is apt for "no stream started"); wait.host_answering + wait.answering (meaning of the "provisioned route ≠ machine up" sentence preserved; راستہ matches diagnostics.route); fallback_name + connected_to read naturally together: `آپ کے کمپیوٹر سے منسلک ہو گیا۔` (oblique کے + سے correct; fallback is only ever used inside that sentence); region.more_below; video title; session fallback `سیشن` per style guide; آپ register throughout; Local Operator kept Latin; arrows/middle dot/parentheses placed correctly for RTL (↑ ↓ are not mirrored; parentheses mirror automatically).

## Out-of-lane observation (wiring, not a translation defect)
`app/(app)/session/[id].tsx` REGION_LABEL is hardcoded English ("activity","agents","tasks","status"), so `{labels}` will inject English words into the Urdu cue (e.g. `activity · agents نیچے · …`). Shipped ur already has کام / ایجنٹس (relay.chrome.session.tray.*). Likewise the `Back to ${parentName}` a11y labels (video.tsx, agent/[jobId].tsx) are still English templates, so `mobile.session.fallback_name` "سیشن" lands inside an English sentence there. Worth routing to the wiring slice.
