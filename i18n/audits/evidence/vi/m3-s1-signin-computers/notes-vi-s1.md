# vi — M3 S1 translator notes (sign-in + computers)

Locale: vi · Wave: mobile M3 S1 · Translator: i18n-translator (agent), model `deepseek/deepseek-flash`
Input brief: `translation-brief-s1.json`, sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f` (verified)
English source read at: `~/local-operator-mobile/.worktrees/i18n-m3-s1` @ `1796c3a5` (read-only; nothing written there)
44 keys: `mobile.computers` (30) + `mobile.signin` (14). Draft: `draft-vi-s1.json`, key order = brief order.

## Register

- `bạn`, used sparingly — 12 of 44 strings carry a pronoun at all (4 of them possessively, e.g.
  «máy tính của bạn»); the 7 badges, the buttons and the a11y labels carry none.
  No "Quý khách", no "anh/chị" (style guide §Formality).
- Terse, sentence case, no "!". Buttons are bare verbs ("Xóa", "Làm mới", "Bắt đầu lại", "Thử ngay").
- Every sentence that ends with a full stop in English ends with "." here; the two shimmering
  status lines keep "…" (U+2026, never "..."), per style guide §Punctuation.
- Em dash written " — " with spaces (`wait.tunnel_status`).

## Terminology reused (not reinvented — these already exist in vi catalogues)

| English | vi | Source of the call |
|---|---|---|
| computer | máy tính | `vi/mobile.computers.json` throughout |
| tunnel | đường hầm | `billing_help`, `disabled_help`, `wait.nothing_answered_help` |
| relay (server) | chuyển tiếp / máy chủ chuyển tiếp | `connect_refused.password`, `wait.relay_*` |
| route | tuyến (kết nối) | `wait.host_answering`, settings `diagnostics.route` = «Tuyến kết nối» |
| sign in | đăng nhập | `vi/mobile.signin.json` (stage_*) |
| account | tài khoản | throughout |
| browser | trình duyệt | `stage_browser` |
| answered / respond | phản hồi | `wait.answering` = «Đang chờ máy tính phản hồi.» |
| refresh | Làm mới | `mobile.settings.connection.refresh` = «Làm mới» |
| remove / delete | Xóa | `mobile.projects.delete_body`, `settings.account.delete` |
| active | hoạt động | `badge.active` = «hoạt động» |
| connecting | đang kết nối | `badge.connecting` |
| billing | thanh toán | `billing_help` = «cài đặt thanh toán của đường hầm này» |
| remote access | truy cập từ xa | style guide §Locale calls |
| session | phiên | glossary §2 |
| agent | tác nhân | glossary §2 |
| setup | thiết lập | style guide §Wave-2 |
| harness | *see glossary proposal* | `harness_help` names the product, no noun |

## Per-key rationale (non-obvious ones only)

- **`not_harness`** — «Máy tính này không chạy Local Operator.» The English noun *harness* has no
  settled vi rendering and no glossary row. The repo's own vi copy for the same concept
  (`harness_help`) already says «bật **Local Operator** cho đường hầm này», i.e. names the product
  instead of transliterating the noun, so I followed that precedent: product name, zero English
  residue. Rejected «…không chạy harness của Local Operator» (adds an English word that is not on
  the kept-English list) and «bộ khung chạy» (invented). Glossary proposal below.
- **`wait.listing`** — «Đang chờ Radient đưa máy tính của bạn vào danh sách…» Literal «liệt kê» is
  formal register; “put it into the list” is what the panel actually waits for.
- **`wait.tunnel_status`** — «Radient đã có đường hầm — {status}.» {status} is inserted verbatim as
  an English token; the sentence stays grammatical around it because the placeholder closes the
  clause after the dash.
- **`own_tunnel_instead`** (button) — «Chuyển sang đường hầm riêng của tôi». *instead* is carried by
  the switch verb: the button replaces the Radient list above it. Appending «thay thế» reads
  non-native («Dùng đường hầm của tôi thay thế»), and fronting «Thay vào đó, …» turns a quiet
  button into a sentence. Kept distinct from `paths.own_action` as the brief requires.
- **`remove.title` / `remove.body` / `remove.confirm`** — «Xóa …» even though the action is
  non-destructive (it only leaves this phone's list). Repo-consistent (`projects.delete_body`,
  `settings.account.delete` both use «Xóa»); the body sentence carries the reassurance, and keeps
  all three negations in one clause: «Máy tính, đường hầm của nó và tài khoản của bạn đều không bị
  ảnh hưởng.»
- **`paths.recommended`** — «Đề xuất» (badge), not «Khuyến nghị» (formal, banking register).
- **`paths.radient_body`** — one pronoun only: «Radient chạy đường hầm thay bạn, cấp một URL riêng
  tư có xác thực, …»; «URL» stays Latin, «mật khẩu chuyển tiếp» reuses the existing relay-password
  wording. Keeps the honest cost (an account is required) in the first clause.
- **`paths.own_body`** — «Cách nâng cao: …» keeps *advanced* explicit; «tự công khai máy tính của
  mình» = publish/expose your own computer; «do bạn chạy» attaches the tunnel to the reader;
  «Không cần tài khoản Radient ở bất kỳ bước nào» mirrors *at any point*.
- **`try_anyway`** — «Cứ thử lại». «Cứ» is the idiomatic carrier of *anyway* (go ahead regardless);
  «Thử lại dù vậy» is heavier. Quiet-button length, 10 cells.
- **`welcome.body`** — «Mã nguồn của bạn không bao giờ rời khỏi máy.» *it* = the machine, so the
  target is «máy», and the privacy promise keeps «không bao giờ».
- **`billing_inactive`** — «Thanh toán cho đường hầm này hiện không hoạt động» = *billing is
  inactive* (not “unpaid” — that would be a different claim).
- **Status/reach badges** — all lower case, one to three words, no punctuation:
  «tuyến sẵn sàng», «đang thiết lập», «tạm ngưng», «đã tắt», «đã thu hồi», «không rõ»,
  «đang phản hồi». «tạm ngưng» (suspended) is deliberately distinct from `wait.paused` = «Tạm dừng».
- **`row.a11y_active` / `row.a11y_connecting`** — end with the same words the sibling badges use
  («hoạt động», «đang kết nối») as the brief requires.

## Judged identical to English

| key | value | why |
|---|---|---|
| `mobile.computers.row.a11y` | `{name}, {status}, {reach}` | Structure only: three placeholder substitutions and two commas. There is no translatable word, and the brief fixes the order. Nothing is left in English at render time — `{name}` is the computer's own name, `{status}`/`{reach}` are the (translated) badge labels. |

That is the only byte-identical value; 43 of 44 differ from English. English tokens that remain
*inside* translated strings, all permitted: `Local Operator`, `Radient` (7 strings), `URL`,
`{status}` at runtime, and the `{name}`/`{reach}` substitutions.

## Width risks (phone)

No `maxCells` exists for these keys; the ratios below are characters against English. Badges sit in
a `flex-row` with `gap-2` and no `numberOfLines`, so a long badge wraps rather than truncates.

| key | vi | en | ratio | note |
|---|---|---|---|---|
| `status.route_ready` | 14 | 11 | 1.27 | shortened from «tuyến kết nối sẵn sàng» (22 / 2.0×) — the badge pairs with `reach.*` on one row; «tuyến sẵn sàng» keeps the route sense at badge width |
| `reach.answering` | 13 | 9 | 1.44 | badge; «đang phản hồi» matches the aspect of *answering* |
| `paths.own_action` | 28 | 17 | 1.65 | button, wraps to two lines; «riêng … của tôi» carries *my own* |
| `paths.own_title` | 33 | 22 | 1.50 | heading + quiet button on the welcome screen; wraps |
| `own_tunnel_instead` | 35 | 25 | 1.40 | quiet link under the list; accepts two lines |
| `status.revoked` | 10 | 7 | 1.43 | badge |
| `signin.welcome.body` | 133 | 98 | 1.36 | help paragraph |

Longest strings are the two path descriptions (184 / 165) — help text in a card, already 2–3 lines
in English. Nothing was truncated to fit.

## Glossary proposals

1. **harness** — no row exists. Proposal: *per-locale decision — vi names the product («Local
   Operator») instead of a noun*; the noun is dropped in the two strings that mention it
   (`not_harness`, `harness_help`). If a future surface needs the noun, keep English «harness»
   (as fr/es will) rather than inventing «bộ khung chạy».
2. **billing** — not in the glossary; vi uses «thanh toán» (from the existing `billing_help`).
   Suggest recording it beside `cost` → «chi phí» so the two stay distinct.
3. **provisioning** (route setup) — vi «đang thiết lập». Suggest a row so a future surface does not
   reach for «cấp phát».

## Validator

Command (repo's own tool, run in a scratch copy; the English-first worktree was not modified —
`~/local-operator-mobile/.worktrees/i18n-m3-s1` is read-only for this lane):

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/i18n/generate.ts          # regenerate
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/i18n/generate.ts --check  # verify
```

