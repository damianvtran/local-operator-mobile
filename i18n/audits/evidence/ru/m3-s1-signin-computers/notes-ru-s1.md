# ru — M3 S1 (mobile.signin + mobile.computers) translator notes

Locale: `ru` · Slice: M3 S1 · Keys: 44 (mobile.signin 14, mobile.computers 30)
Draft: `draft-ru-s1.json` · sha256 `815be1ace06b0fe3ed87e8f86f352355f5962e57dcd063f449817a690bc71270`
Brief: `sessions/d5aaf8ba6ba5/scratchpad/translation-brief-s1.json` (sha256 prefix
`531e6edd8e5f9af5` verified; every `english` field compared byte-for-byte with
`src/i18n/catalogues/en/*.json` at worktree head `1796c3a5` — 44/44 identical, no skew).
Sources read: `i18n/style-guides/ru.md` + `i18n/glossary.md` (core repo `origin/main`),
mobile `docs/i18n.md`, `AGENTS.md`, `src/i18n/messages.ts` (the ICU subset), the en
catalogues + `*.context.json` sidecars, and the existing ru catalogues
(`mobile.computers`, `mobile.signin`, `mobile.common`, `mobile.chrome`, `mobile.settings`,
`relay.*`) for terminology.

## Register and mechanics (from the style guide)

- **вы**, lowercase mid-sentence; no "Вы" letter register, no "ты".
- Impersonal where Russian allows: «Не удалось…», «в удалённом доступе будет отказано»
  rather than «мы …».
- Buttons: infinitive («Удалить», «Обновить», «Начать заново»), except the two
  contrast labels, see below. Sentence case everywhere; lowercase badges kept
  lowercase (ru has case, so the en lower-case badge convention is reproduced
  deliberately: «маршрут готов», «отвечает»).
- Typography: «ёлочки» for quoting controls (not needed in these 44), em dash with
  spaces, ellipsis `…`, no space before `:`.
- Product/brand tokens kept Latin and undeclined: `Local Operator`, `Radient`, `URL`.
- Terminology reused, not reinvented: туннель · ретранслятор (relay) · маршрут (route) ·
  адрес · пароль · аккаунт · компьютер · сессия · устройство · консоль Radient · вход.

## Per-key rationale (only where a choice was made)

- `computers.not_harness` — «На этом компьютере не запущен Local Operator.» The
  concept "harness" has no settled Russian word, and the neighbouring ru string
  `harness_help` already renders it as «включите Local Operator» (product name, no
  calque). Coining «харнесс» here would give one concept two names in the same
  screen; the product name carries it. **Deliberate elision, flagged below.**
- `computers.wait.listing` — «Ждём, пока Radient добавит ваш компьютер в список…»
  Progress shimmer: the ru stage vocabulary uses noun phrases for diagnostics, but a
  shimmer that names the actor reads better as a live sentence, and «список» is the
  word the screen's own heading uses («Ваши компьютеры» + list). Ellipsis kept.
- `computers.wait.tunnel_status` — «Туннель на стороне Radient: {status}.» `{status}`
  is an untranslated English status word, so it is parked after a colon rather than
  inside a Russian agreement slot (a dash would read as an aside, and «туннель —
  active» is ambiguous about which is the state). Colon keeps the token verbatim and
  the sentence grammatical for any value Radient sends.
- `computers.wait.answered` — «Компьютер ответил.» The possessive is dropped, matching
  the existing `wait.answering` → «Ожидание ответа компьютера.», which drops it the
  same way.
- `computers.own_tunnel_instead` — «Свой туннель вместо Radient». English says
  "instead"; a bare «Использовать свой туннель» would collide with
  `paths.own_action` on a different surface and lose the contrast the note asks for.
  Naming Radient is the shortest way to keep "instead" without a second clause.
- `computers.paths.recommended` — «Рекомендуем» (badge). «Рекомендуется» is 4 cells
  longer for the same meaning; the 1pl verb is standard product-badge Russian.
- `computers.paths.radient_body` — "private, authenticated URL" → «закрытый URL с
  аутентификацией»; "nothing to configure … no relay password to keep" →
  «настраивать … нечего и пароль от ретранслятора хранить не нужно» (keeps the honest
  cost sentence and the account requirement unchanged).
- `computers.paths.own_body` — «Продвинутый путь: … Аккаунт Radient не понадобится ни
  на одном этапе, а пароль остаётся у вас.» Double negation is the idiomatic Russian
  for English "no … at any point"; "advanced" is kept explicit («Продвинутый путь»).
- `signin.panel.opening` / `panel.waiting` — «Открытие браузера…» / «Ожидание
  браузера.» Noun phrases to match the existing stage vocabulary in this namespace
  (`stage_browser` is already «Ожидание браузера»); the same string is reused for the
  hand-off headline, which is the same state and therefore the same words.
- `signin.panel.unavailable_alt` — «Подключиться всё равно можно — по адресу
  ретранслятора и паролю.» Keeps "still" («всё равно») and points at the manual route;
  «ретранслятор» is the glossary rendering of relay.
- `signin.try_anyway` — «Всё равно попробовать» (quiet retry despite the likely
  failure); short, imperative.
