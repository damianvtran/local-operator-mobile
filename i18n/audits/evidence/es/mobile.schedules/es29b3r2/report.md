# Independent delta re-audit — `mobile.schedules` · Spanish (`es`) · round 2

**Verdict: `changes_requested` — 1 MAJOR, 1 MINOR, 1 NIT open.**
The round-1 blocker/major findings are genuinely closed (ES-SCH-1…5 below), but the
remediation introduced one agreement regression and left one repetition.

| | |
|---|---|
| Locale / file group | `es` · `mobile.schedules` (38 keys) |
| Repository / branch / commit | `~/workspace/es-wave` · `feat/i18n-spanish` · **`f1c782f22a1f4a3f31f025282849cc62ba41b8c6`** ("feat(i18n): ship Spanish across the mobile catalogue") |
| Audited bytes | committed bytes at that commit (the file is tracked now: `git ls-tree HEAD -- src/i18n/catalogues/es`) |
| Round-1 audited bytes | `aae7d6ac…842084` at `c5f491e` (untracked worktree bytes). **Not recoverable from git** — the round-1 record is the only witness, and every "before" value in this report is quoted from that bundle's recorded tables, never re-derived |
| Auditor | `i18n-auditor` (lopdev team), session `4018f32a5589` |
| **Actual model** | **`radient/auto`** — every command in `audit.log` ran with that session header. Fallback chain disclosed: `anthropic/claude-sonnet-5-5` (provider quota) → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`, all before the first command |
| Independence | Different session and context from both the translator and the round-1 auditor. The served model id is the same family the round-1 auditor reported (`radient/auto`), so this is **session independence only, not model diversity** — disclosed, not closed |

Input hashes (the exact bytes judged, `audit.log` §2):

| input | sha256 |
|---|---|
| `src/i18n/catalogues/en/mobile.schedules.json` | `0459a0485ceb2594c60a152a8dbdc5035689ade05ac370134f8e37be6abc575f` |
| `src/i18n/catalogues/en/mobile.schedules.context.json` | `d3f0d3bba057aacf4d3495b3d5eec2471d66b6d6c011b50834a1f58a0839aa92` |
| `src/i18n/catalogues/es/mobile.schedules.json` | `cb58766d4f3933e0c2d64012be2e93712d7e49f506e38b6d6806d2228b3b4a83` |

Renderer provenance: `src/i18n/messages.ts` `c1831406…` (the one parser/formatter),
`src/i18n/runtime.ts` `31c1c337…` (`renderFor`), projection `src/i18n/catalogue.gen.ts`
`9a337f26…`, type scale `src/ui/theme.css` `adcf4047…`.

---

## 1. What actually changed since round 1

18 of 38 values changed; 20 are byte-identical to the round-1 recorded text. Derived by
diffing the round-1 bundle's per-key table against the current file
(`audit.log` §10, produced by the bundled `delta.py`, so the count is executed rather than eyeballed):

| key | round 1 (quoted) | now |
|---|---|---|
| `count.monitors` | `# monitor / # de monitores / # monitores` | `# monitorización / # de monitorizaciones / # monitorizaciones` |
| `empty.body` | `…los monitores vigilan una cosa…` | `…las monitorizaciones vigilan una cosa…` |
| `empty.title` | `No hay nada armado` | `No hay nada activo` |
| `empty_line.monitors` | `No hay monitores armados.` | `No hay monitorizaciones activas.` |
| `gone.monitors` | `Desaparecido — …así que nada lo comprueba` | `Ya no está — …así que nada la comprueba` |
| `gone.wakes` | `Desaparecido — …así que nada lo dispara` | `Ya no está — …así que nada lo dispara` |
| `parked.monitors` | `…los monitores se reanudan…` | `…las monitorizaciones se reanudan…` |
| `read_error.monitors` | `…los monitores de esta máquina.` | `…las monitorizaciones de esta máquina.` |
| `show_less.monitors` | `Mostrar menos monitores` | `Mostrar menos monitorizaciones` |
| `show_more.monitors` | `…# monitor / # de monitores / # monitores` | `…# monitorización / # de monitorizaciones / # monitorizaciones` |
| `state.disabled` | `desactivado` | `desactivada` |
| `state.dormant` | `inactivo` | `inactiva` |
| `state.expired` | `caducado` | `caducada` |
| `state.stale` | `obsoleto` | **`obsoleta`** ← regression, ES-SCH-6 |
| `summary.monitors_armed` | `# monitor armado / …` | `# monitorización activa / # de monitorizaciones activas / # monitorizaciones activas` |
| `summary.monitors_attention` | `{broken} de {total} requieren atención` | `{broken, plural, one {# de {total} requiere atención} many {…requieren…} other {…requieren…}}` |
| `tail.failed` | `# fallido / # de fallidos / # fallidos` | `# fallo / # de fallos / # fallos` |
| `truncated` | `…con {… other {monitores}}.` | `…con {… other {monitorizaciones}}.` |

