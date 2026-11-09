# Audit report — mobile.session (fr)

- **Audit ID:** fr29b5
- **Date:** 2026-10-29
- **Auditor:** i18n-auditor (lopdev team); session `e4ac0d5aa232`; actual model `kimi/k3.1-pro`; fallback: temporary from anthropic/claude-sonnet-5-5 (provider quota HTTP 429)
- **Translator:** i18n-translator; session `c66311717837`; job `fbde6318e480`; model `kimi/k3.1-pro` (temporary fallback)
- **Verdict:** passed
- **Keys:** 1 en / 1 fr
- **Unresolved blocker/major:** 0

## Mechanical checks

- JSON valid: yes
- Key parity (en ↔ fr): yes (1 = 1)
- Key parity (en ↔ context): yes (1 = 1)
- Placeholder parity: all placeholders identical between en and fr
- ICU plural categories: French CLDR (one/many/other) present where applicable
- Bidi control characters: none
- Repository validator (`npm run -s i18n:catalogue:check`): passed

## Per-key review

### `status_tray.hint` (help)

- **EN:** Opens the working line, tasks and subagents
- **FR:** Ouvre la ligne d’activité, les tâches et les sous-agents
- **Context:** Accessibility hint read after the status tray's label. Describes what activating the tray opens; no final full stop. "Subagents" is a product term.
- **Verdict:** clean

## Notes

- No native speaker review was performed; this audit is by an LLM auditor.
- No rendered-proof or design sign-off claim is made.
- The translator used the same model family (kimi/k3.1-pro) as this auditor's fallback; independence is agent/context, not model diversity.
