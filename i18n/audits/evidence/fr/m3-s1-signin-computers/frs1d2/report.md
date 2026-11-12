# Independent i18n delta audit — `fr` / `mobile.computers` + `mobile.signin` (M3 slice S1, round 2)

- Auditor: `i18n-auditor`, **fresh instance** `fdd48b3ce97c`, session `112b2963371b`
- Model: **`deepseek/deepseek-flash`** (this session's actual runtime model; no fallback used, no
  role/model pin, no tool restriction)
- Independence: not the round-1 auditor (session `7d94e65185a6`), not the v1 translator (session
  `4270cae4ed9c`), not the v2 revisor (session `e79c854e0ab4`). I edited nothing.
- Audit kind: **delta** (remediation round), locale `fr`, namespace
  `mobile.computers+mobile.signin (M3 S1)`
- Head: `a5593a79ef8414cfa6af05dfbc151dd47ada6199` (**verified** `git rev-parse HEAD` in
  `~/local-operator-mobile/.worktrees/i18n-m3-s1`, `git status --porcelain` empty before and after;
  the worktree is read-only for me — every artifact below is in my own scratchpad)
- Base of the slice: `1796c3a5` (round-1 head) on `origin/main` `9e193b57`
- Draft audited: `draft-fr-s1-v2.json`, sha256
  `46dfc7cdcbe80e0afad9844df811e42d52d43748ed93219e567e1c33d95c48e7` (matches the task)
- Keys: **44 in the draft**; **10 read for language quality** (4 changed + 6 slot labels); the other
  34 checked mechanically only

## Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT

The round-1 MAJOR (**A-01**, `wait.listing`) is **resolved** on its merits, not by agreement: the
round-2 value is the correct French conjunctive locution, where v1 was a calque. All three MINOR/
NIT remediations (A-02, A-03, A-05) are also genuine improvements; A-04's rejection is sound.
No blocker or major remains, so the row may be recorded `passed`.

## 1. The changed keys, audited in full

| ID (round 1) | Key | v1 → v2 | My independent reading |
| --- | --- | --- | --- |
| **A-01 MAJOR** | `mobile.computers.wait.listing` | « En attente que Radient liste votre ordinateur… » → « **En attendant que Radient liste votre ordinateur…** » | **RESOLVED.** « en attente que » + subjunctive is not a French locution — « en attente de » governs a noun only (which this same draft gets right in `panel.waiting`, « En attente de votre navigateur. »); the conjunctive form is « en attendant que » + subjunctive, and the subjunctive « liste » is correctly formed. The line still carries both things the W1 shimmer depends on — the wait, and Radient as the actor. Ellipsis retained, no full stop, sentence case, vous. Native and idiomatic. |
| A-02 MINOR | `mobile.signin.panel.waiting_help` | « Terminez la connexion… » → « **Finalisez la connexion dans le navigateur, puis revenez à cette app.** » | **RESOLVED.** « terminer une connexion » does collide with "close the connection", in the exact panel that asserts the sign-in is still pending. « Finalisez » now agrees with the shipped `stage_exchanging` label « Finalisation de la connexion dans le navigateur », rendered in the same panel region — one verb for one step. Imperative vous, full stop, no bureaucratic « Veuillez ». |
| A-03 MINOR | `mobile.computers.remove.body` | « Il est retiré… ne touche ni… » → « **Il sera retiré de la liste de ce téléphone. Cela ne modifie ni l'ordinateur, ni son tunnel, ni votre compte.** » | **RESOLVED**, and correct on the safety axis that matters here: the future states the consequence being confirmed rather than a completed action, and all **three negations survive** (computer / its tunnel / your account). « ne modifie ni … ni … ni » is the correct parallel form; v1's transitive « touche » was wrong for the "affect" sense (*toucher à*), so this is a fix, not a preference. « la liste de ce téléphone » matches the shipped corpus (`added.stays_listed`). Nothing is softened. |
| A-05 NIT | `mobile.computers.paths.own_body` | « …collez son adresse ici » → « **…collez l'adresse de ce tunnel ici** » | **RESOLVED.** « son » had two masculine candidates (« votre ordinateur », « un tunnel »); the demonstrative picks the correct, nearer antecedent and costs 13 glyphs in a wrapping card body. Everything else is untouched and still correct: « Le parcours avancé », the U+202F before its colon, « Aucun compte Radient n'est nécessaire à aucun moment », « vous gardez le mot de passe ». |
| A-04 NIT | `mobile.computers.status.provisioning` | kept « provisionnement » | **Rejection is sound.** It is a mono badge word (sidecar: "one word or short phrase"), « mise en place » is two words in the row that already wraps, and « provisionnement » is the settled French term for this sense. Badge usage (settings row, computers row, two a11y strings) dominates the single sentence slot, so badge constraints decide. I record the slot cost as **D-01** below, and I do **not** ask for a change. |

