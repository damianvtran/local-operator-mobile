# M2 fr DELTA audit — 33 keys — PR #236 round 2 (scope `3af477ee..c4024b49`)

**Verdict: passed — 0 BLOCKER · 0 MAJOR · 1 MINOR · 2 NIT**

- Auditor: role `i18n-auditor`, session `413dca6f8baa`, served model **deepseek/deepseek-flash**
  (session model header; no fallback pinned or used). Independent of the translator
  (`i18n-translator`, `openai/gpt-6.1-sol`) and of every earlier fr auditor of this slice — fresh
  instance, did not translate these files and did not edit them.
- Method: reasoning only — no translation/MT service, no back-translation. Read-only lane: nothing
  edited, staged, committed, pushed or posted on the PR. Scratch only in this session's scratchpad.
- Worktree (manager-owned): `~/local-operator-mobile/.worktrees/i18n-m2-scanner`, `git rev-parse HEAD`
  = `c4024b497a4db3118aae70d8bb132301ea3ab097`, `git status --porcelain` empty at read time and again
  as the last command of the scripted run (`audit.log`).
- Scope audited: the 33-key M2 group (`mobile.computers` 4, `mobile.session` 15, `mobile.settings` 14),
  delta `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a..c4024b497a4db3118aae70d8bb132301ea3ab097`.
- Inputs read: `src/i18n/catalogues/fr|en/mobile.{computers,session,settings}.json`, the
  `en/*.context.json` sidecars, `i18n/style-guides/fr.md` + `i18n/glossary.md` (core repo),
  `docs/i18n.md`, `app/(app)/session/[id].tsx`, `src/features/session/components/status-tray.tsx`,
  `i18n/audits/evidence/NOTE-m2-expression-literals.md`, `fr/m2-expression-literals/*`.

## 1. What actually changed in this delta (computed, not taken on trust)

`git diff --name-only 3af477ee..c4024b49` shows exactly one fr catalogue file touched
(`src/i18n/catalogues/fr/mobile.settings.json`, one line). Over the 33-key group:

| | |
|---|---|
| changed values | **1** — `mobile.settings.diagnostics.stream_degraded`: `Ne répond pas` → `ne répond pas` |
| unchanged values | **32**, byte-identical |
| key set / order | 33 keys at both heads, same set, no key added or dropped |
| nature of the change | case only: `old.casefold() == new.casefold()` and `len(old) == len(new)` — `N`→`n`, nothing else |
| English source values | **unchanged** over the delta (`source33` hash identical at both heads) |
| English *sidecar* notes | 2 changed — `mobile.session.tray.context_short`, `…_short_estimate` (context only, no copy) |

Reversion proof: putting the single old value back into the current pair set reproduces the
`3af477ee` target hash exactly (`audit.log`, section 2) — so "case only, nothing else" is derived,
not asserted.

## 2. SHA-256 (this session, sorted-key JSON of the 33 key/value pairs, UTF-8)

