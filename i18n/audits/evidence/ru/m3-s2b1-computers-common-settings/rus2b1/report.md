# ru audit — M3 slice S2b-1 (41 mobile keys)

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 2 MINOR, 3 NIT.

- Auditor: i18n-auditor (lopdev), session 1e34afaf7f7e. Actual model: anthropic/claude-opus-5-5 (session header; no fallback observed).
- Translator: translator job 11dc69ef57cd — independent.
- Source commit 254e6fba (feat/i18n-m3-s2b1). Brief sha256 d694b10abcfb07f94aebdaca55fb5a80929575f90282661f20cfae4f1b0b88e9 and draft sha256 988c530ec3d6553103b592ab6eb53708884821d020cf4b1a78bd34e5cc61b550 were recomputed and matched before the audit.
- Glossary: ru catalogues at ffbda180 (mobile.computers/settings/common) + ~/local-operator/i18n/style-guides/ru.md.

## Mechanical (executed)
- 41/41 keys, no added/dropped keys, valid JSON.
- Every string parsed with src/i18n/messages.ts (node 24 --experimental-strip-types, --max-old-space-size=256). There are 0 placeholder-set mismatches.
- Plurals verdict_sessions / verdict_timeout: arms one/few/many/other, # in every arm. Formatted for 0,1,2,5,10,21,22,1.5 → сессий/сессию/сессии/сессий/сессий/сессию/сессии/сессии and the same pattern for секунд…, all correct. (The 1.5 renders with '.', which is formatter behaviour, not translation.)
- No Cc/Cf (bidi) characters. Commands, URL schemes, ngrok/Cloudflare/Local Operator/macOS/HTTPS/URL/shell were left untranslated.
- Redaction: draft has 0 occurrences of "redact". foreground_note shows `[redacted]` through tools, but code points U+0420 U+0435 U+0442 U+0440 U+0430 U+043D U+0441 U+043B U+044F U+0442 U+043E U+0440 = the Cyrillic word for relay (harness masking).

## Rulings on translator's uncertain keys
- foreground_label «Или запустить в терминале»: ACCEPTED. Note defines foreground as a terminal window vs background service; «в обычном режиме» is vaguer.
- verdict_forbidden incl. «(origin)»: ACCEPTED. «сам ретранслятор тоже отклоняет запросы с любого другого источника (origin)» is exact (any other origin). It does not repeat the fr F-01 'not from the tunnel' error. The gloss helps a technical reader.
- runtime_title «Здесь туннель не сохранить»: ACCEPTED (avoiding «рантайм» jargon in an end-user title is right). There is an optional NIT RU-03.
- Small buttons: see Fit.

## Fit (estimates, not measured)
Figtree is bundled as a Latin-only subset (theme.css unicode-range lacks U+0400–04FF), so Cyrillic falls back to the system face (SF Pro / Roboto / system-ui). The mono labels use JetBrains Mono; Cyrillic coverage of the bundled woff2 was not verified (no fontTools; upstream has Cyrillic).
Buttons sm = text-meta 12px/500 + px-3. These are estimates at ≈6.7 px per Cyrillic char:
- Копировать ≈88 pt
- Скопировано ≈96 pt
- Изменить ≈76 pt
- Проверить снова ≈116 pt
- Удалить ≈70 pt

The settings row (edit+test_again+remove ≈278 pt with gaps) may wrap on a 320 pt phone. It is `flex-wrap` (own-tunnel-settings.tsx:141), so it wraps and does not overflow. The command-block label row is also flex-wrap. Mono labels: «ИЛИ ЗАПУСТИТЬ В ТЕРМИНАЛЕ» 25 ch ≈182 pt, shorter than English (27 ch). No overflow finding.

## Findings

### RU-01 — MINOR — `mobile.computers.own_tunnel.foreground_note`
- Current: Для любой другой платформы или если вы предпочитаете следить за журналом. Ретранслятор работает на {address} и доступен только с этого же компьютера.
- Problem: «доступен только с этого же компьютера»: on a phone screen «этого» can read as the phone; the note means the computer running the relay.
- Suggested: Для любой другой платформы или если вы предпочитаете следить за журналом. Ретранслятор работает на {address} и доступен только с того же компьютера.

### RU-02 — MINOR — `mobile.computers.own_tunnel.check_note`
- Current: Работоспособность, состояние проверки пароля и сессии, которые увидит телефон.
- Problem: «состояние проверки пароля и сессии» first parses as genitive 'state of the password check and of the session'; only «которые» later disambiguates.
- Suggested: Работоспособность, состояние проверки пароля, а также сессии, которые увидит телефон.

### RU-05 — NIT — `mobile.computers.own_tunnel.verdict_host`
- Current: Имя хоста не найдено. Проверьте, нет ли в адресе опечатки и публикует ли туннель это имя до сих пор.
- Problem: «до сих пор» slightly colloquial here.
- Suggested: Имя хоста не найдено. Проверьте, нет ли в адресе опечатки и по-прежнему ли туннель публикует это имя.

