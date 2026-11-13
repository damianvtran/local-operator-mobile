# ru audit — round 2 (delta) — M3 S2b-2a mobile.computers.refusal.* (24 keys)

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT new). Auditor: i18n-auditor (lopdev), session 28e3915989d0, anthropic/claude-opus-5-5 (no fallback observed); independent of translator jobs 332734020f56/7cc5dbc90b02 and of round-1 auditor session 476cde7c4696 (job 0c2019891e7c).

## Inputs (recomputed, all match brief)
- brief d151df76…0e40, v1 ccbafb2d…8f36, v2 c393839d…6d4d; notes-ru-v2.md 92253529…e314.
- Redaction marker count: brief 0, v1 0, v2 0.

## Delta check
- Keys changed v1→v2: exactly `console_next`, `password_next` (= the 2 listed in notes). Other 22 values identical; key order v1 = v2 = brief. Raw `diff` = 6 lines (one 2-line change hunk).
- messages.ts parseMessage: 24/24 parse, 0 errors; placeholder name:kind sets equal English on all 24 (both changed keys have none). ru CLDR one/few/many/other (wait_seconds unchanged from v1, R1-verified).
- 0 bidi controls, all NFC. Relay word in password_next verified by code points U+0440 U+0435 U+0442 U+0440 U+0430 U+043D U+0441 U+043B U+044F U+0442 U+043E U+0440 U+0430 («ретранслятора», genitive) — catalogue term, not masked.

## Round-1 findings
- **RU-1 MINOR** console_next — RESOLVED. v2 «Откройте консоль Radient и устраните проблему там. Повторный вход на этом телефоне ничего не изменит.» = R1 suggestion verbatim. «устранить проблему» is standard RU UI collocation; meaning (fix the one issue in the console; re-sign-in on phone won't help) preserved; no polarity change.
- **RU-2 NIT** password_next — RESOLVED. v2 «Проверьте пароль ретранслятора на компьютере и подключитесь снова.» = R1 suggestion verbatim. Confirmed in refusal-surface.tsx L297–311: `password` kind renders the `try_again` button = «Подключиться снова», so the instruction now echoes its action; perfective imperative «подключитесь» correct.
- Rulings (tunnel_gone_title, console_title, retry_title, try_now/try_again, relay term): kept unchanged in v2; values byte-identical, no re-audit.

## New findings on delta
None. (Considered: «там» at sentence end in console_next vs «в ней» — both natural; «там» mirrors EN 'there' and keeps the console as referent. Not a finding.)
