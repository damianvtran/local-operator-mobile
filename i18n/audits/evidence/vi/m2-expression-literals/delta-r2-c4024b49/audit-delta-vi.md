# vi — M2 expression literals: independent DELTA audit of the round-1 remediation

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 1 NIT (below; the NIT does not gate).
Round-1 findings re-checked: **F1 resolved**, **F2 resolved**; the `stream_degraded` case change is correct.

| | |
|---|---|
| Locale | `vi` — bạn register, sentence case, NFC, Latin digits |
| Namespace (file group) | `m2-expression-literals` = `mobile.computers` (4) + `mobile.session` (15) + `mobile.settings` (14) = **33 keys** |
| PR / round | #236 (M2) · **Round 2**, remediation delta `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a..c4024b49` |
| Worktree | `~/local-operator-mobile/.worktrees/i18n-m2-scanner` — verified `git rev-parse HEAD` = `c4024b497a4db3118aae70d8bb132301ea3ab097` (starts `c4024b49`), clean |
| Auditor | `i18n-auditor` — fresh instance; not the translator; not the earlier vi auditor (`session 6934f10bf7bd`) |
| Session | `88793886ac28` (team `lopdev`) |
| ACTUAL served model | `deepseek/deepseek-flash` — this run's session model header (`actual_model_source` = header; no switch, no fallback, nothing pinned) |
| Independent of translator | true (translator `i18n-translator` per the bundle manifest) |
| Method | my own reasoning + the repo's **shipping** parser (`src/i18n/messages.ts`) + repo validator + CoreText measurement. **No** translation/MT service, no back-translation. READ-ONLY: no repo, ledger or PR write. |

Why a *delta* audit and not a full re-read: round-1-clean surfaces are retained by the manager's round economy.
I re-verified mechanically over all 33 (cheap, biting) and reviewed the 3 changed values plus their render paths.

## 1. What actually moved (byte-verified)

`git diff 3af477ee..c4024b49 -- src/i18n/catalogues/vi` = **3 values, nothing else** (`numstat` 2+2 and 1+1 lines;
en *values* untouched — only the en sidecar note changed):

| Key | at `3af477ee` | at `c4024b49` |
|---|---|---|
| `mobile.session.tray.context_short` | `{percent}% ctx` | `{percent}% ngữ cảnh` |
| `mobile.session.tray.context_short_estimate` | `{percent}% ctx (ước tính)` | `{percent}% ngữ cảnh (ước tính)` |
| `mobile.settings.diagnostics.stream_degraded` | `Không phản hồi` | `không phản hồi` |

Key counts unchanged per namespace (45/78/59), relative order identical to `en`, no key added or dropped.

Target hash over the 33 pairs (sorted-key JSON, compact, UTF-8) moved exactly as expected:
`3b48c60e…d009` → **`582f144d164294a9723535a3c2808f828b165c33c9e23f4e2e97fa160c5c9e5f`** (the expected `582f144d…`).
I also recomputed the *prior* hash from `3af477ee` and got `3b48c60e…d009`, i.e. the same serialisation the
earlier re-audit used — so the two full-file hashes below and the two cell figures are reproducible, not asserted.

## 2. F1 (MAJOR, round 3) — the narrow estimate slot: **RESOLVED**, and the premise is gone

The earlier finding priced `{percent}% ctx (ước tính)` at 18–19 mono cells against the *activity band's* fixed
budget under 340 pt (the D17 record). **That band cannot render this key at all.** Traced through the component
tree (not assumed):

- `contextFact(…, {percent}, narrow = viewportWidth < 340, estimate)` (`app/(app)/session/[id].tsx:134-150`) has
  exactly three render sites (`grep context_tokens`: `[id].tsx:919-930`, `:991-1010`, `:1694`):
  1. `trayFacts.context` → `StatusTray`, painted **only** when `compact && statusTrayVisible(...)`
     (`[id].tsx:1286-1292`);
  2. the status strip, painted **only** when `!tray` (`[id].tsx:1288-1295`);
  3. the **status sheet's** value row, `<Text className="px-4 text-mono-sm text-ink-dim">` with no
     `numberOfLines` (`[id].tsx:1694-1698`) — a free-wrapping, full-width sheet row.
- `sessionStatusLayout` (`src/ui/size-class.ts:669-687`): `tray = phone || compact`, `phone = width < 700`
  (`LAYOUT.tabletBreakpoint = 700`). So the strip (site 2) needs `width ≥ 700` **and** not-compact ⇒ `narrow`
  is false there by construction: **site 2 can never show the short form.** The old band budget is not a budget
  this key ever meets.
- `compact` = short *landscape* window (`size-class.ts:225-234`: landscape screen **and** window, height < 700).
  So site 1 can combine with `width < 340` only in a degenerate landscape *web* window (e.g. 330×300), where the
  row is `numberOfLines={1} ellipsizeMode="tail"` — a truncation class `en` shares on the same row
  (worst-case summary measured 349.6 pt vs a 293 pt budget at a 340 pt window, en full form 117.5 pt inside it).

