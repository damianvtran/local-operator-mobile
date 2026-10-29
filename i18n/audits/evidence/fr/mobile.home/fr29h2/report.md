# Independent French audit, round 2 — mobile.home (fr29h2)

**Verdict: `changes_requested` — 1 MAJOR (H-01), 1 MINOR (H-02), 4 NIT (H-03–H-06); unresolved blocker/major count = 1.**
All 27 English / context / French entries were read and judged against the current bytes at head `79b3fad`.

This is a **round-2 re-audit of the current bytes**, not a re-statement of round 1: every key was judged again, and each fix round 1 asked for was checked against what the bytes now say. Round 1's bundle is `i18n/audits/evidence/fr/mobile.home/fr29a1`.

**Auditor:** `i18n-auditor`, delegated session `16ebcda69228`. **Actual model in force for this work: `radient/auto`**, after a provider-quota descent observed in this transcript — `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`. The chain is recorded in `record.json`.

**Translator:** `i18n-translator` session `c66311717837` (model `kimi/k3.1-pro` via fallback, as supplied by the requesting manager; not observed by this auditor). Independence is agent, session and context — not model diversity: my run and the translator's share `kimi/k3.1-pro` on part of the chain. Disclosed, not closed.

**Second independent pass:** one was run for this round, in parallel and without my findings: job `de9bf370df7e`, role `reviewer`, pinned `anthropic/claude-opus-5-5`, **actual model `radient/auto`** after the same quota descent (self-reported). It read all 65 keys of both namespaces plus the composing code, and returned **no BLOCKER and no MAJOR**, proposing 5 MINOR and 5 NIT. Where it and I differ, the disagreement is stated in the finding, with the evidence I checked. No human native-speaker review, and no rendered frame, is claimed anywhere in this bundle.

## Mechanical evidence (executed; full output in `audit.log`)

`npm run i18n:catalogue:check` → exit 0, `src/i18n/catalogue.gen.ts is current (120 keys, 7 namespaces, argument types from en, fr)`. That validator proves key parity and that every message parses; it does **not** compare placeholders across locales, so every key was checked here as well.

- Valid JSON, no duplicate keys; 27 en / 27 context / 27 fr keys; no missing, no extra, every key has a context entry.
- Every message parses with the app's own `parseMessage`. No key in this namespace carries a placeholder, a plural or a select — so there is no placeholder/plural surface to mismatch, and nothing to render at a count.
- Every French value was rendered through the **production path** (`renderFor(key, {}, "fr")` from `src/i18n/runtime.ts`, which is what `t()` calls): all 27 returned French, not English fallback.
- Character evidence per key: no ASCII apostrophe, no ASCII double quote, no ASCII `...`, no bidi control (U+061C/U+200E/U+200F/U+202A–U+202E/U+2066–U+2069), no U+00A0. Apostrophes are U+2019; ellipses are U+2026.
- Typography: the single `?` in the namespace (`greeting`) is preceded by **U+202F**; no `:`, `;` or `!` occurs in this namespace. Round 1's H-06 is fixed.
- Kept-English tokens: `Linear MCP` and `repo` are byte-identical to the source; `prompt` is kept in `tip.schedule`. `lop mobile`, `Local Operator` and `Radient` occur nowhere in this namespace, in either locale, so there is nothing to preserve.
- Width, measured in UTF-16 characters (the metric the code uses) against the per-locale budgets in `src/features/home/home-copy.ts` (`SUGGESTION_CHAR_BUDGET = { en: 24, fr: 31 }`, `TIP_CHAR_BUDGET = 48`): chips 22 / 25 / 23 / 21 / 16 / 24, all ≤ 31; tips 44 / 43 / 44, all ≤ 48. No string in this namespace is over budget.
- `npx vitest run src/features/home/home-copy.test.ts src/features/schedules/__tests__/schedules-copy.test.ts src/i18n/__tests__` → 7 files, **159 tests passed**, on these bytes.

## Round 1's findings, re-checked on the current bytes

