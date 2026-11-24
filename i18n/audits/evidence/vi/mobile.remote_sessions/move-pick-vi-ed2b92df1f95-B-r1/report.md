# Vietnamese independent fresh B audit

Allocation: bounded hotfix audit (≤12 min). Read-only frozen source `9362cce8a631791b676b2d2c9eda90c43fc7e11c`. Scope: seven new `mobile.remote_sessions.move_pick.*` values only.

## Verdict
`mobile.remote_sessions` scoped slice: **PASS with three minor deferred width risks**; 7/7 target keys read side by side with actual English/context and PickBody usage. **0 unresolved blocker/major**. Overall verdict applies only to these seven values, not the namespace’s existing keys or whole-app translation programme.

Independent B actor: `ed2b92df1f95`; author `f194c81e7557`, A `73adcbd87dfe`. A conclusions are not evidence for this judgment. Serving-model verified receipt: **UNKNOWN**; visible fallback notice says **openai/gpt-6.1-sol** after quota failure of anthropic/claude-opus-5-5. No independent serving receipt claimed. Human-native review waived; this is LLM review.

## Per-key linguistic reasoning

### `mobile.remote_sessions.move_pick.cannot_reach` — linguistic PASS
- English: Can't reach {device}
- Current Vietnamese: Không thể liên lạc với {device}
- Reason: Không thể liên lạc với is natural neutral status language and matches mobile.remote_sessions.unreachable; the opaque computer name is neither translated nor given an added classifier.

### `mobile.remote_sessions.move_pick.destination_heading` — linguistic PASS
- English: Move or copy to
- Current Vietnamese: Di chuyển hoặc sao chép tới
- Reason: Di chuyển and sao chép exactly match row_long_press_hint. Hoặc preserves the alternatives, and tới naturally introduces destination radio choices without claiming an operation is underway.

### `mobile.remote_sessions.move_pick.discovery_help` — linguistic PASS
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Current Vietnamese: Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới.
- Reason: The first sentence limits choices to devices with visible conversations, not all network devices. Chưa thể preserves not yet; máy tính kia explicitly means the other computer. Mở Local Operator and kéo danh sách ... để làm mới retain both ordered recovery actions. Cuộc trò chuyện follows the app’s user-facing conversation framing; it does not redefine technical session identifiers.

### `mobile.remote_sessions.move_pick.no_answer` — linguistic PASS
- English: It did not answer when this computer asked.
- Current Vietnamese: Máy tính đó không phản hồi yêu cầu từ máy tính này.
- Reason: Máy tính đó is explicitly the remote computer; yêu cầu từ máy tính này retains the connected computer as requester, not the phone. Không phản hồi is established in sidebar and computer reachability copy. The missing past marker does not change the contextual status meaning in Vietnamese.

### `mobile.remote_sessions.move_pick.no_devices` — linguistic PASS
- English: No other devices are visible.
- Current Vietnamese: Không thấy thiết bị nào khác.
- Reason: Không thấy ... nào khác reports visibility, not nonexistence or offline status. Thiết bị agrees with the device glossary.

### `mobile.remote_sessions.move_pick.on_this_computer` — linguistic PASS
- English: On this computer
- Current Vietnamese: Trên máy tính này
- Reason: Trên máy tính này matches the computer catalogue framing and remote Trên {device}; it avoids calling the relay a phone.

### `mobile.remote_sessions.move_pick.right_now` — linguistic PASS
- English: Right now
- Current Vietnamese: Hiện tại
- Reason: Hiện tại is an idiomatic section heading for present location, not an imperative meaning act immediately.

## Register and glossary
Plain verbs, dropped pronouns and sentence case match the bạn guide; no anh/chị or quý khách switch, gratuitous vui lòng, title case or exclamations. Máy tính / thiết bị / di chuyển / sao chép match actual computer, sidebar and remote-session catalogue entries. The generic core glossary says session → phiên; this mobile source uses conversation framing in titles, sidebar hints and remote-session prose, so cuộc trò chuyện in this user-facing help is appropriate under the task context, not a new technical term. Existing mobile copy also uses phiên for technical/list contexts; no claim of whole-app terminology remediation is made.

## Findings — no linguistic blocker/major

