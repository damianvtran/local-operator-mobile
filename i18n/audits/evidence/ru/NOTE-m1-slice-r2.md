# Independent delta audit — `ru`, mobile slice M1 (53 phone-app keys), round 2

**Verdict: clean-with-findings — 0 BLOCKER, 0 MAJOR, 3 MINOR, 3 NIT.**
Ledger status therefore `passed` (a `passed` row requires zero unresolved BLOCKER/MAJOR).
I audited the staged translations; I did not edit them. No translation API, SDK or MT
service was used — every judgement below is reasoning over the strings themselves.
No other round-2 report was read.

## Provenance

| | |
| --- | --- |
| locale | `ru` |
| slice | M1 — 53 new phone-app keys in 4 namespaces (`mobile.common` 4, `mobile.computers` 6, `mobile.session` 16, `mobile.settings` 27) |
| round | 2 — delta audit of `ru.v2.json` (9 changed keys) after round 1 (two auditors A/B); translator `openai/gpt-6.1-sol`, session `48676ea694c1`, as reported in `ru.v2-changes.md` — not observed by this auditor |
| auditor agent | `i18n-auditor` (lopdev team) |
| audit session | `b074e5794284` |
| served model | `deepseek/deepseek-flash` (session header as shown to this session; no provider-fallback notice appeared in this transcript) |
| independent from translator | yes — different agent, session and model; the translator's run was not observed |
| audit date | 2026-11-11 |
| audited head | `84c4bee109d048e3dad0f996921e1b8ed561dfc8` (mobile `i18n-app-scan` worktree) |

Inputs, as hashed at audit time:

| role | path | sha256 |
| --- | --- | --- |
| English + per-key context (slice) | `<m1-prep>/keys.json` | `1f0f346e5595ae4c26e7b397ba6f96c7bc797dfc453798934f019f82a5879ed8` |
| target v1 | `<m1-prep>/ru.json` | `1ecfaf98401dd76aedc288d63b53c71299aa7ed10b6a997fe698dd68111bd164` |
| **target v2 (audited)** | `<m1-prep>/ru.v2.json` | `247837f44c1eb9b16f34c2f9b8594ae8fea446ce8331a6afd1a0ba8b53984daa` |
| translator dispositions | `<m1-prep>/ru.v2-changes.md` | `322219289473014244fea378c543f57af63bca583feb2731cd8b2a1d72998814` |

Repo inputs (per namespace, at the audited head):

| namespace | en | en context | shipped ru (landing target, English placeholders today) |
| --- | --- | --- | --- |
| mobile.common | `b74466e8…` | `f6aadb8f…` | `6c4e67e9…` |
| mobile.computers | `6ccd282a…` | `15e04ab4…` | `3fb2b432…` |
| mobile.session | `fd14c208…` | `1b93b3dd…` | `e69e1e4d…` |
| mobile.settings | `257daa34…` | `b995b0b6…` | `39529ef0…` |

Full hashes are in each namespace's `record.json`; every command and its verbatim output
is in the shared `audit.log` (actual execution log, not notes).

Style authority read first: `i18n/style-guides/ru.md`, `i18n/style-guides/en.md`,
`i18n/glossary.md`, `local-operator-mobile/docs/i18n.md`; then the English source with
its per-key context notes; then `ru.json` → `ru.v2.json`; then the shipped `ru`
catalogues for consistency and real usage counts.

## Scope and method

1. Diffed v1 → v2 in Python: 53 keys in both, identical order and key set, **9 changed**,
   44 unchanged (`relay_version_sessions`, `retained_instruction`, `not_connected.next`,
   `about.blurb`, `account.delete_help`, `sign_out.body`, `sign_out.done`,
   `text_size.following`, `paused`). Every one of the translator's 13 "fixed" dispositions
   maps onto those 9 values; the 3 declined findings touch no value. The disposition table
   is internally consistent with the diff.
2. Judged the 9 changed values in full (accuracy, idiom, register, terminology, fit,
   safety), and checked unchanged keys only where a changed key now contradicts them.
3. Adjudicated all 3 declines with my own count over the shipped `ru` catalogue
   (649 non-context values, 22 files) — stems matched as written, values and occurrences.
4. Full mechanical pass over all 53 v2 values: JSON validity, key set/order, ICU argument
   names/kinds/order per key, plural arms against real CLDR, empties, English-identical
   values, bidi controls, quotes, dashes, ellipses, percent signs, Latin tokens.
5. Both safety lines re-read against the source claim by claim.

## Mechanical results (all PASS)

