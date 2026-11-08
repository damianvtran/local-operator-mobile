# ru audit — `mobile.home` — `ru1107p1`

**Verdict: `changes_requested`** — 0 BLOCKER, 1 MAJOR, 1 MINOR, 0 NIT
(`passed` requires zero BLOCKER and MAJOR).

- **Scope**: 37 key(s) added by damianvtran/local-operator-mobile#182, read at `origin/main` `b5a2f4a1b0`.
- **Auditor**: reviewer (lopdev team), session `27cb86d0ecef`, actual model `anthropic/claude-opus-5-5`, no fallback. Independent of the translator; no MT/API/SDK used.
- **Reference**: core `origin/main` `0dbe7156be` catalogues and `i18n/glossary.md`; the ru mobile catalogue's other namespaces.

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ru/mobile.home.json` | `07fd9f3d2ffb34d762766551f995d4a233c629b9a237ed30ef859cea0ee8c4ef` |
| en source | `src/i18n/catalogues/en/mobile.home.json` | `12d5edd75b0e2a6e969c15c90b2c248d78675f97ebf86dc2e9c49a42d10c761b` |
| en context | `src/i18n/catalogues/en/mobile.home.context.json` | `aa5060ffb2c38f9e6e995011778f73acb9c896590774c513f2f38aba849be047` |

## 1. Mechanical (executed — see `audit.log`)

Placeholders identical to en for every key; no ICU plural/select in scope; 0 bidi control characters; final-stop and ellipsis parity hold; `Local Operator` kept verbatim.

## 2. Findings

| id | severity | keys | current | suggested | reason |
|---|---|---|---|---|---|
| RU-H01 | MAJOR | `chip.model_chosen` | Модель, {model}, выбрано для этой беседы | Модель, {model}, выбрана для этой беседы | Gender agreement: «модель» is feminine, so the participle is «выбрана», not neuter «выбрано» (the effort sibling «Усилие … выбрано» is correctly neuter). Screen-reader label; audibly ungrammatical. |
| RU-H02 | MINOR | `chip.model_no_default` | Нет по умолчанию | Не задана | «Нет по умолчанию» is a calque with no noun to negate; «Не задана» (model is feminine; core ru uses «не задано» for unset values in wire.settings.model_effort.help) is natural and shorter on the narrow strip. The spoken label still says 'no default model'. |

## 3. Length (320 pt)

- `mobile.home.effort.max`: 12 chars vs 3 en on the effort chip; within the chip cap but the longest level label in ru

## 4. Read and accepted

`chip.effort_chosen`, `chip.effort_default`, `chip.effort_default_short`, `chip.effort_default_unnamed`, `chip.model_default`, `chip.model_no_default_label`, `effort.high`, `effort.low`, `effort.max`, `effort.medium`, `effort.minimal`, `effort.none`, `effort.xhigh`, `picker.badge_default`, `picker.badge_this_chat`, `picker.effort_none`, `picker.effort_title`, `picker.effort_unknown`, `picker.effort_unsupported`, `picker.effort_use_default`, `picker.folder_home`, `picker.folder_other`, `picker.folder_outside`, `picker.folder_title`, `picker.folder_tmp`, `picker.folder_too_long`, `picker.folder_use_path`, `picker.loading`, `picker.model_empty`, `picker.model_no_match`, `picker.model_search`, `picker.model_title`, `picker.not_connected`, `picker.source_chosen`, `picker.source_default`

## Limits

No rendered capture (no browser tool in this role); length notes are estimates. `generate.ts --check` not run — no worktree; parity re-derived by `mech.py`.
