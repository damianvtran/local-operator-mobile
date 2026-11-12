# Audit — `ru`, M3 S1 (`mobile.computers` + `mobile.signin`, 44 keys)

- **Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 4 MINOR, 2 NIT. Status `passed` per the audit contract (no blocker/major remains). The minors are wording improvements, not merge gates.
- Locale `ru` · namespace `mobile.computers+mobile.signin` · 44 keys · head `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (base `origin/main` `9e193b57`)
- Draft audited: `/Users/damian/.local-operator/sessions/4991a69dfc4d/scratchpad/draft-ru-s1.json`, sha256 `815be1ace06b0fe3ed87e8f86f352355f5962e57dcd063f449817a690bc71270`
- Brief: `sessions/d5aaf8ba6ba5/scratchpad/translation-brief-s1.json`, sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f` — verified **identical to the English catalogues**: all 44 `english` strings, all 44 `role`s and all 44 `note`s byte-equal to `src/i18n/catalogues/en/mobile.computers*.json` and `mobile.signin*.json` at this head (`brief-vs-en.mjs`, 0 differences). No source skew.
- Auditor: `i18n-auditor`, instance `043c04cecaf3`, session `ce33b5a81024`, model **`deepseek/deepseek-flash`** (the session's own header; no model switch occurred, so this is the working model). Independent of the translator: different role and different session; the translator's notes were read only after every key had been judged, and no translation service, SDK, MT site or back-translation was used.
- Sources read, with hashes: `i18n/style-guides/ru.md` `f20e1caf…6fb5` and `i18n/glossary.md` `0eb34437…62f8` at `damianvtran/local-operator` `origin/main` `8459804f`; shipped `ru` catalogues `mobile.computers` `d9301956…6521`, `mobile.signin` `4699dde2…d81e`, `mobile.common` `ed49861b…64c7`, `mobile.chrome` `fee534fd…79a6`, `mobile.settings` `ef2a6da7…fd82`; the two English catalogues and their context sidecars; call sites `src/features/auth/{computers,tunnel-paths,sign-in,sign-in-panel,welcome}.tsx`, `src/ui/components/{badge,button,dialog,screen}.tsx`.

## 1. Mechanical — clean

| Check | Result |
|---|---|
| JSON validity / flat shape | valid; 44 values, all non-empty strings |
| Key set vs brief | 44/44, none missing, none extra, **order identical** to the brief |
| Keys vs English catalogues | the 44 keys exist in `en` unchanged; nothing added or dropped |
| Parse with the repo's own parser (`parseMessage` from `src/i18n/messages.ts`) | 44/44 parse, 0 throws |
| Placeholder names **and kinds** | identical to English on all 44; the three `row.a11y*` keys carry `name`/`status`/`reach` as `text`, exactly as the source |
| ICU plural / select | none in this group (no plural argument in English), so no CLDR category question arises; no `#`, no `=N`, no nested select |
| Braces / backticks / `%s` / `<tag>` / code spans | brace counts equal to English on every key; no markup, no percent tokens, no code spans in the source or the draft |
| Repo validator (real run) | scratch copy of `src/i18n` + `scripts/i18n`, draft merged into `catalogues/ru`, other locales filled with their English source so the fail-fast loop reaches `ru`: `node scripts/i18n/generate.ts` wrote 734 keys / 21 namespaces, then `--check` → “catalogue.gen.ts is current”, `CHECK_EXIT=0`. Spot-checked the ru strings in the projection (`Свой туннель вместо Radient` at line 5943). |
| Worktree `--check` (read-only) | exits 1 with `es/mobile.computers.json … missing: mobile.computers.not_harness, …` — the **English-first slice state** (no locale but `en` has the 44 new keys yet), not a `ru` defect. `ru`'s own parity/parse/projection is what the scratch run above proves. |
| Typography mechanics | sentence-final punctuation matches English on all 44; ellipsis present exactly where English has it (`wait.listing`, `panel.opening`) and absent elsewhere; no `!`, no `Пожалуйста`, no Title Case, no double or narrow spaces |
| “No English left behind” (the operator's bar) | the only Latin left in the 44 values is `Local Operator`, `Radient`, `URL` and the `{name}/{status}/{reach}` placeholders; the one Cyrillic-free value is `row.a11y`, which is pure placeholder structure. No English prose survives. |
| Note | the only thing my scanner flagged — `own_tunnel_instead` names `Radient` where English says only “instead” — is an **addition**, harmless and arguably clarifying; folded into F4. |

## 2. Findings

### MINOR

**m3s1ru-F1 — `mobile.computers.wait.listing`** · `Ждём, пока Radient добавит ваш компьютер в список…`
First-person plural «Ждём» where the guide prefers impersonal constructions, and the *same* wait panel already ships the impersonal «Ожидание ответа компьютера по адресу {host}.» (`wait.host_answering`), so one panel now mixes two constructions. Meaning is right.
**Suggestion:** `Radient добавляет ваш компьютер в список…`

**m3s1ru-F2 — `mobile.computers.paths.recommended`** · `Рекомендуем`
1pl verb adds a “we” the English participle doesn't have; the guide's call is вы + impersonal. The rationale cites cell length, but this badge lives in a `flex-wrap` row (`tunnel-paths.tsx`), so +2 chars costs nothing.
**Suggestion:** `Рекомендуется`

**m3s1ru-F3 — `mobile.computers.paths.radient_body`** · `…Radient обслуживает туннель за вас…`
«обслуживать туннель» is not a settled Russian collocation (one serves clients or machinery); “runs the tunnel for you” is «поднимает/держит туннель». The rest of the paragraph — account cost, private URL, nothing to configure, no relay password — is accurate and complete.
**Suggestion:** `Нужен аккаунт Radient. Radient сам поднимает туннель и выдаёт закрытый URL с аутентификацией, так что настраивать на этом телефоне нечего и пароль от ретранслятора хранить не нужно.`

**m3s1ru-F4 — `mobile.computers.own_tunnel_instead`** · `Свой туннель вместо Radient`
Verbless noun phrase as a button label; every shipped `ru` button in this namespace is verb-initial («Добавить компьютер», «Сменить компьютер», «Выйти»). Width is not the constraint — this call site passes no `labelLines`, so the Button wraps.
**Suggestion:** `Использовать свой туннель вместо Radient`

### NIT

**m3s1ru-F5 — `mobile.computers.paths.radient_title`** · `Подключение через Radient`
The two sibling cards differ in form: this one nominal, «Настроить свой туннель» infinitival, while the sidecar asks for an imperative phrase. The divergence is forced by `own_title` also being a welcome-screen button label, and the noun phrase is good Russian — recorded, not a defect.
**Suggestion (optional):** `Подключиться через Radient`

**m3s1ru-F6 — `mobile.signin.panel.unavailable_alt`** · `Подключиться всё равно можно — по адресу ретранслятора и паролю.`
Rendered directly above the quiet button «Всё равно попробовать» in the same `unavailable` state (`sign-in-panel.tsx`), so «всё равно» lands twice within two lines.
**Suggestion:** `Подключиться всё-таки можно — по адресу ретранслятора и паролю.` (button unchanged)

### Per-key verdicts that are not clean
Only the six keys above. **The other 38 keys are clean** — accepted as written, including the safety-critical ones re-read in §3.

## 3. What I checked hardest (accuracy, polarity, safety)

- `mobile.signin.intro` — the privacy guarantee is exact: «…поэтому приложение не видит ваш пароль.» Same claim, no weakening.
- `mobile.signin.panel.cancelled_help` — «В вашем аккаунте ничего не изменилось.» keeps the “nothing changed” reassurance; no negation flip.
- `mobile.computers.remove.title` / `.body` / `.confirm` — destructive trio correct: a question, **all three negations** kept (компьютер, его туннель, ваш аккаунт), and «Удалить» is the destructive verb, not «Убрать».
- `mobile.computers.billing_inactive` — «…поэтому в удалённом доступе будет отказано.» keeps the refusal warning and the impersonal passive the guide asks for.
- `mobile.computers.wait.tunnel_status` — the `{status}` token is an untranslated English word; parking it after a colon («Туннель на стороне Radient: {status}») keeps the sentence grammatical for any value Radient sends. **Better than a Russian agreement slot** — I checked the alternative and it breaks on some values.
- `mobile.signin.welcome.body` — «Ваш код её не покидает.» (`её` = машина, the nearest feminine singular) keeps the promise; the `компьютер`/`машина` switch mirrors the English `computer`/`machine` and matches shipped ru («на этой машине»).
- `mobile.computers.row.a11y_active` / `_connecting` — end with «активен» / «подключается», byte-equal to shipped `badge.active` / `badge.connecting`, as the sidecar requires. The a11y labels read correctly when composed.
- `mobile.computers.status.*` + `reach.answering` — lowercase kept (ru has case, so this is a real choice, and it holds). `отключён` and `неизвестно` are already shipped ru status words; `приостановлен` agrees with `туннель`; `маршрут готов` keeps “route ready” as a *route* state, not a computer state, as the note requires.

## 4. Terminology

- Glossary conformant: `Local Operator`/`Radient`/`URL` kept Latin and undeclined; relay → **ретранслятор**; session → сессия; agent → агент.
- Consistent with shipped `ru`: `туннель` (5 occurrences in shipped computers copy), `маршрут` (`Настроенный маршрут…`), `вход/Войти` (the whole `mobile.signin` stage set), `аккаунт` (dominant over `учётная запись`, which appears once, in `stage_retiring`), `отключён`, `неизвестно`, `Ожидание браузера` (byte-equal to shipped `stage_browser`), `Вход отменён` (byte-equal to shipped `stage_cancelled`).
- **No new term contradicts an existing one.** The five glossary proposals in the translator's notes (tunnel, route, sign-in, harness, computer/machine) all match shipped usage — accepted (see receipt `considered_and_accepted`).
- Translator's “judged identical” list: **agreed** — `row.a11y` = `{name}, {status}, {reach}` is pure placeholder structure; translating nothing there is correct and keeps it in step with `_active`/`_connecting`.

## 5. Fit (measured, not rendered)

Mono badge type is 11 px / weight 600 / tracking 0.06 em (`src/ui/tokens.gen.ts:203`); the repo's own badge-width formula is `2*1 + 2*8 + len*11*0.6` (`src/features/home/header-fit.test.ts:109`); content width is the screen's `px-4` inset → **288 pt on a 320 pt phone**.

| Item | ru | en |
|---|---|---|
| widest badge label (`приостановлен`) | 103.8 pt (112.4 w/ tracking) | 77.4 pt (`suspended`) |
| widest two-badge row (`приостановлен` + `отвечает`, 8 pt gap) | **182.6 pt** (196.5 w/ tracking) | 162.8 pt (`suspended`+`answering`); en worst pair 182.6 pt (`provisioning`+`answering`) |

Verdict: fits at 1× with ~90 pt headroom. At 200 % text the ru pair measures ~321 pt; the English pair measures ~321 pt too — **identical overflow, so this is the badge row's pre-existing geometry, not a `ru` regression**. No `numberOfLines` cap on badges (they wrap rather than truncate); no `labelLines` at any of these button call sites, so every long button label («Использовать этот компьютер» 27, «Войти по адресу и паролю» 24, «Настроить свой туннель» 22) wraps. `paths.radient_title` + its badge sit in a `flex-row flex-wrap` (added for the U-06 320 pt / 200 % case) — `Подключение через Radient` + `Рекомендуется` wrap cleanly. Widest growth vs English in a tight slot: `try_now` 7→18 chars, but it is a wrapping banner Button with room. **No overflow finding.**

## 6. Second pass (high-visibility group)

This group is onboarding + sign-in + one destructive dialog, so I re-read all 14 `mobile.signin` values and the destructive/permission ones (`remove.*`, `billing_inactive`, `panel.unavailable*`) after the first pass. It changed nothing in the verdict; F2, F5 and F6 are the items that only surfaced on the second read. **Disclosure: that was the same instance, not a second independent auditor** — a genuinely independent second pass is still the manager's to commission if this group is gated as high-visibility.

## 7. Limitations

- No rendered frame, no native build, no device run: fit is point arithmetic with the repo's own formula, not measured pixels. A UI reviewer still has to look at the ru strings in a build.
- The repo validator ran in a throwaway scratch copy (`scratchpad/validate-ru/`) because this role may not write into the worktree; the non-ru locales were filled with their English source values **in that copy only**, so the run proves ru's parse/parity/projection, not their translations.
- One auditor's reading; no human native-speaker review.
- No ledger command exists in this repository at this head (`i18n/` holds only `audits/evidence`, `scripts/i18n` has no ledger writer), so this receipt **is** the record — the coordinator applies the tracked row.

## 8. Artifacts (all in this session's scratchpad)

`receipt.json` (machine record) · `report.md` (this file) · `audit.log` (commands + real output) · `mech-ru-s1.mjs` / `mech-ru-s1.out` (parser + parity over all 44) · `brief-vs-en.mjs` (brief/catalogue equality) · `widths.mjs` (badge arithmetic) · `validate-ru/` (throwaway validator copy, `CHECK_EXIT=0`).