- `computers.status.*` / `reach.answering` — lowercase mono badges: маршрут готов ·
  настраивается · приостановлен · отключён · отозван · неизвестно · отвечает. Each is
  a state word, not a sentence, and none is capitalised.
- `computers.row.a11y_active` / `_connecting` end with the same words as
  `badge.active` («активен») and `badge.connecting` («подключается») — as the sidecar
  requires, so the row's accessible name and the visible marker agree.
- `computers.billing_inactive` — «Оплата этого туннеля неактивна, поэтому в удалённом
  доступе будет отказано.» Impersonal passive, matching the guide's preference.

## Judged identical to English (kept byte-identical, deliberate)

| Key | Value | Why |
|---|---|---|
| `mobile.computers.row.a11y` | `{name}, {status}, {reach}` | Pure placeholder structure: no prose word to translate. The comma-and-space separation is punctuation, not copy; the parts themselves ({name}, {status}, {reach}) arrive already translated. Any change of separator would only desynchronise it from `row.a11y_active`/`_connecting`. |

Nothing else is identical to English (no brand-only or loanword-only strings among the
44; `Radient` and `Local Operator` appear only inside translated sentences).

## Width risks (measured, phone width)

| Key | en cells | ru cells | Note |
|---|---|---|---|
| `computers.status.suspended` | 9 | 13 | longest badge; pairs with `reach.answering` (8) → 21 cells in the two-badge row vs 18 for en. The badge is `mono` meta type in a flex row, no `numberOfLines` cap, so it wraps rather than truncates — but it is the tightest pair in the slice. No shorter accurate synonym: «на паузе» would misdescribe a billing suspension. |
| `computers.status.provisioning` | 12 | 13 | pairs with `reach.answering` → 21 cells (en 21). |
| `computers.status.unknown` | 7 | 10 | badge only. |
| `computers.own_tunnel_instead` | 25 | 27 | quiet text button at the screen bottom; ru runs long, this is +2 only. |
| `computers.wait.use_computer` | 17 | 27 | primary button; «Использовать этот компьютер» is the shortest faithful rendering (no shorter verb fits the "use" sense). |
| `computers.try_now` | 7 | 18 | banner action; «Попробовать сейчас» keeps "now"; dropping it («Попробовать») would lose the immediacy the note gives it. |

No string was truncated; nothing was shortened to the point of losing meaning.

## Plurals

None of the 44 keys takes a plural argument in English (`{status}`, `{name}`, `{reach}`
are text placeholders), so no one/few/many/other branches are introduced here. The
generator confirms the ru values keep the same argument kinds as the source (text), which
is the only direction the parity rule allows to stay unchanged.

## Glossary proposals (append to `i18n/glossary.md` §2 when the wave lands)

- **tunnel** → translate → «туннель» (ru). Already used throughout the ru catalogues
  (`billing_help`, `disabled_help`, `nothing_answered_help`); record it so a future
  wave cannot render it as «канал» or leave it Latin.
- **route** → translate → «маршрут» (ru). Used by `status.route_ready` and the existing
  `wait.host_answering` («Настроенный маршрут…»).
- **sign-in** → translate → «вход» (ru), noun; the verb is «войти». Existing
  `mobile.signin.*` stage words already settle this.
- **harness** → keep as the product name, not a calque (ru): «Local Operator» carries
  it; do **not** introduce «харнесс». Recorded because this slice needed the concept
  in `not_harness` and would otherwise be translated twice, differently.
- **computer** → translate → «компьютер» (ru); "machine" in `welcome.body` rendered
  «машина», as the source switches words deliberately.

## Validator output (actually run)

Method: copied the worktree's `src/i18n` + `scripts/i18n` into session scratch
(`ru-validate/`), merged the draft into `catalogues/ru/`, and ran the repository's own
generator — the same code `npm run -s i18n:check` runs first.

```
$ node scripts/i18n/generate.ts
Wrote src/i18n/catalogue.gen.ts (734 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
$ node scripts/i18n/generate.ts --check
src/i18n/catalogue.gen.ts is current (734 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
CHECK_EXIT=0
```

That covers key-set parity for ru, ICU parsing of all 44 values with the runtime parser,
placeholder-name/kind parity against English, and projection of the ru strings into
`catalogue.gen.ts` (spot-checked: «Свой туннель вместо Radient» present).

Honest scope of the run, so nobody reads it as more than it is:

- The generator `fail()`s on the FIRST disagreeing locale, and every other shipped
  locale (es, fr, hi, ur, vi, zh-CN) has no M3 S1 keys yet — the slice is English-first.
  To let the fail-fast loop reach `ru`, those locales were filled with their **English
  source values** in that throwaway copy only. That fill is not a translation and is not
  in the draft; ru's own validation (parity, parse, argument kinds) is genuine and is
  what the run above proves.
- `npm run -s i18n:check` also runs `check-strings.ts`, which scans the app source for
  unflagged literals. It is unaffected by a catalogue draft, and it cannot run against a
  copied fragment of the tree, so it is left to the lane that applies the draft in the
  real worktree.
- Nothing was written to the repository or the lane worktree: the draft is scratch only,
  as briefed. The `status: translated` ledger entry is the applier's commit.

## Model

This run: `deepseek/deepseek-flash`. No translation service, SDK or MT site was used;
every value above was written by reasoning in this session against the style guide,
glossary and existing ru catalogues.
