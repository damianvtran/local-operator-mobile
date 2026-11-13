# fr audit — M3 S2b-1 (41 keys) — audit id frs2b1

- Auditor: i18n-auditor (team lopdev), session f4053bd15cda, model anthropic/claude-opus-5-5 (session header; no fallback observed). Independent of translator job d676bc7c4b78.
- Source ce336e4a; brief sha256 d46b2d44…dc4df MATCH; draft sha256 44cf58ab…6aaa MATCH. Date 2026-11-13.
- **Verdict: FAIL — changes_requested.** 0 BLOCKER, 1 MAJOR, 4 MINOR, 3 NIT. 1 SOURCE note.

## Mechanical (executed, see audit.log)
- 41/41 keys, none added/dropped; all parse with src/i18n/messages.ts; placeholder maps identical to English.
- Plurals verdict_sessions / verdict_timeout: one/many/other with # in every arm; rendered 0,1→one, 2,10→other, 1000000→many (« de »), 1500000→other. Correct for fr.
- Typography: U+202F before every : ; ? ! and inside « »; ’ only; " — " spacing matches style guide/catalogue; no bidi controls; commands, product names (macOS, ngrok, Cloudflare, Local Operator, HTTPS) untouched. Redaction hits 0.

## Findings

### F-01 — MAJOR — `mobile.computers.own_tunnel.verdict_forbidden`
- Current: Ce tunnel a refusé l’app. Si vous avez placé une règle d’accès ou une page de connexion devant lui, laissez passer l’app ; le relais refuse lui aussi les requêtes qui ne viennent pas du tunnel : assurez-vous donc que le tunnel redirige directement vers {address}, et non vers un tableau de bord ou une autre app.
- Problem: « les requêtes qui ne viennent pas du tunnel » asserts a mechanism the relay does not have. The verdict maps the relay's `origin-refused` refusal (tunnel-verdict.ts:241): it refuses requests from an origin it does not trust. The fr text tells the reader the relay authenticates the tunnel, misleading the diagnosis.
- Suggested: Ce tunnel a refusé l’app. Si vous avez placé une règle d’accès ou une page de connexion devant lui, laissez passer l’app ; le relais refuse aussi les requêtes dont il ne reconnaît pas l’origine : assurez-vous donc que le tunnel redirige directement vers {address}, et non vers un tableau de bord ou une autre app.

### F-02 — MINOR — `mobile.computers.own_tunnel.foreground_note`
- Current: Toute autre plateforme, ou pour suivre le journal. Le relais écoute sur {address}, accessible depuis cet ordinateur seulement.
- Problem: « Toute autre plateforme, ou pour suivre le journal » pairs a bare noun phrase with a purpose clause (reads broken) and drops the preference in 'would rather'.
- Suggested: Pour toute autre plateforme, ou si vous préférez suivre le journal. Le relais écoute sur {address}, accessible depuis cet ordinateur seulement.

### F-03 — MINOR — `mobile.computers.own_tunnel.rotate_note`
- Current: La commande le demande de façon interactive : il n’apparaît jamais dans l’historique du shell ni dans la liste des processus. C’est le mot de passe que l’app demande ci-dessous.
- Problem: « le » / « il » have no antecedent in the sentence (the password is only named in the heading above); 'so' causality and 'you' are lost.
- Suggested: La commande vous le demande de façon interactive : la valeur n’apparaît donc jamais dans l’historique du shell ni dans la liste des processus. C’est le mot de passe que l’app demande ci-dessous.

### F-04 — MINOR — `mobile.computers.own_tunnel.verdict_tls`
- Current: Le certificat de ce tunnel a été refusé. Utilisez l’adresse {scheme} affichée par le tunnel, choisissez un tunnel dont le certificat est reconnu par un téléphone, ou remplacez le certificat autosigné de celui que vous exploitez — l’app ne contournera pas la vérification.
- Problem: « remplacez le certificat autosigné de celui que vous exploitez » presupposes the reader's tunnel IS self-signed; English 'replace a self-signed certificate' is conditional (rejection may be a hostname mismatch).
- Suggested: Le certificat de ce tunnel a été refusé. Utilisez l’adresse {scheme} affichée par le tunnel, choisissez un tunnel dont le certificat est reconnu par un téléphone, ou remplacez tout certificat autosigné sur celui que vous exploitez — l’app ne contournera pas la vérification.

