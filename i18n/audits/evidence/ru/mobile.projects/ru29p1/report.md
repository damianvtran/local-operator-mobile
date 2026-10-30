# Independent Russian audit — `mobile.projects` (`ru29p1`)

**Verdict: `passed`** — 2 MINOR, 2 NIT. `unresolved_blocker_major_count = 0`.

- **Audited head:** `ba39018c493dda114d42a6b4d9dfbf337f4110f5` (branch `feat/i18n-russian`, worktree `/Users/damian/workspace/ru-wave`).
  The tree carries `M src/i18n/catalogue.gen.ts` and `?? src/i18n/catalogues/ru/`: the ru directory is
  untracked at this commit (`git ls-tree HEAD -- src/i18n/catalogues/ru` is empty, executed in `audit.log`),
  so the audited target bytes are pinned by `input_hashes.target.sha256`, not by the commit.
  `catalogue.gen.ts` is modified and in sync — `i18n:catalogue:check` passes.
- **Auditor:** `i18n-auditor` (lopdev team), session `3cb03947a304`. **Actual model `radient/auto`.** This request
  began on `anthropic/claude-sonnet-5-5` and fell back through `openai/gpt-6-astra` and `kimi/k3.1-pro` on
  provider quota before reaching `radient/auto`; every command in `audit.log` ran under the final model.
  Disclosed, not hidden.
- **Independence:** a different agent, session and context from the translator. Not model-diverse — the
  translator's supplied model is also `radient/auto` — so independence is agent/session, disclosed rather
  than closed. No human native-speaker review and no rendered UI frame are claimed.
- **Inputs:** en `a598ddc447a47476a54dc0510b156fd4d35d27bf15d79b44850a65a4bf6efc09` · context `5481687e7c4c089cf9ec39175630a5f3f5dd686c041561aceb671083933eed99` · ru `ff9d265e5c074d8e05847f95d017981f95399434258a74804b9f09b592022f6b` · 15 keys.
- **Ledger:** not recorded — this repository has no i18n ledger and no audit-ledger command at this head
  (executed in `audit.log`); `docs/i18n.md` makes the pull request's report the artifact of record.
  A row is proposed in `record.json`, not written.

## Mechanical (self-verified, not just the repo validator)

`npm run -s i18n:check` exits 0 (projection current, 284 baselined literals, 0 new). The repo validator does
**not** compare placeholders or CLDR arms across locales, so every key was compared itself:

- 77/77 keys across the four group-B namespaces (this one: its own `key_count` in `record.json`); no key
  missing, none extra, authoring order identical; no
  duplicate key in the JSON text (counted separately from `JSON.parse`, which would silently collapse one).
- Every message parses through the app's own `parseMessage`; no missing or extra parameters; no
  parameter-kind change outside the six `text -> plural` escalations that `generate.ts` parameter-parity
  explicitly sanctions (each listed in `record.json`); every ru plural carries exactly
  one/few/many/other; every select node keeps the source's arm set including `other`; `#` appears only
  inside a plural.
- 12/12 negative controls tripped the check they target — the same `auditPair()` function that passed the
  catalogue fails a dropped placeholder, a renamed one, a missing `few`, a non-ru category, a missing
  `other`, a rewritten select arm, a bidi control, an ASCII ellipsis, straight quotes, a double space, a
  literal `#`, and an unparseable message. A check that cannot fail is not evidence.
- Typography: «ёлочки» only, `…` only, no double or edge spaces, no bidi/zero-width characters.

`vitest run src/i18n/__tests__/catalogues.test.ts` reports 1 failed / 37 passed: the failure is
`catalogues.test.ts:187` expecting the catalogue directories to equal `SHIPPED_LOCALES`, and ru is still in
`NOT_YET_SHIPPED_LOCALES`. That is the designed directory-vs-shipped gate, not a copy defect — the shipping
change must flip the list.


## The receipt — 24 executed arms, and the name cannot go missing

`writeReceipt(action, subject, kind)` is the real function; it was called for all 3 kind arms × 8 action
arms (7 codes + the `other` fallback) = 24 leaves, plus an unknown kind and an empty action:

| kind | created | added | updated | removed | deleted |
|---|---|---|---|---|---|
| project | Создан проект «payments-migration». | Добавлен проект «…». | Обновлён проект «…». | Удалён проект «…». | Удалён проект «…». |
| milestone | **Добавлена веха** «…». | **Добавлена веха** «…». | Обновлена веха «…». | Удалена веха «…». | Удалена веха «…». |
| other | Создано «…». | Добавлено «…». | Обновлено «…». | Удалено «…». | Удалено «…». |

Every one of the 24 leaves carries `{subject}` (asserted in the harness, `name✓` on each line of
`audit.log`), including a name with a space («Q4 launch») and a name with a slash («ship/v2»). The `other`
kind keeps the name and drops the noun, exactly as the sidecar asks. The empty-subject render
(«Обновлён проект «».») is unreachable from the screen (`subject` is the stored name) and is recorded only so
the sentence shape is on the page; it is not a finding.

The only defect in the block is the milestone `created` arm, which renders the same word as `added`
(RU-PRJ-1): the project arm distinguishes the two codes, the milestone arm does not.

## Plurals

