# Independent French audit, round 4 — mobile.projects, delta of one key (fr29p4)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT. Unresolved blocker/major count = 0.**
The round-3 finding **P3-01 is resolved** in both locales, verified by executing the app's own
parser and renderer, not by reading the diff. P3-02 is closed by the same change. The key is clean
at `615b24f`.

- **Auditor:** `i18n-auditor`, `lopdev` team child session `a95ed4b473ca`.
- **Actual model in force: `radient/auto`**, after the provider-quota descent reported in this
  transcript — `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` →
  `radient/auto`, each switch reported as `provider failure: quota`. The pinned Sonnet model did
  not run this audit. Recorded in `record.json`.
- **No native-speaker review, no rendered frame, and no translation service** is claimed or used
  anywhere in this bundle. Every quoted string below is executed output from `audit.log` §5.

## What changed since the round-3 bundle (fr29p3, head `49f79b3`)

| Input | at `49f79b3` | at `615b24f` |
|---|---|---|
| `en/mobile.projects.json` | `4ecd274b…`, 172-char value: `{action, select, …} {subject}.` | `a598ddc4…`, 574-char value: `{kind, select, project {{action, select, …} {subject}.} milestone {{action, select, …} milestone {subject}.} other {{action, select, …} {subject}.}}` |
| `en/mobile.projects.context.json` | `37f6dac5…` | `5481687e…` |
| `fr/mobile.projects.json` | `cdf1a5c1…`, 173-char value: `{action, select, …} {subject}.` | `48c868a9…`, 580-char value: `{kind, select, project {Projet {subject} {action, select, …}.} milestone {Jalon {subject} {action, select, …}.} other {{subject} {action, select, …}.}}` |

The change is one commit, `615b24f fix(i18n): name the receipt's subject kind so French can order
and inflect it`: the key gains a third parameter `kind` (select `project | milestone | other`) and
the `action` select is repeated inside every kind arm so each locale can place the verb where its
grammar wants it. The five call sites stop composing the English phrase `milestone ${name}` and
pass the bare name plus the `milestone` code. `projects-copy.ts` gains `ReceiptKind` and the
third argument; the generator's parameter list gains `kind: string`.

## Mechanical evidence (executed; full output in `audit.log`)

1. **Gate.** `npm run -s i18n:check` → exit 0, `catalogue.gen.ts is current (120 keys, 7
   namespaces, argument types from en, fr)`; `check-strings: 284 finding(s), all baselined; 0 new`.
2. **JSON and key sets** (`checks.py` §A–B): all three files valid JSON, no duplicate keys, 15 en /
   15 context / 15 fr keys; `en == fr` and `en == ctx` key sets true; **no key added or dropped**
   since `49f79b3`.
3. **Structure, from the app's own `parseMessage`** (`audit.log` §5 §2–§3): both locales declare
   `{action: select, subject: text, kind: select}` — the parameter sets agree name-for-name and
   kind-for-kind. The root `kind` select has exactly `project`, `milestone`, `other` in both
   locales, and **every one of the three arms contains all seven action codes plus `other`** —
   `en.project 7, en.milestone 7, en.other 7, fr.project 7, fr.milestone 7, fr.other 7`. A
   brace-scanned raw-text check (`checks.py` §C) agrees with the AST and shows the arm bodies: en
   milestone `… milestone {subject}.`, fr milestone `Jalon {subject} …`, fr project `Projet
   {subject} …`, fr other `{subject} …`. Nested `select` inside `select` parses and renders.
   Neither value contains a `plural`, so no CLDR category can be missing here; neither carries markup,
   a Rich tag, a backtick span, a command, a flag, a path or an identifier — the only literal text is
   the two nouns and the participles.
4. **Byte-level arms** (`checks.py` §D): every code maps to exactly one expected word per locale —
   en `Created/Completed/Reopened/Added/Updated/Removed/Deleted`, fr
   `créé/terminé/rouvert/ajouté/mis à jour/retiré/supprimé`; the new inner arm set repeats the old
   seven English words exactly (§E).
