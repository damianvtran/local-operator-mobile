# es audit — M3 S2b-2b (mobile.computers.setup.* / route_invalid.* / your_computer)

Auditor: i18n-auditor (team lopdev), session 6f3c42e4c00a, model anthropic/claude-opus-5-5 (from session system prompt; no fallback observed). Independent of translator job 0bd7a05014d5. No MT/translation service used.
Inputs: brief sha256 9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67 · draft sha256 f262c2deb8e5e32c9dd1f41e3ca1d55ee1440985ec98d5bb86aa21f32589677a · 27 keys · redaction hits 0.

## Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT

Mechanical: all 27 parse with repo messages.ts (e0027e61); placeholder sets identical to English and brief; no plurals in slice; 0 bidi controls; NFC; key set/order exact; commands/URLs/product names untouched; buttons within English length (ran_it 23 vs 24, watching 18 vs 15).

## Findings
- **ES-S2B2B-01 MINOR** `mobile.computers.setup.create_title`
  - current: Créalo en la máquina
  - problem: Imperative with a definite clitic (Créa-lo) has no antecedent in a card heading; the two sibling route headings are infinitives ("Vincular uno que ya existe", "Usar una dirección"), so the three routes read in different moods. English 'one' is indefinite.
  - suggested: Crear uno en la máquina
- **ES-S2B2B-02 MINOR** `mobile.computers.setup.intro`
  - current: Esta app controla las sesiones de tu propia máquina, así que esa máquina tiene que ejecutar un conector y mantenerse activa. Tu código no sale de ella.
  - problem: 'stay awake' rendered 'mantenerse activa'; 'activa' is the catalogue's connected-status badge (mobile.computers.badge.active) and the billing state word, and the catalogue already renders 'stay awake' as not entering sleep (own_tunnel.step_computer_help 'Evita que entre en reposo').
  - suggested: Esta app controla las sesiones de tu propia máquina, así que esa máquina tiene que ejecutar un conector y no entrar en reposo. Tu código no sale de ella.
- **ES-S2B2B-03 NIT** `mobile.computers.setup.create_help`
  - current: En un terminal de la máquina que quieres controlar:
  - problem: 'un terminal' (masculine) is correct but the core es catalogue uses feminine 'la terminal' 7 times vs 'un terminal' once; feminine also reads more neutral across LatAm.
  - suggested: En una terminal de la máquina que quieres controlar:

## Rulings requested
- Vincular (attach_label, attach_title, attach_help): ACCEPT — natural for joining an existing resource; avoids colliding with 'conectar' used on ran_it; also reads well in copy hint 'Copia el comando “Vincular”'.
- ID del túnel: ACCEPT — 'ID' is the settled es UI term; 12 chars in a field label is fine.
- cadena de consulta: ACCEPT — standard Spanish web term for query string; 'fragmento' likewise.
- la TUI: ACCEPT — TUI is on the style guide's kept-English list; feminine matches core es catalogue (9 occurrences of la/de la TUI, none masculine).
- «Vuelve a buscar tus máquinas»: ACCEPT — describes what discovery does (re-reading the account's computers) in plain words; no settled es term for 'discovery' in the catalogues.
- «renovar su sesión»: ACCEPT — 're-mint' = issue a new session token; 'renovar la sesión' is the faithful plain rendering; 'su' mirrors English 'its'.
- ran_it past tense «Ya lo ejecuté: conectar»: ACCEPT — pretérito is the neutral choice (LatAm standard, fully natural in Spain); 23 chars < English 24; colon is cleaner than an em dash in a button.
- your_computer «Tu máquina»: ACCEPT value — matches catalogue term 'máquina'; mid-sentence lowercase is a known CODE item, not ruled against the draft.

## Other keys
All remaining keys accurate, idiomatic and tú-register; terms consistent with the es catalogue (máquina, relé, túnel, consola de Radient, conector, facturación, host, ID). insecure_off names the switch exactly as shown when off ('Permitir una dirección http://'). Pre-existing, out of scope: es `connect_refused.generic` uses 'El ordenador' against the catalogue's 'máquina'.