Where the value really renders — the status sheet, measured with CoreText (mono-sm = 12 pt, the shipped face's
0.600 em advance, i.e. the repo's own pinned `TABLE_MONO_ADVANCE_PT = 7.2`; 166.1/23 = 7.22 confirms it), against
the row's real content width (window − 32 `contentContainerClassName="px-4"` − 32 row `px-4`):

| string | 100 % | lines @390 (326 pt) | lines @320 (256 pt) |
|---|---|---|---|
| `21% ngữ cảnh (ước tính)` | 166.1 pt | 1 | 1 |
| `100% ngữ cảnh (ước tính)` | 173.4 pt | 1 | 1 |
| `21% ngữ cảnh (ước tính) · $0.42` (+ cost suffix) | 223.9 pt | 1 | 1 |
| en `21% context (est.)` for scale | 130.0 pt | 1 | 1 |
| es `21% de contexto (aprox.)` (sibling fix) | 173.4 pt | 1 | 1 |

No wrap, no overflow, ~50 % of the row left over even with the cost appended. `21% ngữ cảnh` alone is 86.7 pt.
F1's failure mode (a reflowed fixed band with the cost floating between two lines) is not reachable: the band
never carries this key at `width < 340`, and the sheet grows instead of clipping.

## 3. F2 (MINOR, round 3) — English `ctx`: **RESOLVED**

`ctx` survives only in the **English** source (`en/mobile.session.json:66,68`) and in the en sidecar note; the vi
catalogue carries zero occurrences (`grep ctx src/i18n/catalogues/vi/` → none). The 33-value ASCII-token
inventory is now: `Local Operator` and `Radient` (product names, glossary §1), `Video` (settled vi loanword,
already shipped in `highlights.video_open`), and the placeholders — nothing unauthorised. The value is a byte
copy of a form audited in an earlier round (`{percent}% ngữ cảnh`, `{percent}% ngữ cảnh (ước tính)`), so no new
wording entered the catalogue. Consistency: `ngữ cảnh` is the catalogue's word for context (4× in
`mobile.session`, 1× in `mobile.chrome`), and the sidecar now states the rule instead of inviting an English
abbreviation. The bundle manifest and `catalogues.test.ts` dropped the `ctx` IDENTICAL_BY_DESIGN entries.

## 4. `stream_degraded` lower-cased — **correct for the mono row**

- Sidecar (authoritative): *"Value of the Diagnostics \"Stream\" row when the stream is open but not answering.
  **Lower-case diagnostic word**, shown in a monospace line; one word, no final full stop."*
- Single call site: `streamWord()` → `DiagnosticRow`'s **value cell** (`src/features/settings/settings.tsx:765-800`),
  `text-mono-sm text-ink-dim`, right-aligned, `numberOfLines={2}`. Its four siblings ship lower-case
  (`rảnh`, `đang kết nối`, `hoạt động`, `ngoại tuyến`); the capital was the odd one out for the en-shaped
  "one word" hint (vi needs two words to say "not answering", as es/fr/ru do — an en-only shape, not a vi defect).
  The value is never sentence-initial, so no capitalisation is owed anywhere.
- Idiom: `không phản hồi` = "not responding", the same phrase the relay ships (`Không phản hồi` in the
  sentence-shaped `mobile.settings.status.not_answering`, which keeps its capital and is untouched) — accurate,
  not a compliance slip.
- Geometry: case-only change, zero width delta (101.1 pt at 100 %, 202.2 pt at 200 %; en's own value is
  93.9 / 187.8 pt in the same cell). Now agrees with es/fr/ru, so the locale set no longer disagrees about the
  same diagnostic.

## 5. Mechanical pass — PASS (my checker over all 33, then negative-controlled)

| Check | Result |
|---|---|
| Repo validator `node scripts/i18n/generate.ts --check` | exit 0 — `catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)` |
| `node scripts/i18n/check-strings.ts` | `212 finding(s), all baselined; 0 new; verified historical debt vs fa2bc5e0b5f7` |
| JSON validity, en/vi key sets equal per namespace, order == en | PASS (45/78/59) |
| Placeholders name+kind identical on all 9 parameterised keys (`{host}`, `{name}`×2, `{percent}`×4, `{labels}`, `{baseUrl}`) | PASS |
| ICU plural/select | none in the slice (0 keys) — nothing invented, no CLDR arms to check |
| Markup/backticks/commands/flags/identifiers | none in source or target |
| Separators/glyphs `·`, `↑`, `↓`, `%`, `( )` | byte-preserved on all 6 keys that carry them |
| NFC, no bidi controls, no edge whitespace, no empty values, no `...` | PASS |
| Final-stop parity (`status`/`meta` keys: none) | PASS |
| Delta tests (`expression-literals`, `composed-dir-sites`) | 2 files / 6 tests passed |

