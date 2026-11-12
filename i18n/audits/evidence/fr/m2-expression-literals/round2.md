# M2 round-2 delta audit — fr — v3 (33 keys)
Auditor: i18n-auditor (independent of translator openai/gpt-6.1-sol and of R1 A deepseek / B sonnet). Served model: anthropic/claude-sonnet-5-5.
Verdict: CLEAN-WITH-FINDINGS — 0 BLOCKER, 0 MAJOR, 1 MINOR, 0 NIT. Nothing edited.

## 1. Diff v1→v3 (python3)
Changed (7): status.no_connection, status.not_answering, diagnostics.stream_live, diagnostics.stream_degraded, tray.context_short, tray.context_short_estimate, region.more_below.
Added (6): region.label.{working,subagents,todos,strip}, back_to, back_to_session. fallback_name unchanged ("session"). Other 20 v1 keys byte-identical.

## 2. Round-1 adjudication (recounts: mobile fr catalogues @ i18n-app-scan b783c878, 649 keys; core fr)
- A-F1 / B-F1 (narrow ctx = wide form, MAJOR): FIXED. `{percent}\u202f% ctx` 8 cells / `… ctx (estim.)` 17 vs wide 16 / 25 (at 21). Genuinely narrower (-8). U+202F kept. "ctx" has 0 shipped fr occurrences, but it is the English source's own abbreviation and the context note permits "the language's own short form"; accepted.
- A-F2 / B-F2 (not_answering vs relay): FIXED. status.not_answering = "Ne répond pas" == core relay.chrome.session.subtitle.not_answering byte-for-byte (recount: 1 exact in mobile and in core; also "l'ordinateur ne répond pas" in mobile.session.subagent.unavailable_next).
- A-F3 (en direct→actif): FIXED. "en direct" 0 shipped; "actif" exact 2 (computers.badge.active, projects.status.active). Row now inactif/connexion/actif/Ne répond pas/hors ligne: all distinct.
- A-F4 / B-F3 (no_connection): FIXED. "Pas encore de connexion" restores "yet"; distinct from "Hors ligne" and "Non connecté" (not_connected = refused).
- A-F5 / B-N2 (more_below): FIXED via "la suite plus bas · défiler ↓". Noun phrase, dot/arrow kept; B's drop-"suite" alternative reasonably not taken.
- A-F6 / B-N3 (connexion noun): declined — UPHELD. Shipped mobile.computers.badge.connecting = "connexion" (recount: 2 exact: badge.connecting + section.connection "Connexion").
- B-F4 (host_answering "configuré … fonctionne"): declined — UPHELD. Meaning preserved (listed route ≠ running machine), polarity negative; indicative after negated "garantir" is acceptable French; "acheminement" matches shipped diagnostics.route (6 shipped uses). A had accepted it.
- B-N1 (fallback splice "Retour à session"): FIXED structurally via new back_to_session = "Retour à la session"; fallback_name stays a bare header noun per its context.
- Translator's binding choice stream_degraded = "Ne répond pas": semantics OK (settings.tsx maps health "degraded" → "Not answering"; context "open but not answering"). Casing issue: F1.
- Shipped video noun: "Vidéo" consistent with shipped "Lire la vidéo {name}" (no standalone "Vidéo" shipped; accent/noun agree). OK.
- Shipped connecting/idle/live words: connecting "connexion" shipped; idle "inactif" 0 shipped (natural counterpart of shipped "actif"); live→"actif" shipped.

## 3. New / changed values judged fresh
- region.label.working "activité" / subagents "agents" / todos "tâches" / strip "statut": lower-case nouns; "activité · agents · tâches plus bas · défiler ↓" and single "statut plus bas · défiler ↓" read naturally. Terms shipped ("ligne d'activité, les tâches et les sous-agents", "Tâches et agents", relay tray "Agents/Tâches", projects "Statut"). 6–8 cells each, no width risk. "agents" is English-identical but the normal French plural, shipped — not a defect.
- back_to "Retour à {name}": reads with a real name ("Retour à Orion"); shipped navigation frame "Retour à…/Retour aux sessions". Only inherent splice caveat (a name beginning "le/les" would want "au/aux") is unavoidable for any user-supplied name. With the unnamed fallback it must not be used: fallback goes through back_to_session.
- back_to_session "Retour à la session": correct, natural, 19 chars, sentence case, no stop.
- fallback_name "session": bare noun, ok as lowercase header title. Call sites (session/[id]/video.tsx:168, agent/[jobId].tsx:93) still hard-code English `Back to ${parentName}`; wiring is integration — must select back_to_session when unnamed, never splice fallback_name into back_to.
- connected_to + added.fallback_name: "Connecté à votre ordinateur." / "Connecté à Orion." both grammatical (unchanged).

## 4. Mechanical (python3 on fr.v3.json vs keys33.json)
33 keys, order identical, placeholder multiset per key == English ({percent},{labels},{host},{baseUrl},{name}), no empties/padding, all NFC, no ICU plural/select, U+202F before % kept, arrows/middle dots kept, apostrophes U+2019. English-identical: Local Operator (app_name), plus cognates session and agents. No bidi (n/a; fr). Repo validator/ledger not run (off-limits for this lane).

## 5. Pair / distinctness / safety
- status.not_answering == relay value verbatim.
- no_connection "Pas encore de connexion" vs offline "Hors ligne" vs not_connected "Non connecté": distinct. No terse label inverts or softens a state ("actif"/"Connecté" only for healthy states; "Ne répond pas" not softened).

## Findings
F1 — MINOR — mobile.settings.diagnostics.stream_degraded
Current: "Ne répond pas". Context: "Lower-case diagnostic word … monospace line"; every sibling in that row is lower-case (inactif, connexion, actif, hors ligne), so the capital N is visibly inconsistent. The verbatim relay match concerns wording, not case. Suggested: "ne répond pas". Not gating.
