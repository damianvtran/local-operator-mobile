# Independent Russian audit — `mobile.computers` (`ru29c1`)

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
- **Inputs:** en `356f10123aa96d48169552395506cd9b1f2e3b50955bfd363624fd2371930643` · context `3ac04e8333c94e9d419a144bcf08b3ce40ea54b88acc153a9caa1789ba40b6a5` · ru `bb37e91fb78c6f9bf230910d6ab53e19e294ac10b23a89366678f8b745f46600` · 10 keys.
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

| key | ru |
|---|---|
| `add` | Добавить компьютер |
| `added.stays_listed` | Он останется в списке на этом телефоне — переключиться обратно можно из списка компьютеров. |
| `badge.active` | активен |
| `badge.connecting` | подключается |
| `connecting` | Подключение… |
| `none_on_phone` | На этом телефоне пока нет компьютеров. |
| `password_placeholder` | Пароль из lop mobile |
| `section.not_connected` | В вашем аккаунте Radient — не подключены |
| `section.on_phone` | На этом телефоне |
| `switch` | Сменить компьютер |

## Checks that were exercised

- **`lop mobile` is byte-identical** in the placeholder; the field's placeholder is the command the reader
  types in a terminal and it is kept Latin and undeclined (guide § product-name policy).
- **Radient** is a product name and stays untranslated in `section.not_connected`.
- **The two badges keep the guide's shape**: lower case, one word each («активен», «подключается»), matching
  the sibling badge in English (`active`, `connecting`). Measured at text-mono-label 11/600 +0.06em: 50.2 pt
  and 89.0 pt in a 272 pt pill, so neither can clip.
- **`connecting` keeps the ellipsis character** (`…`, not `...`), one word plus ellipsis.
- **`added.stays_listed`** keeps the reassurance and its consequence: «Он останется в списке на этом
  телефоне — переключиться обратно можно из списка компьютеров.» The feminine/masculine antecedent is not an
  issue: «Он» is компьютер, and «переключиться обратно» makes clear the sentence is about the computer you
  came from, not the one just connected.
- **`section.not_connected`** is an elliptical header («В вашем аккаунте Radient — не подключены»); «не
  подключены» agrees with the computers the section lists, and the dash construction is standard for a
  header that sets a scope before its verdict.
- **Register**: «вашем» (вы), imperative infinitive labels («Добавить компьютер», «Сменить компьютер»),
  sentence case, no full stops on buttons or headers, full stops on the two sentences.

No defect is proposed in this namespace.

## Findings

None. Nothing in this namespace is proposed for change.

## What this audit did not do

- No rendered frame, no simulator, no screenshot: widths are font metrics (see `record.json.fit`), and the sentences are the app's own renderer over the audited bytes.
- No human native-speaker review. The auditor is an LLM reading as a native-fluent user.
- A second independent pass was performed by a separate reviewer agent over all four group-B namespaces; its agreement, the finding it contributed and the one it proposed that this audit rejected on executed evidence are recorded in `record.json.second_pass`.

## Record

`i18n/audits/evidence/ru/mobile.computers/ru29c1/record.json` is the machine-readable record; `audit.log` is the executed transcript
(group-wide: it covers all four group-B namespaces, unfiltered).
