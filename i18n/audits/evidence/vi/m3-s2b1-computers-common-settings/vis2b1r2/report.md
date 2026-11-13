# vi audit — m3s2b1, round 2 (delta)

- Auditor: i18n-auditor (team lopdev), session e23e709d05bd, model anthropic/claude-opus-5-5 (from the session header; no fallback observed). Independent of translator jobs d80b97aa3618/e3845b29c3ef and round-1 auditor bf6ecb5a2e64.
- Inputs: sha256 recomputed for all three, and all three match. brief-s2b1-v2.json d694b10a…88e9 · vi/draft-vi.json (v1) cfaa6ab8…e27c · vi/draft-vi-v2.json b0307e5a…1002 · source 254e6fba (feat/i18n-m3-s2b1).
- **Verdict: PASS (`passed`)**. 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT new. All 5 round-1 findings are resolved.

## 1. Delta proof (executed; see audit.log)
- The brief, v1 and v2 each have 41 keys in the same order, with none added or dropped.
- Exactly 5 values differ: check_label, install_note, foreground_note, cloudflare_note and verdict_password. These are the 5 keys named in notes-vi-v2.md.
- The other 36 keys are byte-equal to v1, which the round-1 audit passed. They were not re-audited.
- Each v2 value is byte-identical to the round-1 report's "Suggested:" line for its finding (5/5 True).

## 2. Changed keys
These were parsed with src/i18n/messages.ts `parseMessage`/`formatMessage` on Node 24 with a 256 MB heap. Placeholder name and kind sets equal the English, with 0 failures. No changed key has a plural. All values are NFC with no bidi controls.

| Key | v2 | Ruling |
|---|---|---|
| check_label | Kiểm tra trạng thái | OK. 'Check it' runs `lop mobile status`, so "check the status" is accurate and stays a short imperative heading with no full stop. It is now distinct from step_test 'Kiểm tra' (vi catalogue l.101), and the hint reads 'Sao chép lệnh “Kiểm tra trạng thái”'. |
| install_note | macOS: cài dịch vụ nền tự khởi động lại khi dừng, tạo mật khẩu chuyển tiếp và lưu vào Chuỗi khóa. | OK. 'Supervised daemon' becomes a background service that restarts itself when it stops, which is the context note's own definition. 'Chuỗi khóa' is Apple's vi term. `macOS` is kept. |
| foreground_note | Dành cho các nền tảng khác, hoặc khi bạn muốn theo dõi nhật ký. Chạy tại {address}, chỉ nhận kết nối từ chính máy này (loopback). | OK. Meaning holds, including loopback = reachable from this computer only. {address} stays intact and LTR, rendering '127.0.0.1:4098'. 'máy này' vs step_computer_help's 'máy tính này' is ordinary vi shortening and does not gate. |
| cloudflare_note | Miễn phí và không cần tài khoản khi dùng đường hầm nhanh (quick tunnel). Lệnh sẽ in ra URL {scheme} để bạn dán vào bên dưới. | OK. The '(quick tunnel)' gloss pins Cloudflare's feature name, and 'khi dùng' scopes the free/no-account claim correctly. {scheme} renders 'https://'. |
| verdict_password | Máy chủ chuyển tiếp không chấp nhận mật khẩu đó. Hãy kiểm tra mật khẩu chuyển tiếp trên máy tính. | OK. The added agent 'máy chủ chuyển tiếp' is exactly the context ('the relay refused the password'). It matches connect_refused.password (vi l.30). Plain, no apology. |

## 3. Round-1 findings
- VIS2B1-01 (MINOR) check_label: **resolved**. The same-screen heading collision with step_test is gone.
- VIS2B1-02 (MINOR) foreground_note: **resolved**. The 'Phục vụ tại' calque is replaced, and the loopback wording now reuses the catalogue's.
- VIS2B1-03 (MINOR) cloudflare_note: **resolved**. It no longer reads as 'fast tunnel'.
- VIS2B1-04 (NIT) verdict_password: **resolved**. It is in the active voice.
- VIS2B1-05 (NIT) install_note: **resolved**. The redundancy is removed.
- There were no rejections to rule on: the translator accepted all 5.

## 4. check_label fit
- **Correction to the brief's premise:** check_label is not rendered in own-tunnel-settings.tsx. That file imports neither tunnel-commands.ts nor CommandBlock. The key's only code references are tunnel-commands.ts:41/88. COMPUTER_COMMANDS is rendered on the "Your own tunnel" screen (own-tunnel.tsx:415) through `CommandBlock`.
- In CommandBlock the label is `text-mono-label uppercase` (JetBrains Mono SemiBold 11 px, letter-spacing 0.06em). It sits in a `flex-row flex-wrap … justify-between` row with the Copy button.
- Measured from font metrics, these are estimates and not rendered frames:
  - 'KIỂM TRA TRẠNG THÁI' is 137.9 pt at 100 %, against 58.1 pt for 'CHECK IT'.
  - At 100 % on a 320 pt phone (288 pt content after px-4), label + 8 gap + Copy (~74 pt) ≈ 220 pt fits on one row.
  - At 200 % the label is 275.9 pt and fits alone on its own line. The Copy button wraps below it, which is the designed behaviour (command-block.tsx doc, U-06).
  - Text that is still narrower wraps the label inside the Text and does not clip it.
- The JetBrains Mono SemiBold cmap covers every glyph: 0 missing (Ể, Ạ, Á).
- Result: it wraps and never clips. Not a defect.

## Claims not made
- No rendered device frames: widths come from font metrics only.
- No MT or back-translation was used. The 36 unchanged keys were proved equal, not re-judged.
- Redaction hits: 0 in the inputs. No input read showed the harness masking marker. The single write-tool notice came from this report quoting the marker literally, and that line was reworded.
