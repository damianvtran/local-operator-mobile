# Independent translation audit — `ru` — mobile M2 expression literals — ROUND 2 (delta, final candidate v3)

**Audit id:** `m2-ru-r2` · **Date:** 2026-11-11 · **Locale:** `ru` · **Group:** M2 expression literals (33 keys)
**Auditor:** i18n-auditor (lopdev team), this session `38b309c987d5`.
**Actual served model:** `deepseek/deepseek-flash` — source: this run's harness session header (`Model: deepseek/deepseek-flash`). No role/model pin was set by me; **no fallback observed** in this session. Any later substitution on this lane must be disclosed against this line.
**Independence:** I did not translate these values and cannot edit them (repo, ledger and candidate untouched). No translation/MT service, dictionary, back-translation or LLM comparison was used — every judgement is my own reading of `ru`. Translator named by the manager: `openai/gpt-6.1-sol`; not this session.

## Inputs (sha256 of the exact bytes audited)

| Role | Path | sha256 |
|---|---|---|
| Source + context (authority for this round) | `…/m2-prep/keys33.json` | `f3a96f9a9d92cfdb7be5e981b02c3ad9be6bc15b0eba96e4967223ea85bc4a8f` |
| v1 (round-1 candidate) | `…/m2-prep/ru.v1.json` | `7103ca05ab8c6cf991d0794f035da6cfb206730408d9c57b34cb7c01e6ae743f` |
| **v3 (final candidate under audit)** | `…/m2-prep/ru.v3.json` | `759cb72414b0c4dad571f18e8c0b9ea8bb7320462b90af82c8c5b42aa0fa19bd` |
| Round-1 reports | `…/r1/audit-ru-A.md`, `…/r1/audit-ru-B.md` | `eb39f4ac…5ddf6`, `26c645f9…feac8` |
| Translator dispositions | `…/ru.v2-changes.md`, `…/ru.v3-changes.md` | `92958a6e…4f5bbe`, `c78a4b69…c532e` |

**Ground truth used beyond the sidecar (shipped evidence, read this round):**
`~/local-operator-mobile/.worktrees/i18n-app-scan` @ `b783c878` (catalogue validator) and branch
`feat/i18n-app-scan-expression-literals` @ `9d99fa0f` (en + ru catalogues, `catalogue.gen.ts`, call sites);
core `~/local-operator/local_operator/i18n/catalogues/ru` (40 files, 1 947 string messages);
mobile ru catalogue (22 files). Recounts below are mine, from `json.loads`, not from the translator's claims.

---

## 0. Diff v1 → v3 (python3, executed)

27 → 33 keys, **8 changed values, 6 added keys, 0 removed**, v3 order == keys33 order.
`v2 → v3`: **no value changed** (key 33 appended only), matching `ru.v3-changes.md`.

| # | Key | v1 | v3 |
|---|---|---|---|
| 1 | `mobile.settings.account.route_direct` | Прямое подключение к {baseUrl} | **Подключено напрямую к {baseUrl}** |
| 2 | `mobile.settings.status.no_connection` | Нет подключения | **Пока нет подключения** |
| 3 | `mobile.settings.diagnostics.stream_idle` | простой | **в простое** |
| 4 | `mobile.settings.diagnostics.stream_degraded` | не отвечает | **Не отвечает** |
| 5 | `mobile.settings.diagnostics.stream_offline` | отключён | **вне сети** |
| 6 | `mobile.computers.added.fallback_name` | вашему компьютеру | **ваш компьютер** |
| 7 | `mobile.computers.added.connected_to` | Выполнено подключение к {name}. | **Подключено: {name}.** |
| 8 | `mobile.session.region.more_below` | ниже есть ещё · прокрутить ↓ | **ещё ниже · прокрутить ↓** |
| +9 | `mobile.session.region.label.working` | — | активность |
| +10 | `mobile.session.region.label.subagents` | — | агенты |
| +11 | `mobile.session.region.label.todos` | — | задачи |
| +12 | `mobile.session.region.label.strip` | — | статус |
| +13 | `mobile.session.back_to` | — | Назад: {name} |
| +14 | `mobile.session.back_to_session` | — | Назад к сессии |

---

## 1. Mechanical pass — candidate clean; **4 key names do not exist in the app** (B-1)

- **Repo validator (executed, read-only):** `npm run -s i18n:catalogue:check` in the worktree →
  `src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`, exit 0, `git status --porcelain` empty. It validates the checkout, **not** the scratch candidate.
