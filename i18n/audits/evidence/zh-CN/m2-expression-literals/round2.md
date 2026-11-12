# M2 round-2 delta audit — zh-CN (lane A2, independent)

**Verdict: changes_requested** · BLOCKER 1 · MAJOR 1 · MINOR 2 · NIT 2
Candidate audited: `m2-prep/zh-CN.v3.json` (33 keys) against `m2-prep/keys33.json`.

## Provenance

- Role `i18n-auditor` (independent), session `ab999e693853`. **Actual served model: `deepseek/deepseek-flash`** (session header; no fallback observed).
- Independent of the translator (`i18n-translator`, `openai/gpt-6.1-sol`) and of both round-1 auditors (`d78856afcb03` deepseek/deepseek-flash; lane B anthropic/claude-sonnet-5-5).
- Method: reading and reasoning only. No MT/API/SDK, no back-translation. Read-only: no repo, ledger or candidate edits (per slice brief).
- Inputs (SHA-256, computed here):

| Input | Path | SHA-256 |
|---|---|---|
| candidate v3 | `…/3ef6295a5545/scratchpad/m2-prep/zh-CN.v3.json` | `31d8f924cdab0822cd1dde7dfab2f59b8900860d70e111e9ec17ffb1e5b97cfa` |
| source + context | `…/m2-prep/keys33.json` | `f3a96f9a9d92cfdb7be5e981b02c3ad9be6bc15b0eba96e4967223ea85bc4a8f` |
| v1 | `…/m2-prep/zh-CN.v1.json` | `2118716b622fc672de49a7e672010f4947659e6f90d8c9d0597afa8dcb66265f` |
| v2 | `…/m2-prep/zh-CN.v2.json` | `907d9edeb16d87da6caf9c5aad7828317cea651e2a8af69755e6af2b114b41ba` |
| r1 report A | `…/m2-prep/r1/audit-zh-CN-A.md` | `2485be14de0ecdddcd7b15870a1a05eb2617b8ae1be8331784a6d383999d1566` |
| r1 report B | `…/m2-prep/r1/audit-zh-CN-B.md` | `980c87d5b7cee232842bae847134f0b13e4a4b84bcc5f5427ac5238c41aea980` |
| dispositions v2 | `…/m2-prep/zh-CN.v2-changes.md` | `14f52ad475d56956899ca5af3406ad8c5e742ca6784e0f8f27f6989f04f034bb` |
| dispositions v3 | `…/m2-prep/zh-CN.v3-changes.md` | `0ae00581180175abd30f8954417f15a32833126d1842b957ca5c1374e83964e2` |

Also read: `i18n/style-guides/zh-CN.md`, `i18n/glossary.md`, shipped `src/i18n/catalogues/zh-CN/*.json`
in `~/local-operator-mobile/.worktrees/i18n-app-scan` (21 catalogues / 649 values, recounted) and core
`local_operator/i18n/catalogues/zh-CN/*.json` (93 / 3219), plus the wiring branch
`feat/i18n-app-scan-expression-literals` @ `9d99fa0f` (read via `git show`, not checked out).

## 1. Delta v1 → v3 (python diff, run here)