Unchanged (20): `cadence.*` (4), `count.wakes`, `due.ahead`, `due.overdue`,
`empty_line.wakes`, `head.next`, `head.overdue`, `parked.wakes`, `read_error.wakes`,
`read_unreachable`, `show_less.wakes`, `show_more.wakes`, `state.waiting`,
`summary.wakes`, `supervisor.*` (3).

---

## 2. Mechanical checks — all executed, output in `audit.log`

| check | result |
|---|---|
| Key parity | 38 en / 38 es; **0 missing, 0 extra**, same order |
| ICU parse of every es message with the app's own parser | **38/38 parse**, 0 `RangeError` |
| Placeholder names | identical to en on all 38 |
| Placeholder **kinds** | 4 keys promote a `text` argument to `plural` (`summary.wakes`, `summary.monitors_armed`, `summary.monitors_attention`, `tail.failed`). Names kept; `generate.ts` merges argument kinds across en/es/fr and fails only on a plural/select clash, so this is permitted by the gate; callers already pass numbers; the French wave ships the same promotion on `count.monitors`, `summary.wakes`, `summary.monitors_armed` and `tail.failed` — accepted practice for a locale whose grammar needs the arms, not a defect |
| CLDR categories for `es` | `Intl.PluralRules("es")` → `["one","many","other"]`. Every es plural message carries **all three** (8/8 messages); no `few`, no non-es category, no `=N` branch |
| `{total}` retained in every arm of `summary.monitors_attention` | one ✓ / many ✓ / other ✓ (walked from the parse tree, not a regex) |
| Markup / backticks / flags / identifiers | none present; nothing altered |
| bidi control characters | 0 |
| em dash form ` — ` with spaces | 4/4 correct |
| Full stops where en has none | none |
| Repository validator | `node scripts/i18n/generate.ts --check` → *"catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, **es**, fr)"*, exit 0. **This is new since round 1**: `es` is in `SHIPPED_LOCALES` at this commit, so the projection is now generated from the es bytes too (a key/naming/shape error in es fails generation) rather than es being skipped |
| Repo tests for this namespace | `vitest run src/i18n/__tests__ src/features/schedules` → **6 files, 151 tests passed** |

**Negative controls** (a check that cannot fail is not a check — `audit.log` §5 item 12):
the round-1 attention string still renders `1 de 40 requieren atención` while the current
one renders `1 de 40 requiere atención`; a tampered message with the `many` arm removed is
caught as missing `many` and renders the bare form `1000000 monitorizaciones`; a tampered
attention message with `{total}` deleted is caught by the parameter-parity check.

---

## 3. Rendered evidence — the app's own parser, `Intl.PluralRules("es")`

Reproduced through the shipped projection (`catalogue.gen.ts` → `formatMessage`) as well as
through `parseMessage`; both agree (`audit.log` §6). A plain-Node import of `runtime.ts`
itself fails on Node's ESM directory resolution (`src/i18n/catalogues/` sits beside
`catalogues.ts`); the app's own `runtime.test.ts`/`copy-resolution.test.ts` are what exercise
`renderFor` and they pass on this commit. `zh-CN` renders the English floor for the same keys,
which proves the es text really is being served from the es catalogue and not by fallback.

### Counted nouns at 0 / 1 / 2 / 1 000 000

