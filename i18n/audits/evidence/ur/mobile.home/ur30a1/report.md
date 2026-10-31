# Urdu (`ur`) audit — `mobile.home` — `ur30a1`

**Verdict: `changes_requested`** — 0 BLOCKER, 1 MAJOR, 2 MINOR, 2 NIT
(a `passed` verdict requires zero BLOCKER and MAJOR; findings are listed below with exact replacements).

- **Locale / namespace**: `ur` / `mobile.home` (27 keys)
- **Audit date**: 2026-10-30
- **Auditor**: `i18n-auditor`, session `d24b2e163bcd`, **actual model `radient/auto`** (fallback chain in this session: anthropic/claude-sonnet-5-5 → claude-opus-5-5 → openai/gpt-6-astra → kimi/k3.1-pro → radient/auto, every switch a provider-quota fallback). Independent of the translator; no MT/API/SDK service was used to read, compare or back-translate anything.
- **Programme**: ur wave, group A. `relay.chrome` and `relay.health` are **mirror verification** against core's committed Urdu, not new translation.
- **Catalogue state**: the translator's *uncommitted* catalogue on `feat/i18n-urdu` (base `32c7677`). This auditor changed nothing.
- **Route**: catalogue read as ordinary working-tree files. `read_public_copy` is refused for `src/i18n/**`, and the en `*.context.json` sidecar maps keys to nested `{role,note}` objects rather than strings, so it is not routable either. **No copy-route receipt was obtained or claimed.**

## Inputs (sha256)

