# Hindi audit — `relay.health` (hi30a6)

- **Locale:** `hi` (Devanagari, LTR) · **Namespace:** `relay.health` · **Keys:** 8
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
- **Verdict:** `passed` — 0 findings — 8/8 values byte-identical to core's committed Hindi at origin/main
- **Style guide:** `/Users/damian/local-operator/i18n/style-guides/hi.md`;
  **glossary:** `/Users/damian/local-operator/i18n/glossary.md`;
  **core reference:** `origin/main` @ `8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.

## What was checked

Mirror namespace: eight values, compared byte for byte with core's committed Hindi
at `origin/main = 8076c56acd56f07f1cabf90fd7fca8bf0e5acdff`.
**8/8 byte-identical** (`live`, `live_detail`, `reconnecting`, `reconnecting_-
detail`, `dropped_detail`, `quiet_detail`, `ended_detail`, `ended_send_failed`).

The long `*_detail` sentences were also read for safety meaning: `dropped_detail`
says sending fails while the computer cannot be reached and the typed text stays in
the field; `quiet_detail` says a send may look failed yet can still arrive once the
session answers again, and retrying will not deliver it twice; `ended_send_failed`
offers two named remedies. All preserved verbatim from core, which is the point of
a mirror.

**Mechanical** on the mirrored bytes: key parity, sidecar coverage, round-trip,
typography — all pass (`audit.log`).

## Finding

None in the mirror's own terms — byte identity is the requirement and it holds.

**Upstream observation (not a mobile defect, not actionable here):** `reconnecting`
is "फिर से कनेक्ट हो रहा" without the copula, while core's own
`relay.chrome.list.connecting` reads "कनेक्ट हो रहा है…". Changing it here would
break the byte identity the mirror exists to guarantee, so it belongs to a core-side
copy decision, not to this wave.

## Limits

No native-speaker review; no rendered frame (width claims are measured advances
against the box geometry read from the code); the translator's run was not observed;
shipping state at this head keeps `hi` in `NOT_YET_SHIPPED_LOCALES`, so `t()` still
returns English and `catalogues.test.ts` is red until the ship list flips — a wave
step, not a copy defect.