**Rejected alternatives** (translator notes, read only after forming the view above): the four
rejections for A-01 are all rightly rejected — « Radient ajoute votre ordinateur à la liste… »
drops the wait, « En attente de l'ajout de votre ordinateur par Radient… » stacks three *de* plus an
agent tail, « Radient n'a pas encore listé… » turns a neutral status into an accusation. The chosen
form is the only one that keeps wait + actor + terseness. Same for keeping « dans le navigateur »
instead of a bare « là » in A-02: English "there" is the browser, and French names it.

## 2. Integrity — v2 is v1 with exactly the four changed keys

Proven twice, independently of the translator's own account:

1. **Byte level** — `diff draft-fr-s1.json draft-fr-s1-v2.json` is exactly **4 hunks, 4 lines each
   way, at lines 3, 12, 17, 25**, nothing else; both files are 46 lines, same tab indent, no BOM,
   same trailing newline (`".\n}\n`).
2. **Value level** — 44 keys both sides, **same key order** as v1 **and** as the brief (44 entries);
   changed set = `{wait.listing, remove.body, paths.own_body, waiting_help}` **==** the
   `replacements-fr-s1.json` key set; each `replacements[k] === v2[k]`; **40/40 untouched keys
   byte-identical**.

So the delta is scoped: no unchanged value drifted, no key added or dropped, no reordering.

## 3. Mechanical (repo validator, then verified myself)

- **Repo gate `node scripts/i18n/generate.ts --check`**: **EXIT=1**, and it stops at the FIRST
  mismatching locale — the single output line is `es/mobile.computers.json disagrees with the English
  source — missing: …` (30 new keys), `unknown: none`. `fr` is never reached. This is the
  pre-landing state of a one-locale draft, **not** an fr verdict; the gate also validates only
  *committed* catalogues, so it cannot judge a scratch draft in any case. I do not claim it as a run
  for this group.
- **The parser `generate.ts` and the runtime share** — `parseMessage` from the worktree's own
  `src/i18n/messages.ts`, imported read-only by my script: **44/44 parse, 0 errors**.
- Placeholder names **and** kinds vs English: identical on all 4 placeholder-bearing keys
  (`{status}` text; `{name}`/`{status}`/`{reach}` text ×3). No `{status}` added or lost in the slot
  sentence (fr count 1 = en count 1).
- ICU plural/select in this group: **none**, so no CLDR category obligation arises (`one`/`many`/
  `other`, never `few` would apply if one were added).