| input | path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/ur/mobile.home.json` | `6181c9bf8198ccc599883578625f7f1293539794021d952f5b761952c5c1e213` |
| en source | `src/i18n/catalogues/en/mobile.home.json` | `4ebba126f106bada157ae56ef2a7fedc2b5ee056d01df7dcd9235c75bd68dce3` |
| en context | `src/i18n/catalogues/en/mobile.home.context.json` | `db18b25dd2099a953b817d151b9605e43f0403b528c36fdadc822cb6c9125f3c` |

Redaction-marker scan over **every file this audit read** (102 files, enumerated in `audit.log` under `redaction scan: all inputs`): **0 markers** (expected 0; no masked value was accepted).

## What was executed (not asserted)

All of the following is in [`audit.log`](audit.log), captured from the real runs:

- `node scripts/i18n/generate.ts --check` → **exit 0**, `catalogue.gen.ts is current (143 keys, 10 namespaces, …)`. This generator parses *every* locale directory, `ur` included, with the runtime parser (`scripts/i18n/generate.ts`, the parity/enforcement block), so key parity, unknown-namespace and placeholder-kind rules are machine-checked for `ur` even though `ur` is not yet shipped.
- `node scripts/i18n/check-strings.ts` → **exit 0**, `284 finding(s), all baselined; 0 new; no growth vs 32c7677`.
- `npx tsx …/evidence.mts mobile.home ur30a1` — hashes, key diff, `parseMessage` parity per key, `formatMessage`/`renderFor` renders, Unicode scans, plural probe.
- `python3 .../compose.py mobile.home` — composed-sentence and cross-namespace reads.

## 1. Mechanical

| check | result | how |
|---|---|---|
| valid JSON, no key added/dropped | PASS | `JSON.parse` both files; `en=27 ur=27`, key-set diff empty (audit.log) |
| placeholder names/types identical | **N/A, verified** | 0 parameterised keys in this namespace: `parseMessage` reports an empty parameter set for every key, en and ur alike |
| ICU plural/select structure + all CLDR categories | **N/A, verified** | no plural/select message exists here; `Intl.PluralRules('ur')` and the app's `pluralCategory('ur', n)` were still probed for the record: `0=other 1=one 2=other 21=other` |
| markup / code spans / commands / flags / identifiers untouched | PASS | every Latin run in the target compared against the en source; no tap-to-copy token is altered |

## 2–6. Accuracy, idiom, terminology, fit, bidi

Read as native product copy, key by key (27 keys), against each key's context
sidecar and its call site.

- **Accuracy**: faithful throughout. `queue.discard` («حذف کریں») stays clearly
  destructive and distinct from `queue.restore` («منتقل کریں»), which the sidecar
  requires. `refused_start_fallback`, `folders_read_failed` and
  `connect_disabled_reason` state the fact without blaming the reader. No
  negation, polarity or number slips; nothing is added that the source does not say.
- **Idiom / register**: آپ register held everywhere; no «تم»/«تو»; imperatives are
  respectful («دیکھیں»، «استعمال کریں»، «دوبارہ کوشش کریں»). Suggestion chips
  legitimately move the verb to the end (Urdu word order) instead of calquing the
  English verb-first shape, and no two chips share a leading verb — the desktop
  pool rule the sidecar states. One grammar defect (M1) and two register/idiom
  softenings (m1, m2).
- **Terminology**: consistent with the core glossary — session `سیشن`, agent
  `ایجنٹ`, subagent `ذیلی ایجنٹ`, draft `مسودہ`, schedule `شیڈول`, prompt `پرامپٹ`,
  turn `ٹرن` (core's own rendering), team `ٹیم`, access `رسائی`. Kept-English tokens intact: `Linear MCP`, `repo`, and none of the tips introduce a
  new name for a concept.
- **Fit** (measured, code-point = cell per the style guide): tips 44 / 41 / 41
  against `TIP_CHAR_BUDGET = 48` (read from `home-copy.ts:175`) — PASS with 4 cells
  of headroom on the longest; chips longest **22**, matching the translator's
  reported figure and the en-derived 24; `ended_placeholder` is in
  `mobile.session_health`. Note: the per-locale chip/tip assertions in
  `home-copy.test.ts` iterate `SHIPPED_LOCALES`, which excludes `ur` today, so the
  numbers above are this audit's own measurement, not a green test.
- **Bidi**: 0 control characters; `Linear MCP` and `repo` sit mid-sentence with no
  reordering, and no arrows or mirrored glyphs appear in copy.

## 7. Composed sentences (the French/Hindi class of defect)

- `options.fixed` quotes the destination screen's title: “گفتگو کی تفصیلات” in
  the string is byte-identical to `mobile.session.conversation_details` — verified
  by extraction, not by eye.
- The options/reason lines are rendered as their own nodes (`home.tsx`), never
  concatenated with a prefix or suffix, so no cross-piece grammar is at risk.
- **The queue row is not alone in its slot.** `startup_queue.*` render as one
  `Text` beside the composer's chip, and that chip is an English literal in code
  (`{queuedCount} queued`, `composer.tsx:834`), as is
  `"Your queued message is retained."` (`home.tsx:603`). On a `ur` screen the row
  is Urdu and the chip beside it English. **Out of scope for this catalogue**
  (the fix is extracting two code literals), recorded for the implementer.

## Findings

| id | severity | key | current | replacement | why |
|---|---|---|---|---|---|
| `ur30a1-M1` | **MAJOR** | `mobile.home.connect_disabled_reason` | بھیجنے کے لیے کمپیوٹر سے منسلک ہوں۔ | بھیجنے کے لیے کمپیوٹر سے منسلک ہو جائیں۔ | ‘ہوں’ is ہونا's 1st-person/3rd-plural subjunctive; with no subject in the sentence the reader supplies ‘I’, so the line reads “so that I be connected”, not “Connect …”. Core does use this shape where the subject is present (‘تجاویز آن ہوں’), which is why it looks plausible — but a directive to آپ needs the polite imperative. ‘ہو جائیں’ keeps the intransitive verb core already uses for connection state (‘دوبارہ منسلک ہو رہا ہے…’) and matches Hindi’s shipped imperative (‘कंप्यूटर से कनेक्ट करें’). Shorter alternative if the composer slot is tight: «بھیجنے کے لیے کمپیوٹر جوڑیں۔» (29 cells, core’s pairing verb). |
| `ur30a1-m1` | **MINOR** | `mobile.home.tip.parallel` | ذیلی ایجنٹس پھیلانے کے لیے متوازی کام مانگیں | ذیلی ایجنٹس کو پھیلانے کے لیے متوازی کام مانگیں | پھیلانا is transitive; without ‘کو’ the fragment reads like spreading objects rather than the agents fanning out. With ‘کو’ it is 47 characters, one under TIP_CHAR_BUDGET=48. |
| `ur30a1-m2` | **MINOR** | `mobile.home.suggestion.wake_summary` | مجھے خلاصے سمیت جگائیں | مجھے خلاصہ دے کر جگائیں | ‘سمیت’ is officialese/Persianised (core uses it only in technical lists); a chat chip reads better with the everyday construction. Trade-off: 23 characters, 1 over the translator’s own 22 longest — needs the same width check the translator already runs; the current string is acceptable if that budget is tight. |
| `ur30a1-n1` | **NIT** | `mobile.home.startup_queue.blocked` | قطار کے پیغامات بھیجنے کے لیے دوبارہ کوشش کریں | (no change proposed) | ‘queued messages’ renders as ‘قطار کے پیغامات’ in the two status rows and ‘قطار میں لگے پیغامات’ in the sheet and its buttons — same noun, two forms, one screen. Both are grammatical and the short form serves the row width; recorded rather than required. |
| `ur30a1-n2` | **NIT** | `mobile.home.startup_queue.unconfirmed` | شروع ہونے کی تصدیق نہیں | شروع ہونے کی تصدیق نہیں ہوئی | Terse nominal sentence without ہوئی; acceptable as a status label, fuller form reads smoother. |

Each replacement was parsed with `parseMessage` and rendered with `formatMessage(…, 'ur')` in this audit's own log — the round-trip and the before/after lines are in `audit.log`, not retyped here.

## Verdict

**`changes_requested`** — 0 BLOCKER, 1 MAJOR, 2 MINOR, 2 NIT.
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
