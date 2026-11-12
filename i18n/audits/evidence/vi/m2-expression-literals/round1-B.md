# M2 vi audit — Lane B (independent)
Candidate: m2-prep/vi.v1.json (27 keys). Auditor served model: anthropic/claude-sonnet-5-5 (no fallback). Ledger and repo untouched.

Verdict: CHANGES-REQUESTED (1 MAJOR, 3 MINOR, 3 NIT; 0 BLOCKER)

Mechanical (python3): key set/order == keys27 (27); placeholders identical ({baseUrl},{host},{percent}x4,{labels}); no empties; NFC all; no English-identical except app_name (deliberate); glyphs · ↑ ↓ % ( ) … preserved with equal counts; final-stop parity; no bidi controls / double spaces.

## MAJOR
M1 mobile.session.video.title_fallback — "Đoạn phim" -> "Video". Shipped vi catalogue (grep over catalogues/vi/*.json) renders the noun as "video" once (mobile.session.highlights.video_open "Phát video {name}"), never "đoạn phim"/"clip". User taps "Phát video …" and lands on a screen headed "Đoạn phim". "Video" is the settled vi UI term; "đoạn phim" = footage/clip, longer. Source role=heading, one word.

## MINOR
m1 mobile.settings.status.not_connected — "Chưa kết nối" is near-identical to no_connection "Chưa có kết nối"; "chưa" = "not yet", but source meaning is "chosen computer REFUSED the connection". Suggest "Không kết nối được".
m2 mobile.computers.wait.host_answering 2nd sentence — "Có tuyến kết nối chưa có nghĩa là máy tính đang chạy." drops "provisioned"; "Có tuyến…" first parses as existential. Suggest "Tuyến kết nối đã được cấp không đồng nghĩa với việc máy tính đang chạy." Meaning survives; not wrong.
m3 mobile.session.tray.context_short / context_short_estimate — identical to long forms. Allowed by note and consistent with shipped "Ngữ cảnh", but the <340pt variants save no width (est. ≈28 chars with 3-digit percent). Fit risk only; QA should render a 100% est. at 320pt.

## NIT
n1 stream_idle "chờ" reads standby/waiting (shipped "đang chờ" = queued); "chưa chạy" matches "no live stream has started". Acceptable.
n2 region.more_below "còn nữa bên dưới" — "còn thêm bên dưới" slightly more idiomatic.
n3 account.not_signed_in "Chưa đăng nhập với Radient" — "đăng nhập Radient" is the usual collocation; "với" is consistent with shipped sign_out.body, so acceptable.

## Checked, no finding
- connected_to + fallback_name: "Đã kết nối với {name}." + "máy tính của bạn" -> "Đã kết nối với máy tính của bạn." grammatical (no case/article in vi).
- Stream tokens lower-case, pill labels sentence-case. connected "Đã kết nối"; not_answering "Không phản hồi" (= shipped relay.chrome.session.subtitle.not_answering); offline "Ngoại tuyến"; connecting "đang kết nối" (= shipped badge.connecting); live "hoạt động" (= shipped badge.active).
- context -> "ngữ cảnh" matches shipped (composer.more, row_usage); "ước tính" for est.; route "tuyến kết nối", tunnel "đường hầm" match M1 v2 and shipped.
- session -> "phiên" per style guide. Wiring note (not a translation defect): "Back to ${parentName}" accessibilityLabel in session/[id]/video.tsx:172 and agent/[jobId].tsx:92 is still a hard-coded English template on the M2 branch, so vi screen readers would hear "Back to phiên"; outside this key set.
