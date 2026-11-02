# Independent French audit — mobile.schedules (fr29a2)

**Verdict: changes_requested — 1 BLOCKER (S-01), 5 MAJOR (S-02–S-06), 2 MINOR (S-07–S-08); unresolved blocker/major count = 6.** All 35 English/context/French entries were read and judged. Actual auditor: `i18n-auditor`, delegated session `cd6e19e68327`. The model switched mid-request on provider quota fallbacks: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (the header in force when this bundle was written). Translator: `i18n-translator` session `c66311717837`, job `fbde6318e480`, actual served model `kimi/k3.1-pro` via temporary fallback, as supplied by the manager. Independence is agent/session/context, not model diversity. No translation/MT service, no human native review, no rendered-frame proof is claimed.

**Second independent pass:** worker job `07e08e5ac86c` (role `reviewer`, pinned `anthropic/claude-opus-5-5`, actual model `radient/auto` after the same quota descent) read all 62 keys of both namespaces without my findings. It independently reached the same `head.next` BLOCKER and the same count-agreement class behind S-02–S-06, and added the `many`-arm `de` defect in N-4. Severity differences are stated where they occur.

## Mechanical evidence (executed)

`audit.log` records the actual `npm run i18n:catalogue:check` (exit 0, projection current: 116 keys, 7 namespaces) and the scoped per-key parser audit using the app's own `parseMessage`/`formatMessage`. That validator checks key parity only — not placeholders — so the scoped audit checked every key itself:

- JSON parses; 35/35/35 source/target/context keys; no missing or extra keys.
- Every message parses; placeholder names and argument order identical to source; no `%s` tokens, no backticks, no commands/flags in this namespace.
- The two `select` arms (`wakes`/`other`) exist and match; the four plural keys carry French CLDR `one`/`many`/`other` (verified with `Intl.PluralRules("fr")`: 0→one, 1→one, 2→other, 1 000 000→many).
- No bidi controls; no ASCII `'` (U+2019 used); middle dot kept.

Two cautions on the mechanical table: the naive `#`-count check reports `count.monitors`, `count.wakes`, `show_more.monitors`, `show_more.wakes` as `hashes=false` **only** because French legitimately adds a `many` branch (one `#` per branch) — not a defect. And `formatMessage` renders `#` through `String(n)`, so the `many` branches above a million print `1000000` without grouping; that is a renderer limitation, not a translation error, and no copy change can fix it.

## Runtime composition checked, not assumed

These strings are fragments composed by `src/features/schedules/schedules-copy.ts`. The executed render (in `audit.log`) shows what a reader actually gets:

```
COMPOSE fr head.next  : 3 réveils · prochain dans dans 4m
COMPOSE fr head.next (1 monitor): 1 surveillance · prochain dans dans 30s
RENDER fr cadence.left remaining=1: tous les 1h · 1 restantes
RENDER fr summary.monitors_armed count=1: 1 actives
RENDER fr summary.wakes count=1: 1 planifiés
RENDER fr tail.failed count=1: 1 échecs
RENDER fr summary.monitors_attention broken=1 total=1: 1 sur 1 nécessitent votre attention
```

`dueLabel()` returns the **whole** phrase including the preposition (`dans 4m`), and `nextDueClause()` inserts it into `head.next` as `{label}`. So the French sentence contains the preposition twice.

Every replacement this report proposes was parsed and rendered with the app's own `parseMessage`/`formatMessage` before being written down (`PROPOSED` rows in `audit.log`): all six parse, the four plural forms render at 0/1/2/1 000 000/1 500 000 as one/one/other/many/other, and `head.next` renders « 3 réveils · prochaine échéance dans 4m ».

## Findings

### S-01 — BLOCKER — `mobile.schedules.head.next` (composition / grammar)
Current: `{head} · prochain dans {label}` → executed: **« 3 réveils · prochain dans dans 4m »**. `{label}` already contains `dans` (from `due.ahead`), so the head line says "in in". The bare masculine adjective `prochain` also cannot agree with a feminine `{head}` (`1 surveillance`), and it dangles with no noun.
Suggested: `{head} · prochaine échéance {label}` → « 3 réveils · prochaine échéance dans 4m » / « 1 surveillance · prochaine échéance dans 30s ». `échéance` fixes both the double preposition and the gender dependency. (`{head} · {label}` alone would also be grammatical but loses the forward-looking word the context calls for.) Fit note: the corrected head is longer than the English (`3 réveils · prochaine échéance dans 4m` is 44 characters against 21), so the meta row should be measured at 320 pt; `{head} · prochain {label}` is shorter but reintroduces the gender defect, so it is not an equivalent fix.

