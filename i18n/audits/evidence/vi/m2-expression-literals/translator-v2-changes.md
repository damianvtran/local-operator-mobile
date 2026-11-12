# Vietnamese M2 remediation — round 1

Translator: i18n-translator; session `6ff016e97a00`; actual served model `openai/gpt-6.1-sol` (session model header; no fallback used). Date: 2026-11-11. Lane: fix (<2 h). Translation is my own reasoning; no translation service used. This is remediation, NOT a self-audit or independent pass. No catalogue/ledger/commit writes: the two explicitly requested prep files are the deliverables.

## Scope and results

`vi.v2.json`: exactly 32 keys in `keys32.json` order; 8 existing values changed, 19 retained, 5 added. Audit dispositions: 10 fixed / 1 declined, counting each finding in both reports separately (A: 4 fixed; B: 6 fixed, 1 declined). Overlapping findings are intentionally answered twice below.

Inputs: `keys32.json`, `vi.v1.json`, `r1/audit-vi-A.md`, `r1/audit-vi-B.md`, core `docs/I18N.md`, `docs/design/i18n.md`, `AGENTS.md` i18n section, `i18n/style-guides/vi.md`, `i18n/glossary.md`. Source behavior checked directly in `~/local-operator-mobile/.worktrees/i18n-app-scan/`, not inferred from auditor claims.

## Per-finding decisions

| Report / ID | Decision | Verification and remediation |
|---|---|---|
| A F1 (MAJOR) | fixed | Both short variants now use `ctx`; wide forms retain `ngữ cảnh`. Actual call site `app/(app)/session/[id].tsx:978–984` documents the under-340pt wrap and selects the short variant. At 100%: 13→8 cells; estimate 24→19 cells. Developer abbreviation, not untranslated prose; glossary proposal below. |
| A F2 (MINOR) | fixed | `Đoạn phim` → `Video`. Read `mobile.session.highlights.video_open` = `Phát video {name}` in the target mobile catalogue; use the same noun. |
| A F3 (NIT) | fixed | Host wait text now ends `Tuyến kết nối đã cấp không có nghĩa là máy tính đang chạy.` This explicitly covers provisioning, removes the unintended temporal hedge, and states that a provisioned route does not prove the machine is up. |
| A F4 (NIT) | fixed | `chờ` → `rảnh`, rather than the suggested `chưa chạy`. Directly read shipped `relay.chrome.session.subtitle.idle` = `Rảnh` in the mobile catalogue. Lowercase for this diagnostic. Reuses established idle terminology, distinct from `đang kết nối` and `hoạt động`; no pending/connecting collision. |
| B M1 (MAJOR) | fixed | `Video`; same verification as A F2. |
| B m1 (MINOR) | fixed | `Chưa kết nối` → `Không kết nối được`. Source `settings.tsx:717–718` distinguishes no route from `input.refused`; this latter value must communicate a failed connection, not merely that none has happened yet. |
| B m2 (MINOR) | fixed | Host wait sentence now explicitly says `Tuyến kết nối đã cấp` (provisioned route), rather than the existential `Có tuyến…`; paired with the definitive `không có nghĩa là`. |
| B m3 (MINOR) | fixed | Both short variants genuinely narrower by 5 cells. Same verified call site and measured widths as A F1. No width exception requested. |
| B n1 (NIT) | fixed | `rảnh` follows the existing relay idle state, rather than inventing another label (`chưa chạy`). See A F4. |
| B n2 (NIT) | fixed | `còn nữa bên dưới` → `còn thêm bên dưới`; retains the downward-scroll meaning and all glyphs. |
| B n3 (NIT) | declined | Retain `Chưa đăng nhập với Radient`. `mobile.settings.sign_out.body` already says `phiên đăng nhập với lớp điều khiển`; `với` naturally names the authentication counterpart and distinguishes Radient sign-in from computer connectivity. Auditor also explicitly calls this acceptable. Dropping it is stylistic rather than a defect and would reduce consistency. |

A's clean classification of `stream_degraded` is superseded by the binding manager decision below. A's claim that `ngữ cảnh` is new is not relied on: my recount found two mobile occurrences and 21 core occurrences.

## Binding manager decisions and new keys

