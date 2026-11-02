# Audit report — mobile.projects (fr)

- **Audit ID:** fr29b4
- **Date:** 2026-10-29
- **Auditor:** i18n-auditor (lopdev team); session `e4ac0d5aa232`; actual model `kimi/k3.1-pro`; fallback: temporary from anthropic/claude-sonnet-5-5 (provider quota HTTP 429)
- **Translator:** i18n-translator; session `c66311717837`; job `fbde6318e480`; model `kimi/k3.1-pro` (temporary fallback)
- **Verdict:** passed
- **Keys:** 15 en / 15 fr
- **Unresolved blocker/major:** 0

## Mechanical checks

- JSON valid: yes
- Key parity (en ↔ fr): yes (15 = 15)
- Key parity (en ↔ context): yes (15 = 15)
- Placeholder parity: all placeholders identical between en and fr
- ICU plural categories: French CLDR (one/many/other) present where applicable
- Bidi control characters: none
- Repository validator (`npm run -s i18n:catalogue:check`): passed

## Per-key review

### `delete_body` (confirm)

- **EN:** Delete {name}? The project row goes for good. Its linked sessions and their transcripts are not touched.
- **FR:** Supprimer {name} ? La ligne du projet sera définitivement supprimée. Ses sessions liées et leurs transcriptions ne seront pas modifiées.
- **Context:** Destructive confirmation. Placeholder {name} is the project's display name (user text, may contain spaces). Both halves are load-bearing: what the delete destroys and what it leaves alone.
- **Finding FR-PROJ-1 (minor):** Regular space U+0020 before '?' where fr.md requires U+202F
  - **Suggested:** Supprimer {name} ? La ligne du projet sera définitivement supprimée. Ses sessions liées et leurs transcriptions ne seront pas modifiées.

### `draft_kept_note` (help)

- **EN:** Kept from your last visit. Clear the fields to start something new.
- **FR:** Conservé depuis votre dernière visite. Effacez les champs pour repartir de zéro.
- **Context:** Tells the reader a dismissed form kept their unfinished work and how to discard it. Applies to both the create sheet and the milestone editor.
- **Verdict:** clean

### `milestone_slash_note` (help)

- **EN:** Milestone names can't contain a slash. A milestone with one could never be removed.
- **FR:** Les noms de jalons ne peuvent pas contenir de barre oblique. Un jalon dont le nom en contient une ne pourrait jamais être supprimé.
- **Context:** Explains why a milestone name may not contain a slash. Names the consequence the reader can act on; never mention routes, paths or encoding.
- **Verdict:** clean

### `milestones.count` (meta)

- **EN:** {completed} of {total} milestones
- **FR:** {completed} jalons sur {total}
- **Context:** Milestone progress from the relay's own two counts. {completed} and {total} are non-negative integers; no plural agreement is needed because the noun is fixed to the count phrase.
- **Verdict:** clean

### `milestones.none` (meta)

- **EN:** no milestones
- **FR:** aucun jalon
- **Context:** Lower-case fragment shown where a milestone count would go when the relay reports zero total milestones. It is joined with a session count, so it carries no final full stop.
- **Verdict:** clean

### `project_name_hint` (help)

- **EN:** 1-64 characters: letters, digits, dot, underscore or hyphen. No spaces, and it can't start with a hyphen.
- **FR:** 1 à 64 caractères : lettres, chiffres, point, tiret bas ou tiret. Aucun espace, et le nom ne peut pas commencer par un tiret.
- **Context:** The complete project-name grammar stated before the tap. Length range and allowed characters must stay exact: this sentence is the reader's only warning before a refusal.
- **Finding FR-PROJ-2 (minor):** Regular space U+0020 before ':' where fr.md requires U+202F
  - **Suggested:** 1 à 64 caractères : lettres, chiffres, point, tiret bas ou tiret. Aucun espace, et le nom ne peut pas commencer par un tiret.

### `remove_milestone_body` (confirm)

