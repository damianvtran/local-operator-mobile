# M2 audit — locale `fr` — Lane A — ROUND 1

**Verdict: changes_requested** — 0 BLOCKER · **2 MAJOR** · 2 MINOR · 2 NIT

- Slice: M2 (native phone-app expression literals), 27 keys, one file group (settings + computers wait
  panel + session tray/region/header).
- Candidate (audited, not edited): `~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/fr.v1.json`
  sha256 `b152d32eef8a1a42cf85173c7288327f58d8012cbbfeda4ca4553e40b962f0a1`
- Source + context: `.../m2-prep/keys27.json` sha256 `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e`
- M1 reference (audited, read-only): `.../m1-prep/fr.v2.json` sha256 `48afee13fa1df9ca2c5cd324ae5ab3b7b920018eb436bd6d27a81f8525269725` (53 keys, zero overlap with M2)
- Shipped catalogue (read-only recount): `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/fr/`
- Style guide + glossary read: `~/local-operator/i18n/style-guides/fr.md`, `en.md`, `~/local-operator/i18n/glossary.md`
- Call sites read on `feat/i18n-app-scan-expression-literals` (b6b890e0, d349df3c):
  `src/features/settings/settings.tsx`, `src/ui/components/connection-pill.tsx`,
  `src/features/auth/computers.tsx`, `app/(app)/session/[id].tsx`.
- Auditor: role `i18n-auditor`, session `87366bacc645`, served model **`deepseek/deepseek-flash`**
  (session header; no fallback observed). Independent of the translator
  (`i18n-translator`, `openai/gpt-6.1-sol`). Method: reasoning only — no translation/MT service,
  no back-translation.

## 1. Mechanical pass (python3, this session, on the two files above)

| Check | Result |
|---|---|
| Key count / set / order vs `keys27.json` | 27 = 27, order identical, 0 missing, 0 extra |
| Placeholders `{percent}` `{labels}` `{host}` `{baseUrl}` `{name}` | identical names, count and order per key; no renames, no `%s`-style drift |
| ICU plural/select structure | none present (no `plural`/`select` in these 27 keys) |
| Empties / whitespace-padded values | none |
| NFC normalisation | all values NFC |
| JSON validity / BOM | parses; no BOM; UTF-8 |
| Markup, backticks, commands, flags, identifiers, paths | none translatable in this group; `{baseUrl}`, `{host}` left byte-identical |
| Glyphs required by source notes | `·` ×3, `↑` ×1, `↓` ×2 all preserved |
| Punctuation | apostrophe U+2019 ×4 (no ASCII `'`); U+202F used before `%` ×4, matching shipped fr (`mobile.settings.text_size.*` also uses U+202F before `%`); no stray `/` or `:` needing spacing |
| Digits | Latin only |
| English-identical values | 2, both deliberate: `mobile.session.fallback_name` = "session" (same word in fr) and `mobile.settings.account.app_name` = "Local Operator" (product name, never translated) |
| Repo validator | **not run** — the repo (and its validator/ledger) is off-limits to this lane per the task; every mechanical property above was verified directly instead |

## 2. Findings

