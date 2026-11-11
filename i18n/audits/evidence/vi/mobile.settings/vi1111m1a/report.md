# vi — `mobile.settings` — audit `vi1111m1a` (M1 slice A)

Slice-level verdict for all 53 M1 keys: clean-with-findings (0 BLOCKER, 0 MAJOR, 2 MINOR,
3 NIT) ⇒ ledger status `passed`. This bundle attests the 27 slice keys that live in
`mobile.settings` — the highest-visibility group in the slice, since it carries the destructive
account-deletion and sign-out copy; the other 26 keys of the same audit sit in the sibling bundles
`vi/mobile.common`, `vi/mobile.computers`, `vi/mobile.session` under the same `audit_id`, which
share this bundle's `audit.log`.

- locale `vi` · namespace `mobile.settings` · audit date 2026-11-11 · mobile head `84c4bee109d048e3dad0f996921e1b8ed561dfc8`
- auditor `i18n-auditor (lopdev team)`, session `2b8bafe5512c`, served model `deepseek/deepseek-flash`
  (session header; no fallback notice). Independent of the translator's session; model-diverse
  from the reported `openai/gpt-6.1-sol`.
- targets are the staged values in `<scratch>/m1-prep/vi.json` (sha256 `34f5d012…be9`), which
  replace the English placeholders currently in `src/i18n/catalogues/vi/mobile.settings.json`.

## Keys audited (27)

| key | role | value | verdict |
| --- | --- | --- | --- |
| `mobile.settings.about.blurb` | help | Local Operator có mã nguồn mở (MIT). Các phiên tác nhân kết nối với bộ chuyển tiếp của bạn. Tin nhắn Team Bridge và việc đăng ký nhận thông báo kết nối trực tiếp với Radient. | ok |
| `mobile.settings.about.version` | meta | Phiên bản | ok |
| `mobile.settings.account.delete` | button | Xóa tài khoản Radient của tôi | ok |
| `mobile.settings.account.delete_help` | help | Việc xóa tài khoản được thực hiện trong bảng điều khiển Radient trên trình duyệt — ứng dụng này không thể xóa giúp bạn. Thao tác này xóa tài khoản và mọi đường hầm thuộc tài khoản đó. Các phiên trên máy tính không bị ảnh hưởng. | ok |
| `mobile.settings.account.signed_in` | status | Đã đăng nhập | ok |
| `mobile.settings.connection.computers` | meta | Máy tính | ok |
| `mobile.settings.connection.refresh` | button | Làm mới | ok |
| `mobile.settings.connection.status` | meta | Trạng thái | ok |
| `mobile.settings.connection.use` | button | Dùng | ok |
| `mobile.settings.diagnostics.last_error` | meta | Lỗi gần nhất | ok |
| `mobile.settings.diagnostics.none` | status | Không có | ok |
| `mobile.settings.diagnostics.privacy_note` | help | Các dòng này không bao giờ chứa token, mật khẩu hay nội dung phiên. | ok |
| `mobile.settings.diagnostics.route` | meta | Tuyến kết nối | ok (judgement call) |
| `mobile.settings.diagnostics.route_direct` | status | Chuyển tiếp trực tiếp | ok |
| `mobile.settings.diagnostics.route_radient` | status | Đường hầm Radient | ok |
| `mobile.settings.diagnostics.stream` | meta | Luồng | ok |
| `mobile.settings.screen_title` | heading | Cài đặt | ok |
| `mobile.settings.section.about` | heading | Giới thiệu | ok |
| `mobile.settings.section.appearance` | heading | Giao diện | ok |
| `mobile.settings.section.connection` | heading | Kết nối | ok |
| `mobile.settings.section.diagnostics` | heading | Chẩn đoán | ok |
| `mobile.settings.sign_out.body` | confirm | Thao tác này kết thúc phiên với hệ thống điều khiển và xóa thông tin phiên trên điện thoại, nên đường hầm sẽ ngừng nhận yêu cầu từ điện thoại này. Máy tính không bị ảnh hưởng. | viA-M1 |
| `mobile.settings.sign_out.confirm` | button | Đăng xuất | ok |
| `mobile.settings.sign_out.done` | status | Đã đăng xuất. Phiên đã bị thu hồi trên máy tính. | ok |
| `mobile.settings.sign_out.title` | confirm | Đăng xuất? | ok |
| `mobile.settings.text_size.following` | help | Cỡ chữ của điện thoại này là {percent}%. Đang dùng cỡ chữ đó. | ok |
| `mobile.settings.text_size.overridden` | help | Cỡ chữ của điện thoại này là {percent}%. Đã dùng cỡ chữ khác ở trên. | ok |

