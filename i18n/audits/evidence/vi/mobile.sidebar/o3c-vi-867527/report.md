# O3-c vi audit — mobile.sidebar (o3c-vi-867527)

Verdict: **passed** — 0 BLOCKER/MAJOR. Keys: 9. Auditor: i18n-auditor, session 86752777063d, anthropic/claude-opus-5-5 (independent of translator 7b4714a933c5).
Inputs: draft sha256 8d48b29f99b0a862dd0a9460325e8dea6b62f46fdadc445a74292e754cb7d629 (matches brief of task), brief e88beb09366b9ff795bf0ac916f30cef1c9a93c35fa4617575e904c7a6f5fd17, source e7ebc391. Redaction marker hits: draft 0, English 0, brief 0 (excluding its own redaction_scan.pattern).

## Findings

### VI-C1 — MINOR — `mobile.sidebar.row_label.open`
- Current: `đang mở`
- Proposed: `đang xem`
- Reason: Spoken last in the row name (list-row-meta.ts L504, 'Payments, …, đang mở'). Shipped vi uses «Đang mở…» for the progressive 'Opening…' (mobile.signin.panel.opening «Đang mở trình duyệt…», relay.chrome.session.resuming «Đang mở lại…»), so a bare «đang mở» fragment can be heard as 'opening/loading', not 'the one on screen'. «đang xem» (8) says 'being viewed' unambiguously. The current text is still a defensible reading ('các tab đang mở'), so this is not a meaning error.

### VI-C2 — NIT — `mobile.sidebar.row_status.approval`
- Current: `phê duyệt`
- Proposed: `chờ duyệt (optional; current acceptable)`
- Reason: Bare «phê duyệt» mirrors the bare English noun and the glossary term, and is lowercase so not an imperative. «chờ duyệt» (8) is the conventional vi pending-approval chip. Only the painted chip is affected; the spoken name uses row_label.waiting «đang chờ phê duyệt».

## Verified without finding

- `row_status.ended` «đã kết thúc» 11/10 chars: accepted (see record `checks.width_over_hint_assessment`). Translator's call agreed after checking the slot in list-row.tsx.
- `row_status.question` «câu hỏi» = shipped row.asks; `not_answering` «không phản hồi» = shipped relay.chrome subtitle; `working` «đang làm việc» = shipped working_plain; `on_device` «trên {device}» = shipped subtitle_owner «Trên {owner}», lowercased; `not_reachable` «mất kết nối» = shipped health_reconnecting wording, neutral, distinct from not_answering.
- `row_label.waiting`: each arm a whole phrase («đang chờ phê duyệt», «đang chờ trả lời»), not composed from the chip word; select arg `kind` and arms approval|other intact.
- Glossary: approvals → phê duyệt, device left as user data. Lowercase, NFC, no trailing punctuation, matches row.new «mới» casing.
- Sample spoken name: `Payments, đang chờ phê duyệt, đã kết thúc, trên Studio Mac, mất kết nối, đang mở`.

## Draft values

| key | vi |
|---|---|
| `mobile.sidebar.row_status.approval` | `phê duyệt` |
| `mobile.sidebar.row_status.question` | `câu hỏi` |
| `mobile.sidebar.row_status.not_reachable` | `mất kết nối` |
| `mobile.sidebar.row_status.ended` | `đã kết thúc` |
| `mobile.sidebar.row_status.not_answering` | `không phản hồi` |
| `mobile.sidebar.row_label.waiting` | `{kind, select, approval {đang chờ phê duyệt} other {đang chờ trả lời}}` |
| `mobile.sidebar.row_label.working` | `đang làm việc` |
| `mobile.sidebar.row_label.on_device` | `trên {device}` |
| `mobile.sidebar.row_label.open` | `đang mở` |

Mechanical checks and negative controls: see audit.log (10/10 controls caught).
