# es — M2 round-2 delta audit (independent, translation only)

**Verdict: `passed` — 0 BLOCKER · 0 MAJOR · 1 MINOR · 1 NIT.**

| | |
|---|---|
| Locale | `es` — neutral Spanish, **tú**, sentence case (`i18n/style-guides/es.md` @ `~/local-operator`) |
| Namespace (file group) | `m2-expression-literals` = `mobile.computers` (4) + `mobile.session` (15) + `mobile.settings` (14) = **33 keys**; delta = the **3** changed es values |
| Scope | `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a..c4024b497a4db3118aae70d8bb132301ea3ab097` (round-2 delta of PR #236) |
| Auditor | `i18n-auditor` — fresh instance; NOT the translator (`i18n-translator` / `openai/gpt-6.1-sol`), not either earlier es auditor (`deepseek/deepseek-flash` R1-A, `anthropic/claude-sonnet-5-5` R1-B/R2/R3) |
| Session | `460114b18e98` (team `lopdev`) |
| ACTUAL served model | `deepseek/deepseek-flash` — this run's session header. No switch, no fallback. |
| Worktree | `~/local-operator-mobile/.worktrees/i18n-m2-scanner` @ `c4024b49` (`git rev-parse HEAD` verified; manager-owned, READ-ONLY — I wrote nothing, committed nothing, pushed nothing) |
| Method | own reasoning + the repo's **shipping parser** (`src/i18n/messages.ts`) + the repo validator; source reading for reachability; the repo's own Figtree advance table for width. **No** translation API/SDK/MT service, no back-translation. |

## 1. The delta, exactly

`git diff 3af477ee..c4024b49 -- src/i18n/catalogues/es/` changes three lines and nothing else
(no key added or removed, no other value touched; the file is still valid JSON and
`i18n:check` proves it defines exactly the English key set):

| Key | Was (audited at `3af477ee`) | Now | Change |
|---|---|---|---|
| `mobile.session.tray.context_short` | `{percent}% ctx` | `{percent}% de contexto` | now a byte copy of `tray.context` |
| `mobile.session.tray.context_short_estimate` | `{percent}% ctx (aprox.)` | `{percent}% de contexto (aprox.)` | now a byte copy of `tray.context_estimate` |
| `mobile.settings.diagnostics.stream_degraded` | `No responde` | `no responde` | case only; no wording change |

**No new Spanish wording enters the catalogue in this round.** Two values are byte-identical
to text that was already audited; the third is the same two words with a lower-case initial.

## 2. Mechanical — PASS

`npm run -s i18n:check` (actual output, this worktree at `c4024b49`):

```text
src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
scanner sha256: base=cf05770fe3fa0ff57d974806f5eb48e0278e8e8785c7d785817548b7ce95b813 head=8bb99b7db236df384079e8f3fe872d2edabf571915c95b5352fd87f1385357b0
check-strings: 212 finding(s), all baselined; 0 new; verified historical debt vs fa2bc5e0b5f7
```

Own checker (`check-delta-es.mjs`, scratchpad) imports the **shipping** `parseMessage` /
`formatMessage`, not a reimplementation. It renders the values and asserts the delta:

- `{percent}` is one `text` argument in both languages, name and kind identical
  (`{"percent":"text"}`); `stream_degraded` carries no argument in either language.
- Formatting: `21% de contexto`, `100% de contexto`, `7% de contexto (aprox.)`. `%` sits
  tight against the number (es convention, and the formatter supplies the digits, so no
  hand-written numerals).
- No `plural`/`select` in the delta or in the English source of these keys, so there are no
  CLDR arms to check. (The es guide's category set — `one`/`many`/`other`, never `few` — is
  therefore not exercised; unchanged from the round-3 audit of this group.)
- NFC: all 33 es values are NFC, no bidi controls, no edge whitespace, no stray braces.
- Parenthesis count and terminal full stop match the English source for all three keys
  (`(aprox.)` keeps its parentheses; no full stop where en has none).
- Case: `stream_degraded` starts lower-case and has no final full stop, per its sidecar;
  `contexto` is lower-case, per the `context` sidecar ("Lower case \"context\"").
- **Negative control, 7/7 CAUGHT** (in-memory mutations; all caught):
  1. `context_short` reverted to the pre-remediation `{percent}% ctx` — caught by the
     English-token rule; 2. placeholder renamed `{pct}` — caught by the argument-identity
     rule; 3. placeholder dropped — same rule; 4. `stream_degraded` re-capitalised
     `No responde` — caught by the lower-case rule; 5. `Aún sin conexión` shipped NFD —
     caught by the NFC rule; 6. `(aprox.)` dropped from the short estimate — caught by the
     parenthesis rule **and** by the full-form-equality rule; 7. trailing space — caught.

Because assertions 1–4 in a first draft of my checker were vacuous (the parser exposes
`params`, not `arguments`, so every argument map compared equal at `{}`), I fixed the
checker and re-ran before reporting; the numbers above are from the run that actually
discriminates.

## 3. Byte-exact provenance of the two reused forms

Chain, each link verified here:

1. `i18n/audits/evidence/es/m2-expression-literals/final.json`
   (sha256 `7141a06ff9921b541db5a9cd61af53a6da8aacb1347cb843199dcd4a3ff84388`, unchanged
   from the round-3 audit that read it) carries `tray.context` = `{percent}% de contexto`
   and `tray.context_estimate` = `{percent}% de contexto (aprox.)` — i.e. these exact
   strings are the audited full forms. It also carries the pre-remediation
   `stream_degraded` = `No responde`, the value the round-3 report raised as `M2-es-R3-01`.
2. Those two full-form values are **unchanged in the shipped tree** by the remediation: the
   diff above touches only the short keys and `stream_degraded`, so the audited full forms
   are still what ships.
3. Shipped `tray.context_short` is **byte-identical** to shipped `tray.context`, and
   `tray.context_short_estimate` to `tray.context_estimate` (asserted on the raw strings,
   not normalised).
4. `stream_degraded` now equals the audited value `No responde` after `.toLowerCase()` —
   a case-only edit, exactly the suggestion in `M2-es-R3-01`.

So every byte of this delta is audited text; there is no unaudited new wording for a second
pass to have to catch. The `es` guide's row now reads consistently:
`inactivo · conectando · activo · no responde · sin conexión` — all lower-case fragments, no
full stops, matching the English row's own lower-case (`idle · connecting · live · degraded ·
offline`).

## 4. Fit — the one place the delta costs something

**Reachability (verified in source, not relayed).** `contextFact(narrow = viewportWidth < 340)`
is the only caller of the two short keys (`app/(app)/session/[id].tsx:134-149`). At
`viewportWidth < 340` the value can reach exactly two surfaces:

- the composer **More sheet** Usage row — `ContextRow` (`composer.tsx:2591-2595`): label
  `Contexto` `shrink-0`, value `min-w-0 flex-1`, **`numberOfLines={1}` + tail ellipsis**;
- the **status sheet** line (`[id].tsx:1693-1699`): full-width `px-4 text-mono-sm`, no
  `numberOfLines` — it wraps, it cannot clip.

`StatusTray` (the other consumer of the same string) renders only when `compact` is true —
short landscape, ≥ 568 pt (`[id].tsx:1285-1292`, `statusTrayVisible`), and `statusStrip`
renders only when `tray` is false — i.e. a tablet ≥ `tabletBreakpoint` 700 pt
(`[id].tsx:985-1000`, `sessionStatusLayout`, `tokens.gen.ts:302`). **`< 340` and those two
bands are mutually exclusive**, which is what the designer's D1 established and what the
changed sidecar note now records. Confirmed.

**Width arithmetic** (body-sm = 14 pt; the repo's own per-glyph Figtree *Medium* advances,
`src/ui/components/list-row-meta.ts` — an upper bound for the row's regular-weight text;
sheet content = `W − 32` (`px-4`), `gap-3` = 12; label `Contexto` measured 59.5 dp at
100 % / 119 dp at 200 %):

| Viewport | Text scale | Value cell | Needs (`100% de contexto`) | Result |
|---|---|---|---|---|
| 320 pt | 100 % | 216.5 dp | 114.7 dp | fits — 53 % of the cell |
| 360 pt | 100 % | 256.5 dp | 114.7 dp | fits |
| 390 pt | 100 % | 286.5 dp | 114.7 dp | fits (designer measured the fr cell at 318 px) |
| 320 pt | 200 % | 157.0 dp | 229.3 dp | **elides** (`100% de context…`) |
| 390 pt | 200 % | 227.0 dp | 229.3 dp | marginal (within font-weight noise; pre-existing — the full form was always the ≥340 value) |

Control: the fr **full** form that already ships in the same row class at ≥ 340 pt,
`100 % du contexte`, needs 117.8 dp — wider than the es value. Spanish is not the widest
locale here. `TEXT_SCALE_PERCENTS = [100,150,200]`, so 200 % is user-selectable; at 150 % on
320 pt the value fits (172 vs 186.7 dp).

The old `100% ctx` needed 58.2 dp (100 %) / 116.4 dp (200 %) and therefore did not elide at
320 pt with 200 % text. That is the delta's only measurable cost, and it is confined to
that combination.

### MINOR

**M2-es-R2D-01 · `mobile.session.tray.context_short` / `..._short_estimate` — 200 % text on a 320 pt phone elides in the More sheet Usage row.**
Current: `{percent}% de contexto` (229.3 dp at 200 %). Cell: 157.0 dp. Problem: the row is
single-line with a tail ellipsis, so at max text scale on the narrowest supported phone the
value paints `100% de context…`. Nothing is *wrong* with the words, nothing overlaps, no
meaning is lost, and Spanish has no native abbreviation for "contexto" (`ctx.` is not
Spanish) — so the wording is the right call and this does not gate. Suggested: record the
caveat in the sidecar note rather than change the value — e.g. append to
`mobile.session.tray.context_short`: *"At 200 % text on a 320 pt phone the value elides in
the More sheet; the row is `numberOfLines={1}`, so this is elision, not clipping."* The note
currently reads as an absolute ("brevity is not needed"), which a future translator will
read as a promise the 200 % case breaks.

### NIT

**n1 · sidecar says "one word" for `stream_degraded`; es needs two.**
`en/mobile.settings.context.json` → `stream_degraded`: *"Lower-case diagnostic word, shown
in a monospace line; one word, no final full stop."* English `degraded` is one word; the
Spanish for "open but not answering" is the periphrasis `no responde`. The row already
carries a two-word value (`sin conexión`), so nothing breaks and no change is needed — noted
only so a later auditor does not read `no responde` as a violation of that hint. If the note
is ever edited, "one word" → "one short word or periphrasis" would say what is meant.

## 5. Accuracy, idiom, terminology, RTL

- **Accuracy**: no omission, addition, negation or polarity error. `{percent}% de contexto`
  is exactly the audited meaning at both call sites (the value *is* the context-window
  fill); `(aprox.)` correctly marks the estimate where `context_is_estimate` is true, and
  the short/non-short pair it now duplicates are the same fact. `no responde` matches its
  sidecar's definition verbatim in sense — *"when the stream is open but not answering"* —
  and no longer contradicts the row's casing. It does collapse English's `degraded` vs
  `Not answering` distinction onto one periphrasis, which is Spanish's natural rendering
  and the disposition the round-3 finding itself recommended; the case difference keeps the
  two surfaces distinguishable in print.
- **Idiom / register**: native product copy. `de contexto` is the standard Spanish for "of
  context" in a usage meter (cf. shipped `Contexto` row label); `aprox.` is the ordinary
  Spanish abbreviation of *aproximado*; `no responde` is the ordinary third-person form.
  Neutral Spanish — no region-marked word, `tú` not involved in these fragments, no `!`, no
  Title Case. `%` tight against the number is es convention (the guide's "no space before
  punctuation" rule and the fr contrast `0 % du contexte`).
- **Terminology**: `contexto` / `sesión` / `máquina` etc. unchanged from the audited set and
  consistent with the shipped catalogue. `aprox.` appears twice, both times in the same
  parenthetical role. No glossary row covers "context window" or "degraded", so no glossary
  violation is possible here; the es guide's recorded calls (`sesión`, `subagente`,
  `tareas`) are untouched by the delta.
- **No English left** in the delta: `de contexto`, `aprox.`, `no responde` are Spanish; no
  `ctx`, no `est.`, no Latin technical token. Across all 33 es values the only Latin-script
  non-Spanish tokens are `Local` / `Operator` (the product name, IDENTICAL_BY_DESIGN) and
  `Radient`. The operator's acceptance criterion ("switching to `fr` must leave NO English
  anywhere … and the same must hold for every supported language") holds for this group in
  es as far as these 33 values can carry it.
- **RTL**: n/a (`es` is LTR). No bidi controls in any of the 33 values (asserted).

## 6. Hashes (sha256)

| Part | Value |
|---|---|
| es 33 shipped values — sorted-key JSON, compact, UTF-8 | `987ad1d7457dfbf788d63c67ce77d4693cf79f397077806d4068d85da3422097` (**expected 987ad1d7… — matches**) |
| en 33 source values — same construction | `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528` (**expected c326a93f… — matches**) |
| `en/mobile.computers.json` | `713827837aab9d75611441155d50522ccce9d8b410d88c1b7bd27e528776aff3` |
| `en/mobile.session.json` | `8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3` |
| `en/mobile.settings.json` | `d7e1d85b68773871a578791ad57e0a08e421a220738e561b9e09ce22f9aee23d` |
| `en/mobile.session.context.json` (sidecar, edited by the remediation) | `50d48c6a40d93d953bd649a6fed2a55998ad4f4075da940840ef9a2fbba394d5` |
| `en/mobile.settings.context.json` (sidecar) | `67691ab95fba5cbcc86596899504ce2b9ba1acd518b3a9bdc1048dcc22b54c12` |
| `es/mobile.computers.json` | `488e26a9ded297e526f53493b2e747ae52b317ed9464529d0b2b3da4db952070` (unchanged) |
| `es/mobile.session.json` | `e1b5d4aa1303ee68348d0411ed69e999dd990efd88a3fae6cf5d94e9b3778b0c` |
| `es/mobile.settings.json` | `0a7c7af6dfe8594fc91e24f8694e8c6ed2678e738e682a97a69c8762286a8a56` |
| `es/m2-expression-literals/final.json` (audited target) | `7141a06ff9921b541db5a9cd61af53a6da8aacb1347cb843199dcd4a3ff84388` |
| `es/m2-expression-literals/reaudit-shipped-3af477ee.md` (round-3 report) | `6812059386d93f3978b3432680ffa4a2a8040c64b5ea7992d79f60e4f344bdb4` |

## 7. Ledger / retention

`~/local-operator-mobile` has **no** audit ledger file and **no** audit-ledger command:
`i18n/audits/` holds `evidence/` only, `docs/i18n.md` §"Add a locale" step 3 says the audit
report is recorded in the pull request, and the PR body routes records to
`i18n/audits/evidence/<locale>/m2-expression-literals/` with sha256s in
`NOTE-m2-expression-literals.md`. The only `ledger.json` on this machine is the **core
CLI's** (`~/local-operator/i18n/ledger.json`), which has no mobile rows and no command that
writes them. So there is nothing for me to execute; I checked rather than assume.

I am READ-ONLY on this worktree, so I have not created the tracked record. The coder/manager
can land it verbatim from `record.json` in this scratchpad at
`i18n/audits/evidence/es/m2-expression-literals/r2delta/record.json` (with `audit.log` as its
companion), and the ledger row's `note` (≤ 280 chars) is in that file. Row the record would
carry: locale `es`, namespace `m2-expression-literals`, status `passed`, auditor
`i18n-auditor` / `deepseek/deepseek-flash` / session `460114b18e98`, source hash
`c326a93f…d3528`, 33 keys, findings `M2-es-R2D-01` (MINOR) + `n1` (NIT).

## 8. Disclosure

- Model: `deepseek/deepseek-flash`, this run's header, no fallback used.
- I did not render a frame. Reachability is read from source; the cell width comes from my
  own arithmetic on the repo's measured Figtree table, not from a DOM measurement — the only
  DOM figure quoted (318 px at 390 pt) is the designer's, labelled as theirs. The 320/200 %
  numbers are 46 % over budget, far outside font-weight noise, so they are directional even
  without a frame; the 390/200 % row is explicitly marginal and I do not claim it.
- No second independent pass was requested for this delta. I note that `mobile.settings` is
  a high-visibility group, and that its delta here is a one-character case change to text
  already read and audited in full at `3af477ee` — which is why one fresh pass is adequate
  for this round rather than a new independent pair.
- I made no edits, commits or pushes; the worktree is clean at `c4024b49`
  (`git status --porcelain` empty). Scratch work lives only in this session's scratchpad.
