# Hindi audit — `relay.chrome` (hi30a5)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `relay.chrome` · **Keys:** 4
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
- **Verdict:** `passed` — 0 findings — 4/4 values byte-identical to core's committed Hindi at origin/main
- **Style guide:** `/Users/damian/local-operator/i18n/style-guides/hi.md`;
  **glossary:** `/Users/damian/local-operator/i18n/glossary.md`;
  **core reference:** `origin/main` @ `8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.

## What was checked

This namespace is a **mirror**: its four values must be byte-identical to core's
committed Hindi, so the audit question is not re-translation but byte identity plus
a sanity read.

Executed: `git -C /Users/damian/local-operator show origin/main:<path>` at core
`origin/main = 8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`, compared value by value
with `src/i18n/catalogues/hi/relay.chrome.json`. **4/4 byte-identical**
(`subtitle.not_answering`, `subtitle.ended`, `resume`, `resuming`). Core carries 81
further keys this app does not render; the mobile catalogue mirrors the subset its
surfaces use.

Note for the record: `relay.chrome.session.resume` "जारी रखें" is the control whose
word `mobile.session_health` must not contradict — see that bundle's H-01.

**Mechanical** on the mirrored bytes: key parity, sidecar coverage, placeholders
(none), round-trip, typography — all pass (`audit.log`).

## Finding

None.

## Limits

No native-speaker review; no rendered frame (width claims are measured advances
against the box geometry read from the code); the translator's run was not observed;
shipping state at this head keeps `hi` in `NOT_YET_SHIPPED_LOCALES`, so `t()` still
returns English and `catalogues.test.ts` is red until the ship list flips — a wave
step, not a copy defect.
