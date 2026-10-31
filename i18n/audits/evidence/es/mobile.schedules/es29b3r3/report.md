# Third-round verification — `mobile.schedules` (Spanish) · `es29b3r3`

**Verdict: PASSED.** Round 2's three findings are shipped byte-identically to the strings it
asked for, nothing else in the file moved, and every mechanical check re-run here is green.
One **non-translation** blocker exists on the branch (a stale U-08 content pin) and is recorded
in §5 — it does not change the audit verdict, and it is not mine to fix (read-only).

| | |
|---|---|
| locale | `es` |
| namespace / file group | `mobile.schedules` |
| branch | `feat/i18n-spanish` |
| audited head | `bc770cea33d8d4265b1105baad53a5bb5a482ef2` |
| audited worktree | `/Users/damian/workspace/es-wave` (clean; audited bytes are committed bytes) |
| audit date | 2026-10-30 |
| auditor | i18n-auditor (lopdev team), session `0c96bc62035b` |
| actual model | **`radient/auto`** — temporary provider fallback, disclosed in full below |
| previous round | `es29b3r2` → `changes_requested` (1 major, 1 minor, 1 nit) |
| this round | `passed`, 0 blocker, 0 major |

**Model provenance.** The session header for every command in `audit.log` is `radient/auto`.
The session opened on `anthropic/claude-sonnet-5-5`, hit a provider quota failure and fell back
`openai/gpt-6-astra → kimi/k3.1-pro → radient/auto` before the first command; no earlier hop
produced any evidence used here. Rounds 1 and 2 also served `radient/auto`, so this is session
independence from the translator and from both earlier rounds, **not model diversity** — the
same limitation both earlier bundles recorded.

---

## 1. Disposition of the round-2 findings

Round 2 requested three exact replacements (`es29b3r2/report.md` §§ES-SCH-6..8). This round
re-derived the expected strings **by parsing those rows out of the round-2 report** — nothing was
retyped by hand — and compared them to the values in
`src/i18n/catalogues/es/mobile.schedules.json` at `bc770ce`
(`audit.log` §8, `verify_remediation.py`).

| id | sev. | key(s) | requested (round 2) | shipped at `bc770ce` | byte compare | status |
|---|---|---|---|---|---|---|
| ES-SCH-6 | major | `state.stale` | `obsoleto` | `obsoleto` | identical, 8 chars | **closed** |
| ES-SCH-7 | minor | `gone.monitors` | `Ya no está — su conversación ya no existe en esta máquina, así que nada la comprueba` | same | identical, 84 chars | **closed** |
| ES-SCH-7 | minor | `gone.wakes` | `Ya no está — su conversación ya no existe en esta máquina, así que nada lo dispara` | same | identical, 82 chars | **closed** |
| ES-SCH-8 | nit | `empty.body` | tail `; cada monitorización vigila una cosa y avisa de lo que cambia.` with "the rest of the value unchanged" | full value identical to prefix-at-`f1c782f` + requested tail | identical, 212 chars | **closed** |

Why each closure holds, independently of the byte match:

- **ES-SCH-6.** `state.stale` is reached only from `wakeDueWord` (`src/features/schedules/schedules-copy.ts:362-363`),
  i.e. a **wake** row — `el despertar`, masculine — so `obsoleto` agrees. The monitor state words
  in the same file stay feminine (`desactivada`, `inactiva`, `caducada`) because their noun is
  `la monitorización`; the file is now grammatical in both families. Core's committed es uses the
  same word for the same state (`local_operator/i18n/catalogues/es/tui.review.json:41`,
  `tui.review.lane_stale` = `obsoleto`), so the word is also the programme's vocabulary.
- **ES-SCH-7.** The stutter is gone by execution, not by assertion: the round-2 line contains
  `ya no está` **twice** (once capitalised), the head line **once**, plus `ya no existe` once
  (`audit.log` §6, negative control (a), reading the pre-fix value out of `git`). `ya no existe`
  is also how core's es phrases an absent conversation
  (`relay.asks.card.gone`: "esta conversación ya no existe"), and it is a closer rendering of
  the English "is no longer on this machine".
