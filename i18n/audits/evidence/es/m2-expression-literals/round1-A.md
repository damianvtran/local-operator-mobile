# Independent translation audit — `es` (slice M2, lane A)

**Verdict: `changes_requested`** — 0 BLOCKER, 1 MAJOR, 3 MINOR, 2 NIT.

| | |
|---|---|
| Locale | `es` (neutral Spanish, **tú**, sentence case) |
| Slice | M2 / native phone-app expression literals, 27 keys across `mobile.settings.*`, `mobile.computers.*`, `mobile.session.*` |
| Candidate | `…/3ef6295a5545/scratchpad/m2-prep/es.v1.json` (translator `openai/gpt-6.1-sol` — different session) |
| Auditor | `i18n-auditor` (independent; did not translate; cannot edit the candidate) |
| Session | `7df96d3445f1` |
| ACTUAL served model | `deepseek/deepseek-flash` — as reported by this run's harness session header (`Model: deepseek/deepseek-flash`). No model switch was requested or applied by me; disclosing it because it is not the machine-default tier recorded elsewhere. |
| Independent of translator | yes — separate session, no access to the translator's reasoning; only its output file |
| No MT / back-translation | yes — reasoning only; no translation API, SDK or service was called |

## Inputs (read-only) and hashes

| Part | Path | sha256 |
|---|---|---|
| English + context (sidecar) | `…/m2-prep/keys27.json` | `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e` |
| Target `es` (candidate) | `…/m2-prep/es.v1.json` | `b73f8235ab54305a44223355e8770df4da6acc2f461bc575c054b781418ebf3c` |
| M1 reference (audited) | `…/m1-prep/es.v2.json` | `6343895cf6b072db39fbfae8df37400e0e559db8a0f537ecdc3c5da14958d65e` |
| Style guide | `~/local-operator/i18n/style-guides/es.md` | `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e` |
| Glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Shipped `es` catalogue, `mobile.settings` | `…/i18n/catalogues/es/mobile.settings.json` | `e3f37ea8189791521a016af88ee586a7b71530e0ee3c63516bfc105825de22f8` |
| Wiring under audit | `feat/i18n-app-scan-expression-literals` @ `b6b890e0` | — |

## 1. Mechanical — PASS

Ran `node --experimental-strip-types m2-es-check.mjs` (audio-free, read-only) which imports the **shipping** parser/formatter `src/i18n/messages.ts` (`parseMessage`, `formatMessage`, `pluralCategory`) — the same grammar the app renders with, not a reimplementation.

| Check | Result |
|---|---|
| Valid JSON | yes (both files parsed) |
| Key set | 27/27, no keys added or dropped |
| Key order | identical to the sidecar, index by index |
| Placeholders (name **and** kind) | identical for all 7 keys that have any (`{baseUrl}`, `{host}`, `{labels}`, `{name}`, `{percent}` ×4); sidecar `placeholders` == parsed args for every key |
| ICU parse | all 27 parse; no message in this slice uses `plural`/`select`, so there are no CLDR arms to check (asserted anyway: `pluralCategory("es", …)` → 0/2/5/11/1500000 = `other`, 1 = `one`, 1000000 = `many`; no `few` in reach) |
| Empties / whitespace | none, no leading or trailing space |
| English left behind | exactly one English-identical value: `mobile.settings.account.app_name` = `Local Operator` — deliberate product name (§1) |
| Punctuation / glyph parity | middle dot `·`, arrows `↑ ↓`, `%`, parentheses all preserved per key |
| NFC | all values NFC |
| Bidi controls | none |

Renders (actual output of the shipping formatter):
`Conexión directa con https://omp.damiantran.me` · `Esperando a que tu máquina en mac-mini.local responda. …` · `trazas · herramientas abajo · desplazar ↓` · `45% de contexto` · `45% cont.` · `45% de contexto (est.)` · `45% cont. (est.)` · `Conectado a tu máquina.` · `Conectado a Mac mini de Damian.`

## 2. Findings

### MAJOR

**M2-es-01 · `mobile.settings.status.no_connection` — "Sin conexión"**
Two distinct states now carry one word. `statusFor()` in `settings.tsx` returns this key when **no computer is chosen** (`!routed`) and `status.offline` — also "Sin conexión" — when the chosen computer's **stream is down**; `mobile.settings.diagnostics.stream_offline` adds a third "sin conexión". English keeps them apart ("No connection yet" / "Offline"), and the "yet" (nothing chosen, a connection is expected) is dropped entirely. A reader of the Status row cannot tell whether to pick a computer or wait for one to come back.
Suggested: **"Aún sin conexión"**. Fits: the pill wraps rather than clips (`connection-pill.tsx`: `flexShrink: 1`, `minWidth: 0`, and its own offline message is a 40-character sentence), and the account-card route line is `numberOfLines={1}` with ellipsize on a line that already carries "A través de tu túnel de Radient" (32 cells).

### MINOR

