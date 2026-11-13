# vi audit — m3s2b1 (41 mobile keys)

- Auditor: i18n-auditor (team lopdev), session caaf0d418c9d, model anthropic/claude-opus-5-5 (from the session header; no fallback observed). Independent of translator job d80b97aa3618.
- Inputs (sha256 recomputed, both match): brief-s2b1-v2.json d694b10a…88e9 · vi/draft-vi.json cfaa6ab8…e27c · source 254e6fba.
- **Verdict: PASS (`passed`)** — 0 BLOCKER, 0 MAJOR, 3 MINOR, 2 NIT.

## Mechanical (executed; output in audit.log)
- 41/41 keys, same order, none missing or extra. Each value parsed with src/i18n/messages.ts `parseMessage` (node 24 type-stripping, heap 256 MB, 0.5 s). Placeholder name+kind sets equal English for all 41, with 0 failures.
- Plurals: vi CLDR yields only `other` (checked 0,1,2,5,10,21,1e6,1.5). verdict_sessions and verdict_timeout are other-only with `#`, rendered at 0/1/2/10 (e.g. '…trong vòng 10 giây.').
- All values NFC; no bidi controls. Commands, `macOS`, `ngrok`, `Local Operator`, `HTTPS`, `URL` and placeholders untouched.

## Findings

### VIS2B1-01 — MINOR — `mobile.computers.own_tunnel.check_label`
- Current: Kiểm tra
- Problem: English distinguishes 'Check it' (lop mobile status) from the step heading 'Test it' on the same screen (own-tunnel.tsx:514). vi renders both as 'Kiểm tra', so two headings on one screen read identically, and the copy hint becomes 'Sao chép lệnh “Kiểm tra”', which does not say what is checked.
- Suggested: Kiểm tra trạng thái

### VIS2B1-02 — MINOR — `mobile.computers.own_tunnel.foreground_note`
- Current: Cho mọi nền tảng khác, hoặc nếu bạn muốn theo dõi nhật ký. Phục vụ tại {address}, chỉ trên chính máy này (loopback).
- Problem: 'Phục vụ tại {address}' is a calque of 'serves' with no subject; 'Cho mọi nền tảng khác' is stiff. Loopback meaning is right but the catalogue already says it as 'chỉ nhận kết nối từ chính máy tính này' (step_computer_help).
- Suggested: Dành cho các nền tảng khác, hoặc khi bạn muốn theo dõi nhật ký. Chạy tại {address}, chỉ nhận kết nối từ chính máy này (loopback).

### VIS2B1-03 — MINOR — `mobile.computers.own_tunnel.cloudflare_note`
- Current: Miễn phí, không cần tài khoản với đường hầm nhanh. Lệnh sẽ in ra URL {scheme} để bạn dán vào bên dưới.
- Problem: 'quick tunnel' is Cloudflare's feature name (Quick Tunnels: ad-hoc, no account). 'đường hầm nhanh' reads as 'a fast tunnel' (speed), and 'với' is a loose scope link.
- Suggested: Miễn phí và không cần tài khoản khi dùng đường hầm nhanh (quick tunnel). Lệnh sẽ in ra URL {scheme} để bạn dán vào bên dưới.

### VIS2B1-04 — NIT — `mobile.computers.own_tunnel.verdict_password`
- Current: Mật khẩu đó không được chấp nhận. Hãy kiểm tra mật khẩu chuyển tiếp trên máy tính.
- Problem: Passive 'không được chấp nhận' is a mild calque; the existing catalogue says it actively (connect_refused.password: 'Máy chủ chuyển tiếp không chấp nhận mật khẩu đó.').
- Suggested: Máy chủ chuyển tiếp không chấp nhận mật khẩu đó. Hãy kiểm tra mật khẩu chuyển tiếp trên máy tính.

### VIS2B1-05 — NIT — `mobile.computers.own_tunnel.install_note`
- Current: macOS: cài dịch vụ nền có giám sát (tự khởi động lại khi dừng), tạo mật khẩu chuyển tiếp và lưu vào Chuỗi khóa.
- Problem: 'dịch vụ nền có giám sát (tự khởi động lại khi dừng)' says the same thing twice; the parenthetical already explains 'supervised'.
- Suggested: macOS: cài dịch vụ nền tự khởi động lại khi dừng, tạo mật khẩu chuyển tiếp và lưu vào Chuỗi khóa.

## Rulings on the translator's uncertain keys
- foreground_label 'Hoặc chạy ở tiền cảnh': ACCEPT. 'tiền cảnh' is the settled vi term for foreground (vs 'nền' for background, which install_note uses), this is the advanced path, and foreground_note right below ('theo dõi nhật ký') makes the meaning clear. No change.
- copy_command_hint “{label}” quoting: ACCEPT. vi typography uses “ ”, as the catalogue does for {action}. It renders 'Sao chép lệnh “Cài đặt trên máy tính”' / '“Cloudflare”'. VoiceOver and TalkBack do not voice curly quotes. The imperative form is the norm for vi hints.
- copy/copied widths: ACCEPT. Measured from the Figtree-Medium hmtx at the token 'meta' size of 12 (sm button, paddingX 12): Copy 29→'Sao chép' 50 pt, Copied 39→'Đã sao chép' 67 pt, so 74/91 pt including padding. The label row is flex-wrap (command-block.tsx), so it fits 320 pt. The button grows 17 pt on copy, against 10 pt in English. That is not a defect.
- Figtree glyph gap: the cmap check of Figtree Regular and Medium finds 36 of the draft's 58 non-ASCII characters missing (ũưạảấầ…ự), so body text falls back per glyph to the system font. This affects every vi string in the app, not this draft, and does not gate. 'Sao chép' and 'Đã sao chép' are fully covered. The command-block headings are JetBrains Mono uppercase, which has 0 missing.
- install_note 'portal password' → 'mật khẩu chuyển tiếp': ACCEPT. It is the same secret as password_label 'Mật khẩu chuyển tiếp'.

## Cross-locale traps
- verdict_forbidden: 'bản thân máy chủ chuyển tiếp cũng từ chối yêu cầu từ mọi nguồn gốc (origin) khác' is the v2 English exactly (any other origin), not 'requests not from the tunnel'. 'nguồn gốc' is the term used in the vi same-origin policy name.
- loopback: 'chỉ trên chính máy này (loopback)' means this machine only. Correct (style suggestion in VIS2B1-02).
- verdict_tls keeps the strong 'ứng dụng sẽ không bỏ qua bước kiểm tra này'. No key nudges toward http or skipping checks.
- iOS verb 'chạm vào' and the iOS path 'Cài đặt → Quyền riêng tư & Bảo mật → Mạng cục bộ' appear only in _ios. The Android/web key uses 'nhấn'. 'có thể là do' keeps the 'may'.
- Pronouns: 'bạn' appears sparingly, per the style guide. No 'vui lòng'.
- Glossary: đường hầm, máy chủ chuyển tiếp, mật khẩu chuyển tiếp, bộ nhớ bảo mật, bảng điều khiển, phiên and Xóa (remove) match the ffbda180 catalogue. 'runtime' is kept English per the vi wave-2 call.

## Width (estimates, not rendered frames)
- No maxCells/maxChars in the brief. Only copy (2.0×) and copied (1.83×) are more than 1.3× the English length; see the rulings. Headings are uppercase mono and wrap (≤21 chars).

## Claims not made
- No rendered device frames. Widths come from font metrics. No MT or back-translation was used.
- report.md was written with the write tool. audit.log and record.json were written from the eval kernel into the same directory, because they embed the computed hashes and raw run output.
