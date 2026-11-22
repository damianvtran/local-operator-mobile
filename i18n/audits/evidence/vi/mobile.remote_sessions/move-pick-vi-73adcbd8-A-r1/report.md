# Independent Vietnamese A audit — seven move-picker keys

Audit: `move-pick-vi-73adcbd8-A-r1` · Namespace: `mobile.remote_sessions` · Frozen head: `9362cce8a631791b676b2d2c9eda90c43fc7e11c`

**Verdict: PASSED WITH MINORS; linguistic PASS; 7/7 keys read; 0 unresolved blocker/major.** Three non-gating width risks deferred. This is A only; fresh B is pending, not paired clearance. Source-hook evidence gap remains **OPEN**.

## Provenance and limits

Auditor session `73adcbd87dfe`, independent of translator `f194c81e7557`. Visible model-switch receipt changed anthropic/claude-opus-5-5 to openai/gpt-6.1-sol (provider failure: quota) before catalogue reads. Later visible session-state (2026-11-22) reports anthropic/claude-opus-5-5 before final checks/report. Both observed; no hidden provider inference. Fallback was actually used in this audit.

Human native review waived. Vietnamese-language LLM reasoning below is not human/native-speaker proof. English source/context, actual usage and existing VI remote/sidebar/computer terminology read directly. Ordinary approved filesystem reads; nested context is metadata, not routable copy; no public keyed-reader receipt.

Core glossary technical session → phiên is distinguished from the mobile conversation UI → cuộc trò chuyện. Actual remote title/health strings and sidebar empty headline support the latter; earlier technical phiên usages remain context, not a reason to translate the conversation-list help mechanically. máy tính / thiết bị / di chuyển / sao chép match their roles. Direct hãy instruction, dropped pronouns and sentence case match VI register; no T/V drift.

## Per-key side-by-side assessment

### `mobile.remote_sessions.move_pick.cannot_reach`

EN: Can't reach {device}
VI: Không thể liên lạc với {device}

“Không thể liên lạc với” diễn đạt đúng việc không liên lạc được với máy tính từ xa, không biến thành lỗi kết nối của điện thoại. Cách dùng “liên lạc” khớp mục unreachable hiện có; {device} được giữ nguyên, không thêm danh xưng hay sửa tên máy.

Verdict: passed_with_minor_width_risk. Codepoints EN/VI: 20/31; ratio 1.55. Synthetic +35% padding example (not rendered): `[Không thể liên lạc với {device}~~~~~~~~~~~]`.

### `mobile.remote_sessions.move_pick.destination_heading`

EN: Move or copy to
VI: Di chuyển hoặc sao chép tới

“Di chuyển hoặc sao chép tới” giữ đủ hai lựa chọn và giới thiệu nơi nhận ở bên dưới. Đây là tiêu đề, không khẳng định thao tác đã bắt đầu. “Di chuyển”, “sao chép” khớp lời gợi ý nhấn giữ hiện có; chữ đầu viết hoa, không có dấu chấm cuối.

Verdict: passed_with_minor_width_risk. Codepoints EN/VI: 15/27; ratio 1.8. Synthetic +35% padding example (not rendered): `[Di chuyển hoặc sao chép tới~~~~~~~~~~]`.

### `mobile.remote_sessions.move_pick.discovery_help`

EN: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
VI: Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới.

“Chỉ cho chọn” diễn đạt rõ giới hạn của danh sách, không hứa tìm thấy mọi thiết bị trong mạng. “Chưa thể” giữ nghĩa chưa chọn được ở thời điểm này. Hai bước mở Local Operator trên máy tính kia rồi kéo danh sách để làm mới đều còn nguyên; “cuộc trò chuyện” phù hợp cách gọi nội dung trong ứng dụng, không phải đổi tên một mã phiên kỹ thuật.

Verdict: passed_with_minor_width_risk. Codepoints EN/VI: 178/219; ratio 1.2303. Synthetic +35% padding example (not rendered): `[Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~]`.

### `mobile.remote_sessions.move_pick.no_answer`

EN: It did not answer when this computer asked.
VI: Máy tính đó không phản hồi yêu cầu từ máy tính này.

“Máy tính đó” là máy từ xa; “máy tính này” là máy tính chuyển tiếp đang kết nối, không phải điện thoại. “Không phản hồi yêu cầu” tự nhiên hơn việc dịch sát “asked” thành “hỏi”. Câu chỉ dùng khi không có lý do lỗi từ máy chủ; không dịch hay thay lý do đó.

Verdict: passed. Codepoints EN/VI: 43/51; ratio 1.186. Synthetic +35% padding example (not rendered): `[Máy tính đó không phản hồi yêu cầu từ máy tính này.~~~~~~~~~~~~~~~~~~]`.

