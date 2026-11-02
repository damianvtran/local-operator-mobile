# vi / mobile.home — independent audit (vi30a1)

- **Locale:** `vi` · **Namespace:** `mobile.home` · **Keys:** 27 (27 source, 27 context notes)
- **Audited:** 2026-10-30 at branch `feat/i18n-vietnamese`, HEAD `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` (the vi directory is untracked at this head; its bytes are pinned by the hash below)
- **Auditor:** i18n-auditor (lopdev team), session `8bfd6a5224bd`, **actual model `radient/auto`** — fallback chain anthropic/claude-sonnet-5-5, openai/gpt-6-astra, kimi/k3.1-pro, radient/auto disclosed in `record.json`
- **Independence:** Different agent, different session and different context from the translator. Not model-diverse: the served model radient/auto is the translator's served model too; disclosed, not closed. No human native-speaker review and no rendered frame are claimed.
- **Inputs:** `src/i18n/catalogues/en/mobile.home.json` `4ebba126f106bada…` · `src/i18n/catalogues/en/mobile.home.context.json` `db18b25dd2099a95…` · `src/i18n/catalogues/vi/mobile.home.json` `023141681a91d49b…`
- **Verdict:** **2 MAJOR, 4 MINOR — one meaning narrowing, one measured row overflow, one wrap-with-widow, one verb-consistency, one clipped noun, one core-term drift**

mobile.home is the first screen and the only namespace here with real defects. Two block a `passed` verdict: the sentence that redirects the reader to the live controls says they are only there to LOOK at (H-01), and the longest tip overflows the one-line row by 8.6 pt at 320 pt with its tail clipped (H-02). The other four are polish with measured replacements, and the last two come from the blind second pass.

## Method

Everything below was executed, not inferred; the raw output is `audit.log` beside this report.

- `npm run -s i18n:check` → exit 0 (generated projection current; strings ratchet unchanged).
- The repository's own parser and renderer (`src/i18n/messages.ts`, `src/i18n/runtime.ts`) imported from the worktree and driven per key:
  placeholder surfaces compared on both sides, ICU arms compared, every value rendered and round-tripped.
- `renderFor(key, {}, "vi")` answers the **English source** at this head, because `vi` is still in `NOT_YET_SHIPPED_LOCALES`;
  the vi bytes were therefore read through the same `formatMessage(parseMessage(text), params, "vi")` pair `renderFor` calls
  once it has a localized string. The fallback itself is logged as an observed control, not assumed.
- Unicode and typography swept per value: NFC, combining marks, spacing, edge whitespace, ellipsis form, quotes, bidi controls.
- Widths measured with CoreText/AppKit (system font) at the app's token sizes against the boxes read from `home-splash.tsx`/`home-copy.ts` at 320 pt.
- Negative controls run for every detector (a renamed placeholder, a plural with no `other` arm, decomposed diacritics, a double space,
  an unterminated plural, an over-wide filler): all fired. ICU's `other` fallback was verified separately so that a missing-arm control
  cannot be confused with correct ICU behaviour.

## Findings

| ID | Severity | Key | Suggested wording |
|---|---|---|---|
| H-01 | MAJOR | `mobile.home.options.fixed` | Tùy chọn khởi đầu của cuộc trò chuyện này đã cố định. Mở Chi tiết cuộc trò chuyện để dùng các điều khiển trực tiếp. |
| H-02 | MAJOR | `mobile.home.tip.parallel` | yêu cầu chạy song song để tách tác nhân con |
| H-03 | MINOR | `mobile.home.greeting` | Hôm nay tôi có thể giúp gì? |
| H-04 | MINOR | `mobile.home.starting / mobile.home.startup_queue.unconfirmed` | Đang bắt đầu… · Chưa xác nhận bắt đầu |
| H-05 | MINOR | `mobile.home.suggestion.wake_summary` | Đánh thức tôi kèm bản tóm tắt |
| H-06 | MINOR | `mobile.home.suggestion.review_repo` | Rà soát repo này |

### H-01 — MAJOR — `mobile.home.options.fixed`

- **Current:** Tùy chọn khởi đầu của cuộc trò chuyện này đã cố định. Dùng Chi tiết cuộc trò chuyện để xem các điều khiển trực tiếp.
- **Problem:** “để xem các điều khiển trực tiếp” narrows the destination to VIEWING the live controls. The English says the sentence exists to send the reader to the controls that are still live — the one action left once the starting options are fixed. `xem` turns the redirect into a read-only pointer, on the exact sentence that has to carry the action.
- **Exact replacement:** Tùy chọn khởi đầu của cuộc trò chuyện này đã cố định. Mở Chi tiết cuộc trò chuyện để dùng các điều khiển trực tiếp.
- **Evidence:** English source + context note ('Explains why the starting options are read-only once the conversation has started'). Replacement keeps the reader's path and the title `Chi tiết cuộc trò chuyện`, which must match mobile.session.conversation_details.

### H-02 — MAJOR — `mobile.home.tip.parallel`

