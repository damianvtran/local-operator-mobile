# M2 vi — ROUND 2 delta audit (m2-a2-vi)
Candidate: m2-prep/vi.v3.json (33 keys). Auditor: i18n-auditor, served model anthropic/claude-sonnet-5-5 (no fallback). Independent of translator (openai/gpt-6.1-sol). No MT; no repo/ledger/candidate writes.

VERDICT: CLEAN-WITH-FINDINGS — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT.

## 1 Diff v1→v3 (python3)
Changed (8): status.not_connected; stream_idle; stream_degraded; wait.host_answering; tray.context_short; tray.context_short_estimate; region.more_below; video.title_fallback.
Added (6): region.label.{working,subagents,todos,strip}; back_to; back_to_session. Unchanged 19 (incl. app_name, fallback_name, connected_to).

## 2 Round-1 adjudication (my own recounts over mobile worktree and core vi catalogues)
- A F1 MAJOR short==long ctx: FIXED. short 13→8 cells, est. 24→19 at 100%. See m1 for the style-guide record.
- A F2 / B M1 video: FIXED, "Video". Shipped: "video" 1x (highlights.video_open "Phát video {name}"), "đoạn phim" 0x. Upheld.
- A F3 / B m2 host wait: FIXED. "Tuyến kết nối đã cấp không có nghĩa là máy tính đang chạy." Definitive, "provisioned" restored. "tuyến" = route is core-consistent ("tuyến quyết định").
- A F4 / B n1 idle: translator declined "chưa chạy" and used "rảnh" — declination UPHELD. Shipped relay.chrome.session.subtitle.idle = "Rảnh"; core uses "rảnh" 5x for the idle state. No collision with đang kết nối / hoạt động.
- B m1 not_connected: FIXED, "Không kết nối được" (settings.tsx refused branch). Distinct from no_connection "Chưa có kết nối" and offline "Ngoại tuyến". Core already uses "không kết nối được" for a failed connection (relay.health.dropped_detail).
- B m3 narrow forms: FIXED (as F1). B n2 more_below: FIXED "còn thêm bên dưới".
- B n3 "với Radient": declined — UPHELD (shipped sign_out.body "đăng nhập với lớp điều khiển").
- Manager decision stream_degraded = "Không phản hồi": corroborated by core relay.chrome.session.degraded = "Không phản hồi — tin nhắn sẽ chờ" and settings.tsx degraded→"Not answering". See n1.
- B wiring note (hard-coded "Back to ${parentName}" a11y label): now covered by back_to / back_to_session; wiring, not translation.

## 3 Fresh judgement of new/changed values
- region labels: working "hoạt động" (activity, noun), subagents "tác nhân con" (shipped status_tray.hint), todos "tác vụ" (shipped), strip "trạng thái" (shipped). Lower-case inline nouns; "tác vụ · tác nhân con bên dưới · cuộn ↓" reads naturally ("bên dưới" governs the joined list). (Shipped hint calls the band "dòng làm việc", but en here is "activity"; fine.)
- back_to "Quay lại {name}": reads with a real name ("Quay lại Kế hoạch") and with fallback "phiên"; vi has no case/article. Matches shipped common.back "Quay lại". back_to_session "Quay lại phiên": complete, sentence case, no stop, glossary term. fallback_name "phiên" unchanged, fine as bare header noun.
- connected_to + fallback: "Đã kết nối với máy tính của bạn." / "…với MacBook." both grammatical.
- narrow forms genuinely narrower: yes (-5 cells each).

## 4 Mechanical
33 keys == keys33 order; placeholders per key identical to English ({baseUrl},{host},{percent}x4,{labels},{name}); no empties; all NFC; no double spaces; English-identical only app_name (Local Operator), tray.context_short ("{percent}% ctx", abbreviation), video.title_fallback ("Video", shipped term) — all justified; glyphs · ↑ ↓ ( ) % preserved. No plural/select. No bidi (vi).

## 5 Pairs and safety
- not_answering "Không phản hồi" byte-identical to shipped relay.chrome.session.subtitle.not_answering (mobile+core); stream_degraded same string, so pill and diagnostic agree.
- no_connection "Chưa có kết nối" / not_connected "Không kết nối được" / offline "Ngoại tuyến" (same as core drawer.status) are three distinct states; closeness of the last two is tolerable (refused attempt vs dropped stream).
- Terse labels safe; no destructive text. Host-wait sentence can no longer be read as "machine is up".

## Findings
- m1 MINOR `mobile.session.tray.context_short` = "{percent}% ctx" and `context_short_estimate` = "{percent}% ctx (ước tính)". "ctx" ships 0x in either vi catalogue and is not on the style guide's kept-English list or glossary; the translator's glossary "proposal" is not binding. The en note allows it and it resolves the width finding, so I do not gate, but the exception must be recorded in i18n/style-guides/vi.md when landing (e.g. "ctx only in <340 pt context readouts; wide form stays ngữ cảnh"), else it is an unrecorded deviation. Rendered 320 pt proof remains QA/design scope.
- n1 NIT `mobile.settings.diagnostics.stream_degraded` = "Không phản hồi": capital K in a lower-case monospace row (siblings "rảnh", "đang kết nối", "hoạt động", "ngoại tuyến"); two words vs the note's "one word". Manager-mandated byte-identity exception — acceptable; I would prefer "không phản hồi" but do not request it.

No finding on: not_signed_in, route_*, status.*, wait.answering, tray.context/_estimate, region.end/below_labels, app_name.
