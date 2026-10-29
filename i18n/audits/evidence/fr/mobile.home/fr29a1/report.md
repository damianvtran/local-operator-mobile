# Independent French audit — mobile.home (fr29a1)

**Verdict: changes_requested — 5 MAJOR (H-01–H-05), 1 MINOR (H-06), 4 NIT (N-1–N-4); unresolved blocker/major count = 5.** All 27 English/context/French entries were read and judged.

**Auditor:** `i18n-auditor`, delegated session `cd6e19e68327`, no job id exposed for this delegation. The session model switched mid-request on provider quota (429) fallbacks: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` — `radient/auto` is the header in force when this bundle was written; the whole chain is recorded in `record.json`.

**Second independent pass:** worker job `07e08e5ac86c` (label `fr-second-pass`), role `reviewer`, pinned `anthropic/claude-opus-5-5`, **actual model `radient/auto`** after the same quota descent (disclosed by the worker itself). It read all 62 keys of both namespaces independently, without my findings. It independently confirmed the three tip overflows and found the un-keyed English screen label in H-04. Where its judgement differs, the disagreement is stated in the finding. It also claimed the suggestion chips truncate; my measurement does not support that, so chips are recorded as N-1, not a MAJOR — see N-1 for the reasoning.

**Translator:** `i18n-translator` session `c66311717837`, job `fbde6318e480`, actual served model `kimi/k3.1-pro` via temporary fallback, as supplied by the manager. Independence is agent/session/context, not model diversity (my run and part of the second pass both served `kimi/k3.1-pro`). No translation/MT service, no human native-speaker review and no rendered frame are claimed.

## Mechanical evidence (executed)

`audit.log` records the actual `npm run i18n:catalogue:check` (exit 0; `src/i18n/catalogue.gen.ts is current (116 keys, 7 namespaces)`) and the scoped per-key audit using the app's own `parseMessage`. That validator enforces key parity only, not placeholders, so the scoped audit checked every key itself:

- Valid JSON; 27/27/27 source/target/context keys; no missing or extra keys; every key has a context entry.
- Every message parses; no parameters, plurals or selects in this namespace (nothing to mismatch); no `%s` tokens, backticks, commands, flags or paths; `Linear MCP` byte-identical.
- No bidi controls; U+2019 apostrophes; no ASCII `'`.
- Typography: one site where `fr.md` requires U+202F before `?` has U+0020 (H-06).
- Fit: the sidecar carries no `maxCells`/`maxChars`; the only width numbers are the source-locale hints in the context notes and the code constants `SUGGESTION_CHAR_BUDGET = 24`, `TIP_CHAR_BUDGET = 48` (`home-copy.ts`), asserted in tests against the **English** pool only. Measured with UTF-16 `.length`, the same metric the code uses.

## Findings

### H-01 — MAJOR — `mobile.home.tip.parallel` (fit, executed measurement)
Current: `demandez un travail en parallèle pour répartir les sous-agents` — 62 characters against a 48-character one-line budget, and the wording says to spread the *subagents* rather than the work.
`home-splash.tsx` renders the tip with `numberOfLines={largeText ? 2 : 1}` (one line at 100 %) inside a content-sized row; at ~6 px per glyph a 62-character entry needs ≈372 dp against a 288 dp column, so it truncates.
Suggested: `demandez plusieurs sous-agents en parallèle` — 43 characters, keeps "ask for parallel work with subagents".

### H-02 — MAJOR — `mobile.home.tip.schedule` (fit, executed measurement)
Current: `planifiez un prompt pour l’exécuter à intervalles réguliers` — 59 characters, truncates by the same arithmetic.
Suggested: `planifiez un prompt à exécuter régulièrement` — 44 characters, keeps `prompt` as the product's word and the regular-execution idea.

### H-03 — MAJOR — `mobile.home.tip.search` (fit, executed measurement)
Current: `recherchez dans les conversations passées pour rouvrir une session` — 66 characters, the worst of the three.
Suggested: `retrouvez une session passée pour la rouvrir` — 44 characters, keeps both the search and the reopen consequence.

### H-04 — MAJOR — `mobile.home.options.fixed` (reference to an English-only label; "live" mistranslated)
Current: `Les options initiales de cette conversation sont fixes. Utilisez Détails de la conversation pour accéder à ses commandes en cours.`
Two defects, both verified in code:

1. The context note says **"Conversation details" names another screen: keep it matching that screen's title.** That title is an **un-keyed English literal** — `startup-transcript.tsx:49-53` renders `"Conversation details"` (the neighbouring branch is keyed; this one is not). A French reader is told to look for a label the app shows in English.
2. `commandes en cours` reads "commands in progress"; the English is *live controls* — the controls that act on the running conversation. `en direct` is the ordinary French rendering.

Suggested (source fix preferred): key the label at `startup-transcript.tsx:52` and give it a French title (e.g. `Détails de la conversation`), then the French value becomes
`Les options initiales de cette conversation sont fixes. Utilisez Détails de la conversation pour accéder à ses commandes en direct.`
Catalogue-only stopgap if the label cannot be keyed in this PR: keep the English label verbatim in the French sentence (`Utilisez Conversation details…`) rather than pointing at a French title that does not exist on screen.

### H-05 — MAJOR — the suggestion pool mixes two registers (4 keys)
`mobile.home.suggestion.{phone_access, linear_mcp, review_repo, team_of_agents}` use the **infinitive** (`Activer…`, `Configurer…`, `Examiner…`, `Créer…`) while `last_turn` and `wake_summary` use the **second-person imperative** (`Montrez-moi…`, `Réveillez-moi…`). Verified interaction: `home-splash.tsx:273` calls `onPick(label)` and `home.tsx:494` wires `onPick={setDraft}` — a chip's tap **replaces the composer draft**, so the chip text is a message the user sends, not a button caption. English is uniformly imperative ("Set up…", "Turn on…", "Review…", "Create…", "Wake me…", "Show me…").

