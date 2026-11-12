# i18n audit — vi / Slice M2 (native phone-app expression literals) — Lane A — ROUND 1

- Audit ID: `m2-au-vi-A`
- Locale: `vi` · Lane: **A** · File group: `mobile.settings` + `mobile.session` + `mobile.computers` (27 keys)
- Candidate audited: `~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/vi.v1.json`
  sha256 `baf973bdbc80e70cc5db8221276b102f5006e19508447e7571716b8909205b7b`
- Source + context: `…/m2-prep/keys27.json` sha256 `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e`
- Branches/refs read: `feat/i18n-app-scan-expression-literals` @ `b6b890e0e1e0f69a87d29475d9d69ac1d22033b1`
  (call sites + en catalogue + en `.context.json` sidecars, read via `git show`)
- Binding guidance read: `~/local-operator/i18n/style-guides/vi.md`
  (`e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888`),
  `~/local-operator/i18n/glossary.md` (`0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`)
- Reference (read-only): M1 audited `m1-prep/vi.v2.json`; shipped `src/i18n/catalogues/vi/*.json`
- Auditor: `i18n-auditor`, session `8dab08878018`, **served model `deepseek/deepseek-flash`**
  (as this session's model header reports; no in-harness attestation beyond that).
  Independent of the translator session (`i18n-translator`, `openai/gpt-6.1-sol`): yes.
- No translation/MT service used. No repo or ledger writes (instructed). No file edited.

## VERDICT: **changes_requested**

0 BLOCKER · 1 MAJOR · 1 MINOR · 2 NIT

---

## 1. Mechanical pass (python3, this auditor's own run)

| Check | Result |
|---|---|
| Key set | 27/27 present, 0 added, 0 dropped |
| Key order | identical to source list order |
| Placeholders | exact name/type match on all: `{percent}`×4, `{labels}`, `{host}`, `{baseUrl}`, `{name}` |
| ICU plural/select | none in this slice (no `plural`/`select` in any source string) — nothing to verify; no branch invented |
| Markup / Rich / backticks / flags / paths / commands | none present in source or candidate; ` · ` separators and `↑`/`↓` arrows preserved byte-for-byte in the 3 region cues |
| Empty strings | none |
| English-identical | only `mobile.settings.account.app_name` = `Local Operator` (deliberate, product name per glossary §1) |
| Latin residue | only `Radient`, `Local Operator` + placeholder identifiers — no untranslated English prose |
| NFC | all 27 strings NFC-precomposed (no decomposed combining sequences) |
| Punctuation policy | no `!`; no ASCII `...`; no final full stop on `status`/`meta` keys; full stops present on the 3 full sentences (`wait.host_answering`, `wait.answering`, `connected_to`) ✓ |
| Candidate is a replacement, not a rival | on the M2 branch the `en` catalogue is **byte-identical** to `keys27.json` English for all 27 keys, and `vi` currently holds the English placeholders behind the pending-translation ledger; none of the 27 keys already exists in the shipped `vi`/`en` catalogues (no collision) |

Width table (chars, placeholder braces counted literally):

```
key                                        en   vi
settings.account.not_signed_in             26   26
settings.account.route_radient             27   29
settings.account.route_direct              31   34
settings.status.no_connection              17   15
settings.status.not_connected              13   12
settings.status.offline                     7   11
settings.status.not_answering              13   14
settings.status.connected                   9   10
settings.diagnostics.stream_idle            4    3
settings.diagnostics.stream_connecting     10   12
settings.diagnostics.stream_live            4    9
settings.diagnostics.stream_degraded        8    8
settings.diagnostics.stream_offline         7   11
computers.wait.host_answering             107   92
computers.wait.answering                   36   27
computers.added.fallback_name              13   16
session.tray.context                       18   19
session.tray.context_short                 14   19   <-- F1
session.tray.context_estimate              25   30
session.tray.context_short_estimate        21   30   <-- F1
session.region.end                         14   12
session.region.below_labels                25   26
session.region.more_below                  21   25
session.video.title_fallback                5    9   <-- F2
session.fallback_name                       7    5
settings.account.app_name                  14   14
computers.added.connected_to               20   22
```

Pill/fit acceptances (measured, not asserted): every status pill is at or near en width —
`Chưa có kết nối` 15 (en 17), `Chưa kết nối` 12 (13), `Ngoại tuyến` 11 (7), `Không phản hồi`
14 (13), `Đã kết nối` 10 (9). Pills are sized from en, so +4 on `Ngoại tuyến` is within
the existing slack; I do not raise it. Diagnostics monospace values stay ≤12 chars.

## 2. Terminology re-counted against the shipped `vi` catalogue (not trusted from the brief)

- `máy tính` (computer) — 56 occurrences; used throughout. Candidate consistent.
- `phiên` (session, glossary §2) — 28 occurrences. Candidate `phiên` consistent.
- `đường hầm` (tunnel) — established: `settings.diagnostics.route_radient` = `Đường hầm
  Radient`, `settings.account.delete_help` (`mọi đường hầm…`), `computers.billing_help`.
- `hoạt động` for *live/active* — established by `relay.health.live` = `Đang hoạt động`
  and `computers.badge.active` = `hoạt động`; candidate's `stream_live` agrees. ✓
- `phản hồi` for *answer/respond* — established (`máy tính không phản hồi`,
  `relay.health.quiet_detail` `đã ngừng phản hồi`). Candidate ✓.
- `kết nối` (connect/connection) — pervasive; `chưa kết nối` already shipped in
  `home.picker.not_connected` and `computers.section.not_connected`. ✓
- `video` — shipped **as Latin**: `mobile.session.highlights.video_open` = `Phát video
  {name}`. → F2.
- `ngoại tuyến`, `ngữ cảnh`, `cuộn` are new to the catalogue; all three are settled
  modern `vi` software usage and read natively.

## 3. Second pass on the high-visibility cluster

The manager asks for a second independent pass on high-visibility groups; the *other lane's*
auditor is that independent second reader, not me. What I did myself: after the first full
pass I re-read the 14 `mobile.settings` strings and the 3 wait-panel strings from the English
plus the sidecar notes alone, wrote my own render of each before looking at the candidate's
wording again, and compared. My render coincided with the candidate on 15 of those 17
(`not_signed_in`, `route_radient`, `route_direct`, `no_connection`, `not_connected`,
`offline`, `not_answering`, `connected`, `stream_connecting`, `stream_live`,
`stream_degraded`, `stream_offline`, `wait.answering`, `added.fallback_name`, and the
deliberately-kept `app_name`). The two where my wording differed are F3 (`host_answering`)
and F4 (`stream_idle`). F1 and F2 come from the width and terminology passes over the
session/wait group, not from this second pass. This is my own re-read, not an independent
auditor: lane B's pass is still owed by the manager.

## 4. Findings

### F1 — MAJOR — `mobile.session.tray.context_short`, `mobile.session.tray.context_short_estimate`
- Current: `{percent}% ngữ cảnh` · `{percent}% ngữ cảnh (ước tính)`
- Problem: the narrow-screen forms are **byte-identical to the full forms**
  (`tray.context`, `tray.context_estimate`). The dedicated short keys therefore buy zero
  width, so the defect design round 2 fixed for en (D17: `21% context (est.)` wraps the
  activity band to two lines under 340 pt — see `app/(app)/session/[id].tsx:132,1008`) comes
  straight back in `vi`, and worse: the en string that actually wrapped at 340 pt is the
  estimate form, rendered `21% context (est.)` (18 chars at a 2-digit percentage), while vi's
  narrow estimate slot renders `21% ngữ cảnh (ước tính)` — 23 chars, i.e. 5 **wider** than the
  string that already wrapped. Raw-template saving: en 18→14 and 25→21 (−4 each);
  vi 19→19 and 30→30 (**0**). Call site passes `narrow` on
  `viewportWidth < 340` (`:924`, `:1005`), so vi users under 340 pt get the wide string in the
  narrow slot. The key's own note ("use the language's own short form or the full word if none
  exists") does not rescue it: a short form does exist and en already uses it, and the note's
  escape hatch cannot override a measured layout budget.
- Suggested: `{percent}% ctx` and `{percent}% ctx (ước tính)` — en's abbreviation, kept as a
  Latin developer token (an abbreviation, not prose — the same class as the guide's
  kept-English `API`/`URL` list, which is how `ctx` reads to a developer). If the wave
  deliberately rejects a Latin abbreviation
  here, then the full word must be recorded as a width deviation in
  `i18n/style-guides/vi.md` (the guide already carries a "Recorded width exception" pattern) —
  silently shipping the full word in the short slot is an unrecorded overflow.

### F2 — MINOR — `mobile.session.video.title_fallback`
- Current: `Đoạn phim` (en `Video`)
- Problem: terminology inconsistency with the shipped catalogue, in the same screen family:
  `mobile.session.highlights.video_open` = `Phát video {name}` keeps `video` as the artifact
  noun, so the link that opens the player says "video" while the player's own header says
  "đoạn phim". `đoạn phim` also leans to a *film* segment (movie register) rather than the
  agent's video artifact.
- Suggested: `Video` (same Latin token the catalogue already ships; one word, matching the
  "one word" note).

### F3 — NIT — `mobile.computers.wait.host_answering`
- Current: `Đang chờ máy tính tại {host} phản hồi. Có tuyến kết nối chưa có nghĩa là máy tính đang chạy.`
- Problem: `chưa có nghĩa là` hedges the assertion to "does not *yet* mean"; en asserts
  "is not the same as". Meaning survives, but the sentence's job is to stop the reader
  assuming the machine is up, and the standard idiom is `không có nghĩa là`.
- Suggested: `… Có tuyến kết nối không có nghĩa là máy tính đang chạy.`
  (Optionally `Tuyến đã cấp` for "provisioned"; the current `Có tuyến kết nối` preserves the
  meaning and keeps it terse, so this part needs no change.)

### F4 — NIT — `mobile.settings.diagnostics.stream_idle`
- Current: `chờ` (en `idle`)
- Problem: `chờ` reads as "waiting/pending" — the connecting state — while en's `idle` means
  no stream has started. Defensible under the one-word, lower-case diagnostic budget, which is
  why this is a NIT, not a MINOR.
- Suggested: `chưa chạy` (or keep `chờ`; either is acceptable, do not lengthen it).

## 5. Classified clean (no finding)

- `not_signed_in`, `route_radient`, `route_direct`, `no_connection` vs `not_connected`
  (the `chưa có kết nối` / `chưa kết nối` distinction is a correct present-vs-action split),
  `offline`, `not_answering`, `connected`, `stream_connecting`, `stream_live`,
  `stream_degraded`, `stream_offline`, `wait.answering`, `added.fallback_name`,
  `tray.context`, `tray.context_estimate`, `region.end` (`hết` is the settled vi list-end
  cue), `region.below_labels`, `region.more_below`, `session.fallback_name` (`phiên` reads
  correctly as a bare header noun and in "Quay lại phiên"), `app_name`,
  `added.connected_to` (`Đã kết nối với máy tính của bạn.` and `Đã kết nối với <tên>.` both
  read naturally — the fallback noun phrase and a real computer name both slot in).
- Register: `bạn` appears only as possessive `của bạn` (style-guide compliant; dropped where
  en's "your" is not needed, e.g. `Đang chờ máy tính phản hồi.`); sentence case; no `!`.
- RTL: not applicable to `vi`.
- No destructive/permission text in this slice beyond the wait-panel caution, which is safe.

## 6. Not done / limits

- Did not run the repo validator (`generate.ts --check` validates the checkout's catalogues,
  not a prep candidate); the mechanical pass above is my own python3 run, as the slice
  directed.
- No ledger/record write and no evidence bundle, per the brief ("do not touch repo or
  ledger"). The manager owns the ledger row for this round.
- No rendered-device proof for F1: the finding is geometric (identical strings, zero saving,
  and the code's own D17 comment). A designer/QA 340 pt frame would confirm it visually.