- **My own verification (executed) with the app's own parser** (`src/i18n/messages.ts` → `parseMessage` / `formatMessage`, script `verify-m2-ru-r2.mts`): 33/33 keys, order identical, **0 failures**, 1 note.
  - placeholder names **and kinds** identical to English on every key that has one: `{baseUrl}`, `{host}`, `{name}`, `{percent}`, `{labels}` — all `text`; renders with sample args did not throw:
    `Подключено напрямую к 100.64.0.7:8787` · `Ожидание ответа компьютера по адресу damian-mbp.radient.dev. Настроенный маршрут ещё не означает, что компьютер работает.` · `Подключено: План релиза.` · `42% контекста` · `42% конт. (прибл.)` · `ниже: задачи · агенты · прокрутить ↓` · `Назад: План релиза` · `Назад к сессии`.
  - **ICU:** this slice contains **no** plural/select message (verified: no `plural`/`select` in any English value), so no CLDR category set is owed.
  - empties 0 · NFC clean · no leading/trailing or double spaces · no bidi/format controls · glyph counts for `· ↑ ↓ % ( )` equal to English on every key · no Latin/Cyrillic homoglyph inside a kept-Latin token (`Radient`, `Local Operator` are pure Latin; no mixed-script tokens) · no quotes.
  - **English-identical:** `mobile.settings.account.app_name` = `Local Operator` only (deliberate).
  - Final-punctuation parity: matches English on all keys; the one mismatch is `context_short` `{percent}% конт.` — an abbreviation dot, not a sentence stop (correct for a Russian contraction).
- **BLOCKER B-1 — 4 keys are keyed against names the app does not use.**
  Candidate/sidecar: `mobile.session.region.label.working|label.subagents|label.todos|label.strip`.
  Every real surface uses the **underscore leaf**: en `mobile.session.json` + `mobile.session.context.json`,
  `catalogue.gen.ts:382-385`, `catalogues.test.ts:416-419`, `expression-literals.test.ts:109`
  (`en(\`mobile.session.region.label_${k}\`)`) and the live call site `t("mobile.session.region.label_working")`
  (`app/(app)/session/[id].tsx:1100-1103`). The ru catalogue on that branch already carries the four
  English stubs under the underscore names (`mobile.session.json:58-61`). A repo-wide search of every local
  and remote branch found the nested form **nowhere**. Consequence: the four translated values are computed
  but never looked up — `{labels}` would keep rendering English, i.e. exactly the W1 gap this slice exists to
  close — and regeneration rejects four keys that do not exist in en. **Origin: the source sidecar
  (`keys33.json`), not the translation**; the candidate is faithful to what it was given. Fix = rename the
  four keys (values unchanged) in the sidecar and the candidate; no re-translation and no new linguistic round.

---

## 2. Adjudication of every round-1 finding (both reports) against v3

Recounts are mine (`json.loads`, this round): core ru `relay.chrome.session.subtitle.not_answering` = `Не отвечает`, `...subtitle.idle` = `Простой`, `relay.health.live` = `В сети`; mobile ru `badge.connecting` = `подключается`, `badge.active` = `активен`, `schedules.state.disabled` = `отключён`, `diagnostics.route_direct` = `Напрямую к ретранслятору`, `composer.row_usage` = `Контекст`, `highlights.video_open` = `Воспроизвести видео {name}`, `drawer.agents` = `Агенты`, `tray.tasks` = `Задачи {done}/{total}`, `session.sheet_title.status` = `Задачи и агенты`, `settings.account.signed_in` = `Вход выполнен`. No `конт.` and no `в простое` exists in either catalogue.

