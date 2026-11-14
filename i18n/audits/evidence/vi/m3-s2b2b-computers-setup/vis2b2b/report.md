# vi audit — m3-s2b2b-computers-setup (27 keys)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 4 NIT.
Brief sha256 9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67 · draft sha256 1c68a37a66d0442e774bd0081314503a4d0d1c341cedada3637174536abfd359 · translator job 64abbc676f27 · auditor i18n-auditor, session 3c4d0d641ed3, anthropic/claude-opus-5-5 (no fallback). Redaction-marker hits in brief: 0.

## Mechanical
27/27 keys, same order; placeholder sets identical; all parse and format with messages.ts; vi CLDR = other only, no plural arms in slice; 0 bidi controls; NFC; no stray spaces. See audit.log.

## Rulings
- **terminal_label 'Terminal' / create_help 'terminal'** — ACCEPT. Standard loanword in Vietnamese developer usage; vi catalogue already keeps 'shell', 'loopback'. Label is not text-transformed (no textTransform in src), so renders 'Terminal'.
- **tunnel_id_label 'ID đường hầm'** — ACCEPT. 'ID' + noun is the normal Vietnamese UI pattern; 12 chars on a field label, no fit risk.
- **attach_label 'Gắn' / attach_title 'Gắn đường hầm có sẵn'** — ACCEPT. 'gắn' is the established rendering of attach (gắn thẻ, gắn vào); one syllable suits the label; copy hint reads 'Sao chép lệnh “Gắn”', coherent.
- **query 'chuỗi truy vấn (query string)' / 'phân đoạn (fragment)'** — ACCEPT. Usual vi technical terms, English gloss follows catalogue precedent 'nguồn gốc (origin)', 'đường hầm nhanh (quick tunnel)'. Help text wraps; 75 chars fine.
- **no_tunnel_id 'cấp lại phiên đăng nhập'** — ACCEPT. Matches the note (re-mint = issue a new session token / renew its sign-in) and the catalogue's 'phiên đăng nhập' (refusal.sign_in_title).
- **address_title 'Kết nối bằng địa chỉ'** — ACCEPT. Drops 'instead' but the card is the third of three routes, so the contrast is carried by layout; avoids collision with refusal.another_address 'Dùng địa chỉ khác'.
- **ran_it 'Tôi đã chạy lệnh — kết nối' width** — ACCEPT. 26 code points vs 24 English; at ~15-17 pt that is roughly 200-230 pt, inside a full-width 320 pt button. First person 'Tôi' matches note and catalogue 'của tôi'. Sibling 'Đang chờ đường hầm' (18) also fits.
- **your_computer 'Máy tính của bạn'** — ACCEPT as sentence-initial fallback (same string as list.heading). Mid-sentence capital 'M' is the known CODE item (added.fallback_name is lowercase); not failed here per brief.

## Findings
### VI-N1 (NIT) `mobile.computers.route_invalid.no_tunnel_id`
- Current: Đường hầm này không có ID, nên không thể cấp lại phiên đăng nhập của nó. Hãy tải lại danh sách máy tính.
- Problem: 'tải lại' is fine, but the Computers screen's visible refresh button is 'Làm mới' (mobile.computers.refresh, computers.tsx:554); naming the same verb points the reader at the control. Reserved surface, low visibility.
- Suggested: Đường hầm này không có ID, nên không thể cấp lại phiên đăng nhập của nó. Hãy làm mới danh sách máy tính.

### VI-N2 (NIT) `mobile.computers.setup.address_help`
- Current: Nếu máy chủ chuyển tiếp của bạn truy cập được qua một URL bạn đã biết, hãy kết nối tới đó bằng mật khẩu riêng của máy chủ chuyển tiếp. Đây là cách dành cho máy hoàn toàn không dùng Radient.
- Problem: 'máy chủ chuyển tiếp của bạn truy cập được qua' is a slightly stiff agentless construction, and 'máy chủ chuyển tiếp' repeats within one sentence.
- Suggested: Nếu máy chủ chuyển tiếp của bạn có thể truy cập qua một URL mà bạn đã biết, hãy kết nối tới đó bằng mật khẩu riêng của nó. Đây là cách dành cho máy hoàn toàn không dùng Radient.

### VI-N3 (NIT) `mobile.computers.route_invalid.insecure_off`
- Current: Địa chỉ này không được mã hóa, nên mật khẩu chuyển tiếp sẽ truyền qua mạng ở dạng văn bản thường. Hãy bật “Cho phép địa chỉ http:// thường” để tiếp tục.
- Problem: Quoting the on-screen label exactly is correct (matches own_tunnel.insecure_allow); adding 'công tắc' tells the reader the quoted text is a toggle to flip, as the English 'switch' does.
- Suggested: Địa chỉ này không được mã hóa, nên mật khẩu chuyển tiếp sẽ truyền qua mạng ở dạng văn bản thường. Hãy bật công tắc “Cho phép địa chỉ http:// thường” để tiếp tục.

### VI-N4 (NIT) `mobile.computers.setup.intro`
- Current: Ứng dụng này điều khiển các phiên trên chính máy tính của bạn, nên máy tính đó cần chạy trình kết nối và luôn thức. Mã nguồn của bạn vẫn nằm trên máy.
- Problem: 'Mã nguồn của bạn vẫn nằm trên máy' is accurate but neutral; the note says the sentence reassures that code never leaves the computer.
- Suggested: Ứng dụng này điều khiển các phiên trên chính máy tính của bạn, nên máy tính đó cần chạy trình kết nối và luôn thức. Mã nguồn của bạn không rời khỏi máy đó.

## Keys reviewed without finding
All other 23 keys: meaning, register (polite 'Hãy …' imperatives, 'bạn'), and catalogue terms (máy chủ chuyển tiếp, mật khẩu chuyển tiếp, đường hầm, bảng điều khiển Radient, trình kết nối, phiên đăng nhập, truy cập từ xa, thanh toán) consistent; Radient, Local Operator, TUI kept Latin.
