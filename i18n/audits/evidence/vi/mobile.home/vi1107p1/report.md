# vi audit — `mobile.home` — `vi1107p1`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 0 NIT
(`passed` requires zero BLOCKER and MAJOR).

- **Scope**: 37 key(s) added by damianvtran/local-operator-mobile#182, read at `origin/main` `b5a2f4a1b0`.
- **Auditor**: reviewer (lopdev team), session `27cb86d0ecef`, actual model `anthropic/claude-opus-5-5`, no fallback. Independent of the translator; no MT/API/SDK used.
- **Reference**: core `origin/main` `0dbe7156be` catalogues and `i18n/glossary.md`; the vi mobile catalogue's other namespaces.

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/vi/mobile.home.json` | `1dcd42a6510ce817f727da08ff6b4d471b6fd612cd2a765e054d9a3c37b025f5` |
| en source | `src/i18n/catalogues/en/mobile.home.json` | `12d5edd75b0e2a6e969c15c90b2c248d78675f97ebf86dc2e9c49a42d10c761b` |
| en context | `src/i18n/catalogues/en/mobile.home.context.json` | `aa5060ffb2c38f9e6e995011778f73acb9c896590774c513f2f38aba849be047` |

## 1. Mechanical (executed — see `audit.log`)

Placeholders identical to en for every key; no ICU plural/select in scope; 0 bidi control characters; final-stop and ellipsis parity hold; `Local Operator` kept verbatim.

## 2. Findings

| id | severity | keys | current | suggested | reason |
|---|---|---|---|---|---|
| VI-H01 | MINOR | `picker.folder_home`, `picker.folder_outside` | Thư mục chính / Máy tính này chỉ bắt đầu cuộc trò chuyện bên trong thư mục chính của bạn hoặc thư mục tạm của nó. | badge «Home»; sentence «… bên trong thư mục home của bạn hoặc thư mục tạm của nó.» | vi renders the home folder «thư mục home» in mobile (session_health.ended_placeholder, relay.health.ended_detail) and core (relay.chrome.session.ended_hint); «thư mục chính» ('main folder') occurs only here and in an unrelated systemd string. Badge is also 3.25× the English length. |
| VI-H02 | MINOR | `chip.effort_chosen`, `chip.effort_default`, `chip.effort_default_short`, `chip.effort_default_unnamed`, `picker.effort_none`, `picker.effort_title` | Mức nỗ lực, {effort}, đã chọn cho cuộc trò chuyện này / Mức nỗ lực, {effort}, mặc định của máy tính này / Mức nỗ lực mặc định / Mức nỗ lực, mức đã cấu hình trên máy tính này / Mô hình này không có cài đặt mức nỗ lực. / Mức nỗ lực | Mức nỗ lực → Mức suy luận | Core vi is split: relay.chrome.model.effort and wire.settings.model_effort.* (the web/relay and settings surfaces) say «Mức suy luận»; TUI-only strings say «mức nỗ lực». The phone is a relay client, so matching the relay's picker label is the better pick. Not a meaning error; choose one and record it in the vi style guide. |

## 3. Length (320 pt)

- none

## 4. Read and accepted

`chip.model_chosen`, `chip.model_default`, `chip.model_no_default`, `chip.model_no_default_label`, `effort.high`, `effort.low`, `effort.max`, `effort.medium`, `effort.minimal`, `effort.none`, `effort.xhigh`, `picker.badge_default`, `picker.badge_this_chat`, `picker.effort_unknown`, `picker.effort_unsupported`, `picker.effort_use_default`, `picker.folder_other`, `picker.folder_title`, `picker.folder_tmp`, `picker.folder_too_long`, `picker.folder_use_path`, `picker.loading`, `picker.model_empty`, `picker.model_no_match`, `picker.model_search`, `picker.model_title`, `picker.not_connected`, `picker.source_chosen`, `picker.source_default`

## Limits

No rendered capture (no browser tool in this role); length notes are estimates. `generate.ts --check` not run — no worktree; parity re-derived by `mech.py`.