5. **All seven codes × three kinds × both locales** rendered through `renderFor`, the function `t()`
   calls (`audit.log` §5 §4). A sample of the twenty-one rows:

   | kind | code | en | fr |
   |---|---|---|---|
   | project | created | `Created payments-migration.` | `Projet payments-migration créé.` |
   | project | updated | `Updated payments-migration.` | `Projet payments-migration mis à jour.` |
   | project | deleted | `Deleted payments-migration.` | `Projet payments-migration supprimé.` |
   | milestone | completed | `Completed milestone Brief de lancement.` | `Jalon Brief de lancement terminé.` |
   | milestone | added | `Added milestone Brief de lancement.` | `Jalon Brief de lancement ajouté.` |
   | milestone | removed | `Removed milestone Brief de lancement.` | `Jalon Brief de lancement retiré.` |
   | other | deleted | `Deleted Audit Q4.` | `Audit Q4 supprimé.` |

   **French leakage: none.** A case-insensitive scan for the seven English verbs and the noun
   `milestone` finds nothing in any rendered French row (`english-in-fr=false` on all 21), and a
   token scan of every output (`audit.log` §5 §10) reports `fr-foreign=[]` and `en-foreign=[]` on
   all 21 rows. The literal token `milestone` occurs once in the French VALUE, as an ICU option
   label (`…}} milestone {Jalon {sub…`), which is a machine code and never a rendered branch —
   `checks.py` §F prints that context so the raw count cannot be misread.
6. **Fallbacks** (`audit.log` §5 §5): unknown action code `archived` → en `Updated X.` / fr
   `Projet X mis à jour.` (project), `Updated milestone X.` / `Jalon X mis à jour.` (milestone);
   unknown kind `workspace` → en `Deleted X.` / fr `X supprimé.` — the `other` arm, no invented noun.
7. **Tests.** `npx vitest run src/i18n src/features/projects` → 6 files, **98 tests passed**. The
   new assertions pin per-code English project and milestone receipts and per-code French project
   and milestone receipts, plus both `other` fallbacks.
8. **Typecheck.** `npx tsc --noEmit` → exit 0, so every call site supplies the new third argument
   (`audit.log` §7).

## English byte-compatibility — stated precisely

The pre-change message was `{action} {subject}.` and the screens passed the rendered English verb;
the add/edit/remove milestone paths passed the composed phrase `milestone ${name}`. Both old
subjects are taken from `git show 49f79b3:` (`audit.log` §6), and the old message is rendered here
from its own text rather than assumed (`audit.log` §5 §6).

| Reachable call site | old English output | new English output | identical |
|---|---|---|---|
| created (project) | `Created payments-migration.` | `Created payments-migration.` | **yes** |
| deleted (project) | `Deleted payments-migration.` | `Deleted payments-migration.` | **yes** |
| added (milestone) | `Added milestone Brief de lancement.` | `Added milestone Brief de lancement.` | **yes** |
| updated (milestone) | `Updated milestone Brief de lancement.` | `Updated milestone Brief de lancement.` | **yes** |
| removed (milestone) | `Removed milestone Brief de lancement.` | `Removed milestone Brief de lancement.` | **yes** |
| completed (milestone) | `Completed Brief de lancement.` | `Completed milestone Brief de lancement.` | no — **by design** |
| reopened (milestone) | `Reopened Brief de lancement.` | `Reopened milestone Brief de lancement.` | no — **by design** |

Read the table's first five rows as the compatibility contract: **project receipts are
byte-identical for all seven codes**, not merely the two reachable ones (the message itself
renders `{verb} {subject}.` for every arm), and **milestone receipts for `removed`, `added` and
`updated` are byte-identical** to the old `{action} milestone {subject}.` output.

Rows six and seven are the intentional change. It is **acceptable and honest, not a regression**:

