# Audit report — mobile.session (fr) — round 2

- **Audit ID:** fr29e2
- **Audit kind:** independent round-2 audit of the CURRENT bytes of one namespace
- **Date:** 2026-10-29
- **Audited head:** `79b3fad082c0ae850b06a4437006d445bb1c4887`
- **Namespace:** `mobile.session` — 2 English keys / 2 French keys
- **Auditor:** `i18n-auditor` (lopdev team), session `985199bdd2dc`, **actual model `radient/auto`**
  — harness fallback chain this run: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`, each switch reported by the harness as `provider failure: quota`. The pinned Sonnet model did not run this audit.
- **Translator provenance:** `i18n-translator`, session `c66311717837`, job `fbde6318e480` (per the round-1 bundle), model `kimi/k3.1-pro` (fallback), 2026-10-29.
- **Independence:** different agent, different session; I did not write or edit these strings. Round-1 material was read only to establish what changed.
- **Verdict:** **passed** — 0 unresolved BLOCKER/MAJOR; no findings.

## Why the round-1 pass could not be reused

`fr29b5` audited **one** key. The current file has **two**, and every recorded
hash now mismatches: English `fb14b28b23926c7e…` → `8539005ad9785ec1…`, context
`96f9e9d06f4a1b00…` → `6e8d32e62d787a2c…`, target `2c45d0a0f781b0b6…` →
`f57666b0586a9054…`. The added key is the subject of the specific question
below, and it cannot be covered by a one-key pass.

`status_tray.hint` is **byte-identical** to the value quoted in the round-1
report (verified by exact-string containment), but I re-judged it anyway rather
than carrying the earlier verdict forward.

## What changed since round 1 (verified)

`git log` shows `src/i18n/catalogues/fr/mobile.session.json` last changed in
`7610eb4 feat(i18n): translate the mobile catalogue into French`, and the blob at
that commit equals the blob at HEAD — the file has not been touched since it was
first committed. The round-1 audit therefore ran against pre-commit bytes that
are not reachable from HEAD, which is why its hashes cannot match. The new
`mobile.session.conversation_details` is part of the committed translation and is
audited here for the first time.

## Mechanical checks (executed)

| Check | Result | Evidence |
|---|---|---|
| `npm run -s i18n:catalogue:check` | PASS — `120 keys, 7 namespaces, argument types from en, fr` | `audit.log` §1 |
| `npm run -s i18n:strings:check` | PASS — `284 finding(s), all baselined; 0 new` | §2 |
| Scoped i18n tests (`scripts/i18n`, `src/i18n`) | PASS — 7 files, 94 tests | §3 |
| Independent scanner | PASS — key parity 2 = 2 (fr and context), no duplicate keys, no placeholders, no bidi, no straight apostrophe, no NBSP | §4 |
| JSON validity | valid UTF-8 JSON | §4, §6 |
| Typography | U+2019 in `d’activité`; no ASCII apostrophe; no space before punctuation to fix | §4 |
| Lexical consistency across the FR catalogue | `conversation` is the app's French term for the chat thread (`Options de la conversation`, `cette conversation` in `mobile.home`) | §4 in `fr29p2` and the grep recorded in this `audit.log` §4 |

The two English keys carry no placeholders and no plural, so there is no
count-bearing message in this namespace to render at 0/1/2/1000000; the renderer
run for the plural counts is quoted in `fr29p2` §5. Both values were still parsed
and rendered through the app's own renderer (`parseMessage`/`formatMessage` via
`runtime.ts` `renderFor`) and render exactly as catalogued (`audit.log` §5).

## The specific question: « Détails de la conversation » as a screen title

**Judgement: this is the wording a French reader expects, and it is the right
choice here. No finding.**

The English sidecar makes the constraint explicit: this string is "the
destination screen's own title, used as the label of the control that opens it —
not an action verb", and it "must stay identical wherever that screen is named,
including the sentence in `mobile.home.options.fixed`".

Checked against that contract:

1. **It is a noun phrase, not a verb** — `Détails de la conversation` names the
   destination, as required. An action rendering (*Afficher les détails*) would
   have broken the rule and would also read wrong as the screen's own title.
2. **It is the conventional French title for a "… details" screen.** French
   interfaces (iOS/macOS `Détails`, Android `Détails de …`) title such a screen
   with the noun `Détails` + `de` + the definite-article noun phrase. Dropping the
   article (*Détails de conversation*) is possible in telegraphic UI French but
   reads more clipped and less like a screen title; keeping `de la` is the safer,
   more idiomatic form.
3. **Consistency, which the sidecar makes load-bearing, holds exactly.**
   `mobile.home.options.fixed` renders
   `Utilisez Détails de la conversation pour accéder à ses commandes en cours.` —
   the same word sequence, same capitalisation, so the reader recognises the same
   destination from the sentence and from the control. Verified by exact string
   containment (`audit.log` §4).
4. **Terminology is the app's own.** `conversation` is used for the chat thread
   throughout `mobile.home` (`Options de la conversation`, `cette conversation`),
   and the glossary's `session → session` row is about the *session* concept, not
   this screen — so `conversation` here is correct and not a glossary conflict.
5. **Register and typography** — sentence case (only the initial capital), no
   final full stop, no bidi control, U+2019 not needed. Correct.

Alternatives considered and rejected: *Informations sur la conversation* (longer,
and `Informations` is the French label for an "Info" affordance rather than a
details screen); *Détails* alone (loses the destination, ambiguous beside other
details affordances); *Afficher les détails* (an action verb — forbidden by the
sidecar). None is better than the current wording.

## The three session-state fragments against « une session »

The fragments live in `mobile.projects` and are audited there (`fr29p2`,
`FR-PROJ-5` for `filed_by`); this section answers the cross-check the manager
asked for, because the noun they must agree with is the *session* the app shows
them beside.

- `session_state.missing` → **manquante** — feminine singular, agrees with *une
  session*.
- `session_state.not_running` → **arrêtée** — feminine singular, agrees.
- `session_state.filed_by` → **classée par** — feminine singular, agrees
  grammatically (round 1 had the masculine `classé par`, `manquant`; both are
  fixed in the current bytes).
- They are **mutually exclusive** by construction: `linkedSessionState()` returns
  exactly one per row (`coordination` → filed_by, else `!exists` → missing, else
  `stopped` → not_running), so there is no combination in which two appear
  together and no agreement clash can arise between them. The row renders the one
  fragment as a meta line under the session's name; nothing else in that row
  carries gender or number that could conflict.
- Caveat the fragments cannot fix: the section header above them is the unkeyed
  English literal `linked sessions` (`project-detail.tsx:416`, baselined) — an
  app-level gap, not an agreement problem in the French text.

## Per-key review (both keys)

| # | Key | Role | EN | FR (current) | Verdict |
|---|---|---|---|---|---|
| 1 | `conversation_details` | heading | Conversation details | Détails de la conversation | clean (see section above) |
| 2 | `status_tray.hint` | help | Opens the working line, tasks and subagents | Ouvre la ligne d’activité, les tâches et les sous-agents | clean |

`status_tray.hint` reasoning, re-judged rather than carried:

- **Third-person verb, correct for a hint.** `Ouvre` mirrors the English third
  person and is the French convention for a hint read *after* the control's name
  ("…, Ouvre la ligne d'activité…"). It is also the only accessibility hint in
  the catalogues (verified across all seven `mobile.*` context files), so there
  is no sibling hint whose register it could contradict; an infinitive
  (*Ouvrir*) would have been the other defensible choice and is not required.
- **`la ligne d’activité`** renders "the working line" — the app's own name for
  the single in-progress indicator. French has no settled equivalent for that
  coinage; `ligne d'activité` names it without inventing a metaphor and stays
  short enough for a spoken hint. Even a reader who parses *ligne* as "row"
  arrives at the same object (the row carrying the live activity), so the
  ambiguity is harmless.
