# Independent translation audit — `ru` — mobile M2 slice (expression literals), Lane A

**Audit id:** `m2-ru-A` · **Date:** 2026-11-11 · **Lane:** A (settings · wait panel · session screens)
**Auditor:** i18n-auditor (lopdev team), session `2516ea781924`, **actual served model `deepseek/deepseek-flash`** (harness header for this run; no role/model pin, no fallback observed in this session's calls).
**Independence:** I did not translate any audited value and cannot edit it. No translation/MT service, dictionary, back-translation or LLM comparison was used — every judgement below is my own reading of ru as a native-fluent reviewer. The translator was named by the manager as `openai/gpt-6.1-sol`; not this session.

## Inputs (hashes are of the exact bytes audited)

| Role | Path | sha256 |
|---|---|---|
| Source + context | `~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/keys27.json` | `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e` |
| Candidate (under audit) | `…/m2-prep/ru.v1.json` (27 values) | `7103ca05ab8c6cf991d0794f035da6cfb206730408d9c57b34cb7c01e6ae743f` |
| M1 reference (read-only) | `…/m1-prep/ru.v2.json` (audited M1, pass A) | `247837f44c1eb9b16f34c2f9b8594ae8fea446ce8331a6afd1a0ba8b53984daa` |

**Source grounding (goes one step further than trusting the sidecar):** all 27 `english` values in `keys27.json` are byte-identical to the `en` catalogues on the wiring branch `feat/i18n-app-scan-expression-literals` @ `b6b890e0` — 27/27 matched, 0 absent, 0 differing (`git show <rev>:src/i18n/catalogues/en/{mobile.settings,mobile.computers,mobile.session}.json`). The same three `ru` catalogue files on that branch still carry the **English** stubs for exactly these 27 keys (e.g. `connected_to → "Connected to {name}."`), so there is no prior ru rendering of these keys to be consistent with; consistency was checked against the *rest* of the shipped ru catalogue.

## Verdict

**`clean-with-findings`** — **blocker 0 · major 0 · minor 5 · nit 3**.
Ledger status for this lane: **`passed`** (the bar is "no BLOCKER or MAJOR remains"). Nothing in this batch is wrong, unsafe, ungrammatical or truncated; five wordings want a native polish before the wave closes, and three are notes.

**Scope of the evidence.** I reviewed the candidate as data + call sites. I did **not** run the app with the candidate applied (no branch write, no build, no screenshots — the brief forbids both repo writes and editing). So every width/fit claim below rests on the call site's own constraint (`numberOfLines`, `ellipsizeMode`, pill wrap rules, `maxCells`-free sidecar) and on character counts, explicitly labelled as such — not on measured rendered geometry.

---

## 1. Mechanical pass — clean

Run in this order: the repo's own gate at the checked-out head, then my own verification with the **app's own parser** (`src/i18n/messages.ts` → `parseMessage`/`formatMessage`), not a regex.

- `npm run -s i18n:catalogue:check` in `~/local-operator-mobile/.worktrees/i18n-app-scan` @ `ae0b2ae7` →
  `src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`; `git status --porcelain` → 0 lines.
- `./node_modules/.bin/tsx <scratch>/verify-m2-ru.mts` (script kept beside this report) → **27 keys, 0 mechanical failures**. For every key it prints the parser's own argument map for en and ru and renders the ru value with sample args:
  - **Key set and order:** 27/27, identical to `keys27.json`, no additions, no drops.
  - **Placeholders:** argument *name and kind* identical on every key that has one — `{baseUrl}`, `{host}`, `{name}`, `{percent}`, `{labels}`; no renames, no reordering; `%` present exactly where the source has it.
  - **ICU:** this slice contains **no** plural/select message (all 27 are plain text or a single `{arg}`), so no CLDR category set is owed; nothing to check for `one/few/many/other` here. M1's plural keys were audited separately.
  - **Renders** (sample args): `Прямое подключение к 100.64.0.7:8787` · `Ожидание ответа компьютера по адресу damian-mbp.radient.dev. Настроенный маршрут ещё не означает, что компьютер работает.` · `Выполнено подключение к MacBook Pro.` · `42% контекста` · `42% конт. (прибл.)` · `ниже: задачи · агенты · прокрутить ↓`.
- **Empties:** none. **English-identical:** only `mobile.settings.account.app_name` (`Local Operator`) — deliberate, per its note.
- **Allowed Latin:** `Radient` (×2), `Local Operator`, plus the placeholder tokens; nothing else Latin anywhere.
- **Hygiene:** NFC-normalised; no control/format characters (no manual bidi/RLE/FSI — correct for a non-RTL locale); middle dot is `U+00B7` with ordinary spaces on both sides, byte-identical to en on all three region cues; arrows are the source's `U+2191`/`U+2193` (not mirrored — an up cue stays ↑, a down cue stays ↓); no straight quotes, no `...`, no double spaces, no space before `: ; ! ?`.
- **Script/punctuation:** Cyrillic throughout; final punctuation matches each key's role (status/meta/heading without a stop; the two `wait.*` help lines and the `connected_to` confirmation with one) — matches en key-for-key.

## 2. Accuracy and safety — no error found

Read one value at a time against its `english` + `note`, then against the call site:

- **Connection-state words keep their polarity and their referent.** `Не подключён` / `Подключён` (masculine, the computer/tunnel the row is about) agree with the shipped catalogue's own masculine use for computers (`В вашем аккаунте Radient — не подключены`), so I am *not* filing the gender as a defect; `Вне сети`, `Не отвечает` (byte-identical to the shipped `relay.chrome.session.subtitle.not_answering` = `Не отвечает`), `Нет подключения` — all faithful, none softened.
- **`wait.host_answering` keeps both clauses**, including the one that carries the warning: a provisioned route does not prove the machine is up (`Настроенный маршрут ещё не означает, что компьютер работает.`). Dropping `your` (`компьютера` rather than `вашего компьютера`) is the ru guide's impersonal preference, correctly applied; no instruction is added or lost.
- **`not_signed_in`** states the absence without blaming the reader and matches the shipped `signed_in` (`Вход выполнен`) — `Вход в Radient не выполнен`. Same family, same voice.
- **`connected_to` + `fallback_name` as one sentence** (the pair the manager called out): fallback is a **dative** noun phrase (`вашему компьютеру`) and the frame governs dative (`к …`), so `Выполнено подключение к вашему компьютеру.` is grammatical — the pair is *consistent*. I checked the fallback has exactly one call site on the wiring branch (`git grep fallback_name` → `computers.tsx:638`, spliced into `connected_to` only), so the dative form cannot leak into a frame that needs another case today. (Its word order is a polish finding, M-1.)
- **`{baseUrl}` / `{host}` stay LTR Latin and undeclined**; no article/case glue was invented around them (`к 100.64.0.7:8787` is correct as-is).
- Destructive/permission text: none in this lane (no delete/permission strings here); no `!`, no politeness padding, `вы` lowercase throughout (`ваш`, `вашему`).

## 3. Terminology — consistent with the shipped catalogue and M1

Recounted in the shipped `ru` catalogues rather than trusting a claim:

| Concept | Shipped ru | Candidate | Verdict |
|---|---|---|---|
| tunnel | `туннель` (6 occurrences, `mobile.settings`/`mobile.computers`) | `туннель` | ✔ consistent (not `тоннель`) |
| stream (diagnostics row) | `Поток` | values only | ✔ |
| connecting | `подключается` (`computers.badge.connecting`) | `подключается` | ✔ |
| active/live | `активен` (`computers.badge.active`) | `активен` | ✔ |
| not answering | `Не отвечает` (`relay.chrome…not_answering`) | `Не отвечает` | ✔ byte-identical |
| session | `сессия` (glossary §2, feminine) | `сессия` | ✔ |
| computer | `компьютер` | `компьютер` | ✔ |
| sign-in performed | `Вход выполнен` (M1) | `Вход … не выполнен` | ✔ same frame |
| estimated | — | `прибл.` | ✔ standard ru abbreviation |
| relay | glossary `ретранслятор` | not used (no relay referent in these keys) | n/a |

`Local Operator` and `Radient` kept in Latin, uninflected, exactly as the notes require. No kept-English term was translated and no Cyrillic term was invented where the guide has a settled one.

## 4. Findings

### MINOR

**M-1 `mobile.computers.added.connected_to`** — *high visibility: the confirmation after a computer is added*
Current: `Выполнено подключение к {name}.`
Problem: bureaucracy, by word order. Russian product copy confirms in the passive participle (`Сессия сохранена`, and this repo's own `Выход выполнен`), but the verb-first inversion `Выполнено подключение к …` is the letter-writing register the guide forbids (`Prefer impersonal … "Сессия сохранена"`, terse). It is also the longest relative growth in the slice: the prefix before `{name}` is **24 characters against en's 13** (`Выполнено подключение к ` vs `Connected to `), for a one-line confirmation sitting under a card of the same information.
Suggestion: `Подключено к {name}.` — 13-character prefix, matches en's shape, still governs the dative fallback, so `Подключено к вашему компьютеру.` stays grammatical with no change to `fallback_name`.
Second, smaller point on the same pair (for the record, not a separate finding): a dative-and-preposition frame needs `{name}` to decline, which holds for Latin hostnames (`damian-mbp`, `MacBook Pro` — the realistic case here) but not for a user-typed Cyrillic name (`к Мой ноутбук`). Actual renders through the app's `formatMessage` (`render-connected-to.mts`):
`вашему компьютеру` → `Выполнено подключение к вашему компьютеру.` · `MacBook Pro` → `…к MacBook Pro.` · `damian-mbp` → `…к damian-mbp.` · `Ноутбук` → `…к Ноутбук.` · `Домашний компьютер` → `…к Домашний компьютер.` — the first three read correctly, the last two do not, in the current wording and in the suggested one alike (the preposition, not the verb order, is what needs the case). If the manager wants that hazard gone rather than accepted, the robust pair is a colon frame that takes the nominative: `Подключено: {name}.` with `fallback_name` = `ваш компьютер`. That is a two-key change and a call above my lane; the M-1 wording alone fixes the register.

**M-2 `mobile.settings.diagnostics.stream_degraded`**
Current: `не отвечает`
Problem: collapses a distinction the English keeps on purpose. On the Settings screen this value is painted **while the Status pill above shows `Не отвечает`** (settings.tsx: `case "degraded" → message: mobile.settings.status.not_answering`; the diagnostics row separately renders `mobile.settings.diagnostics.stream_degraded`), so the same screen says the same words twice and the reader loses "the stream is up but unhealthy" — the technical field duplicates the human one. En deliberately splits them (`degraded` vs `Not answering`).
Suggestion: `нестабилен` (one word, lower case, monospace column; alternative `с перебоями`).

**M-3 `mobile.settings.diagnostics.stream_idle`**
Current: `простой`
Problem: garden path inside its own column. The other four values in that column are masculine adjectives/verbs agreeing with the row label `Поток` (`активен`, `отключён`, `подключается`, `не отвечает`), so `Поток: простой` first reads as the adjective "simple", not as the noun "downtime". The meaning is recoverable, but the diagnostic is read by people debugging a stream and this is the one value that can be misread.
Suggestion: `в простое` — unambiguous, 8 cells in a column that already fits `не отвечает` (11), and it is the same idle vocabulary the ru guide records for idle (`в простой`/простой).

**M-4 `mobile.settings.account.route_direct`**
Current: `Прямое подключение к {baseUrl}`
Problem: two small ones, same line. (a) **Parallelism:** this is the *other* branch of the same slot as `Через ваш туннель Radient` (settings.tsx: `route.mode === "radient" ? route_radient : route_direct`), so a reader sees one prepositional phrase or one noun phrase in the same position — the pair should be built the same way. (b) **Fit:** the line renders with `numberOfLines={1} ellipsizeMode="tail"`, i.e. it truncates at the **end**, where `{baseUrl}` is. The prefix costs 21 characters where the shipped diagnostics row on the same screen already says it in 11 (`mobile.settings.diagnostics.route_direct` = `Напрямую к ретранслятору`). (Character counts, not measured geometry — I could not render; the en prefix is 22, so this is parity rather than regression, which is why it is MINOR and not a fit MAJOR.)
Suggestion: `Напрямую к {baseUrl}` — matches its sibling's construction, matches the shipped diagnostics wording, saves 10 cells before the URL on a tail-ellipsized line.

**M-5 `mobile.session.region.more_below`**
Current: `ниже есть ещё · прокрутить ↓`
Problem: `ниже есть ещё` is 12 characters of ordinary speech for a permanent one-line cue under the capped region (en: `more below`); the slot is a fixed height and the sibling cue (`конец · прокрутить ↑`) is terser, so the pair reads unevenly.
Suggestion: `ещё ниже · прокрутить ↓`.

### NIT

**N-1 `mobile.session.tray.context_short`** — `{percent}% конт.` · `конт.` is rarer in Russian for *context* than for *content*, and `контент` is the reading a newcomer tries first; the percentage in front recovers it, and no better short form exists (the full `контекста` is what the `_short` variant exists to avoid on <340 pt), so this is a note rather than a fix. If the narrow band can take it: `{percent}% конт. окна`. Otherwise keep and record the abbreviation in the ru guide so a later wave does not "correct" it to `контент`.

**N-2 `mobile.settings.status.no_connection`** — `Нет подключения` drops en's `yet`. `Пока нет подключения` restores it, but the pill row is deliberately kept to short values (the `statusFor` comment: a longer word wraps the label/value row at 200 %), so the current form is defensible. Filing it only so the omission is a recorded decision rather than an oversight.

**N-3 `mobile.computers.wait.host_answering`** — `Настроенный маршрут` renders *provisioned* as "configured"; `выделенный маршрут` is closer to provisioned (a route Radient created for you, not one you configured). The sentence's point survives either way; take this only if a native pass is already editing the line.

### What I am deliberately not filing

- `Не подключён` vs the shipped `не подключены`: same referent (the computer), same gender — not a defect.
- `сессия` lower case as a header fallback: en is lower case by design (`session`), and the two call sites are title slots the source chose to keep bare.
- `секция/`video` casing split (`Видео` vs `сессия`): the source splits them (`Video` / `session`); not a translation choice.
- `прокрутить ↑/↓` as an infinitive cue: the guide's action-label convention is the infinitive; arrows are correctly sourced, not mirrored.

## 5. Ledger / evidence — NOT written (as instructed)

My brief for this lane says *do not touch repo or ledger*, so I wrote **no** `i18n/audits/evidence/…` bundle and no ledger row. Everything needed to record it is in the tables above; the manager owns the write. Suggested disposition for this locale + lane:

- `status`: **`passed`** (0 BLOCKER, 0 MAJOR; M-1…M-5 recorded as dispositions)
- `key_count`: 27 · `audit_date`: 2026-11-11 · `namespace` (file group): lane A = `mobile.settings` (12) · `mobile.computers` (4) · `mobile.session` (11) as one slice, or split per namespace if the ledger is per-namespace
- `input_hashes`: `en` `5a87db85…cce02e1e`, target `ru` `7103ca05…6ae743f`, context = same file as `en` here
- `auditor`: `agent: i18n-auditor (lopdev)`, `session: 2516ea781924`, `model: deepseek/deepseek-flash`, `actual_model_source: harness session header`, `independent_from_translator_session: true`
- ready-to-paste note (≤280 chars, no escaping needed):
  `ru v1 7103ca05: 0 blocker/major, 5 minor (M-1 connected_to word order; M-2 degraded dup; M-3 idle; M-4 route_direct; M-5 more_below), 3 nit. Auditor i18n-auditor/deepseek-flash s2516ea7, independent of translator. Repo untouched.`

**Artifacts of this audit (temporary, in this session's scratchpad):** `audit-m2-ru-A.md` (this report), `verify-m2-ru.mts` (the parser/placeholder harness whose output is quoted in §1) and `render-connected-to.mts` (the `{name}` render matrix quoted under M-1). They live only in `~/.local-operator/sessions/2516ea781924/scratchpad/` and are not attached to the repo; they should be folded into the tracked bundle when the manager records the audit, and treated as lost if that copy is pruned before then.