- It is **additive and truthful**. The old sentence `Completed Brief de lancement.` never named what
  was completed — a reader seeing two milestones could not tell whether a project or a milestone
  had been completed. The new sentence does, and it uses the same noun ordering the sibling
  receipts (`Added milestone X.`, `Updated milestone X.`, `Removed milestone X.`) already shipped,
  so English stays internally consistent.
- **Nothing becomes false, ambiguous or truncated.** The sentence grows by ten characters (29 → 39
  for `completed`, 28 → 38 for `reopened`); the toast's `Text` has no `numberOfLines` and wraps
  (`src/ui/components/toast.tsx`), and the key declares no `maxCells` (`checks.py` §G), so nothing
  clips.
- **It is disclosed, not smuggled.** The new wording is asserted per code in
  `projects-copy.test.ts`, described in the key's context note, and named here. It is a deliberate
  user-visible English copy change riding a translation fix; a report that called the whole commit
  byte-identical would be wrong, and this one does not.
- The one requirement it must meet — that the *project* shape, and the composed-noun milestone
  shape, did not move — holds exactly (rows one to five).

## French grammar, idiom and typography

The round-3 risk is gone rather than moved: the participle is now preceded by a masculine singular
noun the catalogue itself supplies (`Projet`, `Jalon`), so it can never disagree with arbitrary user
text. `créé`, `terminé`, `rouvert`, `ajouté`, `retiré`, `supprimé` are masculine singular forms and
`mis à jour` is the invariant form — all correct after both nouns. `retiré` vs `supprimé` keeps the
distinction the confirmation bodies already draw (« Retirer {name} de ce projet ? Le jalon sera
définitivement supprimé. »), and `jalon` is the word the rest of the French catalogue uses for this
object.

Native read of the worked examples, exactly as executed (`audit.log` §5 §8):

- « **Projet payments-migration supprimé.** » and « **Jalon X retiré.** » are idiomatic telegraphic
  status lines: the thing named first, the participle last — the natural French order for this
  fragment. The verb-first calque (« Supprimé projet payments-migration. ») is not what ships.
- Register: the style guide asks for terse statuses that are bare past participles rather than
  « a bien été … » sentences; these are exactly that, with no article added and no courtesy padding.
- **Uniqueness of the pattern:** all twenty-one rows are one of three shapes — `Projet {subject}
  {participle}.`, `Jalon {subject} {participle}.`, `{subject} {participle}.` — so the reader never
  meets two orders for the same receipt.
- Capitalisation: sentence-initial `Projet` / `Jalon`, lowercase participles mid-sentence — French
  sentence case, no Title Case.
- Punctuation and spacing: one final full stop, a single U+0020 between the noun, the subject and
  the participle; no double space, no trailing space, no apostrophe at all (so the U+2019 rule has
  no site). The key contains **zero U+202F** and **zero U+00A0** — correct, because the espace fine
  insécable is required before `: ; ! ?` and these sentences carry no such mark (`checks.py` §F).
- Bidi/control: **none**; `fr` is LTR and the `ur` RTL rules do not apply here (`checks.py` §F).
- The `other` arm (« Audit Q4 supprimé. ») is a fragment with no noun; see NIT P4-N1.

## Call sites

Every caller passes a **code** and a **bare name**, never a composed phrase (`audit.log` §6):

- `project-create.tsx:152` — `writeReceipt("created", answer.project.name, "project")`
- `project-detail.tsx:171-175` — `writeReceipt(completing ? "completed" : "reopened", milestone.name, "milestone")`
- `project-detail.tsx:231-235` — `writeReceipt(editor.editingName === null ? "added" : "updated", name, "milestone")`
- `project-detail.tsx:254` — `writeReceipt("removed", name, "milestone")`
- `project-detail.tsx:278` — `writeReceipt("deleted", project.name, "project")`

The old composed subject `milestone ${name}` appears nowhere at the audited head — `grep -rn 'milestone
${name}' src/features/projects` returns nothing — and `subject` is the relay's bare name at every
one of the five call sites.