- Valid JSON; 53/53 keys; set **and** order identical to `keys.json`; nothing added/dropped; no empty value.
- ICU: my own recursive parser (braces, nested arms, `#`, format types) parses all 53 en and all 53 ru values; argument **names, kinds and order** identical for every key; no unknown or dropped argument.
- Plurals: both plural keys (`wait.relay_sessions`, `wait.relay_version_sessions`) carry exactly `one / few / many / other` — the CLDR `ru` set (`0` = many, `1/21/101` = one, `2–4/22` = few, `1,5` = other, verified with Node `Intl.PluralRules("ru")`), `other` present, no extra arm, `#` retained.
- Rendered arms are grammatical: `1 запущенная сессия` / `1 запущенную сессию`, `2 запущенные сессии`, `5 запущенных сессий`, `21 запущенная сессия`, `1,5 запущенной сессии`.
- English-identical values: **0** — no English left in the slice (the only Latin tokens are product names `Local Operator`, `Team Bridge`, `Radient`, `MIT`, plus ICU syntax).
- Bidi/C1 controls: 0. Straight quotes/apostrophes: 0. Three-dot ellipses: 0. Em dashes: 4, all spaced. Percent signs: preserved in both `text_size` values. No backtick literals in this slice.
- Repo validator at the audited head: `npm run -s i18n:check` → `catalogue.gen.ts is current (649 keys, 21 namespaces) … check-strings: 212 finding(s), all baselined; 0 new`, exit 0. **Baseline only** — the staged v2 values are not installed in the tree, so this run did not read them; ICU parity above is my own parser's result, and landing must re-run the validator.

## Findings

### M-1 — MINOR — `mobile.computers.wait.relay_sessions` and `mobile.computers.wait.relay_version` (unchanged) now contradict the fixed sibling

- Current: `Его ретранслятор сообщает: {sessions, plural, one {# запущенная сессия} few {# запущенные сессии} many {# запущенных сессий} other {# запущенной сессии}}.`
  and `Его ретранслятор сообщает версию протокола: {version}.`
- English: "Its relay reports {sessions, plural, one {# running session} other {# running sessions}}." / "Its relay reports protocol version {version}."
- Problem: the round-2 fix rewrote the combined line as a coordinated sentence with an accusative object (`сообщает версию протокола {version} и … запущенную сессию`), retiring the colon-plus-bare-noun list. The two other states of the *same wait-panel line* keep the retired grammar, so the sentence a user reads changes shape with the state: `сообщает: 1 запущенная сессия` beside `сообщает версию протокола 7 и 1 запущенную сессию`. Not a meaning defect — meaning is intact and the renders are grammatical; it is the group consistency the fix itself established.
- Suggested: apply the same fix to the two remaining lines — `Его ретранслятор сообщает {sessions, plural, one {# запущенную сессию} few {# запущенные сессии} many {# запущенных сессий} other {# запущенной сессии}}.` and `Его ретранслятор сообщает версию протокола {version}.` (arm text only; categories and arguments unchanged).

### M-2 — MINOR — `mobile.settings.connection.status`

- Current: `Состояние`
- English: "Status" (role `meta`: small row label left of the connection state pill).
- Problem: the same English label ships as **`Статус`** in both shipped label sites — `mobile.library.browse.status` and `mobile.projects.create.status` are literally "Status" → `Статус` (2/2). The remediation note justifies `состояние` from two shipped values, but both are prose, not labels (`session_health.control_hint` "what this *state* means"; `computers.disabled_help` "check its status in the console"). One term, one decision: the label row should follow the label precedent, and it sits beside `Подключение` / `Диагностика` / `Маршрут` noun labels.
- Suggested: `Статус`. (Prose `состояние` stays correct wherever the English is "state".)

### M-3 — MINOR — terminology record gate: `сервер управления` and `поток` ship with no glossary row

- Keys: `mobile.settings.sign_out.body` (`control plane` → `сервер управления`), `mobile.settings.diagnostics.stream` (`stream` → `Поток`).
- Problem: both are **new** terms — 0 occurrences in the shipped `ru` catalogue and no row in `i18n/glossary.md` or `i18n/style-guides/ru.md`. `en.md` states the gate plainly ("a new concept needs a glossary row before it ships in copy") and glossary §4 makes the wave that first needs a term responsible for its row. The translator proposed both in the staging note and correctly did not edit guide files; the rows still have to land with this wave, or the next wave re-invents them.
- Suggested wording is not the issue (both renderings are sound — see adjudications B N1/B M3). Action: land two rows (`glossary.md` §2 core terminology; `ru.md` recorded-calls section, dated) and cite them from the wave note.

### N-1 — NIT — `mobile.computers.wait.paused`

