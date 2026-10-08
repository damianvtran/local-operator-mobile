# Evidence — the in-conversation find (PR #63)

The rendered frames, the wire proof and the mutation proofs behind
[damianvtran/local-operator-mobile#63](https://github.com/damianvtran/local-operator-mobile/pull/63)
(`feat/transcript-depth`, head `aca28c0c494c9412ce5e5345ec99a97c4ec3e0e4`). This push is the round-1 remediation —
the three review/QA/design rounds of `1e2b3aa9` answered in one commit; the
pre-remediation evidence is the parent commit (fecbe36c35dba108a4d952bab523b5bc1251c9ba, the tree of head
`1e2b3aa9`), and its frames stay readable at `fecbe36:frames/…`.

Everything here is produced by the tree of that head; nothing is retouched. The branch
carries evidence only — it is never merged.

## What round 1 changed

- **The caveat derives from the CURRENT drops** (`olderThanLoaded`, `runtime.ts`): a held
  page row the window no longer carries, `has_more` with nothing held past the page's
  oldest row, or a slide the screen watched — replacing the mount-time-only gate that
  went silent on a conversation grown in place.
- **The subject set widened to the desktop index's inject rows** (wake/ask/compaction
  families; the two wire-driven divergences stated in `find.ts`).
- **The U-06 allowance requires a real clip** (`scrollWidth > clientWidth` under
  `overflow-x: hidden|clip`, clipper box in viewport).
- **The sheet title clamps to one line; the body gains a cut-edge fade + divider**
  (design D63-1) — the fade drawn only while the body overflows and is not at its end.
- The round's minors: the ẞ / trim folds aligned to Python, the landing re-resolved by
  id, `FIND_QUERY_MAX` enforced at the field, the figures re-derived, and this branch's
  rig logs published under `rig/`.

## The capture

