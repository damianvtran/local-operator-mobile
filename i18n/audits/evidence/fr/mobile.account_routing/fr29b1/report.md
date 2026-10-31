# Audit report — mobile.account_routing (fr)

- **Audit ID:** fr29b1
- **Date:** 2026-10-29
- **Auditor:** i18n-auditor (lopdev team); session `e4ac0d5aa232`; actual model `kimi/k3.1-pro`; fallback: temporary from anthropic/claude-sonnet-5-5 (provider quota HTTP 429)
- **Translator:** i18n-translator; session `c66311717837`; job `fbde6318e480`; model `kimi/k3.1-pro` (temporary fallback)
- **Verdict:** passed
- **Keys:** 14 en / 14 fr
- **Unresolved blocker/major:** 0

## Mechanical checks

- JSON valid: yes
- Key parity (en ↔ fr): yes (14 = 14)
- Key parity (en ↔ context): yes (14 = 14)
- Placeholder parity: all placeholders identical between en and fr
- ICU plural categories: French CLDR (one/many/other) present where applicable
- Bidi control characters: none
- Repository validator (`npm run -s i18n:catalogue:check`): passed

## Per-key review

### `disconnected` (status)

- **EN:** Connect to a computer to change account routing.
- **FR:** Connectez un ordinateur pour modifier l’acheminement du compte.
- **Context:** No usable selected-route client; do not call the relay outdated or claim an empty policy.
- **Verdict:** clean

### `error` (status)

- **EN:** The change could not be confirmed. Check the connection and reload to read the current policy.
- **FR:** Impossible de confirmer la modification. Vérifiez la connexion et rechargez la politique en vigueur.
- **Context:** Unknown save outcome or mismatched confirmation; do not assert not-saved or success.
- **Verdict:** clean

### `load_error` (status)

- **EN:** Could not load account routing. Check the connection and try again.
- **FR:** Impossible de charger l’acheminement du compte. Vérifiez la connexion et réessayez.
- **Context:** Read failed for another reason, distinct from a confirmed old relay.
- **Verdict:** clean

### `loading` (status)

- **EN:** Loading account routing…
- **FR:** Chargement de l’acheminement du compte…
- **Context:** Read in flight; no policy choice is asserted before the backend answers.
- **Verdict:** clean

### `rejected` (status)

- **EN:** The change was not saved. Check the value or this computer’s settings and try again.
- **FR:** La modification n’a pas été enregistrée. Vérifiez la valeur ou les paramètres de cet ordinateur, puis réessayez.
- **Context:** Definitive backend refusal; preserve any backend error text separately, not as a descriptor.
- **Verdict:** clean

### `reload` (button)

- **EN:** Reload policy
- **FR:** Recharger la politique
- **Context:** After an uncertain or rejected save: GET the computer's committed policy and replace the draft; never repeat the write blindly.
- **Verdict:** clean

### `retry` (button)

- **EN:** Try again
- **FR:** Réessayer
- **Context:** Retry a failed read; not a blind automatic retry of an uncertain save.
- **Verdict:** clean

### `save` (button)

- **EN:** Save policy
- **FR:** Enregistrer la politique
- **Context:** Explicitly saves this temporary draft to the selected computer only.
- **Verdict:** clean

### `saved` (status)

- **EN:** Saved on this computer.
- **FR:** Enregistré sur cet ordinateur.
- **Context:** Only after a validated response confirms the requested value on the same route.
- **Verdict:** clean

### `saving` (button)

- **EN:** Saving…
- **FR:** Enregistrement…
- **Context:** Write pending; never a saved confirmation.
- **Verdict:** clean

### `scope` (help)

- **EN:** Changes apply only to this computer.
- **FR:** Les modifications s’appliquent uniquement à cet ordinateur.
- **Context:** Scope note below the selected computer; never imply a phone-global routing policy.
- **Verdict:** clean

### `title` (heading)

- **EN:** Account routing
- **FR:** Acheminement du compte
- **Context:** Section heading in computer settings; not a provider/model picker.
- **Verdict:** clean

### `unavailable` (status)

- **EN:** Account routing settings are unavailable on this relay. Update Local Operator on this computer.
- **FR:** Les paramètres d’acheminement du compte ne sont pas disponibles sur ce relais. Mettez à jour Local Operator sur cet ordinateur.
- **Context:** Confirmed missing relay route only; never use for an offline/unknown tunnel.
- **Verdict:** clean

### `unsaved` (status)

- **EN:** Not saved yet.
- **FR:** Pas encore enregistré.
- **Context:** A selected draft differs from the backend value; changing radio alone does not persist.
- **Verdict:** clean

## Notes

- No native speaker review was performed; this audit is by an LLM auditor.
- No rendered-proof or design sign-off claim is made.
- The translator used the same model family (kimi/k3.1-pro) as this auditor's fallback; independence is agent/context, not model diversity.
