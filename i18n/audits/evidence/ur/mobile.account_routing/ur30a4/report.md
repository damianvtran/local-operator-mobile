# Urdu (`ur`) audit — `mobile.account_routing` — `ur30a4`

**Verdict: `changes_requested`** — 0 BLOCKER, 1 MAJOR, 0 MINOR, 0 NIT
(a `passed` verdict requires zero BLOCKER and MAJOR; findings are listed below with exact replacements).

- **Locale / namespace**: `ur` / `mobile.account_routing` (14 keys)
- **Audit date**: 2026-10-30
- **Auditor**: `i18n-auditor`, session `d24b2e163bcd`, **actual model `radient/auto`** (fallback chain in this session: anthropic/claude-sonnet-5-5 → claude-opus-5-5 → openai/gpt-6-astra → kimi/k3.1-pro → radient/auto, every switch a provider-quota fallback). Independent of the translator; no MT/API/SDK service was used to read, compare or back-translate anything.
- **Programme**: ur wave, group A. `relay.chrome` and `relay.health` are **mirror verification** against core's committed Urdu, not new translation.
- **Catalogue state**: the translator's *uncommitted* catalogue on `feat/i18n-urdu` (base `32c7677`). This auditor changed nothing.
- **Route**: catalogue read as ordinary working-tree files. `read_public_copy` is refused for `src/i18n/**`, and the en `*.context.json` sidecar maps keys to nested `{role,note}` objects rather than strings, so it is not routable either. **No copy-route receipt was obtained or claimed.**

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/mobile.account_routing.json` | `d1308a7739a7ff12c0196989b26d223748007a049dcd189180ec679ba769054b` |
| en source | `src/i18n/catalogues/en/mobile.account_routing.json` | `34fa87b25d0f65b83f675f51a99e592235902a25878938850287cbe397ed8a03` |
| en context | `src/i18n/catalogues/en/mobile.account_routing.context.json` | `2103f8d2a4f3b649bbde90c78d8bf74628211bc99836920fb3ffa3eea985c58c` |

Redaction-marker scan over **every file this audit read** (102 files, enumerated in `audit.log` under `redaction scan: all inputs`): **0 markers** (expected 0; no masked value was accepted).

## What was executed (not asserted)

All of the following is in [`audit.log`](audit.log), captured from the real runs:

- `node scripts/i18n/generate.ts --check` → **exit 0**, `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`. This generator parses *every* locale directory, `ur` included, with the runtime parser (`scripts/i18n/generate.ts`, the parity/enforcement block), so key parity, unknown-namespace and placeholder-kind rules are machine-checked for `ur` even though `ur` is not yet shipped.
- `node scripts/i18n/check-strings.ts` → **exit 0**, `284 finding(s), all baselined; 0 new; no growth vs 32c7677`.
- `npx tsx …/evidence.mts mobile.account_routing ur30a4` — hashes, key diff, `parseMessage` parity per key, `formatMessage`/`renderFor` renders, Unicode scans, plural probe.
- `python3 .../compose.py mobile.account_routing` — composed-sentence and cross-namespace reads.

## 1. Mechanical

| check | result | how |
|---|---|---|
| valid JSON, no key added/dropped | PASS | `JSON.parse` both files; `en=14 ur=14`, key-set diff empty (audit.log) |
| placeholder names/types identical | **N/A, verified** | 0 parameterised keys in this namespace: `parseMessage` reports an empty parameter set for every key, en and ur alike |
| ICU plural/select structure + all CLDR categories | **N/A, verified** | no plural/select message exists here; `Intl.PluralRules('ur')` and the app's `pluralCategory('ur', n)` were still probed for the record: `0=other 1=one 2=other 21=other` |
| markup / code spans / commands / flags / identifiers untouched | PASS | every Latin run in the target compared against the en source; no tap-to-copy token is altered |

## 2–6. Accuracy, idiom, terminology, fit, bidi

14 keys. This namespace is a mirror of core's committed `relay.account_policy`
wherever the same sentence exists, and the diff proves it: **9 of the 11 shared keys are byte-identical** to core's
Urdu. The 2 that differ differ because the mobile English differs: `title`
(mobile “Account routing”, core “Computer settings”) and `error` (core says
“reload the page”, mobile says “reload”). The other 3 keys are mobile-only
(`disconnected`, `reload`, `unsaved`). A rendering that disagreed with core where
the English agrees would have been a MAJOR; there is none.

- **Accuracy**: the uncertainty discipline the sidecars demand holds — `error`
  (unknown outcome) never asserts success or failure, `rejected` (definitive
  refusal) is distinct, `saved` only after a confirmed response, `saving` never a
  confirmation. One grammar defect (M1) in the mobile-only `disconnected` line.
- **Idiom / register**: آپ; «تبدیلیاں صرف اسی کمپیوٹر پر لاگو ہوں گی» reads natively
  as a scope note, not a translation.
- **Terminology**: settings `ترتیبات`, save `محفوظ کریں`, policy `پالیسی`, relay
  `ریلے`, `Local Operator` kept Latin — all per the core glossary and the style
  guide's loans.
- **Fit**: longest 91 cells (`error`), en 94 — no overflow risk relative to source;
  buttons 16–22.
- **Bidi**: 0 control characters. `Local Operator` is the only Latin token and it
  sits mid-sentence; the renderer's FSI/PDI isolation applies, none is embedded.

## Findings

| id | severity | key | current | replacement | why |
|---|---|---|---|---|---|
| `ur30a4-M1` | **MAJOR** | `mobile.account_routing.disconnected` | اکاؤنٹ روٹنگ تبدیل کرنے کے لیے کسی کمپیوٹر سے منسلک ہوں۔ | اکاؤنٹ روٹنگ تبدیل کرنے کے لیے کسی کمپیوٹر سے منسلک ہو جائیں۔ | ‘ہوں’ is ہونا's 1st-person/3rd-plural subjunctive; with no subject in the sentence the reader supplies ‘I’, so the line reads “so that I be connected”, not “Connect …”. Core does use this shape where the subject is present (‘تجاویز آن ہوں’), which is why it looks plausible — but a directive to آپ needs the polite imperative. ‘ہو جائیں’ keeps the intransitive verb core already uses for connection state (‘دوبارہ منسلک ہو رہا ہے…’) and matches Hindi’s shipped imperative (‘कंप्यूटर से कनेक्ट करें’). This namespace otherwise mirrors core’s committed relay.account_policy Urdu (9 of 11 shared keys byte-identical); the 3 mobile-only keys are not affected. |

Each replacement was parsed with `parseMessage` and rendered with `formatMessage(…, 'ur')` in this audit's own log — the round-trip and the before/after lines are in `audit.log`, not retyped here.

## Verdict

**`changes_requested`** — 0 BLOCKER, 1 MAJOR, 0 MINOR, 0 NIT.
Fixing the MAJOR item(s) above is enough to pass this namespace; minors and nits do not gate. 

### Second pass

This is a **high-visibility** namespace (onboarding / errors / settings), so the long-screen read was repeated in this session with different lenses than the key-by-key pass: the whole screen in display order, adjacent-line register, and translation-only phrasing. It found **no additional findings**; it re-confirmed the MAJOR item(s) above.

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
