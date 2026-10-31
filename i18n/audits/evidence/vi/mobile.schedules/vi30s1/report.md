# Vietnamese audit — `mobile.schedules` (group B)

- **Audit ID:** `vi30s1`
- **Locale / namespace:** `vi` / `mobile.schedules` (38 keys)
- **Date:** 2026-10-30
- **Audited head:** `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` on `feat/i18n-vietnamese`
- **Worktree:** `/Users/damian/workspace/vi-wave`
- **Auditor:** `i18n-auditor` (lopdev team), session `0156ce9c9f5e`, model `radient/auto`
- **Independence:** different agent/session from the translator; not the author of these bytes. No human native-speaker review is claimed. Second independent reading pass: reviewer subagent, job `4ac043e37ef7`, model `radient/auto` (disclosed fallback chain in its report).
- **Verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT.

The `vi` catalogue is an **untracked working-tree directory** at this head. The audited bytes are identified by the SHA-256 in `record.json`, not by a commit. This audit wrote only its evidence bundle; no catalogue byte was edited, and nothing was committed.

## Inputs

| Role | Path | SHA-256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/mobile.schedules.json` | `0459a0485ceb2594c60a152a8dbdc5035689ade05ac370134f8e37be6abc575f` |
| Context / role notes | `src/i18n/catalogues/en/mobile.schedules.context.json` | `d3f0d3bba057aacf4d3495b3d5eec2471d66b6d6c011b50834a1f58a0839aa92` |
| Vietnamese target | `src/i18n/catalogues/vi/mobile.schedules.json` | `2981717fd7638c1e7c5c9175bd59b6c742502e24c3c8959920802cfc7b5154f8` |

## Mechanical

- **Repo validator:** `node scripts/i18n/generate.ts --check` → exit 0, `src/i18n/catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr, ru, zh-CN)`. This covers key parity (38/38), message parse validity, placeholder names and placeholder kinds.
- **Repo gate:** `node scripts/i18n/check-strings.ts` → exit 0, `284 finding(s), all baselined; 0 new; no growth vs 31f2ae46f45d`.
- **Structural verifier** (`verify.mts`, run at this head): 77 group-B keys, **0 problems**. For this namespace: 4 plural nodes and 1 select node; every select arm identical to English at every node; every plural node carries exactly `other` (vi CLDR categories = `["other"]`); every select arm keeps its twin's placeholders; all 38 strings are NFC precomposed (zero combining marks); no key added or dropped; key order identical to English; tabs, trailing newline, no BOM/CRLF.
- **Negative controls** (scratch copy; restored after each; full transcript in `audit.log`):
  - dropping `{total}` from `mobile.projects.milestones.count` → repo validator **fails** (missing parameter) and the verifier **fails** — the placeholder gate works;
  - removing the `milestone` arm from `mobile.projects.write_receipt` → repo validator **passes**, verifier **fails** (`missing arm …/select,milestone`) — the repo gate does **not** compare select arms, so the verifier's check is load-bearing;
  - adding a `one` arm to `mobile.schedules.count.wakes` → repo validator **passes**, verifier **fails** (`unreachable plural arms [one,other]`) — the repo gate does not police unreachable arms;
  - writing `mốc` as `o` + combining circumflex + acute → repo validator **passes**, verifier **fails** (`not NFC-normalized`) — the style guide's NFC rule has no repo gate today.

These four controls are real executions, not notes; `audit.log` records the commands and exits. The last three are **process gaps**, not defects of this catalogue.

## Rendered evidence (production renderer and production copy module)

The harness imports the real `src/i18n/messages.ts` parser/formatter and the real `src/features/schedules/schedules-copy.ts` clause functions. Because `vi` is still in `NOT_YET_SHIPPED_LOCALES` at this head (`t()` would render English), the harness runs a **byte-identical scratch copy** whose only edit is the harness flip of `vi` into `SHIPPED_LOCALES`; all catalogue hashes are unchanged. The diff is in `audit.log`. This is the same technique the round-1 Russian audit recorded.

Exact sentences:

| State | Command | ACTUAL rendered string |
|---|---|---|
| future due, 3 wakes | `nextDueClause(wakeCountClause(3), 240)` | `3 lần thức dậy · lần tới sau 4m` |
| future due, 1 wake | `nextDueClause(wakeCountClause(1), 240)` | `1 lần thức dậy · lần tới sau 4m` |
| overdue, 3 wakes | `nextDueClause(wakeCountClause(3), -7200)` | `3 lần thức dậy · trễ 2h` |
| overdue, 1 wake | `nextDueClause(wakeCountClause(1), -60)` | `1 lần thức dậy · trễ 60s` |
| paused (parked) | `parkedWakesClause()` | `Tạm gác — các lần thức dậy tiếp tục sau lượt tiếp theo của cuộc trò chuyện` |
| paused monitors | `parkedMonitorsClause()` | `Tạm gác — giám sát tiếp tục khi cuộc trò chuyện của nó chạy lại` |
| truncated, wakes 10/42 | `truncatedClause("wakes", 10, 42)` | `Đang hiện 10 trên 42 cuộc trò chuyện có lần thức dậy.` |
| truncated, monitors 1/2 | `truncatedClause("monitors", 1, 2)` | `Đang hiện 1 trên 2 cuộc trò chuyện có giám sát.` |
| truncated, wakes 3/4 | `truncatedClause("wakes", 3, 4)` | `Đang hiện 3 trên 4 cuộc trò chuyện có lần thức dậy.` |
| section splice, 3 wake rows | `Wakes · ${wakeSectionSummary(3 rows)}` (exactly `schedules.tsx:214`) | `Wakes · 3 đã lên lịch` |
| section splice, monitors healthy | `Monitors · ${monitorSectionSummary(2 rows)}` (`schedules.tsx:280`) | `Monitors · 2 đang bật` |
| section splice, 1 of 5 alerting | `Monitors · ${monitorSectionSummary(5 rows, 1 alerting)}` | `Monitors · 1 trên 5 cần chú ý` |
| empty (both families) | `t("mobile.schedules.empty.body")` | `Nhờ tác nhân trong cuộc trò chuyện làm một việc theo định kỳ, việc đó sẽ hiện ở đây. Lần thức dậy đẩy một prompt vào cuộc trò chuyện vào thời điểm đã hẹn; giám sát theo dõi một thứ và báo khi có thay đổi.` |

**Judgement of the counter splice.** The Vietnamese fragments read correctly after the English head words: `3 đã lên lịch` is a normal Vietnamese count label ("3 scheduled"), `2 đang bật` reads "2 are on", and `1 trên 5 cần chú ý` reads "1 of 5 need attention". The one caveat is not the fragment but the head word: `Wakes`/`Monitors` are **hardcoded English** at `schedules.tsx:214` and `:280` (and `title="Schedules"` at `:163`, `label="Back"` at `:168`, `label="Try again"` at `:194`), so the painted header is half-English (`SectionHeader` uppercases it to `WAKES · 3 ĐÃ LÊN LỊCH`). No catalogue string can fix that; it is a pre-existing code-side gap, identical in the shipped fr/es/ru/zh waves (verified at `a57fb8c`), and belongs in a follow-up that keys the two headings and the three controls. It is **not** a finding against this catalogue.

The zero-row monitor state (wakes present, monitors empty) paints `Monitors · 0 đang bật` above `Chưa bật giám sát nào.` — the same shape as English `Monitors · 0 armed` above `No monitors armed.`; the redundancy is source-shaped, not translation-shaped.

## Findings

### VI-B-S1 — MINOR — `mobile.schedules.empty.body`

- **Current:** `Nhờ tác nhân trong cuộc trò chuyện làm một việc theo định kỳ, việc đó sẽ hiện ở đây. Lần thức dậy đẩy một prompt vào cuộc trò chuyện vào thời điểm đã hẹn; giám sát theo dõi một thứ và báo khi có thay đổi.`
- **Problem:** the second sentence has three blemishes that a native editor would remove together. (1) `báo khi có thay đổi` renders "reports **when** there is a change" where the source promises "report **what** changes" — the monitor's report content is omitted. (2) `đẩy … vào cuộc trò chuyện vào thời điểm` stacks `vào` twice and uses `đẩy` ("push") as a calque of "fire"; `gửi … đúng thời điểm` is the settled collocation. (3) `giám sát theo dõi` can be parsed as a verb chain ("supervise, track") because the noun and verb are homographs; `mỗi giám sát` anchors the noun and states the distributive meaning.
- **Suggested wording (exact replacement):** `Nhờ tác nhân trong cuộc trò chuyện làm một việc theo định kỳ, việc đó sẽ hiện ở đây. Lần thức dậy gửi một prompt vào cuộc trò chuyện đúng thời điểm đã hẹn; mỗi giám sát theo dõi một thứ và báo lại những gì thay đổi.`
- **Why MINOR, not MAJOR:** the current sentence is grammatical, keeps every claim, and reads as Vietnamese; the loss is precision ("when" vs "what") and polish, not a wrong or unsafe instruction.

### VI-B-S2 — NIT — `mobile.schedules.head.next`

- **Current:** `{head} · lần tới {label}` → `3 lần thức dậy · lần tới sau 4m`.
- **Problem:** `{label}` already begins with the future marker (`due.ahead` = `sau 4m`), so the splice carries two future markers. The sibling `head.overdue` reads cleanly (`· trễ 2h`).
- **Suggested wording (exact replacement):** `{head} · {label}` → `3 lần thức dậy · sau 4m`. The relative label already distinguishes future (`sau`) from overdue (`trễ`), which is the distinction the source keeps.

### VI-B-S3 — NIT — `mobile.schedules.show_less.wakes` and `mobile.schedules.show_less.monitors`

- **Current:** `Hiện ít lần thức dậy hơn` / `Hiện ít giám sát hơn`.
- **Problem:** word-for-word mirror of "Show fewer wakes / monitors"; `Hiện ít … hơn` reads as "show less" and the pair is asymmetric with `Hiện thêm N …` (the expand side). The control's job is to collapse the extra rows.
- **Suggested wording (exact replacements):** `Ẩn bớt lần thức dậy` / `Ẩn bớt giám sát` (or `Thu gọn` if the design prefers a collapse verb). The current wording is understandable; this is polish, not a defect.

## Every key in the group (accuracy / idiom / fit)

| Key | Vietnamese | Verdict |
|---|---|---|
| `mobile.schedules.cadence.every` | `mỗi {duration}` | pass — matches `tui.schedule.cadence_every` in core |
| `mobile.schedules.cadence.left` | `{cadence} · còn {remaining}` | pass — "còn 3" is the terse counterpart of "3 left" |
| `mobile.schedules.cadence.once` | `không lặp` | pass — byte-identical to core `tui.schedule.cadence_once` |
| `mobile.schedules.cadence.spent` | `{cadence} · không còn lượt gửi` | pass — names the spent budget, not "0 left" |
| `mobile.schedules.count.monitors` | `{count, plural, other {# giám sát}}` | pass — `other` only; core's monitor object |
| `mobile.schedules.count.wakes` | `{count, plural, other {# lần thức dậy}}` | pass — core's wake term |
| `mobile.schedules.due.ahead` | `sau {label}` | pass — byte-identical to core `due_in` |
| `mobile.schedules.due.overdue` | `trễ {label}` | pass — byte-identical to core `due_overdue` |
| `mobile.schedules.empty.body` | see VI-B-S1 | **MINOR** |
| `mobile.schedules.empty.title` | `Chưa có gì được bật` | pass — matches the app's on/off vocabulary (`value_on` = `bật`) |
| `mobile.schedules.empty_line.monitors` | `Chưa bật giám sát nào.` | pass |
| `mobile.schedules.empty_line.wakes` | `Chưa lên lịch lần thức dậy nào.` | pass |
| `mobile.schedules.gone.monitors` | `Đã mất — … không còn gì kiểm tra` | pass — distinct from parked, as the note requires |
| `mobile.schedules.gone.wakes` | `Đã mất — … không còn gì kích hoạt` | pass |
| `mobile.schedules.head.next` | `{head} · lần tới {label}` | **NIT** |
| `mobile.schedules.head.overdue` | `{head} · {label}` | pass — no forward-looking word, as the note requires |
| `mobile.schedules.parked.monitors` | `Tạm gác — giám sát tiếp tục khi cuộc trò chuyện của nó chạy lại` | pass — says *runs again*, not "open it" |
| `mobile.schedules.parked.wakes` | `Tạm gác — các lần thức dậy tiếp tục sau lượt tiếp theo của cuộc trò chuyện` | pass — says *next turn* |
| `mobile.schedules.read_error.monitors` | `Không đọc được các giám sát trên máy này.` | pass — names the family, cannot read as empty |
| `mobile.schedules.read_error.wakes` | `Không đọc được các lần thức dậy trên máy này.` | pass |
| `mobile.schedules.read_unreachable` | `Vừa rồi không đọc được lịch trên máy này.` | pass |
| `mobile.schedules.show_less.monitors` | `Hiện ít giám sát hơn` | **NIT** |
| `mobile.schedules.show_less.wakes` | `Hiện ít lần thức dậy hơn` | **NIT** |
| `mobile.schedules.show_more.monitors` | `{hidden, plural, other {Hiện thêm # giám sát}}` | pass |
| `mobile.schedules.show_more.wakes` | `{hidden, plural, other {Hiện thêm # lần thức dậy}}` | pass |
| `mobile.schedules.state.disabled` | `đã tắt` | pass — state, not an instruction; lower case |
| `mobile.schedules.state.dormant` | `tạm nghỉ` | pass — distinct from parked `Tạm gác` |
| `mobile.schedules.state.expired` | `hết hạn` | pass |
| `mobile.schedules.state.stale` | `cũ` | pass — core `tui.review.lane_stale` = `cũ` |
| `mobile.schedules.state.waiting` | `đang chờ` | pass |
| `mobile.schedules.summary.monitors_armed` | `{count} đang bật` | pass — "armed" as switched on; matches `value_on`; the attention counter prevents contradiction with a disabled row |
| `mobile.schedules.summary.monitors_attention` | `{broken} trên {total} cần chú ý` | pass |
| `mobile.schedules.summary.wakes` | `{count} đã lên lịch` | pass — core `status_scheduled` = `đã lên lịch` |
| `mobile.schedules.supervisor.not_running` | `Bộ giám sát các lần thức dậy đã được cài nhưng không hoạt động, nên … sẽ không chạy.` | pass — `bộ giám sát` is the supervisor, not the monitor object |
| `mobile.schedules.supervisor.unsupported` | `Nền tảng này chưa giám sát … chỉ chạy khi cuộc trò chuyện đang chạy.` | pass |
| `mobile.schedules.supervisor.unverifiable` | `Không có gì giám sát … nên chúng chỉ chạy khi … đang chạy.` | pass — does not claim "not running" |
| `mobile.schedules.tail.failed` | `{count} thất bại` | pass |
| `mobile.schedules.truncated` | `Đang hiện {shown} trên {total} cuộc trò chuyện có {family, select, wakes {lần thức dậy} other {giám sát}}.` | pass — select arms `wakes`/`other` intact |


## Terminology / glossary against core's committed Vietnamese

Counts in this namespace: `mốc` 0 (all 6 group-B occurrences are in projects), `bộ giám sát` 1 (supervisor, `not_running`), `giám sát` 11 total = 8 monitor-object noun uses + 1 inside `bộ giám sát` + 2 verb uses (`chưa giám sát`, `không có gì giám sát`), `lần thức dậy` 13 (12 lower-case + the sentence-initial `Lần` in `empty.body`). Core's committed vi: `bộ giám sát` 1 (`tui.schedule.notice_supervisor`), `giám sát` 13 across the supervisor, monitor-object and verb senses, `lần thức dậy` 17. **Divergences: 0.** The `giám sát` / `bộ giám sát` split is the one the glossary records in §2 note 7 and core already ships.

## Fit / width

No `maxCells`/`maxChars` field exists on this namespace's sidecars, so the numeric check is against the rendered slot, not a sidecar. Plain-text code points: mean vi/en 1.12 for group B; this namespace's longest are `empty.body` 204 vs 181 (1.13), `supervisor.not_running` 108 vs 83 (1.30), `supervisor.unverifiable` 107 vs 90 (1.19). These are `Alert`/body texts that wrap (no `numberOfLines` clamp on the entry clause or on `Button.labelLines`), and no word reaches 18 characters (`typography.txt`). Every badge and state word is shorter than or equal to its English counterpart. No overflow risk found.

## What I could not verify

- **No rendered frame.** This session has no `browser` tool and no simulator capture; width claims are code-point/line-count reasoning against the components' clamps, not pixels or font metrics.
- **No human native-speaker review.** The second pass is another LLM agent, not a person. Independence is by agent/session; model diversity is not claimed (both passes ended on `radient/auto`).
- **`t()` on the real branch still renders English** for `vi` because `locale.ts` still lists `vi` in `NOT_YET_SHIPPED_LOCALES`. That is the intended pre-ship state (docs/i18n.md: only a passing audit may flip the shipped set); the rendered evidence uses the byte-identical scratch copy described above.
- **Hardcoded screen strings** (`Schedules`, `Back`, `Try again`, `Wakes`, `Monitors`) are outside the catalogue and outside this audit's file group; they are named here because the brief asks about the splice, and they need a code-side follow-up.
