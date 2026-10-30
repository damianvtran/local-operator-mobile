# Audit report — mobile.computers (fr) — round 2

- **Audit ID:** fr29c2
- **Audit kind:** independent round-2 audit of the CURRENT bytes of one namespace
- **Date:** 2026-10-29
- **Audited head:** `79b3fad082c0ae850b06a4437006d445bb1c4887` (`fix(i18n): compare translated arguments, correct French counts, unfreeze composer copy`)
- **Namespace:** `mobile.computers` — 10 English keys / 10 French keys
- **Auditor:** `i18n-auditor` (lopdev team), session `985199bdd2dc`, **actual model `radient/auto`**
  — harness fallback chain this run: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`, each switch reported by the harness as `provider failure: quota`. The audit was produced by `radient/auto`; the pinned Sonnet model did not run it.
- **Translator provenance:** `i18n-translator`, session `c66311717837`, job `fbde6318e480` (as recorded by the round-1 bundle), model `kimi/k3.1-pro` (fallback), 2026-10-29.
- **Independence:** different agent and different session from the translator; I did not write or edit any of these strings. The round-1 bundles were read **only** to establish provenance and what changed; every key below was re-judged from the current bytes.
- **Verdict:** **passed** — 0 unresolved BLOCKER/MAJOR, no new findings.

## Why the round-1 pass could not be reused

The round-1 bundle `fr29b2` recorded `sha256:bd473792092e1fb4…` for
`src/i18n/catalogues/fr/mobile.computers.json`. Recomputed against the current
file, the hash is `7ea60387b25e50e7…` — **MISMATCH** (`audit.log` §6). The English
source and its context sidecar still match their recorded hashes, so the drift is
in the French file alone. The current bytes are therefore a new object and were
audited from scratch.

## Mechanical checks (executed, not asserted)

| Check | Result | Evidence |
|---|---|---|
| Repository validator `npm run -s i18n:catalogue:check` | PASS — `catalogue.gen.ts is current (120 keys, 7 namespaces, argument types from en, fr)` | `audit.log` §1 |
| String-literal gate `npm run -s i18n:strings:check` | PASS — `284 finding(s), all baselined; 0 new` | `audit.log` §2 |
| Scoped i18n tests (`scripts/i18n` + `src/i18n`) | PASS — 7 files, 94 tests | `audit.log` §3 |
| Independent scanner (namespaces, placeholders, ICU branches, typography, tokens) | PASS — 0 FAIL | `audit.log` §4 |
| Key parity en ↔ fr | 10 = 10, no key added or dropped | §4 |
| Key parity en ↔ context | 10 = 10 | §4 |
| Duplicate keys in the raw JSON | none | §4 |
| Placeholder names and types | no placeholders in this namespace at all | §4 |
| JSON validity | valid UTF-8 JSON | §4, §6 |
| Bidi control characters (U+202A–E, U+2066–9, U+200E/F, U+061C) | none | §4 |
| Straight apostrophe U+0027 / NBSP U+00A0 / regular space before `:` | none — U+202F present before the colon, U+2019 for apostrophes | §4 |
| Kept-English tokens | `lop mobile` 1/1, `Radient` 1/1 (verbatim in both locales) | §4 |

Every one of the 10 values was also parsed and rendered through the app's own
renderer (`src/i18n/messages.ts` `parseMessage`/`formatMessage`, reached through
`src/i18n/runtime.ts` `renderFor`) — all 10 render non-empty French
(`audit.log` §5). This namespace has no count-bearing message, so the 0/1/2/1000000
plural renders belong to `mobile.projects` (`fr29p2`) and the same renderer run is
quoted there.

## Round-1 finding, verified remediated

**FR-COMP-1 (round 1, minor)** — `mobile.computers.added.stays_listed` had a
regular space U+0020 before `:`. Current bytes carry **U+202F**:

> `Il reste dans la liste de ce téléphone : vous pouvez y revenir depuis la liste des ordinateurs.`

(`:` here is U+202F + `:`; verified by codepoint scan, `audit.log` §4.)

## Per-key review (all 10 keys)

Roles are the English sidecar's `role`.

| # | Key | Role | EN | FR (current) | Verdict |
|---|---|---|---|---|---|
| 1 | `add` | button | Add a computer | Ajouter un ordinateur | clean |
| 2 | `added.stays_listed` | help | It stays listed on this phone, so you can switch back from the computer list. | Il reste dans la liste de ce téléphone : vous pouvez y revenir depuis la liste des ordinateurs. | clean (FR-COMP-1 fixed) |
| 3 | `badge.active` | status | active | actif | clean |
| 4 | `badge.connecting` | status | connecting | connexion | clean — accepted, see note |
| 5 | `connecting` | status | Connecting… | Connexion… | clean |
| 6 | `none_on_phone` | status | No computers on this phone yet. | Aucun ordinateur sur ce téléphone pour le moment. | clean |
| 7 | `password_placeholder` | help | The password from lop mobile | Le mot de passe fourni par lop mobile | clean |
| 8 | `section.not_connected` | heading | On your Radient account, not connected | Sur votre compte Radient, non connectés | clean |
| 9 | `section.on_phone` | heading | On this phone | Sur ce téléphone | clean |
| 10 | `switch` | button | Switch computer | Changer d’ordinateur | clean |

Notes on the two keys where a naive reading could produce a false finding:

- **`badge.active` / `badge.connecting` agreement.** EN uses verb participles
  (`active`, `connecting`); FR uses an adjective and a noun. `actif` agrees with
  *ordinateur* (masculine) — correct. `connexion` is the only one-word,
  lower-case French option: `connecté` would state the wrong state (connected,
  not connecting) and `en connexion` would break the one-word badge rule the
  sidecar sets. Two sibling badges of different grammatical class (`actif` /
  `connexion`) is a real, if small, register wrinkle; no shorter natural French
  option exists, so it is recorded as accepted rather than as a finding.
- **`password_placeholder`.** `lop mobile` is copied through byte-identically, as
  the sidecar demands. `fourni par` ("provided by") is the faithful expansion of
  EN "from": the password originates from running the command, and the string
  does not tell the reader the app supplies it (the command name is the subject). The leading article mirrors EN's "The" — placeholders in French often
  drop it, so this is a stylistic mirror, not an error; not raised.

## Idiom, register and terminology

- **Address:** `vous` throughout (`votre`, `vous pouvez`, `Vérifiez` in the
  sibling namespace); no `tu`, no `Veuillez`.
- **Sentence case** everywhere; both badges and the inline status stay lower case
  / capitalised as their siblings require; no Title Case.
- **Terminology:** *ordinateur* is used in all four values here that name a computer
  (no *machine*, no *PC*), and in ten more across `mobile.account_routing`,
  `mobile.home` and `mobile.projects` — one word everywhere
  (`Dossier sur cet ordinateur`, `Enregistré sur cet ordinateur`). *téléphone* is
  used consistently for the phone. `Radient` and `lop mobile` are untouched.
- **No calque found.** `Il reste dans la liste`, `pour le moment`, `Changer
  d’ordinateur` (the *changer de* + bare noun construction) are idiomatic French,
  not translated English syntax.
- **Typography:** U+202F before `:`, U+2019 apostrophes, `…` ellipsis; no ASCII
  quotes, no NBSP.

## Fit / width

No `maxCells`/`maxChars` hint exists in this namespace's sidecars, so fit is
assessed from the render sites (`src/features/settings/settings.tsx`,
`src/features/auth/computer-switcher-sheet.tsx`) and measured string lengths
(`audit.log` §4):

- `add` — 14 → 21 characters (+50 %). Rendered as the footer button label of the
  computer-switcher sheet: full-width button, no overflow risk.
- `none_on_phone` — 31 → 49 (+58 %). Status paragraph, wraps.
- `password_placeholder` — 28 → 37 (+32 %). Text-input placeholder; French
  placeholders commonly truncate and this one has no competing chrome.
- `switch` — 15 → 20 (+33 %). Button label and sheet title; short.
- Badges: `actif` 5 (shorter than EN) and `connexion` 9 (shorter than EN) — both
  inside the badge's own line box, so the badge cannot clip; the sibling name
  truncates instead.

No string in this namespace is at credible risk of clipping a button, tab or
status line at the smallest supported phone width on length grounds alone.

## Observations outside this catalogue (not findings against the French text)

Recorded because they will be seen on the same screens; none is caused by, or
fixable in, the French catalogue:

1. `src/features/projects/project-detail.tsx:416` renders
   `<SectionHeader label="linked sessions" />` and line 419 a literal
   `No sessions linked.` — unkeyed English, present in
   `scripts/i18n/strings-baseline.json` (line 840). A French reader sees English
   in the projects surface regardless of these catalogues.
2. `src/features/session/components/status-tray.tsx:78` builds the accessible name
   as `` `${summary} — show status` `` — an unkeyed English literal inside a
   template expression, which `scan-strings.ts` does not flag (its
   user-facing-attribute rule expects the literal directly after `=`). The
   audited `mobile.session.status_tray.hint` is read *after* that English name.

## What this audit does not claim

- No **native-speaker** review: the judgement is an LLM auditor's, stated as such.
- No **rendered-proof**: no screenshot, frame or device capture was taken; no
  truncation/overflow claim beyond the executed character measurements above.
- No **keyed public-copy receipt** and no **ledger row**: this mobile repository
  has no `i18n/ledger.json` and no audit-ledger command (`docs/i18n.md` records
  the report in the pull request), so this bundle is the durable artifact.

- **Not yet tracked — and `git add` would silently skip the log.** This repository's
  `.gitignore` line 76 is `*.log`, so `audit.log` (verified with
  `git check-ignore -v`) is ignored: a plain `git add i18n` commits the record and
  report and drops the execution log. Land the bundle with
  `git add -f i18n/audits/evidence` or add a negation rule
  (`!i18n/audits/evidence/**/audit.log`). The existing dated bundles are in the same
  position.

## Reproduction

Commands and their actual output are in `audit.log`, in order:
§1 validator, §2 string gate, §3 tests, §4 independent scanner, §5 renderer,
§6 provenance/hashes/prior-round comparison, §7 the keyed-route attempt.
