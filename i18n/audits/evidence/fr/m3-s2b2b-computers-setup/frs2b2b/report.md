# fr audit — M3 S2b-2b (mobile.computers setup / route_invalid / your_computer)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 4 MINOR, 3 NIT. Auditor: i18n-auditor, anthropic/claude-opus-5-5 (no fallback), session 354214f74cea; translator job 3855e519638f.

Brief sha256 9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67 (matches); draft sha256 8166df188a62a69a94e540c68589a8095286c8e6d483cb1c817cb5948310729a (matches); redaction-marker hits in brief: 0.

## Mechanical
27/27 keys, none added/dropped; placeholders identical to English per messages.ts parseMessage; no plural/select in slice; no bidi controls; typography matches existing fr catalogue (U+2019, U+202F before ':' and inside « », ' — ', U+2026). route_invalid.credentials is plain text (code points checked), not masked.

## Findings
### FR-1 MINOR — `mobile.computers.setup.create_title`
- Current: En créer un sur l’ordinateur
- Problem: Elliptical 'un' has no visible antecedent: the screen title above is 'Nouvel ordinateur' (masculine), so the heading can read as 'create a computer on the computer'. The sibling attach_title already names the tunnel; make the pair parallel.
- Suggested: Créer un tunnel sur l’ordinateur

### FR-2 MINOR — `mobile.computers.setup.attach_help`
- Current: Si vous avez créé le tunnel dans la console Radient, associez-le à l’aide de l’identifiant qu’elle affiche. Cette commande sert à un tunnel qui existe déjà — elle n’en crée pas.
- Problem: 'sert à un tunnel' is unidiomatic: 'servir à' takes a purpose (verb/noun of use), not the object acted on; reads as 'is useful to a tunnel'. Meaning still recoverable.
- Suggested: Si vous avez créé le tunnel dans la console Radient, associez-le à l’aide de l’identifiant qu’elle affiche. Cette commande est réservée à un tunnel existant — elle n’en crée pas.

### FR-3 MINOR — `mobile.computers.setup.amount_note`
- Current: {amount} correspond au prix affiché dans la console Radient pour ce compte — {command} refuse toute autre valeur, et l’étape 1 du guide des tunnels renvoie à la page où il apparaît.
- Problem: Pronoun 'il' in 'la page où il apparaît' is ambiguous: prix, compte and guide are all masculine singular in the sentence.
- Suggested: {amount} correspond au prix affiché dans la console Radient pour ce compte — {command} refuse toute autre valeur, et l’étape 1 du guide des tunnels indique où trouver ce prix.

### FR-4 MINOR — `mobile.computers.your_computer`
- Current: Votre ordinateur
- Problem: Source-structural, not a translator error: as {subject} it lands mid-sentence in 'Le relais n’est pas lancé sur {subject}.' and 'Reconnectez-vous pour accéder à {subject}.' (current fr refusal titles), giving a capital 'Votre' mid-sentence, which French typography reads as an error. No single fr form fits both positions; most frames are sentence-initial, so the capitalised form is the right choice. Ruling: keep value; fix belongs in source (sentence-initial vs embedded variants, or capitalise-at-render).
- Suggested: (no change to fr value) Votre ordinateur

### FR-5 NIT — `mobile.computers.route_invalid.not_address`
- Current: Cela ne ressemble pas à une adresse. Elle doit commencer par {scheme}.
- Problem: 'Elle' points back to 'une adresse' inside a negated clause ('ne ressemble pas à une adresse'); naming the noun is cleaner.
- Suggested: Cela ne ressemble pas à une adresse. L’adresse doit commencer par {scheme}.

### FR-6 NIT — `mobile.computers.route_invalid.http_public`
- Current: {insecure} n’est autorisé que pour une adresse privée. Utilisez {scheme}, ou un hôte privé tel que {example}.
- Problem: Comma before a two-term 'ou' alternative is non-standard in French.
- Suggested: {insecure} n’est autorisé que pour une adresse privée. Utilisez {scheme} ou un hôte privé tel que {example}.

### FR-7 NIT — `mobile.computers.setup.intro`
- Current: Cette app pilote les sessions de votre propre ordinateur : celui-ci doit donc exécuter un connecteur et ne pas se mettre en veille. Votre code ne le quitte jamais.
- Problem: 'les sessions de votre propre ordinateur' is slightly flat; the sessions run on the computer.
- Suggested: Cette app pilote les sessions qui tournent sur votre propre ordinateur : celui-ci doit donc exécuter un connecteur et ne pas se mettre en veille. Votre code ne le quitte jamais.

## Rulings on translator term choices
- Associer (attach): accepted — distinct from 'connecter'/'connexion' used elsewhere, short for the label row; 'Rattacher' would also be acceptable, not required.
- identifiant (id): accepted; 'Identifiant du tunnel' (21 chars) is a full-width Input label, no overflow; 'ID du tunnel' not needed.
- paramètres de requête (query string): accepted — standard fr web term (alongside 'chaîne de requête'); 'fragment' accepted.
- renouvelée (re-mint): accepted — matches the context gloss 'issue a new session token'.
- détection des ordinateurs (discovery): accepted — matches context 're-reading the account's computers'.
- piloter (drive/control): accepted — matches existing fr usage.
- switch name « Autoriser le http:// en clair »: accepted — byte-identical to existing fr own_tunnel.insecure_allow.
- la TUI (feminine): accepted.
- C’est fait — connecter (ran_it): accepted; 22 chars, fits full-width 320 pt button.
- En attente du tunnel… (watching): accepted; ellipsis matches existing in-progress labels ('Connexion…').
- your_computer capitalisation: accepted with source-side MINOR FR-4.
- typography: matches existing fr catalogue: U+2019 apostrophes only, U+202F before ':' (5/5 prose colons) and inside « » , ' — ' em dash with plain spaces, U+2026 ellipsis.