- **ES-SCH-8.** The distributive singular now carries the class ("cada monitorización vigila una
  cosa y avisa de lo que cambia"), which is how Spanish phrases a property held by each member;
  the rest of the two-sentence help string is byte-unchanged.

**Delta containment.** Between the round-2 head `f1c782f` and `bc770ce` the es schedules file
changes on exactly **4 lines / 4 keys** — the three findings (ES-SCH-7 spans two keys) and
nothing else; no other `src/i18n/catalogues/es/` file changed in that range
(`audit.log` §8; `git diff --stat f1c782f..bc770ce -- src/i18n/catalogues/` = one file, 4+/4−).
So the remediation did not disturb a key it was not asked to touch.

---

## 2. Mechanical checks re-run at this head

All executed in this session; the output is in `audit.log`, not quoted from round 2.

| check | command / probe | actual result |
|---|---|---|
| repository validator | `node scripts/i18n/generate.ts --check` | exit 0 — `catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr)`; `es` is in `SHIPPED_LOCALES`, so the projection is generated *from* the es bytes |
| strings validator | `node scripts/i18n/check-strings.ts` | 284 findings, all baselined, **0 new** |
| namespace tests | `npx vitest run src/i18n/__tests__ src/features/schedules` | **6 files, 152 tests passed** (round 2 recorded 151; the head commit adds the es-resolution test) |
| key parity | `probe.mjs` §1 | **38/38**, no missing, no extra, **same order as en** |
| ICU parse | `probe.mjs` §2 | 38/38 parsed, **0 failures** |
| placeholder names | `probe.mjs` §2 | **identical in 38/38** |
| placeholder kinds | `probe.mjs` §2 | 4 keys are `text` in en and `plural` in es: `summary.monitors_armed:{count}`, `summary.monitors_attention:{broken}`, `summary.wakes:{count}`, `tail.failed:{count}` — the same accepted promotion round 2 recorded and the French wave ships; both kinds take a number, `generate.ts` merges argument kinds and fails only on a plural/select clash, and the renders below prove the plural path formats correctly |
| CLDR plural arms | `probe.mjs` §3 | 8 plural messages, **every one carries `one`/`many`/`other`**, 0 non-es categories, **0 arms dropped vs en** |
| `{total}` retention | `probe.mjs` §4 | present in **all three** arms of `summary.monitors_attention` (`args=["total"]` in `one`, `many`, `other`) |
| attention agreement | `probe.mjs` §5, §7 | `broken=1, total=40` → **`1 de 40 requiere atención`**; `broken=2, total=40` → **`2 de 40 requieren atención`** |
| `truncated`, both families | `probe.mjs` §6, §7 | `wakes` → "…con despertares."; `monitors` → "…con monitorizaciones." for 3/9, 1/9, 1/1, 200/500 |
| counted nouns | `probe.mjs` §7 | 0/1/2/1 000 000 render correctly for `count.monitors`, `count.wakes`, `summary.monitors_armed`, `summary.wakes`, `show_more.*`, `tail.failed` (`1 monitorización`, `1000000 de monitorizaciones`, `1 fallo`, `1000000 de fallos`) |
| shipped projection | `e2e.mjs` | 38/38 namespace keys present in the es projection; **no projection byte differs from the catalogue file**; 12/12 sampled renders served from **es**, 0 fell back to en; none of the sampled keys renders byte-identical to English |
| mechanical sweep | `probe.mjs` §9 | 0 bidi controls, 0 markup/backticks, 0 double spaces, 0 space-before-punctuation, 0 `!`, em dash ` — ` in all 4 values that use one, rendered terminal punctuation matches en in every key |
| negative controls | `probe.mjs` §10, `run-all.sh` §7b | the **pre-fix** catalogue fails the byte comparison on all four keys; removing `many` is caught and renders `1000000 monitorizaciones`; dropping `{total}` is caught by name parity; the ungrammatical control at `broken=1` renders `1 de 40 requieren atención` |

**Note on the validator.** The repository validator no longer skips `es` — it is a shipped locale
at this head — so `generate.ts --check` compares the es bytes with en key-for-key. It is green.

---

## 3. Accuracy, idiom, terminology (second pass)

Every one of the 38 values was re-read against the English source and its context note, twice:
once as a diff reader (the 4 changed keys and their neighbours) and once as a whole-file read,
looking for collateral damage in the 34 unchanged ones. Findings: none at blocker or major.

Checked explicitly, because they are the failure modes that matter in status and error copy:

- **Polarity.** Every negation in English has one in Spanish and none was added:
  `read_error.monitors/wakes` ("No se pudieron leer…"), `supervisor.not_running`
  ("…no se ejecuta… no se dispararán"), `supervisor.unsupported` ("aún no se supervisan…"),
  `supervisor.unverifiable` ("Nada supervisa…"), `empty_line.*` ("No hay…").
- **Safety.** Nothing in the namespace is destructive or permission-bearing: the strongest
  statements are "could not be read", "will not fire" and "nothing checks it", all of which are
  accurate rather than softened or hardened.
- **Terminology (glossary §2 + es style guide).** `monitorización` (binding) in all 9 values that
  name a monitor; `despertar` for wake; `programación` for schedule (`read_unreachable`);
  `conversación` consistently for the entry's conversation (never `sesión`, which the glossary
  reserves for a session). Formality is **tú** throughout: the one tú imperative
  (`Pide a un agente…`), the one first-person plural (`no hemos podido`), action labels in the
  infinitive (`Mostrar menos…`) as the guide requires; no `usted`, no `vosotros`.
- **Typography.** Angle-free em dash with spaces, no space before `; : ? !`, no `¡`/`¿` on
  fragments, `…` only where the source has one (nowhere in this namespace), Latin digits.
- **Register of the three fixes.** `obsoleto` in a wake row reads as the row's state word, not as
  an adjective on a feminine noun; `Ya no está — su conversación ya no existe…` no longer repeats
  the verb phrase; `cada monitorización vigila una cosa y avisa de lo que cambia` now has the
  distributive singular a Spanish reader expects after "una cosa".

