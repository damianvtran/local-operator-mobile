# ru audit — round 2 (delta) — M3 S2b-2b (computers setup / route_invalid / your_computer)

Verdict: **passed**. Delta findings: 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. Round-1 findings: RU-1 resolved, RU-2 resolved, and the RU-3 rejection is acceptable.
Auditor: i18n-auditor (team lopdev), session 77cafd2f0293, anthropic/claude-opus-5-5, no fallback observed. I am independent of translator jobs d6471ba1d021/526f25a44b25 and of the round-1 auditor ca31bb01f337.

## Inputs (recomputed, all match brief)
- brief-s2b2b.json `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (redaction-marker hits: 0)
- ru/draft-ru.json (v1) `28bfa56580a845402811ab27f6a2ee08ed52d94cfd665c11c46174727f1e8b6a`
- ru/draft-ru-v2.json (v2) `c3fca87183de74c51b7cff563e166fb97a7af2c71bfefe847b43f5ebf89bc9d0` (redaction-marker hits: 0)
- ru/notes-ru-v2.md `40111c58ca5cccd62f41d95db278f61d382e6cded2219a7e3da0d78e3e380211`
- round-1 audits/ru/report.md `2292ed8c1b6faed2f7f2fd10de87233ab1edf49ecccc2123a7dafe5c76f74ec8`

## Delta mechanics
- v1→v2 changes exactly 2 keys, the same ones the notes list: `mobile.computers.setup.address_help` and `mobile.computers.route_invalid.no_tunnel_id`. A raw-line unified diff shows only lines 18 and 27 (29 lines in each file). The other 25 values are byte-identical, and key order matches the brief in both versions.
- I ran messages.ts (git show e0027e61:src/i18n/messages.ts, byte-identical to round 1's copy) through tsx at a 256 MB heap on byte-identical copies of the brief and v2 in my own scratchpad. A guardrail refused passing another session's files to tsx directly. Result: 27/27 ok, bad 0. Both changed keys parse and format with no leftover braces. Placeholders are [] in English and in both changed values.
- v2 has 0 bidi controls and is NFC. The only non-Cyrillic, non-ASCII code point in the changed values is U+2014 (em dash), the same as in v1.
- The relay word in address_help is real Cyrillic: U+0440 U+0435 U+0442 U+0440 U+0430 U+043D U+0441 U+043B U+044F U+0442 U+043E U+0440 (ретранслятор). It is only masked when displayed.

## Round-1 findings
- **RU-1 MINOR no_tunnel_id — RESOLVED.** v2: «У этого туннеля нет идентификатора, поэтому его сессию нельзя обновить. Обновите список компьютеров.» I checked that the instruction points at a real control. ru `mobile.computers.refresh` = «Обновить», rendered at src/features/auth/computers.tsx:554. Its catalogue note says it is the button that "re-reads the account's computers", which is exactly what "Re-run discovery" means. «обновить» appears twice, once for the session and once for the list. I judge that acceptable: the second use names the button the user has to press, and the two objects are different. English repeats "Re-…" in the same way.
- **RU-2 NIT address_help — RESOLVED.** v2 «подключитесь к нему, указав пароль самого ретранслятора». The adverbial participle has the same subject as the imperative (the user), so it is grammatical. The comma is correct, and «указав» reads as entering the password, as suggested.
- **RU-3 NIT attach_label — REJECTION ACCEPTABLE.** Round 1 itself ruled «Подключение» acceptable and marked the alternative optional ("keep"). The noun works as an upper-case command-block header and inside the copy hint «Копирует команду «Подключение»». A verb form would read badly there («команду «Подключить»» is possible but no better). The clash with «Подключение…» (`mobile.computers.connecting`) is on a different surface and that string has an ellipsis.

## New findings on the delta
None. I checked both changed strings for fit. They are body/error copy, not buttons. address_help grew from 169 to 174 rendered chars and no_tunnel_id shrank from 107 to 100, so neither has a length constraint.
