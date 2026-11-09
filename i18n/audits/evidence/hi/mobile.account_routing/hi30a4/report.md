# Hindi audit — `mobile.account_routing` (hi30a4)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.account_routing` · **Keys:** 14
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
- **Verdict:** `passed` — no BLOCKER or MAJOR; 1 MINOR (control named differently from the sentence that instructs it) + 1 MINOR (फिर vs फिर से) + 1 NIT
- **Style guide:** `/Users/damian/local-operator/i18n/style-guides/hi.md`;
  **glossary:** `/Users/damian/local-operator/i18n/glossary.md`;
  **core reference:** `origin/main` @ `8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.

## What was checked

14 keys, all read against source and sidecar.

**Certainty ladder.** The sidecars ask for four distinct states and the Hindi keeps
them distinct: `loading` (read in flight), `saved` (validated confirmation),
`unsaved` (draft differs), `rejected` (definitive refusal), `error` (unknown
outcome, asserts neither success nor failure), `unavailable` (confirmed missing
route, not an offline tunnel), `load_error` (other read failure). No state is
collapsed into another.

**Terminology.** खाता for account and रिले for relay match core's committed Hindi
(खाता 10 occurrences across 7 core keys; रिले in core's relay namespace), and
रूटिंग takes feminine agreement consistently in all four keys where it is the
subject (लोड हो रही है / लोड नहीं हो सकी). `scope` "बदलाव केवल इस कंप्यूटर पर लागू होते
हैं।" never implies a phone-global policy.

**One real mismatch (H-01):** the control says पढ़ें while every other string about
the same operation says लोड.

**Composition** — heading, scope and result as settings stacks them:

`खाता रूटिंग` ⏎ `बदलाव केवल इस कंप्यूटर पर लागू होते हैं।` ⏎ `इस कंप्यूटर पर सहेजा गया।`

**Mechanical.** Validator green; key parity, sidecar coverage, placeholders (none),
ICU arms (none), round-trip, typography — all pass (`audit.log`).

## Findings

H-01 MINOR (control/text mismatch) and H-02 MINOR (फिर से). No BLOCKER or MAJOR:
the namespace passes with findings recorded for the batched remediation round.

## Limits

No native-speaker review; no rendered frame (width claims are measured advances
against the box geometry read from the code); the translator's run was not observed;
shipping state at this head keeps `hi` in `NOT_YET_SHIPPED_LOCALES`, so `t()` still
returns English and `catalogues.test.ts` is red until the ship list flips — a wave
step, not a copy defect.