### F-05 — MINOR — `mobile.settings.own_tunnel.before_saving`
- Current: Testez l’adresse avant de l’enregistrer : un tunnel enregistré qui n’a jamais répondu laisse la liste vide, sans rien pour expliquer pourquoi.
- Problem: « sans rien pour expliquer pourquoi » is a calque of 'with nothing to explain why'.
- Suggested: Testez l’adresse avant de l’enregistrer : un tunnel enregistré qui n’a jamais répondu laisse la liste vide, sans aucune explication.

### N-01 — NIT — `mobile.computers.own_tunnel.rotate_label`
- Current: Créer ou changer le mot de passe
- Problem: « Créer » is acceptable for 'Set' (first-time set); « Définir » is the conventional fr term (Apple: « Définir un mot de passe ») and covers re-setting. +2 chars.
- Suggested: Définir ou changer le mot de passe

### N-02 — NIT — `mobile.settings.own_tunnel.test_again`
- Current: Retester
- Problem: « Retester » is understood but colloquial; flex-wrap row of small buttons has room for the standard form.
- Suggested: Tester à nouveau

### N-03 — NIT — `mobile.computers.own_tunnel.verdict_local_network`
- Current: Rien n’a répondu à cette adresse sur ce réseau. Vérifiez que l’ordinateur n’est pas en veille et qu’il exécute le relais, puis appuyez sur « {action} ».
- Problem: « Rien n’a répondu à cette adresse » is slightly literal; same in verdict_local_network_ios.
- Suggested: Aucune réponse à cette adresse sur ce réseau. (same opening in verdict_local_network_ios)

## Rulings on translator's uncertain keys

- `mobile.computers.own_tunnel.rotate_label`: ACCEPT « Créer » (correct meaning, natural with « ou changer »); NIT N-01 prefers « Définir ».
- `mobile.settings.own_tunnel.runtime_title`: ACCEPT « l’ » — masculine, matches « tunnel » (section « Votre propre tunnel »), mirrors the English 'it'; runtime kept English per fr style guide (Wave-1 addition).
- `mobile.computers.own_tunnel.install_note`: ACCEPT « démon » — settled fr term (Apple fr docs: « démons et agents »); « trousseau » is Apple's fr keychain term.
- `mobile.computers.own_tunnel.verdict_local_network`: ACCEPT « {action} » quoting — fr convention for naming a UI control; {action} is « Tester la connexion » (tunnel-verdict.ts:177/191). Same for _ios.

## Source note

- S-01 `mobile.computers.own_tunnel.verdict_forbidden`: English 'the relay itself also refuses requests it did not come from' is garbled pre-existing source (tunnel-verdict.ts, since d1fd63d3, 2026-10-02). Intended: the relay refuses requests from an origin it does not trust (`origin-refused`). Suggested en: 'the relay itself also refuses requests from an origin it does not trust'. Not a translation fault.

## Cross-locale traps
- Loopback (foreground_note) = « accessible depuis cet ordinateur seulement » — same machine, correct. Exposure/TLS copy keeps « l’app ne contournera pas la vérification »; no nudge to insecure choices. iOS permission kept as possibility (« peut-être »). Pronouns: rotate_note F-03; password_slot_other disambiguated well.

## Width (estimates, not rendered)
- No maxCells in brief. Headings are uppercase mono labels in a flex-wrap row beside the Copy button (command-block.tsx:55): « CRÉER OU CHANGER LE MOT DE PASSE » (32 cells, 34 with N-01) may push Copy to a second line on a 320–390 pt phone — wraps, does not clip. Settings buttons Modifier / Retester / Retirer sit in a flex-wrap row (own-tunnel-settings.tsx:141) — no overflow risk. runtime_title is an Alert title (wraps).

## Non-gating observation
- `#` renders 1000000 without grouping in this engine (no U+202F thousands separator). Engine behaviour, not translation; irrelevant at today's values (10 s, small session counts).

## Claims not made
- No rendered-frame measurement, no MT/translation service, no ledger command run (task restricted writes to this directory).
