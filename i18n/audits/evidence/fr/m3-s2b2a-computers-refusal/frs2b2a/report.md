# French (fr) audit — mobile.computers.refusal.* (M3 S2b-2a)

Auditor: i18n-auditor, session 41808e7144c1, model anthropic/claude-opus-5-5 (no fallback). Translator job 9fb915e773aa (independent).
Brief sha256 d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40 · Draft sha256 f772103e61bbe87e18603b57b5152d360cf48a999a8fc04bafc96a8a192985f4 · 24 keys · redaction hits 0/0.

## Verdict: **passed** (0 BLOCKER, 0 MAJOR, 2 MINOR, 3 NIT)

Mechanical: keys and order identical to brief; placeholders identical per repo parser (messages.ts); fr plural categories one/many/other all present; zero bidi controls; NFC; U+2019 apostrophes; no French high-punctuation needing NBSP.

## Findings

### F1 — MINOR — `mobile.computers.refusal.offline_next`
- Current: Réveillez cet ordinateur et vérifiez que le connecteur est lancé. Son dernier état connu figure ci-dessus.
- Problem: « Son dernier état connu » directly follows « le connecteur », so the possessive reads as the connector's state; the English 'Its' and the note mean the computer's last known state shown above.
- Suggested: Réveillez cet ordinateur et vérifiez que le connecteur est lancé. Le dernier état connu de l’ordinateur figure ci-dessus.

### F2 — MINOR — `mobile.computers.refusal.relay_stopped_title`
- Current: Le relais ne fonctionne pas sur {subject}.
- Problem: « ne fonctionne pas » reads as 'is broken/malfunctioning'; the cause is that the relay program is not running (stopped). « lancé » matches the remedy « Relancez le relais » and offline_next's « est lancé ».
- Suggested: Le relais n’est pas lancé sur {subject}.

### F3 — NIT — `mobile.computers.refusal.console_title`
- Current: {subject} requiert votre attention dans Radient.
- Problem: Acceptable and understood; « nécessite » is the more common product-French verb and « une intervention » makes explicit that the fix is an action taken in Radient rather than mere attention.
- Suggested: {subject} nécessite une intervention dans Radient.

### F4 — NIT — `mobile.computers.refusal.console_next`
- Current: Ouvrez la console Radient pour régler le problème. Se reconnecter sur ce téléphone n’y changera rien.
- Problem: English 'to fix it there' locates the fix in the console; « y » restores 'there' at no cost.
- Suggested: Ouvrez la console Radient pour y régler le problème. Se reconnecter sur ce téléphone n’y changera rien.

### F5 — NIT — `mobile.computers.refusal.certificate_next`
- Current: Utilisez l’adresse {scheme} affichée par le tunnel, choisissez un tunnel dont le certificat est reconnu par un téléphone, ou remplacez le certificat autosigné — cette app ne contournera pas la vérification.
- Problem: English 'replace a self-signed certificate' is indefinite; « le certificat autosigné » presupposes one exists. Existing verdict_tls uses « tout certificat autosigné ».
- Suggested: Utilisez l’adresse {scheme} affichée par le tunnel, choisissez un tunnel dont le certificat est reconnu par un téléphone, ou remplacez tout certificat autosigné — cette app ne contournera pas la vérification.

## Rulings requested

- **tunnel_gone_title**: ACCEPT. « ne correspond plus à aucun tunnel » renders the note's meaning (address no longer belongs to any tunnel); literal « n’est plus un tunnel » would be a calque. Terminal sense preserved by tunnel_gone_next.
- **retry_title**: ACCEPT. « disponible » is epicene, correct for {subject} as masculine ordinateur name or feminine adresse; « prêt/prête » would force gender. 'not ready yet' vs 'not yet available' is an acceptable shift for a temporary condition; « encore » keeps 'yet'.
- **console_title**: ACCEPT (NIT F3 optional). « requiert votre attention dans Radient » is grammatical, keeps Radient untranslated, vous register.
- **sign_in_title**: ACCEPT. « Reconnectez-vous pour accéder à {subject} » avoids « Reconnectez-vous pour vous reconnecter »; expired session makes re-sign-in natural; consistent with mobile.home.folders_read_sign_in « vous reconnecter » and sign_in_again « Se reconnecter ».
- **button_widths**: PASS. refusal-surface.tsx renders all buttons in a vertical stack (<View className="gap-2 pt-1">), Button passes no labelLines, so numberOfLines is undefined: labels WRAP (min-h-11 grows), never clip/ellipsize. Measured SF semibold 15 pt (token 'label'): « Ouvrir la console Radient » 178.7 pt (English 183.4), « Utiliser une autre adresse » 182.9 pt; budget ≈ 320 − 2×16 screen − 2×16 button padding = 256 pt. Both fit one line at default size.
- **wait_seconds_many**: PASS. fr CLDR categories one,many,other all present; many → « # de secondes » (1000000 de secondes) is correct French and matches own_tunnel.verdict_timeout; 0 and 1 → one (« 0 seconde ») correct.

## Other keys
All remaining keys accurate, idiomatic, vous register, consistent with the existing fr catalogue (password_title/host_next/password_next reuse own_tunnel.verdict_*; sign_in_next keeps the strict « mis en quarantaine et ne sera pas envoyé » promise; retry_next and wait_seconds promise no automatic retry).

Read route: ordinary git/scratchpad reads; read_public_copy not used (core route refuses mobile catalogue paths); context sidecars are nested JSON and not routable.
