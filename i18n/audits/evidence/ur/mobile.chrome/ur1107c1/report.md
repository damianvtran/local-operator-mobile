# ur audit — `mobile.chrome` — `ur1107c1`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT
(`passed` requires zero BLOCKER and MAJOR).

- **Scope**: 1 key(s) added by damianvtran/local-operator-mobile#180, read at `origin/main` `b5a2f4a1b0`.
- **Auditor**: reviewer (lopdev team), session `27cb86d0ecef`, actual model `anthropic/claude-opus-5-5`, no fallback. Independent of the translator; no MT/API/SDK used.
- **Reference**: core `origin/main` `0dbe7156be` catalogues and `i18n/glossary.md`; the ur mobile catalogue's other namespaces.

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/mobile.chrome.json` | `bf1d07fa805142c3b10a399d609bb0ffd18e62331658713abab5184a4918e112` |
| en source | `src/i18n/catalogues/en/mobile.chrome.json` | `7b91a909393d20b3ced5ef3825bf0fd5b0f844ee634a6f8abf19f3cb0141b3f7` |
| en context | `src/i18n/catalogues/en/mobile.chrome.context.json` | `ba70cefe7de66b12c4f012daad4e7aa127a34eea6e3de17c9fda832415aeb140` |

## 1. Mechanical (executed — see `audit.log`)

Placeholders identical to en for every key; no ICU plural/select in scope; 0 bidi control characters; final-stop and ellipsis parity hold; `Local Operator` kept verbatim.

## 2. Findings

| id | severity | keys | current | suggested | reason |
|---|---|---|---|---|---|
| — | — | — | — | — | no findings |

## 3. Length (320 pt)

- none

## 4. Read and accepted

`close_conversations`

## RTL

No bidi control characters (U+200E/F, U+202A–E, U+2066–9, U+061C) in any audited value. Arabic comma «،» and full stop «۔» used throughout. Latin runs (`Local Operator`, `{model}` values) sit inside RTL paragraphs and rely on the layout's direction, as `docs/i18n.md` requires; `{model}` appears only in screen-reader labels, so it has no visual bidi exposure. The trailing «…» on `picker.folder_other` / `picker.loading` resolves to the visual left, which is correct for RTL.

## Limits

No rendered capture (no browser tool in this role); length notes are estimates. `generate.ts --check` not run — no worktree; parity re-derived by `mech.py`.