| key | input | es category | rendered |
|---|---|---|---|
| `count.monitors` | 0 | other | `0 monitorizaciones` |
| `count.monitors` | 1 | one | `1 monitorización` |
| `count.monitors` | 2 | other | `2 monitorizaciones` |
| `count.monitors` | 1 000 000 | many | `1000000 de monitorizaciones` |
| `count.wakes` | 0 / 1 / 2 / 1 000 000 | other/one/other/many | `0 despertares` · `1 despertar` · `2 despertares` · `1000000 de despertares` |
| `summary.monitors_armed` | 0 / 1 / 2 / 1 000 000 | other/one/other/many | `0 monitorizaciones activas` · `1 monitorización activa` · `2 monitorizaciones activas` · `1000000 de monitorizaciones activas` |
| `summary.wakes` | 0 / 1 / 2 / 1 000 000 | other/one/other/many | `0 despertares programados` · `1 despertar programado` · `2 despertares programados` · `1000000 de despertares programados` |
| `show_more.monitors` | 0 / 1 / 2 / 1 000 000 | other/one/other/many | `Mostrar 0 monitorizaciones más` · `Mostrar 1 monitorización más` · `Mostrar 2 monitorizaciones más` · `Mostrar 1000000 de monitorizaciones más` |
| `show_more.wakes` | 0 / 1 / 2 / 1 000 000 | other/one/other/many | `Mostrar 0 despertares más` · `Mostrar 1 despertar más` · `Mostrar 2 despertares más` · `Mostrar 1000000 de despertares más` |
| `tail.failed` | 0 / 1 / 2 / 1 000 000 | other/one/other/many | `0 fallos` · `1 fallo` · `2 fallos` · `1000000 de fallos` |

The `many` arm's `de` is what the category exists for: without it the 10⁶ render is the
wrong `1000000 monitorizaciones`, which is exactly what the negative control produces.
`1 000 000` prints ungrouped (`1000000`) because `messages.ts` renders `#` through
`String(n)` — a documented renderer limitation, not a catalogue defect; the style guide's
`1.000.000` grouping is therefore unobservable here.

### `summary.monitors_attention` at the agreement boundary

| input | es category | rendered |
|---|---|---|
| `broken=1 total=40` | one | **`1 de 40 requiere atención`** |
| `broken=1 total=1` | one | `1 de 1 requiere atención` |
| `broken=2 total=40` | other | `2 de 40 requieren atención` |
| `broken=0 total=40` | other | `0 de 40 requieren atención` |
| `broken=2 total=5` | other | `2 de 5 requieren atención` |

ES-SCH-2 is closed: the singular now agrees, and 0 correctly takes the plural.

### `truncated`, both families

`Mostrando 3 de 9 conversaciones con despertares.` ·
`Mostrando 1 de 9 conversaciones con despertares.` ·
`Mostrando 200 de 500 conversaciones con despertares.` ·
`Mostrando 3 de 9 conversaciones con monitorizaciones.` ·
`Mostrando 1 de 9 conversaciones con monitorizaciones.` ·
`Mostrando 200 de 500 conversaciones con monitorizaciones.`

Both `select` arms survived the rewrite. The synthetic `1 de 1 conversaciones` case is
ungrammatical, but `truncated` is only true when a listing exceeded its 200-entry cap, so
`total=1` cannot reach this sentence; the French wave's `{shown, plural, …}` retype is an
option, not a requirement.

### Composed surfaces (the app's own composition, re-implemented from `schedules-copy.ts`)

`1 monitorización · próximo en 4m` · `2 monitorizaciones · próximo en 4m` ·
`1 monitorización · vencido hace 2h` · section headers `Monitors · 1 monitorización activa`,
`Monitors · 5 monitorizaciones activas`, `Monitors · 1 de 40 requiere atención`,
`Wakes · 5 despertares programados`.

(The `Monitors ·`/`Wakes ·` prefixes are hardcoded English in `schedules.tsx` — pre-existing,
keyed elsewhere in the programme, **out of scope for this catalogue audit** and noted here only
so the composed line is read as the user reads it.)

---

## 4. Fit — measured, not assumed

No `maxCells`/`maxChars` hint exists anywhere in this namespace's sidecar (the two namespaces
that carry one are `relay.health` and `mobile.session_health`), so there is no declared budget
to exceed; the measurement below is against the real layout instead.