- Current: `Проверка приостановлена, пока приложение в фоновом режиме. Откройте его снова, чтобы продолжить проверку.` (105 cells, was 86 in v1, English 70)
- Problem: the root repeats across the two sentences (`Проверка … проверку`) and the value grew past the English by half again. Meaning and register are right; this is polish.
- Suggested only if the copy is touched anyway: `… Откройте его снова, чтобы продолжить наблюдение.` ("keep watching"). No change required.

### N-2 — NIT — `mobile.session.find.hint`

- Current: `Ищет сообщения в транскрипте, загруженном на это устройство`
- Problem: `загруженном на это устройство` reads as "loaded onto", where a stored copy is usually `на этом устройстве`; the shipped catalogue has `…этого устройства` for the same "the copy on this phone" idea. Audible-only string, both parse.
- Suggested: `Ищет сообщения в транскрипте, загруженном на этом устройстве`.

### N-3 — NIT — `mobile.settings.diagnostics.route_direct` (no change recommended)

- Current: `Напрямую к ретранслятору`, beside the sibling value `Туннель Radient`.
- Problem: the pair is uneven in shape — one value is adverbial ("directly to the relay"), the other a noun phrase ("Radient tunnel") — in the same `Маршрут` row. Both are accurate and each reads correctly after the label, so this is recorded, not requested; a noun value that keeps the sense (`Прямое подключение к ретранслятору`, 33 cells) is longer than the slot deserves.

## Adjudications of the declined findings (3/3 upheld, with my own counts)

Counts are over the shipped `ru` catalogue values (649 values, non-context) and are
value/occurrence counts, not concept estimates.

**A N-2 — keep `mobile.settings.connection.use` = `Выбрать` — UPHELD.**
English "Use" (3 cells) is a small button on a Settings computer row that switches to that
computer. Shipped `ru` has no "Use" action; its switch action is `mobile.computers.switch`
= `Сменить компьютер` ("Switch computer"), too long for a row button, and `использовать`
(11 cells) reads bureaucratic in a narrow row. `Выбрать` names what the button does —
select this computer — in the narrowest accurate form. (The translator's disposition records
audit A itself calling this the best short verb; I did not read that report.) Retaining it is
the right call.

**B M3 — keep `mobile.settings.diagnostics.stream` = `Поток` — UPHELD.**
The English sidecar fixes "One word" for this label, and `Поток событий` is two. Shipped
`ru` has zero `поток` occurrences, so there is no competing precedent to violate;
`поток` is the settled Russian word for a live data stream, and the row sits among equally
terse labels (`Маршрут`, `Последняя ошибка`). Adding "events" would specify something the
source does not say. The one-word constraint and source intent win.

