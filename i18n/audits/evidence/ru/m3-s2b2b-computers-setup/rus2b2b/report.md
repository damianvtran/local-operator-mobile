# ru audit — M3 S2b-2b (computers setup / route_invalid / your_computer)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT. Auditor i18n-auditor (session ca31bb01f337, anthropic/claude-opus-5-5, no fallback). Translator job d6471ba1d021.

Brief sha256 9b37cb3d…196c67 ✓ · draft sha256 28bfa565…6b8a ✓ · redaction marker hits: brief 0, draft 0.

## Mechanical
27/27 keys parsed and formatted with the repo's messages.ts (256 MB heap); placeholders exact; no ICU plural/select in slice; 0 bidi controls; NFC; no mixed-script words; Radient/Local Operator/TUI/http:// kept. The relay word is real Cyrillic (U+0440 U+0435 U+0442 …), only masked by display.

## Terminology
Consistent with ru/mobile.computers.json: ретранслятор, туннель, консоль Radient, пароль от ретранслятора, «Разрешить адрес http://» (own_tunnel.insecure_allow, verbatim), «неактивен» (disabled_help), «частный» адрес (own_tunnel.public_host), спящий режим (verdict_timeout).

## Rulings

- **setup.attach_label 'Подключение'** — ACCEPT. A noun naming the command block, and it reads correctly in the copy hint: «Копирует команду «Подключение»». Width: shown upper-case (ПОДКЛЮЧЕНИЕ, 11 glyphs) in CommandBlock's flex-row flex-wrap label row next to a quiet sm 'Копировать'/'Скопировано' button. The same component already ships 'ИЛИ ЗАПУСТИТЬ В ТЕРМИНАЛЕ' (25) on own_tunnel, and flex-wrap prevents overflow, so it fits at 320 pt with no clipping risk.
- **setup.watching 'Ждём туннель'** — ACCEPT. Natural spinner-button copy, with the tunnel made explicit. The accusative with ждать is correct for a specific expected object. No ellipsis needed because the button shows a spinner.
- **setup.ran_it 'Готово — подключить'** — ACCEPT. It avoids a gendered past verb (выполнил/а), 'Готово' carries 'I have run it', and the dash plus infinitive is the standard Russian button pattern. At 19 chars it is shorter than the English.
- **route_invalid.no_tunnel_id 'сессию нельзя обновить'** — ACCEPT. 'Re-mint' means issue a new session token, and 'обновить сессию' is the standard user-facing wording for that. Literal 'перевыпустить токен' would be jargon.
- **route_invalid.no_tunnel_id 'Запустите поиск компьютеров заново'** — CHANGE (MINOR RU-1): point to the visible 'Обновить' control instead: 'Обновите список компьютеров.'
- **your_computer 'Ваш компьютер'** — ACCEPT as the nominative fallback. Initial capital fits sentence-initial slots. Case agreement in the prepositional and dative headlines (relay_stopped_title, sign_in_title) is the known code item and out of scope.

## Findings

### RU-1 MINOR — `mobile.computers.route_invalid.no_tunnel_id`
Current: У этого туннеля нет идентификатора, поэтому его сессию нельзя обновить. Запустите поиск компьютеров заново.

Problem: 'Запустите поиск компьютеров заново' names an action the app never shows: no control is called 'поиск'. 'Discovery' is the app re-reading the account's computers; the visible control for that on the Computers screen is 'Обновить' (mobile.computers.refresh). Reserved string, so not gating.

Suggested: У этого туннеля нет идентификатора, поэтому его сессию нельзя обновить. Обновите список компьютеров.

### RU-2 NIT — `mobile.computers.setup.address_help`
Current: Если ваш ретранслятор доступен по известному вам URL, подключитесь к нему с паролем самого ретранслятора. Этот путь — для компьютера, который вообще не связан с Radient.

Problem: 'подключитесь к нему с паролем самого ретранслятора' reads a little literal; 'с паролем' sounds as if the password goes along with you rather than being entered.

Suggested: Если ваш ретранслятор доступен по известному вам URL, подключитесь к нему, указав пароль самого ретранслятора. Этот путь — для компьютера, который вообще не связан с Radient.

### RU-3 NIT — `mobile.computers.setup.attach_label`
Current: Подключение

Problem: Same word as the connecting status 'Подключение…' (mobile.computers.connecting), but that one sits on another surface and has an ellipsis, and here the label is an upper-case mono header. Keeping it is fine. Optional verb form if a later pass wants the label to match its imperative card title.

Suggested: Подключение (keep) — optional alternative: Подключить