### S-02 — MAJOR — `mobile.schedules.cadence.left` (number agreement)
Current: `{cadence} · {remaining} restantes` → executed at `remaining = 1`: **« tous les 1h · 1 restantes »**. Wrong number, and `restantes` has no noun to agree with in French.
Suggested: `{cadence} · {remaining, plural, one {# envoi restant} many {# d’envois restants} other {# envois restants}}` → « … · 1 envoi restant » / « … · 3 envois restants ». `envoi` matches `cadence.spent`'s own « plus aucun envoi restant ».

### S-03 — MAJOR — `mobile.schedules.summary.monitors_armed` (number agreement)
Current: `{count} actives` → executed at `count = 1`: **« 1 actives »**. Feminine plural is correct for 2+, wrong for 1.
Suggested: `{count, plural, one {# active} many {# de surveillances actives} other {# actives}}`.

### S-04 — MAJOR — `mobile.schedules.summary.wakes` (number agreement)
Current: `{count} planifiés` → executed at `count = 1`: **« 1 planifiés »**.
Suggested: `{count, plural, one {# planifié} many {# de réveils planifiés} other {# planifiés}}`.

### S-05 — MAJOR — `mobile.schedules.tail.failed` (number agreement)
Current: `{count} échecs` → executed at `count = 1`: **« 1 échecs »**. This sits after a monitor's health sentence, where a single failure is the common case.
Suggested: `{count, plural, one {# échec} many {# d’échecs} other {# échecs}}`.

### S-06 — MAJOR — `mobile.schedules.summary.monitors_attention` (agreement edge + addition)
Current: `{broken} sur {total} nécessitent votre attention` → executed for 1 of 1: **« 1 sur 1 nécessitent votre attention »** (plural verb with a singular count). It also adds a second-person possessive the source does not have.
Suggested: `{broken} sur {total} en alerte` — invariant, and it names the `row.alerting` state the code already computes.

### S-07 — MINOR — French narrow space missing before `:` and `;` (4 keys)
`empty.body`, `supervisor.not_running`, `supervisor.unsupported`, `supervisor.unverifiable` use U+0020 where `fr.md` requires U+202F. Executed codepoint check is in `audit.log` (`PUNCTUATION_DETAIL`). Fix is mechanical: replace that one space in each of the four strings; no wording change.

### S-08 — MINOR — `mobile.schedules.cadence.once` (idiom)
Current: `unique`. Standalone, it reads as an adjective with its noun missing ("unique/single") rather than "fires once", and it replaces a cadence phrase (`tous les 1h`) in the same slot.
Suggested: `une fois`.

## NIT (max 5 respected)

- **N-1** `supervisor.unsupported`: `ceux ci-dessous` → `ceux listés ci-dessous` (or `les réveils ci-dessous`). `ceux ci-dessous` is not the usual French form; `ceux-ci` is the pronoun, `ci-dessous` an adverb.
- **N-2** `empty.body`: `Les réveils envoient un prompt à une conversation` → `dans une conversation`; and `elle apparaîtra ici` most naturally resolves to `une tâche régulière`, whereas what appears is the schedule — `la planification apparaîtra ici` removes the ambiguity; `signalent ses changements` → `signalent ce qui change` is closer to "report what changes".
- **N-3** `state.stale`: `obsolète` is acceptable; `périmé` is the more common French word for a stale datum/clock. Recorded as a preference, not a defect.
- **N-4** `show_more.{monitors,wakes}` `many` arms omit the required `de`: `Afficher # surveillances de plus` / `Afficher # réveils de plus`. At a million the French is `Afficher # de surveillances de plus`. Practically unreachable (`hidden = rows − 3`), so a NIT, but both arms should gain the `de` the next time they are touched.

## Every-key disposition

The `MECHANICAL` rows in `audit.log` cover all 35 keys; this list is the independent language pass.

