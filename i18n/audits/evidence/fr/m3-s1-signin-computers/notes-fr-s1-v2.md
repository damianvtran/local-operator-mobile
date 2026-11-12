# fr — M3 S1 (`mobile.computers` + `mobile.signin`), translation round 2

- Translator (fresh instance, NOT the original translator, NOT an auditor): `i18n-translator`,
  session `e79c854e0ab4`, model `deepseek/deepseek-flash` (the session's actual model; no
  fallback used, no role/model pin, no tool restriction).
- Locale: **fr only**. I did not audit my own output; an independent `i18n-auditor` must round 3.
- Date: 2026-11-12.
- Head under review: `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce`, worktree
  `~/local-operator-mobile/.worktrees/i18n-m3-s1` — **read-only here**; I edited no repo file,
  committed nothing, ran no install (only a read-only `import` of `src/i18n/messages.ts`).
  `git status --porcelain` was empty before and after.

## Inputs (all read this session)

| Input | Where | sha256 |
| --- | --- | --- |
| Original draft (v1) | `…/sessions/4270cae4ed9c/scratchpad/draft-fr-s1.json` | `07a54a5b9725f2d97f264e94b40eb2a5939e33f2a7d2e79187ffb41f5bf0c0bb` (matches the task) |
| Auditor report (findings A-01…A-05) | `…/sessions/7d94e65185a6/scratchpad/au-fr/report.md` | read in full |
| Translation brief (44 keys, role, notes) | `…/sessions/d5aaf8ba6ba5/scratchpad/translation-brief-s1.json` | read |
| fr style guide | `git -C ~/local-operator show origin/main:i18n/style-guides/fr.md` | read in full |
| Glossary | `git -C ~/local-operator show origin/main:i18n/glossary.md` | read in full |
| English sources + context sidecars | worktree `src/i18n/catalogues/en/mobile.{computers,signin}[.context].json` | read in full |
| Shipped fr corpus (consistency) | worktree `src/i18n/catalogues/fr/mobile.{computers,signin}.json` | read in full |
| Call sites | `src/features/auth/{computers,sign-in-panel,tunnel-paths}.tsx` | read |

## Method — how v2 was built without ever copying the v1 file

The v1 draft lives in another session's scratchpad, so I read it with the read tool and
**reconstructed it in this scratchpad**, then proved the reconstruction byte-identical against the
task's sha256 before touching anything (`build.py`): tab indent, trailing newline, and the four
separator bytes searched exhaustively as U+202F vs U+0020 were all recovered from the hash. The
proof printed `RECONSTRUCTION PROVEN sha256 = 07a54a5b…`. The line-level diff of v1 → v2 is then
exactly 4 lines removed, 4 added — the four remediated keys — so no unchanged value drifted.

## Decisions per finding