### F1 — MAJOR — `mobile.session.tray.context_short`, `mobile.session.tray.context_short_estimate`
Current: `{percent}\u202f% du contexte` / `{percent}\u202f% du contexte (estim.)`
Problem: the narrow (`<340 pt`) keys are **byte-identical to the full-width keys**, so the fr narrow
form is not narrow at all. The call site (`app/(app)/session/[id].tsx`, `contextFact(narrow)`) exists
solely because, in the code's own words, "the full word wraps the activity band to two lines there"
(design round 2, D17) with the cost and the subagents chip beside it. Measured at a 3-digit-free
percent (`21`): en narrow `21% ctx` = **7 chars**, en full `21% context` = **11**, fr candidate narrow
= **16** — the fr narrow string is 2.3× the en narrow one and 45 % longer than the en *full* string it
is meant to replace. The band wraps for exactly the reason the key exists.
Suggested: `{percent}\u202f% ctx` and `{percent}\u202f% ctx (estim.)` (8 / 17 chars). "ctx" is the
dev-register abbreviation the shipped fr corpus already lives with (`app`, `token`, `prompt` stay
English per the guide's kept-English list); the style guide's rule is "shorter synonyms over
truncation, always". If `ctx` is rejected, the only workable alternative is dropping the elided
article — `{percent}\u202f% contexte` / `{percent}\u202f% contexte (estim.)` (13 / 22) — which buys
3 chars and is a weak fix.

### F2 — MAJOR — `mobile.settings.status.not_answering`
Current: `Sans réponse`
Problem: the shipped, already-audited fr catalogue names this same English word
(`Not answering`) **`Ne répond pas`** — `fr/relay.chrome.json:2
"relay.chrome.session.subtitle.not_answering"`, whose en sidecar says verbatim reuse is the point
("Reused here verbatim so the two clients cannot name one state two ways",
`en/relay.chrome.context.json:2-4`). The keys27 note for this key says the same:
"Matches the relay's 'Not answering' wording". The candidate gives the phone's Settings pill a second
name for a state the same app already labels elsewhere, which is the defect those notes exist to
prevent. ("Sans réponse" is good French in isolation — the objection is consistency, not idiom.)
Suggested: `Ne répond pas`.

### F3 — MINOR — `mobile.settings.diagnostics.stream_live`
Current: `en direct`
Problem: "en direct" is the broadcast/live-television idiom; for a transport that is open and
receiving, fr dev register says `actif`. The shipped fr corpus has **zero** occurrences of "en direct"
and uses `actif` for the active state (`fr/mobile.computers.badge.active` = "actif",
`fr/mobile.projects.status.active` = "actif"), and the sibling value in the same Diagnostics row is
`inactif` — so the row pairs a shipped adjective with an unused adverbial phrase.
Suggested: `actif` (yielding the inactif/actif pair the row wants).

### F4 — MINOR — `mobile.settings.status.no_connection`
Current: `Aucune connexion`
Problem: en is "No connection yet". Dropping "yet" turns a not-yet-configured state (no computer
chosen; shown as the account card's route line and as the pill word, `settings.tsx:322,721`) into a
flat failure statement. The pill explicitly tolerates a sentence (`connection-pill.tsx` doc block), so
the terseness saving is not needed here.
Suggested: `Pas encore de connexion`.

### F5 — NIT — `mobile.session.region.more_below`
Current: `suite plus bas · défiler ↓`
Problem: article-less "suite" is telegraphic next to the sibling cue `{labels} plus bas`, which reads
naturally because `{labels}` is a noun phrase.
Suggested: `la suite plus bas · défiler ↓`

### F6 — NIT (flag only, recommend no change) — `mobile.settings.diagnostics.stream_connecting`
Current: `connexion`
Problem: a noun among participles (`inactif` / `dégradé` / `hors ligne` / `en direct`). However the
shipped catalogue already ships exactly this word for this state
(`fr/mobile.computers.badge.connecting` = "connexion"), so changing it would break shipped
consistency to win parallelism. If the family is ever made parallel, `connexion en cours` is the
option; the DiagnosticRow allows two lines.
Suggested: keep `connexion`.

## 3. Checked and accepted (no finding) — stated for transparency

- `mobile.computers.wait.host_answering`, 2nd sentence: "Un acheminement configuré ne garantit pas
  que l'ordinateur fonctionne." renders "A provisioned route is not the same as a machine that is
  up" as an epistemic claim rather than an identity claim. The reader takeaway (a listing is not
  proof the machine runs) is preserved, polarity is negative, "acheminement" matches M1's Route row
  (`mobile.settings.diagnostics.route` = "Acheminement"), and "configuré" is the honest rendering of
  *provisioned*. Accepted.
- `mobile.settings.account.*`: "Non connecté à Radient" / "Connecté" overload *connecté* for both
  sign-in and transport. This is M1's recorded choice (`signed_in` = "Connecté", `sign_out` =
  "Se déconnecter") and shipped; the `à Radient` disambiguator is present. Accepted, not re-litigated.
- `mobile.computers.added.connected_to` + `added.fallback_name`: "Connecté à {name}." with
  "votre ordinateur" reads correctly spliced ("Connecté à votre ordinateur."), no elision or article
  problem, and no case problem with a proper computer name (`computers.tsx:636-638`).
- `mobile.session.region.*`: "défiler" is the correct terse imperative; middle dot and arrows intact,
  lower case per the guide.
- `mobile.session.video.title_fallback` "Vidéo", `mobile.session.fallback_name` "session",
  `mobile.settings.account.app_name` "Local Operator": correct, product name untouched.
- Register/address: **vous** throughout ("votre ordinateur", "votre tunnel"), no "Veuillez", sentence
  case, lowercase diagnostic words — matches `i18n/style-guides/fr.md`.

## 4. High-visibility second pass (settings group) — performed

Group carries the Settings screen, so a second independent read was done: all 12 settings-group
strings re-read in reverse order against the shipped fr catalogue and the call sites, without
assuming pass 1. Result: pass 1's F1 and F4 stood; pass 2 **added** F2 (found only by cross-checking
the source note "Matches the relay's 'Not answering' wording" against `fr/relay.chrome.json`, which
pass 1 had not done) and F6 (grammatical-family parallelism inside the Diagnostics row). No pass-1
finding was withdrawn. No English left in any value except the two deliberate ones named above.

## 5. Ledger row (for the manager; this lane did not touch the repo or ledger)

per locale + file group — status `changes_requested`, auditor `i18n-auditor` (agent role),
session `87366bacc645`, model `deepseek/deepseek-flash`, source hash
`5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e`. Note (≤280 chars) proposed:

> M2 fr lane A: 2 MAJOR (tray context_short duplicates full form, defeats D17; not_answering
> diverges from shipped relay "Ne répond pas"), 2 MINOR, 2 NIT. selftest 27/27 keys; see
> m2-audit-fr-A.md.
