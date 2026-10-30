# Hindi audit — `mobile.home` (hi30a1)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.home` · **Keys:** 27
- **Wave:** 6 — damianvtran/local-operator-mobile, branch `feat/i18n-hindi`
- **Audited revision:** `647581a4abd5eafce09914b5b1936982749c16c4` (the `hi` catalogue is untracked at this revision and
  `catalogue.gen.ts` is modified; the audited bytes are pinned by `input_hashes.hi`)
- **Auditor:** `i18n-auditor` (lopdev team), session `0c3fa150075f`.
  **Actual model `radient/auto`**, after a provider-quota descent observed in this
  transcript: `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` →
  `kimi/k3.1-pro` → `radient/auto`.
- **Independence:** different agent, session and context from the translator; not
  model-diverse (`radient/auto` is the translator's served model too) — disclosed,
  not closed. **No human native-speaker review and no rendered frame are claimed.**
- **Verdict:** `changes_requested` — 1 MAJOR (calque in the parallel-work tip), 1 MINOR, 1 NIT; everything else reads as native Hindi and the mechanical suite is clean
- **Style guide:** `/Users/damian/local-operator/i18n/style-guides/hi.md`;
  **glossary:** `/Users/damian/local-operator/i18n/glossary.md`;
  **core reference:** `origin/main` @ `8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.

## What was checked

27 keys, all 27 read against their English source and their sidecar.

**Mechanical.** `node scripts/i18n/generate.ts --check` exit 0 (143 keys, 10
namespaces); `node scripts/i18n/check-strings.ts` 284 baselined findings, 0 new.
Then, independently of the validator: key set, sidecar coverage, placeholder
surface and ICU arms (this namespace has none of either), code spans, valid JSON,
NFC, danda, ellipsis, quotes, spacing, ZWJ/ZWNJ, control and bidi characters,
Devanagari digits. Every value was round-tripped through the repository's own
`parseMessage`/`formatMessage`. Ten predicates were proved falsifiable against
corrupted fixtures: 10/10 fired, and that run is in `audit.log`.

**Plural/zero.** This namespace has no plural message. The catalogue's plural
messages all live in `mobile.schedules` and `mobile.projects` (other auditors'
groups), so the zero case was rendered there through the same formatter: at count
0 `Intl.PluralRules('hi').select(0)` returns `one` and the shipped source renders
"0 जागृति", where Hindi reads the plural after zero; `=0 {# जागृतियाँ}` was proved
to render "0 जागृतियाँ" through the real parser. The schedules owner independently
filed the same defect as HI-B-5 (`hi30s1`) with the same fix. The rendered evidence
and the severity disagreement are in this record's `cross_namespace_observations`;
`सत्र`/`मॉनिटर` have no distinct direct plural, so only `जागृति` exposes it.

**Composition.** Rendered as the screen assembles them: the queue row is
`startup_queue.*` plus `queue.view`; `options.fixed` embeds the destination title
and it is byte-identical to `mobile.session.conversation_details`
("बातचीत का विवरण") — the sidecar's requirement holds. Composed sentences:

- blocked: `कतार के संदेश भेजने के लिए फिर कोशिश करें` ⏎ `कतार के संदेश देखें`
- sending: `कतार के संदेश भेजे जा रहे हैं…` ⏎ `कतार के संदेश देखें`
- unconfirmed: `शुरू होना पक्का नहीं` ⏎ `कतार के संदेश देखें`
- fixed: `इस बातचीत के शुरुआती विकल्प तय हैं। इसके लाइव नियंत्रणों के लिए “बातचीत का विवरण” देखें।`

No doubled postposition, no fragment waiting for a following word.

**Width.** CoreText/AppKit advances, system font, at the app's own token sizes
(meta 12/500, body-sm 14/400, title 20/600, label 15/600). Boxes read from
`home-splash.tsx` and `tokens.gen.ts`: the splash column is 288 pt at 320 pt
(`px-4`); the tip row subtracts the 12 pt Info glyph and its 6 pt gap → 270 pt of
text; a suggestion row is `w-full` with the quiet/md `paddingX` 16 → 256 pt.

- tips: 203.9 / 212.3 / 172.1 pt — the widest is 57.7 pt inside the 270 pt slot
  (English's widest tip is 267.7 pt, i.e. the binding one).
- chips: 93.0–116.3 pt in 256 pt.
- greeting: 285.2 pt untracked, ~279.4 pt with the title's −0.012 em tracking,
  inside 288 pt — one line, no widow.

No fit finding. There is **no rendered frame**: these are measured advances, and
the claim is the comparison with the row boxes, not a screenshot.

## Findings

See `record.json`. H-01 is MAJOR (unidiomatic calque on a rotating tip); H-02 and
H-03 are MINOR and H-04 is an optional NIT. Exact replacements, all measured.

## Second independent pass

`reviewer` subagent, job `3509c19895bd`, actual model `radient/auto`, re-read all
54 group-A values without seeing this auditor's list. It agreed on the tip
diagnosis and replacement (graded MINOR), and asked for no change on
`options.apply` — recorded as a disclosed disagreement on a NIT.

## Limits

No native-speaker review; no rendered frame (width claims are measured advances
against the box geometry read from the code); the translator's run was not observed;
shipping state at this head keeps `hi` in `NOT_YET_SHIPPED_LOCALES`, so `t()` still
returns English and `catalogues.test.ts` is red until the ship list flips — a wave
step, not a copy defect.