### `mobile.remote_sessions.move_pick.no_devices`

EN: No other devices are visible.
VI: Không thấy thiết bị nào khác.

“Không thấy thiết bị nào khác” chỉ nói về khả năng nhìn thấy trong danh sách, không kết luận thiết bị ngoại tuyến hoặc không tồn tại. “Thiết bị” đúng thuật ngữ, câu ngắn, trung tính, không thêm lời trách hay yêu cầu.

Verdict: passed. Codepoints EN/VI: 29/29; ratio 1.0. Synthetic +35% padding example (not rendered): `[Không thấy thiết bị nào khác.~~~~~~~~~~~]`.

### `mobile.remote_sessions.move_pick.on_this_computer`

EN: On this computer
VI: Trên máy tính này

“Trên máy tính này” xác định đúng vị trí ở máy tính đang kết nối, không phải trên điện thoại. Cấu trúc “Trên…” khớp “Trên {device}” trong thanh bên; không thêm dấu chấm cuối cho nhãn trạng thái.

Verdict: passed. Codepoints EN/VI: 16/17; ratio 1.0625. Synthetic +35% padding example (not rendered): `[Trên máy tính này~~~~~~]`.

### `mobile.remote_sessions.move_pick.right_now`

EN: Right now
VI: Hiện tại

“Hiện tại” là nhãn mô tả vị trí lúc này, không phải mệnh lệnh phải làm ngay. Cách viết ngắn, trung tính, đúng kiểu viết hoa đầu câu và không có dấu chấm cuối.

Verdict: passed. Codepoints EN/VI: 9/8; ratio 0.8889. Synthetic +35% padding example (not rendered): `[Hiện tại~~~]`.

## Findings — non-gating width checks

### V1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
Current: Không thể liên lạc với {device}
Proposed: Không thể liên lạc với {device}
Reason: 31 vs 20 English codepoints (+55.0%). Source permits wrapping; counts and synthetic pseudo expansion cannot prove rendered fit.
Action: Retain accurate wording; owning visual lane should check narrow-phone wrapping/height with actual arbitrary names where applicable. No translator rewrite required by these counts.
Disposition: deferred — non-gating width check outside read-only A audit; no minor-only translation round

### V2 — minor — `mobile.remote_sessions.move_pick.destination_heading`
Current: Di chuyển hoặc sao chép tới
Proposed: Di chuyển hoặc sao chép tới
Reason: 27 vs 15 English codepoints (+80.0%). Source permits wrapping; counts and synthetic pseudo expansion cannot prove rendered fit.
Action: Retain accurate wording; owning visual lane should check narrow-phone wrapping/height with actual arbitrary names where applicable. No translator rewrite required by these counts.
Disposition: deferred — non-gating width check outside read-only A audit; no minor-only translation round

### V3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
Current: Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới.
Proposed: Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới.
Reason: 219 vs 178 English codepoints (+23.0%). Source permits wrapping; counts and synthetic pseudo expansion cannot prove rendered fit.
Action: Retain accurate wording; owning visual lane should check narrow-phone wrapping/height with actual arbitrary names where applicable. No translator rewrite required by these counts.
Disposition: deferred — non-gating width check outside read-only A audit; no minor-only translation round

## Mechanical evidence and honest boundaries

Actual stdlib command/exit/stdout/stderr are in audit.log. Brief/draft/source hashes, frozen git HEAD, exact seven-key set, EN/context parity, exact `{device}` once and six no-args checked afresh. Missing/extra/nested/renamed-argument negative controls rejected. NFC passes; zero bidi controls. No plural/select/count/date/number skeletons or markup: CLDR N/A; VI LTR: RTL N/A. Simple-message grammar checked, not repository ICU parser.

Literal substitution preserves arbitrary Vietnamese/Latin/Arabic/CJK/brace-containing device names; this is not rendering or runtime formatter proof. Local Operator stays exact Latin. Usage lines 472–485 show remoteDeviceLabel passed as opaque name and trimmed nonblank server reason wins; source read only, not hook/runtime execution.

Finite redaction scan: 0 copy hits. Two raw metadata marker-literal matches came from translator verification pattern line 94, inspected one step deeper; not redacted copy. No secret-scan/public-receipt claim.

Native fit, pixels, actual pseudo rendering, compiler/build/tests and generated projection unverified/not run by instruction. All measurements here are actual codepoint counts of source/draft strings, not native width.

## Final namespace and overall verdict

`mobile.remote_sessions` (seven move_pick keys only): 7 keys read, linguistically clean; passed_with_minors for V1–V3 deferred width verification. Context catalogue keys are supporting references, not additional audited scope. Overall A: passed_with_minors, 0 blocker/major; fresh B pending; source-hook gap OPEN; no paired or shipping clearance.