**B N4 — keep `mobile.session.subagents_hint` = `Показать субагентов` — UPHELD.**
The source context for this key is explicit: "Accessibility hint … Imperative, no final
full stop", and the `ru` guide renders imperative action labels with the infinitive
(`Сохранить`, `Продолжить`). Shipped `ru` hints are third-person **because their English
is third-person** (11/11: `Открывает меню сессии`, `Показывает…`, `Прикрепляет…`,
`Удаляет…`, `Скрывает…`, …); `find.hint` is descriptive in its own English ("Finds
messages…"), so the mismatch the finding names is a difference the source deliberately
draws. Recorded residual: if the programme wants one hint register, the fix belongs in the
English source, not in a `ru` deviation from an explicit instruction.

The other 13 findings are recorded as fixed; I verified each named key actually changed and
that the new text addresses the cited problem. Nothing was fixed only in prose.

## Safety lines — dialog vs toast (re-checked claim by claim)

| claim | source | `ru.v2` |
| --- | --- | --- |
| the control-plane **sign-in** session ends | "This ends the session with the control plane" | `Сессия входа с сервером управления будет завершена` ✓ |
| the phone forgets it | "as well as forgetting it here" | `а приложение забудет её` ✓ |
| the tunnel stops accepting this phone | "so the tunnel stops accepting requests from this phone" | `поэтому туннель перестанет принимать запросы с этого телефона` ✓ |
| the computer is untouched | "Your computer is not touched." | `Ваш компьютер не затрагивается.` ✓ |
| (**toast**) the session was revoked on the computer | "Signed out. The session was revoked on your computer." | `Выход выполнен. Сессия входа отозвана на компьютере.` ✓ |

The two lines stay distinct and are not harmonised: the dialog's reassurance is about the
user's computer, the toast's claim is a revocation *on* it. That tension is in the English
source; the translation preserves both rather than resolving it — correct.

`session` never reads as an agent/chat session where a sign-in session is meant: both
sign-out strings qualify it as `сессия входа`, while `mobile.settings.account.delete_help`
keeps `Сессии на компьютере не затрагиваются.` for **agent** sessions (correct — those are
the sessions on the computer). No other slice value uses `session` for the sign-in concept.
The pre-existing `сеанс` drift (4 shipped values: `mobile.session.chip.model_resume_hint`,
`effort_resume_hint`, `model_unrecorded_hint`, `relay.transcript.label.peer`) is outside
this slice and no v2 value adds to it; `ru.v2` uses `сессия` / `субагент` throughout.

## Changed-key dispositions (9/9 accepted, 1 carrying a MINOR on its neighbours)

| key | verdict |
| --- | --- |
| `mobile.computers.wait.paused` | accept (N-1 polish) |
| `mobile.computers.wait.relay_version_sessions` | accept — accusative `one` arm is exactly right for `сообщает … и`; renders verified |
| `mobile.session.composer.retained_instruction` | accept — order and uncertainty preserved |
| `mobile.session.not_connected.next` | accept — `в списке сессий` is natural |
| `mobile.settings.about.blurb` | accept |
| `mobile.settings.account.delete_help` | accept — browser-only deletion and scope intact |
| `mobile.settings.sign_out.body` | accept — see safety table |
| `mobile.settings.sign_out.done` | accept — see safety table |
| `mobile.settings.text_size.following` | accept |

## Evidence record

Per-namespace records live in the mobile worktree's tracked evidence root:
`i18n/audits/evidence/ru/{mobile.common,mobile.computers,mobile.session,mobile.settings}/ru1111m1r2/`
— `record.json` (provenance, hashes, verdict, findings, mechanical results) and `report.md`,
with the shared `audit.log` in each bundle. There is no ledger **command** in this repo:
`i18n/ledger.json` and its per-`(locale, namespace)` rows live in the core repository, which
carries no `mobile.common` / `mobile.computers` / `mobile.session` / `mobile.settings`
namespace (verified: its 94 namespaces include only `mobile.setup` from the mobile app), so
the tracked per-namespace record bundle is this repo's ledger-equivalent — the same shape
the `vi` M1 bundles use.

## Limits — not claimed

- No rendered frame, no native build, no device: not this role. No `maxCells`/`maxChars`
  exists for any of the 53 keys (checked the four `en` context sidecars), so fit is a
  character-count judgement, not a measured one.
- Staged values are not in the tree, so `generate.ts`/`tsc` did not type-check them; landing
  must re-run `i18n:check`.
- One independent auditor for this round, no human native review; no other round-2 report
  was read, and no round-1 report was consulted beyond the dispositions quoted in
  `ru.v2-changes.md`.

## Ledger-row notes for the manager (≤280 chars each)

No ledger **command** exists for these namespaces in this repo, so the rows cannot be
written by this auditor. Candidate `note` strings, with the en source hash prefix each row
needs in `source_sha256` (full hashes in the matching `record.json`):

- `mobile.common` (en `b74466e8…`, 236 chars): `passed — ru mobile.common M1 r2 delta: independent audit of ru.v2 247837f4 (head 84c4bee1, en src b74466e8); 0 BLOCKER/0 MAJOR, 0 MINOR/0 NIT; auditor i18n-auditor/deepseek-flash; record i18n/audits/evidence/ru/mobile.common/ru1111m1r2/`
- `mobile.computers` (en `6ccd282a…`, 242 chars): `passed — ru mobile.computers M1 r2 delta: independent audit of ru.v2 247837f4 (head 84c4bee1, en src 6ccd282a); 0 BLOCKER/0 MAJOR, 1 MINOR/1 NIT; auditor i18n-auditor/deepseek-flash; record i18n/audits/evidence/ru/mobile.computers/ru1111m1r2/`
- `mobile.session` (en `fd14c208…`, 238 chars): `passed — ru mobile.session M1 r2 delta: independent audit of ru.v2 247837f4 (head 84c4bee1, en src fd14c208); 0 BLOCKER/0 MAJOR, 0 MINOR/1 NIT; auditor i18n-auditor/deepseek-flash; record i18n/audits/evidence/ru/mobile.session/ru1111m1r2/`
- `mobile.settings` (en `257daa34…`, 240 chars): `passed — ru mobile.settings M1 r2 delta: independent audit of ru.v2 247837f4 (head 84c4bee1, en src 257daa34); 0 BLOCKER/0 MAJOR, 2 MINOR/1 NIT; auditor i18n-auditor/deepseek-flash; record i18n/audits/evidence/ru/mobile.settings/ru1111m1r2/`

Each row: `status: passed`, `auditor.result: passed`, unresolved blocker/major 0,
`auditor.agent: i18n-auditor`, `auditor.model: deepseek/deepseek-flash`, date 2026-11-11;
the translator is `openai/gpt-6.1-sol`, session `48676ea694c1`, per `ru.v2-changes.md`.
