# Hindi audit — `mobile.session` (hi30a2)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.session` · **Keys:** 2
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
- **Verdict:** `passed` — 0 findings — 2/2 keys accurate; the quoted destination title is byte-identical to the screen title and the working-line term matches core's committed Hindi
- **Style guide:** `/Users/damian/local-operator/i18n/style-guides/hi.md`;
  **glossary:** `/Users/damian/local-operator/i18n/glossary.md`;
  **core reference:** `origin/main` @ `8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.

## What was checked

2 keys, both read against source and sidecar.

**Content.** `conversation_details` "बातचीत का विवरण" is the destination title, and
it is byte-identical to the quoted title inside `mobile.home.options.fixed` —
verified by rendering both through the repository formatter, not by eye. The
sidecar's "must stay identical wherever that screen is named" holds.

`status_tray.hint` "कार्यरत पंक्ति, कार्य और उप-एजेंट खोलता है" uses कार्यरत for
"working", which is exactly core's shipped word for the working state
(`relay.chrome.session.subtitle.working` "कार्यरत"). उप-एजेंट is the style guide's
settled term. कार्य for tasks matches core (`relay.chrome.session.tray.tasks`
"कार्य {done}/{total}"). No competing rendering exists in the catalogue.

**Mechanical.** Validator green as recorded in `audit.log`; key parity, sidecar
coverage, placeholders (none), ICU arms (none), whole-value round-trip,
typography predicates all pass.

**Fit.** The hint is an accessibility hint (not clamped): 227.7 pt at body-sm in
the 288 pt column; the tray label it follows is a single line.

## Finding

None. `status_tray.hint` was considered for the कार्य/कार्यरत repetition and
rejected: the second independent reader reached the same conclusion, and no
competing term exists to switch to.

## Out of scope, recorded

The tray's accessible *label* is an English template literal in source —
`accessibilityLabel={`${summary} — show status`}` at
`src/features/session/components/status-tray.tsx:78` (verified here; the string
appears 0 times in `scripts/i18n/strings-baseline.json`). A Hindi reader therefore
hears a Hindi hint after an English label suffix. That is a code-level i18n gap on
the control this namespace's hint belongs to, not a defect in the Hindi catalogue,
and it needs a key plus a code change rather than a translation edit.

## Limits

No native-speaker review; no rendered frame (width claims are measured advances
against the box geometry read from the code); the translator's run was not observed;
shipping state at this head keeps `hi` in `NOT_YET_SHIPPED_LOCALES`, so `t()` still
returns English and `catalogues.test.ts` is red until the ship list flips — a wave
step, not a copy defect.