Changed existing (5): `account.route_radient` (dropped 你的), `computers.wait.host_answering` (位于→
`{host}上`), `tray.context_short` (上下文→ctx), `tray.context_short_estimate` (上下文…（估算）→
ctx…（约）), `region.more_below` (更多→内容). Added (6): the four `region.label.*`, `session.back_to`,
`session.back_to_session`. Unchanged: 22. v2→v3 changed no existing value (read-back confirmed); v3 only
adds `back_to_session`. `fallback_name` was **not** revised (brief's possibility did not occur).

## 2. Round-1 adjudication (all 8 findings, against the v3 value)

| # | Round-1 finding | Decision | My reason (recounted) |
|---|---|---|---|
| A-MAJOR-1 | `context_short_estimate` identical to the wide form (17 cells) | **fixed on fit, side effect** | v3 `ctx{percent}%（约）` = 12 cells vs wide 17 — genuinely narrower, so the fit defect is gone. But the fix introduced MAJOR-1/MINOR-1 below; A's own 15-cell native suggestion (`上下文…（约）`) was not taken. |
| A-NIT-1 | redundant 你的 in `route_radient` | **fixed — upheld** | `通过Radient隧道` (15 cells); guide's pronoun economy; sibling shipped `mobile.settings.diagnostics.route_radient` = `Radient隧道`. Meaning intact. |
| A-NIT-2 | 位于 for a host name | **fixed — upheld** | `正在等待{host}上的电脑响应。` is the natural frame; both full stops retained; second sentence still states route≠machine-up. |
| A-NIT-3 | `not_signed_in` parity with shipped `已登录` | **declined — decline upheld** | Different line (account card name vs status chip); source names Radient; `账户` disambiguates from the connection state beside it. A itself called it optional. |
| B-MINOR-1 | add spaces around `{host}` / `{baseUrl}` | **declined — decline upheld** | `zh-CN.md` is binding: "No space inserted between Chinese text and Latin/digit runs". The spaced shipped strings (`正在连接 {host}…`) are pre-existing, out of slice. No link-detection evidence offered. |
| B-MINOR-2 | hard-coded English `REGION_LABEL` | **fixed in code, keys mis-named** | The code gap is genuinely closed (5fc0eeea now calls `t(...)`), and four label keys were supplied — but under names the code does not use (BLOCKER-1). |
| B-NIT-1 | `更多` bare → `内容` | **fixed — upheld** | `下方还有内容 · 向下滚动 ↓` reads naturally, same 25 cells / separator / arrow. |
| B-NIT-2 | `stream_degraded` reuses 未响应 | **declined — decline upheld** | Both notes describe the same condition ("open but not answering"); the relay's own term is 未响应 (`relay.chrome.session.subtitle.not_answering`, mobile and core). 响应异常 would assert a different condition. NIT only: the diagnostics enum collapses degraded onto the status phrase. |

Scores: 5 fixed, 3 declined, all three declines upheld. One fix (A-MAJOR-1) traded a fit defect for a
register/terminology defect.

## 3. New and changed values, judged fresh

- `session.back_to` `返回{name}` — with a real title: `返回发布计划` (12) / `返回Project Atlas` (17);
  `返回` is the shipped back verb (`mobile.common.back`, `mobile.oauth.return`, core `relay.session.*.back`).
  Grammatical; no case/article dependence. ✔
- `session.back_to_session` `返回会话` — complete phrase, reuses glossary `会话`; distinct from the shipped
  `返回会话列表` (that one is the list). The unnamed-parent path (`back-label.ts` @9d99fa0f) now renders
  this key, so the fallback name never reaches `back_to`; identity with `返回会话` would be harmless anyway. ✔
- `computers.added.connected_to` `已连接到{name}。` with `added.fallback_name` `你的电脑` →
  `已连接到你的电脑。` (18 cells); with a real name → `已连接到MacBook Pro。` / `已连接到New Mini。` Both
  grammatical (no agreement in zh). ✔
- `region.label.todos` `任务` / `strip` `状态` / `subagents` `子智能体` — shipped nouns (任务 9, 状态 9,
  子智能体 6 in mobile) and glossary-correct for subagent; cue reads `任务在下方 · 向下滚动 ↓`,
  three-label worst case `活动 · 任务 · 子智能体在下方 · 向下滚动 ↓` = 41 cells vs the English 42 (parity). ✔
  (`region.label.working` `活动` is MINOR-2 below.)
- `region.end` `已到底部 · 向上滚动 ↑` (21 vs en 14 — its own full-width line, en's sibling cue is 24, no
  fit risk); `region.below_labels` `{labels}在下方 · 向下滚动 ↓`; `region.more_below`
  `下方还有内容 · 向下滚动 ↓`. Middle dot with spaces (14 shipped in mobile, 129 in core), arrows kept and
  correctly oriented, `{labels}` byte-identical. ✔
- `video.title_fallback` `视频` (shipped `播放视频{name}`), `session.fallback_name` `会话` (bare noun fits
  header and back-to use), `account.app_name` `Local Operator` (byte-identical). ✔

**Narrow context forms — genuinely narrower? (cells, zh at a two-digit percent; CJK/full-width = 2)**

| key | v1 / v3 | cells | en |
|---|---|---|---|
| `tray.context` | 上下文21% | 9 | 11 |
| `tray.context_short` | v1 上下文21% → v3 ctx21% | 9 → **6** | 7 |
| `tray.context_estimate` | 上下文21%（估算） | 17 | 18 |
| `tray.context_short_estimate` | v1 上下文21%（估算） → v3 ctx21%（约） | 17 → **12** | 14 |

Read-out: the estimate narrow is genuinely narrower (−5) and lands under the 14-cell form that fixed D17
(call site `contextFact`, `viewportWidth < 340`); the plain narrow also got narrower (−3) but it had no
width problem to solve — 9 cells is 5 inside the proven-safe narrow envelope. Native alternative for the
estimate: `上下文{percent}%（约）` = 15 cells (between the proven-safe 14 and the measured-wrapping 18).

## 4. Mechanical pass (33 keys, executed)

```text
n_src 33 n_v3 33 order_equal True
missing [] extra []
placeholder/brace/empty/edge-ws issues []
all NFC True
ICU plural/select present []   bidi controls []   "..." []
en-identical ['mobile.settings.account.app_name']   (only Local Operator)
arrow/dot/% glyph parity vs en: none differing
```

Valid JSON; all 33 keys in exact source order; placeholder names identical per key to English
(`{baseUrl}`, `{host}`, `{percent}`×4, `{labels}`, `{name}`); no ICU arms needed (no plural/select in this
group); no empties; no manual bidi controls (n/a for zh, checked anyway); punctuation full-width inside
prose and half-width only inside placeholders, per guide.
Repo validator note (honest limit): the branch's `node scripts/i18n/generate.ts --check &&
node scripts/i18n/check-strings.ts` validates the **integrated** 649-key tree and cannot see this
unintegrated candidate; the python pass above is what covered it. I did not run the repo gate (and did
not touch the worktree).

## 5. Shipped-usage recount (ground truth for terminology)

`src/i18n/catalogues/zh-CN/*.json`, values only, `.context.json` excluded (including it reproduces the
translator's table exactly — e.g. 子智能体 39, 活动 12, 任务 33, 你的 35, 中继 5 in core):
电脑 49 strings/53 occurrences · 会话 46/49 · 上下文 2 · 未响应 1 (mobile) + 4 (core) · 空闲 1 ·
在线 1 · 视频 1 · 离线 0/3 · 任务 9 · 子智能体 6 · 活动 1 · 状态 8/9 · " · " 14 mobile / 129 core ·
**ctx 0 (both corpora)** · 约 0 mobile / 7 core (all the word "about": 约30秒) · 估算 0/6.
Binding strings: `relay.chrome.session.subtitle.not_answering` = `未响应` · `.idle` = `空闲` ·
`relay.health.live` = `在线` · `mobile.computers.badge.connecting` = `连接中` ·
`mobile.chrome.composer.row_usage` = `上下文` · `mobile.session.highlights.video_open` = `播放视频{name}` ·
`mobile.settings.account.signed_in` = `已登录` · `mobile.session.sheet_title.status` = `任务和智能体`.
Cross-locale datum for the `ctx` question: es/fr/vi kept Latin `ctx`, ru/hi abbreviate their own word,
ur used its own short word.

## 6. Focused checks required by the brief

- **'Not answering' pair**: `status.not_answering` and `diagnostics.stream_degraded` both `未响应` — same
  condition, same term as the relay's own chrome subtitle. Correct; the collapsed enum is a NIT, not a defect.
- **`no_connection` vs `offline` distinctness**: `尚未连接` (nothing chosen yet, 8) / `未连接` (refused, 6) /
  `离线` (stream down, 4) — three distinct states, the 尚 carrying the "yet". ✔
- **Terse-label safety**: every short string in this group is descriptive state (未登录/尚未连接/未连接/
  离线/未响应/空闲/连接中/在线/已连接). None reads as an instruction, permission or destructive promise; no
  string could be misread as "safe to disconnect". ✔
- **Second independent pass** (high-visibility: settings + computers + tray): re-read all 16 settings/
  computers/tray keys against their English and sidecars after the first pass. **No new finding** — the
  only defects in this lane are the ones below, all in the narrow-form and region-label additions.

## 7. Findings

### BLOCKER-1 — four label keys are named differently from the code and the shipped catalogue (keyset, manager-owned)

- Current keys in keys33/v3: `mobile.session.region.label.working` / `.label.subagents` / `.label.todos` /
  `.label.strip` (values `活动` / `子智能体` / `任务` / `状态`).
- Problem (verified here): the wiring branch `feat/i18n-app-scan-expression-literals` @ `9d99fa0f` declares
  and consumes `mobile.session.region.label_working`, `…label_subagents`, `…label_todos`, `…label_strip`
  — `app/(app)/session/[id].tsx:1099-1104` calls `t("mobile.session.region.label_working")` etc.,
  `src/i18n/catalogue.gen.ts:382-385` lists the underscore names, and
  `src/i18n/catalogues/en/mobile.session.json:58-61` keys them the same way. The branch's
  `zh-CN/mobile.session.json` still carries the English values for the underscore names, so integrating
  v3 as-is matches nothing and the zh cue keeps rendering "activity · tasks below · scroll ↓".
  All other 29 keys are byte-identical in English between keys33 and the branch catalogues (diff run here:
  `english text differs: []`), so this drift is confined to these four names.
- Suggested: rename the four candidate keys to the underscore form (values unchanged), or rename the code
  and the en catalogue — the first is one line per key and needs no new translation.

### MAJOR-1 — `mobile.session.tray.context_short` — unnecessary Latin abbreviation in place of the settled word

- Current: `ctx{percent}%` · English: `{percent}% ctx` (narrow) · wide zh sibling: `上下文{percent}%`
- Problem: the narrow branch exists for the estimate fact, which wrapped at 18 cells (D17). The plain fact
  is 9 cells in zh — five inside the 14-cell narrow form that is known to fit — so nothing here needs
  shortening, and Chinese has a settled two-character word (shipped `mobile.chrome.composer.row_usage` =
  `上下文`). The sidecar's own instruction is "use the language's own short form or the full word if none
  exists": zh has no own short form, so the full word is the prescribed outcome. `ctx` has 0 occurrences in
  either shipped corpus and is not on the guide's kept-English list; the glossary entry proposed for it is
  unapproved. A Chinese reader meeting `ctx21%` in an otherwise fully Chinese band is decoding an English
  developer abbreviation for no gain, and the Latin token touching the digits parses as one token.
- Suggested: `上下文{percent}%` (9 cells; identical to the wide form, which round 1 A explicitly accepted as
  the note-covered outcome for this key).

### MINOR-1 — `mobile.session.tray.context_short_estimate` — width-driven, but leaves the pair incoherent

- Current: `ctx{percent}%（约）` (12) · wide `上下文{percent}%（估算）` (17) · English `{percent}% ctx (est.)`
- Problem: the narrowing itself is right (−5 cells) and es/fr/vi keep `ctx` too, so this is not the same
  defect as MAJOR-1. Three residues: (a) the band's word flips `上下文`→`ctx` at the same width when the
  estimate marker appears (source also flips context→ctx, so acceptable if deliberate); (b) `约` vs the
  wide `估算` are two markers for one concept ("est." in both); (c) `（约）` has no shipped precedent (core's
  约 is the word "about", 约30秒).
- Suggested: if MAJOR-1 is reverted to `上下文{percent}%`, try `上下文{percent}%（约）` (15 cells) and settle
  it with one rendered <340 pt frame; if that frame wraps, keep `ctx{percent}%（约）` and record the `ctx`
  exception (narrow band only) in the ledger/style guide so it stops being an unapproved proposal.

### MINOR-2 — `region.label.working` — `活动` has no shipped "activity" sense and can read as "event"

- Current: `活动` (cue: `活动在下方 · 向下滚动 ↓`) · English `activity`
- Problem: recounted — mobile's single `活动` is `未处于活动状态` (="active") and core's 12 are `活动会话` /
  `活动状态` ("active sessions"), so the shipped sense of 活动 is *active*, not *activity*. As a bare noun
  before 在下方 it can also parse as "event/campaign". The band's own row word is `工作中`
  (`relay.chrome.session.subtitle.working`), which is not a noun and cannot carry 在下方.
- Suggested: `动态` (cue `动态在下方 · 向下滚动 ↓`), which is the native noun for an activity feed; keeping
  `活动` is defensible but then the panel title and the cue name the same band differently.

### NIT-1 — sidecar note for `mobile.session.fallback_name` is now stale (source, not candidate)

- keys33: "Lower-case noun used as the header title of an untitled session **and in "Back to <name>" when
  the conversation has no name**"; after `9d99fa0f` the unnamed parent renders `back_to_session` instead
  (`src/features/session/back-label.ts`). Value `会话` is right for both uses — note fix only, for the next
  sidecar revision.

### NIT-2 — if `ctx` is kept, prefer the source's number-first order

- Current: `ctx21%` / `ctx21%（约）`. `{percent}% ctx` keeps the number first (as the source and es/fr/vi do)
  and separates the Latin token from the digits with `%`, which removes the "ctx21" tokenising ambiguity.
  Optional while MAJOR-1 is under discussion.

## 8. Independent second pass

Requested for high-visibility groups (settings/errors). After the key-by-key pass I re-read all 16
settings/computers/tray keys cold against their English and sidecars: no additional finding. Nothing in
this lane misstates meaning, polarity, safety, placeholder or punctuation; the defects are the five above,
all confined to the narrow-form and region-label additions.

## 9. Limits

- No rendering: no device, simulator or RN web view was used. Cell counts are arithmetic (CJK/full-width =
  2 per the guide), not captured frames; the 14-cell fits / 18-cell wraps anchors come from the D17
  comment, not from my own measurement. A `< 340 pt` still would settle MINOR-1.
- No `maxCells`/`maxChars` hints exist for any of these 33 keys in keys33 (checked programmatically), so
  "fit" is judged against the call-site layout only.
- I did not run the repo's catalogue validator (it cannot see an unintegrated candidate) and did not touch
  the worktree, repo, ledger or candidate.

## 10. Ledger / evidence note (not executed — slice brief forbids repo and ledger edits)

No `i18n/ledger.json` row and no tracked evidence bundle were written by me. Suggested row for the
manager to record once the candidate is integrated (values per the retention contract): `locale` zh-CN,
`namespace` `m2-expression-literals` (mobile session/settings/computers file group), `audit_date`
2026-11-11, `key_count` 33, `auditor` = `i18n-auditor` / session `ab999e693853` /
`deepseek/deepseek-flash` / `independent_from_translator_session: true` /
`actual_model_source: session header`, `input_hashes` = the three row above (en `keys33.json`, context
`keys33.json`, target `zh-CN.v3.json`), `current_report_verdict` = `changes_requested`,
`unresolved_blocker_major_count` = 2, finding ids `BLOCKER-1, MAJOR-1, MINOR-1, MINOR-2, NIT-1, NIT-2`,
`note` referencing this report's tracked path. Findings are in this report; nothing else was executed.
