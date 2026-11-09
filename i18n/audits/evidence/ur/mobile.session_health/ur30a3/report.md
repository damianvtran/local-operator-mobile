# Urdu (`ur`) audit — `mobile.session_health` — `ur30a3`

**Verdict: `changes_requested`** — 0 BLOCKER, 2 MAJOR, 0 MINOR, 1 NIT
(a `passed` verdict requires zero BLOCKER and MAJOR; findings are listed below with exact replacements).

- **Locale / namespace**: `ur` / `mobile.session_health` (11 keys)
- **Audit date**: 2026-10-30
- **Auditor**: `i18n-auditor`, session `d24b2e163bcd`, **actual model `radient/auto`** (fallback chain in this session: anthropic/claude-sonnet-5-5 → claude-opus-5-5 → openai/gpt-6-astra → kimi/k3.1-pro → radient/auto, every switch a provider-quota fallback). Independent of the translator; no MT/API/SDK service was used to read, compare or back-translate anything.
- **Programme**: ur wave, group A. `relay.chrome` and `relay.health` are **mirror verification** against core's committed Urdu, not new translation.
- **Catalogue state**: the translator's *uncommitted* catalogue on `feat/i18n-urdu` (base `32c7677`). This auditor changed nothing.
- **Route**: catalogue read as ordinary working-tree files. `read_public_copy` is refused for `src/i18n/**`, and the en `*.context.json` sidecar maps keys to nested `{role,note}` objects rather than strings, so it is not routable either. **No copy-route receipt was obtained or claimed.**

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/mobile.session_health.json` | `4651263d664ab5ebb0dee5612f5ee6b8dfa31bc60b113968d5f9894ed09f0b86` |
| en source | `src/i18n/catalogues/en/mobile.session_health.json` | `727b7e4977b3954637af9b5f8310c3bb892ebf9d9ecebc483db4c1aa7be4fe0f` |
| en context | `src/i18n/catalogues/en/mobile.session_health.context.json` | `df99892225c85921be703c29c2689c5fe1c74f1d5cc02e1c1bfe9e1c838af310` |

Redaction-marker scan over **every file this audit read** (102 files, enumerated in `audit.log` under `redaction scan: all inputs`): **0 markers** (expected 0; no masked value was accepted).

## What was executed (not asserted)

All of the following is in [`audit.log`](audit.log), captured from the real runs:

- `node scripts/i18n/generate.ts --check` → **exit 0**, `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`. This generator parses *every* locale directory, `ur` included, with the runtime parser (`scripts/i18n/generate.ts`, the parity/enforcement block), so key parity, unknown-namespace and placeholder-kind rules are machine-checked for `ur` even though `ur` is not yet shipped.
- `node scripts/i18n/check-strings.ts` → **exit 0**, `284 finding(s), all baselined; 0 new; no growth vs 32c7677`.
- `npx tsx …/evidence.mts mobile.session_health ur30a3` — hashes, key diff, `parseMessage` parity per key, `formatMessage`/`renderFor` renders, Unicode scans, plural probe.
- `python3 .../compose.py mobile.session_health` — composed-sentence and cross-namespace reads.

## 1. Mechanical

| check | result | how |
|---|---|---|
| valid JSON, no key added/dropped | PASS | `JSON.parse` both files; `en=11 ur=11`, key-set diff empty (audit.log) |
| placeholder names/types identical | **N/A, verified** | 0 parameterised keys in this namespace: `parseMessage` reports an empty parameter set for every key, en and ur alike |
| ICU plural/select structure + all CLDR categories | **N/A, verified** | no plural/select message exists here; `Intl.PluralRules('ur')` and the app's `pluralCategory('ur', n)` were still probed for the record: `0=other 1=one 2=other 21=other` |
| markup / code spans / commands / flags / identifiers untouched | PASS | every Latin run in the target compared against the en source; no tap-to-copy token is altered |

## 2–6. Accuracy, idiom, terminology, fit, bidi

11 keys, read against their sidecars and the surfaces they sit on (the health
sheet, the ended composer, the overflow menu).

- **Accuracy**: the state distinctions the sidecars insist on are preserved —
  `resume_gone` (404, never invite a retry) is distinct from `resume_refused`
  (retryable) and from `resume_no_route` (missing prerequisite); `reopening` and
  `still_reopening` name the wait rather than a bare ellipsis. One ambiguity defect
  (M2) and one grammar defect (M1).
- **Idiom / register**: آپ throughout; «ابھی … نہیں ہوا» for “has not come up yet”;
  the em dash with surrounding spaces follows Urdu product typography.
- **Terminology**: session `سیشن` (masculine agreement held: «کھولا نہیں جا سکا»,
  «کھلے گا»), resume `جاری رکھیں` (core's own button), home folder `ہوم فولڈر`
  (core's `relay.health.ended_detail`), saved `محفوظ` — the last one is where M2
  bites.
- **Fit**: `ended_placeholder` 32 cells against the 36-cell translator budget
  recorded in the sidecar — PASS; `resume_no_route` 50 (en 45) and `resume_refused`
  56 (en 55) are status lines, no budget.
- **Bidi**: 0 control characters; no Latin runs in these strings.
- **Composed**: the failure sentence sits under the `جاری رکھیں` button and agrees
  with it; `relay.health.ended_send_failed` quotes the header state word
  «ختم ہو گیا» — verified by containment, not by eye; the ended placeholder and the
  health sheet's ended_detail name the same destination in the same words.
  The long lines are two sentences each, so no cross-string agreement is at risk.

## Findings

| id | severity | key | current | replacement | why |
|---|---|---|---|---|---|
| `ur30a3-M1` | **MAJOR** | `mobile.session_health.resume_no_route` | اس سیشن کو جاری رکھنے کے لیے کمپیوٹر سے منسلک ہوں۔ | اس سیشن کو جاری رکھنے کے لیے کمپیوٹر سے منسلک ہو جائیں۔ | ‘ہوں’ is ہونا's 1st-person/3rd-plural subjunctive; with no subject in the sentence the reader supplies ‘I’, so the line reads “so that I be connected”, not “Connect …”. Core does use this shape where the subject is present (‘تجاویز آن ہوں’), which is why it looks plausible — but a directive to آپ needs the polite imperative. ‘ہو جائیں’ keeps the intransitive verb core already uses for connection state (‘دوبارہ منسلک ہو رہا ہے…’) and matches Hindi’s shipped imperative (‘कंप्यूटर से कनेक्ट करें’). |
| `ur30a3-M2` | **MAJOR** | `mobile.session_health.resume_gone` | یہ سیشن اب محفوظ نہیں۔ | یہ سیشن اب محفوظ شدہ نہیں ہے۔ | Copula-less ‘محفوظ نہیں’ is read as the adjective “not safe/secure” before it is read as “not saved”, in a 404 failure notice that must not alarm. ‘محفوظ شدہ’ is the saved-state participle core itself uses (‘یہ محفوظ شدہ کاپی …’); Hindi shipped the same disambiguated shape ‘अब सहेजा हुआ नहीं है’. |
| `ur30a3-n1` | **NIT** | `mobile.session_health.still_reopening` | اب بھی کھل رہا ہے — ابھی تیار نہیں ہوا۔ | اب بھی کھل رہا ہے — ابھی تک تیار نہیں ہوا۔ | Two bare ‘ابھی’ forms in one line; ‘ابھی تک’ (“yet”) matches the English and reads smoother. |

Each replacement was parsed with `parseMessage` and rendered with `formatMessage(…, 'ur')` in this audit's own log — the round-trip and the before/after lines are in `audit.log`, not retyped here.

## Verdict

**`changes_requested`** — 0 BLOCKER, 2 MAJOR, 0 MINOR, 1 NIT.
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