**Method.** Advance widths in San Francisco (`SFNS.ttf`, the iOS face) at the design kit's own
sizes/weights (`text-meta` 12/500, `text-mono-label` 11/600 + 0.06 em, `text-body-sm` 14/400),
against the content width the screen gives them: 320 pt device — the rubric's smallest,
`docs/ux/audit-rubric.md` — minus the screen's `px-4` (32 pt) = **288 pt**, minus the rows'
`pl-3` (12 pt) = 276 pt, at 100 % and 200 % text. **What I could not do: capture a rendered
frame.** No simulator, no screenshot; these are font-metric widths (±a few percent), so the
thresholds below are estimates, and the one tight margin is flagged as such.

**Clipping is impossible in this namespace, and that is a source fact, not a metric**: nothing
here is clamped to one line — `numberOfLines` appears in `schedules.tsx` only on the entry
*name*, and `SectionHeader`, `Alert`, `EmptyState` and `Button` (no `labelLines` at these call
sites) all wrap. The widest single token, `MONITORIZACIONES` at 200 %, is 232 pt against 276 pt.

| line | en | es round 1 | es now | verdict at 100 % |
|---|---|---|---|---|
| `MONITORS · 5 MONITORIZACIONES ACTIVAS` (11 pt, tracking) | 133.2 pt | 232.1 pt | **277.8 pt of 288** | fits, **10 pt / 3.5 % to spare** — inside this method's error band |
| `MONITORS · 1 MONITORIZACIÓN ACTIVA` | 131.2 | 205.2 | 250.8 | fits with 37 pt |
| `MONITORS · 1 DE 40 REQUIERE ATENCIÓN` | 238.1 | 265.8 | 257.1 | fits |
| entry head `2 monitorizaciones · próximo en 4m` | 138.0 | 173.0 | 215.0 | fits (one line) |
| `Mostrar menos monitorizaciones` (button) | 131.0 | 158.0 | 200.0 | fits one line at 100 %; **2 lines at 200 %** (345 pt of 288) — round 1's `Mostrar menos monitores` fitted (271 pt) |
| `Mostrar 3 monitorizaciones más` | 137.0 | 153.0 | 195.0 | fits at 100 %; 2 lines at 200 % |
| `No hay monitorizaciones activas.` | 128.0 | 180.0 | 219.0 | fits at 100 %; 3 lines at 200 % (was 2) |
| `Ya no está — … nada la comprueba` | 436.0 | 537.0 | 515.0 | 2 lines at 100 % (same as en), 4 at 200 % |
| `Mostrando 200 de 500 … monitorizaciones.` | 301.0 | 331.0 | 373.0 | 2 lines (same as en), 3 at 200 % |
| `No se pudieron leer las monitorizaciones…` | 292.0 | 312.0 | 353.0 | 2 lines (same as en), 3 at 200 % |
| `empty.body` | 1196 | 1392 | 1438 | 6 lines at 100 % (en 5), 11 at 200 % (en 9) |
| monitor facts row (slot + cadence + tail, `flex-wrap`) | 189.0 | 222.0 | 211.0 | 1 line at 100 % (276 pt available) |

