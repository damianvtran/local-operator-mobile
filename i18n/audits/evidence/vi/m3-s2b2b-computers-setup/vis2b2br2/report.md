# vi round-2 delta audit — m3-s2b2b-computers-setup (v1..v2)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT (non-gating).
Auditor: i18n-auditor (team lopdev), session 18c977d47179, anthropic/claude-opus-5-5 (system-prompt Model line; no fallback observed). Independent of translator jobs 64abbc676f27/6a9c0ad96fff and of round-1 auditor session 3c4d0d641ed3 (job 1c42dbbe4a00). No MT/translation service used.
Brief 9b37cb3d…6c67 · v1 1c68a37a…d359 · v2 5edfb40e…a755 (all recomputed, MATCH). Redaction-marker hits: brief 0, v2 0.

## Mechanical (see audit.log)
- v1→v2 changes exactly the 4 keys listed in notes-vi-v2.md (setup.intro, setup.address_help, route_invalid.insecure_off, route_invalid.no_tunnel_id); raw line diff = lines 1,17,24,26 only; other 23 keys byte-identical; key order == v1 == brief.
- All 27 values parse and format with e0027e61:src/i18n/messages.ts (parseMessage + formatMessage, locale vi, placeholder args supplied); changed keys have no placeholders, as in English.
- Changed values: 0 bidi controls, NFC, no stray spaces.

## Round-1 findings
- VI-N1 no_tunnel_id — RESOLVED as suggested ("Hãy làm mới danh sách máy tính"); matches mobile.computers.refresh "Làm mới" (computers.tsx:554).
- VI-N2 address_help — RESOLVED as suggested. "Máy chủ chuyển tiếp … có thể truy cập qua một URL" is the normal Vietnamese topic-comment passive (cf. "trang web có thể truy cập qua…"); "mật khẩu riêng của nó" unambiguously refers to the relay.
- VI-N3 insecure_off — RESOLVED as suggested; quoted label still equals own_tunnel.insecure_allow exactly (the label shown while the option is off, i.e. when this message appears). See VI-R2-N1 for a residual word-choice nit.
- VI-N4 intro — RESOLVED as suggested; "Mã nguồn của bạn không rời khỏi máy đó." states the reassurance the note asks for, natural register.

## New findings on the delta
### VI-R2-N1 (NIT) `mobile.computers.route_invalid.insecure_off`
- Current: … Hãy bật công tắc “Cho phép địa chỉ http:// thường” để tiếp tục.
- Problem: going one step past round 1: the control is rendered as a `Button` toggle (own-tunnel.tsx:476-486, own-tunnel-settings.tsx:205), not a switch widget, and the vi catalogue already calls it "tùy chọn này" (own_tunnel.insecure_off_help). "công tắc" follows the English "switch" and the quoted label still identifies the control, so this is not wrong — just slightly less consistent than it could be.
- Suggested (optional): Hãy bật tùy chọn “Cho phép địa chỉ http:// thường” để tiếp tục.

No other delta findings.