### RU-04 — NIT — `mobile.computers.own_tunnel.verdict_local_network_ios`
- Current: По этому адресу в данной сети никто не ответил. Убедитесь, что компьютер не спит и на нём запущен ретранслятор. Если всё так, возможно, дело в разрешении на доступ к локальной сети: разрешите его для Local Operator в разделе Настройки → Конфиденциальность и безопасность → Локальная сеть, затем нажмите «{action}».
- Problem: «разрешении… разрешите его» repeats the root; iOS shows a toggle.
- Suggested: …возможно, дело в разрешении на доступ к локальной сети: включите его для Local Operator в разделе Настройки → Конфиденциальность и безопасность → Локальная сеть, затем нажмите «{action}».

### RU-03 — NIT — `mobile.settings.own_tunnel.runtime_title`
- Current: Здесь туннель не сохранить
- Problem: Accepted (avoids jargon «рантайм» in an end-user title); «Здесь» is vague and colloquial; align with body's «сборка».
- Suggested: Эта сборка не сохраняет туннель

## Cross-locale traps checked
- verdict_forbidden: correct origin semantics.
- loopback: «только с … компьютера» means same machine only (RU-01 sharpens the deixis).
- Exposure/TLS wording is firm: «приложение не будет пропускать проверку».
- Nothing nudges the reader towards an insecure choice.
- Register: lowercase вы, impersonal, infinitive labels, «» quotes, spaced em dash. Glossary: ретранслятор, сессия, туннель, защищённое хранилище, «Проверить подключение» via {action}.
- iOS menu path uses the iOS ru labels (Настройки → Конфиденциальность и безопасность → Локальная сеть) and appears only on the _ios key. «нажмите» is platform-neutral.

## Per-key
- `mobile.computers.own_tunnel.install_label` — pass
- `mobile.computers.own_tunnel.foreground_label` — pass — Uncertain key ruled ACCEPTED: matches note (terminal window vs background service); «в обычном режиме» would be vaguer.
- `mobile.computers.own_tunnel.check_label` — pass
- `mobile.computers.own_tunnel.rotate_label` — pass
- `mobile.computers.own_tunnel.install_note` — pass
- `mobile.computers.own_tunnel.foreground_note` — minor RU-01
- `mobile.computers.own_tunnel.check_note` — minor RU-02
- `mobile.computers.own_tunnel.rotate_note` — pass
- `mobile.computers.own_tunnel.cloudflare_note` — pass
- `mobile.computers.own_tunnel.ngrok_note` — pass
- `mobile.computers.own_tunnel.tunnel_rule` — pass
- `mobile.computers.own_tunnel.verdict_sessions` — pass — ICU one/few/many/other, # in all arms; parsed+formatted 0,1,2,5,10,21,22,1.5 correctly.
- `mobile.computers.own_tunnel.verdict_password` — pass
- `mobile.computers.own_tunnel.verdict_forbidden` — pass — Ruled ACCEPTED incl. «(origin)» gloss: «с любого другого источника (origin)» carries 'any other origin' exactly; gloss aids the technical reader. No 'from the tunnel' mechanism error (cf. fr F-01).
- `mobile.computers.own_tunnel.verdict_offline_detail` — pass
- `mobile.computers.own_tunnel.verdict_offline` — pass
- `mobile.computers.own_tunnel.verdict_tls` — pass
- `mobile.computers.own_tunnel.verdict_host` — nit RU-05
- `mobile.computers.own_tunnel.verdict_unreachable` — pass
- `mobile.computers.own_tunnel.verdict_timeout` — pass — ICU one/few/many/other, # in all arms; formatted correctly.
- `mobile.computers.own_tunnel.verdict_local_network_ios` — nit RU-04
- `mobile.computers.own_tunnel.verdict_local_network` — pass — «нажмите» is platform-neutral in ru (tap/click); no iOS-only path on this key.
- `mobile.computers.own_tunnel.verdict_refused` — pass
- `mobile.computers.own_tunnel.remedy` — pass
- `mobile.computers.own_tunnel.password_slot_other` — pass
- `mobile.computers.own_tunnel.password_slot_empty` — pass
- `mobile.computers.own_tunnel.password_slot_this` — pass
- `mobile.common.copy` — pass — Width est. ~88 pt (system-font fallback, 12px/500 + px-3); label row flex-wraps.
- `mobile.common.copied` — pass — Width est. ~96 pt; flex-wrap row, no overflow.
- `mobile.common.copy_command_hint` — pass
- `mobile.settings.own_tunnel.not_saved` — pass
- `mobile.settings.own_tunnel.kept_secure` — pass
- `mobile.settings.own_tunnel.edit` — pass — Width est. ~76 pt.
- `mobile.settings.own_tunnel.test_again` — pass — Width est. ~116 pt; edit+test_again+remove ≈ 278 pt incl. gaps — may wrap on a 320 pt phone (row is flex-wrap), fits 375+ pt.
- `mobile.settings.own_tunnel.remove` — pass
- `mobile.settings.own_tunnel.password_placeholder` — pass
- `mobile.settings.own_tunnel.runtime_title` — nit RU-03
- `mobile.settings.own_tunnel.runtime_body` — pass
- `mobile.settings.own_tunnel.before_saving` — pass
- `mobile.settings.own_tunnel.remove_title` — pass
- `mobile.settings.own_tunnel.remove_body` — pass