- **Current:** yêu cầu chạy song song để tách ra tác nhân con
- **Problem:** Overflows the one-line tip row at the narrowest supported phone. Measured 278.6 pt of text at meta 12/500; the row at 320 pt is 288 pt, and the row's own Info icon (12 pt) plus its gap (6 pt) leave a 270 pt text box. Content is 296.6 pt against 288 pt — 8.6 pt over. The row is content-sized, single-line (numberOfLines={1}) and centred in the column, so the overflow is cut at both viewport edges rather than wrapping. English's widest tip is 268.9 pt, inside the 270 pt slot. The 48-character TIP_CHAR_BUDGET at 46 characters passes while the line does not fit: characters are not a width budget in Vietnamese.
- **Exact replacement:** yêu cầu chạy song song để tách tác nhân con
- **Evidence:** CoreText/AppKit measurement, system font: current 278.6 pt; replacement 263.7 pt (fits the 270 pt text box with 6.3 pt headroom); 43 characters. Only `ra` is removed; meaning and the pool's lower-case fragment register are unchanged.

### H-03 — MINOR — `mobile.home.greeting`

- **Current:** Hôm nay tôi có thể giúp gì cho bạn?
- **Problem:** Wraps at 320 pt where English holds one line, and leaves a one-word widow. Measured 315.8 pt at title 20/600 against 288 pt of content width; the break lands after “cho” (267.8 pt), so line 2 is only “bạn?” (43.7 pt) — a dangling pronoun with the question mark. English is 281.9 pt and stays on one line. The extra line also costs the splash 26 pt, which is the row the tip occupies at the bottom of the yield order.
- **Exact replacement:** Hôm nay tôi có thể giúp gì?
- **Evidence:** Measured 240.2 pt, one line. Drops the pronoun the style guide tells the translator to drop (“Vietnamese drops pronouns: do not write bạn in every string”). If the explicit addressee matters more than “today”, the alternative “Tôi có thể giúp gì cho bạn?” measures 235.8 pt and drops “Hôm nay” instead.

### H-04 — MINOR — `mobile.home.starting / mobile.home.startup_queue.unconfirmed`

- **Current:** Đang khởi động… · Chưa xác nhận khởi động
- **Problem:** One English verb (start) is rendered with two Vietnamese ones on the same screen: `khởi động` here and in `startup_queue.unconfirmed`, but `bắt đầu` in `startup_queue.not_started` (“Chưa bắt đầu”), which sits in the same row family. `khởi động` also reads first as a machine or app booting, while this state is the first send's conversation starting.
- **Exact replacement:** Đang bắt đầu… · Chưa xác nhận bắt đầu
- **Evidence:** Measured: 136.2 pt (was 157.3) for `starting`, 148.6 pt (was 163.6) for `unconfirmed` — both inside one 288 pt line. `Tùy chọn khởi đầu` in options.fixed is the noun “initial”, a different sense, and is left alone.

### H-05 — MINOR — `mobile.home.suggestion.wake_summary`

- **Current:** Đánh thức tôi kèm tóm tắt
- **Problem:** `kèm tóm tắt` attaches a bare verb-noun to a preposition that wants a noun phrase; the classifier `bản` is what makes it read as “a summary”. As written the chip reads slightly clipped, like a truncated list item rather than a request.
- **Exact replacement:** Đánh thức tôi kèm bản tóm tắt
- **Evidence:** Measured 212.8 pt in the 256 pt chip box (current 182.6 pt; English 180.0 pt), so the longer wording costs no fit. 27 characters — the measured `vi` chip budget the wave must add has to be at least 27, not English's 24.

### H-06 — MINOR — `mobile.home.suggestion.review_repo`

- **Current:** Đánh giá repo này
- **Problem:** Core's committed Vietnamese for the code-review feature is `rà soát` (10 values in `tui.review.*`: `rà soát mã`, `chờ rà soát lại`, `đã rà soát …`), so `đánh giá` names the same feature with a second word once this client ships. It also puts two chips on the same visible first word (`Đánh giá …` and `Đánh thức …`), which is the scannability the pool's leading-verb rule exists to protect.
- **Exact replacement:** Rà soát repo này
- **Evidence:** Measured 117.5 pt in the 256 pt chip box (current 127.2 pt). `rà soát` is core's own term for the review feature; `repo` stays Latin as the context note requires.

## Considered and accepted

- wake → thức dậy is respected in noun contexts, and the transitive `đánh thức` in the chip matches core's own committed use (`wire.settings.team_bridge_session.help`: “Phiên có thể được đánh thức…”). The style guide's warning is about the feature word, not about this sentence's grammar.
- `dòng làm việc` (working line), `tác vụ` (task), `Bỏ` (discard), `hàng đợi` (queue) and `bản nháp` (draft) are core's committed renderings, checked against core vi (`wire.settings.display_shimmer.*`, `relay.transcript.fold.unit`, `tui.authoring.discard`, `relay.asks.status.queued`, `tui.review.state_draft`).
- `máy chủ chuyển tiếp` in account_routing is core's own rendering of the identical sentence — see that namespace's report.
- Chip leading verbs are distinct (Xem / Thiết lập / Bật / Đánh giá / Tạo / Đánh thức), satisfying the pool's “no two entries share a leading verb” rule. `Đánh giá` and `Đánh thức` share a first syllable, not a verb; no change proposed.
- The translator's own flag — wake_summary at 25 characters against English's 24 — is real but harmless in width: 182.6 pt against 180.0 pt in a 256 pt box.
- `kèm`+noun, `vừa rồi` (just now) and the `Hãy` + bare-verb error/status split are consistent across the four namespaces and match the terse dev voice.

