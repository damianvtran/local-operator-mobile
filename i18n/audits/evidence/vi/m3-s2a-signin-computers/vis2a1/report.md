# Independent i18n audit — vi / `mobile.computers` + `mobile.signin` (M3 slice S2a, 37 keys)
- Audit id: `vis2a1` · Date: 2026-11-12 · Source commit `59ec51843f05f93706492756b1a89ef53004179a`
- Auditor: `i18n-auditor` (lopdev team), session `c7817cfa48d6`; model **`anthropic/claude-opus-5-5`** (session runtime header; no fallback observed)
- Translator: translator job 783840cce6ac. I did not translate or edit the draft; no MT service used.
- Brief sha256 `e64f41af…ba563` and draft sha256 `107beb9b…72574` recomputed: match.
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. Redaction hits: 0 in brief/draft/repo files; 0 tool display masks.
- References: vi style guide + glossary at local-operator origin/main 73dc4157 (the translator notes say no vi guide exists — true only of the mobile repo; its rules were applied here), vi catalogues at 59ec5184 for terms.

## Verdict: **PASS** (`passed`) — 0 BLOCKER, 0 MAJOR, 1 MINOR, 4 NIT

Mechanical: 37/37 keys, same order; `parseMessage`@59ec5184 parameter sets match English ({name}, `{command}`, ({module})); protected tokens intact; NFC; typography clean (spaced em dash, …, no end stop on headings).

## Findings
| ID | Sev | Key | Problem | Suggested |
|---|---|---|---|---|
| V1 | MINOR | `own_tunnel.unencrypted_body` | “in sẵn” reads as ‘pre-printed’; and “đường hầm thường …” garden-paths as ‘an ordinary tunnel’ on the screen where “http:// thường” uses thường as the adjective ‘plain’. | Để dùng địa chỉ này, hãy bật tùy chọn ở trên, hoặc nhập một địa chỉ https:// — thông thường, đường hầm sẽ in ra một địa chỉ như vậy. |
| V2 | NIT | `own_tunnel.intro` | 4× bạn in two sentences; vi style guide: drop pronouns where verbs carry the sentence. | Không cần tài khoản Radient cho bất kỳ bước nào ở đây. Bạn tự công khai máy chủ chuyển tiếp trên máy tính của mình qua một đường hầm do bạn kiểm soát, và ứng dụng kết nối với nó qua địa chỉ dán bên dưới. |
| V3 | NIT | `own_tunnel.insecure_hint` | “Chỉ cần cho địa chỉ http” is elliptical. | Chỉ cần khi dùng địa chỉ http — giao thức này gửi mật khẩu mà không mã hóa |
| V4 | NIT | `own_tunnel.insecure_off_help` | “Qua http://, … truyền qua mạng” repeats qua. | Với http://, mật khẩu chuyển tiếp truyền qua mạng mà không được mã hóa, nên tùy chọn này tắt theo mặc định. Hãy dùng https:// bất cứ khi nào địa chỉ hỗ trợ. |
| V5 | NIT | `own_tunnel.verdict_not_yet` | “Chưa được” is fine and calm but can also read ‘not allowed yet’; optional more explicit form. | Chưa kết nối được |

