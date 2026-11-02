# Audit report — mobile.notifications (fr)

- **Audit ID:** fr29b3
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

### `answer` (button)

- **EN:** Answer
- **FR:** Répondre
- **Context:** Button on an ask in the inbox list that opens it to be answered. One word, imperative.
- **Verdict:** clean

### `back` (button)

- **EN:** Back
- **FR:** Retour
- **Context:** Accessibility label of the icon-only back button in the inbox header.
- **Verdict:** clean

### `detail.answer_in_conversation` (button)

- **EN:** Answer in conversation
- **FR:** Répondre dans la conversation
- **Context:** Primary button on an ask's detail view that opens the conversation where the ask can be answered. Sentence case, no final full stop.
- **Verdict:** clean

### `detail.conversation_asks` (heading)

- **EN:** This conversation's asks
- **FR:** Questions de cette conversation
- **Context:** Section header listing the asks raised in the notification's conversation. "Ask" is the product word for a question the agent puts to the reader.
- **Verdict:** clean

### `detail.earlier_updates` (heading)

- **EN:** Earlier updates
- **FR:** Mises à jour précédentes
- **Context:** Section header listing earlier revisions of the same notification.
- **Verdict:** clean

### `detail.from` (heading)

- **EN:** From
- **FR:** Depuis
- **Context:** Section header naming the conversation a notification came from. One word.
- **Verdict:** clean

### `detail.no_asks` (status)

- **EN:** No asks in this conversation.
- **FR:** Aucune question dans cette conversation.
- **Context:** Empty state under the asks header. Ends with a full stop.
- **Verdict:** clean

### `detail.nothing_to_dismiss` (status)

- **EN:** No updates from this conversation to dismiss.
- **FR:** Aucune mise à jour de cette conversation à ignorer.
- **Context:** Empty state of the dismiss dialog when the conversation has no dismissable updates. Ends with a full stop.
- **Verdict:** clean

### `detail.projects` (heading)

- **EN:** Projects
- **FR:** Projets
- **Context:** Section header listing the projects a notification relates to.
- **Verdict:** clean

### `dismiss` (button)

- **EN:** Dismiss
- **FR:** Ignorer
- **Context:** Accessibility label of the icon-only button that clears a notification from the inbox. Imperative.
- **Verdict:** clean

### `filter_label` (meta)

- **EN:** Show
- **FR:** Afficher
- **Context:** Accessible label of the segmented control that chooses which notifications are listed (unread or all). One word; a verb used as a label.
- **Verdict:** clean

### `load_failed` (heading)

- **EN:** Couldn't load notifications
- **FR:** Impossible de charger les notifications
- **Context:** Title of the error alert when the inbox could not be loaded. The relay's own sentence follows as the alert body.
- **Verdict:** clean

### `priority_high` (status)

- **EN:** High
- **FR:** Élevée
- **Context:** Badge on a notification the sender marked high priority. One word.
- **Verdict:** clean

### `title` (heading)

- **EN:** Notifications
- **FR:** Notifications
- **Context:** Title of the notifications inbox screen.
- **Verdict:** clean

## Notes

- No native speaker review was performed; this audit is by an LLM auditor.
- No rendered-proof or design sign-off claim is made.
- The translator used the same model family (kimi/k3.1-pro) as this auditor's fallback; independence is agent/context, not model diversity.
