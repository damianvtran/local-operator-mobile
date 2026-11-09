# Independent Russian delta re-audit — `mobile.projects` (`ru29p1r2`)

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, no open finding. `unresolved_blocker_major_count = 0`.
Round-1 findings: **RU-PRJ-1 fixed byte-exactly, RU-PRJ-2 fixed with a shorter wording (verified),
RU-PRJ-3 and RU-PRJ-4 fixed byte-exactly.** Nothing remains open.

- **Audited head:** `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88` (branch `feat/i18n-russian`, worktree
  `/Users/damian/workspace/ru-wave`). The ru catalogue is committed at this head and the worktree is clean
  for it (`audit.log`, coda). No catalogue byte was edited by this audit; nothing was committed.
- **Auditor:** `i18n-auditor` (lopdev team), session `d598a29e6e64`. **Actual model `radient/auto`** after
  quota fallbacks from `anthropic/claude-sonnet-5-5` through `openai/gpt-6-astra` and `kimi/k3.1-pro`
  (session model-switch headers; every command in `audit.log` ran under the final model). Disclosed.
- **Independence:** different agent, session and context from the translator; not model-diverse (the
  translator's supplied model is also `radient/auto`), so independence is agent/session. No human
  native-speaker review and no rendered frame are claimed.
- **Inputs:** en `a598ddc4…6efc09` · context `5481687e…33eed99` · ru `fba4cec4…e249aa3` · 15 keys.
  The en and context files are byte-identical to round 1 (`ru29p1`; re-verified in `audit.log`).
- **Delta scope, proved not asserted:** inverting exactly the applied fixes reproduces the round-1 audited
  bytes' SHA-256 `ff9d265e…22022f6b` (`scope.py`, `SCOPE_EXACT` in `audit.log`). The delta is exactly the
  milestone `created` arm of `write_receipt`, `project_name_hint`, `session_state.missing` and
  `milestone_slash_note`; no other byte moved.

## Mechanical

`npm run -s i18n:check` → exit 0 (projection current, argument types from en/es/fr/**ru**/zh-CN;
284 baselined literals, 0 new). `vitest run src/i18n/__tests__/catalogues.test.ts` → 39 passed (39).
15/15 keys in en, ru and the sidecar; no missing, none extra; same order; no duplicate key; no context
gap. Every message parses; no unsanctioned parameter or arm difference (the six recorded `text → plural`
escalations persist, `sessions.live` and `milestones.count` among them); every plural carries
one/few/many/other; no bidi/zero-width characters; «ёлочки» and `…` only.

## RU-PRJ-1 — `write_receipt`, milestone `created` arm — FIXED, byte-exact

Executed through `writeReceipt(action, subject, kind)` for all 24 leaves (3 kinds × 8 codes, the eighth
being the unknown-code fallback). The milestone `created` arm now carries the prescribed bytes:

| code | milestone (ru) |
|---|---|
| created | **Создана веха** «payments-migration». |
| added | Добавлена веха «payments-migration». |
| updated | Обновлена веха «payments-migration». |
| removed / deleted | Удалена веха «…». |

`created` and `added` are now distinct in every kind, matching the project arm («Создан проект» /
«Добавлен проект») and keeping a one-to-one code→verb mapping. Every leaf carries `{subject}` in every
run; this round re-executed the four arms with a name containing a space («Q4 launch») and one
containing a slash («ship/v2») and both survive inside the «ёлочки» («Создана веха «ship/v2»»,
«Добавлен проект «Q4 launch»»).

## RU-PRJ-2 — `project_name_hint` — FIXED with a shorter wording (not byte-exact)

| | text |
|---|---|
| round 1 (defect) | От 1 до 64 символов: буквы, цифры, точка, подчёркивание или дефис. **Без пробелов, и не может** начинаться с дефиса. |
| prescribed | …дефис. **Пробелы не допускаются; дефис не может быть первым символом.** |
| shipped | …дефис. **Без пробелов. Имя не может начинаться с дефиса.** |

The defect round 1 filed was the `, и` join leaving the second clause without a subject; the shipped
three-sentence form removes the join and gives each rule its own sentence. Verified programmatically on
the shipped string: the length range (1–64), the alphabet, the no-spaces rule and the no-leading-hyphen
rule are all present and all state the same constraint as the English source — nothing was dropped,
added or weakened.

**Fit against the sidecar:** there is no numeric budget to breach. No `maxChars`/`maxCells` field exists
on any entry in this namespace's sidecar or in the catalogue schema (re-verified; the only
"Translator budget" notes in the repository are `relay.health`'s two state words and
`mobile.session_health.ended_placeholder`, none in this group), so the sidecar sets no limit for this
key. Against the slot it actually paints in — `project-create.tsx:224`, text-meta 12/500 inside the
sheet body's `px-4` content (288 pt at a 320 pt device), a `ScrollView` with no clamp — the shipped
hint measures **740.9 pt = 3 lines**, the same line count as en (594.7 pt, 3), fr (698.1 pt, 3) and es
(625.5 pt, 3). The prescribed two-clause alternative measured **842.4 pt = 4 lines**, i.e. the shipped
deviation fits better than the prescription. At 200 % text scale the shipped form is 6 lines vs 5 for
English and 6 for French; the body scrolls, so nothing clips.

## RU-PRJ-3 — `session_state.missing` — FIXED, byte-exact

Executed through `linkedSessionState({ role: "work", exists: false })` → **«не найдена»** (was
«отсутствует»), agreeing with the row's other state word «не запущена».

## RU-PRJ-4 — `milestone_slash_note` — FIXED, byte-exact

Executed through `milestoneSlashNote()` → «Имя вехи не может содержать косую черту — такую веху
**нельзя будет удалить**.» — the prescription exactly; consequence stated plainly, no mechanism.

## Regression sweep

`sessions.count`, `milestones.count` and `sessions.live` were re-rendered at 0/1/2/5/21/1.5 and match the
round-1 table byte for byte («0 сессий / 1 сессия / 2 сессии / 5 сессий / 21 сессия»;
«2 вехи из 5»; «5 сессий · 1 активна», «21 сессия · 21 активна»). `projectRowMeta`, both confirmation
bodies, the draft-kept note, the stale badge and `write_unknown_note` are untouched by the delta (proved
by the scope hash). The other three group-B namespaces were re-checked in the same run: notifications and
computers are byte-identical to round 1; schedules is covered in `ru29s1r2`.

## What was not verified

- No rendered frame, simulator or screenshot; widths are CoreText advances, not pixels (`widths.tsv`).
- No human native-speaker review.
- No second independent pass was requested for this delta; the round-1 second pass covered these same
  namespaces.

## Record

`i18n/audits/evidence/ru/mobile.projects/ru29p1r2/record.json`; `audit.log` is the executed group-wide
transcript (identical in the four delta bundles); `widths.tsv` and `verify.out.json` are its measurement
and harness outputs. The negative controls live in the schedules bundle (`ru29s1r2/control.txt`) and cover
this namespace too (the RU-PRJ-2 join).