| # | Key | Disposition |
|---|---|---|
| 1 | `cadence.every` | PASS — `tous les {duration}` |
| 2 | `cadence.left` | **S-02** |
| 3 | `cadence.once` | **S-08** |
| 4 | `cadence.spent` | PASS — `plus aucun envoi restant` is correctly singular and non-promissory |
| 5 | `count.monitors` | PASS — `one`/`many`/`other`; `0` and `1` render singular (`0 surveillance`), 2+ plural; `surveillance` is the mandated glossary term (see note) |
| 6 | `count.wakes` | PASS — `one`/`many`/`other`; `1 réveil`, `0 réveil`, `3 réveils` verified by render |
| 7 | `due.ahead` | PASS — `{label}` invariable, no agreement risk |
| 8 | `due.overdue` | PASS — `en retard de {label}` reads correctly; label-first alternative noted below |
| 9 | `empty.body` | MINOR spacing (S-07) + N-2; meaning otherwise preserved |
| 10 | `empty.title` | PASS — `Aucune planification active`; natural equivalent of "Nothing is armed" |
| 11 | `empty_line.monitors` | PASS |
| 12 | `empty_line.wakes` | PASS |
| 13 | `gone.monitors` | PASS — `Disparue` agrees with `surveillance`; distinct from parked |
| 14 | `gone.wakes` | PASS — `Disparu` agrees with `réveil`; distinct from parked |
| 15 | `head.next` | **S-01 BLOCKER** |
| 16 | `head.overdue` | PASS — executed « 2 réveils · en retard de 2h » |
| 17 | `parked.monitors` | PASS — resume-when-running semantics kept |
| 18 | `parked.wakes` | PASS — after-next-turn semantics kept, no "when you open it" |
| 19 | `read_error.monitors` | PASS — names the family, not empty-list shaped |
| 20 | `read_error.wakes` | PASS |
| 21 | `read_unreachable` | PASS — read failure only, no cause claimed |
| 22 | `show_less.monitors` | PASS |
| 23 | `show_less.wakes` | PASS |
| 24 | `show_more.monitors` | PASS — one/many/other; `Afficher 1 surveillance de plus` renders correctly |
| 25 | `show_more.wakes` | PASS — `Afficher 1 réveil de plus` renders correctly |
| 26 | `state.stale` | PASS (N-3 preference) |
| 27 | `state.waiting` | PASS |
| 28 | `summary.monitors_armed` | **S-03** |
| 29 | `summary.monitors_attention` | **S-06** |
| 30 | `summary.wakes` | **S-04** |
| 31 | `supervisor.not_running` | PASS meaning; S-07 spacing |
| 32 | `supervisor.unsupported` | PASS meaning; S-07 spacing; N-1 |
| 33 | `supervisor.unverifiable` | PASS meaning; S-07 spacing — and it does not claim the supervisor is stopped, as the context demands |
| 34 | `tail.failed` | **S-05** |
| 35 | `truncated` | PASS — select arms `des réveils`/`des surveillances` are grammatical |

## Notes that are not code findings

- **`surveillance` as a countable noun.** `Afficher moins de surveillances` is stilted because French *surveillance* is normally a mass noun; `moniteur` would be the countable form. The glossary mandates `surveillance` for `monitor`, so the translation is correct **against the guide** — changing it is a glossary decision (one term, one decision), not a catalogue edit. Recorded so the glossary owner can decide.
- **`due.overdue` word order.** `en retard de 2h` moves the formatting token after the noun phrase, unlike English `2h overdue`. It reads correctly and the placeholder survives byte-identically; `2h de retard` is an equally valid alternative if a future style pass prefers label-first. Not a defect.

## Source-level gaps (outside this catalogue pair)

Two problems a French catalogue edit cannot fix; reported so the manager can route them, and excluded from the unresolved blocker/major count:

- `monitorSlot` (`src/features/schedules/schedules-copy.ts:422-426`) returns `row.state` unchanged for every state but `armed`, so `dormant`, `disabled` and `expired` render as English words on a French screen while `stale`/`waiting` are keyed. The server's state vocabulary is passed through by design (the comment says so); making it localizable is a source change.
- `truncated` inherits the English source's own raggedness: at `{total} = 1` it renders `sur 1 conversations`. Not introduced by French.

## Recording boundary

This mobile repository has no `i18n/ledger.json` and no audit-ledger command; `docs/i18n.md` says the PR records the report, and the audit bundle is the durable artifact (`record.json`, `report.md`, `audit.log`). No keyed public-copy receipt and no ledger row are claimed. No frame was captured, so no truncation/overflow claim beyond the executed string measurements is made.
