# Urdu (`ur`) audit — `relay.health` — `ur30a6`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT
(a `passed` verdict requires zero BLOCKER and MAJOR; findings are listed below with exact replacements).

- **Locale / namespace**: `ur` / `relay.health` (8 keys)
- **Audit date**: 2026-10-30
- **Auditor**: `i18n-auditor`, session `d24b2e163bcd`, **actual model `radient/auto`** (fallback chain in this session: anthropic/claude-sonnet-5-5 → claude-opus-5-5 → openai/gpt-6-astra → kimi/k3.1-pro → radient/auto, every switch a provider-quota fallback). Independent of the translator; no MT/API/SDK service was used to read, compare or back-translate anything.
- **Programme**: ur wave, group A. `relay.chrome` and `relay.health` are **mirror verification** against core's committed Urdu, not new translation.
- **Catalogue state**: the translator's *uncommitted* catalogue on `feat/i18n-urdu` (base `32c7677`). This auditor changed nothing.
- **Route**: catalogue read as ordinary working-tree files. `read_public_copy` is refused for `src/i18n/**`, and the en `*.context.json` sidecar maps keys to nested `{role,note}` objects rather than strings, so it is not routable either. **No copy-route receipt was obtained or claimed.**

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/relay.health.json` | `8588632afd90999a47232def24678eb2db64da3be442f0829012c35182e6aa0e` |
| en source | `src/i18n/catalogues/en/relay.health.json` | `65e8c90187268d8e675d3548e91e1d0405fde94ea3123c6c06fcf9433bd96d6f` |
| en context | `src/i18n/catalogues/en/relay.health.context.json` | `b23f770b852c8f3ebdeceb3f733b973c8e0a51f654d6ad5cd98ea00cc89bb3ec` |

Redaction-marker scan over **every file this audit read** (102 files, enumerated in `audit.log` under `redaction scan: all inputs`): **0 markers** (expected 0; no masked value was accepted).

## What was executed (not asserted)

All of the following is in [`audit.log`](audit.log), captured from the real runs:

- `node scripts/i18n/generate.ts --check` → **exit 0**, `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`. This generator parses *every* locale directory, `ur` included, with the runtime parser (`scripts/i18n/generate.ts`, the parity/enforcement block), so key parity, unknown-namespace and placeholder-kind rules are machine-checked for `ur` even though `ur` is not yet shipped.
- `node scripts/i18n/check-strings.ts` → **exit 0**, `284 finding(s), all baselined; 0 new; no growth vs 32c7677`.
- `npx tsx …/evidence.mts relay.health ur30a6` — hashes, key diff, `parseMessage` parity per key, `formatMessage`/`renderFor` renders, Unicode scans, plural probe.
- `python3 .../compose.py relay.health` — composed-sentence and cross-namespace reads.

## 1. Mechanical

| check | result | how |
|---|---|---|
| valid JSON, no key added/dropped | PASS | `JSON.parse` both files; `en=8 ur=8`, key-set diff empty (audit.log) |
| placeholder names/types identical | **N/A, verified** | 0 parameterised keys in this namespace: `parseMessage` reports an empty parameter set for every key, en and ur alike |
| ICU plural/select structure + all CLDR categories | **N/A, verified** | no plural/select message exists here; `Intl.PluralRules('ur')` and the app's `pluralCategory('ur', n)` were still probed for the record: `0=other 1=one 2=other 21=other` |
| markup / code spans / commands / flags / identifiers untouched | PASS | every Latin run in the target compared against the en source; no tap-to-copy token is altered |

## Mirror verification (the brief's group-A requirement)

8 keys, compared **byte-for-byte per value** against core's committed
`local_operator/i18n/catalogues/ur/relay.health.json` at `origin/main`:
**8/8 identical**, and the en strings match core's en for the same keys.

- The style guide's recorded width exception is confirmed on this head:
  `relay.health.reconnecting` is **16 cells** against the 16-cell cap, the same
  «پھر منسلک ہو رہا» the guide records — not a new deviation.
- `ended_detail` and `ended_send_failed` are the sentences
  `mobile.session_health.ended_placeholder` composes with: the quoted state word
  «ختم ہو گیا» and the `جاری رکھیں` affordance are the core lines, so the ended
  composer and the ended sheet speak with one voice.
- Long details (168/187/225 cells) are sheet body text, outside any button or
  status budget.
- **Bidi**: 0 control characters; no Latin runs in these strings.

## Findings

None. No BLOCKER, MAJOR, MINOR or NIT findings in this namespace. The mirror verification above is the whole of the check.

## Verdict

**`passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.
Zero BLOCKER/MAJOR remains, so the group passes. 
Mirror verification: 8/8 values byte-identical to core origin/main.

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
