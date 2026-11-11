# vi — `mobile.computers` — audit `vi1111m1a` (M1 slice A)

Slice-level verdict for all 53 M1 keys: **clean-with-findings — 0 BLOCKER, 0 MAJOR, 2 MINOR,
3 NIT** ⇒ ledger status `passed`. This bundle attests the 6 slice keys that live in
`mobile.computers`; the other 47 keys of the same audit sit in the sibling bundles
`vi/mobile.common`, `vi/mobile.session`, `vi/mobile.settings` under the same `audit_id`, which
share this bundle's `audit.log`.

- locale `vi` · namespace `mobile.computers` · audit date 2026-11-11 · mobile head `84c4bee109d048e3dad0f996921e1b8ed561dfc8`
- auditor `i18n-auditor (lopdev team)`, session `2b8bafe5512c`, served model `deepseek/deepseek-flash`
  (session header; no fallback notice). Independent of the translator's session; model-diverse
  from the reported `openai/gpt-6.1-sol`.
- targets are the staged values in `<scratch>/m1-prep/vi.json` (sha256 `34f5d012…be9`), which
  replace the English placeholders currently in `src/i18n/catalogues/vi/mobile.computers.json`.

## Keys audited (6)

| key | role | value | verdict |
| --- | --- | --- | --- |
| `mobile.computers.wait.nothing_answered` | status | Không có phản hồi. | ok |
| `mobile.computers.wait.nothing_answered_help` | help | Đã ba phút mà chưa thấy đường hầm nào và không có máy tính nào phản hồi. Kiểm tra xem lệnh đã chạy trên máy tính chưa, rồi bắt đầu lại. | viA-N1 |
| `mobile.computers.wait.paused` | help | Tạm dừng khi ứng dụng chạy nền. Mở lại để tiếp tục theo dõi. | ok |
| `mobile.computers.wait.relay_sessions` | help | Bộ chuyển tiếp trên máy tính báo có {sessions, plural, other {# phiên đang chạy}}. | ok |
| `mobile.computers.wait.relay_version` | help | Bộ chuyển tiếp trên máy tính báo phiên bản giao thức {version}. | ok |
| `mobile.computers.wait.relay_version_sessions` | help | Bộ chuyển tiếp trên máy tính báo phiên bản giao thức {version} và {sessions, plural, other {# phiên đang chạy}}. | ok |

## Findings in this namespace

### viA-N1 — NIT — `mobile.computers.wait.nothing_answered_help`

- Current: `Đã ba phút mà chưa thấy đường hầm nào và không có máy tính nào phản hồi. …`
- English: "Three minutes with no tunnel listed and no host answering. …"
- Problem: "no tunnel *listed*" becomes "haven't seen any tunnel". Same practical reading, but the
  panel's point is that the *list stayed empty*, not that the user failed to look.
- Suggested: `Đã ba phút mà danh sách vẫn không có đường hầm nào và không máy tính nào phản hồi.`

## Judgement calls accepted in this namespace

- «Bộ chuyển tiếp trên máy tính» renders English "Its relay" — the glossary fixes relay → «chuyển
  tiếp» and the guide records it, so the term is right; the added «trên máy tính» supplies the
  referent English's "Its" carries, without changing the claim.
- Both plural keys carry exactly one `other` arm with `#` inside it: correct for `vi` CLDR and for
  the guide's "never add one/other branches" rule. `{sessions}` and `{version}` sets are identical
  to source in all three relay strings.
- Also observed outside this slice (not counted): `mobile.computers.connect_refused.password` ships
  `Relay không chấp nhận mật khẩu đó. …`, leaving the English word "Relay" in the `vi` interface —
  a live exception to the "no English anywhere" acceptance criterion, owned by whoever next touches
  that file.