## Findings

### P3-01 — MAJOR, round 3 — **RESOLVED**

Round 3 found that `project-detail.tsx` passed `` `milestone ${name}` `` as the subject, so a French
screen rendered « Retiré milestone X. » — an English noun inside a French sentence. The current
bytes render « **Jalon X retiré.** » and « **Projet payments-migration supprimé.** »; no French row
of the twenty-one contains `milestone` or any English verb (`audit.log` §5 §4 and §10). Resolution
is at the right layer: the noun and the word order moved into the catalogue, and the screen passes
the `milestone` code.

### P3-02 — MINOR, round 3 — **RESOLVED**

The round-3 asymmetry (the toggle receipts named no object) is closed by the same change: the
completed/reopened receipts now read `Jalon Brief de lancement terminé.` and
`Completed milestone Brief de lancement.` — the object is named in both locales.

### P4-N1 — NIT — `mobile.projects.write_receipt`, French `other` arm (a participle with no noun to agree with)

`kind: "other"` renders « `{subject}` supprimé. » with no noun, so nothing anchors the participle's
gender or number: a future caller that routes a feminine or plural subject (`Session X`) through
`other` would render « Session X supprimé. » where French wants « supprimée ». **Not reachable
today** — no call site passes `other`, and `ReceiptKind` is a closed union — and English has the
same shapeless fallback (`Deleted X.`). If `other` ever gains a caller, name the noun
(« Élément {subject} {action}. ») or avoid an agreeing participle. No change requested for this
round.

### P4-N2 — NIT — test coverage of the `other` kind arm

The `RECEIPT_VERBS` loop exercises the project and milestone arms for all seven codes, but the
`other` arm is asserted once per locale (`deleted` only). A future action added to the project and
milestone arms but forgotten in `other` would silently fall back to `mis à jour` / `Updated` rather
than fail. Extending that loop over `other` would make the guard total. No change requested for this
round; recorded so the next person adding a code sees it.

## Second independent pass

**Not performed this round.** Round 3 ran one (`reviewer` job `e4c88d8f7509`, same `radient/auto`
model), and its finding is precisely what this round verifies as fixed. `mobile.projects` is not in
the high-visibility set named in the auditor brief (onboarding, errors, settings), the manager did
not request a second pass, and the delta is 21 fixed strings whose correctness is now proved by
execution rather than by opinion. This is disclosed so a clean round-4 verdict is not mistaken for
two independent reads.

## Recording boundary

This repository has **no `i18n/ledger.json`, no audit-ledger command and no
`i18n/audits/evidence/README.md` contract file** (`docs/i18n.md` records the report in the pull
request; `i18n/audits/evidence/` contains the locale bundles only). The durable record is this
bundle. No keyed public-copy receipt is claimed: this namespace has no credential-shaped key, and
the wave's one credential-shaped key (`mobile.computers.password_placeholder`) had its clean-core
route refused in an earlier round. English context sidecars are not routable through the keyed
public-copy reader and were read as ordinary worktree files.

**Style-guide provenance.** The mobile tree carries no style guide, so the fr guide and the glossary
were read from the core repository checkout (`~/local-operator/i18n/`, last commit touching the file
`24d328a19a8`). That checkout's working copy carries an uncommitted, staged removal of nine lines
(the wave-2 `bearer` note and a recorded width exception), so the file read is `b916f3d1…` while the
committed blob is `49010212…`; both hashes are recorded in `record.json`. The two removed passages
are not a rule this audit applied — formality, register, plural categories, punctuation and width
all come from unchanged sections, and the committed blob was diffed against the working copy to
confirm that.

**No native-speaker review and no rendered frame are claimed.** Fit statements rest on executed
character counts (`audit.log` §5 §11: longest French row 37 cells, longest English row 39; project
rows run up to 1.37× their English counterparts, milestone rows run shorter), never on pixels.
