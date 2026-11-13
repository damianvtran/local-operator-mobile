# ru round-2 delta audit — M3 slice S2b-1 (audit id rus2b1r2)

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. No new findings.

- Auditor: i18n-auditor (lopdev), session cc90c83e0469. Actual model: anthropic/claude-opus-5-5 (session header; no fallback observed). I am independent of the translator (jobs 11dc69ef57cd / d61c27f0aaa7) and of the round-1 auditor (job 63f0cd2abdc5, session 1e34afaf7f7e).
- Inputs: I recomputed all three sha256 values and they match: brief-s2b1-v2.json d694b10a…, ru/draft-ru.json 988c530e…, ru/draft-ru-v2.json fbc01f00…. Source commit 254e6fba (feat/i18n-m3-s2b1).
- Read route: ordinary git/scratchpad reads. read_public_copy was not used: the core route refuses mobile catalogue paths, and the context sidecars are nested JSON and not routable.

## Mechanical (executed)
- Key order equals the brief in both v1 and v2 (41/41).
- A computed v1→v2 diff changes exactly 5 keys, the same 5 the notes list. The other 36 are byte-identical.
- Every v2 string parsed with src/i18n/messages.ts (node --experimental-strip-types, heap 256 MB):
  - 0 parse failures and 0 placeholder mismatches across all 41 keys.
  - foreground_note keeps {address}, and verdict_local_network_ios keeps {action}.
  - The changed keys have no plurals. The unchanged plurals still have one/few/many/other.
- No Cc/Cf characters, and 0 literal "redact" in v2.
- Redaction: in foreground_note, `[redacted]` is harness masking. Its code points are U+0420 U+0435 U+0442 U+0440 U+0430 U+043D U+0441 U+043B U+044F U+0442 U+043E U+0440, the sentence-initial Cyrillic word for relay. It is unchanged from v1.

## Per-key results (changed keys only)
| Key | Change | Result | Round-1 finding |
|---|---|---|---|
| foreground_note | «с этого же компьютера» → «с того же компьютера» | pass | RU-01 resolved |
| check_note | «и сессии» → «и список сессий» | pass | RU-02 resolved (alternative wording) |
| verdict_host | «…публикует ли туннель это имя до сих пор» → «…по-прежнему ли туннель публикует это имя» | pass | RU-05 resolved |
| verdict_local_network_ios | «разрешите его» → «включите его» | pass | RU-04 resolved |
| runtime_title | «Здесь туннель не сохранить» → «Эта сборка не сохраняет туннель» | pass | RU-03 resolved |

### Rulings
- **RU-01:** «того же компьютера» now points at the relay's computer, not the phone, so the deixis ambiguity is gone. «доступен» still agrees with the masculine subject. "Loopback only" is preserved.
- **RU-02:** The translator's own wording is acceptable. «список сессий, которые…» resolves the old genitive garden path, because plural «которые» agrees with «сессий» and not with singular «список». "List of" is a faithful gloss of what the command reports. The sentence reads more cleanly than my predecessor's «а также».
- **RU-03:** «Эта сборка» matches «В этой сборке…» in runtime_body and the note's "build (for example the web preview)". «не сохраняет» is idiomatic for a capability statement, and the body makes the inability explicit. There is no maxChars hint. At 31 chars it is a heading in a wrapping info box.
- **RU-04:** In «включите его», «его» refers back to the neuter «разрешении», so the grammar is correct. iOS shows a per-app toggle, and the possibility framing («возможно») is kept. The iOS menu path and «{action}» quotes are unchanged.
- **RU-05:** «по-прежнему ли туннель публикует» keeps the meaning of "still publishes" in a neutral register, and the indirect-question syntax is correct.

Typography (« », spaced em dash, → arrows) and the glossary terms (ретранслятор, туннель, сборка, сессия) are consistent with the rest of the file. The ledger was not written. This is a scratch-stage delta audit, so the manager records the ledger row when the catalogue lands.
