# Slice-level companion — audit `vi1111m1a`, locale `vi`, mobile M1 slice A (53 keys)

This is the slice-wide report. The tracked per-namespace records live in
`i18n/audits/evidence/vi/{mobile.common,mobile.computers,mobile.session,mobile.settings}/vi1111m1a/`,
each holding its own `record.json`, `report.md` and the shared `audit.log`.
Below: the full slice report as written by the auditor.

# Independent audit — `vi`, mobile slice M1 (53 phone-app keys), auditor A

**Verdict: clean-with-findings — 0 BLOCKER, 0 MAJOR, 2 MINOR, 3 NIT.**
Ledger status therefore `passed` (a `passed` row requires zero unresolved BLOCKER/MAJOR).
Translations were audited, never edited. No translation API, SDK or MT service was used;
every judgement below is reasoning over the strings themselves.

## Provenance

| | |
| --- | --- |
| locale | `vi` |
| slice | M1 — 53 new phone-app keys, translator `openai/gpt-6.1-sol` (as reported by the manager; not observed by this auditor) |
| auditor agent | `i18n-auditor (lopdev team)` |
| session | `2b8bafe5512c` |
| served model | `deepseek/deepseek-flash` (session header; no fallback notice appeared in this transcript) |
| independent from translator | yes — different agent, session and model; the translator's run was not observed, so independence is agent/session/model-level only |
| audit date | 2026-11-11 |
| mobile head | `84c4bee109d048e3dad0f996921e1b8ed561dfc8` (`i18n-app-scan` worktree, clean before this audit) |

Inputs, as hashed at audit time:

| role | path | sha256 |
| --- | --- | --- |
| English + per-key context (slice) | `<scratch>/m1-prep/keys.json` | `1f0f346e5595ae4c26e7b397ba6f96c7bc797dfc453798934f019f82a5879ed8` |
| target translations (slice) | `<scratch>/m1-prep/vi.json` | `34f5d012cff565d79e3b66cb02cfd34a49ffef81c76844c889ace048beca6de9` |
| en catalogue (repo, per namespace) | `<repo>/src/i18n/catalogues/en/mobile.{common,computers,session,settings}.json` | see each bundle's `record.json` |
| en context sidecar (repo) | `<repo>/src/i18n/catalogues/en/mobile.<ns>.context.json` | see each bundle's `record.json` |
| landing target (repo, English placeholders today) | `<repo>/src/i18n/catalogues/vi/mobile.<ns>.json` | see each bundle's `record.json` |

Style authority read first: `i18n/style-guides/vi.md`, `i18n/style-guides/en.md`,
`i18n/glossary.md`, `docs/i18n.md` (mobile), then the English source with its context
notes, then the translation, then the shipped `vi` catalogues for consistency.

## Findings

### viA-M1 — MINOR — `mobile.settings.sign_out.body`

- Current: `Thao tác này kết thúc phiên với hệ thống điều khiển và xóa thông tin phiên trên điện thoại, nên đường hầm sẽ ngừng nhận yêu cầu từ điện thoại này. Máy tính không bị ảnh hưởng.`
- English: "This ends the session with the control plane as well as forgetting it here, so the tunnel stops accepting requests from this phone. Your computer is not touched."
- Problem: all three claims survive, and the safety-relevant reassurance ("Máy tính không bị ảnh hưởng") is intact — so this is not a meaning defect. The term is: «hệ thống điều khiển» ("control system") is invented for *control plane*. It has no glossary row and no precedent in the shipped `vi` catalogue, and it shares its head noun with «bảng điều khiển», which this same catalogue uses five times for the *Radient console/dashboard* (`mobile.computers.billing_help`, `disabled_help`, `harness_help`, `mobile.team_bridge.gate.console_error`, `manage_plan`). On this very screen the delete-account copy also says «bảng điều khiển Radient», so a reader can take the sign-out sentence as being about the console.
- Suggested: keep the architecture term Latin — `phiên với control plane` — or use «lớp điều khiển»; either way record the call in `i18n/style-guides/vi.md` (wave-2 style, alongside `runtime`, `host`, `mesh`) so the next wave does not re-invent it. Cheapest resolution is a guide row plus a one-word swap; the sentence otherwise stands.

