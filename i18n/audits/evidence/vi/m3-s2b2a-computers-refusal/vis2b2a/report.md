# vi audit — m3-s2b2a computers refusal (24 keys)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 4 MINOR, 1 NIT. Auditor: i18n-auditor, session e4feb0b40788, anthropic/claude-opus-5-5 (no fallback). Translator job 1f94f733895a (independent).

Brief sha256 d151df76…0e40 and draft sha256 6bcbba45…8c0d verified. Redaction marker: brief 0, draft 0.

## Mechanical

- key set equal: True; order equal: True; count 24
- bidi controls: 0
- non-NFC values: []
- redaction marker in draft: 0; in brief: 0
- Radient preserved where in en: True
- non-ASCII-letter scan for mask chars (*,•,U+FFFD): []
- button try_now: 8 chars (en 7)
- button try_again: 7 chars (en 9)
- button sign_in_again: 13 chars (en 13)
- button open_console: 26 chars (en 24)
- button another_address: 17 chars (en 19)
- messages.ts parse+format all 24 OK, placeholder params identical to English (0 mismatches); pluralCategory(vi, 0/1/2/5/21/100)=other; wait_seconds has only 'other' with '#'

## Findings

### VI-F1 — MINOR — `mobile.computers.refusal.sign_in_title`
- Current: Phiên Radient của bạn đã hết hạn. Đăng nhập để kết nối lại với {subject}.
- Problem: 'Phiên Radient' collides with glossary session→phiên (agent sessions; catalogue uses '# phiên'); the shipped vi catalogue calls a sign-in session 'phiên đăng nhập' (mobile.settings.sign_out.*). Reader may think an agent session expired.
- Suggested: Phiên đăng nhập Radient của bạn đã hết hạn. Đăng nhập để kết nối lại với {subject}.

### VI-F2 — MINOR — `mobile.computers.refusal.relay_stopped_title`
- Current: Máy chủ chuyển tiếp không chạy trên {subject}.
- Problem: 'X không chạy trên Y' is the usual Vietnamese phrasing for incompatibility ('does not run on Y'); the English states a current state (stopped).
- Suggested: Máy chủ chuyển tiếp hiện không chạy trên {subject}.

### VI-F3 — MINOR — `mobile.computers.refusal.tunnel_gone_next`
- Current: Hãy tạo lại đường hầm trong Radient, rồi thêm máy tính này.
- Problem: 'tạo lại đường hầm' reads as re-creating the same (deleted) tunnel; context says the only fix is a NEW tunnel.
- Suggested: Hãy tạo một đường hầm mới trong Radient, rồi thêm máy tính này.

### VI-F4 — MINOR — `mobile.computers.refusal.console_next`
- Current: Hãy mở bảng điều khiển Radient để khắc phục ở đó. Đăng nhập trên điện thoại này sẽ không thay đổi được điều đó.
- Problem: Second sentence is a calque with a vague referent ('thay đổi được điều đó'), and plain 'Đăng nhập' loses the 're-sign-in' sense the note asks to say plainly; 'khắc phục ở đó' is redundant.
- Suggested: Hãy mở bảng điều khiển Radient để khắc phục. Đăng nhập lại trên điện thoại này sẽ không giải quyết được vấn đề.

### VI-N1 — NIT — `mobile.computers.refusal.sign_in_next`
- Current: Hãy đăng nhập lần nữa để kết nối lại. Những gì bạn đã nhập trước đó được cách ly và sẽ không được gửi.
- Problem: 'lần nữa' is acceptable (avoids double 'lại'), but can read as 'one more time' as if a sign-in just failed; mirroring the button label is tighter. Optional.
- Suggested: Hãy đăng nhập lại để kết nối. Những gì bạn đã nhập trước đó được cách ly và sẽ không được gửi.

## Rulings

- **sign_in_next_lan_nua**: Accepted as-is (NIT VI-N1 optional). Quarantine sentence accepted: 'được cách ly và sẽ không được gửi' keeps the not-sent promise, not softened.
- **console_next_second_sentence**: Literal; MINOR VI-F4 with replacement.
- **trinh_ket_noi**: Accepted: natural for the tunnel program, no conflict with existing catalogue (no prior 'connector' term).
- **cach_ly**: Accepted: established vi security-software term for quarantined items; meaning exact.
- **open_console_width**: Not a finding: 26 chars vs English 24 (itself at the hint). refusal-surface.tsx passes no labelLines to Button, so Text numberOfLines is undefined (wraps, never clipped/ellipsized); md button is min-h-11 px-4 (grows). Phrase is the established catalogue term.

## Accepted without finding

All other 19 keys: meaning, register (bạn-free imperative 'Hãy' body copy, bare-verb buttons), and catalogue terms (máy chủ chuyển tiếp, mật khẩu chuyển tiếp, đường hầm, bảng điều khiển Radient, tên miền, Thử ngay/Thử lại) consistent. offline_next 'đánh thức' is correct (transitive; style guide's 'thức dậy' applies to the agent waking itself). certificate_next/host_next/password_next mirror shipped own_tunnel verdicts. retry_next makes no auto-retry promise.