- Code spans / commands / flags / paths / identifiers: **none present**; `Radient`, `Local Operator`,
  `URL` byte-identical where they occur. (My first crude token probe flagged `-in` from the English
  prose word "sign-in"; the refined code-token probe reports **0** lost tokens — the earlier hit was
  my check's false positive, recorded so the log is not read as a defect.)
- Valid non-empty JSON strings: 44/44. Typography: U+2019 only, `…` (never `...`), spaced em dash,
  U+202F before `:` in `paths.own_body`, no double/trailing spaces, no straight quotes — **0
  deviations**. English residue in the 10 audited strings: none (only `Radient` and `app`, the latter
  shipped in the fr corpus; `tunnel` is the same word in French).

## 4. Slot check — `mobile.computers.wait.tunnel_status` = « Radient dispose du tunnel — {status}. »

At **this** head, `{status}` is no longer the control plane's raw English word:
`src/features/auth/computers.tsx:259` renders `t(tunnelStatusKey(state.tunnelStatus))`, and
`tunnel-status-key.ts` maps the raw word to a closed set of **six** catalogue keys. So the sentence
is filled with **localised labels**, and that is what I tested (not the English token the brief's
stale note describes — see O-1).

| Label (source of value) | Value | Sentence rendered | Reads ok? |
| --- | --- | --- | --- |
| `badge.active` (**shipped** fr) | « actif » | « Radient dispose du tunnel — actif. » | **yes** — masc. sg. agrees with « le tunnel », truthful, no ambiguity |
| `status.provisioning` (draft) | « provisionnement » | « Radient dispose du tunnel — provisionnement. » | **yes, weakest** — see D-01 (noun among five adjectives) |
| `status.suspended` (draft) | « suspendu » | « Radient dispose du tunnel — suspendu. » | **yes** |
| `status.disabled` (draft) | « désactivé » | « Radient dispose du tunnel — désactivé. » | **yes** |
| `status.revoked` (draft) | « révoqué » | « Radient dispose du tunnel — révoqué. » | **yes** |
| `status.unknown` (draft) | « inconnu » | « Radient dispose du tunnel — inconnu. » | **yes** |

Every one of the six is masculine singular, so no agreement clash can arise for « le tunnel »; the
dash is spaced per the fr guide, the label stays lower case mid-sentence, and the full stop closes
the sentence for all six. No contradiction is created: « dispose du tunnel » asserts that Radient
holds the tunnel, the apposition gives its state, exactly as the English does ("Radient has the
tunnel — active."). No label is wrong, so **no finding lands on any status key**; D-01 is a
sentence-level register note only.

## Findings

| ID | Sev | Key | Current | Problem | Suggestion |
| --- | --- | --- | --- | --- | --- |
| D-01 | **NIT** | `mobile.computers.wait.tunnel_status` (sentence) / `status.provisioning` (label) | « Radient dispose du tunnel — {status}. » with « provisionnement » | Five fills are adjectives (« actif », « suspendu », « désactivé », « révoqué », « inconnu »); « provisionnement » is a noun, so that one render is a telegraphic label rather than a predicate adjective, and reads a shade less parallel than the other five. Inherited from the source's own category mix (en: "active…" vs "provisioning"). **Not gating** and not worth breaking the badge width: « en cours » (2 words, vaguer) or « mise en place » (2 words) would trade badge specificity for the slot. | Keep as is. If a future wave ever gives the label a longer budget, « en cours de provisionnement » would read best in the sentence — but not at badge width. |

NIT budget used: 1 of 5. I am not padding: on my independent reading the four remediated keys are
shippable as written.

## Observations outside this locale's verdict

- **O-1 (programme-level, not an fr defect).** `a5593a79` changed the *mechanism* — `{status}` is now
  a translated label — but **did not update the English context sidecar**:
  `src/i18n/catalogues/en/mobile.computers.context.json` for `mobile.computers.wait.tunnel_status`
  still reads "inserted verbatim and NOT translated, so the sentence must stay grammatical around an
  untranslated English token". That note is stale at head and it is what the brief generator feeds
  translators, so the other six locales are being told the opposite of what the code does. The fr
  sentence happens to be correct under either reading, so this is **not** an fr finding; it needs an
  en-side note fix before the remaining locales' briefs are cut. Committed by the same head — I
  verified the commit touches no catalogue file (5 files: `computers.tsx`, `connector-wait.ts`,
  `tunnel-status-key.ts` + two tests).
- **Fit.** The brief declares **no `maxCells`** for any of the 44 keys (0 of 44), so no declared
  budget can be exceeded. All four changed strings render in wrapping `Text`/dialog bodies with no
  `numberOfLines` — `wait.listing` in the `Shimmer`→`Text text-body` W1 line, `waiting_help` under the
  waiting line (`sign-in-panel.tsx:74`), `remove.body` as a `Dialog` body
  (`computers.tsx:664`), `own_body` in a `text-body-sm` card body (`tunnel-paths.tsx:61`). Growth is
  +14 %, +3 %, +26 %, +31 % by glyph count: cost is height, never a clipped label. No fit finding.
  Wide-glyph/terminal-width risk is not applicable — this is a React Native surface, not a terminal.
- **Second independent pass.** This *is* a second independent pass over the four changed keys and the
  six slot labels (onboarding/sign-in, high visibility), by a fresh instance that did not translate
  and did not audit round 1. I state its limits exactly: the other 40 values were re-proven
  mechanically (byte-identical, parseable, placeholder parity) but **not** re-judged linguistically
  in this round.

## Provenance

Everything below is in this session's scratchpad. The worktree's tracked state was never touched —
`git status --porcelain` empty before and after every read, `git ls-files --others` empty at the end.
One disclosure: my first attempt at assembling `audit.log` used a shell helper whose `cd` leaked, so
it wrote a **gitignored** `audit.log` (6 122 B) into the worktree at 06:47. It was caught by the same
check and removed by exact path at 06:49, and the log was rebuilt with absolute paths; the worktree
was verified clean afterwards. No tracked file, index entry or commit was created.

- `scratchpad/au2-fr/receipt.json` — machine-readable record (this audit)
- `scratchpad/au2-fr/report.md` — this file
- `scratchpad/au2-fr/audit.log` — every command run with its actual output
- `scratchpad/au2-fr/audit-fr.mjs`, `probe-fr.mjs` — the two scripts; outputs in `audit.log.raw`,
  `probe.log`, `residue.log`, `generate-check.log`

Input hashes (sha256, full values in `receipt.json`): en `mobile.computers.json` `f0b7ee28…`,
`mobile.computers.context.json` `93a3f18e…`, `mobile.signin.json` `2fc23f0a…`,
`mobile.signin.context.json` `1e9dc9d9…`; shipped fr `mobile.computers.json` `c3015755…`,
`mobile.signin.json` `c44cf80d…`; core `i18n/style-guides/fr.md` `5315e1ac…` and `i18n/glossary.md`
`0eb34437…` (both read from `~/local-operator` `origin/main` `8459804f`).

No ledger append: the mobile repo carries no i18n ledger or `audit-ledger` CLI (its i18n lives at
`src/i18n/`; `i18n/audits/evidence/` holds per-audit bundles only), and I cannot write into a
read-only worktree. Canonical tracked path for the coder to land with the row:
`i18n/audits/evidence/fr/mobile.computers+mobile.signin/delta-fdd48b3ce97c/` (`record.json`,
`report.md`, `audit.log`), following the round-1 bundle naming.