## Limits

- No native-speaker review and no rendered frame: the fit claims are measured text advances, not screenshots.
- The translator's run was not observed; its identity is as supplied by the requesting manager.
- Branch state: At this head src/i18n/catalogues/vi/ is untracked and vi sits in NOT_YET_SHIPPED_LOCALES, so `npx vitest run src/i18n src/features/home` fails exactly one assertion — catalogues.test.ts 'ships no locale the runtime cannot render' expects the catalogue directories to equal SHIPPED_LOCALES. That is the guard working as designed; it clears when the wave flips the shipped set after every audit passes. Shipping vi also requires a measured `vi` entry in SUGGESTION_CHAR_BUDGET (Record<ShippedLocale, number>) and removal of vi from NOT_YET_SHIPPED_LOCALES. `npx tsc --noEmit` exits 0 at this head.


## Appendix — terminology against core's committed Vietnamese

Counted over core's committed vi catalogues at `origin/main` (0f8e3d101116b40252b4c6eea8ac4f6c6980b73b) — 1947 values — and over this
wave's 143 values. A divergence is a group-A English value that also exists in core with a different Vietnamese value.

| Term | core vi values | wave vi values | group-A keys using it |
|---|---|---|---|
| tài khoản | 18 | 6 | account_routing.disconnected, account_routing.load_error, account_routing.loading, account_routing.title, account_routing.unavailable |
| máy tính | 22 | 19 | account_routing.disconnected, account_routing.rejected, account_routing.saved, account_routing.scope, account_routing.unavailable, home.connect_disabled_reason, home.folders_read_failed, home.options.folder, home.refused_start_fallback, session_health.resume_no_route |
| phiên | 134 | 16 | home.tip.search, session_health.menu_hint, session_health.menu_label, session_health.menu_title, session_health.resume_gone, session_health.resume_no_route, session_health.resume_refused, session_health.still_reopening |
| cuộc trò chuyện | 103 | 17 | home.options.fixed, home.options.title, home.tip.search, home.transcript.waiting, session.conversation_details |
| mốc | 18 | 5 | — |
| giám sát | 13 | 11 | — |
| bộ giám sát | 1 | 1 | — |
| định tuyến tài khoản | 3 | 5 | account_routing.disconnected, account_routing.load_error, account_routing.loading, account_routing.title, account_routing.unavailable |
| lần thức dậy | 17 | 11 | — |

**Divergence: 0 of 11.** 11 group-A English values are byte-identical to core's English and **11** carry
its exact Vietnamese. The remaining values have no core counterpart.

Two things that a glossary-only reading could flag as violations are core's own usage and are recorded as accepted, not fixed:
`dòng làm việc` for "working line" (core's own `wire.settings.display_shimmer.*`) and `máy chủ chuyển tiếp` for "this relay"
(`relay.account_policy.unavailable`, byte-identical English and byte-identical Vietnamese). The transitive "đánh thức" in the wake chip likewise
matches core's committed `wire.settings.team_bridge_session.help` ("được đánh thức"), so the glossary's `thức dậy` noun and the
transitive verb coexist exactly as core uses them. `bộ giám sát` appears in this wave once, sentence-initial as `Bộ giám sát`.

## Second independent pass (this audit's own request, per the high-visibility rule)

The manager's brief asks for a second independent reading of high-visibility copy (onboarding, errors, settings). A blind pass
ran as a separate `reviewer` subagent (job `3d25b56e136a`) over all four group-A namespaces, without access to this audit's
findings. Both runs served **radient/auto** (the same fallback chain), so independence is by agent, session and context, not by
model.

Its verdict: **clean — no BLOCKER, no MAJOR; 3 MINOR + 2 NIT** across the four namespaces.

Findings it raised, and what this audit did with each:

| Its ID | Key | Its severity | Disposition here |
|---|---|---|---|
| V2-01 | mobile.home.tip.parallel | MINOR | **Agreed, and raised to MAJOR** — independently reproduced the overflow (278.1 pt vs the same 270 pt slot); a clipped one-line row is a fit defect, not polish |
| V2-02 | mobile.home.suggestion.review_repo | MINOR | **Adopted as H-06** — core's `tui.review.*` uses `rà soát` for this feature; the replacement removes both the drift and the shared `Đánh` opening |
| V2-05 | mobile.home.options.fixed | NIT | **Same defect as H-01, kept MAJOR** — the sentence exists to redirect the reader to working controls; two readings differ on severity, not on the defect |

