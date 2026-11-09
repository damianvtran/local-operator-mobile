# Audit report — mobile.projects (fr) — round 2

- **Audit ID:** fr29p2
- **Audit kind:** independent round-2 audit of the CURRENT bytes of one namespace
- **Date:** 2026-10-29
- **Audited head:** `79b3fad082c0ae850b06a4437006d445bb1c4887`
- **Namespace:** `mobile.projects` — 15 English keys / 15 French keys
- **Auditor:** `i18n-auditor` (lopdev team), session `985199bdd2dc`, **actual model `radient/auto`**
  — harness fallback chain this run: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`, each switch reported by the harness as `provider failure: quota`. The pinned Sonnet model did not run this audit.
- **Translator provenance:** `i18n-translator`, session `c66311717837`, job `fbde6318e480` (per the round-1 bundle), model `kimi/k3.1-pro` (fallback), 2026-10-29.
- **Independence:** different agent, different session, did not write or edit these strings. Round-1 bundles were read for provenance and delta only; every key was re-judged from the current bytes.
- **Verdict:** **passed** — 0 unresolved BLOCKER/MAJOR; 1 new MINOR (`FR-PROJ-5`).

## Why the round-1 pass could not be reused

`fr29b4` recorded `sha256:cb4cc4d83dccc791…` for the French file and
`6a9e4b4c9fd4a45c…` for the English context sidecar. Recomputed:
`58b738859d329b48…` and `b8657428b40efc74…` — **both MISMATCH**. The English
values file still matches, so the drift is in the French text and in the
sidecar's per-key note; the current bytes are a new object.

## What changed since round 1 (verified against git, not assumed)

`git show 79b3fad -- src/i18n/catalogues/fr/mobile.projects.json` shows exactly
three changed lines (the English context note for `milestones.count` changed too):

```diff
-"mobile.projects.milestones.count": "{completed} jalons sur {total}",
+"mobile.projects.milestones.count": "{completed, plural, one {# jalon sur {total}} many {# de jalons sur {total}} other {# jalons sur {total}}}",
-"mobile.projects.session_state.filed_by": "classé par",
-"mobile.projects.session_state.missing": "manquant",
+"mobile.projects.session_state.filed_by": "classée par",
+"mobile.projects.session_state.missing": "manquante",
```

Round 1 had accepted a **non-plural** milestone count (`{completed} jalons sur
{total}`, which rendered "1 jalons sur 2") and the **masculine** `manquant` /
`classé par` beside a feminine *session*. Both classes are fixed in the current
bytes. Round 1's four U+202F findings (`FR-PROJ-1`…`FR-PROJ-4`) are also fixed —
all four keys now carry U+202F before `?` / `:`, verified by codepoint scan.

## Mechanical checks (executed)

| Check | Result | Evidence |
|---|---|---|
| `npm run -s i18n:catalogue:check` | PASS — `120 keys, 7 namespaces, argument types from en, fr` | `audit.log` §1 |
| `npm run -s i18n:strings:check` | PASS — `284 finding(s), all baselined; 0 new` | §2 |
| Scoped i18n tests (`scripts/i18n`, `src/i18n`) | PASS — 7 files, 94 tests | §3 |
| Independent scanner | PASS — 0 FAIL; key parity 15 = 15 (fr and context); no duplicate keys | §4 |
| Placeholder names (nested-inclusive) | identical in every key: `name` ×2, `completed`+`total`, `count`, `base`+`live`, `action`+`subject` | §4 |
| Placeholder kinds | only allowed escalation: `completed` text → plural; `total` stays a plain placeholder inside every branch | §4 |
| ICU plural structure | `milestones.count` and `sessions.count` each declare **one, many, other** — the complete French CLDR set; no `few`/`two`/`zero` | §4 |
| Bidi controls | none | §4 |
| Straight apostrophe / NBSP / U+0020 before `:` or `?` | none; U+202F in all four places a French typographic space is required (4 values, one each) | §4 |
| JSON validity | valid UTF-8 JSON, no duplicate keys | §4, §6 |

### Plural categories, checked against CLDR and the app's own rules

`Intl.PluralRules("fr").resolvedOptions().pluralCategories` →
`["one","many","other"]`; `Intl.PluralRules("fr").select` at the counts the task
names: `0→one`, `1→one`, `2→other`, `1000000→many`, `1500000→other`,
`2000000→many` — exactly the style guide's rule (`one` for 0 and 1, `many` for
exact multiples of 10⁶, `other` otherwise).

The generator raised the parameter type to the shipped locales' strictest kind,
which is the failure mode `docs/i18n.md` warns about:

```
"mobile.projects.milestones.count": { total: string | number; completed: number };
```

and the call site (`projects-copy.ts:63`) passes numbers, so a French render
cannot throw `RangeError` on a string count.

## Rendering evidence (app's own renderer, preference `fr`)

`renderFor(key, args, "fr")` — `src/i18n/runtime.ts` → `messages.ts`
(`audit.log` §5). No other formatter was used.

| Key | @0 | @1 | @2 | @1000000 |
|---|---|---|---|---|
| `milestones.count` (`total` = 3) | `0 jalon sur 3` | `1 jalon sur 3` | `2 jalons sur 3` | `1000000 de jalons sur 3` |
| `sessions.count` | `0 session` | `1 session` | `2 sessions` | `1000000 de sessions` |

Composed the way `projectRowMeta` joins them (` · `):

```
aucun jalon · 0 session
0 jalon sur 3 · 2 sessions · 1 en cours
1 jalon sur 3 · 2 sessions · 1 en cours
2 jalons sur 3 · 4 sessions
1000000 de jalons sur 3 · 2 sessions · 1 en cours
```

Two notes on that output, both honest limits rather than defects:

- **No grouping separators.** This client's renderer documents that `#` renders
  through `String(n)` — no thousands separator. `1000000` is therefore correct
  *output* for this build; the style guide's `1 000 000` is what a locale
  formatter would produce, and this build has none. The catalogue correctly
  writes `#` rather than pre-formatting the number, which is what the guide
  requires of the text.
