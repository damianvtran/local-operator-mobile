# Vietnamese audit — `mobile.projects` (group B)

- **Audit ID:** `vi30p1`
- **Locale / namespace:** `vi` / `mobile.projects` (15 keys)
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
| English source | `src/i18n/catalogues/en/mobile.projects.json` | `a598ddc447a47476a54dc0510b156fd4d35d27bf15d79b44850a65a4bf6efc09` |
| Context / role notes | `src/i18n/catalogues/en/mobile.projects.context.json` | `5481687e7c4c089cf9ec39175630a5f3f5dd686c041561aceb671083933eed99` |
| Vietnamese target | `src/i18n/catalogues/vi/mobile.projects.json` | `4f3b2a5c88356864e6df23c909bc9a717d4f0fd0f7c5dfeda21f6fa091ab63d5` |

(These are the hashes printed by `audit-run.sh`; `record.json` carries the same values.)

## Mechanical

- **Repo validator:** `generate.ts --check` → exit 0; key set 15/15, no extras, no missing, projection current.
- **Structural verifier:** `write_receipt`'s `select` shape matches English at every level: `kind` ∈ {project, milestone, other}; every branch carries a nested `action` select with all seven actions plus `other`. No placeholder dropped in any arm; `{subject}` appears in every leaf. `sessions.count` has one plural node, `other` only. All 15 strings NFC.
- **Negative controls:** dropping `{total}` makes the repo validator fail (see `audit.log`); removing the `milestone` arm from `write_receipt` leaves the repo validator green and the verifier red — the verifier's select-arm check is the load-bearing one.
- **Encoding:** key order identical to English, tabs, trailing newline, no BOM/CRLF.

## Rendered evidence (production `projects-copy.ts` functions, vi shipped in the scratch copy)

Destructive confirmations — the `{name}` placeholder survives and the sentence names both what goes and what stays:

| Call | ACTUAL rendered string |
|---|---|
| `deleteProjectBody("Alpha")` | `Xóa Alpha? Dòng dự án sẽ mất hẳn. Các phiên liên kết và bản ghi của chúng vẫn giữ nguyên.` |
| `deleteProjectBody("ship/v2")` | `Xóa ship/v2? Dòng dự án sẽ mất hẳn. Các phiên liên kết và bản ghi của chúng vẫn giữ nguyên.` |
| `removeMilestoneBody("beta")` | `Xóa beta khỏi dự án này? Mốc sẽ mất hẳn. Các phiên của dự án và dòng tiến độ vẫn giữ nguyên.` |
| `removeMilestoneBody("Nguyễn Văn A")` | `Xóa Nguyễn Văn A khỏi dự án này? Mốc sẽ mất hẳn. Các phiên của dự án và dòng tiến độ vẫn giữ nguyên.` |
| `writeUnknownNote()` | `Không kết nối được với máy tính của bạn nên chưa biết thay đổi đã được lưu hay chưa. Hãy kiểm tra dự án trước khi thử lại.` |

Both confirmations keep both halves the context notes call load-bearing: `mất hẳn` (goes for good) for what is destroyed, `vẫn giữ nguyên` (not touched) for what survives. The unknown-outcome note states the outcome as unknown (`chưa biết … hay chưa`), never "nothing was saved".

Receipt arms (21 combinations executed; representative rows):

| Call | ACTUAL rendered string |
|---|---|
| `writeReceipt("deleted","Alpha","project")` | `Đã xóa Alpha.` |
| `writeReceipt("removed","beta","milestone")` | `Đã xóa mốc beta.` |
| `writeReceipt("created","beta","milestone")` | `Đã tạo mốc beta.` |
| `writeReceipt("completed","beta","milestone")` | `Đã hoàn thành mốc beta.` |
| `writeReceipt("reopened","beta","milestone")` | `Đã mở lại mốc beta.` |
| `writeReceipt("added","beta","milestone")` | `Đã thêm mốc beta.` |
| `writeReceipt("updated","beta","milestone")` | `Đã cập nhật mốc beta.` |
| unknown action, kind `other` | `Đã cập nhật Alpha.` |

The `removed`/`deleted` collapse to `Đã xóa` is **not** a loss a reader can act on: the code uses `removed` only for milestone removal (`project-detail.tsx:254`) and `deleted` only for project deletion (`project-detail.tsx:278`), and the kind noun distinguishes the two receipts (`Đã xóa mốc …` vs `Đã xóa …`). French, Spanish and Chinese distinguish the verbs; Russian collapses them the same way and passed its audit.

