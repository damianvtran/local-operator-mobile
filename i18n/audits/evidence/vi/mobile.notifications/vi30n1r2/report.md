# Delta re-audit — `mobile.notifications` (`vi30n1r2`)

**Verdict: `passed` (carried, byte heredity)** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.

- **Audited head:** `fb4d8bcbc50c68301af624407e09b1789896e571` on `feat/i18n-vietnamese` (round 1 audited `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b`).
- **Auditor:** `i18n-auditor` (lopdev team), session `bb04cc6cb19a`; **actual model
  `radient/auto`** after three provider-quota fallbacks, all before this round's first
  command. Independent of the translator (agent/session; not model-diverse). No human
  native-speaker review; no rendered frame.
- **Why this namespace has a delta bundle:** round 1 is `vi30n1` (`passed`,
  14 keys). The fix commit `fb4d8bc` did not touch this file,
  and the shipped file is **byte-identical** to the bytes that round audited:
  target `a50da99c7431bdd30629bd172af9677a7e47c208e1c7a34be8d5ad2d6c60d6b3` = round-1 `input_hashes.target.sha256`, with the English
  source `c6e58c61…` and the sidecar `240ec6be…` also
  unchanged (computed and printed as `SAME` in `audit.log`).
- **What this round re-ran on the shipped head** (group-wide harness, `audit.log`): 77/77
  group-B keys parse and compare clean — placeholder names, select arms, per-arm
  placeholders, plural categories (`vi` = `other` only), key parity, key order, NFC;
  typography clean; `generate.ts --check` exit 0; `check-strings.ts` exit 0;
  `vitest src/i18n/__tests__` 99 passed; the production render of this namespace's keys
  moved **not at all** (the render diff against round 1 reports exactly 6 changed rows, all
  in `mobile.schedules`).
- **Semantic evidence:** the round-1 report
  `i18n/audits/evidence/vi/mobile.notifications/vi30n1/report.md` remains the reading of these exact bytes.
  This round adds no semantic claim and claims no execution it did not perform. No finding is
  open in either round.

## Record

`i18n/audits/evidence/vi/mobile.notifications/vi30n1r2/record.json`; `audit.log` is the executed
group-wide transcript, identical in the four group-B delta bundles.
