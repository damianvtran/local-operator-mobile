# Evidence — the in-conversation find (PR #63)

The rendered frames, the capture runs, the failed-read drive and the counterexample
proof behind [damianvtran/local-operator-mobile#63](https://github.com/damianvtran/local-operator-mobile/pull/63)
(`feat/transcript-depth`). **This push is the round-2 remediation** — the review/QA/design
round-2s of `aca28c0c` answered in one commit, head `3f014a44567e7a3fa4eaf5f3b8aa9f6bb3852545`
(`3f014a4`). The round-1 evidence stays readable at `dc38516:frames/…` (its sections are
kept below, labelled).

Everything here is produced by the tree of that head; nothing is retouched. The branch
carries evidence only — it is never merged.

## What round 2 changed (this push)

- **The caveat's failed-read state fires** (`olderThanLoaded`, `runtime.ts` + `use-session.ts`):
  the history read's own outcome is a fact on the gate — only a successful page read backs
  the silence, so a failed or never-settled read can no longer read as completeness
  (reviewer MAJOR-2 residual / QA Q63-7). The relay carrying its trimmed fact on the seed
  is recorded on the PR as a deferred core-side item: precision, not truth.
- **The caveat copy shortens** to `Older messages aren't searched.` (design D63-6) — true
  of the proven and the unchecked state alike, and the shorter footer the crowding needs.
- **The title shortens** to `search` (design D63-7) — the full phrase truncated at 200 %.
- **The separator's spacing equalizes** (design D63-8) — the dot is its own run, so the
  flex gap spaces it equally on both sides.
- The round-2 record fixes (the wake catch-up class; the ask rows' carried-and-painted
  `details.text`; `hub/peer`), and `docs/e2e/README.md`'s stale combo figure (33 → 63,
  re-derived by a live `--plan`).

## The round-2 capture

The whole find set re-captured at head `3f014a4` on `iphone-se` and `iphone-15`, both themes,
100 % and 200 % — `rig/r2-capture-full.log` (40 cells / 120 frames in 363.7 s), with the
`S5/find-caveat` cells from their own runs (`rig/r2-capture-caveat-se.log`,
`rig/r2-capture-caveat-15.log`). One headless Chrome per run, reaped by exact pid; every
run's own `teardown: 0 process(es) left`. The refreshed find frames are the table below;
the `S16/create-filled` and `path:/projects/payments-migration` frames are unchanged from
`dc38516` (this round does not touch the create sheet).

## The failed-read drive (MAJOR-2 residual / Q63-7)

Driven against the **real app**, old head vs this head, through a pass-through proxy that
fails only `/api/sessions/<id>/history` with a 503 (`rig/r2-proxy-*.log` — four intercepted
reads per run, each logged). Same cell, same world (`long-transcript`), both runs:

- **`aca28c0c` (before):** the footer reads `Searched 26 messages on this device.` — the
  failed read is silent (`rig/r2-failread-before--iphone-se--dark--100-settled.png`; no
  `session-find-caveat` marker in the manifest).
- **`3f014a4` (after):** the footer reads `Searched 26 messages on this device. Older
  messages aren't searched.` (`rig/r2-failread-after--iphone-se--dark--100-settled.png`;
  the `session-find-caveat` marker is present, both themes).

## The counterexample drive (function level)

The reviewer's construction — a 520-row journal, the 80-row capped window, no slide — run
against the verbatim old gate (inlined from `aca28c0c`) and this head's function, same
inputs; full table in `rig/r2-drive-caveat.log`:

| case | old gate | new gate |
| --- | --- | --- |
| A — cold-open past the cap, first read fails, no slide watched | **false (silent)** | **true (fires)** |
| A′ — same, with one page witness | true | true |
| B — no attempt settled (in flight / no endpoints) | false | true |
| C — successful read of a complete conversation | false | false |
| D — fresh boot past the cap, read OK | true | true |
| E — grow-in-place (Q63-1 F1) | true | true |
| F — observed slide, no page | true | true |

## Round-2 measurements (design D63-6, D63-7, D63-8)

Pixel scans of the committed frames (640×1136 px = 320×568 pt; 2 px = 1 pt), dark and light
identical to the pt:

| Measure (iphone-se, 200 %) | `aca28c0c` | `3f014a4` |
| --- | --- | --- |
| Caveat footer height | 206 pt (5 lines) | **139 pt (3 lines)** |
| Divider top | 362 pt | 429 pt |
| Results space (count line's foot → divider) | 91 pt | **158 pt** |
| Whole rows at the row's 103 pt pitch | none (91 < 103) | **row 1 whole + row 2's label; its snippet under the fade** |

- iphone-15, 200 %: footer 205 pt / 4 lines → **173 pt / 3 lines**.
- Separator (iphone-se, 100 %, `find-related`): the dot's ink gaps were **9.5 pt left /
  4.5 pt right**; now **9.5 pt / 9.5 pt** (row 2 within ±1 pt from glyph side-bearings).
- Title, 200 %: `Search this…` → `search`, whole, one line.

## What round 1 changed (kept — the dc38516 push)

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

## The capture (round 1)

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

## The audit (round 1)

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
| `path:/session/6714def86197/warm` | iphone-se | light | 100 % | `frames/path--session-6714def86197__warm__iphone-se__light__100-settled.png` | `23d5f67b24575738` |
| `path:/session/6714def86197/warm` | iphone-se | light | 200 % | `frames/path--session-6714def86197__warm__iphone-se__light__200-settled.png` | `f940dbc30b4e2467` |
| `path:/session/6714def86197/warm` | iphone-15 | dark | 100 % | `frames/path--session-6714def86197__warm__iphone-15__dark__100-settled.png` | `9b4a65a7ff9ca62f` |
| `path:/session/6714def86197/warm` | iphone-15 | dark | 200 % | `frames/path--session-6714def86197__warm__iphone-15__dark__200-settled.png` | `c33aca6ed64ae3ae` |
| `path:/session/6714def86197/warm` | iphone-15 | light | 100 % | `frames/path--session-6714def86197__warm__iphone-15__light__100-settled.png` | `45423a13893742d1` |
| `path:/session/6714def86197/warm` | iphone-15 | light | 200 % | `frames/path--session-6714def86197__warm__iphone-15__light__200-settled.png` | `4091964987b96be6` |
| `S5/find-results` | iphone-se | dark | 100 % | `frames/S5__find-results__iphone-se__dark__100-settled.png` | `1b7b4628c0c7d6c6` |
| `S5/find-results` | iphone-se | dark | 200 % | `frames/S5__find-results__iphone-se__dark__200-settled.png` | `0e3beab4bc022801` |
| `S5/find-results` | iphone-se | light | 100 % | `frames/S5__find-results__iphone-se__light__100-settled.png` | `e72e0a85d8e11eb7` |
| `S5/find-results` | iphone-se | light | 200 % | `frames/S5__find-results__iphone-se__light__200-settled.png` | `3eadc7c05ec2b2a7` |
| `S5/find-results` | iphone-15 | dark | 100 % | `frames/S5__find-results__iphone-15__dark__100-settled.png` | `98b2dd0ee5774ac2` |
| `S5/find-results` | iphone-15 | dark | 200 % | `frames/S5__find-results__iphone-15__dark__200-settled.png` | `ca36d39d33749714` |
| `S5/find-results` | iphone-15 | light | 100 % | `frames/S5__find-results__iphone-15__light__100-settled.png` | `2d7de2494649fbe1` |
| `S5/find-results` | iphone-15 | light | 200 % | `frames/S5__find-results__iphone-15__light__200-settled.png` | `754ff2283bf5d456` |
| `S5/find-related` | iphone-se | dark | 100 % | `frames/S5__find-related__iphone-se__dark__100-settled.png` | `82f6734621775047` |
| `S5/find-related` | iphone-se | dark | 200 % | `frames/S5__find-related__iphone-se__dark__200-settled.png` | `0f31ab52d594bf6d` |
| `S5/find-related` | iphone-se | light | 100 % | `frames/S5__find-related__iphone-se__light__100-settled.png` | `145a92dc4068208b` |
| `S5/find-related` | iphone-se | light | 200 % | `frames/S5__find-related__iphone-se__light__200-settled.png` | `6d0eac3e8a180cd5` |
| `S5/find-related` | iphone-15 | dark | 100 % | `frames/S5__find-related__iphone-15__dark__100-settled.png` | `6aef2227919b963e` |
| `S5/find-related` | iphone-15 | dark | 200 % | `frames/S5__find-related__iphone-15__dark__200-settled.png` | `cd3638b92af7adb6` |
| `S5/find-related` | iphone-15 | light | 100 % | `frames/S5__find-related__iphone-15__light__100-settled.png` | `b6c7f1a0054fd637` |
| `S5/find-related` | iphone-15 | light | 200 % | `frames/S5__find-related__iphone-15__light__200-settled.png` | `01a94683755f41ba` |
| `S5/find-empty` | iphone-se | dark | 100 % | `frames/S5__find-empty__iphone-se__dark__100-settled.png` | `fe65d03549f269f1` |
| `S5/find-empty` | iphone-se | dark | 200 % | `frames/S5__find-empty__iphone-se__dark__200-settled.png` | `77b8c2f1e07ca56a` |
| `S5/find-empty` | iphone-se | light | 100 % | `frames/S5__find-empty__iphone-se__light__100-settled.png` | `028842daae8e6e60` |
| `S5/find-empty` | iphone-se | light | 200 % | `frames/S5__find-empty__iphone-se__light__200-settled.png` | `512a928724947260` |
| `S5/find-empty` | iphone-15 | dark | 100 % | `frames/S5__find-empty__iphone-15__dark__100-settled.png` | `22349bd1e6684a6e` |
| `S5/find-empty` | iphone-15 | dark | 200 % | `frames/S5__find-empty__iphone-15__dark__200-settled.png` | `e387a8eee9e85068` |
| `S5/find-empty` | iphone-15 | light | 100 % | `frames/S5__find-empty__iphone-15__light__100-settled.png` | `353277af16a6207f` |
| `S5/find-empty` | iphone-15 | light | 200 % | `frames/S5__find-empty__iphone-15__light__200-settled.png` | `7e7295b5669309f5` |
| `S5/find-hit` | iphone-se | dark | 100 % | `frames/S5__find-hit__iphone-se__dark__100-settled.png` | `6a4d1bf43427411d` |
| `S5/find-hit` | iphone-se | dark | 200 % | `frames/S5__find-hit__iphone-se__dark__200-settled.png` | `2767b574099d7ef1` |
| `S5/find-hit` | iphone-se | light | 100 % | `frames/S5__find-hit__iphone-se__light__100-settled.png` | `d2758b00bb17752c` |
| `S5/find-hit` | iphone-se | light | 200 % | `frames/S5__find-hit__iphone-se__light__200-settled.png` | `1781809b837228e3` |
| `S5/find-hit` | iphone-15 | dark | 100 % | `frames/S5__find-hit__iphone-15__dark__100-settled.png` | `3e345901003e23dc` |
| `S5/find-hit` | iphone-15 | dark | 200 % | `frames/S5__find-hit__iphone-15__dark__200-settled.png` | `eba498ce9bedaaff` |
| `S5/find-hit` | iphone-15 | light | 100 % | `frames/S5__find-hit__iphone-15__light__100-settled.png` | `c7f70969a5bc4ed2` |
| `S5/find-hit` | iphone-15 | light | 200 % | `frames/S5__find-hit__iphone-15__light__200-settled.png` | `b825d354bb5406b6` |
| `S5/find-caveat` | iphone-se | dark | 100 % | `frames/S5__find-caveat__iphone-se__dark__100-settled.png` | `f62b95a9b6b5c75e` |
| `S5/find-caveat` | iphone-se | dark | 200 % | `frames/S5__find-caveat__iphone-se__dark__200-settled.png` | `8892236a008510b8` |
| `S5/find-caveat` | iphone-se | light | 100 % | `frames/S5__find-caveat__iphone-se__light__100-settled.png` | `3babb5d41a017a5b` |
| `S5/find-caveat` | iphone-se | light | 200 % | `frames/S5__find-caveat__iphone-se__light__200-settled.png` | `d98d260b0d29b63e` |
| `S5/find-caveat` | iphone-15 | dark | 100 % | `frames/S5__find-caveat__iphone-15__dark__100-settled.png` | `27bf1780556b1903` |
| `S5/find-caveat` | iphone-15 | dark | 200 % | `frames/S5__find-caveat__iphone-15__dark__200-settled.png` | `87f8b867a7ffdee4` |
| `S5/find-caveat` | iphone-15 | light | 100 % | `frames/S5__find-caveat__iphone-15__light__100-settled.png` | `ad4d31a1b3d6ceec` |
| `S5/find-caveat` | iphone-15 | light | 200 % | `frames/S5__find-caveat__iphone-15__light__200-settled.png` | `46cecff0e7133911` |
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
3x). The `S5/find-*` and warm frames above are the round-2 takes (this push, head
`3f014a4`); the `S16/create-filled` and `path:/projects/payments-migration` frames are
round 1's coverage of the shared `Sheet` change, unchanged by this round.