| Form | SHA-256 |
|---|---|
| fr `target33` **at `c4024b49`, default `json.dumps` separators** (the fr auditor's canonical form) | `b9b0983185785a946c134b60994062a76bab8dfbd19cda325c9450bebf892860` |
| fr `target33` at `c4024b49`, **compact** (`separators=(",", ":")`) | `d6e4a0db35ef13ebc181e1366762506fad333e94414996df475eff413db0392f` |
| fr `target33` at `3af477ee` (pre-delta, for the record) | `9aecf8f17941b4a1a7dac4c363ba40d7ad82572b61a05f41b8ad1f9d9c18ae0f` (default) · `9cc6f790904f9d3ef302645c772a38888cd099fdba10c150a986d6f86090bb30` (compact) |
| **en `source33` at `c4024b49`** | `008f9a49490adbde68808c0db487a471f87d3236b79ab9282205796964ad8b98` (default) · `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528` (compact) — identical at `3af477ee` |
| en `context33` (role+note) at `c4024b49` | `3227926233850015fd08bd75df7645d4b3f88c16e370eccdeb6497fc35523305` (was `c08984e3269537e6c35bde77aff0d3754dd46ecb974c8e9d108df7c315dce2d4` at `3af477ee`) |

The expected `b9b09831…` was **re-derived here**, not copied: the same function reproduces the
`3af477ee` value `9aecf8f1…` the round-1 re-audit quoted, which validates the method before it is
applied to the new head.

File-level: fr `mobile.computers.json` `c3015755e033b3fca2236ffee8d967df3c25ccff96ee85aad0bd9457cd5b6135`,
fr `mobile.session.json` `62ea762bca7f9b47a2c5fa02bdc30e97dc9f2755c00b5c6a7d4a6588875f8aa7`,
fr `mobile.settings.json` `c21961f4c2f71587dfdfc6794c0a2c2429963e7fcfed3272d3686601aa247eff`
(`cc56f6e0cd9193ef03076bca1b88842cfd3005528319a012680ac93408c19826` at `3af477ee`).

**Bundle integrity, one process point:** `fr/m2-expression-literals/final.json`
(`1db648167ce217cbacc3cc35a805ffece233627141180c2813dd2a525ab7c0bf`) still equals the **pre-delta**
33 values and therefore now differs from shipped bytes on exactly one key — the one this report
attests. That is the same class as `libc-fr-r2` ("round-1 bundle describes bytes that no longer
exist"); this delta report is the artifact that covers the current bytes. `final.json` should not be
edited to fake agreement.

## 3. Mechanical

- `node scripts/i18n/generate.ts --check` → exit **0**:
  `src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, …)` (known
  `MODULE_TYPELESS_PACKAGE_JSON` warning only). The generated projection carries the new lowercase
  value (`catalogue.gen.ts:4507`) and was committed with the change. ✓
- `node scripts/i18n/check-strings.ts` → exit **0**: `212 finding(s), all baselined; 0 new; verified
  historical debt vs fa2bc5e0b5f7`. ✓
- Placeholders: names and multiplicity identical to English in all 33 (`{percent}`, `{labels}`,
  `{host}`, `{baseUrl}`, `{name}`); no `%s` drift, no renamed argument. ✓
- ICU: no plural/select message in this group in either language → no CLDR-category question arises
  for fr (`one`/`many`/`other` rules are unexercised here). ✓
- Structural tokens: `·`, `↑`, `↓` counts equal to source; `{percent}` unchanged; the fr
  narrow/no-break space U+202F before `%` is present in all four tray values and is a fr-guide
  requirement, not a placeholder change. ✓
- JSON validity, no empty strings, no leading/trailing spaces, all values NFC, no ASCII `'`
  (U+2019 only), no bidi control characters. ✓
- Terminal stops match English per key (the two `wait.*` sentences keep their full stop). ✓
- **Negative control (mutation in memory; nothing written):** `{name}`→`{nom}` → placeholder
  mismatch; dropping `↓` → glyph loss; trailing space → pad; reverting the delta value to
  `Ne répond pas` → case regression caught; fr = English (`Back to {name}`) → identical-to-source;
  `{percent} % du ctx` (U+202F dropped) → spacing/width flag; the mutated pair set hashes differently
  from the real one. The checker bites on every class it is asked to police. ✓

## 4. The case change, judged against the sidecar rule and the siblings

The `stream_degraded` note says: "Lower-case diagnostic word, shown in a monospace line; one word, no
final full stop."

- **Lower case — now satisfied.** Before the fix the value was the only capitalised member of its
  column. At `c4024b49` the fr Diagnostics "Stream" column reads `inactif · connexion · actif ·
  ne répond pas · hors ligne`: a lowercase value list, which is what the note asks for and what the
  fr guide's "compact fragments and statuses may stay lowercase" allows.
- **The distinction from `mobile.settings.status.not_answering` = `Ne répond pas` is now clean.**
  That key belongs to a different column (sentence-case statuses: `Connecté · Hors ligne · Non
  connecté`), so the two spellings are two different columns, not an inconsistency. Capitalising the
  diagnostic value blurred that; lower-casing it fixes it.
- **Siblings agree.** Every other locale's degraded value is lower-case and multi-word in its column
  (`es no responde`, `ru не отвечает`, `vi không phản hồi`, `ur جواب نہیں دے رہا`); `hi` and `zh-CN`
  have no letter case. The chosen wording is the shipped fr phrase for "not answering" and keeps the
  negative polarity exactly. No unsafe wording: this is a diagnostic state, not a permission or a
  destructive action.
- **`one word` remains unsatisfiable** in fr ("ne répond pas" = 3 words) — see NIT n2; it is not
  satisfiable in es/ru/vi/ur either, and the multi-word value is what those locales ship.

## 5. Ruling on the `ctx` exception — **accepted**, as a named width exception

`mobile.session.tray.context_short` = `{percent} % ctx` and `…_short_estimate` = `{percent} % ctx
(estim.)`. I accept them. Reasons, in order of weight:

1. **The slot is genuinely tight, in the code, at the width the short form targets.** The short form
   is selected by `viewportWidth < 340` (`app/(app)/session/[id].tsx:924`, `:1005`) and painted in
   the activity band (`:997-1008`), a single-row `text-mono-sm`/`flex-wrap` band that also holds the
   cost and the subagents chip. The comment at that call site records the design decision (round 2,
   D17): with the full word, `21% context (est.)` beside the cost **wraps the band to two lines** and
   the cost floats between them. Above 340 pt the full form is used and reads whole.
2. **fr's full form is what the wide slot already has, and it does not fit the narrow one.** fr full =
   `{percent} % du contexte` (17 cells with the narrow space), estimate = `… du contexte (estim.)`
   (26 cells). D17's wrap case is the 17-character estimate string `21% context (est.)`, so fr's own
   **non-estimate full form sits exactly at that threshold** and the estimate form is 9 cells past it.
   Nothing shorter in French carries "context" than `ctx` (9 cells); no fr synonym is shorter and none
   is on the kept-English list either. Measured at `{percent}`→`100` (this session):

   | locale | full | full+estimate | short | short+estimate |
   |---|---|---|---|---|
   | en | 12 | 19 | 8 | 15 |
   | fr | 17 | 26 | 9 | 18 |
   | es | 16 | 25 | 16 | 25 |
   | vi | 13 | 24 | 13 | 24 |
3. **Precedent inside this catalogue for the abbreviation style.** fr already abbreviates the
   *estimate* marker natively — `(estim.)` for `(est.)` — which is the fr convention (abbreviation
   with a full stop). `ctx` is the consonant skeleton of *contexte* as much as of *context*
   (`c·t·x`), so it is decipherable to a French reader rather than an English word left in place.
   The es remedy (`{percent}% de contexto (aprox.)`) is not available to fr at 340 pt for the same
   reason it was unavailable to es in the *narrow* slot — see m1.
4. Therefore this is a **width exception**, which the fr guide already has a mechanism for
   ("Recorded width exception: `cli.services_status` …"), not a silent leak of English. Condition
   (n1): record it in the core `i18n/style-guides/fr.md` kept-English/width list so the next auditor
   does not re-litigate it. That record lives in the *core* repo, not this one — hence it cannot be
   landed by this PR.

I am not accepting it because "the designer did not gate it": design gates layout, and the D17
argument above is what actually decides it. Had the narrow slot really been a 318-pt full-width cell,
the full form would fit and I would have required the change — see m1, where the note's premise turns
out to be inverted.

## 6. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| m1 | MINOR (non-gating, input/process) | `mobile.session.tray.context_short` (en sidecar note) | "the short form only renders in full-width rows (the More sheet Context row and the status sheet, value cell 318 pt at 390 pt wide), so brevity is not needed" | The premise is inverted. The short form is selected when `viewportWidth < 340` and paints the **narrow** activity band; at 390 pt the code selects the **full** form for the 318-pt sheet cell. So brevity *is* needed where the short form actually renders (D17). This note is also the stated basis on which es and vi were moved to full forms — `{percent}% de contexto` (16 cells, 25 with the estimate) and `{percent}% ngữ cảnh` (13, 24), both at or past the 17-character string D17 records as wrapping the band, so the same wrap may now occur in those locales in the very slot the note says is safe | Restore the true justification: "short form renders in the activity band under 340 pt beside the cost; the full word wraps it (D17), so an abbreviation is required; the 390 pt sheet uses the full form". Route the es/vi consequence to design/QA — it is outside the fr values and outside this gate |
| n1 | NIT | `mobile.session.tray.context_short` / `…_short_estimate` (fr values) | `{percent} % ctx` | Accepted as a width exception, but it is not on the fr guide's kept-English list and French exceptions are recorded there, not in an English sidecar | One line in `i18n/style-guides/fr.md` (core repo): recorded width exception — `ctx` for *contexte*, the under-340-pt activity band (D17), plus the values it covers |
| n2 | NIT | `mobile.settings.diagnostics.stream_degraded` (en sidecar note) | "…one word, no final full stop." | `one word` is unsatisfiable in fr (3 words) and in es/ru/vi/ur as shipped; no locale can honour it, so it reads as a broken constraint for the next translator | Soften to "one word where the language allows; no final full stop" when the note is next touched. Value accepted as shipped |

Deferred items named in the round-1 ledger (D3, vi F3, hi H-R1/H-R2, zh-CN MINOR-1, Q2, M3) were
**not** re-raised. The 32 unchanged values were retained on their round-1 verdicts (0B/0M, fr
re-audit at `3af477ee`), with the mechanical layer re-run over all 33 here and all 33 re-read once.

## 7. Retained vs re-judged

- Re-judged: `mobile.settings.diagnostics.stream_degraded` (the delta) — §4.
- Re-read and retained: the other 32 values, including the `ctx` pair (explicitly ruled on in §5
  because the round-1 stream carried it as an open NIT) and the four region labels.
- Not re-audited: locales other than fr.

## 8. Proposed ledger record (manager/committer to land; my lane is read-only)

`status: passed` · locale `fr` · namespace (file group) `m2-expression-literals`, covering `mobile.computers` 4 + `mobile.session` 15 + `mobile.settings` 14 · auditor
`i18n-auditor` / session `413dca6f8baa` / model `deepseek/deepseek-flash` (session header, no
fallback) · base `3af477ee` · head `c4024b49` · target `b9b0983185785a94…` (default separators;
compact `d6e4a0db…`) · source `008f9a49490adbde…` · 0B/0M/1m/2n · report
`fr/m2-expression-literals/delta-r2-c4024b49/audit-delta-fr.md`.

No `audit-ledger` command exists in this repository at `c4024b49` (`package.json` exposes only
`i18n:generate`, `i18n:catalogue:check`, `i18n:strings:check`, `i18n:check`; no ledger writer, no
ledger file) — so nothing was written to a ledger, and the status lives in this report and in
`record.json`.
