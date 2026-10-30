# Delta re-audit — `mobile.computers` (`ru29c1r2`)

**Verdict: `passed` (carried, byte heredity)** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.

- **Audited head:** `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88`, branch `feat/i18n-russian`.
- **Auditor:** `i18n-auditor` (lopdev team), session `d598a29e6e64`; **actual model `radient/auto`** after
  the quota fallbacks recorded in the other three delta bundles. Independent of the translator
  (agent/session; not model-diverse). No human native-speaker review; no rendered frame.
- **Why this namespace has a delta bundle at all:** the wave's round-1 audit is `ru29c1` (`passed`,
  10 keys). The fix commit `2921aea` did not touch this file, and the shipped file is **byte-identical**
  to the bytes that round audited: target `bb37e91f…5f46600` = round-1 `input_hashes.target.sha256`, with
  the en source `356f1012…1930643` and the sidecar `3ac04e83…b40b6a5` also unchanged (executed,
  `SAME_BYTES`, in `audit.log`).
- **What this round re-ran on the shipped head** (group-wide harness, `audit.log`): 10/10 keys present in
  en, ru and the sidecar, same order, no duplicate key; every message parses; no unsanctioned parameter or
  arm difference; typography clean; `npm run -s i18n:check` exit 0; `catalogues.test.ts` 39 passed (39).
- **Semantic evidence:** the round-1 report `i18n/audits/evidence/ru/mobile.computers/ru29c1/report.md`
  remains the reading of these exact bytes; this round adds nothing semantic and claims nothing it did
  not execute. No finding is open in either round.

## Record

`i18n/audits/evidence/ru/mobile.computers/ru29c1r2/record.json`; `audit.log` is the executed group-wide
transcript, identical in the four delta bundles.