### viA-M2 — MINOR — `mobile.session.not_connected.next`

- Current: `Mở phiên từ danh sách sau khi kết nối máy tính.`
- English: "Open it from the session list once a computer is connected."
- Problem: "the session list" loses its noun — the value says "from the list". Impact is low (there is one list), but it breaks a pattern this catalogue already fixes: the shipped copy always names the noun (`danh sách máy tính`, `danh sách mô hình`, `danh sách người`, `danh sách cuộc trò chuyện`), and two sibling keys in this same slice say «danh sách phiên» (`mobile.common.not_found.action`, `mobile.common.not_found.next`). A noun-less "danh sách" is the one string in the slice that does not.
- Suggested: `Sau khi kết nối máy tính, mở lại từ danh sách phiên.` (keeps «Mở lại», the shipped word for reopening a session, and avoids «phiên … phiên» repetition).

### viA-N1 — NIT — `mobile.computers.wait.nothing_answered_help`

- Current: `Đã ba phút mà chưa thấy đường hầm nào và không có máy tính nào phản hồi. …`
- English: "Three minutes with no tunnel listed and no host answering. …"
- Problem: "no tunnel *listed*" becomes "haven't seen any tunnel". Same practical reading, but the panel's point is that the *list stayed empty*, not that the user failed to look.
- Suggested: `Đã ba phút mà danh sách vẫn không có đường hầm nào và không máy tính nào phản hồi.`

### viA-N2 — NIT — `mobile.session.find.label`

- Current: `Tìm trong cuộc trò chuyện này`
- English: "Search this conversation" (accessibility name of the header find button).
- Problem: the shipped catalogue's search vocabulary is «Tìm kiếm» (`relay.chrome.list.search_open`, `relay.chrome.list.search_label` "Tìm kiếm cuộc trò chuyện"). «Tìm» is the shorter verb and matches the key name, so this is a consistency nit, not an error — and the label is read aloud, so the extra three characters cost nothing on screen.
- Suggested: `Tìm kiếm trong cuộc trò chuyện này`.

### viA-N3 — NIT — `mobile.session.subagent.prompt_label` (no change recommended)

- Current: `prompt`, sitting beside its sibling `kết quả` (`result_label`).
- Problem: it is the only English-identical value in the 53 keys, so it will show up in any mechanical sweep of the "no English anywhere" acceptance criterion. It is correct: `i18n/glossary.md` §2 fixes `prompt` → «prompt» for `vi`, and the `vi` guide's kept-English list repeats it. Recorded so nobody "fixes" it into «lời nhắc» and breaks the glossary; the mixed-language label pair is glossary-mandated, not translator drift.

## Mechanical results

Command output for every row is in this bundle's `audit.log` (actual execution log, not notes).