- `status.not_answering` remains `Không phản hồi`, byte-identical to `relay.chrome.session.subtitle.not_answering` in BOTH mobile and core Vietnamese catalogues. `diagnostics.stream_degraded` now also equals `Không phản hồi` byte-for-byte, replacing `suy giảm`. Source `settings.tsx:727–728` maps degraded health to `Not answering`, and the key's own note says open but not answering: this is not a different semantic state. **Explicit casing exception:** manager's verbatim requirement wins over the diagnostic note's lower-case convention; hence capital `K` in this one diagnostic value. No invented alternate state word.
- Preserve `no_connection` = `Chưa có kết nối` (not yet), versus `offline` = `Ngoại tuyến` / stream `ngoại tuyến`. Refusal is now `Không kết nối được`.
- Connecting remains `đang kết nối` (exact existing `mobile.computers.badge.connecting`); live remains `hoạt động` (exact `mobile.computers.badge.active`); idle `rảnh` reuses relay `Rảnh`, adapted to the diagnostic's lowercase convention. No stream state duplicates another.
- New region nouns: working `hoạt động`, subagents `tác nhân con`, todos `tác vụ`, strip `trạng thái`. Source `session/[id].tsx:1072–1075` maps these to activity/agents/tasks/status; they are inline nouns, not action labels. Existing `mobile.session.status_tray.hint` and `subagents_hint` establish `tác vụ` and `tác nhân con`; `mobile.settings.connection.status` establishes `Trạng thái`. Example composition: `tác vụ · tác nhân con bên dưới · cuộn ↓`. The shared `bên dưới` applies to the joined list.
- New navigation label: `Quay lại {name}`. Actual video/agent screens use `runtime.projection?.conversation_name ?? "session"` as `parentName`; `Quay lại Kế hoạch` and `Quay lại phiên` both work. Computer confirmation: `Đã kết nối với MacBook.` and `Đã kết nối với máy tính của bạn.` both work. No inflection, article or oblique-form problem. **No split-key request.** These are two separate fallback types already; no requirement that the computer fallback also serve the session header.

## Recounted terminology evidence

Method: Python parsed the immediate `*.json` catalogue files, excluded `.context.json`, counted case-insensitive substring occurrences in string VALUES only (not keys). These are checkout catalogue counts, not an assertion about a release artifact or merged M2 candidate.

| Term | Mobile vi | Core vi |
|---|---:|---:|
| máy tính | 56 | 22 |
| phiên | 39 | 149 |
| đường hầm | 7 | 0 |
| hoạt động | 6 | 9 |
| phản hồi | 7 | 11 |
| kết nối | 37 | 41 |
| video | 1 | 1 |
| ngữ cảnh | 2 | 21 |
| cuộn | 0 | 0 |
| rảnh | 1 | 8 |
| tác vụ | 6 | 9 |
| tác nhân con | 6 | 31 |

Mobile root: `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/vi/`. Core root: `~/local-operator/local_operator/i18n/catalogues/vi/`. No reliance on the auditors' occurrence totals; these counts were derived here.

## Widths and glossary proposals

Python cell measure: combining marks 0, East Asian W/F 2, other code points 1; all strings NFC. At percent=100, full `100% ngữ cảnh` 13 cells, short `100% ctx` 8; full estimate `100% ngữ cảnh (ước tính)` 24, short estimate `100% ctx (ước tính)` 19. These are cell counts, not a claim of rendered native-font fit. Narrow forms save 5 cells each; rendered 320pt fit remains independent QA/design work.

Glossary-proposals: explicitly permit `ctx` as the compact developer abbreviation for `ngữ cảnh` in narrow context-window readouts only (wide form remains Vietnamese). `Video` follows existing usage; propose documenting that existing noun, not introducing a second term. `rảnh` follows existing idle usage; no new idle term proposed. `cuộn` is standard Vietnamese for the scroll action; propose documenting it if a dedicated row is desired.

## Actual validation performed

1. `python3` loaded `keys32.json`, `vi.v2.json`, `vi.v1.json`, checked exact 32-key set/order, no empty values, NFC, exact ICU placeholder names per key, and explicit English-identical allowance. **PASS**. No plural/select messages in this slice. Existing glyphs/percent signs preserved in the translations.
2. English-identical: only `tray.context_short` (intentional `ctx` abbreviation), `video.title_fallback` (`Video`, established Vietnamese noun), `account.app_name` (`Local Operator`, protected name). An initial assertion allowed only the latter two and failed; inspected the actual matches, identified the intentionally accepted `ctx` form, then reran with all three justified allowlist entries. Final run passed; no silent failed validation claim.
3. `node scripts/i18n/generate.ts --check` in mobile worktree: exit 0, `src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`.
4. `node scripts/i18n/check-strings.ts` there: exit 0, `check-strings: 212 finding(s), all baselined; 0 new; verified historical debt vs d78ca8616286`. Scanner hashes: base `fd5946dfe556d9f0161b6093ab9792ae2049758d1870a56a0d888e4d95154d5c`, head `cf05770fe3fa0ff57d974806f5eb48e0278e8e8785c7d785817548b7ce95b813`.

Both Node commands emitted the existing MODULE_TYPELESS_PACKAGE_JSON reparsing warning. The repo checks validate CURRENT checkout assets, not this unintegrated prep JSON. The candidate-specific Python checks validate this actual 32-key file. No claim of integrated-candidate validator, native rendering, independent audit, tracked evidence bundle, or ledger pass. Manager owns integration and durable audit retention.
