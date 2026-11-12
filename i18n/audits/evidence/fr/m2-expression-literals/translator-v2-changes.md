# French M2 remediation — round 1

Translator: i18n-translator; session 1870b7ad26db; actual served model openai/gpt-6.1-sol (session model header); no fallback or MT used. Lane: bounded fix (<2 h), scratch candidate only; no catalogue edits, commits or self-audit.

## Findings answered

Counts: **8 fixed, 5 declined** across the two reports (13 report entries, including duplicate findings). “Fixed” means changed in the candidate, not a committed or independently audited result.

| Finding | Decision | Evidence / reasoning |
|---|---|---|
| A F1 | fixed | Narrow context uses `ctx`, preserving U+202F before `%`; both narrow values are genuinely smaller. Actual scalar/cell counts below supersede the audit's inaccurate estimate-length arithmetic. Call site `[id].tsx:978–984` explains the <340 pt wrapping constraint. |
| A F2 | fixed | `Ne répond pas`, exact verbatim mobile and core `relay.chrome.session.subtitle.not_answering`. |
| A F3 | fixed | `actif` replaces `en direct`; receiving transport is active, not a live broadcast. The exact-value shipped recount below supports the term, and it differs from `inactif`. |
| A F4 | fixed | `Pas encore de connexion` restores “yet” and differs from `Hors ligne` / `hors ligne`. `settings.tsx:717` selects this before a route exists. |
| A F5 | fixed | `la suite plus bas · défiler ↓` is an idiomatic noun phrase; dot/arrow preserved. |
| A F6 | declined (no change, as auditor recommends) | Keep `connexion`: shipped `mobile.computers.badge.connecting`; same Settings screen uses that badge at lines 406–409. Grammatical parallelism does not justify a different state name. |
| B F1 | fixed | Same narrow-form correction as A F1. |
| B F2 | fixed | Same verbatim relay correction as A F2. |
| B F3 | fixed | Same “yet” correction as A F4. |
| B F4 | declined | The source note defines the second sentence as explaining that a listed route does not prove the computer is running. `Un acheminement configuré ne garantit pas que l’ordinateur fonctionne.` says precisely that; `configuré` describes the provisioned route and `fonctionne` describes an operational computer. The indicative after negated `garantir` is grammatical when stating lack of a guarantee; subjunctive is possible, not obligatory. Auditor A explicitly accepted this sentence. No unsupported claim of stronger runtime readiness is introduced. |
| B N1 | declined as a change to the bare-title key; split requested | Correct observation about a FUTURE combined phrase, not a defect in standalone `session`. The new `back_to` context now makes this an integration issue: `Retour à session` is not natural. Preserve the source-required bare title and request a navigation-only fallback `la session`, or a full fallback navigation key `Retour à la session`. See integration requirement below. |
| B N2 | declined proposed omission; alternate fix applied via A F5 | Dropping `suite` loses the explicit “more/the rest” noun; choose the idiomatic `la suite plus bas` instead. This row is counted declined, not an additional fixed finding. |
| B N3 | declined (no change) | Keep shipped `connexion` rather than inventing `en connexion`; same reasoning as A F6. |

## Binding decisions and new keys

- Diagnostics `stream_degraded` is now **`Ne répond pas`** too. English context says “stream is open but not answering”; `settings.tsx:727–728` maps `health=degraded` to `Not answering`. No evidence for a distinct state, so verbatim relay wording wins over lower-case/one-word hints. No stream-state collisions: `inactif`, `connexion`, `actif`, `Ne répond pas`, `hors ligne`.
- `Vidéo` retained: shipped `mobile.session.highlights.video_open` is `Lire la vidéo {name}`. The noun and French accent agree.
- New inline labels: `activité`, `agents`, `tâches`, `statut`. Shipped references: `mobile.session.status_tray.hint` (“ligne d’activité, les tâches et les sous-agents”), `mobile.session.sheet_title.status` (“Tâches et agents”), relay tray `Agents {running}/{total}` / `Tâches {done}/{total}`, and `mobile.projects.create.status` (“Statut”). In `{labels} plus bas · défiler ↓`, lower-case noun lists need no added article.
- `Connecté à Orion.` and `Connecté à votre ordinateur.` both read naturally; computer fallback unchanged.
- **SPLIT KEY REQUEST — session back navigation**: `Retour à Orion` works, `Retour à session` does not. `session` must remain a bare header noun per its English context; changing the shared fallback to `la session` produces a definite noun phrase in a title whose contract asks for a bare noun. Add a navigation-specific fallback `la session` (or an entire no-name label `Retour à la session`). The 32-key candidate cannot alone resolve this call-site distinction without violating one context. Do not treat the unsplit fallback composition as approved to ship. The real-name `back_to` value is translated and mechanically valid; the manager must wire the separate fallback before integration. No distinct computer-name fallback split is necessary.