## Findings in this namespace

### viA-M1 — MINOR — `mobile.settings.sign_out.body`

- Current: `Thao tác này kết thúc phiên với hệ thống điều khiển và xóa thông tin phiên trên điện thoại, nên đường hầm sẽ ngừng nhận yêu cầu từ điện thoại này. Máy tính không bị ảnh hưởng.`
- English: "This ends the session with the control plane as well as forgetting it here, so the tunnel stops accepting requests from this phone. Your computer is not touched."
- Problem: all three claims survive and the safety-relevant reassurance («Máy tính không bị ảnh hưởng») is intact, so this is not a meaning defect. The term is: «hệ thống điều khiển» ("control system") is invented for *control plane*. It has no glossary row and no precedent in the shipped `vi` catalogue, and it shares its head noun with «bảng điều khiển», which this catalogue uses five times for the *Radient console/dashboard* (`mobile.computers.billing_help`, `disabled_help`, `harness_help`, `mobile.team_bridge.gate.console_error`, `manage_plan`). The delete-account copy on the same screen also says «bảng điều khiển Radient», so a reader can take the sign-out sentence as being about the console.
- Suggested: keep the architecture term Latin — `phiên với control plane` — or use «lớp điều khiển»; either way record the call in `i18n/style-guides/vi.md` (wave-2 style, alongside `runtime`, `host`, `mesh`) so the next wave does not re-invent it.

## Safety-copy pass (second read, this namespace)

The destructive-permission strings were re-read for polarity and completeness, not just fluency:

- `account.delete_help` — three English sentences, three Vietnamese: where deletion happens
  («trong bảng điều khiển Radient trên trình duyệt»), what it removes («tài khoản và mọi đường hầm
  thuộc tài khoản đó»), and the reassurance («Các phiên trên máy tính không bị ảnh hưởng»). No
  negation flipped; «không thể xóa giúp bạn» correctly says the app cannot do it for you.
- `sign_out.done` — the toast keeps the precise claim: «Phiên đã bị thu hồi trên máy tính» (revoked
  *on the computer*), distinct from the dialog's «xóa thông tin phiên trên điện thoại». The toast
  and the dialog do not contradict each other.
- `sign_out.body` — «đường hầm sẽ ngừng nhận yêu cầu từ điện thoại này» preserves the scope limit
  (requests *from this phone*), and «Máy tính không bị ảnh hưởng» preserves the computer-untouched
  promise.
- `privacy_note` — «không bao giờ chứa token, mật khẩu hay nội dung phiên» keeps the absolute claim
  the English makes; `token` stays Latin per the glossary's kept-English list.

## Judgement calls accepted in this namespace

- `mobile.settings.diagnostics.route` = «Tuyến kết nối» for "Route": a two-word label in a
  diagnostics list, clearer at phone size than a bare «Tuyến»; the shipped «định tuyến» family names
  *routing* as a feature (account routing), not this row, so no glossary conflict. Accepted.
- `route_direct` = «Chuyển tiếp trực tiếp» reads as the noun phrase "direct relay" and contrasts
  cleanly with «Đường hầm Radient»; «Luồng» for "Stream" collides with nothing in the shipped `vi`
  catalogue (no other `luồng` value).
- `about.blurb` keeps `Local Operator`, `Team Bridge`, `Radient` and `MIT` exactly; «bộ chuyển tiếp
  của bạn» is the glossary's relay rendering carrying English's "your".
- `mobile.settings.connection.use` = «Dùng» and `refresh` = «Làm mới» follow the guide's terse verb
  labels and shipped precedent (`Làm mới thư viện`).
