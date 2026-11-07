# zh-CN audit — `mobile.home` — `zh1107p1`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 0 NIT
(`passed` requires zero BLOCKER and MAJOR).

- **Scope**: 37 key(s) added by damianvtran/local-operator-mobile#182, read at `origin/main` `b5a2f4a1b0`.
- **Auditor**: reviewer (lopdev team), session `27cb86d0ecef`, actual model `anthropic/claude-opus-5-5`, no fallback. Independent of the translator; no MT/API/SDK used.
- **Reference**: core `origin/main` `0dbe7156be` catalogues and `i18n/glossary.md`; the zh-CN mobile catalogue's other namespaces.

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/zh-CN/mobile.home.json` | `b0c97e5e20b2182811402d074773247f26afdfe9141749a5ada15fa4d6847f28` |
| en source | `src/i18n/catalogues/en/mobile.home.json` | `12d5edd75b0e2a6e969c15c90b2c248d78675f97ebf86dc2e9c49a42d10c761b` |
| en context | `src/i18n/catalogues/en/mobile.home.context.json` | `aa5060ffb2c38f9e6e995011778f73acb9c896590774c513f2f38aba849be047` |

## 1. Mechanical (executed — see `audit.log`)

Placeholders identical to en for every key; no ICU plural/select in scope; 0 bidi control characters; final-stop and ellipsis parity hold; `Local Operator` kept verbatim.

## 2. Findings

| id | severity | keys | current | suggested | reason |
|---|---|---|---|---|---|
| ZH-H01 | MINOR | `chip.effort_chosen`, `chip.model_chosen`, `picker.source_chosen` | 推理强度，{effort}，为此对话选择 / 模型，{model}，为此对话选择 / 为此对话选择 | 推理强度，{effort}，已为此对话选择 · 模型，{model}，已为此对话选择 · 已为此对话选择 | «为此对话选择» reads as an instruction ('choose for this conversation'); the source is a past-tense status. «已…» marks it as done. |
| ZH-H02 | MINOR | `effort.xhigh` | 很高 | 超高 | «很高» ('very high') is conversational; graded-setting UIs say «超高» between 高 and 最高. Also fixes the 很高/最高 near-collision at a glance. |

## 3. Length (320 pt)

- none

## 4. Read and accepted

`chip.effort_default`, `chip.effort_default_short`, `chip.effort_default_unnamed`, `chip.model_default`, `chip.model_no_default`, `chip.model_no_default_label`, `effort.high`, `effort.low`, `effort.max`, `effort.medium`, `effort.minimal`, `effort.none`, `picker.badge_default`, `picker.badge_this_chat`, `picker.effort_none`, `picker.effort_title`, `picker.effort_unknown`, `picker.effort_unsupported`, `picker.effort_use_default`, `picker.folder_home`, `picker.folder_other`, `picker.folder_outside`, `picker.folder_title`, `picker.folder_tmp`, `picker.folder_too_long`, `picker.folder_use_path`, `picker.loading`, `picker.model_empty`, `picker.model_no_match`, `picker.model_search`, `picker.model_title`, `picker.not_connected`, `picker.source_default`

## Limits

No rendered capture (no browser tool in this role); length notes are estimates. `generate.ts --check` not run — no worktree; parity re-derived by `mech.py`.