- **EN:** Remove {name} from this project? The milestone goes for good. The project's sessions and its progress line are not touched.
- **FR:** Retirer {name} de ce projet ? Le jalon sera définitivement supprimé. Les sessions du projet et sa ligne de progression ne seront pas modifiées.
- **Context:** Destructive confirmation. Placeholder {name} is the milestone name (user text, may contain spaces). Says what goes and what stays.
- **Finding FR-PROJ-3 (minor):** Regular space U+0020 before '?' where fr.md requires U+202F
  - **Suggested:** Retirer {name} de ce projet ? Le jalon sera définitivement supprimé. Les sessions du projet et sa ligne de progression ne seront pas modifiées.

### `session_state.filed_by` (status)

- **EN:** filed by
- **FR:** classé par
- **Context:** Lower-case two-word fragment marking a coordination row: the session filed the work rather than doing it. Never imply the row is a worker.
- **Verdict:** clean

### `session_state.missing` (status)

- **EN:** missing
- **FR:** manquant
- **Context:** Lower-case word for a linked session whose directory is gone. The link is still listed; this names its state.
- **Verdict:** clean

### `session_state.not_running` (status)

- **EN:** not running
- **FR:** arrêtée
- **Context:** Lower-case replacement for the relay's 'stopped' runtime state. The ordinary end of a session, not an error.
- **Verdict:** clean

### `sessions.count` (meta)

- **EN:** {count, plural, one {# session} other {# sessions}}
- **FR:** {count, plural, one {# session} many {# de sessions} other {# sessions}}
- **Context:** Session count. {count} is a non-negative integer and drives the plural category; # is that number. The zero case is 'other' in English.
- **Verdict:** clean

### `sessions.live` (meta)

- **EN:** {base} · {live} live
- **FR:** {base} · {live} en cours
- **Context:** Appends the live-session count to a session-count phrase. {base} is the already-rendered count phrase; {live} is a positive integer. Shown only when at least one session is live.
- **Verdict:** clean

### `stale_badge` (status)

- **EN:** progress stale
- **FR:** progression obsolète
- **Context:** One badge word pair naming WHAT is stale (progress) rather than the project. Lower case; it sits beside a project name.
- **Verdict:** clean

### `write_receipt` (status)

- **EN:** {action} {subject}.
- **FR:** {action} {subject}.
- **Context:** One-line success receipt. {action} is a past-tense verb supplied by the screen (Created, Renamed, Deleted…); {subject} is the thing acted on. Ends with a full stop.
- **Verdict:** clean

### `write_unknown_note` (status)

- **EN:** We couldn't reach your computer, so we can't tell whether that was saved. Check the project before trying again.
- **FR:** Impossible de joindre votre ordinateur : nous ne savons pas si la modification a été enregistrée. Vérifiez le projet avant de réessayer.
- **Context:** Shown when a write got no answer. Must state that the outcome is UNKNOWN, never that nothing was saved.
- **Finding FR-PROJ-4 (minor):** Regular space U+0020 before ':' where fr.md requires U+202F
  - **Suggested:** Impossible de joindre votre ordinateur : nous ne savons pas si la modification a été enregistrée. Vérifiez le projet avant de réessayer.

## Findings summary

| ID | Severity | Key | Problem |
|---|---|---|---|
| FR-PROJ-1 | minor | `mobile.projects.delete_body` | Regular space U+0020 before '?' where fr.md requires U+202F |
| FR-PROJ-2 | minor | `mobile.projects.project_name_hint` | Regular space U+0020 before ':' where fr.md requires U+202F |
| FR-PROJ-3 | minor | `mobile.projects.remove_milestone_body` | Regular space U+0020 before '?' where fr.md requires U+202F |
| FR-PROJ-4 | minor | `mobile.projects.write_unknown_note` | Regular space U+0020 before ':' where fr.md requires U+202F |

## Notes

- No native speaker review was performed; this audit is by an LLM auditor.
- No rendered-proof or design sign-off claim is made.
- The translator used the same model family (kimi/k3.1-pro) as this auditor's fallback; independence is agent/context, not model diversity.