## Rulings (translator's uncertain keys, cross-locale traps, width)
- `mobile.signin.panel.unavailable_detail` — ACCEPT ‘trình lắng nghe loopback’: developer-facing detail beside {module}; listener→trình lắng nghe is understood, loopback kept as the recognised term.
- `mobile.computers.own_tunnel.insecure_allow` — ACCEPT ‘http:// thường’: understood as plain http in contrast to https://; pair consistent with insecure_allowed; hint/help lines carry the risk. Interaction with unencrypted_body handled by V1.
- `mobile.computers.own_tunnel.insecure_allowed` — ACCEPT (see insecure_allow).
- `mobile.computers.own_tunnel.step_test` — ACCEPT ‘Kiểm tra’: dropping the object is natural for a step heading; the button directly below says ‘Kiểm tra kết nối’.
- `mobile.computers.title.list` — ACCEPT; MEASURED 105.9 dp vs English 137.8 (Figtree SemiBold 28 dp, −0.02 em, same computation as size-class.ts doc; calibration reproduces Computers=137.8); all glyphs in Figtree.
- `mobile.computers.title.set_up` — ACCEPT ‘Thêm máy tính’ (= the Add a computer entry point, matches mobile.computers.add); MEASURED 181.7 dp vs 226.2 budget; all glyphs in Figtree. Literal ‘Thiết lập máy tính’ would be 226.9 dp with ế/ậ from fallback font.
- `mobile.computers.own_tunnel.step_publish` — ACCEPT 2.10x: StepHeader label is a wrapping Text in a flex-row beside the numeral (own-tunnel.tsx:76-85), no numberOfLines; ~21 chars fits a phone row.
- `mobile.computers.own_tunnel.testing` — ACCEPT 1.75x: same Button as ‘Kiểm tra kết nối’ (own-tunnel.tsx:250-260), shorter than that label; Button has no labelLines here so it may wrap.
- `mobile.computers.own_tunnel.public_host` — ACCEPT 1.48x: wrapping text-body-sm warning line (own-tunnel.tsx:479). Meaning: anyone/any device on the path can read the password — correct and strong.
- `mobile.computers.own_tunnel.password_label` — ACCEPT 1.43x: Input label (full width); established glossary term.
- `mobile.computers.own_tunnel.step_app` — ACCEPT 1.40x: StepHeader, wrapping.
- `mobile.computers.own_tunnel.unencrypted_body` — Length 1.38x ACCEPT (Alert body, wraps); ‘it’ correctly = the address (Để dùng địa chỉ này). Wording finding V1.
- `mobile.computers.own_tunnel.step_computer_help` — ACCEPT: loopback = from this same computer, not the local network.
- `mobile.computers.own_tunnel.insecure_off_help` — ACCEPT: ‘tắt theo mặc định’ states the default without nudging toward enabling (NIT V4 only).
- `mobile.computers.own_tunnel.security_body` — ACCEPT: ‘bật xác thực riêng của đường hầm nếu đường hầm của bạn có hỗ trợ’ is a single coherent conditional; `{command}` with backticks intact.

## Out-of-scope observation (does not gate)
Figtree-SemiBold@59ec5184 has no glyphs for the Vietnamese extended range (ư, ơ-forms, dot-below and stacked marks): 34 of 37 strings render partly in the system fallback font. This is a font-coverage issue affecting all existing vi copy, not this translation. The two width-budgeted titles use only Figtree glyphs, so their widths above are measured, not estimated.