| Check | Result |
| --- | --- |
| keys present / added / dropped | 53 / 0 / 0; key order byte-identical to the source list |
| JSON validity | both files valid (`jq empty`) |
| ICU argument sets per key | identical to source for all four parameterised keys: `{sessions}`; `{version}`; `{version}` + `{sessions}`; `{percent}` ×2 — no renamed, added or dropped argument |
| plural / select structure | 2 plural keys, 1 `other` arm each, `#` inside the arm only; **no** `one`/`few`/`many`/`zero` arm — correct for `vi` CLDR (`other` only) and for the `vi` guide's plural rule |
| braces | balanced 2/2 and 3/3 on the plural keys, 1/1 on the `{version}`/`{percent}` keys; no stray `#` outside an arm |
| empty or whitespace-only values | 0 |
| English-identical values | 1 (`viA-N3`, glossary-mandated) |
| combining marks / NFC | 0 code points in U+0300–U+036F — all Vietnamese diacritics are precomposed |
| bidi / format controls | 0 code points in U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, no BOM, no NBSP/NNBSP |
| punctuation | no ASCII `...`, no `!`, no double spaces, no leading/trailing space; em dash is " — " with spaces (guide rule) |
| staged English freshness | all 53 staged English values byte-identical to `en/<ns>.json` at head `84c4bee1` — audited against the source that will land |
| placement | all 53 keys already exist in the shipped `vi` catalogues as English placeholders — this is a replacement, not an addition; nothing to add or drop |
| repo validator | `npm run -s i18n:check` at `84c4bee1`: *catalogue.gen.ts is current (649 keys, 21 namespaces…)*, check-strings 212 findings all baselined, 0 new — the head is green **before** these values land; the validator does not yet read the staged values, and I did not apply them (that is the implementer's commit) |

## Width (phone UI; no rendered capture — see Limits)

`vi` runs shorter than English for this slice almost everywhere (largest shrink −12 chars,
`mobile.session.not_connected.next`); no `maxCells`/`maxChars` hint exists in the sidecar for
any of the 53 keys. The growth cases:

| key | role | en → vi | assessment |
| --- | --- | --- | --- |
| `mobile.settings.account.delete_help` | help | 191 → 227 | help paragraph, wraps; the destructive-action warning stays in its own sentence |
| `mobile.settings.about.blurb` | help | 154 → 174 | help paragraph, wraps |
| `mobile.computers.wait.nothing_answered_help` | help | 115 → 135 | help paragraph, wraps |
| `mobile.computers.wait.relay_version` | help | 45 → 63 | one line at phone width (~60 chars), wraps if the count variant is used — same as English behaviour |
| `mobile.settings.sign_out.body` | confirm | 161 → 175 | dialog body, wraps |
| `mobile.common.not_found.action` | button | 16 → 24 | widest empty-state primary action; at 16 sp ≈ 175 dp, fits a full-width or auto-width button on a 320 pt screen — no truncation risk. Not the longest label in the slice (`account.delete` and `find.label` reach 29; `find.label` is an accessibility name, never drawn) |
| `mobile.session.find.label` | button | 24 → 29 | accessibility name only, never drawn |

No string in the slice is at risk of overflowing a fixed-width control. Without a rendered
capture this is a character-width judgement, not a measured one.

## Every key, in source order

`n` = source, `vi` = audited value; verdict is per key. Reading all 53 twice (a second,
slower pass over the settings and error strings, as this slice carries destructive-account
and sign-out copy) produced no additional finding beyond the five below.

| # | key | role | vi | verdict |
| --- | --- | --- | --- | --- |
| 1 | `mobile.common.not_found.action` | button | Quay lại danh sách phiên | ok |
| 2 | `mobile.common.not_found.headline` | status | Trang đó không tồn tại. | ok |
| 3 | `mobile.common.not_found.next` | help | Quay lại danh sách phiên để tiếp tục. | ok |
| 4 | `mobile.common.not_found.title` | heading | Không tìm thấy trang | ok |
| 5 | `mobile.computers.wait.nothing_answered` | status | Không có phản hồi. | ok |
| 6 | `mobile.computers.wait.nothing_answered_help` | help | Đã ba phút mà chưa thấy đường hầm nào và không có máy tính nào phản hồi. Kiểm tra xem lệnh đã chạy trên máy tính chưa, rồi bắt đầu lại. | viA-N1 |
| 7 | `mobile.computers.wait.paused` | help | Tạm dừng khi ứng dụng chạy nền. Mở lại để tiếp tục theo dõi. | ok |
| 8 | `mobile.computers.wait.relay_sessions` | help | Bộ chuyển tiếp trên máy tính báo có {sessions, plural, other {# phiên đang chạy}}. | ok |
| 9 | `mobile.computers.wait.relay_version` | help | Bộ chuyển tiếp trên máy tính báo phiên bản giao thức {version}. | ok |
| 10 | `mobile.computers.wait.relay_version_sessions` | help | Bộ chuyển tiếp trên máy tính báo phiên bản giao thức {version} và {sessions, plural, other {# phiên đang chạy}}. | ok |
| 11 | `mobile.session.chip.effort_change_failed` | status | Không thể đổi mức suy luận. | ok |
| 12 | `mobile.session.chip.model_change_failed` | status | Không thể đổi mô hình. | ok |
| 13 | `mobile.session.composer.retained_instruction` | confirm | Chỉ dẫn trước đó có thể đã được chuyển đến. Hãy thử gửi lại chỉ dẫn đó trước khi gửi bản nháp hiện tại. | ok |
| 14 | `mobile.session.empty.headline` | status | Chưa có gì ở đây. | ok |
| 15 | `mobile.session.empty.next` | help | Gửi tin nhắn đầu tiên bên dưới. | ok |
| 16 | `mobile.session.find.hint` | help | Tìm tin nhắn trong bản ghi đã tải trên thiết bị này | ok |
| 17 | `mobile.session.find.label` | button | Tìm trong cuộc trò chuyện này | viA-N2 |
| 18 | `mobile.session.not_connected.headline` | status | Phiên này chưa được kết nối. | ok |
| 19 | `mobile.session.not_connected.next` | help | Mở phiên từ danh sách sau khi kết nối máy tính. | viA-M2 |
| 20 | `mobile.session.subagent.no_rows` | status | Tác nhân con này không có dòng bản ghi riêng nào. | ok |
| 21 | `mobile.session.subagent.prompt_label` | meta | prompt | viA-N3 |
| 22 | `mobile.session.subagent.result_label` | meta | kết quả | ok |
| 23 | `mobile.session.subagent.screen_title` | heading | Tác nhân con | ok |
| 24 | `mobile.session.subagent.unavailable_headline` | status | Tác nhân con này không còn khả dụng. | ok |
| 25 | `mobile.session.subagent.unavailable_next` | help | Bản ghi không được lưu giữ hoặc máy tính không phản hồi. | ok |
| 26 | `mobile.session.subagents_hint` | help | Hiện các tác nhân con | ok |
| 27 | `mobile.settings.about.blurb` | help | Local Operator có mã nguồn mở (MIT). Các phiên tác nhân kết nối với bộ chuyển tiếp của bạn. Tin nhắn Team Bridge và việc đăng ký nhận thông báo kết nối trực tiếp với Radient. | ok |
| 28 | `mobile.settings.about.version` | meta | Phiên bản | ok |
| 29 | `mobile.settings.account.delete` | button | Xóa tài khoản Radient của tôi | ok |
| 30 | `mobile.settings.account.delete_help` | help | Việc xóa tài khoản được thực hiện trong bảng điều khiển Radient trên trình duyệt — ứng dụng này không thể xóa giúp bạn. Thao tác này xóa tài khoản và mọi đường hầm thuộc tài khoản đó. Các phiên trên máy tính không bị ảnh hưởng. | ok |
| 31 | `mobile.settings.account.signed_in` | status | Đã đăng nhập | ok |
| 32 | `mobile.settings.connection.computers` | meta | Máy tính | ok |
| 33 | `mobile.settings.connection.refresh` | button | Làm mới | ok |
| 34 | `mobile.settings.connection.status` | meta | Trạng thái | ok |
| 35 | `mobile.settings.connection.use` | button | Dùng | ok |
| 36 | `mobile.settings.diagnostics.last_error` | meta | Lỗi gần nhất | ok |
| 37 | `mobile.settings.diagnostics.none` | status | Không có | ok |
| 38 | `mobile.settings.diagnostics.privacy_note` | help | Các dòng này không bao giờ chứa token, mật khẩu hay nội dung phiên. | ok |
| 39 | `mobile.settings.diagnostics.route` | meta | Tuyến kết nối | ok (see judgement calls) |
| 40 | `mobile.settings.diagnostics.route_direct` | status | Chuyển tiếp trực tiếp | ok (see judgement calls) |
| 41 | `mobile.settings.diagnostics.route_radient` | status | Đường hầm Radient | ok |
| 42 | `mobile.settings.diagnostics.stream` | meta | Luồng | ok |
| 43 | `mobile.settings.screen_title` | heading | Cài đặt | ok |
| 44 | `mobile.settings.section.about` | heading | Giới thiệu | ok |
| 45 | `mobile.settings.section.appearance` | heading | Giao diện | ok |
| 46 | `mobile.settings.section.connection` | heading | Kết nối | ok |
| 47 | `mobile.settings.section.diagnostics` | heading | Chẩn đoán | ok |
| 48 | `mobile.settings.sign_out.body` | confirm | Thao tác này kết thúc phiên với hệ thống điều khiển và xóa thông tin phiên trên điện thoại, nên đường hầm sẽ ngừng nhận yêu cầu từ điện thoại này. Máy tính không bị ảnh hưởng. | viA-M1 |
| 49 | `mobile.settings.sign_out.confirm` | button | Đăng xuất | ok |
| 50 | `mobile.settings.sign_out.done` | status | Đã đăng xuất. Phiên đã bị thu hồi trên máy tính. | ok |
| 51 | `mobile.settings.sign_out.title` | confirm | Đăng xuất? | ok |
| 52 | `mobile.settings.text_size.following` | help | Cỡ chữ của điện thoại này là {percent}%. Đang dùng cỡ chữ đó. | ok |
| 53 | `mobile.settings.text_size.overridden` | help | Cỡ chữ của điện thoại này là {percent}%. Đã dùng cỡ chữ khác ở trên. | ok |

### What the ok rows were checked for, beyond mechanics

- **Fidelity, claim by claim.** The three strings that make precise claims keep every claim
  and its direction: `sign_out.body` (control-plane session ends *and* the phone forgets it ⇒
  the tunnel stops accepting requests from this phone; the computer is untouched),
  `sign_out.done` (revoked *on your computer*), `delete_help` (deletion happens in the Radient
  console in the browser; the app cannot do it; the account and every tunnel go; sessions on
  the computer are untouched). `diagnostics.privacy_note` keeps the absolute "never"
  («không bao giờ»), and `relay_*` keeps the state description as a report from the computer's
  relay rather than the app's own observation («báo»).
- **No polarity or scope slip.** Every negation in the source has exactly one negation in the
  target (`không`, `chưa`, `không bao giờ`, `không còn`, `không thể`, `không bị ảnh hưởng`), and no
  target string negates something the source asserts.
- **No additions that claim more than the source.** Where `vi` is more explicit than English
  it is only where the product's own vocabulary requires it: «trên máy tính» for "Its relay"
  (the computer is the referent), «máy tính» for "host", «thông tin phiên» for "forgetting it
  here". None of these changes what the user is told.
- **Register and address.** `bạn` never appears as a per-sentence pronoun, only where it is
  natural inside a phrase («bộ chuyển tiếp của bạn», «không thể xóa giúp bạn»); no «Vui lòng»,
  no «Quý khách», no anh/chị, no "!", no Title Case; labels are verb-first imperatives
  («Quay lại», «Làm mới», «Dùng», «Đăng xuất») as the guide's terse dev voice asks.
- **Terminology against `i18n/glossary.md` and the shipped catalogue.** session → «phiên»
  (also «phiên tác nhân» for agent sessions), subagent → «tác nhân con», transcript → «bản ghi»,
  relay → «chuyển tiếp» (the head of «bộ chuyển tiếp»), tunnel → «đường hầm», team → «nhóm» (not
  needed here), settings → «cài đặt», computer → «máy tính» (never «máy chủ», which the guide
  reserves for *server*), effort → «mức suy luận» (the shipped dominant rendering: `mobile.chrome.composer.row_effort`,
  `mobile.home.picker.effort_title`, `mobile.session.sheet_title.effort`), prompt → «prompt» (glossary),
  console → «bảng điều khiển Radient» (shipped). Product names Local Operator, Team Bridge,
  Radient, MIT are kept; `token` stays English per the guide's kept-English list.
- **Internal repetition.** `retained_instruction` reuses the exact phrasing the shipped
  catalogue already ships for the same situation (`mobile.session.json:33`: «Hãy thử gửi lại
  chỉ dẫn trước đó»), which is what the user will have seen in the send-failure path.

## Judgement calls accepted (no finding)

- `mobile.settings.diagnostics.route` → «Tuyến kết nối» for a one-word "Route". The label heads a
  value pair (`Chuyển tiếp trực tiếp` / `Đường hầm Radient`), and «tuyến» alone would be terse to
  the point of vagueness for a phone user. Different concept from the shipped «định tuyến»
  (account *routing*, `mobile.account_routing`), so no collision.
- `mobile.settings.diagnostics.route_direct` → «Chuyển tiếp trực tiếp». Nominalised «chuyển tiếp»
  reads as "relay" here, parallel to «Đường hầm Radient»; the direct/tunnel contrast survives.
  «Qua chuyển tiếp trực tiếp» would be unambiguous but longer for a two-word status value.
- `mobile.settings.section.appearance` → «Giao diện». Google/Apple-ish `vi` would also accept
  «Hiển thị»; «Giao diện» is the more common in-product word and is not contradicted by the guide.
- `mobile.session.subagent.prompt_label` / `result_label` mixed languages — glossary-mandated
  (viA-N3), not a defect.
- `mobile.computers.wait.relay_version` at 63 characters against 45 in English: the extra length
  is «trên máy tính», which buys the referent the English "Its" carries for free. Accepted.
- `mobile.session.find.hint` turns English's third person ("Finds messages…") into an imperative
  («Tìm tin nhắn…»). That is the platform convention for an accessibility hint read after the
  control's name, and nothing is lost.

## Observed outside this slice (not counted, not gated here)

1. **One English token still reaches the `vi` interface.**
   `mobile.computers.connect_refused.password` ships as
   `Relay không chấp nhận mật khẩu đó. Hãy kiểm tra lại rồi thử lại.` — the word "Relay" is English
   (and capitalised mid-sentence). It is not one of the 53 keys, so it is not this audit's
   finding, but it contradicts the operator's acceptance criterion ("no English anywhere") for
   `vi`. After the 53 keys land, this is the only remaining English *word* in the shipped `vi`
   catalogue (`Radient`, `Home`, `topic-name`, `my-project`, `ios, q4`, `{head} · {label}`,
   `{first}, {second}` are names, path/format literals or ICU skeletons and stay as they are).
   Replace it with «Chuyển tiếp không chấp nhận mật khẩu đó. …» in whatever wave touches that file.
2. **`effort` has two renderings in the shipped catalogue.** The dominant one is «mức suy luận»
   (8 sites), the outlier is `mobile.session.chip.effort_resume_hint` = «Tiếp tục phiên này để đổi
   mức nỗ lực». The audited value follows the dominant term, correctly; the outlier pre-dates this
   slice and should be normalised by whoever owns `mobile.session.json` next.
3. `mobile.computers.connect_refused.password` also shows the shipped catalogue is comfortable with
   a bare English "Relay", which is *not* what this slice chose — worth recording as the guide's
   relay call («bộ chuyển tiếp») rather than leaving two styles live.

## Limits

- No rendered frame: this role has no browser tool and the native app was not built, so width is
  estimated in characters (and `vi` is Latin-script single-width, so cell width ≈ character count
  for these strings); the `maxCells` budget that would make it measured does not exist in the
  sidecar for any of the 53 keys. "Fits a 320 pt phone" is a judgement, not a capture.
- The staged values are **not** in the tree: `npm run -s i18n:check` was run on head `84c4bee1`
  and is green *with English placeholders still in place*. The generated-argument check that would
  read these values runs only once the implementer lands them, so my ICU parity check is my own
  (`jq` over both files), not the repo's.
- No translation API, SDK, MT CLI or back-translation service was used, and no other auditor's
  report was read.
- Independence: I did not translate these strings and never edited them. Model-diverse from the
  translator (deepseek/deepseek-flash vs the reported openai/gpt-6.1-sol); no human native-speaker
  review is claimed.

## Record

Verdict **clean-with-findings**: no BLOCKER, no MAJOR ⇒ ledger status `passed` for this slice with
the MINORs above carried as dispositions (both are guide/consistency calls the manager can fold
into the landing commit or defer).

The mobile repo has no `i18n/ledger.json` and no ledger subcommand: its gate is the tracked
evidence bundle (**`i18n/audits/evidence/<locale>/<namespace>/<audit-id>/`**) plus `npm run -s
i18n:check` / `generate.ts` comparing every locale with a directory. The core repo's ledger
(`~/local-operator/i18n/ledger.json`, RFC §"Add or extend a locale" step 6) keys core catalogue
namespaces and has no row shape for a mobile `mobile.*` namespace, so I did **not** invent a row
there. Bundles for this audit: `audit_id` **`vi1111m1a`** under
`i18n/audits/evidence/vi/{mobile.common,mobile.computers,mobile.session,mobile.settings}/`,
each with `record.json`, `report.md` and the shared `audit.log`. If the manager wants a ledger-style
row somewhere else, name the file and I will record it in that shape.
