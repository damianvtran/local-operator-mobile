# Independent DELTA audit — `ru` — PR #236, round-1 remediation (M2 expression literals)

**Verdict: `passed` — BLOCKER 0 · MAJOR 0 · MINOR 0 · NIT 2.**
Round-2 ru finding **m-1 (capital `Не отвечает` in the Diagnostics column) is RESOLVED** and verified
here from the bytes. The delta is exactly one code point of case; the other 32 ru values are
byte-identical; the English side is untouched.

- Scope audited: `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a..c4024b49` (fix `81d44fc5`, pin-only `c4024b49`)
- Worktree (read-only, manager-owned): `~/local-operator-mobile/.worktrees/i18n-m2-scanner` —
  `git rev-parse HEAD` → `c4024b497a4db3118aae70d8bb132301ea3ab097`, `git status --porcelain` empty.
- Not posted on the PR; no repo write, no ledger write, no clone, no install, no new worktree.

## Auditor identity (disclosed)

- `agent`: **i18n-auditor** (lopdev team) · `session`: **291074d0d436**
- `model`: **deepseek/deepseek-flash** — source: this run's own harness session header
  (`Model: deepseek/deepseek-flash`). No role/model pin set by me, **no fallback observed**,
  `actual_model_source` = session header (not a self-claim).
- `independent_from_translator_session`: **true** — translator was `openai/gpt-6.1-sol`; I am also not
  any earlier ru auditor (round 1 A s`2516ea781924`, round 1 B / round 2 s`38b309c987d5`, shipped-bytes
  re-audit s`81c04d13bc66`), and not the designer or the coder.
- No translation/MT service, dictionary, back-translation or MT comparison was used. Every judgement
  below is my own reading of `ru`.
- **Not device-verified by me**: no native iOS/Android frame; copy judgement only.

## Inputs audited (exact bytes, sha256)

| Role | Path | sha256 |
|---|---|---|
| Target values (33), canonical sorted-key `{key:value}` **at `c4024b49`** | `src/i18n/catalogues/ru/mobile.{settings,computers,session}.json` | **`794ce68d7fb53dbe4baf4ae77af896440915c1bc4a2447d986ce657f563f1469`** |
| Target values (33), same canonicalisation, at `3af477ee5dd7…` | same three files | `4e76a2e0f98de6ab309777dceddd9556979c71754f3894b511a50cc8bb7c7dae` |
| English values (33), same canonicalisation, both revs | `src/i18n/catalogues/en/mobile.{settings,computers,session}.json` | **`c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528`** (unchanged) |
| Raw `ru/mobile.settings.json` | — | `ca69c7f8…8bf8dad8` → **`ef2a6da7…165efd82`** (this is the only ru file that moved) |
| Raw `ru/mobile.computers.json` | — | `d9301956…76856521` (unchanged) |
| Raw `ru/mobile.session.json` | — | `f58ea87e…4c73d878` (unchanged) |
| Raw `en/mobile.{settings,computers,session}.json` | — | `d7e1d85b…aee23d`, `71382783…76aff3`, `8df14a0d…a716d3` (all unchanged) |
| Context sidecars `en/*.context.json` | settings / computers / session | `67691ab9…54c12`, `cc297300…7637e0`, `50d48c6a…394d5` |
| Audited record | `i18n/audits/evidence/ru/m2-expression-literals/final.json` | `b6b8afeb…b6f93d` |
| Bundle manifest | `i18n/audits/evidence/NOTE-m2-expression-literals.md` | `f50e6134…678780d` |

Canonicalisation (derived, not assumed): `sha256(json.dumps({k: v for the 33 keys}, sort_keys=True,
ensure_ascii=False, separators=(",", ":")))` — the JS `JSON.stringify` compact form. I **proved** this
convention by reproducing *two* independently recorded digests with it before using it:
`4e76a2e0…` for the ru pre-image and `c326a93f…` for the en values. A convention that reproduces both
prior hashes is the prior convention; a wrong one would have matched neither.

## What the delta is (derived from git, not from the brief)

- The 33-key set is derived by me: keys present at `6b539d7a` and absent at its parent `fa2bc5e0`
  across the three ru catalogues → **33** (settings 14, computers 4, session 15); the same derivation
  on `en` gives the identical set, and it equals `final.json`'s 33 names exactly (set-equal, no
  missing, no extra).
- **Whole-catalogue** comparison `3af477ee…` → `c4024b49` (all 182 ru keys, not just the 33):
  `added: []`, `dropped: []`, `changed: 1` —
  `mobile.settings.diagnostics.stream_degraded  'Не отвечает' -> 'не отвечает'`.
  en/ru key parity at head: 182 / 182. Nothing else in the ru locale moved in this range.
- Shipped head vs the **audited record** `final.json`: exactly 1 differing key — the same one, same
  direction. So the only shipped wording difference from what was audited is this case fold.

## Mechanical (executed here; actual output)

- **Repo validator** — `npm run -s i18n:catalogue:check` at `c4024b49`, exit 0:
  > `src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`