| Round-1 id | What it asked for | Current bytes | Status |
|---|---|---|---|
| H-01 `tip.parallel` | ≤ 48 characters, keep the parallel-work idea | `demandez plusieurs sous-agents en parallèle` — 43 | **fixed** |
| H-02 `tip.schedule` | ≤ 48 characters, keep `prompt` | `planifiez un prompt à exécuter régulièrement` — 44 | **fixed** (see H-05 for a residual nuance, NIT) |
| H-03 `tip.search` | ≤ 48 characters, keep search + reopen | `retrouvez une session passée pour la rouvrir` — 44 | **fixed** |
| H-04 `options.fixed` | (1) the referenced screen label must exist in French; (2) `live controls` must not read as "commands in progress" | (1) the label is now a key, `mobile.session.conversation_details` = `Détails de la conversation`, rendered at `startup-transcript.tsx:52` — the reference now resolves byte-exactly; and `figées` replaced `fixes`. (2) `commandes en cours` is **unchanged** | **half fixed** — (1) verified fixed, (2) is this round's **H-01** |
| H-05 `suggestion.*` | one register across the pool (chips are sent, not captions) | all six chips are second-person imperatives: `Activez`, `Créez`, `Montrez`, `Configurez`, `Examinez`, `Réveillez-moi` | **fixed** |
| H-06 `greeting` | U+202F before `?` | `Comment puis-je vous aider aujourd’hui` + U+202F + `?` — confirmed by codepoint scan | **fixed** |
| N-1 chips over 24 | (NIT, not a defect) | superseded: the budget is now per-locale, French 31 | closed by design |
| N-2 `tour` for "turn" | (NIT) | unchanged | **H-03** |
| N-3 `Non démarrée` | (NIT: correct, do not "fix" to `Non démarré`) | unchanged, still correct | no action |
| N-4 `accès mobile` vs `téléphone` | (NIT) | unchanged | **H-04** |

## Findings

### H-01 — MAJOR — `mobile.home.options.fixed` (accuracy / idiom: "live controls" reads as "commands in progress")

Current: `Les options initiales de cette conversation sont figées. Utilisez Détails de la conversation pour accéder à ses commandes en cours.`
English: `This conversation's starting options are fixed. Use Conversation details for its live controls.`

`commandes en cours` is a settled French collocation for *commands/orders in progress* — it names a **state**, not a place to act — so the clause reads "…to reach its commands that are running" instead of "…to reach the controls that stay live while the conversation runs". A reader looking for the controls may conclude they are busy rather than find them on the details screen.

This is unchanged from round 1's H-04(2). The second pass downgraded it to MINOR on the argument that `en cours` is this catalogue's own rendering of "live". I checked that claim and it does not hold: the one other occurrence, `mobile.projects.sessions.live`, is `{base} · {live} en cours` with `{live}` **a positive integer** and the note "Appends the live-session count" — i.e. `3 en cours` = "3 running", where `en cours` is exactly "in progress". That key is evidence *for* the defect, not against it. The disagreement is recorded rather than smoothed over.

Suggested (132 characters, parses, no placeholder):
`Les options initiales de cette conversation sont figées. Utilisez Détails de la conversation pour accéder à ses commandes en direct.`

Alternatives, both verified: `…pour accéder aux commandes de la conversation en cours.` (148; keeps the house word but attaches `en cours` to the noun it can modify), or `…à ses contrôles en direct.` (132; `contrôles` is absent from the French catalogue today, so it would be a new term).

### H-02 — MINOR — `mobile.home.suggestion.wake_summary` ("with a summary" becomes a second, objectless imperative)

Current: `Réveillez-moi et résumez` (24 chars, within the 31-character budget).
English: `Wake me with a summary`.
The source names the summary as what the wake **brings**; the French coordinates a second imperative whose object is unstated ("summarize what?"). The meaning survives in context, but the source's structure is available inside the budget.
Suggested: `Réveillez-moi avec un résumé` (28 chars, parses, within the 31-character budget).
The second pass raised the same key as a MINOR with the same replacement — recorded as agreement, not as a second source.

### H-03 — NIT — `mobile.home.suggestion.last_turn` ("tour" for "turn")

Current: `Montrez le dernier tour` (23). `tour` also means a lap, a turn in a game, or a trick; French chat vocabulary prefers `échange` for one exchange in a conversation. It is self-consistent with `mobile.schedules.parked.wakes` (`son prochain tour`), so it is a vocabulary call rather than an error. Carry-over of round 1's N-2. If the word changes, `Montrez le dernier échange` (26) fits the row.

### H-04 — NIT — `mobile.home.suggestion.phone_access` ("mobile" vs the product's own "téléphone")

Current: `Activez l’accès mobile` (22). The app's own noun for the phone is `téléphone` (`mobile.computers`: `Aucun ordinateur sur ce téléphone`), and `accès mobile` can also read as mobile-network access. Carry-over of round 1's N-4; both passes flagged it. `Activez l’accès par téléphone` (29) fits and settles the word.

### H-05 — NIT — `mobile.home.tip.schedule` ("régulièrement" asserts recurrence)

