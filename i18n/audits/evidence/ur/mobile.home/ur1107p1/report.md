# ur audit — `mobile.home` — `ur1107p1`

**Verdict: `changes_requested`** — 0 BLOCKER, 2 MAJOR, 0 MINOR, 0 NIT
(`passed` requires zero BLOCKER and MAJOR).

- **Scope**: 37 key(s) added by damianvtran/local-operator-mobile#182, read at `origin/main` `b5a2f4a1b0`.
- **Auditor**: reviewer (lopdev team), session `27cb86d0ecef`, actual model `anthropic/claude-opus-5-5`, no fallback. Independent of the translator; no MT/API/SDK used.
- **Reference**: core `origin/main` `0dbe7156be` catalogues and `i18n/glossary.md`; the ur mobile catalogue's other namespaces.

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/mobile.home.json` | `a596a55a248529e0694bb7ee575725c3639fea10f2198d6c79cbecc3cb306610` |
| en source | `src/i18n/catalogues/en/mobile.home.json` | `12d5edd75b0e2a6e969c15c90b2c248d78675f97ebf86dc2e9c49a42d10c761b` |
| en context | `src/i18n/catalogues/en/mobile.home.context.json` | `aa5060ffb2c38f9e6e995011778f73acb9c896590774c513f2f38aba849be047` |

## 1. Mechanical (executed — see `audit.log`)

Placeholders identical to en for every key; no ICU plural/select in scope; 0 bidi control characters; final-stop and ellipsis parity hold; `Local Operator` kept verbatim.

## 2. Findings

| id | severity | keys | current | suggested | reason |
|---|---|---|---|---|---|
| UR-H01 | MAJOR | `chip.effort_chosen`, `chip.effort_default`, `chip.effort_default_short`, `chip.effort_default_unnamed`, `picker.effort_none`, `picker.effort_title`, `picker.effort_unsupported` | کوشش، {effort}، اس گفتگو کے لیے منتخب / کوشش، {effort}، اس کمپیوٹر کا ڈیفالٹ / ڈیفالٹ کوشش / کوشش، اس کمپیوٹر پر ترتیب شدہ سطح / اس ماڈل میں کوشش کی کوئی ترتیب نہیں۔ / کوشش / اس کمپیوٹر کا Local Operator کوشش قبول کرنے کے لیے بہت پرانا ہے، اس لیے یہ اپنی ترتیب شدہ سطح استعمال کرتا ہے۔ یہاں سے منتخب کرنے کے لیے اسے اپ ڈیٹ کریں۔ | کوشش → استدلال کی شدت (title, spoken labels, sentences); chip short «ڈیفالٹ شدت» | Terminology conflict. Core ur renders reasoning effort «استدلال کی شدت» on every user surface that names it (relay.chrome.model.effort, wire.settings.model_effort.label/help, tui.small.model_picker.effort, cli.exec_help.effort), while «کوشش» is the try/retry word in 15 other mobile ur values and 100 core values («دوبارہ کوشش کریں»). «کوشش» on a picker title therefore reads 'attempt', and the effort chip's spoken label «کوشش، زیادہ» reads 'attempt, more'. For the visible chip «ڈیفالٹ شدت» keeps it short; core's full «ڈیفالٹ استدلال کی شدت» is too wide for the shared row. |
| UR-H02 | MAJOR | `picker.folder_other`, `picker.folder_too_long`, `picker.folder_use_path` | دوسرا راستہ… / یہ راستہ بہت لمبا ہے۔ / یہ راستہ استعمال کریں | دوسرا پاتھ… · یہ پاتھ بہت لمبا ہے۔ · یہ پاتھ استعمال کریں | Terminology: core ur renders a filesystem path «پاتھ» (16 uses: cli.agents_picture.help.file, tui.authoring.invalid_name, …); «راستہ» means road/way and appears nowhere in ur for a path. The hi translation of the same keys correctly uses the parallel loanword «पाथ». |

## 3. Length (320 pt)

- none

## 4. Read and accepted

`chip.model_chosen`, `chip.model_default`, `chip.model_no_default`, `chip.model_no_default_label`, `effort.high`, `effort.low`, `effort.max`, `effort.medium`, `effort.minimal`, `effort.none`, `effort.xhigh`, `picker.badge_default`, `picker.badge_this_chat`, `picker.effort_unknown`, `picker.effort_use_default`, `picker.folder_home`, `picker.folder_outside`, `picker.folder_title`, `picker.folder_tmp`, `picker.loading`, `picker.model_empty`, `picker.model_no_match`, `picker.model_search`, `picker.model_title`, `picker.not_connected`, `picker.source_chosen`, `picker.source_default`

## RTL

No bidi control characters (U+200E/F, U+202A–E, U+2066–9, U+061C) in any audited value. Arabic comma «،» and full stop «۔» used throughout. Latin runs (`Local Operator`, `{model}` values) sit inside RTL paragraphs and rely on the layout's direction, as `docs/i18n.md` requires; `{model}` appears only in screen-reader labels, so it has no visual bidi exposure. The trailing «…» on `picker.folder_other` / `picker.loading` resolves to the visual left, which is correct for RTL.

## Limits

No rendered capture (no browser tool in this role); length notes are estimates. `generate.ts --check` not run — no worktree; parity re-derived by `mech.py`.