- **Scanner** — `npm run -s i18n:strings:check`, exit 0:
  > `check-strings: 212 finding(s), all baselined; 0 new; verified historical debt vs fa2bc5e0b5f7`
- **Runtime string really changes**: `catalogue.gen.ts` inlines values, and at head it carries
  `"mobile.settings.diagnostics.stream_degraded": "не отвечает"` (`:5879`). The two remaining capital
  `Не отвечает` in the generated file are the two *sentence-case* surfaces —
  `mobile.settings.status.not_answering` (`:5894`) and `relay.chrome.session.subtitle.not_answering`
  (`:6108`) — whose English is `Not answering` (capital) in both places. So the change is
  surface-consistent, not a blind lowercase sweep, and it is visible: `DiagnosticRow` applies no
  `textTransform`, so the case renders as authored.
- **Placeholders/ICU** — the changed value has **no** placeholders and no braces
  (`params: []`, `braces: false`); it is not a plural or select, and none was invented. Across all 33:
  9 keys carry arguments, compared with the app's own parser
  (`src/i18n/messages.ts` → `parseMessage().params`), ordered `[name:kind]` against `en`:
  **`keys=33 withArgs=9 argFailures=0`**.
- **Plurals** — the range touches no plural message; the 5 plural messages that remain in the three ru
  files are byte-unchanged (`any changed: []`) and each carries all four ru CLDR arms:
  `relay_version_sessions`, `relay_sessions`, `highlights.withheld`, `highlights.sounds_more`,
  `pending_echo.images` → `['one','few','many','other']`.
- **JSON/keys** — all three ru files parse; validator above confirms the 21-namespace graph is current;
  no key added or dropped in the range (see "What the delta is").
- **Value hygiene** — `не отвечает`: 11 code points, NFC, 11 chars before and after, single U+0020
  between the words, **no trailing space**, no final full stop (correct: the sidecar asks for none),
  every letter **CYRILLIC** (`н е о т в е ч а е т`; no Latin homoglyph `e`/`o`/`a` slipped in — checked
  by Unicode name, not by eye).

### Case-only, proved both ways

| | value | len | casefold-equal |
|---|---|---|---|
| pre `3af477ee` | `Не отвечает` | 11 | — |
| head `c4024b49` | `не отвечает` | 11 | `True` |

Only the first letter's case differs; every other byte is identical.

## The sidecar rule it had to satisfy, and the siblings

- `en/mobile.settings.context.json` → `mobile.settings.diagnostics.stream_degraded`: *"Value of the
  Diagnostics \"Stream\" row when the stream is open but not answering. **Lower-case diagnostic word**,
  shown in a monospace line; one word, no final full stop."* The shipped value is now a lower-case
  diagnostic word with no final stop. **Rule satisfied.**
- Siblings in the same monospace value column, all lower-case at head: `в простое`, `подключается`,
  `активен`, `вне сети`. `не отвечает` is now the **fifth** lower-case value — and grammatically it
  pairs with `подключается`, the other finite verb in the column.
- Cross-surface reuse is intact and deliberate: the status row and the relay subtitle keep the capital
  `Не отвечает`, matching their English `Not answering`. So the same condition reads identically in all
  three places, with case following the surface — which is what m-1 asked for.
- The other capital in the diagnostics block (`Через ваш туннель Radient`, a phrase from a different
  key) has a capital English source too — so the column has no inconsistent break left.

## Accuracy, idiom, register, terminology (my reading)

- Meaning preserved exactly: English `degraded` (stream open, not answering) → `не отвечает` — the same
  reading as the audited value, with no negation or polarity drift introduced by the case fold.
- Natural Russian for a status word: an elliptical 3rd-person present verb, subject «поток» implied;
  this is how ru mono-diagnostic columns read. No agreement trap (present tense carries no gender, so
  nothing needs to agree with the masculine «поток» — unlike the short adjectives `активен`/`подключён`,
  which already encode it).
- Register: neutral, terse, impersonal — matches the guide's "sentence case, never Title Case, no
  politeness padding". No glossary term is involved; nothing destructive, no permission or error text.
- Terminology across the 33 unchanged values is unaffected by this delta (bytes identical).
- Fit: 11 cells, identical to the pre-image; the Diagnostics value column is `flex-1`, `text-mono-sm`,
  `numberOfLines={2}`, so no overflow risk; the slice's sidecar carries no `maxCells`. Cyrillic is
  precomposed (NFC), no combining-mark width risk; the cell is `LTR_WRITING`, unaffected by Cyrillic.
- Not an RTL locale — bidi rules do not apply.

## Tray short forms carry no Latin token (asked explicitly)

At head, the four ru tray context strings, with placeholders masked:

| key | value | cells | Latin letters |
|---|---|---|---|
| `mobile.session.tray.context` | `{percent}% контекста` | 20 | none |
| `mobile.session.tray.context_estimate` | `{percent}% контекста (прибл.)` | 29 | none |
| `mobile.session.tray.context_short` | `{percent}% конт.` | 16 | none |
| `mobile.session.tray.context_short_estimate` | `{percent}% конт. (прибл.)` | 25 | none |

