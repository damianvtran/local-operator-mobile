# Vietnamese audit — `mobile.notifications` (group B)

- **Audit ID:** `vi30n1`
- **Locale / namespace:** `vi` / `mobile.notifications` (14 keys)
- **Date:** 2026-10-30
- **Audited head:** `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` on `feat/i18n-vietnamese`
- **Worktree:** `/Users/damian/workspace/vi-wave`
- **Auditor:** `i18n-auditor` (lopdev team), session `0156ce9c9f5e`, model `radient/auto`
- **Independence:** different agent/session from the translator; not the author of these bytes. No human native-speaker review is claimed. Second independent reading pass: reviewer subagent, job `4ac043e37ef7`, model `radient/auto`.
- **Verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.

The `vi` catalogue is an **untracked working-tree directory** at this head; the audited bytes are identified by SHA-256 in `record.json`, not by a commit. This audit wrote only its evidence bundle; no catalogue byte was edited, and nothing was committed.

## Inputs

| Role | Path | SHA-256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/mobile.notifications.json` | `c6e58c6129727513a00b0c67abdfc6cd5284d326792f00886767a26a60778064` |
| Context / role notes | `src/i18n/catalogues/en/mobile.notifications.context.json` | `240ec6befb692d72ac51a346fbc70a6f79e5853ae03f62ce25654d81db7f21e6` |
| Vietnamese target | `src/i18n/catalogues/vi/mobile.notifications.json` | `a50da99c7431bdd30629bd172af9677a7e47c208e1c7a34be8d5ad2d6c60d6b3` |

(These are the hashes printed by `audit-run.sh`; `record.json` carries the same values.)

## Mechanical

- **Repo validator:** `generate.ts --check` → exit 0; key set 14/14, no extras, no missing; every message parses.
- **Placeholders:** this namespace has no placeholders and no ICU plural/select nodes in either language. Nothing to compare structurally.
- **Structural verifier:** 14 keys, 0 problems; all 14 strings NFC precomposed; key order identical to English; tabs, trailing newline, no BOM/CRLF.
- **Negative controls:** the group-level controls in `audit.log` exercise the same verifier (placeholder drop, select-arm drop, unreachable plural arm, decomposed diacritics). Three of the four are invisible to the repo validator, which is why the verifier is load-bearing; none applies to a defect in this namespace.

## Rendered evidence (production `t()`, vi shipped in the scratch copy)

| Key | ACTUAL rendered string |
|---|---|
| `mobile.notifications.answer` | `Trả lời` |
| `mobile.notifications.back` | `Quay lại` |
| `mobile.notifications.detail.answer_in_conversation` | `Trả lời trong cuộc trò chuyện` |
| `mobile.notifications.detail.conversation_asks` | `Câu hỏi trong cuộc trò chuyện này` |
| `mobile.notifications.detail.earlier_updates` | `Cập nhật trước đó` |
| `mobile.notifications.detail.from` | `Nguồn` |
| `mobile.notifications.detail.no_asks` | `Không có câu hỏi nào trong cuộc trò chuyện này.` |
| `mobile.notifications.detail.nothing_to_dismiss` | `Không có cập nhật nào từ cuộc trò chuyện này để bỏ qua.` |
| `mobile.notifications.detail.projects` | `Dự án` |
| `mobile.notifications.dismiss` | `Bỏ qua` |
| `mobile.notifications.filter_label` | `Hiển thị` |
| `mobile.notifications.load_failed` | `Không thể tải thông báo` |
| `mobile.notifications.priority_high` | `Cao` |
| `mobile.notifications.title` | `Thông báo` |

## Judgement (accuracy / idiom / register / terminology)

- **"Ask" is the product word for a question the agent puts to the reader.** Vietnamese renders it `câu hỏi` here and in both empty states, matching core's committed vi (`wire.settings.asks.description`: "Câu hỏi mà tác nhân đưa vào hàng đợi cho bạn"). Consistency is exact; no divergence.
- **`dismiss` = `Bỏ qua`.** Core's dismiss dialog for an ask is "Bỏ qua câu hỏi này" and its receipt "Đã bỏ qua" (`tui.asks.*`, `relay.ask.dismiss.*`), so this is the established verb. The button is icon-only; the label is its accessible name, so a "skip" reading costs nothing on screen.
- **`filter_label` = `Hiển thị`.** The note calls for a verb used as a label; `Hiển thị` is that. The control is a segmented control whose segments carry their own visible text; this label is only its accessible name, so the 4→8-character growth is not a width risk.
- **`detail.from` = `Nguồn`.** A one-word heading naming the conversation a notification came from. `Nguồn` ("source") is the natural Vietnamese heading; `Từ` ("from") would be a preposition stranded as a heading. Core's notification detail uses the same section idea (`relay.notifications.detail.section.from`).
- **`priority_high` = `Cao`.** One word, no final stop, the same badge shape as English "High".
- **Register.** Sentence case throughout; no `!`; no pronoun `bạn` anywhere in this namespace; buttons are bare verbs (`Trả lời`, `Quay lại`, `Bỏ qua`); headings carry no final stop; statuses do. No `Vui lòng`.
- **`nothing_to_dismiss`** says "no updates from this conversation to dismiss" without implying the notification is unread or gone; `no_asks` says "no questions in this conversation" — both are faithful to the empty states the notes describe.
- **No unsafe/destructive text** in this namespace; `load_failed` is the alert heading and does not claim data loss.

## Every key in the group

| Key | Vietnamese | Verdict |
|---|---|---|
| `mobile.notifications.answer` | `Trả lời` | pass — imperative, one word |
| `mobile.notifications.back` | `Quay lại` | pass — accessible label of the icon-only back control |
| `mobile.notifications.detail.answer_in_conversation` | `Trả lời trong cuộc trò chuyện` | pass — sentence case, no final stop |
| `mobile.notifications.detail.conversation_asks` | `Câu hỏi trong cuộc trò chuyện này` | pass — core's ask word |
| `mobile.notifications.detail.earlier_updates` | `Cập nhật trước đó` | pass |
| `mobile.notifications.detail.from` | `Nguồn` | pass — one-word heading |
| `mobile.notifications.detail.no_asks` | `Không có câu hỏi nào trong cuộc trò chuyện này.` | pass — status, full stop |
| `mobile.notifications.detail.nothing_to_dismiss` | `Không có cập nhật nào từ cuộc trò chuyện này để bỏ qua.` | pass — status, full stop |
| `mobile.notifications.detail.projects` | `Dự án` | pass — heading |
| `mobile.notifications.dismiss` | `Bỏ qua` | pass — imperative; core's dismiss verb |
| `mobile.notifications.filter_label` | `Hiển thị` | pass — verb label |
| `mobile.notifications.load_failed` | `Không thể tải thông báo` | pass — error-alert heading, no false claim |
| `mobile.notifications.priority_high` | `Cao` | pass — one-word badge |
| `mobile.notifications.title` | `Thông báo` | pass |

## Terminology / glossary against core's committed Vietnamese

None of the seven tracked glossary terms (`mốc`, `bộ giám sát`, `giám sát`, `lần thức dậy`, `hàng đợi`, `bản nháp`, `thư mục home`) occurs in this namespace. The relevant core-aligned term here is `câu hỏi` for "ask", which matches core's committed vi. **Divergences: 0.**

## Fit / width

No `maxCells`/`maxChars` hint exists for this namespace. The longest strings are `nothing_to_dismiss` 55 code points (en 45, ratio 1.22) and `no_asks` 47 (en 29, ratio 1.62) — both status paragraphs that wrap. `conversation_asks` is a section header 33 vs 24 (1.38); `SectionHeader` has no `numberOfLines` clamp, so it wraps. Button labels are ≤ 8 code points; the two 2.0-ratio strings (`back`, `filter_label`) are accessible names on icon-only controls, not painted widths. No overflow risk found.

## What I could not verify

- No rendered frame (no `browser` tool, no simulator capture); width claims are code-point reasoning against the components' clamps.
- No human native-speaker review; the second pass is another LLM agent (agent/session independence, not model diversity).
- `t()` on the real branch still renders English for `vi` (pending ship); renders above come from the byte-identical scratch copy with the harness-only `SHIPPED_LOCALES` flip.
