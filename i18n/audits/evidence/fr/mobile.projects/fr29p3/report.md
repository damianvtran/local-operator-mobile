# Independent French audit, round 3 — mobile.projects, delta of one key (fr29p3)

**Verdict: `changes_requested` — 0 BLOCKER, 1 MAJOR (P3-01), 1 MINOR (P3-02), 0 NIT. Unresolved blocker/major count = 1.**
The **catalogue value is correct in both locales**; the MAJOR is at the call sites that feed it, where
an English object noun still reaches a French receipt. `mobile.projects` is not clean at these bytes.

Round 3 is a **delta re-audit of one key**, `mobile.projects.write_receipt`, whose mechanism changed
from a plain `{action}` placeholder (that screens filled with an English verb) to a `select` over
seven codes plus `other`. The other 14 keys of the namespace are **not** re-judged: reverting the one
changed string in each of the three files reproduces the round-2 hashes byte-for-byte
(`audit.log` §4).

- **Auditor:** `i18n-auditor`, team child session `78c640379596`.
- **Actual model in force: `radient/auto`**, after a provider-quota descent observed in this
  transcript — `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` →
  `radient/auto`; each switch reported as `provider failure: quota`. The pinned Sonnet model did not
  run this audit. Recorded in `record.json`.
- **No human native-speaker review, no rendered frame, and no translation service is claimed or
  used anywhere in this bundle.**

## What changed

| Locale | Bytes at `49f79b3` | sha256 |
|---|---|---|
| en | `{action, select, created {Created} completed {Completed} reopened {Reopened} added {Added} updated {Updated} removed {Removed} deleted {Deleted} other {Updated}} {subject}.` | `4ecd274b…` |
| fr | `{action, select, created {Créé} completed {Terminé} reopened {Rouvert} added {Ajouté} updated {Mis à jour} removed {Retiré} deleted {Supprimé} other {Mis à jour}} {subject}.` | `cdf1a5c1…` |

The English context note changed with them: `{action}` is now "a stable CODE the screen selects …
and never a rendered word: the catalogue turns the code into the verb, so each locale supplies its
own. other catches an unknown code as Updated."

Provenance: the arms were authored in commit `49f79b3` (a fix commit, not the translator's session).
The namespace's original French is `i18n-translator` session `c66311717837` (`kimi/k3.1-pro`, as
recorded by round 1/2 — not observed by this auditor).

## Mechanical evidence (executed; full output in `audit.log`)

1. **Gate.** `npm run -s i18n:check` → exit 0, `catalogue.gen.ts is current (120 keys, 7
   namespaces, argument types from en, fr)`; `check-strings: 284 finding(s), all baselined; 0 new`.
   Valid JSON, no duplicate keys, 15 en / 15 context / 15 fr keys, no key added or dropped.
2. **Arms, read by the app's own parser** (`parseMessage`, the parser the generator also uses):
   both locales declare the same eight option keys —
   `added, completed, created, deleted, other, removed, reopened, updated` — with parameters
   `action: select` and `subject: text`. Every code has an arm in both locales; no code is missing,
   none is extra, and `other` is present in both (a `select` without `other` would be invalid).
3. **All seven codes rendered through the production path** (`renderFor`, which is what `t()` calls),
   plus the unknown-code fallback, executed output:

| code | en | fr | English verb in fr? |
|---|---|---|---|
| created | `Created payments-migration.` | `Créé Projet X.` | no |
| completed | `Completed payments-migration.` | `Terminé Projet X.` | no |
| reopened | `Reopened payments-migration.` | `Rouvert Projet X.` | no |
| added | `Added payments-migration.` | `Ajouté Projet X.` | no |
| updated | `Updated payments-migration.` | `Mis à jour Projet X.` | no |
| removed | `Removed payments-migration.` | `Retiré Projet X.` | no |
| deleted | `Deleted payments-migration.` | `Supprimé Projet X.` | no |
| other (unknown code) | `Updated payments-migration.` | `Mis à jour Projet X.` | no |

4. **English is byte-identical to the old mechanism for all seven.** The pre-change message was
   `{action} {subject}.` and the screens passed the rendered English verb (`"Created"`, `"Deleted"`,
   … — read from `git show 79b3fad:` in `audit.log` §5, not assumed). Rendering the old message with
   each verb and the new message with each code gives the same strings, all `identical=true`.
5. **French arms.** Seven distinct arms; all are correct past participles with correct accents;
   `Retiré` vs `Supprimé` keeps the distinction the two confirmation bodies already draw; `Rouvert`
   is the standard participle. Invariable masculine is right here: `{subject}` is arbitrary user text
   whose grammatical gender the app cannot know, and in the verb-first receipt the participle is a
   status label rather than predicated on the subject — agreement would only become obligatory if the
   order flipped to « Projet créé », which the fixed `{select} {subject}.` shape does not allow.
   `other {Mis à jour}` mirrors the English design and is the least-wrong claim for an unknown code.