Current: `planifiez un prompt à exécuter régulièrement` (44). The English is "run a prompt on a timer", and `cadence.once` (`une fois`) is a first-class case in the schedules catalogue, so a one-off wake is not "regular". Recorded as a NIT rather than the second pass's MINOR because a rotating tip illustrates the feature rather than enumerating its cadences. If it is touched: `planifiez un prompt à exécuter à heure fixe` (43) drops the recurrence claim without claiming a single run either.

### H-06 — NIT — `mobile.home.suggestion.review_repo` ("Examinez" for "Review")

Current: `Examinez ce repo` (16). `examiner` is "examine"; the settled developer French for reviewing a repo is `passer en revue` / `relire`. The chip is clear as it stands, so this is a preference. `Passez ce repo en revue` (23) fits (`repo` untouched) and does not collide with any other verb in the pool.

## Every-key disposition (27/27)

| # | Key | Disposition |
|---|---|---|
| 1 | `connect_disabled_reason` | PASS — `Connectez un ordinateur pour envoyer.` one cause-and-action line, 37 chars, no connection claimed |
| 2 | `folders_read_failed` | PASS — failure named, no error code, no blame, `pour le moment` keeps it temporary |
| 3 | `greeting` | PASS — U+202F before `?` verified; register correct |
| 4 | `options.apply` | PASS — infinitive button, no final full stop |
| 5 | `options.fixed` | **H-01** (the label half of round 1's H-04 is verified fixed) |
| 6 | `options.folder` | PASS — folder located on the computer, not the phone |
| 7 | `options.title` | PASS |
| 8 | `queue.discard` | PASS — destructive action named plainly, clearly distinct from the move-to-draft button |
| 9 | `queue.restore` | PASS — moves to draft, does not send |
| 10 | `queue.sheet_title` | PASS — plural noun phrase matching the button that opens it |
| 11 | `queue.view` | PASS |
| 12 | `refused_start_fallback` | PASS — names the missing folder, does not blame the reader |
| 13 | `starting` | PASS — one line, ellipsis kept |
| 14 | `startup_queue.blocked` | PASS — retry instruction, no false progress |
| 15 | `startup_queue.not_started` | PASS — `Non démarrée` agrees with the unstated *conversation*; correct, and round 1's warning not to "fix" it to `Non démarré` stands |
| 16 | `startup_queue.sending` | PASS — ongoing, no count repeated |
| 17 | `startup_queue.unconfirmed` | PASS — implies nothing is waiting |
| 18 | `suggestion.last_turn` | PASS wording; **H-03** |
| 19 | `suggestion.linear_mcp` | PASS — `Linear MCP` byte-identical, imperative register |
| 20 | `suggestion.phone_access` | PASS wording; **H-04** |
| 21 | `suggestion.review_repo` | PASS wording; **H-06** |
| 22 | `suggestion.team_of_agents` | PASS — `Créez une équipe d’agents` (25/31), the pool's only agent-creating verb, as the note requires |
| 23 | `suggestion.wake_summary` | **H-02** |
| 24 | `tip.parallel` | PASS — 43/48, fragment stays lower case, no final stop |
| 25 | `tip.schedule` | PASS at 44/48; **H-05** |
| 26 | `tip.search` | PASS — 44/48 |
| 27 | `transcript.waiting` | PASS — pending conversation, ellipsis kept |

## Notes that are not findings

- **Source-level literal next to the referenced label.** `startup-transcript.tsx` still renders `"This conversation needs your answer."` and `"Conversation started"` as un-keyed English strings in the same row as the keyed details button. Out of scope for a catalogue audit and already owned by the strings baseline, but a French reader sees English beside a French button on that screen; reported so the manager can route it.
- **`options.fixed` length.** 131 characters today, 132 with the suggested fix; it is a help paragraph that wraps, and the sidecar sets no cell budget for it. No fit claim is made beyond that.

## Recording boundary

This repository has **no `i18n/ledger.json` and no audit-ledger command**; `docs/i18n.md` records the report in the pull request. The durable record is this bundle (`record.json`, `report.md`, `audit.log`); the ledger row that would be written is carried in `record.json.ledger_row_proposed`, explicitly marked as not written. No keyed public-copy receipt is claimed (the one credential-shaped key of this audit wave, `mobile.computers.password_placeholder`, was refused by the clean-core route because the mobile path is not committed in core, so no receipt exists anywhere).

**No rendered frame was captured and no native-speaker review is claimed.** Fit statements rest on executed character counts against budgets the code asserts, never on pixels.
