# Evidence — the in-conversation find (PR #63)

The rendered frames, the wire proof and the mutation proofs behind
[damianvtran/local-operator-mobile#63](https://github.com/damianvtran/local-operator-mobile/pull/63)
(`feat/transcript-depth`, head `1e2b3aa9ce4db15d002e57089c7d18c6d79b5dca`).

Everything here is produced by the tree of that head; nothing is retouched. The branch
carries evidence only — it is never merged.

## The capture

One local run, one headless Chrome reused across all frames (reaped by exact pid; the
run's own `survivors: 0`):

```sh
node tools/visual/capture.ts --dir dist --out <out> \
  --relay <mock-url> --port <static-port> --seed-route <static-origin> \
  --settle 8000 --deadline 3600 --no-strict \
  --cells "path:/session/6714def86197/warm,S5/find-results,S5/find-related,S5/find-empty,S5/find-hit" \
  --devices iphone-se,iphone-15 --themes dark,light --scales 100,200 --consecutive --yes
```

Verdict (full log in `rig/capture.log`): `captured 40 cells / 120 frames`;
`theme problems: none`; the warm-up cell is the run's one recorded unready cell by
design; the two `S5/find-hit` = warm byte-identical pairs at iphone-se / 200 % are the
declared "chrome fills the 320 pt column" camera class, which `S5/find-hit` joins.

The state frames committed here are the `-settled` frames; the capture also wrote `-f0`
and `-f250` per cell (`35` cells changed after first paint), kept only in the run's
scratch output.

## The audit

```sh
node tools/audit/audit.ts --manifest <out>/manifest.json --out <audit> --settle 8000 --allow-blocked
```

Verdict (full log in `rig/audit.log`, report in `rig/audit-report.md`): **0 FAIL** —
`40 cells, 1462 check rows, 1342 measured, 0 FAIL, 120 BLOCKED` (the BLOCKED set is the
harness's standing set for a manifest captured without the app-build-dependent checks;
same count as this tree's pre-change runs). The U-06 allowance rows are recorded as
EXCEPTIONs naming the clipper (`right edge 330px vs viewport 320px (+10px)`).

`pnpm e2e:canary` (full output in `rig/canary.log`): **PASS** — every declared defect
caught, clean page 0 FAILs, and `U-06 (#ellipsis-clip)` in `must-not-report` with
`unrecordedSuppressions: []` (the new branch records the declared reason).

## The wire proof

`rig/wire-proof.mjs` (run: `rig/wire-proof.log`) pins `long-transcript` against the
harness's own mock relay and reads the two wire facts the find UI renders:

```
pin: 200 {"scenario":"long-transcript"}
login: 303 cookie present: true
history page: 80 entries; has_more: true ; oldest id: tc-conv-11-user
projection seed: transcript rows: 520
find scans: 26 message docs held by the projection
olderThanLoaded inputs: hasMore=true pageOldestId=tc-conv-11-user -> pageOldestIndexInHeld=440
```

- 80 entries is the app's own `HISTORY_LIMIT.default`; 520 rows is the mock's full
  projection (the real relay caps at 80, which is the case the sliding-window tests
  drive).
- `find scans: 26` is the exact number the rendered scope line reports
  ("Searched 26 messages on this device.").
- `pageOldestIndexInHeld: 440` → the caveat stays off, correctly: the held rows extend
  past the page, so the sheet may not claim older messages are missing.

## The mutation proofs

Each mutation was applied to the head's tree, the named tests run, and the file restored
byte-identical (the restore is verified in each log's final line).

| Mutation | Command | Result |
| --- | --- | --- |
| the ranking's injected demotion neutered (`find.ts`) | `vitest run find.test.ts` | 1 failed / 20 passed — `expected ['sa1','u1','u2'] to deeply equal ['u1','u2','sa1']` (`rig/mutation-ranking.log`) |
| the reveal's condensed-turn walk removed (`find.ts`) | `vitest run find.test.ts` | 2 failed — both condensed-turn landings return `null` (`rig/mutation-reveal.log`) |
| `findDocs` memoized across calls (the window freshness the sliding drive guards) | `vitest run find.test.ts` | 10 failed, including both sliding-window drives (`rig/mutation-window.log`) |

## The frames

| Cell | Device | Theme | Scale | File | sha256 |
| --- | --- | --- | --- | --- | --- |
| `S5/find-empty` | iphone-15 | dark | 100 % | `frames/S5__find-empty__iphone-15__dark__100-settled.png` | `496cae2226ee5fe2` |
| `S5/find-empty` | iphone-15 | dark | 200 % | `frames/S5__find-empty__iphone-15__dark__200-settled.png` | `0093919b27109a4e` |
| `S5/find-empty` | iphone-15 | light | 100 % | `frames/S5__find-empty__iphone-15__light__100-settled.png` | `ca697ff76074f70a` |
| `S5/find-empty` | iphone-15 | light | 200 % | `frames/S5__find-empty__iphone-15__light__200-settled.png` | `faa1e86b9ca411ab` |
| `S5/find-empty` | iphone-se | dark | 100 % | `frames/S5__find-empty__iphone-se__dark__100-settled.png` | `3894ccd77153866f` |
| `S5/find-empty` | iphone-se | dark | 200 % | `frames/S5__find-empty__iphone-se__dark__200-settled.png` | `540dedac77756b80` |
| `S5/find-empty` | iphone-se | light | 100 % | `frames/S5__find-empty__iphone-se__light__100-settled.png` | `ac5ca2b7d36d0fee` |
| `S5/find-empty` | iphone-se | light | 200 % | `frames/S5__find-empty__iphone-se__light__200-settled.png` | `3574ee454c76ecc8` |
| `S5/find-hit` | iphone-15 | dark | 100 % | `frames/S5__find-hit__iphone-15__dark__100-settled.png` | `5826ddfc52b5163f` |
| `S5/find-hit` | iphone-15 | dark | 200 % | `frames/S5__find-hit__iphone-15__dark__200-settled.png` | `eba498ce9bedaaff` |
| `S5/find-hit` | iphone-15 | light | 100 % | `frames/S5__find-hit__iphone-15__light__100-settled.png` | `f1c0a3be856edae2` |
| `S5/find-hit` | iphone-15 | light | 200 % | `frames/S5__find-hit__iphone-15__light__200-settled.png` | `b825d354bb5406b6` |
| `S5/find-hit` | iphone-se | dark | 100 % | `frames/S5__find-hit__iphone-se__dark__100-settled.png` | `19ee0b14e67337ab` |
| `S5/find-hit` | iphone-se | dark | 200 % | `frames/S5__find-hit__iphone-se__dark__200-settled.png` | `2767b574099d7ef1` |
| `S5/find-hit` | iphone-se | light | 100 % | `frames/S5__find-hit__iphone-se__light__100-settled.png` | `62918fb80eccf641` |
| `S5/find-hit` | iphone-se | light | 200 % | `frames/S5__find-hit__iphone-se__light__200-settled.png` | `1781809b837228e3` |
| `S5/find-related` | iphone-15 | dark | 100 % | `frames/S5__find-related__iphone-15__dark__100-settled.png` | `66c28f69f12e00e9` |
| `S5/find-related` | iphone-15 | dark | 200 % | `frames/S5__find-related__iphone-15__dark__200-settled.png` | `1092f79b14d2bbfd` |
| `S5/find-related` | iphone-15 | light | 100 % | `frames/S5__find-related__iphone-15__light__100-settled.png` | `e05f7e8793252628` |
| `S5/find-related` | iphone-15 | light | 200 % | `frames/S5__find-related__iphone-15__light__200-settled.png` | `7f8354b9d5bef3e0` |
| `S5/find-related` | iphone-se | dark | 100 % | `frames/S5__find-related__iphone-se__dark__100-settled.png` | `6357ec89e6db0b98` |
| `S5/find-related` | iphone-se | dark | 200 % | `frames/S5__find-related__iphone-se__dark__200-settled.png` | `e37f3e920cecc900` |
| `S5/find-related` | iphone-se | light | 100 % | `frames/S5__find-related__iphone-se__light__100-settled.png` | `4ac031ac500fb9eb` |
| `S5/find-related` | iphone-se | light | 200 % | `frames/S5__find-related__iphone-se__light__200-settled.png` | `0151a03258b3b31b` |
| `S5/find-results` | iphone-15 | dark | 100 % | `frames/S5__find-results__iphone-15__dark__100-settled.png` | `ab1165880b052be7` |
| `S5/find-results` | iphone-15 | dark | 200 % | `frames/S5__find-results__iphone-15__dark__200-settled.png` | `3f5ccfaea020ddfe` |
| `S5/find-results` | iphone-15 | light | 100 % | `frames/S5__find-results__iphone-15__light__100-settled.png` | `2df1f87f5e604a76` |
| `S5/find-results` | iphone-15 | light | 200 % | `frames/S5__find-results__iphone-15__light__200-settled.png` | `24e4c7fee818a33a` |
| `S5/find-results` | iphone-se | dark | 100 % | `frames/S5__find-results__iphone-se__dark__100-settled.png` | `9a010769eb0f2652` |
| `S5/find-results` | iphone-se | dark | 200 % | `frames/S5__find-results__iphone-se__dark__200-settled.png` | `4d55c8d5ac1d5e96` |
| `S5/find-results` | iphone-se | light | 100 % | `frames/S5__find-results__iphone-se__light__100-settled.png` | `54de3acc5ac904e5` |
| `S5/find-results` | iphone-se | light | 200 % | `frames/S5__find-results__iphone-se__light__200-settled.png` | `a9495fa0c1b2d834` |
| `path--session-6714def86197/warm` | iphone-15 | dark | 100 % | `frames/path--session-6714def86197__warm__iphone-15__dark__100-settled.png` | `36033fce5f0d3a48` |
| `path--session-6714def86197/warm` | iphone-15 | dark | 200 % | `frames/path--session-6714def86197__warm__iphone-15__dark__200-settled.png` | `3a1b38c236d1ab7c` |
| `path--session-6714def86197/warm` | iphone-15 | light | 100 % | `frames/path--session-6714def86197__warm__iphone-15__light__100-settled.png` | `58a69e85653608af` |
| `path--session-6714def86197/warm` | iphone-15 | light | 200 % | `frames/path--session-6714def86197__warm__iphone-15__light__200-settled.png` | `67a883b7e3396f86` |
| `path--session-6714def86197/warm` | iphone-se | dark | 100 % | `frames/path--session-6714def86197__warm__iphone-se__dark__100-settled.png` | `96739a9d56858d24` |
| `path--session-6714def86197/warm` | iphone-se | dark | 200 % | `frames/path--session-6714def86197__warm__iphone-se__dark__200-settled.png` | `2767b574099d7ef1` |
| `path--session-6714def86197/warm` | iphone-se | light | 100 % | `frames/path--session-6714def86197__warm__iphone-se__light__100-settled.png` | `60965ec9801951f2` |
| `path--session-6714def86197/warm` | iphone-se | light | 200 % | `frames/path--session-6714def86197__warm__iphone-se__light__200-settled.png` | `1781809b837228e3` |

Frames are PNGs at the device's DPR (iphone-se 640x1136 at 2x; iphone-15 1170x2532 at 3x).