Wider sweep of **all 33** ru values with `{placeholders}`, `Radient` and `Local Operator` masked:
**no residual Latin letters in any key**. ru is not carrying an English `ctx` anywhere.

**And the sidecar note's justification is true on the code at head** — I checked it rather than
believing it, because a shipped comment says the opposite. `contextFact(narrow = viewportWidth < 340)`
has two callers: `trayFacts.context` (`app/(app)/session/[id].tsx:920`) and the `statusStrip`
(`:1001`). But `statusStrip` only renders in the `!tray` branch (`:1282-1295`), and `tray` is true for
every phone (`size-class.ts:676`), so at <340 the strip cannot paint; the only reachable narrow
renderer is `trayFacts.context` → the status sheet line (`:1696`) and the composer More sheet row,
both full-width. So "the short form only renders in full-width rows, brevity is not needed" is
**correct**, and the es/vi copy-the-full-form fix rests on sound geometry. (My first reading concluded
the reverse from the stale comments; recorded so the 0 is not a silent miss.)

## Negative controls (the checks must bite)

1. **Hash, reverse direction.** Restoring just the capital in the head values
   (`stream_degraded = "Не отвечает"`) reproduces `4e76a2e0f98de6ab…` **exactly** — the pre-image hash.
   So the digest is a function of these bytes only and the delta is exactly that one code point, no
   hidden second change riding along.
2. **Hash, sensitivity.** Adding one trailing space to `mobile.session.fallback_name` moves the digest
   (`3e330ae42aae70ef…`) → the digest is not degenerate.
3. **Argument checker.** In-memory mutations `tray.context` → `{percent}% контекста {extra}` and
   `route_direct` → `… к {baseurl}` are flagged
   (`mobile.session.tray.context, mobile.settings.account.route_direct`), pure-text mutations are not,
   and the clean tree returns `[]` — the `argFailures=0` above is a real pass, not a checker that never
   fires.

## Findings

### NIT

**n-1 · two shipped source comments now describe the layout the geometry no longer has.**
`app/(app)/session/[id].tsx:130-133` (`narrow` "is the under-340 pt form … the full word wraps the
activity band to two lines there") and the block comment at `:1005-1011` ("`ctx` under 340 pt … wraps
to two lines inside the band") still describe the pre-D-S3 layout in which `statusStrip` painted on a
narrow phone. At head the strip renders only off-phone, so a reader (me, for several minutes) can
conclude the new sidecar note is wrong when the note is right. Not copy, not this PR's bytes, not
gating — worth one line whenever that file is next opened, so the next auditor does not re-litigate it.

**n-2 · the rewritten `en` sidecar note names only es/vi/fr in its "Shipped:" sentence.**
`mobile.session.tray.context_short`: *"Shipped: es and vi reuse the full form; fr keeps \"ctx\"…"* —
`ru` (and `ur`, `hi`, `zh-CN`) ship native short forms and are unmentioned, so a future translator
cannot see that ru's `конт.` was a deliberate, twice-audited decision rather than an oversight. A
non-shipping translator meta artefact; free to leave, cheap to extend with one clause.

### Retained, not re-raised

- Round-2 ru **m-2** (`конт.` as the short form of «контекст») is pre-existing, unchanged by this delta
  and previously accepted as minor; it does not gate. One measured note for whoever next re-opens
  width: ru's `конт. (прибл.)` is **25 cells**, the same length as vi's "short" form that D1 rejected
  as too long — so ru's estimate short form saves only 4 cells over its full form. If the <340 band
  comes back under review, look at ru in the same pass rather than fixing es/vi alone.
- Retained as clean in the delta: the other 32 ru values (bytes identical), the en values (hash
  identical), the 5 plurals, and every surface outside this one string.

## Verdict for the manager

**Group `ru` / `m2-expression-literals`: `passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT. The
round-1 remediation for ru is confirmed in the shipped bytes: the case fix landed, nothing else moved,
and the ru short forms carry no Latin.

Suggested ledger row (write it yourself — no `audit-ledger` command exists in this repo; `i18n/` holds
only `audits/`, and core `i18n/ledger.json` has no mobile rows). Note, ≤280 chars:

> `ru M2 delta 3af477ee..c4024b49: 1 case-only fix (stream_degraded -> "не отвечает"), other 32 values byte-identical; 33-value sha 794ce68d, en c326a93f unchanged. 0B/0M/2n. i18n-auditor/deepseek-flash s291074d0d436, indep of gpt-6.1-sol. Evidence: ru/m2-expression-literals/audit-delta-ru.md`

Companions written beside this file: `record.json` (the retention schema's fields) and `audit.log`
(the raw command transcripts — actual execution, not notes).

**I could not commit the bundle**: the worktree is read-only for me, so
`i18n/audits/evidence/ru/m2-expression-literals/` does not carry it yet. Everything is in this
session's scratchpad (`~/.local-operator/sessions/291074d0d436/scratchpad/`); the manager owns the
tracked commit.