Suggested (one register, second person, all inside the row's width):
- `mobile.home.suggestion.phone_access`: `Activez l’accès mobile`
- `mobile.home.suggestion.linear_mcp`: `Configurez Linear MCP` (`Linear MCP` untouched)
- `mobile.home.suggestion.review_repo`: `Examinez ce repo` (`repo` kept)
- `mobile.home.suggestion.team_of_agents`: `Créez une équipe d’agents`

If the wave prefers button-style infinitives for the whole pool instead, then `last_turn`/`wake_summary` must change too (`Afficher…`, `Activer un réveil…`) — but that loses "Wake **me** with a summary", which is the only chip that speaks as the user.

### H-06 — MINOR — `mobile.home.greeting` (French narrow space)
Current: `Comment puis-je vous aider aujourd’hui ?` — U+0020 before `?`; `fr.md` requires U+202F. Executed codepoint check is in `audit.log`.
Suggested: `Comment puis-je vous aider aujourd’hui\u202f?` (same words, U+202F before the question mark).

## NIT (max 5 respected)

- **N-1** `suggestion.last_turn` 27, `team_of_agents` 25, `wake_summary` 28 characters exceed the **source-locale** 24-character hint (the notes say "at most 24 characters at the source locale"). They are **not** recorded as overflow: at 14 px (`text-body-sm`) in a full-width 320 pt row (≈288 dp of content) a 28-character line needs ≈196 dp and does not truncate; the test that enforces 24 runs against the English pool only. The second pass read this as a truncating MINOR; that claim was not measured and the estimate contradicts it, so it stays a NIT and no wording change is required. It becomes a real fit defect only if a measured 320 pt capture shows clipping — which this audit did not produce.
- **N-2** `suggestion.last_turn` `dernier tour`, and `mobile.schedules.parked.wakes` `prochain tour`, render "turn" as `tour`, which also reads as a game/lap turn. Self-consistent across the two namespaces, and cheaper than `échange`; worth a recorded locale call in the `fr` guide rather than a silent choice. If the vocabulary changes, `Voir le dernier échange` (23) fits.
- **N-3** `startup_queue.not_started` `Non démarrée` is an unanchored feminine participle (the noun, *conversation*, is not on the row). Correct as written; flagged so nobody "fixes" it to `Non démarré`.
- **N-4** `suggestion.phone_access` `accès mobile` is a second word for the phone next to `mobile.computers`'s `téléphone` (`Aucun ordinateur sur ce téléphone`). `accès mobile` is good French product copy and fits; if the wave unifies the device word, `Activez l’accès téléphone` (25) also fits the row by the same estimate.

## Every-key disposition

The `MECHANICAL` rows in `audit.log` cover all 27 keys; this is the independent language pass.

| # | Key | Disposition |
|---|---|---|
| 1 | `connect_disabled_reason` | PASS — one short cause/action sentence, no connection implied |
| 2 | `folders_read_failed` | PASS — failed read named, no error code, no blame |
| 3 | `greeting` | **H-06** typography; wording and register correct |
| 4 | `options.apply` | PASS — button infinitive, no final stop |
| 5 | `options.fixed` | **H-04** |
| 6 | `options.folder` | PASS — folder located on the computer, not the phone |
| 7 | `options.title` | PASS — idiomatic heading |
| 8 | `queue.discard` | PASS — clearly deletes the unsent queue; distinct from restore |
| 9 | `queue.restore` | PASS — moves to draft, does not send |
| 10 | `queue.sheet_title` | PASS — plural noun phrase matching the view button |
| 11 | `queue.view` | PASS — opens the same set |
| 12 | `refused_start_fallback` | PASS — names the missing folder, neutral |
| 13 | `starting` | PASS — one line, ellipsis kept |
| 14 | `startup_queue.blocked` | PASS — retry instruction, no false progress |
| 15 | `startup_queue.not_started` | PASS (N-3) |
| 16 | `startup_queue.sending` | PASS — ongoing, no count |
| 17 | `startup_queue.unconfirmed` | PASS — no waiting/retry implied |
| 18 | `suggestion.last_turn` | PASS wording (N-1, N-2); `Montrez-moi` is the right register |
| 19 | `suggestion.linear_mcp` | **H-05** register; product/protocol token exact |
| 20 | `suggestion.phone_access` | **H-05**; terminology note N-4 |
| 21 | `suggestion.review_repo` | **H-05**; `repo` kept |
| 22 | `suggestion.team_of_agents` | **H-05**; the pool's only agent-creating chip stays |
| 23 | `suggestion.wake_summary` | PASS wording (N-1); wake-as-notification reads correctly |
| 24 | `tip.parallel` | **H-01** |
| 25 | `tip.schedule` | **H-02** |
| 26 | `tip.search` | **H-03** |
| 27 | `transcript.waiting` | PASS — pending conversation, ellipsis kept |

## Recording boundary

This mobile repository has no `i18n/ledger.json` and no audit-ledger command; `docs/i18n.md` records the report in the pull request, and this bundle is the durable artifact (`record.json`, `report.md`, `audit.log`). No ledger row or keyed receipt is claimed. No frame was captured: fit findings rest on executed character counts plus documented row geometry (`numberOfLines`, column width), never on pixels.
