# vi — `mobile.common` — audit `vi1111m1a` (M1 slice A)

Slice-level verdict for all 53 M1 keys: **clean-with-findings — 0 BLOCKER, 0 MAJOR, 2 MINOR,
3 NIT** ⇒ ledger status `passed`. This bundle attests the 4 slice keys that live in
`mobile.common`; the other 49 keys of the same audit sit in the sibling bundles
`vi/mobile.computers`, `vi/mobile.session`, `vi/mobile.settings` under the same `audit_id`,
which share this bundle's `audit.log`.

- locale `vi` · namespace `mobile.common` · audit date 2026-11-11 · mobile head `84c4bee109d048e3dad0f996921e1b8ed561dfc8`
- auditor `i18n-auditor (lopdev team)`, session `2b8bafe5512c`, served model `deepseek/deepseek-flash`
  (session header; no fallback notice). Independent of the translator's session; model-diverse
  from the reported `openai/gpt-6.1-sol`.
- targets are the staged values in `<scratch>/m1-prep/vi.json` (sha256 `34f5d012…be9`), which
  replace the English placeholders currently in `src/i18n/catalogues/vi/mobile.common.json`.

## Keys audited (4)

| key | role | value | verdict |
| --- | --- | --- | --- |
| `mobile.common.not_found.action` | button | Quay lại danh sách phiên | ok |
| `mobile.common.not_found.headline` | status | Trang đó không tồn tại. | ok |
| `mobile.common.not_found.next` | help | Quay lại danh sách phiên để tiếp tục. | ok |
| `mobile.common.not_found.title` | heading | Không tìm thấy trang | ok |

## Findings in this namespace

None.

The 24-character button (`mobile.common.not_found.action`, English 16) is not the longest label in
the slice — `mobile.settings.account.delete` and `mobile.session.find.label` both reach 29 — but it is
the widest empty-state primary action; at 16 sp it is ≈175 dp and fits a full-width or auto-width
button on a 320 pt phone screen. Judged on character width only — no rendered capture (see the
slice report's Limits).

## Slice findings recorded elsewhere

`viA-M1` (`mobile.settings.sign_out.body`), `viA-M2` (`mobile.session.not_connected.next`),
`viA-N1` (`mobile.computers.wait.nothing_answered_help`), `viA-N2` (`mobile.session.find.label`),
`viA-N3` (`mobile.session.subagent.prompt_label`). None touches this namespace.