**M2-es-02 · `mobile.session.tray.context_short` / `…context_short_estimate` — "cont."**
"cont." resolves in Spanish to *contenido* / *continuación* before *contexto*; the tray gives no disambiguating context (mono strip: `45% cont.` beside a cost figure). It is also +2 cells over English in the *exact* band the short form exists to protect — the call site records that the full word wraps the `<340 pt` band to two lines and the cost then floats between them. Spanish has no settled short form for *contexto*, so the guide's "use the language's own short form or the full word if none exists" lands on the borrowed one.
Suggested: **"{percent}% ctx"** and **"{percent}% ctx (est.)"** — width parity with English, unambiguous to a Spanish dev reader.
(If the manager prefers full words despite the wrap, "contexto" is the alternative; "cont." is the only option that is both ambiguous and wider than English.)

**M2-es-03 · `mobile.session.tray.context_estimate` / `…context_short_estimate` — "(est.)"**
An English calque. Spanish abbreviates an approximate or estimated figure as `aprox.`; `est.` has no such reading (it is read as *estación* / *este*). Appears in two visible tray facts.
Suggested: **"(aprox.)"** in both — `45% de contexto (aprox.)`, `45% ctx (aprox.)`. It costs 3 cells in the narrow form; if that band cannot take it, record "(est.)" as a width exception and keep the pair uniform rather than mixing `aprox.` with `est.`.

**M2-es-04 · `mobile.computers.wait.host_answering` — word order**
"Esperando a que tu máquina en {host} responda." is grammatical but heavy: the subject carries its locative modifier before the verb.
Suggested: **"Esperando a que responda tu máquina en {host}."** — everything after it is good and should stay ("Que una ruta esté configurada no significa que la máquina esté en marcha.").

### NIT

**M2-es-05 · `mobile.settings.account.route_direct` — "Conexión directa con {baseUrl}"**
"con" is admissible, but the settled collocation for an address/destination is "a".
Suggested: **"Conexión directa a {baseUrl}"**.

**M2-es-06 · `mobile.session.video.title_fallback` — "Vídeo"**
"Vídeo" is the Spain spelling; the guide asks for neutral Spanish and the RAE-preferred/American form is "video". **Do not change this key in isolation**: the shipped catalogue already ships "Reproducir vídeo" in `mobile.session.highlights.video_open`, so keeping "Vídeo" here is the consistent choice. Catalogue-level call for the manager, not a fix for this slice.

## 3. Verified correct (no finding)

- **`connected_to` + `fallback_name` as a pair** — "Conectado a {name}." with "tu máquina" → "Conectado a tu máquina." and with a real name → "Conectado a Mac mini de Damian." No article or case break, final full stop kept, participle agrees with the phone/user state rather than any noun phrase the key may hold.
- **`máquina` for "computer"** — matches the M1 round-2 decision (audit B's MAJOR: *equipo* = team), and matches shipped usage (49 occurrences of *máquina* vs 7 Spain-flavoured *ordenador*). This slice adds nothing to the split.
- **`status.not_answering` "No responde"** — byte-identical to the shipped relay wording `relay.chrome.session.subtitle.not_answering`, exactly as the key note requires.
- **`status.not_connected` "Desconectado"** — better row-value copy than the shipped "no conectado" / "sin conectar" fragments; keeping it, but note the catalogue now renders "not connected" three ways (catalogue-level tidy-up, not a change to this slice).
- **Diagnostics tokens** — all five lower-case per note, masculine agreement with the shipped row label "Flujo" ("Flujo: activo"); the pill labels stay capitalised, so tokens and labels are not confused. "degradado" reads as the settled Spanish technical sense (*servicio degradado*), not as a colour gradient, in the value position of a label/value row.
- **Tone / register** — tú throughout, no *usted*, no *vosotros*; infinitive action cues ("desplazar"); sentence case; no "!"; no ¿…? needed because no string in the slice is a question; `Local Operator` / `Radient` kept Latin.
- **Terseness** — every status value is a word or two, appropriate for the Status row value and the pill; the longest ("Aún sin conexión") still sits well inside the pill's documented wrap behaviour.

## 4. Second independent pass (high-visibility: settings + status)

Settings/status is the high-visibility group, so I re-derived all 27 strings from the English alone after finishing pass 1, without consulting the candidate. Result: no new findings, and no finding dropped. Two things changed on the second pass only in emphasis — M2-es-01 is confirmed (the collision is in `statusFor()`'s own branches, not a hypothesis about layout), and M2-es-06 is downgraded from a would-be MINOR to a NIT because the shipped precedent, not neutrality, decides it.

## 5. Note for the manager

- The M2 branch `feat/i18n-app-scan-expression-literals` @ `b6b890e0` still carries the **English** values for all 27 keys in `catalogues/es/` (verified with `git show`); this candidate has not been applied yet, so nothing here contradicts what the branch ships today.
- No repo or ledger change was made by me. Evidence for this round lives in my scratchpad (`audit-m2-es-A.md`, `audit-m2-es-A.record.json`, `audit-m2-es-A.log`) rather than `i18n/audits/evidence/es/…`, because the candidate is not in the repo yet; the record is built to be committed verbatim once the `es` values land.
- Decision needed from the manager, not from me: M2-es-02's "ctx" (borrowed abbreviation) vs "contexto" (wrap), and M2-es-06's catalogue-wide *vídeo/video* standard.