**Negative control (the pass bites).** 6 in-memory mutations → 6 CAUGHT: placeholder renamed (`{pct}`),
placeholder dropped, malformed ICU (`{percent%`), NFD-decomposed Vietnamese, trailing space, dropped `↑`.
The checker imports the shipping `parseMessage`, so the ICU half is the real parser, not a reimplementation.

## 6. Provenance (sha256)

| Part | sha256 |
|---|---|
| vi target, 33 pairs, sorted-key JSON compact | `582f144d164294a9723535a3c2808f828b165c33c9e23f4e2e97fa160c5c9e5f` |
| en source, same 33 | `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528` |
| vi target at `3af477ee` (recomputed) | `3b48c60e64c1d896884a40dddd9d748e3bb3061d7bc15c4b45d4f9eaf570d009` |
| `vi/mobile.computers.json` | `daab971c3ae7b8a2e509d9e3383d3c0786cc54bd5f383255bb1f8c460e050aab` |
| `vi/mobile.session.json` | `5b8dc4ccacda23e042da90bfcf7aef95618fbe0252609d637d02b2c79359deb7` |
| `vi/mobile.settings.json` | `af8d83d1167cf9355ad9d3458d3eeb069eba0b10e0fe4684907dee91796cde64` |
| `en/mobile.session.json` / `.context.json` | `8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3` / `50d48c6a40d93d953bd649a6fed2a55998ad4f4075da940840ef9a2fbba394d5` |
| `en/mobile.computers*.json` | `71382783…aff3` / `cc297300…37e0` |
| `en/mobile.settings*.json` | `d7e1d85b…e23d` / `67691ab9…4c12` |
| the repo's pinned mono advance (basis of the cell figures) | `src/features/session/markdown.ts` → `TABLE_MONO_ADVANCE_PT = 7.2` |

## 7. The one NIT (does not gate)

**vi-D2-01 · NIT · status-sheet context row at 200 % text.** `21% ngữ cảnh (ước tính)` is 332.3 pt at 200 %
against the 326 pt row (390 pt phone) → two lines; en's `21% context (est.)` is 260.1 pt and stays on one. Harm:
none observable — that row has no `numberOfLines`, the sheet body scrolls, and es's shipped sibling
(`21% de contexto (aprox.)`, 346.8 pt) behaves identically, so this is a property of the sanctioned
"reuse the full form" decision, not of the vi wording. **Recommendation: accept as is.** If 200 % parity were
ever wanted it would need a shorter marker in *every* locale (`(ước)` = 202 pt), which is the deviation the
remediation deliberately removed.

## 8. Observed, outside this delta and NOT gating (for the manager's M3 decision)

Not introduced, touched or worsened by this PR; listed because they bear on the operator's acceptance test
("no English anywhere") and the scanner does not see them:

1. `src/features/session/components/status-tray.tsx:51,53` — `${open}/${total} tasks`, `${running}/${total} agents`
   are hard-coded English, so the tray paints English nouns in every locale. **Not in
   `scripts/i18n/strings-baseline.json`** (no `status-tray` entry) — a template-literal miss, not baselined debt.
2. `app/(app)/session/[id].tsx:1035` — the Chip label `` `${running} of ${total} running` ``, same class
   (raised by the earlier vi re-audit, still present and still outside the slice).

Both are pre-existing and belong to a keyed follow-up, not to round 2.

## 9. Ledger / evidence

`~/local-operator-mobile` has **no** `i18n/ledger.json` and **no** audit-ledger command (verified: `i18n/` holds
`audits/` only; `package.json` scripts carry no ledger writer; `docs/i18n.md` records reports in the PR). I wrote
nothing into the worktree — read-only lane. This report lives in my session scratch
(`…/sessions/88793886ac28/scratchpad/audit-delta-vi.md`); the canonical location for the manager to land it is
`i18n/audits/evidence/vi/m2-expression-literals/delta-r2-c4024b49/` (`report.md` + `record.json`).

Ledger row the manager/ledger owner can record (note = 246 chars):

```
locale vi · namespace m2-expression-literals (mobile.{computers,session,settings}) · status passed ·
audit_date 2026-11-11 · key_count 33 · auditor i18n-auditor / deepseek/deepseek-flash / session 88793886ac28 ·
independent_from_translator_session true · source sha256 c326a93f…d3528 · target sha256 582f144d…c9e5f ·
note "Delta r2 c4024b49, 3 values: F1/F2 resolved (short==full measures 166pt in the 326/256pt status-sheet row;
ctx gone), stream_degraded lower-case correct; 0B/0M/0m/1n."
```

Model disclosure: the served model is `deepseek/deepseek-flash` as this session's own header states; nothing was
switched or pinned mid-audit, and no role/default override was applied.