- **`many` really is exercised.** `1000000 de jalons` proves the `many` branch is
  reached and carries the mandatory `de`.

## Per-key review (all 15 keys)

| # | Key | Role | FR (current) | Verdict |
|---|---|---|---|---|
| 1 | `delete_body` | confirm | Supprimer {name} ? La ligne du projet sera définitivement supprimée. Ses sessions liées et leurs transcriptions ne seront pas modifiées. | clean |
| 2 | `draft_kept_note` | help | Conservé depuis votre dernière visite. Effacez les champs pour repartir de zéro. | clean |
| 3 | `milestone_slash_note` | help | Les noms de jalons ne peuvent pas contenir de barre oblique. Un jalon dont le nom en contient une ne pourrait jamais être supprimé. | clean |
| 4 | `milestones.count` | meta | {completed, plural, one {# jalon sur {total}} many {# de jalons sur {total}} other {# jalons sur {total}}} | clean |
| 5 | `milestones.none` | meta | aucun jalon | clean |
| 6 | `project_name_hint` | help | 1 à 64 caractères : lettres, chiffres, point, tiret bas ou tiret. Aucun espace, et le nom ne peut pas commencer par un tiret. | clean |
| 7 | `remove_milestone_body` | confirm | Retirer {name} de ce projet ? Le jalon sera définitivement supprimé. Les sessions du projet et sa ligne de progression ne seront pas modifiées. | clean |
| 8 | `session_state.filed_by` | status | classée par | **MINOR — FR-PROJ-5** |
| 9 | `session_state.missing` | status | manquante | clean |
| 10 | `session_state.not_running` | status | arrêtée | clean |
| 11 | `sessions.count` | meta | {count, plural, one {# session} many {# de sessions} other {# sessions}} | clean |
| 12 | `sessions.live` | meta | {base} · {live} en cours | clean |
| 13 | `stale_badge` | status | progression obsolète | clean |
| 14 | `write_receipt` | status | {action} {subject}. | clean |
| 15 | `write_unknown_note` | status | Impossible de joindre votre ordinateur : nous ne savons pas si la modification a été enregistrée. Vérifiez le projet avant de réessayer. | clean |

Reasoning on the keys where a shallow pass would be wrong:

- **Both destructive confirmations keep a real two-part promise** — what is
  destroyed (`sera définitivement supprimée`) and what is left alone
  (`ne seront pas modifiées`). No negation is dropped or added; nothing implies
  the linked sessions or transcripts are affected.
- **`write_unknown_note` keeps the outcome genuinely UNKNOWN** —
  `nous ne savons pas si la modification a été enregistrée` — and does not slide
  into "nothing was saved". *modification* matches the same noun used in
  `mobile.account_routing.rejected`, so the failure vocabulary is consistent.
- **`project_name_hint` keeps the grammar exact**: range `1 à 64`, the four
  allowed classes (`point`, `tiret bas`, `tiret`), "no space", "cannot start with
  a hyphen". `tiret bas` (underscore) vs `tiret` (hyphen) are the correct French
  names and are distinguished, which is the whole point of the sentence.
- **`milestone_slash_note`** uses `barre oblique` (the correct French name for a
  slash), feminine `une`, and states only the reader-facing consequence — no
  route, path or encoding leak, as the sidecar demands.
- **`milestones.none`** is a lower-case fragment with no final stop, and `aucun
  jalon` (singular) is correct French after *aucun*, even though English is
  plural. Joined output reads correctly: `aucun jalon · 2 sessions`.
- **`sessions.live`** appends a count: `2 sessions · 1 en cours` is idiomatic and
  unambiguous; `en cours` matches the `commandes en cours` wording already used in
  `mobile.home.options.fixed`.
- **`stale_badge` `progression obsolète`** matches the app's existing French for
  the relay's stale state (`mobile.schedules.state.stale` = `obsolète`), and names
  *what* is stale (the progress), not the project.
- **`write_receipt`** is a template: placeholders and the final full stop are
  preserved exactly. (Its composed output is a separate app-level issue — see
  observations.)

## Finding

### FR-PROJ-5 — MINOR — `mobile.projects.session_state.filed_by`

- **Current:** `classée par`
- **Problem.** The fragment sits alone under a session name as that row's state.
  *Classer* in French first means to sort or classify, and `classée par` is the
  stock opening of a sort criterion — *classée par date*, *classée par thème*.
  Read as a passive participle it also invites "the session was classified by
  …", i.e. the session as the object, where the English tag marks it as the
  filer. The context note is explicit that the row must not be painted as a
  worker, and this wording keeps the coordination meaning; the risk is that the
  reader takes the line for a sort key or a passive state rather than provenance.
- **Suggested replacement:** `déposée par`
  (alternative if passive provenance is unwanted: `à l'origine`)
- **Why that wording.** *Déposer* is the standard French verb for filing
  (*dossier déposé par …*), it keeps the two-word participial shape, agrees with
  *une session*, and has no competing "sort by" reading.
- **Why MINOR, not MAJOR.** No unsafe meaning, no polarity error, no worker
  implication, and the row stays identifiable from its name; the English source is
  itself a deliberately terse fragment. I considered escalating it and did not,
  on those grounds. If the team's bar is "no fragment with a competing stock
  reading", this is the one line to change.

## The three session-state fragments against « une session »

- `classée par`, `manquante`, `arrêtée` are all **feminine singular**, agreeing
  with *une session* — the noun the row names (`linkedSessionState()` returns
  exactly one of them, `projects-copy.ts:193-203`).
- They are **mutually exclusive by construction** (coordination → filed_by;
  `!exists` → missing; `runtime.state === "stopped"` → not_running), so there is
  no combination in which two appear together and no agreement clash can arise
  between them. Round 1 accepted the two masculine forms; the current bytes fix
  both, and the third was already correct.
- One caveat the fragments cannot fix: the section header above them is the
  unkeyed English literal `linked sessions` (see observations), and the row's
  accessible name is not composed from these fragments. Neither affects the
  agreement of the French words themselves.

## Idiom, register, terminology

- `vous` throughout (`votre`, `Effacez`, `Vérifiez`); no `tu`, no `Veuillez`.
- Sentence case; statuses and fragments stay lower case (`aucun jalon`,
  `progression obsolète`, `manquante`).
- Glossary: *session* → session, *project* → projet, *milestone* → jalon (the
  settled French term, used in all four milestone keys); no product name is
  translated; no kept-English technical term appears in this namespace except the
  placeholders themselves.
- Typography: U+202F before both `?` and both `:`, U+2019 not used here (no
  apostrophe in these strings), `·` separator preserved with spaces.
- No calque found. `repartir de zéro`, `ligne de progression`, `barre oblique`,
  `définitivement supprimée` all read as native product French.

## Fit / width

No `maxCells`/`maxChars` hint in this namespace's sidecars; measured lengths in
`audit.log` §4, render sites checked:

- `stale_badge` 14 → 20 characters (+43 %). It is a `Badge` in a flex row whose
  sibling project name is `flex-1` + `numberOfLines={1}`; the badge takes its
  natural width and the *name* truncates, so the badge cannot clip. Two short
  words, acceptable.
- `milestone_slash_note` 83 → 131 (+58 %) and `delete_body` 104 → 136 (+31 %):
  wrapping help/confirm paragraphs, no budget.
- `session_state.filed_by` 8 → 11: a meta line, single line, short.
- `sessions.live` longest composed case measured (`1000000 de jalons sur 3 · 2
  sessions · 1 en cours`) is a 46-character meta line, and `projectRowMeta` is
  rendered with `numberOfLines={1}` + tail ellipsis, so it truncates rather than
  overflows.

No string here is at credible risk of clipping a button, tab or status line at
the smallest supported phone width on length grounds alone.

## Observations outside this catalogue (not findings against the French text)

1. **`write_receipt` composes English into a French sentence.** The screens pass
   English action words: `writeReceipt("Created", …)` (`project-create.tsx:152`),
   `"Completed"`/`"Reopened"` (`project-detail.tsx:171`), `"Added"`/`"Updated"`
   (line 228) with a hardcoded English noun `` `milestone ${name}` `` (line 229),
   `"Removed"` (249), `"Deleted"` (273). A French reader therefore sees
   *Deleted Projet X.* / *Created milestone Foo.* The French catalogue is correct
   and cannot fix this: the verbs are parameters chosen by code, and localising
   them is a code change (keyed verbs or action codes).
2. `project-detail.tsx:416` renders `<SectionHeader label="linked sessions" />`
   and line 419 `No sessions linked.` — unkeyed English, already in
   `scripts/i18n/strings-baseline.json` (line 840).

## What this audit does not claim

- No **native-speaker** review; this is an LLM auditor's reading, stated as such.
- No **rendered-proof**: no screenshot, device frame or simulator capture. Width
  statements rest on executed character counts plus the render sites' documented
  geometry (`numberOfLines`, `flex-1`, Badge line box), never on pixels.
- No **keyed public-copy receipt** and no **ledger row** — this repository has no
  `i18n/ledger.json` and no audit-ledger command; the bundle is the artifact of
  record.

- **Not yet tracked — and `git add` would silently skip the log.** This repository's
  `.gitignore` line 76 is `*.log`, so `audit.log` (verified with
  `git check-ignore -v`) is ignored: a plain `git add i18n` commits the record and
  report and drops the execution log. Land the bundle with
  `git add -f i18n/audits/evidence` or add a negation rule
  (`!i18n/audits/evidence/**/audit.log`). The existing dated bundles are in the same
  position.

## Reproduction

`audit.log` §1 validator, §2 string gate, §3 tests, §4 independent scanner
(namespaces, placeholders, ICU branches, CLDR categories, typography),
§5 renderer output at 0/1/2/1000000 and the composed rows, §6 provenance/hashes
and the round-1 comparison, §7 keyed-route attempt.