Output:

```
Wrote src/i18n/catalogue.gen.ts (734 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
src/i18n/catalogue.gen.ts is current (734 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
EXIT=0
```

How that run was set up, stated plainly: the check compares every locale directory with `en` key for
key, and in this English-first wave the six other locales also still lack these 44 keys, so the
validator stops at the first one (`es/…`). In the scratch copy only, the six other locales received
the **English source value** for the 44 keys they are missing (scaffolding, none of it part of my
deliverable), so the run could reach a verdict about vi. My `vi/mobile.computers.json` and
`vi/mobile.signin.json` are the merged real files (45 + 18 existing keys + my 44 = 75 + 32). The 44
vi values are present verbatim in the generated `LOCALISED_MESSAGES["vi"]` block (checked key by
key: 0 missing, 0 mismatches, 734 keys in the block) — no English fallback for any of them.

Negative controls, to show the check actually exercises my file:

```
vi/mobile.computers.json: mobile.computers.row.a11y_connecting does not carry the source's parameters — missing: reach; unexpected: none (English: name:text, reach:text, status:text; vi: name:text, status:text)
vi/mobile.computers.json: mobile.computers.wait.tunnel_status is not a valid message — Invalid message "Radient đã có đường hầm — {status.": expected ',' or '}' (at offset 33)
vi/mobile.computers.json disagrees with the English source — missing: none; unknown: mobile.computers.wait.zzz_nonexistent
```

Each exits 1 and names the vi file. Restored afterwards; final run is the clean one above.

Supplementary checks (all pass): NFC-normalised (every vi value), no ASCII `"..."`, no space before
punctuation, no leading/trailing or doubled spaces, all declared placeholders present
(`{status}` ×4, `{name}` ×3, `{reach}` ×3), `Local Operator`/`Radient`/`URL` preserved, key set and
order identical to the brief, valid JSON, UTF-8. No plural/select arms in this slice, so no CLDR
category work (vi is `other`-only anyway).

## Status

`status: translated` — not `passed`. I do not audit my own locale; an independent i18n-auditor runs
next. No machine-translation service was used: every value was reasoned directly.

## Artifacts

| file | sha256 |
|---|---|
| `draft-vi-s1.json` (44 keys) | `ee370439647b04e77654c7261dc2d8ed08034bef6396f9f20539a314265d8a4f` |

Both live in this session's scratchpad (not a served artifact). No file in
`~/local-operator-mobile/.worktrees/i18n-m3-s1` was modified or committed: the lane brief makes that
tree read-only for translation, so the catalogue merge and the `i18n/ledger.json` row
(`status: translated`) are the implementer/manager step, not mine.