| # | Round-1 finding (auditor) | v3 value | Verdict | My reason |
|---|---|---|---|---|
| 1 | A **M-1** (MINOR) `connected_to` chancery + dative hazard | `Подключено: {name}.` + `ваш компьютер` | **fixed correctly** | Colon frame takes the nominative, so the pair reads with both: `Подключено: ваш компьютер.` / `Подключено: MacBook Pro.` / `Подключено: Домашний компьютер.` — the Cyrillic-name declension hazard A documented (`…к Ноутбук.`) is gone, not just reworded. Code confirms `{name}` = `appeared?.name ?? fallback` (`computers.tsx:638`). Terser than v1 and native. |
| 2 | A **M-2** (MINOR) `stream_degraded` duplicates `status.not_answering` | `Не отвечает` | **declined: substantially upheld, residual MINOR** | The sidecar's own note for this key defines the state as "the stream is open but not answering", so reusing the shipped relay wording is faithful and **not** a meaning error — I do not restore A's severity. Residual (Mn-1): English keeps two words (`degraded` vs `Not answering`) and the screen paints both rows, so the diagnostic row adds nothing; and the capital breaks an all-lower-case column. |
| 3 | A **M-3** (MINOR) `stream_idle` = `простой` reads as the adjective | `в простое` | **fixed correctly** | `Поток: в простое` is unambiguous and keeps the shipped noun `Простой`. Grammatically the state label needs the **prepositional** `в простое`; the guide's recorded «в простой» is the accusative, correct only inside a verb frame (shipped `…участник уйдёт в простой`, `wire.settings.network_rollout_on_update.help`). Candidate correct; guide entry wants refining (Mn-3). |
| 4 | A **M-4** (MINOR) `route_direct` parallelism + fit | `Подключено напрямую к {baseUrl}` | **overturned (no defect remains)** | English is itself asymmetric here (`Through your Radient tunnel` vs `Connected directly to {baseUrl}`), so mirroring it is the faithful reading, and the predicate is what the account line asserts. Fit: prefix is 22 cells, exactly English's 22 (parity; measured, not rendered). |
| 5 | A **M-5** / B **F4** (MINOR) `more_below` dangling fragment | `ещё ниже · прокрутить ↓` | **fixed correctly** | Terse, parallel with `ниже: {labels} · прокрутить ↓`, keeps `·` and `↓`. |
| 6 | A **N-1** / B **F5** (NIT/MINOR) `конт.` is not a standard abbreviation | `{percent}% конт.` / `{percent}% конт. (прибл.)` | **declined: upheld, residual MINOR** | B's premise ("the gain is small") is wrong: 14→10 and 23→19 cells, a real 4-cell saving, and the wide word is what forces the two-line wrap under 340 pt (`session/[id].tsx:131-136`, D17). But the contraction is not native copy and reads as `контент` at first glance. Mn-2. |
| 7 | A **N-2** / B **F1** (NIT/MINOR) `no_connection` drops "yet" | `Пока нет подключения` | **fixed correctly** | Restores "yet", stays a phrase not a sentence (+3 cells over en), and stays distinct from `Вне сети` / `Не подключён`. |
| 8 | A **N-3** / B **N4** (NIT) `Настроенный маршрут` for "provisioned" | unchanged | **declined: upheld** | The sentence's point (a listed route ≠ a machine that is up) survives intact; `выделенный` would add a resource-allocation nuance the source does not have. No defect. |
| 9 | B **F2** (MINOR) `stream_offline` duplicated the "disabled" word | `вне сети` | **fixed correctly** | Pairs with status `Вне сети` and shipped live `В сети`, and releases `отключён` back to `disabled`. Lower case matches the column. |
| 10 | B **F3** (MINOR) same as A M-3 | `в простое` | **fixed correctly** | As above. |
| 11 | B **N1** (NIT) `connected_to` chancery | `Подключено: {name}.` | **fixed correctly** | As #1. |
| 12 | B **N2** (NIT) `route_direct` loses the "Connected" state | `Подключено напрямую к {baseUrl}` | **fixed correctly** | Predicate restored; en-length parity. |
| 13 | B **N3** (NIT) `(прибл.)` vs `(оценка)` | unchanged | **declined: upheld** | `прибл.` is the conventional Russian "approx."; `оценка` is a noun label and longer. Parentheses kept. |
| 14 | B **W1/W2** (wiring observations) | — | **out of translation scope, now closed by this slice** | W1: the four region keys exist and the call site builds `REGION_LABEL` from them. W2: `back-label.ts` splits the unnamed case into `back_to_session`, so `Назад к сессия` cannot be produced. Both verified in code this round. |

Disposition tally over the 13 report-level findings in the table (A's 8 + B's 9, minus the four pairs adjudicated together in their own rows — they are still counted here): **8 fixed correctly (rows 1, 3, 5, 7, 9, 10, 11, 12) · 3 declines upheld (6, 8, 13) · 1 decline partially upheld, residual MINOR (2) · 1 overturned, no defect remains (4)**, plus row 14's wiring notes, now closed by this slice. No round-1 finding was wrongly fixed, and no fix introduced a new defect.

---

## 3. Fresh judgement of every new or changed value

