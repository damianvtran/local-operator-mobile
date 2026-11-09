# Audit report — mobile.computers (fr)

- **Audit ID:** fr29b2
- **Date:** 2026-10-29
- **Auditor:** i18n-auditor (lopdev team); session `e4ac0d5aa232`; actual model `kimi/k3.1-pro`; fallback: temporary from anthropic/claude-sonnet-5-5 (provider quota HTTP 429)
- **Translator:** i18n-translator; session `c66311717837`; job `fbde6318e480`; model `kimi/k3.1-pro` (temporary fallback)
- **Verdict:** passed
- **Keys:** 10 en / 10 fr
- **Unresolved blocker/major:** 0

## Mechanical checks

- JSON valid: yes
- Key parity (en ↔ fr): yes (10 = 10)
- Key parity (en ↔ context): yes (10 = 10)
- Placeholder parity: all placeholders identical between en and fr
- ICU plural categories: French CLDR (one/many/other) present where applicable
- Bidi control characters: none
- Repository validator (`npm run -s i18n:catalogue:check`): passed

## Per-key review

### `add` (button)

- **EN:** Add a computer
- **FR:** Ajouter un ordinateur
- **Context:** Button that starts setting up another computer. Sentence case, no final full stop.
- **Verdict:** clean

### `added.stays_listed` (help)

- **EN:** It stays listed on this phone, so you can switch back from the computer list.
- **FR:** Il reste dans la liste de ce téléphone : vous pouvez y revenir depuis la liste des ordinateurs.
- **Context:** Follows "Connected to <computer>." after a newly added computer comes online. Reassures that the previous computer is still listed.
- **Finding FR-COMP-1 (minor):** Regular space U+0020 before ':' where fr.md requires espace fine insécable U+202F
  - **Suggested:** Il reste dans la liste de ce téléphone : vous pouvez y revenir depuis la liste des ordinateurs.

### `badge.active` (status)

- **EN:** active
- **FR:** actif
- **Context:** Lower-case monospace badge on a Settings computer row that is the connected one. Keep it lower case and one word to match the sibling badge.
- **Verdict:** clean

### `badge.connecting` (status)

- **EN:** connecting
- **FR:** connexion
- **Context:** Lower-case monospace badge on a Settings computer row whose connection is being made. Keep it lower case and one word to match the sibling badge.
- **Verdict:** clean

### `connecting` (status)

- **EN:** Connecting…
- **FR:** Connexion…
- **Context:** Inline status beside a computer row while its connection is being made. Keep the ellipsis character; one word plus ellipsis.
- **Verdict:** clean

### `none_on_phone` (status)

- **EN:** No computers on this phone yet.
- **FR:** Aucun ordinateur sur ce téléphone pour le moment.
- **Context:** Empty state of the computer switcher when no computer has been paired on this phone. Ends with a full stop.
- **Verdict:** clean

### `password_placeholder` (help)

- **EN:** The password from lop mobile
- **FR:** Le mot de passe fourni par lop mobile
- **Context:** Placeholder of the password field. "lop mobile" is a command typed in a terminal: keep it verbatim in every language.
- **Verdict:** clean

### `section.not_connected` (heading)

- **EN:** On your Radient account, not connected
- **FR:** Sur votre compte Radient, non connectés
- **Context:** Section header for computers that belong to the reader's Radient account but are not paired on this phone. "Radient" is a product name: do not translate.
- **Verdict:** clean

### `section.on_phone` (heading)

- **EN:** On this phone
- **FR:** Sur ce téléphone
- **Context:** Section header for computers already paired on this phone.
- **Verdict:** clean

### `switch` (button)

- **EN:** Switch computer
- **FR:** Changer d’ordinateur
- **Context:** Button (and the title of the sheet it opens) that lets the reader pick a different computer. Sentence case, no final full stop.
- **Verdict:** clean

## Findings summary

| ID | Severity | Key | Problem |
|---|---|---|---|
| FR-COMP-1 | minor | `mobile.computers.added.stays_listed` | Regular space U+0020 before ':' where fr.md requires espace fine insécable U+202F |

## Notes

- No native speaker review was performed; this audit is by an LLM auditor.
- No rendered-proof or design sign-off claim is made.
- The translator used the same model family (kimi/k3.1-pro) as this auditor's fallback; independence is agent/context, not model diversity.
- `mobile.computers.password_placeholder` is credential-shaped; the clean-core sanctioned keyed route was exercised and REFUSED because the source file is not committed in core. No keyed receipt was obtained.
