job 3d25b56e136a (vi-a-second-pass) [completed] model=radient/auto
## Second independent Vietnamese pass — 4 namespaces (mobile.home, mobile.session, mobile.session_health, mobile.account_routing)

**Model actually running this pass:** `radient/auto` — the session opened as `anthropic/claude-sonnet-5-5`, hit provider quota failures, and the harness fell back through `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`, which is what produced this report. No MT service, SDK or API was used; no back-translation. Read-only: nothing was edited, staged or pushed.

**How fit was measured.** With CoreText/AppKit at the tokens' own sizes — tips `meta` 12 pt / 500, chips `body-sm` 14 pt / 400, composer placeholder `body` 16 pt / 400 — against the real boxes: `px-4` on the splash content container gives a **288 pt column at 320 pt**, the tip row is a content-sized `flex-row items-center gap-1.5` (so text slot = 288 − 12 icon − 6 gap = **270 pt**, and clipping starts at the 320 pt viewport edge), chips are ~254–256 pt single-line rows.

### Per-namespace verdicts

| namespace | keys | verdict | findings |
|---|---|---|---|
| `mobile.home` | 27 | **fail — minors only** | 2 MINOR (V2-01 fit, V2-02 chip verb) |
| `mobile.session` | 2 | **pass** | none |
| `mobile.session_health` | 11 | **fail — minors only** | 1 MINOR (V2-03 fit/length) |
| `mobile.account_routing` | 14 | **pass** | 1 NIT (V2-04) |

Mechanical: 27/2/11/14 keys, key order identical to en, zero placeholders added or lost, all values NFC, tabs, no ASCII `...`, no `"`, no `“”`, no `!`, no "vui lòng". Style-guide orthography clean (`tùy`, not `tuỳ`).

### Findings

**V2-01 · `mobile.home.tip.parallel` · MINOR (fit)**
Current: `yêu cầu chạy song song để tách ra tác nhân con`
Problem: 46 chars passes `TIP_CHAR_BUDGET` (48), so the automated gate is blind to it — but it measures **278.1 pt** against the **270 pt** text slot: the row paints **296.1 pt inside the 288 pt column**, i.e. it overhangs the grid by ~4 pt per side at 320 pt, while the widest English entry (267.7 pt → 285.7) sits inside. Because the row stays content-sized and single-line until the 1.4× `LARGE_TEXT_SCALE` switch, this entry also starts clipping at the viewport edge from ~1.09× text size (English pool: ~1.13×). It is the only tip in either language over the slot at 100 %.
Replacement: `yêu cầu chạy song song để tách tác nhân con` — **263.3 pt** (row 281.3 ≤ 288); dropping `ra` is what buys the 8.1 pt.

**V2-02 · `mobile.home.suggestion.review_repo` · MINOR (idiom + pool composition)**
Current: `Đánh giá repo này`
Problem: two chips in the pool now open on the same word — `Đánh giá …` and `Đánh thức tôi kèm tóm tắt` — where the English pool has six distinct leading verbs, and the en note requires a chip not to begin with a verb another already uses. Separately, core's committed vi for the reviewing act is **`rà soát`** (`tui.review.activity_review`), so `đánh giá` is also the one place this catalogue diverges from core's own vocabulary.
Replacement: `Rà soát repo này` — 107.9 pt (vs 116.9), distinct leading verb, matches core.

**V2-03 · `mobile.session_health.ended_placeholder` · MINOR (fit / length precedent)**
Current: `Gửi để mở lại trong thư mục home…`
Problem: the only locale of five that keeps the destination — fr `Envoyer rouvre…`, es `Envía para reabrir…`, zh-CN `发送即可重新打开……`, ru `Отправка возобновит её…`. At 259 pt (16 pt body) it matches the English 266.7 pt that the en context note measures as clipping at 200 % text scale, whereas fr 120.7 and es 138.2 fit; the note's own remedy was the "shortest honest form", the destination living in the health sheet. Nothing is lost here: the mirrored `relay.health.ended_detail` already says `…khôi phục phiên trong thư mục home của bạn`.
Replacement: `Gửi để mở lại…` — 107.6 pt (215 pt at 200 %, fits).

