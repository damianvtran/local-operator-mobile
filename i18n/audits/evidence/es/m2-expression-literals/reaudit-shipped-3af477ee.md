# es — M2 expression-literal slice: independent re-audit (round 3, shipped bytes)

**Verdict: `clean-with-findings`** — 0 BLOCKER · 0 MAJOR · 1 MINOR · 2 NIT.

| | |
|---|---|
| Locale | `es` — neutral Spanish, **tú**, sentence case |
| Namespace | `m2-expression-literals` = `mobile.computers` (4) + `mobile.session` (15) + `mobile.settings` (14) = 33 keys |
| Auditor | `i18n-auditor` — fresh instance; independent of the translator; READ-ONLY (no edits, commits or pushes) |
| Session | `1d9002189b44` (team `lopdev`) |
| ACTUAL served model | `deepseek/deepseek-flash` — this run's session header. No switch, no fallback. |
| Method | own reasoning + the repo's shipping parser (`src/i18n/messages.ts`) + repo validator; **no** translation API / SDK / MT service, no back-translation |
| Worktree | `~/local-operator-mobile/.worktrees/i18n-m2-scanner` @ `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a` (PR #236) |
| Baseline for "the 33" | `fa2bc5e0..HEAD` — added 33, removed 0, key set identical to the en additions |

## 1. Mechanical — PASS

`npm run i18n:check` (actual output):

```text
src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
scanner sha256: base=cf05770f... head=802c9921...
check-strings: 212 finding(s), all baselined; 0 new; verified historical debt vs fa2bc5e0b5f7
```

Own checker (`m2-es-reaudit-check.mjs`) imports the **shipping** `parseMessage` / `formatMessage` / `pluralCategory`, not a reimplementation:

- 33/33 keys present, no keys added/dropped, valid JSON, no edge whitespace, all NFC, no bidi controls, no stray braces.
- Placeholders identical to English in name **and** kind for all 7 keys that carry any (`{percent}` ×4, `{name}` ×2, `{labels}`, `{host}`, `{baseUrl}` — all `text`).
- No `plural`/`select` in this slice (en or es), so no CLDR arms to verify; asserted anyway via `pluralCategory("es", n)`: 1 → `one`; 10⁶, 2·10⁶ → `many`; 0, 2, 5, 11, 100, 1.5·10⁶ → `other`; `few` unreachable (matches the es guide).
- No markup/Rich tags, backticks, commands or identifiers inside the 33 values (the only Latin tokens are the product name `Radient`, host names via `{host}`, and `{baseUrl}`).
- **Negative control (checker bites):** 5 in-memory mutations, all **CAUGHT** — broken placeholder name (`{pct}`), dropped placeholder, malformed ICU (`{`), added `plural` arm (argument-kind mismatch), trailing space.

## 2. Are these the bytes the last round read?

- Shipped es values == `i18n/audits/evidence/es/m2-expression-literals/final.json`, **33/33 keys, zero value differences** (sha256 of final.json `7141a06f…4388`, sorted-key JSON of the 33 shipped pairs `ecaca715…9417`).
- The last round, `round2.md` (auditor `anthropic/claude-sonnet-5-5`, sha256 `e6a2d9a2…2e6c`), read `es.v3.json` (`a302af3d…967f`) and quoted its values and its **pre-rename** key names (`region.label.working` …). Each of the 15 values/forms that report names as the v3 state (`Conectado directamente a {baseUrl}`, `Aún sin conexión`, `No conectado`, `No responde`, `{percent}% ctx`, `(aprox.)`, `Volver a {name}`, `Volver a la sesión`, `sesión`, and the four band labels `actividad`/`agentes`/`tareas`/`estado`) is present byte-identically in the shipped bytes.
- So the only text no auditor read is the **four key names**, not any value. I verified those against the English source, the en sidecars and the call sites (§4). No unaudited new value text exists.
- Caveat, stated honestly: `es.v3.json` is not in the repo, so "v3 + rename = final" is corroborated by the round-2 report's own quotations, not by re-hashing v3.

## 3. Findings

### MINOR

**M2-es-R3-01 · `mobile.settings.diagnostics.stream_degraded` = `No responde`**
Sidecar: *"Lower-case diagnostic word, shown in a monospace line; one word, no final full stop."* This is the only capitalised and only two-word value of the five in that label/value row (`inactivo` / `conectando` / `activo` / **No responde** / `sin conexión`), so the row reads inconsistently. It also collapses English's deliberate distinction (`degraded` in Diagnostics vs `Not answering` in the status pill — both `No responde` here). Same finding as round 2's `m1`, still shipped.
Suggested: **`no responde`** (keeps the wording, obeys the row's casing rule). Does not gate.

### NIT

**n1 · `mobile.session.video.title_fallback` = `Vídeo`** — the es guide asks for wording that reads the same in Madrid and Mexico City; `vídeo` is the Spain spelling (LatAm `video`, RAE-preferred). Shipped mobile copy already uses `vídeo` once (`mobile.session.highlights.video_open`), so keeping it is the consistent call — a catalogue-wide decision, not a fix here.

**n2 · `mobile.session.region.label_working` = `actividad`** — the same band is `línea de trabajo` in the shipped tray hint (`mobile.session.status_tray.hint`: *"Abre la línea de trabajo, las tareas y los subagentes"*). This mirrors English's own split (`activity` label vs `working line` in the hint), so it is faithful, not a deviation; flagged only in case the manager wants one band name.

## 4. Renamed region-label keys — verified

| Key (shipped) | en source | sidecar key | call site |
|---|---|---|---|
| `mobile.session.region.label_working` | `activity` | present | `app/(app)/session/[id].tsx:1100` |
| `mobile.session.region.label_subagents` | `agents` | present | `:1101` |
| `mobile.session.region.label_todos` | `tasks` | present | `:1102` |
| `mobile.session.region.label_strip` | `status` | present | `:1103` |

No `region.label.<x>` spelling survives anywhere in `src/i18n/catalogues/en/` or `app/`; each value is attached to the right English source; the four values read correctly inside `{labels} abajo · desplazar ↓` (rendered: `actividad · agentes · tareas · estado abajo · desplazar ↓`).

Also verified from source, not claimed as rendered: `src/features/session/back-label.ts` now routes unnamed parents to `back_to_session`, so the shipped `fallback_name` = `sesión` can never compose into `Volver a sesión`; it only appears alone as a header title. `back_to` → `Volver a Mac mini de Damian` is grammatical.

## 5. Meaning / register / terminology review (all 33)

Accuracy: no omission, addition, negation or polarity error found. Safest texts audited: `not_signed_in`, `not_connected`, `offline`, `no_connection`, `stream_*`, `host_answering` (the "a provisioned route is not a machine that is up" second sentence is fully carried: *"Que una ruta esté configurada no significa que la máquina esté en marcha."*). `máquina` matches the catalogue-dominant noun (46 vs 7 `ordenador`); `relé`/`túnel` match shipped `Relé directo`/`Túnel de Radient`; `sesión`, `subagente`, `tareas` follow the glossary. Register: neutral, terse, no `!`, no Title Case, infinitive action labels (`desplazar`) per the es guide. Numerals: none hard-written; only `{percent}` interpolation. RTL: n/a.

**Named exceptions to "no English anywhere" (both justified, neither a finding):**
1. `mobile.settings.account.app_name` = `Local Operator` — product name; sidecar: *"Never translated."*
2. `mobile.session.tray.context_short` = `{percent}% ctx` — abbreviation identical in both languages, sanctioned by its sidecar ("use the language's own short form"), width-driven: the full `de contexto` wraps the `<340 pt` band. Recorded in the bundle manifest as IDENTICAL_BY_DESIGN. Nothing else in the 33 is English.

## 6. Provenance / hashes (sha256)

| Part | Path | sha256 |
|---|---|---|
| Target values (sorted-key JSON of the 33) | computed | `ecaca715387c48c447d1d98a6464337b4c25dd320ac8ee2a8116816978149417` |
| English source values (same) | computed | `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528` |
| es computers / session / settings | `src/i18n/catalogues/es/…` | `488e26a9…2070` / `464aa710…e8ea` / `c7c7a716…52d6` |
| en computers / session / settings | `src/i18n/catalogues/en/…` | `71382783…aff3` / `8df14a0d…16d3` / `d7e1d85b…e23d` |
| en context sidecars (computers/session/settings) | `src/i18n/catalogues/en/*.context.json` | `cc297300…37e0` / `a988f1c9…0ae5` / `67691ab9…4c12` |
| Audit target read by R2 | `es/m2-expression-literals/final.json` | `7141a06ff9921b541db5a9cd61af53a6da8aacb1347cb843199dcd4a3ff84388` |
| R2 report | `es/m2-expression-literals/round2.md` | `e6a2d9a2d65e7b030dd33199857b699517f00a00746c75864d6148b5d9cf2e6c` |

Ledger: `~/local-operator-mobile` carries no ledger file and no audit-ledger command (`i18n/audits/` holds `evidence/` only); per `docs/I18N.md` the PR records the report. I wrote nothing. Row the manager/ledger owner would record: locale `es`, namespace `m2-expression-literals`, status `passed` (no BLOCKER/MAJOR), auditor `i18n-auditor` / `deepseek/deepseek-flash` / session `1d9002189b44`, source hash `c326a93f…d3528`, 33 keys, note pointing at this report.

## 7. Provenance discrepancy for the manager

The bundle manifest `NOTE-m2-expression-literals.md` names the translator as `i18n-translator` / `openai/gpt-6.1-sol`; my brief names the translator as `anthropic/claude-sonnet-5-5`. My independence holds either way (fresh instance, different model, no access to any translator reasoning), but the two records disagree and one of them is wrong.