## Per-key results
| Key | vi | Result |
|---|---|---|
| `computers.title.list` | Máy tính | pass |
| `computers.title.set_up` | Thêm máy tính | pass |
| `computers.banner.unreachable_stale` | Không thể kết nối với Radient, nên danh sách này có thể đã cũ. | pass |
| `computers.banner.unreachable_empty` | Không thể kết nối với Radient để liệt kê máy tính của bạn. Hãy kiểm tra kết nối mạng của thiết bị này. | pass |
| `computers.banner.unreadable_stale` | Không đọc được phản hồi của Radient, nên danh sách này có thể đã cũ. | pass |
| `computers.banner.unreadable_empty` | Không đọc được phản hồi của Radient, nên không thể liệt kê máy tính của bạn. | pass |
| `computers.own_tunnel.title` | Đường hầm riêng | pass |
| `computers.own_tunnel.password_for` | Nhập mật khẩu cho {name} | pass |
| `computers.own_tunnel.password_label` | Mật khẩu chuyển tiếp | pass |
| `computers.own_tunnel.intro` | Bạn không cần tài khoản Radient cho bất kỳ bước nào ở đây. Bạn tự công khai máy chủ chuyển tiếp trên máy tính của mình qua một đường hầm do bạn kiểm soát, và ứng dụng sẽ kết nối với nó qua địa chỉ bạn dán bên dưới. | finding V2 |
| `computers.own_tunnel.step_computer` | Trên máy tính | pass |
| `computers.own_tunnel.step_computer_help` | Máy chủ chuyển tiếp chỉ nhận kết nối từ chính máy tính này, nên nó phải chạy ở đây. Đừng để máy ngủ trong lúc bạn dùng ứng dụng. | pass |
| `computers.own_tunnel.step_publish` | Công khai ra internet | pass |
| `computers.own_tunnel.step_app` | Trong ứng dụng | pass |
| `computers.own_tunnel.url_label` | URL công khai | pass |
| `computers.own_tunnel.insecure_allow` | Cho phép địa chỉ http:// thường | pass |
| `computers.own_tunnel.insecure_allowed` | Đã cho phép http:// thường | pass |
| `computers.own_tunnel.insecure_hint` | Chỉ cần cho địa chỉ http — giao thức này gửi mật khẩu mà không mã hóa | finding V3 |
| `computers.own_tunnel.insecure_on_help` | Bật: mật khẩu chuyển tiếp và mọi thứ bạn gửi đi đều truyền qua mạng này mà không được mã hóa. Chỉ làm vậy trên mạng bạn tin cậy. | pass |
| `computers.own_tunnel.insecure_off_help` | Qua http://, mật khẩu chuyển tiếp truyền qua mạng mà không được mã hóa, nên tùy chọn này tắt theo mặc định. Hãy dùng https:// bất cứ khi nào địa chỉ hỗ trợ. | finding V4 |
| `computers.own_tunnel.unencrypted_title` | Địa chỉ này không được mã hóa | pass |
| `computers.own_tunnel.unencrypted_body` | Để dùng địa chỉ này, hãy bật tùy chọn ở trên, hoặc nhập một địa chỉ https:// — đường hầm thường in sẵn một địa chỉ như vậy. | finding V1 |
| `computers.own_tunnel.private_host` | Địa chỉ này nằm trong mạng riêng của bạn, nên rủi ro chỉ giới hạn trong mạng đó. | pass |
| `computers.own_tunnel.public_host` | Đây không phải địa chỉ riêng — bất kỳ ai hay thiết bị nào trên đường truyền từ điện thoại này đến địa chỉ đó đều có thể đọc được mật khẩu. | pass |
| `computers.own_tunnel.step_test` | Kiểm tra | pass |
| `computers.own_tunnel.step_test_help` | Bước này gửi một yêu cầu thật qua đường hầm của bạn trước khi lưu bất cứ thứ gì. | pass |
| `computers.own_tunnel.security_heading` | Trước khi công khai máy | pass |
| `computers.own_tunnel.security_body` | Bạn đang đưa chính máy tính của mình lên internet, và mật khẩu chuyển tiếp là thứ duy nhất bảo vệ nó. Hãy ưu tiên HTTPS, bật xác thực riêng của đường hầm nếu đường hầm của bạn có hỗ trợ, và đổi mật khẩu bằng `{command}` nếu mật khẩu đã từng bị chia sẻ. Bất kỳ ai có mật khẩu đó và URL của bạn đều có thể điều khiển các phiên trên máy đó. | pass |
| `computers.own_tunnel.test` | Kiểm tra kết nối | pass |
| `computers.own_tunnel.testing` | Đang kiểm tra… | pass |
| `computers.own_tunnel.save_connect` | Lưu và kết nối | pass |
| `computers.own_tunnel.saving` | Đang lưu… | pass |
| `computers.own_tunnel.need_address` | Dán địa chỉ đường hầm của bạn để tiếp tục. | pass |
| `computers.own_tunnel.need_test` | Hãy kiểm tra kết nối trước — đừng lưu một đường hầm chưa từng phản hồi lần nào. | pass |
| `computers.own_tunnel.verdict_ok` | Đã kết nối | pass |
| `computers.own_tunnel.verdict_not_yet` | Chưa được | finding V5 |
| `signin.panel.unavailable_detail` | Đăng nhập bằng Radient cần một trình lắng nghe loopback mà bản dựng này không có ({module}). | pass |

Ledger: not written: my task restricted writes to this directory; the manager records the ledger row and cites `audits/vi/record.json`.