So: **nothing overflows and nothing clips**; the noun change costs +21 % to +28 % on the
lines that carry it (that is the price of the glossary noun, and it is inside the style
guide's 15–25 % growth expectation except on those four short labels). Two places change
shape at 200 % text (button label, empty line) and one header ends up near its limit at
100 %. At 3-digit monitor counts the armed header crosses 288 pt and wraps (measured:
99 → 287.4 pt, one line; 100 → 293.1 pt, two lines); the listing caps at 200 monitors, so
that is reachable but rare. I am **not** asking for a change
here — a header that wraps, on a screen whose other lines already wrap, is not a defect — but if the
design owner wants the header at one line, the elided form used by the French wave,
`{count, plural, one {# activa} many {# de activas} other {# activas}}`, measures 146.5 pt
and reads `Monitors · 5 activas`; it trades the noun for a dependency on an untranslated
prefix, which is why I am not recommending it as a finding.

---

## 5. Does `monitorización` read naturally where it now appears?

Judged sentence by sentence, as a native reader, against the glossary row (`monitor` →
`monitorización`, binding) and core's committed es (`wire.settings.monitor.title` =
"Monitorizaciones", `monitor_maxconsecutivefailures.help` = "…antes de desactivar una
monitorización"), which is what makes the noun an established *object* and not only an
activity:

| sentence | judgement |
|---|---|
| `2 monitorizaciones` / `1 monitorización activa` | natural as programme vocabulary, exactly like core's "una monitorización" |
| `No hay monitorizaciones activas.` | natural |
| `No se pudieron leer las monitorizaciones de esta máquina.` | natural |
| `En pausa — las monitorizaciones se reanudan cuando su conversación vuelva a ejecutarse` | natural; subjunctive correct |
| `Mostrar menos monitorizaciones` / `Mostrar 3 monitorizaciones más` | grammatical, slightly heavy, acceptable |
| `Mostrando N de M conversaciones con monitorizaciones.` | grammatical, a shade abstract ("with monitoring") — the English is no better |
| `…las monitorizaciones vigilan una cosa y avisan de lo que cambia.` | the one place the abstract noun strains: an *activity* noun is made the subject of a concrete verb in the plural. Understandable, but `cada monitorización vigila…` would be the natural Spanish distributive — ES-SCH-8, NIT |
| `así que nada la comprueba` | `la` must reach `monitorización`; the nearest feminine noun is `conversación`, so the pronoun is mildly ambiguous at first read. Meaning survives; recorded, not raised |

I did **not** re-open the glossary decision itself: core ships the noun as a countable
object, the French wave did the same for `surveillance`, and a catalogue that follows the
binding row is what ES-SCH-1 asked for. What I checked instead is whether the chosen noun
breaks anything *downstream* of it — the feminine gender cascade, the count renderings, and
the widths above.

One cascade I checked and dismissed: `Activas` (header) sits above rows whose dormant state
word is `inactiva`, which would read as a contradiction. It is not reachable — `monitorLineView`
suppresses the slot on a dormant or ghost *entry*, and the live fixture
(`fixtures/relay/http/schedules-populated.json`) pairs the only `dormant` row with
`entry.dormant: true`, so `inactiva` never renders under an armed header. Worth remembering
if a future store ever marks a row dormant inside a live entry.

---

## 6. Findings

### ES-SCH-6 (MAJOR, new) — `state.stale` is now feminine but labels a masculine noun

- **Key:** `mobile.schedules.state.stale` — **current:** `obsoleta` (round 1: `obsoleto`, recorded clean).
- **Problem:** this is the one *wake-side* state word, and it was swept into the feminine pass made
  for `monitorización`. `wakeDueWord` (`schedules-copy.ts`) renders it into the due slot of a
  **wake** row — message, then `obsoleta · cada 1d` under a section header that reads
  `Wakes · 5 despertares programados`. Nothing feminine is in scope in that slot, so the word is
  simply ungrammatical, and it disagrees with the masculine `despertar` used by every other
  wake string in the same file (`No hay despertares programados`, `los despertares se reanudan`,
  `nada lo dispara`). Core's committed es uses the masculine for the same concept
  (`tui.review.lane_stale` = "obsoleto"). A census of the file (`audit.log` §10, run over all 38
  values) tags **27** with a gender-marked token: 10 masculine-only (every wake-side string),
  3 naming both families, and 14 feminine-only. Of those 14, eleven are monitors-side
  (`monitorización` is feminine), `cadence.once` is `una vez` (an idiom, not agreement) and
  `read_unreachable` quotes `las programaciones` (unchanged) — so **`state.stale` is the only
  feminine word in the file that labels a wake**, and it is a regression from text this programme
  already approved.
- **Exact replacement:** `obsoleto`
- **Why MAJOR, not BLOCKER:** the meaning ("stale") still lands; the defect is agreement, visible
  on a normal-path row, and it makes the file contradict itself.

### ES-SCH-7 (MINOR, new) — `gone.*` says `ya no está` twice in one line

- **Keys:** `gone.monitors`, `gone.wakes` — **current:** `Ya no está — su conversación ya no está en esta máquina, así que nada la comprueba` / `… nada lo dispara`
- **Problem:** the new status word and the untouched clause now share the same verb phrase eight
  words apart. Round-1 ES-SCH-4 asked for `Ya no está —` and offered `ya no existe` for the second
  clause; only the first half landed. Meaning is intact, the line just reads as a stutter.
- **Exact replacement:**
  - `gone.monitors` → `Ya no está — su conversación ya no existe en esta máquina, así que nada la comprueba`
  - `gone.wakes` → `Ya no está — su conversación ya no existe en esta máquina, así que nada lo dispara`

### ES-SCH-8 (NIT, new) — `empty.body` makes an activity noun the plural subject

- **Key:** `mobile.schedules.empty.body` — **current:** `…; las monitorizaciones vigilan una cosa y avisan de lo que cambia.`
- **Problem:** `monitorización` denotes the activity; making it the plural subject of `vigilar` with
  a distributive `una cosa` is understood but not how a Spanish speaker would phrase the class.
  Register only — nothing unsafe, and the rest of the sentence is good.
- **Exact replacement:** `…; cada monitorización vigila una cosa y avisa de lo que cambia.` (rest of the value unchanged)

### Round-1 findings — disposition on the current bytes

| id | round-1 severity | disposition | evidence |
|---|---|---|---|
| ES-SCH-1 `monitor` → `monitorización` | major | **closed** — all 13 keys moved, with the feminine agreement fixed (`activas`, `la comprueba`, `las monitorizaciones`) | this report §1 (diff) and §3 (renders) |
| ES-SCH-2 verb agreement at `broken=1` | major | **closed** — plural retype on `{broken}`, `{total}` kept in all three arms, `1 de 40 requiere atención` | this report §2 and §3 |
| ES-SCH-3 `armado/armados` | minor | **closed** — `No hay nada activo`, `No hay monitorizaciones activas.`, `# monitorización activa` | this report §1 |
| ES-SCH-4 `Desaparecido` as a status | nit | **closed for the word, half-applied for the clause** → ES-SCH-7 | this report §1 |
| ES-SCH-5 `tail.failed` counts an adjective | nit | **closed** — `1 fallo / 2 fallos / 1000000 de fallos` | this report §3 |

---

## 7. Second pass (high-visibility group)

This auditor re-read all 38 values, then re-read the 18 changed ones a second time against the
English, the context sidecar and the composer in `schedules-copy.ts`, and separately walked the
20 unchanged values for sign/inflection damage from the neighbours that did change (the wake-side
strings stayed correctly masculine; `state.waiting` is invariant; `truncated`'s `wakes` arm is
untouched). The second pass is what produced ES-SCH-6: the first read of `state.stale` looks
plausible in isolation — the error only appears when the row it lands in is read as a wake row.

---

## 8. Recording

- **No audit-ledger command exists to run.** This repository has no `i18n/ledger.json` and no
  ledger/receipt command under `scripts/i18n/` (`audit.log` §9: `ls` exit 1, `grep` exit 1, and
  the declared i18n scripts are only `i18n:generate`, `i18n:catalogue:check`,
  `i18n:strings:check`, `i18n:check`). The RFC's ledger row is therefore **proposed and
  explicitly unwritten** inside `record.json`, with its ≤280-character note; this bundle is the
  artifact of record, as `docs/i18n.md` prescribes ("the pull request records that report").
- **Read-only.** No source, catalogue or `git` state was modified by this audit. The bundle was
  written untracked and **not staged or committed**; `git status` shows only evidence directories.
  The round-1 bundle `es29b3` is preserved exactly as it was.

## 9. Limits

- No native-speaker human review: this is an LLM auditor's judgement, in one locale, by one session.
- No rendered frame: widths are font-metric estimates, no pixels were captured; the 3.5 % margin
  on the armed header is an estimate, and a real capture at `narrow` width would settle it.
- Model identity is not diverse from round 1 (both served `radient/auto`).
- The round-1 bytes are quoted from the round-1 bundle's tables; they cannot be re-derived from git.
- Nothing here checks the **untranslated** `Monitors ·`/`Wakes ·` section prefixes or the screen
  title: they are hardcoded English in `schedules.tsx`, owned by the strings programme, not by this
  catalogue.
