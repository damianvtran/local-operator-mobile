# vi — relay.chrome — delta A, round 2 (carried forward)

**Verdict: PASSED — carried forward on byte identity, not re-read.**

- Locale `vi` · namespace `relay.chrome` · audit `vi30a5r2` · 4 keys
- Audited revision `fb4d8bcbc50c68301af624407e09b1789896e571` (branch `feat/i18n-vietnamese`)
- Round 1: `vi30a5` — passed, no findings
- Auditor: i18n-auditor (lopdev team), session `3fd3fed80964`, **actual model `radient/auto`**
  (opened on `anthropic/claude-sonnet-5-5`, fell back through `openai/gpt-6-astra` and
  `kimi/k3.1-pro` on provider quota; the commands in this bundle ran on `radient/auto`)

## What this bundle is

a mirror namespace: four relay chrome strings that must equal core's committed vi.

No round-1 finding was raised against this namespace, and **no byte of
`src/i18n/catalogues/vi/relay.chrome.json` changed in `fb4d8bc`**: the file's sha256 at this
head equals the sha256 the round-1 record pinned (`delta.bytes_identical_to_round_1`
= true, both hashes in `record.json`). The delta therefore has no content to
audit, and this bundle claims **no new reading** of the content — the round-1
verdict stands on the same bytes.

## What was re-run at this head anyway

- `npm run -s i18n:check` → exit 0 (`catalogue.gen.ts` current; `check-strings`
  284 findings, all baselined, 0 new).
- The per-namespace harness run in `audit.log`: key and context parity,
  placeholder surface, ICU arms, code spans/flags, NFC, typography, and the
  renderer round-trip — `66` PASS, 0 FINDING, 0 CONTROL-FAIL.
- The mirror check for the mirrored namespaces: `relay.chrome` 4/4 and
  `relay.health` 8/8 values byte-identical to core at `origin/main`
  `1dad86053fc037b4d7542eb40776c64e54d95d41` (core has moved since round 1's
  `0f8e3d10`, and the mirrored values did not change).

## Limits

No content re-reading for this namespace; no second pass (the second pass in this
round covered `mobile.home` only); no rendered frame; no human native review. The
translator's run was not observed by this auditor.