## Measured widths

Cells calculated in Python from Unicode East Asian width (W/F=2, combining=0, otherwise=1); U+202F counts one. These strings contain no CJK or combining marks. No pixel/layout claim is made.

- `context`: `21 % du contexte` = 16 cells at percent=21 (17 at 100).
- `context_short`: `21 % ctx` = 8 cells at percent=21 (9 at 100).
- `context_estimate`: `21 % du contexte (estim.)` = 25 cells at percent=21 (26 at 100).
- `context_short_estimate`: `21 % ctx (estim.)` = 17 cells at percent=21 (18 at 100).

`ctx` is a conventional context abbreviation in developer-facing meta labels. No width exception needed. Glossary proposal: narrow context-window label **ctx** (French developer meta register only); wide term remains **contexte**.

## Recount of shipped references (this session)

Read-only JSON scan of the specified mobile worktree and core `local_operator/i18n/catalogues/fr`; exact-value, case-insensitive matches, not substring totals. Candidate files were excluded by location, and no catalogue files were changed.

- mobile, exact value (case-insensitive) `inactif`: 0.
- mobile, exact value (case-insensitive) `actif`: 2. mobile.computers.json:mobile.computers.badge.active=actif; mobile.projects.json:mobile.projects.status.active=actif
- mobile, exact value (case-insensitive) `connexion`: 2. mobile.computers.json:mobile.computers.badge.connecting=connexion; mobile.settings.json:mobile.settings.section.connection=Connexion
- mobile, exact value (case-insensitive) `en direct`: 0.
- mobile, exact value (case-insensitive) `dégradé`: 0.
- mobile, exact value (case-insensitive) `Ne répond pas`: 1. relay.chrome.json:relay.chrome.session.subtitle.not_answering=Ne répond pas
- mobile, exact value (case-insensitive) `Vidéo`: 0.
- core, exact value (case-insensitive) `inactif`: 0.
- core, exact value (case-insensitive) `actif`: 0.
- core, exact value (case-insensitive) `connexion`: 0.
- core, exact value (case-insensitive) `en direct`: 0.
- core, exact value (case-insensitive) `dégradé`: 0.
- core, exact value (case-insensitive) `Ne répond pas`: 1. relay.chrome.json:relay.chrome.session.subtitle.not_answering=Ne répond pas
- core, exact value (case-insensitive) `Vidéo`: 0.

## Validation actually executed

- Python candidate validation: **PASS**, 32 keys, exact English order, ICU placeholder names and multiplicities equal per key; no plural/select structures in source or target; no empty/padded values; NFC throughout. Arrows, middle dots and `%` preserved. English-identical only `session` (French cognate), `Local Operator` (product name), `agents` (French plural cognate).
- Existing catalogue validator: `cd ~/local-operator-mobile/.worktrees/i18n-app-scan && node scripts/i18n/generate.ts --check` → exit **0**, `src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`. Node emitted MODULE_TYPELESS_PACKAGE_JSON warning for messages.ts. This checks existing integrated catalogues, NOT this scratch candidate. Candidate-specific proof is the Python check above. No generated files were modified.
- No independent audit, rendered proof, ledger-passed claim or full strings-ratchet claim is made here. The 32-key v2 requires independent re-audit, and the split-key integration issue remains explicit.