**V2-04 · `mobile.account_routing.rejected` · NIT (polarity)**
Current: `Thay đổi chưa được lưu. Hãy kiểm tra giá trị hoặc cài đặt của máy tính này rồi thử lại.`
Problem: `chưa` reads "not saved **yet**" (pending), which is the neighbour status `mobile.account_routing.unsaved` = `Chưa lưu.`; en makes `rejected` a definitive backend refusal ("The change was not saved"). The two are adjacent in the same sheet, so the distinction the en context records ("definitive backend refusal") is softened. Caveat: this string is **byte-identical to core's committed `relay.account_policy.rejected`**, so a fix has to land in core too or it creates a new cross-surface split — accepting it is a legitimate call.
Replacement: `Thay đổi không được lưu. Hãy kiểm tra giá trị hoặc cài đặt của máy tính này rồi thử lại.`

**V2-05 · `mobile.home.options.fixed` · NIT (help sentence directs to look, not act)**
Current: `…Dùng Chi tiết cuộc trò chuyện để xem các điều khiển trực tiếp.`
Problem: en is "Use Conversation details **for** its live controls" — the reader goes there to operate them; `để xem` = "to view", which reads as read-only.
Replacement: `Tùy chọn khởi đầu của cuộc trò chuyện này đã cố định. Dùng Chi tiết cuộc trò chuyện để chỉnh các điều khiển trực tiếp.`

### Suspected, checked, and correct

- **`Đánh thức tôi kèm tóm tắt` is right, not a style-guide breach.** The guide's `wake → thức dậy` call is explicitly the intransitive sense (the agent wakes itself); this sentence wakes the *user*, the transitive sense the same note says `đánh thức` serves.
- **`Chưa bắt đầu` is 3 words where the context says "two words at most"** — the constraint exists so the state sits beside the queued-messages button; at 77.4 pt vs en 65.8 it satisfies the thing constrained. Not a finding.
- `mobile.account_routing` has **10 strings byte-identical to core's committed `relay.account_policy` vi** (`loading/save/saving/saved/retry/unavailable/error/scope/rejected/load_error`) — three of them (`unavailable` at 120 chars, `error`, `scope`) were the ones I expected to drift; they don't.
- `Mở lại` agrees with the real button: core `relay.chrome.session.resume` = `Mở lại`, so `resume_refused`'s "must agree with the button it sits under" holds.
- `dòng làm việc` matches core's term for "working line" (`wire.settings.display_shimmer`); `tác nhân con`, `phiên`, `nhóm`, `tác vụ`, `prompt`, `định tuyến`, `chính sách`, `hàng đợi`, `thư mục home`, `máy tính` all match glossary §2 or core usage. `Chi tiết cuộc trò chuyện` is byte-identical in both places it is required to be.
- `control_hint`'s `lần gửi tiếp theo sẽ ra sao` for "what a send does now" — I initially flagged "next" vs "now"; in a composer whose next send is the send at issue, it is correct.

### Outside the value audit (no finding against these files)

- **vi is not wired yet:** `locale.ts` still lists `vi` in `NOT_YET_SHIPPED_LOCALES`, so `home-copy.test.ts`'s per-locale loop does not cover these strings, and `SUGGESTION_CHAR_BUDGET` has **no `vi` entry**. Promoting vi to `SHIPPED_LOCALES` will fail `Record<ShippedLocale, number>` and that test until a measured vi budget lands (es/ru precedent: 32). A char budget would still not have caught V2-01 — tips use one global 48 for all locales; a width check (or per-locale tip budget) is what would.
- **Untranslated row on the same screen:** the splash's connect row label is a hardcoded literal `"Connect a computer"` (`home-splash.tsx:292`, also `conversations-pane.tsx:1141`, `route-label.ts:24`) with no catalogue key in any locale. Pre-existing and repo-wide, so not vi's defect, but the vi home screen will show one English row.

### Verdict

**clean — no BLOCKER, no MAJOR. This round is TERMINAL.** All 54 values are mechanically sound, terminology-consistent with core, and the copy reads as native product Vietnamese rather than calque. The three MINORs (two fit/length, one chip verb) and two NITs should ride the wave's single batched remediation commit; nothing here needs a further audit round beyond re-measuring V2-01 and V2-03 replacements at the numbers above.