## Every key in the group

| Key | Vietnamese | Verdict |
|---|---|---|
| `mobile.projects.delete_body` | `Xóa {name}? Dòng dự án sẽ mất hẳn. Các phiên liên kết và bản ghi của chúng vẫn giữ nguyên.` | pass — `{name}` survives; both halves present |
| `mobile.projects.draft_kept_note` | `Đã giữ lại từ lần trước. Xóa hết các trường để bắt đầu lại.` | pass |
| `mobile.projects.milestone_slash_note` | `Tên mốc không được chứa dấu /. Mốc có dấu này sẽ không bao giờ xóa được.` | pass — keeps the literal `/`; names the consequence, no route jargon |
| `mobile.projects.milestones.count` | `{completed} trên {total} mốc` | pass — both placeholders plain; vi needs no agreement |
| `mobile.projects.milestones.none` | `chưa có mốc` | pass — lower-case fragment, no final stop, joins the session count |
| `mobile.projects.project_name_hint` | `1-64 ký tự: chữ cái, chữ số, dấu chấm, gạch dưới hoặc gạch nối. Không có dấu cách và không được bắt đầu bằng gạch nối.` | pass — range, alphabet, no spaces, no leading hyphen all stated |
| `mobile.projects.remove_milestone_body` | `Xóa {name} khỏi dự án này? Mốc sẽ mất hẳn. Các phiên của dự án và dòng tiến độ vẫn giữ nguyên.` | pass — `{name}` survives; both halves present |
| `mobile.projects.session_state.filed_by` | `ghi nhận bởi` | pass — lower-case fragment; provenance, not a worker |
| `mobile.projects.session_state.missing` | `không còn` | pass — a link whose directory is gone; not an error |
| `mobile.projects.session_state.not_running` | `không chạy` | pass — ordinary end of a session |
| `mobile.projects.sessions.count` | `{count, plural, other {# phiên}}` | pass — `other` only |
| `mobile.projects.sessions.live` | `{base} · {live} đang chạy` | pass |
| `mobile.projects.stale_badge` | `tiến độ cũ` | pass — lower-case, names progress, not the project |
| `mobile.projects.write_receipt` | see the receipts table | pass — all 3 kind arms × 7 actions + `other`; `{subject}` in every leaf; full stop |
| `mobile.projects.write_unknown_note` | `Không kết nối được với máy tính của bạn nên chưa biết thay đổi đã được lưu hay chưa. Hãy kiểm tra dự án trước khi thử lại.` | pass — outcome explicitly unknown |

## Terminology / glossary against core's committed Vietnamese

`mốc` appears 6 times in this namespace (4 lower-case and the sentence-initial `Mốc` twice: `milestones.count`, `milestones.none`, `milestone_slash_note`, `remove_milestone_body`, and `write_receipt`'s milestone arm). Core's committed vi uses `mốc` for milestone 17 times in `tui.projects_edit.json`; two further `mốc` uses in `wire.settings.json` mean a stop threshold, a different sense, and are not a divergence. **Divergence: 0.** `bản nháp`, `hàng đợi` and `thư mục home` do not occur in this namespace; their occurrences are in `mobile.home` / `mobile.session_health` / `relay.health` (group A) and were not audited here.

## Fit / width

No `maxCells`/`maxChars` hint exists for this namespace. The longest strings are `write_unknown_note` 122 code points (en 112), `project_name_hint` 118 (en 105) and `delete_body` 90 (en 104); all render in a sheet body or paragraph that wraps. `projectRowMeta` composes `2 trên 3 mốc · 3 phiên · 2 đang chạy` — shorter than the English twin (`2 of 3 milestones · 3 sessions · 2 live`). No word reaches 18 characters. No overflow risk found; no clamped line is affected.

## What I could not verify

- No rendered frame (no `browser` tool, no simulator capture); width claims are code-point reasoning against the components' clamps.
- No human native-speaker review; the second pass is another LLM agent (agent/session independence, not model diversity).
- `t()` on the real branch still renders English for `vi` (pending ship); renders above come from the byte-identical scratch copy with the harness-only `SHIPPED_LOCALES` flip.
