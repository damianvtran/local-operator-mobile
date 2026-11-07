# es audit — `mobile.home` — `es1107p1`

**Verdict: `changes_requested`** — 0 BLOCKER, 1 MAJOR, 2 MINOR, 0 NIT
(`passed` requires zero BLOCKER and MAJOR).

- **Scope**: 37 key(s) added by damianvtran/local-operator-mobile#182, read at `origin/main` `b5a2f4a1b0`.
- **Auditor**: reviewer (lopdev team), session `27cb86d0ecef`, actual model `anthropic/claude-opus-5-5`, no fallback. Independent of the translator; no MT/API/SDK used.
- **Reference**: core `origin/main` `0dbe7156be` catalogues and `i18n/glossary.md`; the es mobile catalogue's other namespaces.

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/es/mobile.home.json` | `ba51a71b7c16c79ceff66c7bf6874e375c5c1ebf99a45096237f4da566b4b36e` |
| en source | `src/i18n/catalogues/en/mobile.home.json` | `12d5edd75b0e2a6e969c15c90b2c248d78675f97ebf86dc2e9c49a42d10c761b` |
| en context | `src/i18n/catalogues/en/mobile.home.context.json` | `aa5060ffb2c38f9e6e995011778f73acb9c896590774c513f2f38aba849be047` |

## 1. Mechanical (executed — see `audit.log`)

Placeholders identical to en for every key; no ICU plural/select in scope; 0 bidi control characters; final-stop and ellipsis parity hold; `Local Operator` kept verbatim.

## 2. Findings

| id | severity | keys | current | suggested | reason |
|---|---|---|---|---|---|
| ES-H01 | MAJOR | `chip.effort_default`, `chip.effort_default_unnamed`, `chip.model_default`, `chip.model_no_default_label`, `picker.effort_unknown`, `picker.effort_unsupported`, `picker.effort_use_default`, `picker.folder_outside`, `picker.source_default` | Esfuerzo, {effort}, predeterminado de esta computadora / Esfuerzo, el nivel configurado en esta computadora / Modelo, {model}, predeterminado de esta computadora / Modelo, esta computadora no tiene un modelo predeterminado. Elige uno. / Esta computadora no conoce los niveles de este modelo, así que usará el nivel más cercano que el modelo admita. / El Local Operator de esta computadora es demasiado antiguo para aceptar un esfuerzo, así que usa su nivel configurado. Actualízalo para elegir uno aquí. / Nivel de esta computadora / Esta computadora solo inicia conversaciones dentro de tu carpeta de inicio o de su carpeta temporal. / Predeterminado de esta computadora | computadora → máquina in each value (e.g. «Esfuerzo, {effort}, predeterminado de esta máquina»; «Nivel de esta máquina»; «Esta máquina solo inicia conversaciones dentro de tu carpeta personal o de su carpeta temporal.») | Terminology drift. es renders 'computer' as «máquina» in 27 other mobile values and 61 core values (same namespace: connect_disabled_reason «Conecta una máquina», folders_read_failed, models_read_failed, options.default_model); «computadora» occurs in no other value of either repo — only these 9 new keys, so the picker sheet and the home screen beside it name the same computer two ways. |
| ES-H02 | MINOR | `picker.folder_home` | Inicio | Personal | «Inicio» reads as the Home/Start screen, not the home folder. Core es renders the home folder «carpeta personal» (relay.chrome.session.ended_hint; mobile relay.health.ended_detail); the badge's short form is «Personal». |
| ES-H03 | MINOR | `picker.folder_outside` | Esta computadora solo inicia conversaciones dentro de tu carpeta de inicio o de su carpeta temporal. | «… dentro de tu carpeta personal o de su carpeta temporal.» (plus máquina, above) | «carpeta de inicio» appears nowhere else in either repo; «carpeta personal» is the established es term (1 mobile + 5 core values). |

## 3. Length (320 pt)

- `mobile.home.chip.effort_default_short`: 23 chars vs 14 en on the shared chip row; chips shrink (U-08 cap), so expect ellipsis at 320 pt — needs a rendered check
- `mobile.home.picker.badge_default`: 14 chars vs 7 en; matches the existing mobile.session.chip.model_default «Predeterminado»

## 4. Read and accepted

`chip.effort_chosen`, `chip.effort_default_short`, `chip.model_chosen`, `chip.model_no_default`, `effort.high`, `effort.low`, `effort.max`, `effort.medium`, `effort.minimal`, `effort.none`, `effort.xhigh`, `picker.badge_default`, `picker.badge_this_chat`, `picker.effort_none`, `picker.effort_title`, `picker.folder_other`, `picker.folder_title`, `picker.folder_tmp`, `picker.folder_too_long`, `picker.folder_use_path`, `picker.loading`, `picker.model_empty`, `picker.model_no_match`, `picker.model_search`, `picker.model_title`, `picker.not_connected`, `picker.source_chosen`

## Limits

No rendered capture (no browser tool in this role); length notes are estimates. `generate.ts --check` not run — no worktree; parity re-derived by `mech.py`.
