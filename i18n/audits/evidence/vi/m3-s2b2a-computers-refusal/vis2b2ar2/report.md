# vi audit — round 2 (delta v1→v2) — m3-s2b2a computers refusal (24 keys)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. No new findings.
Auditor: i18n-auditor (lopdev), session 4c17c03552ee, anthropic/claude-opus-5-5 (no fallback). Independent of the translator (1f94f733895a, a4333a19e1fb) and the round-1 auditor (cbb7a592c00f / e4feb0b40788).

Hashes recomputed, all match brief: brief d151df76…0e40, v1 6bcbba45…8c0d, v2 ebffe889…5fc8. Redaction marker: brief 0, v2 0.

## Mechanical (check-vi-r2.mts via worktree tsx, exit 0; output in check.out)
- Only lines 3, 7, 13, 14, 16 differ (the 5 keys the notes list); the other 22 lines are byte-identical; key order matches v1 and the brief; 24 keys.
- messages.ts parses and formats 24/24; placeholder names and types match English and the brief's list; no bidi controls; NFC; vi plural → `other` only; Radient count unchanged (5).

## Round-1 findings
| ID | Key | v2 | Status |
|---|---|---|---|
| VI-F1 | sign_in_title | Phiên đăng nhập Radient của bạn đã hết hạn. Đăng nhập để kết nối lại với {subject}. | Resolved. Uses the catalogue's "phiên đăng nhập" (mobile.settings.sign_out.body), so it no longer reads as an agent "phiên". The repeated đăng nhập/Đăng nhập is acceptable and clearer than the alternatives. |
| VI-F2 | relay_stopped_title | Máy chủ chuyển tiếp hiện không chạy trên {subject}. | Resolved. "hiện" makes it a current state, not incompatibility. |
| VI-F3 | tunnel_gone_next | Hãy tạo một đường hầm mới trong Radient, rồi thêm máy tính này. | Resolved. Follows the note ("the only fix is a new tunnel"). |
| VI-F4 | console_next | Hãy mở bảng điều khiển Radient để khắc phục. Đăng nhập lại trên điện thoại này sẽ không giải quyết được vấn đề. | Resolved. Natural wording, and it plainly says re-signing in won't help. |
| VI-N1 | sign_in_next | Hãy đăng nhập lại để kết nối. Những gì bạn đã nhập trước đó được cách ly và sẽ không được gửi. | Resolved. Matches the button "Đăng nhập lại". The quarantine promise (will not be sent) is unchanged and not softened. "kết nối" without "lại" is fine because the headline already says "kết nối lại". |

## Delta review
I checked the 5 new values for meaning, register (imperative "Hãy" in body copy), glossary terms and width. None of them is a button, and the headlines wrap, so they fit. No new issues.