- **`les tâches et les sous-agents`** — *sous-agent* is the glossary rendering of
  *subagent*; *tâche* matches the glossary's *job → tâche* decision and the
  app's `mobile.schedules` usage. No final full stop, as the sidecar requires.
- Implicit in the hint but not overstated: it opens the three things and claims
  nothing else.

## Idiom, register, terminology

- `vous` is not needed in either string; where the app addresses the reader
  directly it uses `vous` (verified across the FR catalogue).
- Sentence case for the title; lower-case fragments elsewhere.
- Glossary: *subagent* → sous-agent, *task/job* → tâche. No product name appears;
  no kept-English technical term appears.
- Typography: U+2019 apostrophe, `…` not used here, no bidi control, no ASCII
  quotes.

## Fit / width

- `conversation_details` 20 → 26 characters (+30 %). It is a `size="sm"` quiet
  `Button` label in a `flex-row flex-wrap` header row
  (`startup-transcript.tsx:45-59`), so the row wraps rather than clipping; it is
  also the sheet/screen title, where the full label fits.
- `status_tray.hint` 43 → 56 characters (+30 %) — an accessibility hint, never
  painted, so no fit constraint.

No credible clipping risk from length alone at the smallest supported phone
width.

## Observations outside this catalogue (not findings against the French text)

`src/features/session/components/status-tray.tsx:78` composes the tray's
accessible name as `` `${summary} — show status` `` — an unkeyed English literal
inside a template expression, which `scan-strings.ts` does not flag (its
user-facing-attribute rule expects the literal directly after `=`). In French the
screen reader announces an English name followed by the French hint audited here.
Not a catalogue defect and not fixable in the French file.

## What this audit does not claim

- No **native-speaker** review; the judgement is an LLM auditor's, stated as such.
- No **rendered-proof**: no screenshot or device capture, and no claim about how
  the title looks on a device beyond the measured lengths and the render sites'
  geometry.
- No **keyed public-copy receipt** and no **ledger row** — no `i18n/ledger.json`
  and no audit-ledger command exist in this repository; this bundle is the
  artifact of record.

- **Not yet tracked — and `git add` would silently skip the log.** This repository's
  `.gitignore` line 76 is `*.log`, so `audit.log` (verified with
  `git check-ignore -v`) is ignored: a plain `git add i18n` commits the record and
  report and drops the execution log. Land the bundle with
  `git add -f i18n/audits/evidence` or add a negation rule
  (`!i18n/audits/evidence/**/audit.log`). The existing dated bundles are in the same
  position.

## Reproduction

`audit.log` §1 validator, §2 string gate, §3 tests, §4 independent scanner and
the cross-namespace consistency greps, §5 renderer output, §6 provenance/hashes
and the round-1 comparison, §7 keyed-route attempt.
