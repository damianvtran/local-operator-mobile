# Independent French audit, round 2 — mobile.schedules (fr29s2)

**Verdict: `passed` — no BLOCKER, no MAJOR; 2 MINOR (S-01, S-02) and 3 NIT (S-03–S-05) recorded; unresolved blocker/major count = 0.**
All 38 English / context / French entries were read and judged against the current bytes at head `79b3fad`.

This is a **round-2 re-audit of the current bytes**. Round 1 (`i18n/audits/evidence/fr/mobile.schedules/fr29a2`) returned `changes_requested` with 1 BLOCKER and 5 MAJOR; each of those was re-checked here against what the bytes now say, and every key was judged again rather than inheriting a verdict. The namespace grew from 35 to 38 keys (three monitor state words).

**Auditor:** `i18n-auditor`, delegated session `16ebcda69228`. **Actual model in force for this work: `radient/auto`**, after a provider-quota descent observed in this transcript — `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (recorded in `record.json`).

**Translator:** `i18n-translator` session `c66311717837` (model `kimi/k3.1-pro` via fallback, as supplied by the requesting manager; not observed by this auditor). Independence is agent, session and context — not model diversity: my run and the translator's share `kimi/k3.1-pro` on part of the chain. Disclosed, not closed.

**Second independent pass:** job `de9bf370df7e`, role `reviewer`, pinned `anthropic/claude-opus-5-5`, **actual model `radient/auto`** (same quota descent, self-reported), reading all 65 keys without my findings. It returned no BLOCKER and no MAJOR, and independently confirmed the composition result below. Disagreements are stated inside the findings. No human native-speaker review and no rendered frame is claimed anywhere in this bundle.

## Mechanical evidence (executed; full output in `audit.log`)

`npm run i18n:catalogue:check` → exit 0, `src/i18n/catalogue.gen.ts is current (120 keys, 7 namespaces, argument types from en, fr)`. It enforces key parity and parseability only, so everything below was also checked key by key.

- Valid JSON, no duplicate keys; **38 en / 38 context / 38 fr** keys; no missing, no extra, every key has a context entry.
- Every message parses with the app's own `parseMessage`. Placeholder **names and kinds are identical to the source in all 38 keys**: `count`/`hidden`/`remaining`/`shown` plural, `family` select, `cadence`/`head`/`label`/`total`/`broken`/`duration` text.
- **French CLDR categories.** All 9 plural messages carry exactly `one`, `many`, `other`; none carries `few`, `two` or `zero`. `Intl.PluralRules("fr")` on this runtime: 0→one, 1→one, 2→other, 1 000 000→many, 1 500 000→other.
- **Text→plural escalation is legitimate here, not a mismatch.** Four messages (`summary.monitors_armed`, `summary.wakes`, `tail.failed`, `truncated`) declare a plain placeholder in English and an ICU plural in French. `scripts/i18n/generate.ts` explicitly allows a locale to *escalate* text→plural ("a locale whose noun inflects") and forbids downgrades; the generated surface consequently types those arguments `number` (`catalogue.gen.ts:371-378`), and every call site passes a number (`rows.length`, `consecutive_failures`, `shown`). Nothing can reach the renderer as a string.
- **Typographic spacing.** Every `:`, `;` in the namespace is preceded by **U+202F** (5 sites: `empty.body` ×2, `supervisor.not_running`, `supervisor.unsupported`, `supervisor.unverifiable`); this fixes round 1's S-07. No `?` or `!` occurs.
- **Characters.** No ASCII apostrophe, no ASCII double quote, no ASCII `...`, no U+00A0, no bidi control (U+061C/U+200E/U+200F/U+202A–U+202E/U+2066–U+2069) in any value. Apostrophes are U+2019; ellipsis is U+2026; the middle dot is U+00B7; em dashes are spaced.
- **Glossary.** `surveillance` renders monitor in 9 keys, `réveil` wake in 12, `planification` schedule in 2, and `prompt` is kept as the guide requires (`empty.body`). `Linear MCP`, `repo`, `lop mobile`, `Local Operator`, `Radient` do not occur in this namespace at all (the `repo` substring hit in `empty.body` is the word "report"), so there is nothing to preserve there.
- `npx vitest run src/features/schedules/__tests__/schedules-copy.test.ts` (with the home and i18n suites) → **159 tests passed** on these bytes.

## Composition, executed rather than assumed

`{label}` is produced by `dueLabel()`, which returns the **whole** phrase with its preposition (`dans 4m`, `en retard de 2h`); `nextDueClause()` splices it into `head.next`/`head.overdue`. Rendering through the production path gives:

```
3 réveils · prochaine échéance dans 4m          (was: 3 réveils · prochain dans dans 4m — round-1 S-01)
1 surveillance · prochaine échéance dans 30s
2 réveils · en retard de 2h
1 000 000-form: 1000000 de réveils · prochaine échéance dans 4m
```

No duplicated preposition, and `échéance` (feminine) removes the gender dependency that `prochain` had on `{head}`. Round 1's BLOCKER is fixed.

## Count renders at 0 / 1 / 2 / 1 000 000 / 1 500 000 (app parser + production `renderFor`, preference `fr`)

| Key | 0 | 1 | 2 | 1 000 000 | 1 500 000 |
|---|---|---|---|---|---|
| `count.monitors` | 0 surveillance | 1 surveillance | 2 surveillances | 1000000 de surveillances | 1500000 surveillances |
| `count.wakes` | 0 réveil | 1 réveil | 2 réveils | 1000000 de réveils | 1500000 réveils |
| `cadence.left` | 0 envoi restant | **1 envoi restant** | 2 envois restants | 1000000 d'envois restants | 1500000 envois restants |
| `show_more.monitors` | 0 surveillance de plus | 1 surveillance de plus | 2 surveillances de plus | 1000000 de surveillances de plus | 1500000 surveillances de plus |
| `show_more.wakes` | 0 réveil de plus | 1 réveil de plus | 2 réveils de plus | 1000000 de réveils de plus | 1500000 réveils de plus |
| `summary.monitors_armed` | 0 active | **1 active** | 2 actives | 1000000 de surveillances actives | 1500000 actives |
| `summary.wakes` | 0 planifié | **1 planifié** | 2 planifiés | 1000000 de réveils planifiés | 1500000 planifiés |
| `tail.failed` | 0 échec | **1 échec** | 2 échecs | 1000000 d'échecs | 1500000 échecs |
| `truncated` | 0 conversation | 1 conversation | 2 conversations | 1000000 de conversations | 1500000 conversations |

Round 1's five agreement defects (`1 restantes`, `1 actives`, `1 planifiés`, `1 échecs`, `1 nécessitent`) all render correctly now, and `0` takes the singular per the style guide (`0 surveillance`, not `0 surveillances`). The ungrouped `1000000` is the renderer's `String(n)`, documented in `messages.ts` as a known limitation — not a translation defect.

Table scope: for `cadence.left` and `truncated` the cell shows the count-bearing clause only; their full rendered strings (`tous les 1h · …`, `Affichage de … sur 5 avec des réveils.`) are in `audit.log` §4.

## Round 1's findings, re-checked on the current bytes

| Round-1 id | What it asked for | Current bytes | Status |
|---|---|---|---|
| S-01 `head.next` (BLOCKER) | no duplicated preposition, no gender dependency | `{head} · prochaine échéance {label}` | **fixed** (composed above) |
| S-02 `cadence.left` | number agreement + a noun | `one {# envoi restant} many {# d’envois restants} other {# envois restants}` | **fixed** |
| S-03 `summary.monitors_armed` | `1 active` not `1 actives` | `one {# active}` | **fixed** |
| S-04 `summary.wakes` | singular agreement | `one {# planifié}` | **fixed** |
| S-05 `tail.failed` | singular agreement | `one {# échec}` | **fixed** |
| S-06 `summary.monitors_attention` | no plural verb at 1/1, no added possessive | `{broken} sur {total} en alerte` | **fixed for both**; the wording now overstates — this round's **S-01** |
| S-07 typography (MINOR) | U+202F before `:`/`;` | all 5 sites U+202F | **fixed** |
| S-08 `cadence.once` (MINOR) | `une fois` | `une fois` | **fixed** |
| N-1 `ceux ci-dessous` (NIT) | `ceux listés ci-dessous` | unchanged | **S-03** |
| N-2 `empty.body` (NIT) | pronoun/word-order | unchanged | **S-02**, **S-04** |
| N-3 `state.stale` (NIT) | `périmé` preferred | unchanged (`obsolète`) | no action; preference only |
| N-4 `many` arms missing `de` | add `de` | `Afficher # de surveillances de plus` / `de réveils` | **fixed** |

## Findings

### S-01 — MINOR — `mobile.schedules.summary.monitors_attention` ("en alerte" overstates what the header counts)

Current: `{broken} sur {total} en alerte` → renders `1 sur 1 en alerte`, `2 sur 5 en alerte`.
English: `{broken} of {total} need attention`.

The count behind `{broken}` is `monitorAlerting()`, which deliberately treats a **disabled** or **expired** monitor as news (`schedules-copy.ts:476-481`). `en alerte` asserts an alarm state: a monitor the user switched off (`désactivée`) or one past expiry (`expirée`) is not "in alert", so the header can contradict the very row it is summarising — the contradiction this header was introduced to avoid (context note: "Used instead of the armed counter so the header cannot contradict a row that reads disabled").

This is round 2 judging round 1's own fix: `en alerte` removed the plural-verb and possessive defects but introduced an overstatement. The second pass reached the same conclusion independently and proposed the same replacement.
Suggested (31 characters, parses, renders `1 sur 1 à vérifier`):
`{broken} sur {total} à vérifier`

### S-02 — MINOR — `mobile.schedules.empty.body` (pronoun binds to the wrong referent)

Current: `…Demandez à un agent dans une conversation d’effectuer une tâche régulière : elle apparaîtra ici.…`
`elle` agrees with the nearest feminine noun, `une tâche régulière` — so the sentence promises that the recurring **task** appears in a list that actually holds wakes and monitors. What appears is the schedule entry; the guide's own word for one is `prompt planifié`.
Suggested (neutral pronoun, removes the ambiguity; 240 characters, parses):
`Demandez à un agent dans une conversation d’effectuer une tâche régulière : cela apparaîtra ici. …` (rest unchanged)

### S-03 — NIT — `mobile.schedules.supervisor.unsupported` (`ceux ci-dessous`)

Current: `… : ceux ci-dessous ne se déclenchent que lorsqu’une conversation s’exécute.`
`ceux ci-dessous` is not the usual French form (`ceux-ci` is the pronoun; `ci-dessous` is an adverb), and the sentence already names its subject. The other two supervisor sentences say `les réveils ci-dessous`, so the trio is ragged as a set. Carry-over of round 1's N-1.
Suggested: `… : les réveils ci-dessous ne se déclenchent que lorsqu’une conversation s’exécute.` (144 characters, parses)

### S-04 — NIT — `mobile.schedules.empty.body` (`envoient un prompt à une conversation à une heure précise`)

`envoyer quelque chose *à* une conversation` is an English calque; French sends *dans* a conversation. Two `à`-phrases also stack. Carry-over of round 1's N-2 second half.
Suggested: `… Les réveils envoient un prompt dans une conversation à une heure précise ; …`

### S-05 — NIT — `mobile.schedules.cadence.spent` (`plus aucun envoi restant`)

After `aucun` the set is already exhausted, so `restant` is redundant — an artefact of the English "no deliveries left". Carries the same vocabulary as `cadence.left`.
Suggested: `{cadence} · plus aucun envoi` (renders `tous les 1h · plus aucun envoi`)

## Every-key disposition (38/38)

| # | Key | Disposition |
|---|---|---|
| 1 | `cadence.every` | PASS — `tous les {duration}`, duration untouched |
| 2 | `cadence.left` | PASS — three categories, agreement verified at every count |
| 3 | `cadence.once` | PASS — `une fois` (was `unique`) |
| 4 | `cadence.spent` | PASS — `plus aucun envoi restant`; **S-05** |
| 5 | `count.monitors` | PASS — `one/many/other`, `0 surveillance` singular |
| 6 | `count.wakes` | PASS — `1 réveil`, `0 réveil` |
| 7 | `due.ahead` | PASS — `dans {label}` |
| 8 | `due.overdue` | PASS — `en retard de {label}`; keeps the terminal's word, not "en retard" as a noun |
| 9 | `empty.body` | PASS meaning; **S-02**, **S-04** |
| 10 | `empty.title` | PASS — `Aucune planification active` |
| 11 | `empty_line.monitors` | PASS |
| 12 | `empty_line.wakes` | PASS |
| 13 | `gone.monitors` | PASS — `Disparue` agrees with `surveillance`; distinct from parked |
| 14 | `gone.wakes` | PASS — `Disparu`; `aucun déclenchement n’a lieu` |
| 15 | `head.next` | PASS — composed `3 réveils · prochaine échéance dans 4m` |
| 16 | `head.overdue` | PASS — `2 réveils · en retard de 2h`, no forward word |
| 17 | `parked.monitors` | PASS — resume when the conversation *runs* again |
| 18 | `parked.wakes` | PASS — resumes after its next turn; "tour" is H-03's vocabulary call in the home bundle, kept consistent here |
| 19 | `read_error.monitors` | PASS — names the family, not empty-list shaped |
| 20 | `read_error.wakes` | PASS |
| 21 | `read_unreachable` | PASS — read failure only, cause left to the connection surface |
| 22 | `show_less.monitors` | PASS |
| 23 | `show_less.wakes` | PASS |
| 24 | `show_more.monitors` | PASS — `one/many/other`, `de` in the `many` arm |
| 25 | `show_more.wakes` | PASS — same |
| 26 | `state.disabled` | PASS — `désactivée`, feminine for `surveillance`; one word, no stop; used only through `monitorStateWord()` |
| 27 | `state.dormant` | PASS — `en veille`, distinct from the parked **clause** `En pause`, as the note requires |
| 28 | `state.expired` | PASS — `expirée`, same agreement |
| 29 | `state.stale` | PASS — `obsolète` is epicene, safe on the masculine `réveil` row |
| 30 | `state.waiting` | PASS — `en attente` |
| 31 | `summary.monitors_armed` | PASS — `1 active` / `2 actives`; **S-01** concerns the sibling header |
| 32 | `summary.monitors_attention` | **S-01** |
| 33 | `summary.wakes` | PASS — `1 planifié` |
| 34 | `supervisor.not_running` | PASS — U+202F before `:`, installed-but-not-running kept |
| 35 | `supervisor.unsupported` | PASS meaning; **S-03** |
| 36 | `supervisor.unverifiable` | PASS — does not claim the supervisor is stopped |
| 37 | `tail.failed` | PASS — `1 échec` |
| 38 | `truncated` | PASS — `Affichage de 3 conversations sur 12 avec des réveils.`; the French is cleaner than the English at `total = 1` |

## Notes that are not findings

- **`surveillance` as a countable noun.** `Afficher moins de surveillances` remains stilted because French *surveillance* is normally a mass noun; the glossary mandates `surveillance` for `monitor`, so this is a glossary decision, not a catalogue edit. Round 1 recorded it; unchanged.
- **Unknown wire states still render English.** `monitorStateWord()` returns the raw state string for anything outside `disabled`/`expired`/`dormant` (`schedules-copy.ts:448-456`). That is a deliberate pass-through of the store's vocabulary, but a French reader would see an English word for a future state. Source-level; outside this audit's count.
- **`state.*` gender is anchored to the row family, not the row's name.** `désactivée`/`expirée` agree with `surveillance`; the note "one word" is satisfied. Recorded so nobody "fixes" them to masculine.

## Recording boundary

This repository has **no `i18n/ledger.json` and no audit-ledger command**; `docs/i18n.md` records the report in the pull request. The durable record is this bundle; the ledger row that *would* be written is carried in `record.json.ledger_row_proposed`, marked not written. No keyed public-copy receipt is claimed (`mobile.computers.password_placeholder` was refused by the clean-core route because the mobile path is not committed in core, so no receipt exists anywhere in this wave).

**No rendered frame was captured and no native-speaker review is claimed.** Composition and fit statements are executed renders and character counts, never pixels.