### VI-B1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
- Current: Không thể liên lạc với {device}
- Proposed: Không thể liên lạc với {device} (retain; rendered check rather than speculative shortening)
- Reason: Source template expands from 20 English to 31 Vietnamese Unicode codepoints (1.55x). This is an overflow RISK proxy, not a demonstrated clipping defect or native-fit result.
- Translator recommendation: Retain current wording pending rendered narrow-phone wrapping check; do not edit solely on this proxy. Collect all B reports before any edits.
- Disposition: deferred — rendered/native width validation outside this audit

### VI-B2 — minor — `mobile.remote_sessions.move_pick.destination_heading`
- Current: Di chuyển hoặc sao chép tới
- Proposed: Di chuyển hoặc sao chép tới (retain; rendered check rather than speculative shortening)
- Reason: Source template expands from 15 English to 27 Vietnamese Unicode codepoints (1.8x). This is an overflow RISK proxy, not a demonstrated clipping defect or native-fit result.
- Translator recommendation: Retain current wording pending rendered narrow-phone wrapping check; do not edit solely on this proxy. Collect all B reports before any edits.
- Disposition: deferred — rendered/native width validation outside this audit

### VI-B3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
- Current: Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới.
- Proposed: Ứng dụng chỉ cho chọn những thiết bị có cuộc trò chuyện đang hiển thị. Chưa thể chọn thiết bị không có cuộc trò chuyện nào hiển thị — hãy mở Local Operator trên máy tính kia rồi kéo danh sách cuộc trò chuyện để làm mới. (retain; rendered check rather than speculative shortening)
- Reason: Source template expands from 178 English to 219 Vietnamese Unicode codepoints (1.23x). This is an overflow RISK proxy, not a demonstrated clipping defect or native-fit result.
- Translator recommendation: Retain current wording pending rendered narrow-phone wrapping check; do not edit solely on this proxy. Collect all B reports before any edits.
- Disposition: deferred — rendered/native width validation outside this audit

## Dependency-free integrity and limits
All 66 assertions passed: exact frozen HEAD; English/context/usage hashes match approved brief; every draft-recorded input hash matches current bytes; exact seven keys; placeholder parity; NFC; no bidi controls; exactly one textual t call per key; Latin Local Operator unchanged; static server-reason precedence and opaque device handoff. Logs contain actual assertions and outputs, not test/build claims.
ICU/CLDR: simple-message N/A. {device} occurs once only in cannot_reach; other six are argument-free. No plural arms, number/date skeletons, count usage or markup to preserve. RTL N/A for vi. Explicit redaction-marker pattern has zero matches in copy and separately in context metadata; no broad secret-scan claim.

Actual codepoint measurements (EN → VI; Unicode templates, not pixels):
- `mobile.remote_sessions.move_pick.cannot_reach`: 20 → 31, 1.55x.
- `mobile.remote_sessions.move_pick.destination_heading`: 15 → 27, 1.8x.
- `mobile.remote_sessions.move_pick.discovery_help`: 178 → 219, 1.23x.
- `mobile.remote_sessions.move_pick.no_answer`: 43 → 51, 1.186x.
- `mobile.remote_sessions.move_pick.no_devices`: 29 → 29, 1.0x.
- `mobile.remote_sessions.move_pick.on_this_computer`: 16 → 17, 1.062x.
- `mobile.remote_sessions.move_pick.right_now`: 9 → 8, 0.889x.

PickBody source uses wrapping-capable Text with no numberOfLines restriction in the inspected slice; that is not rendered-fit proof. Arbitrary device names can be longer than the template. No pseudo-render, browser/native run, testsuite, compiler, build, install, hook, commit or push was performed.

## Provenance / gate boundaries
Approved brief SHA-256: `5a72dfd72dc820b1fa8e73d78b97807581572334ee0fd25eb2eab346e759ebca`.
Draft SHA-256: `2194c4313e6d44521537042c9c4b33ab4275a08b746906691e2c003779ac1cb5`. All consulted file hashes are in record.json.
Ordinary approved filesystem reads; nested context is metadata, not routable public copy; no faked public-reader receipt. Source hook gap remains **OPEN**, as reported in manager ledger. **NOT SHIPPING. Paired audit awaits parent verification** of both independent reports and unchanged bytes. No repository edits made.
