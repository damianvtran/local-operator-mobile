# Independent translation audit — `ru` — mobile M2 expression literals — re-audit of the SHIPPED bytes

**Verdict: `clean-with-findings` — blocker 0 · major 0 · minor 3 · nit 2**
Ledger: `passed` (bar is "no BLOCKER or MAJOR remains"). Two minors are shipped-copy polish; one is a
core-repo style-guide error outside this PR's bytes.

## Auditor identity (disclosed)

- `agent`: **i18n-auditor** (lopdev team) · `session`: **81c04d13bc66**
- `model`: **deepseek/deepseek-flash** — source: this run's harness session header (`Model: deepseek/deepseek-flash`).
  No role/model pin set by me; **no fallback observed**. Actual-model source: session header, not a self-claim.
- `independent_from_translator_session`: **true** — translator was `openai/gpt-6.1-sol` (session `c2709b58d7f7`),
  and I am also not either earlier ru auditor (`deepseek/deepseek-flash` s`2516ea781924` lane A,
  s`38b309c987d5` round 2). READ-ONLY: no repo write, no ledger write, no PR comment.
- No translation/MT service, dictionary, back-translation or MT comparison was used. Every judgement is my
  own reading of `ru`.

## Inputs audited (exact bytes)

| Role | Path | sha256 |
|---|---|---|
| Worktree / head | `~/local-operator-mobile/.worktrees/i18n-m2-scanner` @ `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a` (PR #236) | — |
| **Target values (33, shipped)** — sha256 of sorted-key JSON `{key: value}` | `src/i18n/catalogues/ru/mobile.{settings,computers,session}.json` | **`4e76a2e0f98de6ab309777dceddd9556979c71754f3894b511a50cc8bb7c7dae`** |
| **English source values (33)** — same canonicalisation | `src/i18n/catalogues/en/mobile.{settings,computers,session}.json` | **`c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528`** |
| Raw catalogue files (en) | `en/mobile.settings.json` `d7e1d85b…aee23d` · `en/mobile.computers.json` `71382783…76aff3` · `en/mobile.session.json` `8df14a0d…a716d3` | — |
| Raw catalogue files (ru) | `ru/mobile.settings.json` `ca69c7f8…8bf8dad8` · `ru/mobile.computers.json` `d9301956…76856521` · `ru/mobile.session.json` `f58ea87e…4c73d878` | — |
| Context sidecars (en only — the only locale carrying them) | `src/i18n/catalogues/en/mobile.{settings,computers,session}.context.json` | role/note/width per key |
| Audited candidate v3 (round 2's input) | `…/sessions/3ef6295a5545/scratchpad/m2-prep/ru.v3.json` | `759cb72414b0c4dad571f18e8c0b9ea8bb7320462b90af82c8c5b42aa0fa19bd` ✔ matches round 2's claim |
| Source+context sidecar round 2 read | `…/m2-prep/keys33.json` | `f3a96f9a9d92cfdb7be5e981b02c3ad9be6bc15b0eba96e4967223ea85bc4a8f` ✔ |
| Evidence bundle | `i18n/audits/evidence/ru/m2-expression-literals/{final,round1-A,round1-B,round2}.md/json` | `round1-A` `eb39f4ac…5ddf6`, `round1-B` `26c645f9…feac8`, `final.json` `b6b8afeb…6f93d` — all three match the NOTE's *committed* column |
| Bundle manifest | `i18n/audits/evidence/NOTE-m2-expression-literals.md` | — |

## (3) Do the shipped values equal what the last audit read?

**Yes — byte-identical, values only; the four key names changed.** Derived here, not taken from the note:

- 33 keys added by this PR vs `fa2bc5e0` (my own `git show` diff of the three ru catalogues), 4 + 15 + 14.
- Shipped 33 values vs **audited v3** `759cb724`, mapped through the four renames → **0 value differences**.
- Shipped 33 values vs the bundle's **`final.json`** → **0 differences**; `final.json` == `ru.final.json` in prep.
- Sorted-key hash of the shipped target values and of v3's values are the **same string**
  (`4e76a2e0…`), i.e. the rename was byte-preserving exactly as the bundle claims.
- Untracked-prep check of the note's own table: the `ru/round2.md` row differs between the *original* and
  *committed* columns (`9dc975c0…` vs `74552351…`); I re-hashed the committed file → `74552351…`, matching the
  note's **committed** column. The note documents that normalisation, so it is **not** a discrepancy.

So: no unaudited new *wording* anywhere. The only unaudited delta this PR ships is the four key **names** —
which is precisely what the earlier BLOCKER was about, and what I re-read below.

## (4+5) Mechanical pass — clean, and B-1 is fully resolved

- **Repo validator (executed, read-only):** `npm run -s i18n:catalogue:check` at `3af477ee` →
  `src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`,
  exit 0, working tree clean.
- **Placeholders** — my checker derives the 33-key set from git (`fa2bc5e0..HEAD`) and extracts arguments with the
  **app's own parser** (`src/i18n/messages.ts`), not a regex: **33 keys, 0 failures**; 9 keys carry arguments and
  every name *and order* matches en — `baseUrl, host, name, percent×4, labels, name`. `%` literal count matches on every key.
- **ICU** — the slice contains **no** `plural`/`select`; none was invented. For completeness, the 5 plural
  messages that remain in the three ru files (untouched by this PR beyond a trailing comma) carry all four ru
  arms: `one/few/many/other`.
- **Key sets** — en/ru parity per namespace: settings 59/59, computers 45/45, session 78/78; **no key added or dropped**; valid JSON.
- **Hygiene** — NFC throughout; no control/format characters (no manual bidi marks — correct for a non-RTL locale);
  no double spaces, no edge whitespace, no `...`, no straight quotes, no space before `: ; ! ?`;
  middle dot is `U+00B7` with ordinary spaces both sides; arrows are the source's `↑ U+2191` / `↓ U+2193`, not mirrored.
  Markup/code/backtick/flag tokens: none in the slice, so nothing to leave untouched.
- **B-1 (four region-label key names) — RESOLVED in the shipped bytes.** Evidence, all read at `3af477ee`:
  - shipped catalogues carry `mobile.session.region.label_working / _subagents / _todos / _strip` (my own diff);
  - the **en context sidecars** carry exactly those four names (`en/mobile.session.context.json`), with the
    correct notes ("activity" / "agents (subagents) band" / "tasks (todo list) band" / "status strip band"), and
    contain **no** dotted leftover (`region.label.`);
  - call sites: `app/(app)/session/[id].tsx:1100-1103` `t("mobile.session.region.label_*")`; `git grep -F 'region.label.'` over
    `app src scripts` → **nothing**, i.e. the dotted form exists nowhere;
  - `catalogue.gen.ts` regenerated with the four names (`:398-401`, `:1673-1676`), validator current (above);
  - each renamed value is attached to the right English source: активность↔activity, агенты↔agents,
    задачи↔tasks, статус↔status (checked key↔en value, and vs the en sidecar note).
- **Negative control (harness must bite):** mutating in memory `route_direct` → `{baseurl}` and `tray.context` →
  `{percent}% контекста 5%` → flagged `["route_direct: arg","tray.context: arg/pct"]` → **BITES**.
  (First run of my checker compared whole parse trees including `source` and produced 32 false FAILs;
  corrected to compare argument names only before using any of its output — recorded so the 0 is not a silent bug.)
- **Observation, not counted (not shipped):** the prep **sidecar** `keys33.json` still carries the *dotted*
  names (`sha f3a96f9a`, the same bytes round 2 read). Only the candidate/catalogue were renamed; the sidecar
  was not, and it is untracked. Nothing shipped is wrong, but a future wave regenerating a candidate from that
  sidecar can re-introduce B-1. The manager owns the sidecar; fold the rename there if it is kept.

## (4) On the merits — accuracy, idiom, terminology, fit

All 33 read individually against `english` + sidecar `note` + call site. **No BLOCKER, no MAJOR.**

- **Meaning/polarity:** every status word keeps its referent and direction — `Не подключён` / `Подключён`
  (the computer), `Вне сети`, `Не отвечает`, `Пока нет подключения`, `Вход в Radient не выполнен` (absence stated,
  no blame, matches shipped `signed_in` «Вход выполнен»). `wait.host_answering` keeps **both** clauses including the
  warning (a configured route ≠ a machine that is up). No negation, omission or addition anywhere; nothing softens
  an error or a permission statement; no destructive text in the slice.
- **Register:** `вы` lower-case throughout (`ваш`, `вашему`), impersonal constructions (`Ожидание ответа компьютера.`),
  sentence case, no `!`, no politeness padding, no Title Case. Matches the guide.
- **Terminology vs glossary `i18n/glossary.md` §2 + ru guide:** session→`сессия` ✔, agent→`агент` (shipped plural
  `агенты`, the term's plural form — the row is violated by a different term, not by grammar) ✔,
  job→`задание` kept distinct so todos keep `задача` → `задачи` ✔. Cross-checked in the shipped catalogue:
  `relay.chrome.session.tray.tasks`«Задачи», `session.sheet_title.status`«Задачи и агенты»,
  `tray.agents`«Агенты», `status.not_answering` byte-identical to `relay.chrome.session.subtitle.not_answering`,
  `diagnostics.route_radient`«Туннель Radient» (same word order as the new `account.route_radient`),
  elsewhere `Контекст` / `Дополнительный контекст` for context. Consistent.
- **Punctuation/typography:** no space before `: ; ! ?` (correct for ru; the French rule does not apply);
  middle-dot cue format identical to en; `{labels}`-first English reordered to `ниже: {labels}` — idiomatic ru, and
  the spliced labels stay nominative so the colon-list frame is grammatical.
- **Fit / width:** the sidecar is `maxCells`-free for this slice (fields: key/english/role/note/placeholders/callSite),
  so fit was judged on the call site, not invented: the diagnostics value column is `flex-1`, `text-mono-sm`,
  `numberOfLines={2}` — `Не отвечает` (11) fits beside sibling values; the region cue is a full-width `Text` that
  wraps in a **constant** slot (it does not oscillate); the tray full forms `{percent}% контекста` (20) are within
  3 cells of en; the short forms are gated to the **under-340 pt** band by design (D17: the full word wraps the
  activity band to two lines there). No overflow finding; ru lengths are 1.0–1.3× en, worst case the estimate
  string (29 vs 25). Wide-glyph/combining risk: none (Cyrillic precomposed, NFC).
- **English left in the slice:** exactly two Latin strings, both allowed and named: `Radient` (product name, in
  `account.not_signed_in` and `account.route_radient`) and `Local Operator` (`settings.account.app_name`, the app name
  used for avatar initials; the sidecar says never translate).
  `{baseUrl}`/`{host}` are placeholders. Nothing else Latin, nothing untranslated.

## Findings

### MINOR

**m-1 · `mobile.settings.diagnostics.stream_degraded` — «Не отвечает» (capital) — STILL PRESENT**
Current: `Не отвечает`. English is lower-case `degraded`; its four siblings in the same monospace value column are
lower-case (`в простое`, `подключается`, `активен`, `вне сети`) — this is the only capital in the column and in the
column's en source. Call site: `src/features/settings/settings.tsx` `DiagnosticRow` / `streamWord()`.
Why it matters: a visible case break inside one aligned column; the manager's "reuse the relay wording" decision is
about the **words**, which survive a lower-case initial. Suggested: **`не отвечает`**.
(Carried from round 2's Mn-1; not fixed, still minor, not a MAJOR — meaning and register are right.)

**m-2 · `mobile.session.tray.context_short` / `…_short_estimate` — «{percent}% конт.» / «{percent}% конт. (прибл.)» — STILL PRESENT**
Current: `{percent}% конт.` (16) / `{percent}% конт. (прибл.)` (25) vs en `{percent}% ctx` / `{percent}% ctx (est.)`.
Problem: `конт.` is not a settled Russian abbreviation; it is the **only** abbreviation of контекст in the shipped ru
catalogue (elsewhere always `Контекст`), and the first parse of `конт.` is *контент* — a different concept.
Counter-weight I checked: the short form exists only in the **under-340 pt** band precisely because the full word
wraps, so `контекста` (12 cells with the number) is not a drop-in; the value is defensible on width.
Disposition: **keep the value, record it** — add one line to the bundle (or the ru guide's recorded-calls list) that
`конт.` is a width-driven abbreviation in the <340 pt tray, so the next wave neither "fixes" it silently nor forgets
the reason. If a rendered fit test of that band passes at +3 cells, `{percent}% контекста` is the better word.
(Carried from round 2's Mn-2; still minor.)

**m-3 · `i18n/style-guides/ru.md` records «в простой» for idle — STILL PRESENT (core repo, NOT this PR's bytes)**
The shipped copy is right: `diagnostics.stream_idle` = «в простое» (prepositional, correct as a state label) and
`relay.chrome.session.subtitle.idle` = «Простой» (noun); grep confirms «в простой» appears in **no** shipped ru string.
But the guide's wave-2 recorded calls still say «в простой» for idle, and a later wave reading it literally would
"correct" a correct catalogue value into the accusative. Suggested guide line: «Простой» (noun) / «в простое»
(state label) / «уйти в простой» (verb frame only). Scope: `~/local-operator/i18n/style-guides/ru.md`, so it does
**not** gate PR #236; fix it while the ru wave is open.
(Carried from round 2's Mn-3; still minor, still unfixed.)

### NIT

**n-1 · `mobile.computers.wait.host_answering` — «Настроенный маршрут ещё не означает, что компьютер работает.»**
Mild metonymy: «маршрут не означает» wants a proposition as subject. Completely comprehensible, so optional.
Suggested: **«Наличие настроенного маршрута ещё не означает, что компьютер работает.»** (help line — wraps freely, no budget).

**n-2 · `mobile.session.back_to` — «Назад: {name}» (round 2's N-1, answered)**
Not a defect and **no change recommended**: the colon frame avoids declining arbitrary session names, which is the
right call, and the unnamed case now routes to `back_to_session` («Назад к сессии», correct dative) via
`src/features/session/back-label.ts:22-23`. If a native pass ever touches it, an em dash («Назад — {name}», guide-sanctioned
spacing) reads slightly better aloud; VoiceOver at default punctuation verbosity normally does not voice the
colon, so the a11y cost is low and this stays a nit, not a finding. (Not device-verified by me — read as a
judgement about the copy, not a measured screen-reader result.)

## Verdict and ledger row (for the manager to write; I did not touch the ledger)

**`clean-with-findings` — 0 blocker · 0 major · 3 minor · 2 nit.** No BLOCKER/MAJOR remains → group status `passed`.
Not posted on PR #236; I made no repo write.

Suggested ledger note (≤280 chars, agrees with the hashes above):
`ru M2 shipped 3af477ee tgt4e76a2e0 en c326a93f: 1B from R2 (4 region-label key names) resolved+verified in shipped bytes; 3 minor (degraded capital, конт. abbrev, guide в простой), 2 nit. i18n-auditor/deepseek-flash s81c04d13bc66, indep of gpt-6.1-sol.`

Suggested `record.json` fields: `locale=ru`, `namespace=m2-expression-literals`, `audit_date=2026-11-11`,
`key_count=33`, `status=passed`, `unresolved_blocker_major_count=0`, `finding_ids=[m-1,m-2,m-3,n-1,n-2]`,
`input_hashes` = the target/en/intermediate rows above, `head=3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a`.
Note: no `audit-ledger` command exists in this repo (`i18n/` holds only `audits/`; core `i18n/ledger.json` has no
mobile rows), so the row is a file edit the manager makes — I did not invent an invocation I did not run.

## Artifacts (session scratch)
`audit-ru.md` (this report) and `verify-ru-m2.mjs` (the checker + negative control whose output is quoted in
"(4+5) Mechanical") — `~/.local-operator/sessions/81c04d13bc66/scratchpad/`. Temporary until folded into the tracked bundle.
