# vi — `mobile.session` — audit `vi1111m1a` (M1 slice A)

Slice-level verdict for all 53 M1 keys: clean-with-findings (0 BLOCKER, 0 MAJOR, 2 MINOR,
3 NIT) ⇒ ledger status `passed`. This bundle attests the 16 slice keys that live in
`mobile.session`; the other 37 keys of the same audit sit in the sibling bundles
`vi/mobile.common`, `vi/mobile.computers`, `vi/mobile.settings` under the same `audit_id`, which
share this bundle's `audit.log`.

- locale `vi` · namespace `mobile.session` · audit date 2026-11-11 · mobile head `84c4bee109d048e3dad0f996921e1b8ed561dfc8`
- auditor `i18n-auditor (lopdev team)`, session `2b8bafe5512c`, served model `deepseek/deepseek-flash`
  (session header; no fallback notice). Independent of the translator's session; model-diverse
  from the reported `openai/gpt-6.1-sol`.
- targets are the staged values in `<scratch>/m1-prep/vi.json` (sha256 `34f5d012…be9`), which
  replace the English placeholders currently in `src/i18n/catalogues/vi/mobile.session.json`.

## Keys audited (16)

| key | role | value | verdict |
| --- | --- | --- | --- |
| `mobile.session.chip.effort_change_failed` | status | Không thể đổi mức suy luận. | ok |
| `mobile.session.chip.model_change_failed` | status | Không thể đổi mô hình. | ok |
| `mobile.session.composer.retained_instruction` | confirm | Chỉ dẫn trước đó có thể đã được chuyển đến. Hãy thử gửi lại chỉ dẫn đó trước khi gửi bản nháp hiện tại. | ok |
| `mobile.session.empty.headline` | status | Chưa có gì ở đây. | ok |
| `mobile.session.empty.next` | help | Gửi tin nhắn đầu tiên bên dưới. | ok |
| `mobile.session.find.hint` | help | Tìm tin nhắn trong bản ghi đã tải trên thiết bị này | ok |
| `mobile.session.find.label` | button | Tìm trong cuộc trò chuyện này | viA-N2 |
| `mobile.session.not_connected.headline` | status | Phiên này chưa được kết nối. | ok |
| `mobile.session.not_connected.next` | help | Mở phiên từ danh sách sau khi kết nối máy tính. | viA-M2 |
| `mobile.session.subagent.no_rows` | status | Tác nhân con này không có dòng bản ghi riêng nào. | ok |
| `mobile.session.subagent.prompt_label` | meta | prompt | viA-N3 |
| `mobile.session.subagent.result_label` | meta | kết quả | ok |
| `mobile.session.subagent.screen_title` | heading | Tác nhân con | ok |
| `mobile.session.subagent.unavailable_headline` | status | Tác nhân con này không còn khả dụng. | ok |
| `mobile.session.subagent.unavailable_next` | help | Bản ghi không được lưu giữ hoặc máy tính không phản hồi. | ok |
| `mobile.session.subagents_hint` | help | Hiện các tác nhân con | ok |

## Findings in this namespace

### viA-M2 — MINOR — `mobile.session.not_connected.next`

- Current: `Mở phiên từ danh sách sau khi kết nối máy tính.`
- English: "Open it from the session list once a computer is connected."
- Problem: "the session list" loses its noun — the value says "from the list". Impact is low
  (there is one list), but it breaks a pattern this catalogue already fixes: the shipped copy
  always names the noun (`danh sách máy tính`, `danh sách mô hình`, `danh sách người`,
  `danh sách cuộc trò chuyện`), and two sibling keys in this same slice say «danh sách phiên»
  (`mobile.common.not_found.action`, `mobile.common.not_found.next`).
- Suggested: `Sau khi kết nối máy tính, mở lại từ danh sách phiên.` (keeps «Mở lại», the shipped
  word for reopening a session, and avoids «phiên … phiên» repetition).

### viA-N2 — NIT — `mobile.session.find.label`

- Current: `Tìm trong cuộc trò chuyện này`
- English: "Search this conversation" (accessibility name of the header find button).
- Problem: the shipped catalogue's search vocabulary is «Tìm kiếm» (`relay.chrome.list.search_open`,
  `relay.chrome.list.search_label` "Tìm kiếm cuộc trò chuyện"). «Tìm» is the shorter verb and
  matches the key name, so this is a consistency nit, not an error — and the label is read aloud,
  so the extra three characters cost nothing on screen.
- Suggested: `Tìm kiếm trong cuộc trò chuyện này`.

### viA-N3 — NIT — `mobile.session.subagent.prompt_label` (no change recommended)

- Current: `prompt`, sitting beside its sibling `kết quả` (`result_label`).
- Problem: it is the only English-identical value in the 53 keys, so it will surface in any
  mechanical sweep of the "no English anywhere" acceptance criterion. It is correct: `i18n/glossary.md`
  §2 fixes `prompt` → «prompt» for `vi`, and the `vi` guide's kept-English list repeats it. Recorded
  so nobody "fixes" it into «lời nhắc» and breaks the glossary; the mixed-language label pair is
  glossary-mandated, not translator drift.

## Judgement calls accepted in this namespace

- «Mức suy luận» for `effort` matches the shipped dominant rendering (`mobile.chrome.composer.row_effort`,
  `mobile.home.picker.effort_*`, `mobile.session.sheet_title.effort`). One pre-existing outlier,
  `mobile.session.chip.effort_resume_hint` = «…đổi mức nỗ lực», is outside this slice and not gated here.
- «Tác nhân con» for subagent, «bản ghi» for transcript, «phiên» for session, «chỉ dẫn» for instruction —
  all per glossary, and `retained_instruction` reuses the exact shipped phrasing of
  `mobile.session.composer.retry_not_sent_storage` («Hãy thử gửi lại chỉ dẫn trước đó»), so the two
  composer warnings read as one voice.
- `mobile.session.find.hint` renders English's third person ("Finds messages…") as an imperative
  («Tìm tin nhắn…»): the platform convention for a hint read after the control's name; nothing lost.
