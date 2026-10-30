# Hindi audit — `mobile.session_health` (hi30a3)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `mobile.session_health` · **Keys:** 11
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
- **Verdict:** `passed` — no BLOCKER or MAJOR; 1 MINOR + 1 NIT (adverb consistency with core's same-sheet sentence). The resume verb split was raised as a tentative MAJOR, then withdrawn on evidence
- **Style guide:** `/Users/damian/local-operator/i18n/style-guides/hi.md`;
  **glossary:** `/Users/damian/local-operator/i18n/glossary.md`;
  **core reference:** `origin/main` @ `8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.

## What was checked

11 keys, all read against source and sidecar; every status/role rule in the
sidecars checked individually.

**Safety semantics.** `error`-class strings assert no outcome they cannot know:
`resume_refused` is the retryable failure, `resume_gone` never invites a retry,
`resume_no_route` names the missing prerequisite instead of blaming the session,
`unconfirmed` (in `mobile.home`) does not imply anything is waiting. All preserved.

**The resume verb split — considered MAJOR, rejected.** This auditor's first
reading treated `resume_refused` "…फिर नहीं खोला जा सका" as a control/text
violation, because the control is `relay.chrome.session.resume` "जारी रखें".
Evidence against that reading: (a) English does exactly the same — "could not be
reopened" under a *Resume* button; (b) core's shipped Hindi splits the same way —
`relay.chrome.session.resume` "जारी रखें" beside `relay.chrome.session.resuming`
"खुल रहा है…" and `relay.health.ended_detail` "…फिर से खोलने के लिए …
“जारी रखें” दबाएँ"; (c) the sheet's title already carries जारी नहीं रखा जा सका, so
repeating it in the body would duplicate the title verbatim. Only the adverbs are
wrong (H-01), not the verb. Recorded because a finding withdrawn on evidence is
part of an honest audit.

**Composition** — the sheet as it stacks:

`सत्र` ⏎ `फिर खुल रहा है — इसमें कुछ सेकंड लग सकते हैं।` ⏎
`अभी भी खुल रहा है — यह अभी तैयार नहीं हुआ।` ⏎
`यह सत्र अभी फिर नहीं खोला जा सका। फिर कोशिश करें।`

and the ended composer placeholder beside it: `भेजने पर होम फ़ोल्डर में खुलेगा…`.
No doubled postposition; nothing reads as a fragment missing its next word.

**Mechanical.** Validator green; key parity, sidecar coverage, placeholders (none),
ICU arms (none), round-trip, typography — all pass (`audit.log`).

**Fit.** `ended_placeholder` 166.1 pt at body 16/400 in the ~348 px composer field;
the sidecar's 36-cell budget is met at 20 characters. `still_reopening` 243.3 pt
and `resume_refused` 292.4 pt at body-sm wrap inside the sheet as sentences.

## Findings

H-01 MINOR (adverbs: दोबारा / फिर से, aligned to core's same-event sentence) and
H-02 NIT (double अभी). No BLOCKER or MAJOR, so the namespace passes with findings
recorded.

## Limits

No native-speaker review; no rendered frame (width claims are measured advances
against the box geometry read from the code); the translator's run was not observed;
shipping state at this head keeps `hi` in `NOT_YET_SHIPPED_LOCALES`, so `t()` still
returns English and `catalogues.test.ts` is red until the ship list flips — a wave
step, not a copy defect.