Main run — 6 cells over the settled grid, one headless Chrome reused across all frames
(reaped by exact pid; the run's own `teardown: 0 process(es) left`):

```sh
node tools/visual/capture.ts --dir dist --out <out> \
  --relay <mock-url> --settle 8000 --deadline 3600 --no-strict \
  --cells "path:/session/6714def86197/warm,S5/find-results,S5/find-related,S5/find-empty,S5/find-hit,S5/find-caveat" \
  --devices iphone-se,iphone-15 --themes dark,light --scales 100,200 --consecutive --yes
```

Verdict (full log in `rig/capture.log`): `captured 48 cells / 144 frames in 463.2 s`;
`theme problems: none`; `frames that changed after first paint: 42`; `scrolled presses:
none — every opener pressed a control that was already on screen`; the warm cell at
`iphone-se/dark/100 %` is the run's one recorded unready cell — the cold-start race the
previous round's capture recorded for the same cell by the same mechanism.

Two follow-up runs, same harness:

- `rig/capture-refresh.log` — after `dist` was rebuilt for the D63-4 separator, the two
  soft-tier cells (`S5/find-related`, `S5/find-caveat`) were re-captured. Its
  `S5/find-related@iphone-se/dark/100 %` is the cold-start cell; hence:
- `rig/capture-s16.log` — `S5/find-related` re-taken (warm cell first in the plan,
  absorbing the cold start) alongside the two other surfaces that pass a `Sheet` footer
  (`S16/create-filled` — the create sheet; `path:/projects/payments-migration` — the
  project detail), because the round-1 divider/fade lands on every surface that passes a
  footer, not only on the find sheet.

The state frames committed here are the `-settled` frames; the capture also wrote `-f0`
and `-f250` per cell, kept only in the run's scratch output. The frames committed for
`S5/find-related` and `S5/find-caveat` are the refresh- and s16-run takes; every other
find frame is the main run's.

## The audit

```sh
node tools/audit/audit.ts --manifest <out>/manifest.json --out <audit> --settle 8000 --allow-blocked --tokens design/tokens/tokens.json
```

- Main manifest (full log `rig/audit.log`, report `rig/audit-report.md`):
  **`48 cells, 2000 check rows, 1860 measured, 0 FAIL, 140 BLOCKED (23 unmeasurable, 0
  state-not-reproduced)`** — the 23 unmeasurable are the one cold-start cell's rows
  (each BLOCKED row names the reason). U-06: 45 PASS, **2 EXCEPTION** — the ellipsis
  allowance rows still earned, now under the narrowed predicate, and no other row
  changed class.
- Refresh manifest (`rig/audit-refresh.log`): `16 cells, 745 check rows, 678 measured,
  0 FAIL, 67 BLOCKED (30 unmeasurable — the same cold-start cell)`.
- S16 manifest (`rig/audit-s16.log`): `32 cells, 914 check rows, 688 measured, 0 FAIL, 226 BLOCKED` — the BLOCKED set is the warm cells (23 unmeasurable from the one capture-unready cold-start cell; 119 state-not-reproduced from the warm cells' re-drive race, named per row in the log) plus the standard not-applicable rows (U-38/U-39 no table, U-40/41/42 pinned elsewhere); **the cells this run exists for — `S5/find-related`, `S16/create-filled`, `path:/projects/payments-migration` — measured with 0 FAIL**.

`pnpm e2e:canary` (full output `rig/canary.log`): **PASS** — `catches every declared
defect and passes the clean page`, with `missed: []`, `firedOnNotDefect: [],
unrecordedSuppressions: [], silentButReported: []`. The fixture now declares the round-1
negative: `#ellipsis-noclip` (nowrap+ellipsis with **no** overflow clip) is caught on
the defect page as a U-06 FAIL, while `U-06 (#ellipsis-clip)` stays in
`must-not-report` — both directions of the allowance pinned by the instrument, not by
prose.

## The wire proof

`rig/wire-proof.mjs` (run: `rig/wire-proof.log`) pins `long-transcript` and the
remediation's new `long-transcript-history` world against the harness's own mock relay,
and reads the wire facts the caveat renders:

```
login: 303 cookie present: true

=== long-transcript (6714def86197) ===
pin: 200 {"scenario":"long-transcript"}
history page: 80 entries; has_more: true ; oldest id: tc-conv-11-user
projection seed: transcript rows: 520
find scans: 26 message docs held by the window
olderThanLoaded(...) -> false (held extends past the page (oldest at index 440))

=== long-transcript-history (6714def86197) ===
pin: 200 {"scenario":"long-transcript-history"}
history page: 80 entries; has_more: true ; oldest id: tc-conv-11-user
projection seed: transcript rows: 0
find scans: 4 message docs held by the window
olderThanLoaded(...) -> true (page incomplete; nothing held past its oldest row)

=== verdict ===
control (long-transcript): caveat off — correct (held extends past the page)
history-first (long-transcript-history): caveat ON — correct (the S5/find-caveat premise)
```

The second world is `S5/find-caveat`'s scenario (a history-first open: the window IS
the page), added this push; its frame carries the caveat line the cell names.

## The grow-in-place proof (round-1 MAJOR-2)

The reviewer's sequence — open at ≤ 80 rows with a complete page, grow past the cap,
search later — is a runtime test (`runtime.test.ts`, "fires for the grow-in-place
window: a complete-at-fetch page the cap slides under"). It **fails against the
mount-time-only derivation** (the mutation that deletes the page-witness clause:
`expected false to be true` at the grow-in-place expectation in `runtime.test.ts`,
`rig/mutation-caveat.log`) and **passes at this head** (targeted suite, 7 files /
117 tests green). The test is in the module's own diff; the mutation is the recorded
proof it can fail.

## The mutation proofs

Each mutation was applied to this head's tree, the named tests run, the file restored
byte-identical (each restore verified in `rig/mutation-run.log`).

| Mutation | Command | Result |
| --- | --- | --- |
| the ranking's injected demotion neutered (`find.ts`) | `vitest run find.test.ts` | 3 failed / 23 passed — including the widened-set order and `['sa1','u1','u2']` vs `['u1','u2','sa1']` (`rig/mutation-ranking.log`) |
| the reveal's condensed-turn walk removed (`find.ts`) | `vitest run find.test.ts` | 2 failed — both condensed-turn landings return `null` (`rig/mutation-reveal.log`) |
| `findDocs` memoized across calls (the window freshness the sliding drive guards) | `vitest run find.test.ts` | 13 failed / 13 passed — the sliding drives among them (`rig/mutation-window.log`) |
| the caveat's page-witness clause deleted (`runtime.ts`) | `vitest run runtime.test.ts` | 2 failed / 6 passed — the grow-in-place case and the page-oldest case (`rig/mutation-caveat.log`) |

## The frames

| Cell | Device | Theme | Scale | File | sha256 |
| --- | --- | --- | --- | --- | --- |
| `path:/session/6714def86197/warm` | iphone-se | dark | 100 % | `frames/path--session-6714def86197__warm__iphone-se__dark__100-settled.png` | `96739a9d56858d24` |
| `path:/session/6714def86197/warm` | iphone-se | dark | 200 % | `frames/path--session-6714def86197__warm__iphone-se__dark__200-settled.png` | `4cc0c6c8bb47d524` |
| `path:/session/6714def86197/warm` | iphone-se | light | 100 % | `frames/path--session-6714def86197__warm__iphone-se__light__100-settled.png` | `c5268698603b68e4` |
| `path:/session/6714def86197/warm` | iphone-se | light | 200 % | `frames/path--session-6714def86197__warm__iphone-se__light__200-settled.png` | `f940dbc30b4e2467` |
| `path:/session/6714def86197/warm` | iphone-15 | dark | 100 % | `frames/path--session-6714def86197__warm__iphone-15__dark__100-settled.png` | `9b4a65a7ff9ca62f` |
| `path:/session/6714def86197/warm` | iphone-15 | dark | 200 % | `frames/path--session-6714def86197__warm__iphone-15__dark__200-settled.png` | `c33aca6ed64ae3ae` |
| `path:/session/6714def86197/warm` | iphone-15 | light | 100 % | `frames/path--session-6714def86197__warm__iphone-15__light__100-settled.png` | `45423a13893742d1` |
| `path:/session/6714def86197/warm` | iphone-15 | light | 200 % | `frames/path--session-6714def86197__warm__iphone-15__light__200-settled.png` | `4091964987b96be6` |
| `S5/find-results` | iphone-se | dark | 100 % | `frames/S5__find-results__iphone-se__dark__100-settled.png` | `aa213298f1229256` |
| `S5/find-results` | iphone-se | dark | 200 % | `frames/S5__find-results__iphone-se__dark__200-settled.png` | `b4e9ff26177cec2a` |
| `S5/find-results` | iphone-se | light | 100 % | `frames/S5__find-results__iphone-se__light__100-settled.png` | `d44b52e22fa685e9` |
| `S5/find-results` | iphone-se | light | 200 % | `frames/S5__find-results__iphone-se__light__200-settled.png` | `802630c89a7214d9` |
| `S5/find-results` | iphone-15 | dark | 100 % | `frames/S5__find-results__iphone-15__dark__100-settled.png` | `b6adda5ae5bbfda0` |
| `S5/find-results` | iphone-15 | dark | 200 % | `frames/S5__find-results__iphone-15__dark__200-settled.png` | `eef73447b25d31a9` |
| `S5/find-results` | iphone-15 | light | 100 % | `frames/S5__find-results__iphone-15__light__100-settled.png` | `43c5def3033d6517` |
| `S5/find-results` | iphone-15 | light | 200 % | `frames/S5__find-results__iphone-15__light__200-settled.png` | `ac502125c4274c63` |
| `S5/find-related` | iphone-se | dark | 100 % | `frames/S5__find-related__iphone-se__dark__100-settled.png` | `89e6ee11b46e9c50` |
| `S5/find-related` | iphone-se | dark | 200 % | `frames/S5__find-related__iphone-se__dark__200-settled.png` | `c96781300660793b` |
| `S5/find-related` | iphone-se | light | 100 % | `frames/S5__find-related__iphone-se__light__100-settled.png` | `0c616193de6aac82` |
| `S5/find-related` | iphone-se | light | 200 % | `frames/S5__find-related__iphone-se__light__200-settled.png` | `61f30604e5d19e24` |
| `S5/find-related` | iphone-15 | dark | 100 % | `frames/S5__find-related__iphone-15__dark__100-settled.png` | `f1c052d1fe7748a8` |
| `S5/find-related` | iphone-15 | dark | 200 % | `frames/S5__find-related__iphone-15__dark__200-settled.png` | `44fecdd4d8b7d01a` |
| `S5/find-related` | iphone-15 | light | 100 % | `frames/S5__find-related__iphone-15__light__100-settled.png` | `42410d13e2c6611e` |
| `S5/find-related` | iphone-15 | light | 200 % | `frames/S5__find-related__iphone-15__light__200-settled.png` | `5ff41900d7128310` |
| `S5/find-empty` | iphone-se | dark | 100 % | `frames/S5__find-empty__iphone-se__dark__100-settled.png` | `e78758637f4d916f` |
| `S5/find-empty` | iphone-se | dark | 200 % | `frames/S5__find-empty__iphone-se__dark__200-settled.png` | `a8bf46f92b03a44a` |
| `S5/find-empty` | iphone-se | light | 100 % | `frames/S5__find-empty__iphone-se__light__100-settled.png` | `a242d38a1710dca0` |
| `S5/find-empty` | iphone-se | light | 200 % | `frames/S5__find-empty__iphone-se__light__200-settled.png` | `e44c9af1b16b1967` |
| `S5/find-empty` | iphone-15 | dark | 100 % | `frames/S5__find-empty__iphone-15__dark__100-settled.png` | `df22b92006367753` |
| `S5/find-empty` | iphone-15 | dark | 200 % | `frames/S5__find-empty__iphone-15__dark__200-settled.png` | `40a1a6bc5215fb2a` |
| `S5/find-empty` | iphone-15 | light | 100 % | `frames/S5__find-empty__iphone-15__light__100-settled.png` | `d4fc30dc7244e695` |
| `S5/find-empty` | iphone-15 | light | 200 % | `frames/S5__find-empty__iphone-15__light__200-settled.png` | `ceb1d2db48ae71a5` |
| `S5/find-hit` | iphone-se | dark | 100 % | `frames/S5__find-hit__iphone-se__dark__100-settled.png` | `fc2450b39860a94d` |
| `S5/find-hit` | iphone-se | dark | 200 % | `frames/S5__find-hit__iphone-se__dark__200-settled.png` | `2767b574099d7ef1` |
| `S5/find-hit` | iphone-se | light | 100 % | `frames/S5__find-hit__iphone-se__light__100-settled.png` | `b5dbda75dd456a4e` |
| `S5/find-hit` | iphone-se | light | 200 % | `frames/S5__find-hit__iphone-se__light__200-settled.png` | `1781809b837228e3` |
| `S5/find-hit` | iphone-15 | dark | 100 % | `frames/S5__find-hit__iphone-15__dark__100-settled.png` | `6bebe0965dd8dcf6` |
| `S5/find-hit` | iphone-15 | dark | 200 % | `frames/S5__find-hit__iphone-15__dark__200-settled.png` | `768406b11fedf82a` |
| `S5/find-hit` | iphone-15 | light | 100 % | `frames/S5__find-hit__iphone-15__light__100-settled.png` | `bedf4ccf17dccf10` |
| `S5/find-hit` | iphone-15 | light | 200 % | `frames/S5__find-hit__iphone-15__light__200-settled.png` | `cd44bbc4068092fd` |
| `S5/find-caveat` | iphone-se | dark | 100 % | `frames/S5__find-caveat__iphone-se__dark__100-settled.png` | `20f2af3218a4b5da` |
| `S5/find-caveat` | iphone-se | dark | 200 % | `frames/S5__find-caveat__iphone-se__dark__200-settled.png` | `7a9cd2cc27d4195d` |
| `S5/find-caveat` | iphone-se | light | 100 % | `frames/S5__find-caveat__iphone-se__light__100-settled.png` | `32f608499c0ce542` |
| `S5/find-caveat` | iphone-se | light | 200 % | `frames/S5__find-caveat__iphone-se__light__200-settled.png` | `d07e8b463bfd5d04` |
| `S5/find-caveat` | iphone-15 | dark | 100 % | `frames/S5__find-caveat__iphone-15__dark__100-settled.png` | `8d91e0d52dfb1eec` |
| `S5/find-caveat` | iphone-15 | dark | 200 % | `frames/S5__find-caveat__iphone-15__dark__200-settled.png` | `247634fc8539c93c` |
| `S5/find-caveat` | iphone-15 | light | 100 % | `frames/S5__find-caveat__iphone-15__light__100-settled.png` | `54299b3867f468f2` |
| `S5/find-caveat` | iphone-15 | light | 200 % | `frames/S5__find-caveat__iphone-15__light__200-settled.png` | `8f0893b6251c9bea` |
| `S16/create-filled` | iphone-se | dark | 100 % | `frames/S16__create-filled__iphone-se__dark__100-settled.png` | `3ce756d2a34c21d4` |
| `S16/create-filled` | iphone-se | dark | 200 % | `frames/S16__create-filled__iphone-se__dark__200-settled.png` | `719fc81fad4225df` |
| `S16/create-filled` | iphone-se | light | 100 % | `frames/S16__create-filled__iphone-se__light__100-settled.png` | `c7c1d4a13c3b1f49` |
| `S16/create-filled` | iphone-se | light | 200 % | `frames/S16__create-filled__iphone-se__light__200-settled.png` | `fe0bbbbb5661c194` |
| `S16/create-filled` | iphone-15 | dark | 100 % | `frames/S16__create-filled__iphone-15__dark__100-settled.png` | `ddf53d5e90a8470c` |
| `S16/create-filled` | iphone-15 | dark | 200 % | `frames/S16__create-filled__iphone-15__dark__200-settled.png` | `2c11d1518231454b` |
| `S16/create-filled` | iphone-15 | light | 100 % | `frames/S16__create-filled__iphone-15__light__100-settled.png` | `b0ab45ccf7c1efa4` |
| `S16/create-filled` | iphone-15 | light | 200 % | `frames/S16__create-filled__iphone-15__light__200-settled.png` | `0b43197544ed1c8e` |
| `path:/projects/payments-migration` | iphone-se | dark | 100 % | `frames/path--projects__payments-migration__iphone-se__dark__100-settled.png` | `c7547c1f1e305d01` |
| `path:/projects/payments-migration` | iphone-se | dark | 200 % | `frames/path--projects__payments-migration__iphone-se__dark__200-settled.png` | `ffc7340c42f46524` |
| `path:/projects/payments-migration` | iphone-se | light | 100 % | `frames/path--projects__payments-migration__iphone-se__light__100-settled.png` | `71d53824538eb2a7` |
| `path:/projects/payments-migration` | iphone-se | light | 200 % | `frames/path--projects__payments-migration__iphone-se__light__200-settled.png` | `d1c100ef1e45a953` |
| `path:/projects/payments-migration` | iphone-15 | dark | 100 % | `frames/path--projects__payments-migration__iphone-15__dark__100-settled.png` | `d23b21dbfe7ffaae` |
| `path:/projects/payments-migration` | iphone-15 | dark | 200 % | `frames/path--projects__payments-migration__iphone-15__dark__200-settled.png` | `b0228390392ed398` |
| `path:/projects/payments-migration` | iphone-15 | light | 100 % | `frames/path--projects__payments-migration__iphone-15__light__100-settled.png` | `f95f9f35d369c7ad` |
| `path:/projects/payments-migration` | iphone-15 | light | 200 % | `frames/path--projects__payments-migration__iphone-15__light__200-settled.png` | `3a66bc78157b9cef` |

Frames are PNGs at the device's DPR (iphone-se 640x1136 at 2x; iphone-15 1170x2532 at
3x). The `S16/create-filled` and `path:/projects/payments-migration` frames are this
push's added coverage for the shared `Sheet` change (the two other footer surfaces).
