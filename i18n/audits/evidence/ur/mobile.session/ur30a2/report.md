# Urdu (`ur`) audit — `mobile.session` — `ur30a2`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT
(a `passed` verdict requires zero BLOCKER and MAJOR; findings are listed below with exact replacements).

- **Locale / namespace**: `ur` / `mobile.session` (2 keys)
- **Audit date**: 2026-10-30
- **Auditor**: `i18n-auditor`, session `d24b2e163bcd`, **actual model `radient/auto`** (fallback chain in this session: anthropic/claude-sonnet-5-5 → claude-opus-5-5 → openai/gpt-6-astra → kimi/k3.1-pro → radient/auto, every switch a provider-quota fallback). Independent of the translator; no MT/API/SDK service was used to read, compare or back-translate anything.
- **Programme**: ur wave, group A. `relay.chrome` and `relay.health` are **mirror verification** against core's committed Urdu, not new translation.
- **Catalogue state**: the translator's *uncommitted* catalogue on `feat/i18n-urdu` (base `32c7677`). This auditor changed nothing.
- **Route**: catalogue read as ordinary working-tree files. `read_public_copy` is refused for `src/i18n/**`, and the en `*.context.json` sidecar maps keys to nested `{role,note}` objects rather than strings, so it is not routable either. **No copy-route receipt was obtained or claimed.**

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/mobile.session.json` | `e0183e404ca6555a0cfe29d6083544eb2ac7379dfd684e2627a3a14e6ec485a7` |
| en source | `src/i18n/catalogues/en/mobile.session.json` | `8539005ad9785ec14504c9f8fba86fcd7587b11185f8f2062da0eff1b1aadda8` |
| en context | `src/i18n/catalogues/en/mobile.session.context.json` | `6e8d32e62d787a2c9b3c24cbba85e1bbcfba820b39840d84147afbe1038495b1` |

Redaction-marker scan over **every file this audit read** (102 files, enumerated in `audit.log` under `redaction scan: all inputs`): **0 markers** (expected 0; no masked value was accepted).

## What was executed (not asserted)

All of the following is in [`audit.log`](audit.log), captured from the real runs:

- `node scripts/i18n/generate.ts --check` → **exit 0**, `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`. This generator parses *every* locale directory, `ur` included, with the runtime parser (`scripts/i18n/generate.ts`, the parity/enforcement block), so key parity, unknown-namespace and placeholder-kind rules are machine-checked for `ur` even though `ur` is not yet shipped.
- `node scripts/i18n/check-strings.ts` → **exit 0**, `284 finding(s), all baselined; 0 new; no growth vs 32c7677`.
- `npx tsx …/evidence.mts mobile.session ur30a2` — hashes, key diff, `parseMessage` parity per key, `formatMessage`/`renderFor` renders, Unicode scans, plural probe.
- `python3 .../compose.py mobile.session` — composed-sentence and cross-namespace reads.

## 1. Mechanical

| check | result | how |
|---|---|---|
| valid JSON, no key added/dropped | PASS | `JSON.parse` both files; `en=2 ur=2`, key-set diff empty (audit.log) |
| placeholder names/types identical | **N/A, verified** | 0 parameterised keys in this namespace: `parseMessage` reports an empty parameter set for every key, en and ur alike |
| ICU plural/select structure + all CLDR categories | **N/A, verified** | no plural/select message exists here; `Intl.PluralRules('ur')` and the app's `pluralCategory('ur', n)` were still probed for the record: `0=other 1=one 2=other 21=other` |
| markup / code spans / commands / flags / identifiers untouched | PASS | every Latin run in the target compared against the en source; no tap-to-copy token is altered |

## 2–6. Accuracy, idiom, terminology, fit, bidi

Only two keys, both read against their sidecars and the call site
(`status-tray.tsx`).

- **Accuracy**: `conversation_details` is the destination screen's own title used
  as a label — the sidecar's exact requirement — and it is byte-identical to the
  title `mobile.home.options.fixed` quotes, so a reader recognises one destination
  under one name.
- **Idiom / register**: both read as native Urdu, not calque.
  «جاری سرگرمی کی لائن» names the working line the way the row shows it, and the
  hint keeps the noun order a reader hears; «کام» for tasks matches core's tray
  strings (`کام {done, number}/{total, number}`), which is what a reader sees on
  the same row.
- **Terminology**: session `سیشن`; tasks `کام`; subagents `ذیلی ایجنٹ` — all
  core-consistent.
- **Fit**: 16 and 50 cells. Both are accessibility names/hints (no width budget in
  the sidecars) and the en lengths are 20 and 43; no clipping risk is claimed and
  none was measured, because no device or screenshot surface is attached to this
  session — that is stated rather than implied.
- **Bidi**: 0 control characters, no embedded Latin runs to isolate.
- **Composed**: `status-tray.tsx` builds the accessible *label* as
  `${summary} — show status` with `show status` hard-coded in English, and the
  hint below is this catalogue string. Out of scope for the catalogue, recorded for
  the implementer.

## Findings

None. No BLOCKER, MAJOR, MINOR or NIT findings in this namespace.

## Verdict

**`passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.
Zero BLOCKER/MAJOR remains, so the group passes. 

### Second pass

Not a high-visibility namespace; the single pass is the requirement here.

A second pass by a **different** auditor session is still outstanding for this group and is **not claimed**: one session cannot manufacture independence. That request goes to the manager.

### Provenance

- Auditor `i18n-auditor`, session `d24b2e163bcd`, **actual model `radient/auto`** —
  the session began on anthropic/claude-sonnet-5-5 and was switched by provider
  quota through claude-opus-5-5, openai/gpt-6-astra and kimi/k3.1-pro before
  settling; all fallbacks are disclosed rather than hidden behind the pinned model.
- Independent of the translator's session; no translation/MT service touched.
- No receipt is claimed for any input: the catalogue was read as worktree files and
  the context sidecars are not routable.

### Not claimed

- **No screen was captured.** No device, simulator or browser surface is attached
  to this session, so nothing here is a rendered RTL screenshot claim; fit is
  measured in cells from the code's own budgets (`TIP_CHAR_BUDGET`, the 24-chip
  ceiling, the 36-cell placeholder budget) and from the strings themselves.
- `ur` is still in `NOT_YET_SHIPPED_LOCALES`, so `renderFor(…, 'ur')` returns
  English today. The ur text was exercised through the same formatter
  (`formatMessage(parseMessage(ur[key]), args, 'ur')`); the audit does not claim it
  ran the shipped-locale lookup.
- No ledger row was applied: this repo has no `i18n/ledger.json` and no
  audit-ledger command, and this auditor is read-only on the catalogue. A draft row
  is in `record.json` (`ledger_row_draft`, `applied: false`) for the implementer.