**Settings status / diagnostics (high-visibility group — I re-read all 13 settings values a second time, from the values alone, before reading my own first-pass notes):** polarity and referent survive everywhere; the column's implicit subject is `Поток` (masc.), which all five diagnostics values agree with (`подключается`, `активен`, `вне сети`, `в простое`, `Не отвечает`); the pill's values agree with `компьютер` (`Не подключён`, `Подключён`, `Не отвечает`, `Вне сети`), and `Вход в Radient не выполнен` mirrors shipped `Вход выполнен`. No softening, no added instructions, no impoliteness. Only findings: Mn-1 (capital) and Mn-2 (`конт.`).

- **`route_direct`** `Подключено напрямую к {baseUrl}` — accurate, terse, 22-cell prefix = en parity; the line is `numberOfLines={1}` tail-ellipsized, and the tail is the URL either way (not a regression).
- **`no_connection`** `Пока нет подключения` — correct; +3 cells over en in a pill that wraps (`connection-pill.tsx:104-117`: `max-w-full`, shrinking label, inline `maxWidth:100%`), so no clipping — advisory only for a 200 % render check.
- **`connected_to` + `fallback_name`** — nominative fallback in a colon frame: grammatical with the fallback and with a real name (including a Cyrillic one, which no longer has to be declined). Source note asks for a full sentence; the colon frame is a deliberate, justified departure and reads as a complete confirmation. Accepted.
- **`more_below`** `ещё ниже · прокрутить ↓` — correct, and genuinely narrower (23 vs v1's 28 cells).
- **Region labels** `активность · агенты · задачи · статус` — the right nouns, lower case per role, consistent with shipped `Агенты`/`Задачи`; composed: `ниже: активность · агенты · задачи · статус · прокрутить ↓` reads naturally, and the colon frame needs no shared case across the list. `статус` for the status strip is right. **Values accepted; their key names are B-1.**
- **`back_to`** `Назад: {name}` — a11y label only (`back-label.ts` → `accessibilityLabel` on the back `IconButton`), so there is no width budget. Reads with a real name and never receives the fallback (`back-label.ts` routes `null`/`undefined`/`""` to `back_to_session`), so `Назад: сессия` is no longer producible.
- **`back_to_session`** `Назад к сессии` — correct dative, natural, and matches the shipped back-label family (`Назад к беседам`, `mobile.common.back` = `Назад`). Uses the glossary term `сессия`.
- **`fallback_name`** `сессия` (revision check) — unchanged from v1/v2 and still right: lower-case nominative noun, correct as the untitled header title (`session/[id].tsx:680`, `agent/[jobId].tsx:70`).
- **Narrow context forms — genuinely narrower?** Yes, by measurement: wide 14 / narrow 10 cells (`100%`), wide estimate 23 / narrow estimate 19; every glyph is single-width Cyrillic or ASCII, no wide glyphs, no combining marks. The narrow form is 4 cells cheaper in both variants.
- **`video.title_fallback`** `Видео` — matches shipped `Воспроизвести видео`; heading case correct for Russian.

**Fit (character counts, not rendered geometry — no `maxCells`/`maxChars` is declared for any of these 33 keys):** ru is at or below English on 24 of 33 keys (0.85–1.00); the only growth worth a rendered look is the tray estimate pair (`…контекста (прибл.)` 25→29, `…конт. (прибл.)` 21→25) inside the band that D17 already measured as wrap-prone under 340 pt; the wide form only appears ≥340 pt, where the band has more room. **Advisory for QA's rendered pass, not a finding** — I cannot measure it and will not claim it.

---

## 4. The specific checks this round asked for

- **"Not answering" pair:** `status.not_answering` = `Не отвечает` is byte-identical to the shipped mobile **and core** `relay.chrome.session.subtitle.not_answering` — the sidecar's requirement is met. `stream_degraded` = `Не отвечает` is the same words twice on one screen (Mn-1); it is faithful to the degraded note's own description, so this is a polish item, not a meaning error.
- **`no_connection` vs `offline` distinctness:** three distinct states, three distinct words — `Пока нет подключения` (no computer chosen) / `Вне сети` (stream down) / `Не подключён` (refused). No collision with `вне сети` in the diagnostics column (case is en's own split, `Offline`/`offline`).
- **Safety of terse labels:** no destructive, permission or error text in this group; no imperative that could be misread as consent; `Не отвечает` / `вне сети` describe state only. Nothing here can mislead an irreversible action.
- **Placeholder order:** `below_labels` moves `{labels}` after `ниже:` (en leads with it). The placeholder is not renamed, and I checked the composition: the colon frame marks the list start and the cue's infinitive cannot be read as a fourth region noun. Deliberate and safe.

---

## Findings

### BLOCKER
**B-1 — four region-label keys carry names the app never looks up** (evidence in §1). Keys:
`mobile.session.region.label.working`, `.label.subagents`, `.label.todos`, `.label.strip`.
Problem: real key is `mobile.session.region.label_working` (underscore leaf) in en/ru catalogues, the context sidecar, `catalogue.gen.ts`, the tests and the call site. Values are fine; the names are not.
Fix: rename the four keys in `keys33.json` **and** `ru.v3.json` — no value change, no re-translation. Origin is the sidecar, not the translation.

### MINOR
**Mn-1 — `mobile.settings.diagnostics.stream_degraded`: `Не отвечает`**
Problem: the only capitalised value in an otherwise all-lower-case monospace column (`подключается`, `активен`, `в простое`, `вне сети`), and the source role says "lower-case diagnostic word". (The duplication with the Status pill is accepted — see §2 #2.)
Suggestion: `не отвечает` (same relay wording, column case preserved). Manager's verbatim-reuse decision is about the *words*, which survive.

**Mn-2 — `mobile.session.tray.context_short` / `context_short_estimate`: `{percent}% конт.` / `{percent}% конт. (прибл.)`**
Problem: `конт.` is a graphic contraction, not a Russian abbreviation; in a session tray it reads first as `контент` (content). The sidecar tells the translator to use the full word when no short form exists.
Suggestion: `{percent}% контекст` / `{percent}% контекст (прибл.)` **if** a rendered fit test of the <340 pt band passes at +3 cells; otherwise keep `конт.` and record the exception (translator already disclosed it) — do not silently keep both claims.

**Mn-3 — [style guide, not the candidate] `i18n/style-guides/ru.md` records «в простой» for idle**
Problem: as a bare state label the prepositional `в простое` is required; the accusative `в простой` exists only in a verb frame (`уйдёт в простой`, shipped core copy). A later wave reading the guide literally would "correct" the catalogue into the wrong case.
Suggestion: record both — `в простое` (state label) / `уйти в простой` (verb frame). The candidate's `в простое` is correct as delivered.

### NIT
**N-1 — `mobile.session.back_to`: `Назад: {name}`**
Problem: an a11y-only label (no width budget), spoken by VoiceOver without the colon, so it can land as "Назад План релиза".
Suggestion (optional): `Назад к сессии «{name}»`. Current form is acceptable and correctly avoids declining arbitrary names — take this only if a native pass is already editing the line.

---

## Verdict

**`changes-requested`** — **BLOCKER 1 · MAJOR 0 · MINOR 3 · NIT 1** (0 NITs filed beyond the one; I am not padding).
Ledger status for `ru` / M2 group (for the manager to write; I did not touch the ledger): **`changes_requested`**, blocked only on B-1 — a four-name rename in the sidecar and the candidate. The translations themselves are otherwise sound: Mn-1 and Mn-2 are polish the manager may accept as recorded decisions, Mn-3 is a guide correction, N-1 optional.
Once the four keys are re-keyed with values byte-identical, this group is `passed` from my side without a further linguistic round (the re-key is mechanical, not a translation change).

Suggested ledger note (≤280 chars, hashes/ids agree with this report):
`ru M2 v3 759cb724: 1 blocker (4 region-label keys misnamed label.* vs shipped label_*; sidecar origin, values OK), 3 minor (degraded capital, конт., guide в простое), 1 nit. Auditor i18n-auditor/deepseek-flash s38b309c, independent of gpt-6.1-sol translator.`

**Artifacts (this session's scratchpad, temporary):** `audit-m2-ru-r2.md` (this report) and `verify-m2-ru-r2.mts` (the parser harness whose output is quoted in §1). They live in `~/.local-operator/sessions/38b309c987d5/scratchpad/`; fold them into the tracked bundle when the manager records the audit, and treat them as lost if that copy is pruned first.

---

## 5. Ready-to-paste re-key for B-1 (values byte-identical to v3, only the four names change)

In `keys33.json` order, replacing the four nested keys:

```json
"mobile.session.region.label_working": "активность",
"mobile.session.region.label_subagents": "агенты",
"mobile.session.region.label_todos": "задачи",
"mobile.session.region.label_strip": "статус",
```

Everything else in `ru.v3.json` stays as audited (`759cb724…`). If the sidecar is regenerated from the branch instead, no candidate change is needed beyond the same four renames.
