# ru audit — M3 S2b-2a mobile.computers.refusal.* (24 keys)

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT). Auditor: i18n-auditor, session 476cde7c4696, anthropic/claude-opus-5-5, independent of translator job 332734020f56.

Mechanical: 24/24 parse with messages.ts; placeholders identical to EN; plural one/few/many/other with # in each arm; «около» + genitive verified for 0,1,2,4,5,11,14,21,22,25,101,111,1.5; 0 bidi controls; NFC; redaction marker count 0 in brief and draft.

## Findings
- **RU-1 MINOR** `mobile.computers.refusal.console_next`  
  Current: Откройте консоль Radient и исправьте всё там. Повторный вход на этом телефоне ничего не изменит.  
  Problem: «исправьте всё там» over-generalises EN 'fix it there' (it = the one issue) and reads colloquially.  
  Suggested: Откройте консоль Radient и устраните проблему там. Повторный вход на этом телефоне ничего не изменит.
- **RU-2 NIT** `mobile.computers.refusal.password_next`  
  Current: Проверьте пароль ретранслятора на компьютере и попробуйте снова.  
  Problem: Optional: the button below now reads «Подключиться снова»; echoing it ties instruction to action. Current text is correct and matches own_tunnel/connect_refused wording, so keep if consistency with those is preferred.  
  Suggested: Проверьте пароль ретранслятора на компьютере и подключитесь снова.

## Rulings requested by manager
- tunnel_gone_title: KEEP «{subject} больше не является туннелем.» — «является» is standard in RU UI error headlines; «{subject} больше не туннель.» reads clipped when {subject} is a URL (the usual case per refusal-surface.tsx D23). No finding.
- console_title: KEEP «{subject} требует внимания в Radient.» — «требует внимания» is native RU UI idiom (cf. OS notifications), not a calque. No finding.
- retry_title: KEEP «{subject} пока не готов.» — masculine is the default agreement for Latin-script names/URLs in Russian (implicit «адрес/компьютер»); a neutral rewrite would add words or change meaning. No finding.
- try_now/try_again: KEEP «Подключиться сейчас»/«Подключиться снова» — context notes say both retry the CONNECTION and must differ from mobile.computers.try_now «Попробовать сейчас» and mobile.common.try_again «Повторить»; 19/18 chars ≤24. No finding.
- relay_term: Verified by code points U+0420 U+0435 U+0442 U+0440 U+0430 U+043D U+0441 U+043B U+044F U+0442 U+043E U+0440 = «Ретранслятор» (relay_stopped_title); display masking only, the redaction-marker substring absent from value and raw file (count 0). Matches catalogue term.

Other keys reviewed with no finding: terms match ru catalogue (ретранслятор, туннель, консоль Radient, сессия входа, самоподписанный, имя хоста); certificate_*/host_*/password_title reuse own_tunnel.verdict_* wording; «коннектор» acceptable new loan; sign_in_next keeps the not-sent promise («помещено в карантин и не будет отправлено»); buttons ≤23 chars.