6. **Tests.** `npx vitest run src/i18n src/features/projects` → 6 files, 97 tests passed.

## Call sites

Every caller passes a **code**, never a rendered word (`audit.log` §5):

- `project-create.tsx:152` — `writeReceipt("created", answer.project.name)`
- `project-detail.tsx:171` — `writeReceipt(completing ? "completed" : "reopened", milestone.name)`
- `project-detail.tsx:227-230` — `writeReceipt(editor.editingName === null ? "added" : "updated", \`milestone ${name}\`)`
- `project-detail.tsx:249` — `writeReceipt("removed", \`milestone ${name}\`)`
- `project-detail.tsx:273` — `writeReceipt("deleted", project.name)`

The action side is clean. The **subject** side is not — P3-01.

## Findings

### P3-01 — MAJOR — `mobile.projects.write_receipt` call sites (an English noun inside the French receipt)

Executed render of the real call-site subjects:

```
added    -> Ajouté milestone Brief de lancement.
updated  -> Mis à jour milestone Brief de lancement.
removed  -> Retiré milestone Brief de lancement.
```

`project-detail.tsx:227-230` and `:249` pass the template literal `` `milestone ${name}` `` as
`{subject}`; the renderer interpolates it verbatim and the toast stores it verbatim
(`ui-store.ts` `showToast`). The verb is French now — the commit's stated purpose — but the object
noun is still English, so three of the five receipts a French reader sees are half-translated. This
is the same defect class the key was reshaped to close, surviving in the other placeholder, and it is
a break rather than jargon: the French catalogue's own word is **jalon** (seven occurrences in
`fr/mobile.projects.json`).

Suggested fix — localize the noun once, in copy, instead of composing it in the screen:

- add `mobile.projects.milestone_subject`: en `milestone {name}`, fr `jalon {name}`, and have both
  call sites pass `t("mobile.projects.milestone_subject", { name })` as the subject; or
- give the milestone write its own receipt key with the same arms and a `{name}` parameter.

Either keeps every English rendering unchanged (`Added milestone X.`) and makes the French receipt
fully French (`Ajouté jalon Brief de lancement.`). The existing regression guard cannot catch this:
`ENGLISH_RECEIPT_VERBS` in `projects-copy.test.ts` matches verb words only, and every French
assertion there passes `subject: "Projet X"`, never a real subject — so a test with a milestone
subject belongs with the fix.

### P3-02 — MINOR — `mobile.projects.write_receipt` (the object is named inconsistently)

`project-detail.tsx:171` passes the bare `milestone.name`, so the toggle receipts read
`Terminé Brief de lancement.` / `Rouvert Brief de lancement.` — fully French, but the reader is not
told what was completed, while the add/edit/remove path does name it (in English). The asymmetry
exists in English too (`Completed Brief de lancement.`), so it is not introduced here; the same
localized milestone subject used by all five milestone actions closes both findings at once.

## Second independent pass

A `reviewer` subagent — job `e4c88d8f7509`, launched on this session's model selection after the
primary's quota failure, actual model `radient/auto` (self-reported) — read the same style guide,
glossary, sidecars, call sites and bytes without being shown my analysis. It reached the **same two
findings at the same severities** (MAJOR for the English `milestone` noun, MINOR for the naming
asymmetry) and independently confirmed: all seven arms correct and natural before a project name,
`other` sensible, participles correctly invariable, English renderings unchanged. Agreement here is
two independent executions of the same checks, not one opinion echoed.

## Judgement on the audited value

The catalogue delta is **sound**: seven codes, seven correct French participles, no English verb in
any arm, a sensible `other`, a note that now describes codes rather than rendered words, and English
output that did not move. What is not sound is the subject plumbing the change touches: a French
reader still sees `milestone` in three receipts. Hence `changes_requested` on the delta as a whole,
with the catalogue arms themselves passed.

## Recording boundary

This repository has **no `i18n/ledger.json` and no audit-ledger command** (`docs/i18n.md` records the
report in the pull request; `i18n/audits/evidence/` has no README contract file). The durable record
is this bundle. No keyed public-copy receipt is claimed: this namespace has no credential-shaped key,
and the wave's one credential-shaped key (`mobile.computers.password_placeholder`) had its clean-core
route refused.

**No native-speaker review and no rendered frame are claimed.** Fit statements rest on executed
character counts, never on pixels. The self-reported reviewer model above is disclosed as self-reported.