| key | 0 | 1 | 2 | 5 | 21 | 1.5 |
|---|---|---|---|---|---|---|
| `sessions.count` | 0 сессий | 1 сессия | 2 сессии | 5 сессий | 21 сессия | 1.5 сессии |
| `milestones.count` (of 3) | 0 вех из 3 | 1 веха из 3 | 2 вехи из 3 | 5 вех из 3 | 21 веха из 3 | 1.5 вехи из 3 |
| `sessions.live` (base 5) | 5 сессий · 0 активны | 5 сессий · 1 активна | 5 сессий · 2 активны | 5 сессий · 5 активны | 5 сессий · 21 активна | 5 сессий · 1.5 активны |

`sessions.live` pluralises on `{live}` while keeping `{base}` a plain placeholder — the shape the
`milestones.count` sidecar prescribes for a locale whose noun agrees, and the reason the generator types
`{live}` as a number (the strictest kind, `generate.ts`). The feminine agreement («1 активна», «21 активна»)
is with сессия and is right. `sessions.live` is only rendered when the live count is above zero
(`sessionCountLabel` returns the base at ≤ 0), so «0 активны» belongs to `monitors_armed`, not here.

Note the contrast with the English source: `milestones.count` has no plural in English, so an English row
reads «1 of 1 milestones»; the ru pluralisation removes that defect in this locale rather than importing it.

## The composed row and the confirmations

`projectRowMeta` executed for five shapes: «2 вехи из 3 · 5 сессий · 2 активны», «21 веха из 30 · 21 сессия ·
1 активна», «вех нет · 5 сессий», «1 веха из 1 · 1 сессия · 1 активна», «5 вех из 7 · 21 сессия · 21 активна».
The join is « · » in both locales, the zero case reads as a fragment («вех нет») exactly as the sidecar
requires (no final full stop), and the line is the one clamped slot in the group: the longest audited
shape is 215.8 pt of 288 pt at text-meta, so nothing truncates (see `record.json.fit`).

`deleteProjectBody` and `removeMilestoneBody` rendered with three names, including a name with spaces and
one with a slash:

- `Удалить «payments-migration»? Строка проекта исчезнет навсегда. Связанные сессии и их транскрипты не затрагиваются.`
- `Удалить веху «ship/v2» из этого проекта? Веха исчезнет навсегда. Сессии проекта и его строка прогресса не затрагиваются.`

Both halves of each confirmation survive (what goes, what stays), the «ёлочки» wrap the user text, and
neither sentence can be read as a request to confirm twice. «строка проекта»/«строка прогресса» is core's
own word for a row (`tui.projects_edit.remove_needs_row` — «выберите строку вехи»), so it is not a calque.

## Row vocabulary

`linkedSessionState` executed: coordination → «завела работу»; a link whose directory is gone →
«отсутствует»; `stopped` → «не запущена»; `live` → `live` (the relay's word passes through untranslated —
an application gap recorded under out-of-scope, not a catalogue defect). «завела» is feminine because the
row nouns are сессия and the sibling state word «не запущена» agrees the same way; the fragment does not
imply the row is a worker.

## Findings

### RU-PRJ-1 — MINOR — `mobile.projects.write_receipt`

- current: `milestone arm: created {Добавлена веха}`
- replacement: `milestone arm: created {Создана веха}`
- why: Executed over all 24 leaves (3 kind arms x 8 action arms): `created` and `added` both render «Добавлена веха», so the receipt cannot say which code fired, while the project arm keeps them apart («Создан проект» / «Добавлен проект»). «Создана веха» restores the one-to-one code->verb mapping and matches the project arm; no other arm changes.

### RU-PRJ-2 — MINOR — `mobile.projects.project_name_hint`

- current: `От 1 до 64 символов: буквы, цифры, точка, подчёркивание или дефис. Без пробелов, и не может начинаться с дефиса.`
- replacement: `От 1 до 64 символов: буквы, цифры, точка, подчёркивание или дефис. Пробелы не допускаются; дефис не может быть первым символом.`
- why: The second sentence joins a nominal fragment («Без пробелов») to a clause with «, и», so the clause («не может начинаться с дефиса») is left without a subject. The sidecar records that this sentence is the reader's only warning before a refusal, so each rule should stand as its own clause.

### RU-PRJ-3 — NIT — `mobile.projects.session_state.missing`

- current: `отсутствует`
- replacement: `не найдена`
- why: The row's other state words agree with сессия («не запущена») or name what happened to it; «отсутствует» is genderless and bureaucratic, and core's word for a session that is gone is «пропала» (relay.asks.error.session_gone_list). «не найдена» states the same fact in the register of the row.

### RU-PRJ-4 — NIT — `mobile.projects.milestone_slash_note`

- current: `Имя вехи не может содержать косую черту — такую веху не удалось бы удалить.`
- replacement: `Имя вехи не может содержать косую черту — такую веху нельзя будет удалить.`
- why: «не удалось бы удалить» stacks a subjunctive onto a perfective infinitive; «нельзя будет удалить» states the same consequence plainly.


## What this audit did not do

- No rendered frame, no simulator, no screenshot: widths are font metrics (see `record.json.fit`), and the sentences are the app's own renderer over the audited bytes.
- No human native-speaker review. The auditor is an LLM reading as a native-fluent user.
- A second independent pass was performed by a separate reviewer agent over all four group-B namespaces; its agreement, the finding it contributed and the one it proposed that this audit rejected on executed evidence are recorded in `record.json.second_pass`.

## Record

`i18n/audits/evidence/ru/mobile.projects/ru29p1/record.json` is the machine-readable record; `audit.log` is the executed transcript
(group-wide: it covers all four group-B namespaces, unfiltered).
