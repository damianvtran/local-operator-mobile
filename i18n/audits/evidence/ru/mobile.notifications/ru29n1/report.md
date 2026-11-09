# Independent Russian audit — `mobile.notifications` (`ru29n1`)

**Verdict: `passed`** — 0 findings. `unresolved_blocker_major_count = 0`.

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
- **Inputs:** en `c6e58c6129727513a00b0c67abdfc6cd5284d326792f00886767a26a60778064` · context `240ec6befb692d72ac51a346fbc70a6f79e5853ae03f62ce25654d81db7f21e6` · ru `d3370e5eb37200607c6321218624718b34ca2dff6a1b3d684248cb252dcd1ecf` · 14 keys.
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


## Every key, executed

`t()` renders each of the 14 keys (runtime in the scratch copy with ru shipped):

| key | ru |
|---|---|
| `answer` | Ответить |
| `back` | Назад |
| `detail.answer_in_conversation` | Ответить в беседе |
| `detail.conversation_asks` | Вопросы этой беседы |
| `detail.earlier_updates` | Прошлые обновления |
| `detail.from` | Источник |
| `detail.no_asks` | В этой беседе нет вопросов. |
| `detail.nothing_to_dismiss` | В этой беседе нет обновлений, которые можно скрыть. |
| `detail.projects` | Проекты |
| `dismiss` | Скрыть |
| `filter_label` | Показать |
| `load_failed` | Не удалось загрузить уведомления |
| `priority_high` | Важно |
| `title` | Уведомления |

## The ask noun — resolved against core, not guessed

The brief asked whether an ask is «вопрос» or «запрос». Core uses both, for different things, and the
split is stable:

- **The item is «вопрос»**: `relay.notifications.detail.kind` renders `{kind, select, ask {Вопрос} …}`;
  `relay.asks.pending.question_of` = «Вопрос {index} из {total}»; `relay.asks.status.expired` = «этот
  вопрос слишком старый»; `relay.asks.sheet.empty` = «вопросы агента появятся здесь».
- **«запрос» is the approval request** — `relay.chrome.session.tray.approve_label` = «Одобрить — вас ждёт
  запрос», `relay.asks.gate.notice_auto` = «…инструменты с одобрением выполняются без запроса» — and it also
  labels the TUI inbox's category (`tui.notifications.kind_asks` = «запросы»).

The notification detail lists the asks raised in one conversation, i.e. items — so «Вопросы этой беседы»
and «В этой беседе нет вопросов.» are right, and they match core's phone-facing catalogue
(`relay.notifications`, the same inbox) rather than the TUI's category word. No finding.

## Four section words match core exactly

`detail.from` = «Источник» (`relay.notifications.detail.section.from`), `detail.earlier_updates` =
«Прошлые обновления» (`.section.history`), `priority_high` = «Важно» (`relay.notifications.row.high`),
`dismiss` = «Скрыть» (`relay.notifications.confirm.dismiss`). `load_failed` is core's `error.load` with the
alert-title full stop dropped, as the sidecar asks.

## Register and fit

«Ответить»/«Скрыть» are imperative infinitives, one word each; «Показать» is the accessible label of the
segmented control (not a visible button), «Назад» the icon button's label. Sentence case throughout, «ёлочки»
not needed here, no ASCII punctuation. Widths: the widest string is
`detail.nothing_to_dismiss` at 376.4 pt of 288 (2 lines, unclamped, same 2 lines as English); the priority
badge is 44.2 pt in a 272 pt pill.

## Findings

None. Nothing in this namespace is proposed for change.

## What this audit did not do

- No rendered frame, no simulator, no screenshot: widths are font metrics (see `record.json.fit`), and the sentences are the app's own renderer over the audited bytes.
- No human native-speaker review. The auditor is an LLM reading as a native-fluent user.
- A second independent pass was performed by a separate reviewer agent over all four group-B namespaces; its agreement, the finding it contributed and the one it proposed that this audit rejected on executed evidence are recorded in `record.json.second_pass`.

## Record

`i18n/audits/evidence/ru/mobile.notifications/ru29n1/record.json` is the machine-readable record; `audit.log` is the executed transcript
(group-wide: it covers all four group-B namespaces, unfiltered).
