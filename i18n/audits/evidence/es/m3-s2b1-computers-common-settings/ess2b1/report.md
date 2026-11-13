# es audit — M3 S2b-1 (41 keys) — audit id esS2b1

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 1 MINOR, 4 NIT. Auditor: i18n-auditor (lopdev), session 2bfb4822f592, model anthropic/claude-opus-5-5 (system header; no fallback observed). Translator: translator job f0807e12fe32. Source 254e6fba.

## Mechanical (executed — audit.log)
- brief/draft sha256 recomputed: MATCH. 41/41 keys, same order, none added/dropped, valid JSON.
- Placeholder sets identical to English for all 41 (parseMessage of repo src/i18n/messages.ts, node strip-types, 256 MB heap). No bidi/zero-width controls.
- Plurals verdict_sessions/verdict_timeout: one/many/other, # in every arm; rendered 1→one, 0/2/10/1500000→other, 1000000→many (“de”). Correct CLDR es; matches catalogue wait.relay_sessions.
- Commands, `lop`, ngrok, Cloudflare, macOS, HTTPS, Local Operator, {scheme}/{address} untouched. Typography: “ ”, spaced em dash, ¿?, → in iOS path.

## Findings
### ES-01 — MINOR — `mobile.settings.own_tunnel.runtime_body`
- Current: Esta compilación no tiene un almacén de claves seguro, así que el túnel solo dura esta ejecución. En un teléfono, se guarda en el almacenamiento seguro de la plataforma.
- Problem: “el túnel solo dura esta ejecución” is clipped (dura needs “durante”/“mientras”); reads as a calque of “lasts for this run”.
- Suggested: Esta compilación no tiene un almacén de claves seguro, así que el túnel solo se conserva durante esta ejecución. En un teléfono, se guarda en el almacenamiento seguro de la plataforma.

### ES-02 — NIT — `mobile.computers.own_tunnel.verdict_forbidden`
- Current: Ese túnel rechazó la app. Si has puesto delante una política de acceso o una página de inicio de sesión, deja pasar la app; además, el propio relé rechaza las solicitudes de cualquier otro origen, así que asegúrate de que el túnel reenvía directamente a {address} y no a un panel u otra app.
- Problem: Directive “asegúrate de que” reads more naturally with the subjunctive.
- Suggested: …así que asegúrate de que el túnel reenvíe directamente a {address} y no a un panel u otra app.

### ES-03 — NIT — `mobile.computers.own_tunnel.verdict_local_network`
- Current: No respondió nada en esa dirección dentro de esta red. Comprueba que la máquina no está en reposo y que ejecuta el relé; después, pulsa {action}.
- Problem: {action} renders “pulsa Probar la conexión.” unquoted; the draft itself quotes labels in copy_command_hint. Same in verdict_local_network_ios (“toca Probar la conexión”).
- Suggested: …; después, pulsa “{action}”. (and _ios: …y después toca “{action}”.)

### ES-04 — NIT — `mobile.computers.own_tunnel.verdict_timeout`
- Current: Esa dirección no respondió en {seconds, plural, one {# segundo} many {# de segundos} other {# segundos}}. Comprueba que el túnel está en ejecución y que la máquina no está en reposo.
- Problem: “no respondió en 10 segundos” can read as a duration of the failure; a time limit is clearer.
- Suggested: Esa dirección no respondió en un plazo de {seconds, plural, one {# segundo} many {# de segundos} other {# segundos}}. Comprueba que el túnel está en ejecución y que la máquina no está en reposo.

### ES-05 — NIT — `mobile.computers.own_tunnel.install_note`
- Current: macOS: instala el daemon supervisado, que se reinicia solo, genera la contraseña del relé y la guarda en tu llavero.
- Problem: Gloss “que se reinicia solo” is an addition (from the note's definition); harmless and helpful, optional to trim.
- Suggested: macOS: instala el daemon supervisado, genera la contraseña del relé y la guarda en tu llavero.

## Rulings on translator's uncertain keys
- install_note 'contraseña del relé' for 'portal password': ACCEPT — same secret as rotate_note/password_label (“Contraseña del relé”); 'portal' has no catalogue term and would introduce a new concept.
- check_label 'Comprobarlo': ACCEPT — infinitive per es style guide §action labels; parallels “O ejecutarlo en primer plano”; the English 'it' is equally implicit. Uppercase COMPROBARLO, 11 chars.
- runtime_body implied subject: ACCEPT — “se guarda” carries the previous sentence's subject (el túnel = address+password), matching the title “guardarlo”; see ES-01 for the separate 'dura' wording.
- test_again 'Probar de nuevo' length: ACCEPT — own-tunnel-settings.tsx:141-169: Editar/Probar de nuevo/Quitar are size=sm in a flex-row flex-wrap gap-2 row; estimate ~290 pt total vs ~310 pt usable at 375 pt width; at 320 pt or large text the row wraps, no clipping. Busy label “Probando…” is shorter. Estimate, not rendered.

## Cross-locale traps
- verdict_forbidden: “el propio relé rechaza las solicitudes de cualquier otro origen” — correct (relay refuses requests from any other origin, origin-refused, tunnel-verdict.ts:241).
- loopback (foreground_note): “solo desde la propia máquina (loopback)” = same machine only; mirrors step_computer_help.
- Exposure/security: verdict_tls keeps “la app no se saltará la comprobación”; nothing nudges toward insecure choices.
- Pronouns/register: tú throughout (puedes, prueba, tu llavero); consistent with catalogue.
- iOS-only verb “toca” and Ajustes → Privacidad y seguridad → Red local (iOS es labels) only on verdict_local_network_ios; Android/web uses “pulsa”. “puede deberse” keeps the possibility.
- Glossary: máquina, relé, túnel, Quitar, Probar, almacenamiento seguro, almacén de claves, llavero (Apple es), daemon kept English (style guide). Neutral Spanish; no region-marked words.

## Width (estimates, not rendered)
- No maxCells/maxChars in brief. Headings render uppercase in text-mono-label; longest “O EJECUTARLO EN PRIMER PLANO” (28) vs English 27, and the label row wraps (command-block.tsx). Buttons: see test_again ruling. Figtree covers Latin-1 accents (á é í ó ú ñ ¿); no wide/combining glyph risk.

## Claims not made
- No rendered screenshots; widths are estimates. No MT/back-translation used. read_public_copy not used (mobile catalogue paths refused by core route).