Two things I looked at and **did not** raise as findings (recorded so the next round does not
have to rediscover them):

1. `truncated` at `total=1` renders `Mostrando 1 de 1 conversaciones` — ungrammatical number
   agreement. It is *not* a translation defect: the English source is `Showing 1 of 1
   conversations`, with the same defect, because `{total}` is a plain placeholder in both
   locales. Fixing it means a source-side plural on `{total}` and a caller change, which is a
   different change from this delta; negotiating it here would have held a clean round hostage
   to an English-source rewrite.
2. `head.next` (`{head} · próximo {label}`) is as compressed as the English `next {label}`;
   it reads as a fragment by design, alongside the count phrase, and rounds 1 and 2 accepted
   it. Nothing changed in it here.

**Fit.** This namespace declares no `maxCells`/`maxChars` hint (only `relay.health` and
`mobile.session_health` do in this repo). The three shipped strings move by **+0, +2, +2 and −3
characters** against the round-2 values (measured, `audit.log` §8), so the layout is materially
where round 2 measured it: `Ya no está — …` was 515 pt over 2 lines and `empty.body` 1438 pt
over 6 lines at 100 %, both wrapping sentences with no one-line clamp on them. I did **not**
re-run the font-metric measurement: this is a read-only session and the harness rule forbids
scratch dependency installs, so the honest statement is "character delta on a measured baseline",
not "re-measured pixels". No string here clips by construction — `numberOfLines` appears only on
the entry name in `schedules.tsx`.

---

## 4. Verdict

**`passed`** — no blocker and no major remains in `mobile.schedules` (es) at `bc770ce`.
Round-2 findings ES-SCH-6, ES-SCH-7 and ES-SCH-8 are closed with the exact bytes requested.
Because this is a high-visibility group, the second pass in §3 was run after the byte check and
produced no new finding.

---

## 5. Branch-state observation — **not** a translation finding

The branch is **red at this head** on a gate the repo's own test run executes, and it is the same
gate code review round 1 raised (the U-08 content-identity guard). It is *not* caused by the
catalogue: the U-08 pins cover `src`, and the head commit's own new test file lives under `src`.

- **Reproduction:** `npx vitest run tools/audit/u08-content-pins.test.ts` →
  **3 failed | 31 passed**: `render-tree src pinned=9bfcc365…316f488 actual=c26144d1…a916646`.
  `vitest.config.ts` includes `tools/**/*.test.ts`, so `pnpm test` fails the same way.
- **Attribution (executed, `pin-attrib3.py`):** the committed pin `9bfcc365…` is the `src` digest
  of **`e2e9f30`** — the *parent* of the head commit — not of `bc770ce`
  (`c26144d1…`). The head commit added 12 lines to `src/i18n/__tests__/runtime.test.ts` *after*
  the pin it ships was computed, which invalidated it. It is a stale re-pin, not a content
  problem: the U-08 proof itself is not being asked to accept approximate content, it is being
  told the wrong baseline.
- **Why I did not fix it:** my brief for this round is read-only — no edits, no commits. The fix
  is one line and belongs to the implementer: run `node tools/audit/u08-content-pins.ts --print`
  **at the head** and commit the resulting `src` pin (with the reason in the comment, as the
  table's convention already does). Reverting the new test instead would delete the assertion
  code review round 1 asked for.

This affects mergeability, not the Spanish copy. The audit verdict stands as `passed`.

---

## 6. Recording

- **No audit-ledger command exists in this repository.** There is no `i18n/ledger.json` and no
  ledger/receipt script under `scripts/i18n/` (`audit.log` §9: `ls` exit 1, and the declared i18n
  scripts are `i18n:generate`, `i18n:catalogue:check`, `i18n:strings:check`, `i18n:check`). The
  RFC's ledger row is therefore **proposed and explicitly unwritten** in `record.json`, with its
  ≤280-character note. This bundle is the artifact of record, as `docs/i18n.md` prescribes
  ("the pull request records that report").
- **Evidence bundle:** `i18n/audits/evidence/es/mobile.schedules/es29b3r3/` —
  `record.json` (provenance and results), `report.md` (this file), `audit.log` (actual command
  output), plus the executed scripts as `.txt` companions.
- **Read-only:** no catalogue, source or git state was modified. The bundle is written untracked
  and left **unstaged/uncommitted**; `git status` shows only this directory. The round-1
  (`es29b3`) and round-2 (`es29b3r2`) bundles are untouched.

## 7. Limits

- An LLM auditor's judgement in one locale, one session — **not** a native-speaker human review.
- No rendered frame: no simulator, no screenshot, no browser; fit is a character delta on round
  2's font-metric baseline, not a pixel measurement.
- Model identity is **not diverse** from rounds 1 and 2 (all `radient/auto`); independence is
  session-level and is disclosed rather than claimed as closed.
- Round 3 is a verification round: the delta and its direct neighbours were judged in depth, the
  unchanged keys were re-read for collateral damage rather than re-litigated.