| ID | Sev | Key | Decision | Value shipped | Evidence / reasoning |
| --- | --- | --- | --- | --- | --- |
| A-01 | MAJOR | `mobile.computers.wait.listing` | **Accepted** (auditor's wording) | « En attendant que Radient liste votre ordinateur… » | The diagnosis holds: « en attente que » + subjunctive is not a French conjunctive locution — « en attente de » governs a noun only, which the same draft gets right in `panel.waiting` (« En attente de votre navigateur. ») and the shipped corpus in `stage_browser` and `wait.answering`. The conjunctive locution is « en attendant que » + subj. It also keeps the two things the English carries and the call site depends on (`computers.tsx` W1 shimmer; the panel comment says each line names "Radient listing the tunnel"): the wait, and Radient as the actor. Alternatives weighed and rejected: « Radient ajoute votre ordinateur à la liste… » (natural, but drops the waiting that the whole W1 state is about), « En attente de l'ajout de votre ordinateur par Radient… » (three stacked *de* + agent tail: heavy, un-French in a shimmer line), « Radient n'a pas encore listé… » (turns a neutral status into an accusation). « lister » is the dictionary verb and matches "list", so I did not inflate it to « ajouter … à la liste ». No `maxChars` is declared for this key and the host `Text` wraps (`Shimmer` → `Text className="text-body"`, no `numberOfLines`), so +9 glyphs cost height, never a clipped line. |
| A-02 | MINOR | `mobile.signin.panel.waiting_help` | **Accepted** (auditor's wording) | « Finalisez la connexion dans le navigateur, puis revenez à cette app. » | Real defect in the exact panel whose job is to say the sign-in is *pending*: « terminer une connexion » also reads "close the connection". Corpus evidence that the settled verb exists for this very step: `fr/mobile.signin.json` ships `stage_exchanging` = « Finalisation de la connexion dans le navigateur » — and that stage label is rendered by this same `sign-in-panel.tsx` region, so the help line now agrees with it instead of competing with it. Counter-evidence I checked and discounted: `signin.failed` ships « Nous n'avons pas pu terminer la connexion. » — but there « terminer » sits inside a negation and cannot be read as "hang up". |
| A-03 | MINOR | `mobile.computers.remove.body` | **Accepted** (auditor's wording) | « Il sera retiré de la liste de ce téléphone. Cela ne modifie ni l'ordinateur, ni son tunnel, ni votre compte. » | Both halves are right. (a) `remove.body` is the `body` of a `Dialog` with `destructive`, shown *before* the action — present passive « Il est retiré » states the removal as done; the future states the consequence being confirmed, which is the French confirm-dialog convention. (b) « ne touche ni l'ordinateur » uses *toucher* transitively, where the "affect" sense needs *toucher à*; French readers of this corpus also meet *toucher* as "tap" (`relay.health.ended_send_failed` : « touchez « Terminée » »), so the loose transitive use is worth removing. All three negations (computer / its tunnel / your account) survive, as the sidecar demands. « la liste de ce téléphone » keeps the shipped corpus phrasing (`added.stays_listed`). |
| A-05 | NIT | `mobile.computers.paths.own_body` | **Accepted** (auditor's wording) | « …puis vous collez l'adresse de ce tunnel ici. … » | « son » has two masculine candidates in reading order (« votre ordinateur » and « un tunnel »). The English is ambiguous too, so this is clarity, not a mistranslation — but the demonstrative is the standard French way to pick the nearer, correct antecedent and costs 13 glyphs in a wrapping card body (`tunnel-paths.tsx`: `Text className="text-body-sm"`, no `numberOfLines`). Rest of the value untouched: the U+202F before its colon, « Le parcours avancé », and the "no account / keep the password" clauses are as audited. |
| A-04 | NIT | `mobile.computers.status.provisioning` | **Rejected — kept** (the task did not request it; I found no evidence against it) | « provisionnement » unchanged | Evidence for keeping, not my taste: (1) it is the settled French term — FranceTerme defines *provisionnement* for exactly this sense, and Microsoft Learn `fr-fr` (Entra app provisioning) and IBM `fr-fr` both use it; the auditor's own note concedes "it is what French cloud vendors say". (2) The proposed « mise en place » is *two words* in a mono badge whose sidecar asks for "one word or short phrase", in the one width-critical row of the group (auditor's own fit run: French worst pair 211.0 px vs English 196.5 px on a 320 pt phone, already wrapping ~10 % earlier at 200 % text scale) — a two-word pill wraps earlier still. (3) No reader-facing ambiguity exists. A NIT with no defect and a measurable cost on the other side is not worth a change. |

Round-2 scope note: I touched **only** these four keys (plus A-04 explicitly kept). The other 39
values are byte-identical to v1 — proven by the hash-anchored reconstruction and the 4-line diff,
not asserted.

## Ambiguous strings and how I reasoned

- `wait.listing` — the hard one. The choice is between a verbal conjunctive phrasing
  (« en attendant que … ») and the corpus's nominal house pattern (« En attente de … »). The nominal
  pattern cannot name Radient as the actor without an ugly agent tail, and naming Radient is the
  point of the line (the sidecar: "the app is waiting for Radient to show the new computer in the
  account"; the call-site comment: "Radient listing the tunnel"). So the verbal form wins, and the
  ellipsis keeps the ongoing shimmer readable as "not yet".
- `remove.body` — "It does not touch the computer" is genuinely hard: the idiomatic French is
  *ne change rien à*, the terse correct one is *ne modifie ni*. I shipped the terse one because the
  guide asks for terseness and the parallel triple (« ni … ni … ni ») mirrors the English list; both
  are correct French. Recorded here because a round-3 auditor may reasonably prefer *ne change rien
  à*; that is a register preference, not a defect.
- `waiting_help` — "there" means the browser that just opened. French keeps « dans le navigateur »
  rather than a bare « là », which would be vaguer than the English.

## Glossary proposals (not applied — proposals only)

- **harness** — keep English in fr, as the draft and this slice do (« le harness Local Operator »);
  it names the product subsystem, and the fr guide's keep-English list has no row for it. Worth a
  §1/§2 row so later waves do not start translating it.
- **route** (control-plane route for a computer) — fr renders it « acheminement » in the shipped
  corpus (`status.route_ready` = « acheminement prêt »). Worth a §2 row: it is a per-locale call
  currently carried only by the shipped catalogue.
- **provisioning** — fr « provisionnement » (FranceTerme; Microsoft/IBM fr-fr). Worth a §2 row so a
  future audit does not re-litigate A-04.

## Validation actually run (output quoted, not paraphrased)

Repo parser = the worktree's own `src/i18n/messages.ts` (the parser the generator uses; a message
that does not parse fails generation), imported read-only by `verify.mjs`, which also enforces the
fr guide's typography (U+202F before `:`/`;`/`!`/`?`, U+2019, `…`, no ASCII quotes/ellipsis, no
double or trailing spaces):

```
files:
  draft-fr-s1-v2.json sha256 46dfc7cdcbe80e0afad9844df811e42d52d43748ed93219e567e1c33d95c48e7
  replacements-fr-s1.json sha256 62e4c906fe13407dea6afac4952ee24b7d41b00512ff64fb8523955d6c832c3a
keys: 44 (replacements: 4)
identical to en (informational): ["mobile.computers.row.a11y"]
param kinds per changed key:
  mobile.computers.wait.listing -> params [] (en [])
  mobile.computers.remove.body -> params [] (en [])
  mobile.computers.paths.own_body -> params [] (en [])
  mobile.signin.panel.waiting_help -> params [] (en [])
PASS: all 44 values parse with the repo parser, placeholder names+kinds match en, fr typography clean
```

(`mobile.computers.row.a11y` is `{name}, {status}, {reach}` — identical to English by design; the
auditor recorded the same. Keys carrying placeholders in this slice are unaffected by round 2: none
of the four changed values contains one, and all 40 other placeholder sets still match en
name-for-name and kind-for-kind.)

The repo's own `i18n:check` (`scripts/i18n/generate.ts --check && scripts/i18n/check-strings.ts`)
was **not** run: nothing in the worktree changed for it to check (it validates the committed
catalogues, not scratch files) and the worktree is read-only for this role — it is the coder's gate
when the v2 values land in `src/i18n/catalogues/fr/`.

## Context delta I hit mid-job (head moved under me)

The worktree was at `1796c3a5…` when this task named it and at **`a5593a79…`** when I finished:
`fix(i18n): localise the wait panel's tunnel status word instead of injecting the raw English one`
(5 files, all under `src/features/auth/`; **no** `src/i18n/catalogues/en/` and **no**
`src/i18n/messages.ts` change — `git diff --name-only 1796c3a5..a5593a79` confirms, so the English
sources, the sidecars and the parser my verification used are byte-identical to what the round-1
draft was written against). My `verify.mjs` import therefore ran against the same parser.

One premise behind a key **I did not change** is now stale, and the manager should know:
`mobile.computers.wait.tunnel_status` no longer receives Radient's raw English word — the new
`tunnelStatusKey()` maps it to `badge.active` / `status.{provisioning,suspended,disabled,revoked,unknown}`,
i.e. the fr catalogue's own labels. The sidecar note "inserted verbatim and NOT translated" no longer
describes the code. **The shipped fr value still works**: « Radient dispose du tunnel — {status}. »
is an apposition on « le tunnel » (masculine singular) and all six mapped fr labels are masculine
singular (actif, provisionnement, suspendu, désactivé, révoqué, inconnu), so the sentence agrees in
every branch. I left it alone — the task authorised only the four flagged keys — and flag it here as
a row a round-3 audit may want to *confirm* rather than as a defect.

## Files in this scratchpad

- `replacements-fr-s1.json` — **{key: new_value}**, only the 4 changed keys, in brief order
- `draft-fr-s1-v2.json` — all **44** keys, v1 order, 4 values replaced
- `notes-fr-s1-v2.md` — this file
- `build.py`, `apply.py` — the hash-anchored reconstruction and the replacement pass
- `verify.mjs` — the parser + typography gate
- `log.txt` — the commands and their actual output

Worktree after my run: `git status --porcelain` empty, HEAD `a5593a79…`; nothing written outside this
scratchpad (no repo file, no commit, no install).

