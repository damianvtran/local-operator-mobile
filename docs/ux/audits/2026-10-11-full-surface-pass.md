# Full-surface visual pass — 2026-10-11

Every screen × state the frame harness can drive, across phone sizes, tablets
upright and sideways, both themes, and the text-scale axis — judged on rendered
frames against the audit rubric ([`../audit-rubric.md`](../audit-rubric.md)),
the checks table ([`../audit-checks.json`](../audit-checks.json)) and the design
system ([`../../design/README.md`](../../design/README.md),
[`../../docs/design/brand-kit.md`](../../design/brand-kit.md)).

Two defects this pass measured are fixed here with before/after frames; one
further candidate fix was tried, measured inert and reverted rather than shipped
unverified (D3); the rest are recorded with
their frames. The matrix, the frame accounting and the limits of a web-render
audit are below, because "we looked at every screen" is a claim that should be
checkable.

## 1. The matrix, and what it produced

| Run | Devices | Themes | Scales | Cells | Frames |
|---|---|---|---|---|---|
| 1 | `android-compact` 360×640, `iphone-15` 390×844, `iphone-max` 430×932, `iphone-15-landscape` 844×390, `tablet` 834×1112, `tablet-landscape` 1112×834 | dark, light | 100 % | 948 | 2844 |
| 2 | `iphone-se` 320×568 | dark, light | 100 / 135 / 200 % | 474 | 1422 |

**1422 cells / 4266 frames**, 79 distinct screen × state cells, driven by the
repo's own harness (`tools/visual/capture.ts`) against the mock relay. Every
cell's frames are the harness's three-phase set (`-f0`, `-f250`, `-settled`);
the evidence cited below is the settled frame unless a finding says otherwise.

The harness gates each frame as it is taken, and both runs came back clean:

- **theme problems: none** — every frame's resolved theme and canvas colour
  match its cell, and no dark/light pair is identical (run 1 and run 2).
- **readiness: every captured cell reached the screen it names** (840 measured
  cells in run 1 + 420 in run 2, 0 unready, 0 abandoned).
- **identical frames:** the only byte-identical pairs are the ones declared in
  `tools/visual/matrix.ts` — 6 exempt pairs + 3 one-view coincidences in run 1,
  10 exempt in run 2 — each with its reason; there are no undeclared collapses.
- **text-scale dimension (run 2): live across 158/158 measured pairs** — every
  type role grew by its factor. 34 pairs show a size only at 200 %; the harness
  names them ("a node that did not move with the root font size, or a layout
  that introduced it at this scale") and they are warnings, not failures.
- **frames that changed after first paint:** 885 (run 1) and 460 (run 2) — the
  app is alive at settle (streaming shimmer, working-line timers); this is why
  the three-phase set exists, and every "before/after" below pairs settled
  frames only.
- **teardown, both runs: 0 processes left, 0 orphans.**

**Verification re-captures (fixed head):** 116 cells / 348 frames — the two fixed
surfaces across the phone widths, and the pane's three states across
`iphone-se` / `iphone-15` / `iphone-15-landscape` / `tablet-landscape` at
100/135/200 % — all ready, themes clean, teardown 0, and the unchanged pane
surfaces **pixel-identical to their before frames** (`AE = 0` below the header
for every captured pane variant), so the pass's non-fixes move nothing. One
run-shape note: the FIRST cell of a fresh capture process can miss its first
load against a freshly re-pinned relay (the app paints `authentication required`
or an empty transcript) — the harness reports it as an unready cell, and the one
cell it hit here (S5/populated, android-compact, dark) was re-taken with a
warm-up cell before it.

Screens covered: welcome/sign-in (S1, S1-welcome), the tunnel/computer set-up
screens (S2, S3, S3-custom), the home composer (S4), the session view (S5,
26 states: populated, streaming, tables, rich rows, checkpoint rail, find,
subagents, send-delivery, voice, queued, aborted, empty, error, degraded…), the
subagent detail (S6), the approval/ask cards (S8), the past-session list (S10),
settings (S13), the conversations panel and drawer (S15, 15 states incl. the
move/mesh flows), projects + detail + milestone editor (S16, S16-detail), and
schedules (S17), plus the two `path:` cells that drive the transcript's scroll
and expand hooks.

## 2. The checks that ran

**The audit tool** (`tools/audit/`), which re-drives every captured cell and
measures the DOM behind the frame. Both runs' full reports: run 1 (`six
devices`) — **exit 1: 442 FAIL**; run 2 (`iphone-se`) — **exit 0: PASS**. The
failure classes are findings D8 and D9 below; every other check is clean on
every measured row.

Run 1 (948 cells, 25131 check rows, 19447 measured, 108 declared skips):

| check | pass | fail | exception | blocked |
|---|---|---|---|---|
| U-01 touch targets | 738 | **434** | 74 | 108 |
| U-02 body contrast | 840 | 0 | 0 | 108 |
| U-03 non-text carriers | 840 | 0 | 0 | 108 |
| U-04 text scale | 0 | 0 | 0 | 948 |
| U-05 safe areas | 840 | 0 | 0 | 108 |
| U-06 horizontal overflow | 816 | 0 | 192 | 108 |
| U-07 clipped text | 544 | 0 | 1472 | 108 |
| U-08 overlap | 481 | 0 | 2584 | 248 |
| U-09 accessible names | 840 | 0 | 0 | 108 |
| U-10 label-in-name | 828 | 0 | 12 | 108 |
| U-38 / U-39 tables | 60 / 60 | 0 / 0 | 0 / 0 | 888 / 888 |
| U-40 scroll cue | 600 | 0 | 0 | 348 |
| U-41 rail and caret | 276 | 0 | 0 | 672 |
| U-42 spacing scale | 836 | **8** | 6072 | 828 |

Run 2 (474 cells, 12978 check rows, 10206 measured, 54 declared skips): every
check 0 FAIL; U-04 measured 140 rows, 0 failures — the scale dimension is live
across 158/158 pairs (§ 1).

**Repo gates on this PR:** `biome check`, `tsc --noEmit` (both projects),
`vitest` — targeted locally, full suite in CI. The design-token gates
(`contrast-contract.mjs` 1143 assertions, `build-preset --check`) run unmodified
in CI; this PR does not change tokens.

## 3. Findings

Cited frames live in
`docs/assets/screenshots/audit-2026-10-11/{before,after}/`; a `before/` file is
the defect as captured on the pre-fix head, the same-named `after/` file is the
fixed surface re-captured with the same harness, size, theme and scale.

### D1 — the session header double-truncates on every phone — **MAJOR, fixed**

Before this PR, every phone-sized session cell drew the conversation name with
TWO ellipses — the app's own middle truncation, and then the platform's end
clip on the string it had just preserved:

- `iphone-15` (390): `Hello from…k prov…`, `Refactor t…lay cli…`
- `iphone-max` (430): `Hello from t…ck provi…`, `Refactor the…elay cli…`
- `android-compact` (360): `Hello fro… provi…`

(Before frames: `before/d1-header-390-dark.png`, `-430-light.png`,
`-360-dark.png` in `docs/assets/screenshots/audit-2026-10-11/`.)

`headerTitleChars()` budgets the name from `HEADER_CHROME_PT = 32 + 44 + 8` —
gutters, the back control, one gap — a sum written when the D8 round moved the
old status chip out of the row. The find lever then took that slot, and its own
comment argued "the icon cannot clip the middle truncation's budget". Measured
this pass: it can and does. The h1's real box is `width − 32 − 44 − 8 − 48 − 8`
(the 48 pt `IconButton` the web build renders plus its gap), so the budget
over-promised by ~50 pt at every width: 21 chars at 390 where ~17 fit, 24 at
430 where ~20 fit.

**Fix:** `HEADER_CHROME_PT` now counts the find lever (`32 + 44 + 8 + 48 + 8`),
the comment records the relapse and the measurement, and `header.test.ts` pins
the re-derived budgets (17 / 20 / 12 at 390 / 430 / 320) against the same
measured advance. After frames: `after/d1-header-390-dark.png`,
`-430-light.png`, `-360-dark.png` — one ellipsis, both ends intact, no clip.

### D2 — the drawer's loading skeletons are invisible — **MAJOR, fixed**

`S15/loading` is supposed to show three skeleton bars in place of the session
rows. In the captured frames the pane is blank between the "Not answering" pill
and the footer. This is not a missing render: a pixel scan of the bars' own band
(iphone-15, dark, settled frame — x 0–900, y 640–1898) found **zero
non-background pixels**, and the token table explains why: the bar's resting
fill is `elevated` (#322d22) and the drawer's surface is `elevated` (#322d22) —
the same colour (light theme: #fefdfa on #fefdfa). With reduced motion the
pulse stops at exactly that fill, and a still frame catches it there. The
component's own doc says this failure — "the loading state reads as an empty
one" — is what the `elevated`-over-`sunken` choice exists to prevent; it
assumed the canvas ground, and the pane draws on its own raised surface.

**Fix:** `Skeleton` takes a `ground` prop (`canvas`, the default, or `raised`,
which swaps the pulse's ends to `sunken` → `canvas`), and the pane's waiting
rows pass `ground="raised"`. Before/after: `d2-skeleton-390-dark.png`,
`d2-skeleton-390-light.png`.

### D3 — the drawer's empty state renders a line sliced at the fold on short viewports — **MINOR, recorded**

Two variants of one observation:

- **844×390 (phone landscape):** the drawer's empty state shows the mark and
  the headline, then the first paragraph line is sliced through its glyphs by
  the list's fold, with `New chat` below it (`before/d3-empty-844x390-dark.png`).
- **iphone-se at 200 %:** the same slice — `A session is`, then the footer
  (`before/d3-empty-se200-light.png`).

What the slice IS: the pane's list is a scroll container, its content at rest
is taller than the band it owns, and the fold cuts through a text line — so the
line reads as a rendering fault even though a scroll reaches the button (the
same class the Sheet's cut-edge fade exists for).

**A fix was tried and MEASURED INERT, then reverted** rather than shipped
unverified: the wrapper's `flex-1` became `grow shrink-0` (take leftover room
when there is room, never shrink under the content), and the re-captured build
rendered the identical frame on every variant — pixel diff `AE = 0` below the
header for iphone-15 portrait, iphone-15-landscape, tablet-landscape and
iphone-se at 135/200 %. The frames above are therefore `before/`-only.

Recorded, with the options a fix actually has — all product judgement, which is
why this pass does not pick one: copy that shortens for short viewports, a
cut-edge cue on the pane's list (as the Sheet has), a pinned `New chat`, or
accepting the scroll.

### D4 — sheets are full-bleed on tablets — **MINOR, recorded**

Every sheet in the matrix — the long-press menu (S15), the move states (S15),
the create form (S16), the milestone editor (S16-detail) and find (S5) — spans
the full tablet width. On `tablet-landscape` (1112 pt) that puts `Open`,
`Move or copy…` and `Approve` at ~1080 pt wide, and the two-line option rows in
the ask cards at a reading measure no tablet layout uses; the app's own
`Dialog` caps at `maxColumnWidth` (640 on this device), so the two sibling
overlay patterns disagree. Frames: `d4-sheet-tablet-landscape.png`. **Recorded,
not changed:** capping `Sheet`'s surface is a component-level decision (it
changes every sheet on every tablet) and belongs with the sheet spec, not a
visual pass. Proposed direction for the owning stream: `max-w-[maxColumnWidth]`
on the sheet surface, bottom-anchored, scrim full-bleed.

### D5 — the docked split shows the host label twice — **MINOR, recorded**

On `tablet-landscape` the conversations panel is docked, and the top-left of
the screen draws the computer label twice, ~55 pt apart (measured text bands at
y 92–109 and y 196–224 device px, 2× — the first in the app header row with the
settings gear at the far right, the second in the pane's own header row with the
search control). Frame: `d5-duplicate-host.png` (crop of
`S4/idle` tablet-landscape, dark). **Recorded, not changed:** which of the two
is the survivor is a product decision (the app header's label also carries the
gear; the pane's label is the switcher that opens `/tunnels` — both are
functional today).

### D6 — "no longer available" under a "loading" badge — **MINOR, recorded**

`S6/populated` (subagent detail) renders the empty state *"This subagent is no
longer available."* while its status badge still reads **loading** — the badge
falls back to `loading` whenever the fetched detail is `null`, and the body is
the `missing` branch, so a failed fetch shows both. Frame:
`d6-subagent-state.png`. This cell is a declared skip in the audit (the build
declares no populated marker for it) and the captured condition may be the
harness's transport rather than a user path; the drill-down flow itself is
covered by `e2e/maestro/flows/06-subagent-drilldown.yaml` in CI. **Recorded:**
the proposed one-liner is `label={detail?.status ?? (missing ? "unavailable" :
"loading")}` in `app/(app)/session/[id]/agent/[jobId].tsx`, for the subagent
stream to take with its own evidence.

### D7 — the find sheet's title is lowercase while its siblings are title case — **NIT, recorded**

`FIND_TITLE = "search"` (`src/features/session/find.ts`) paints a lowercase
sheet title; the menu, create and milestone sheets title-case theirs ("Pin to
the top", "New project", "Add milestone"). It may be deliberate tool-voice; if
not, the copy lane should align it. `d7-find-title.png`.

### D8 — the Android 48 dp floor is unmet on the app's rows, strips, nav and dialog controls — **MAJOR, recorded**

The re-drive's only app-side failure class: 434 `U-01` rows, every one on
`android-compact`, both themes, at 100 % — each a control exactly 44 pt tall
against the audit's 48 dp Android floor (the floor the kit's own `TOUCH_FLOOR`
adopts: "iOS keeps 44, everything else takes 48", `src/ui/layout.ts`). The
families, named from the row ancestry and confirmed on the frames
(`d8-android-floor.png`):

| family | shape | rows |
|---|---|---|
| transcript tool rows + find-sheet result rows | `312x44` buttons | 336 |
| conversations panel footer nav items | `44x44` buttons | 50 |
| session view tasks/subagents strip headers | `360x44` buttons | 30 |
| project-detail dialog buttons (`Delete`, `Remove milestone`) | 44 pt | 10 |
| move sheet / approval card controls | 44 pt | 8 |

**Recorded, not fixed:** these controls are custom pressables carrying the kit's
literal `min-h-11` (44) rather than `TOUCH_FLOOR`; raising them is a kit-wide
density change (list rows, strips, nav, dialog buttons — dozens of call sites)
that belongs to the design stream with its own review, and on the iOS-shaped
surfaces this pass measured they are correct at 44. The asymmetry is the point:
the shared primitives (Button, IconButton, Chip, Segmented, Textarea) **do** take
`TOUCH_FLOOR` — 48 on this web build — so the audit's Android lens sees an app
mixing 48 pt primitives with 44 pt rows. Proposed direction: route the row /
strip / nav / dialog heights through `TOUCH_FLOOR` (one constant, already
platform-split), and decide in the same change whether the web build keeps
rendering 48 for the store screenshots.

### D9 — U-42 flags the dialog's inset-derived margins — **MINOR, recorded (audit-tool gap)**

8 FAIL rows on `iphone-15-landscape`, `S16-detail/delete-confirm` and
`S16-detail/milestone-remove`: "off-scale margin-left/right 59pt". 59 pt is that
device's declared left/right safe-area inset, and the Dialog sets
`marginLeft/marginRight: insets.left/right` deliberately — the comment in
`src/ui/components/dialog.tsx` records why the margin must sit OUTSIDE the
dialog (the scrim band stays full-bleed; padding would shrink the dim). The
check's inset exemption is scoped to `padding-*` (its own words: "A PADDING THAT
IS THE DEVICE'S DECLARED SAFE-AREA INSET IS THE INSET"); the same per-side
reading applies to a margin, so these rows are a tool gap rather than app drift.
Recorded with the proposed one-line extension of that exemption; the audit tool
keeps its own review lane rather than being changed inside a design pass.

## 4. Not covered, and why

- **12 of the harness's 19 device profiles.** This pass captured 7
  (360/390/430 phones, 320 phone, phone landscape, tablet portrait +
  landscape). The foldables, 768-class tablets, tablet-pro and android-large
  profiles are declared by the harness and unmeasured here; they are one
  `--devices` run away, and the pass makes no claim about them.
- **162 declared skips** (108 in run 1, 54 in run 2). These are cells whose
  states this build does not mark, each one named in the manifests: the
  computer cells (S2/S3 populated — discovery reads Radient's account API,
  which the mock relay does not serve), the subagent detail's populated states,
  and the S5 scroll/reserve rows that gate on unshipped hooks. A skip is not a
  pass; it is a hole with a name.
- **Native builds.** The frames are the web build of the shared components
  (react-native-web). iOS/Android rendering rides the Maestro/E2E lane; U-04's
  native half (font scale) is asserted there, not here.
- **Motion.** The three-phase frames exist and the harness reports 885/460
  frames changing after first paint, but no automated check consumes them yet
  (U-13 is unimplemented); this pass judged resting frames, not animations.
- **The composer chips' loading skeleton.** The state exists in code but does
  not occur in any captured cell (the chips render values or are absent).
- **The video player route** (`/session/[id]/video`): reachable only from a
  fixture with a video entry; this matrix drives the transcript's video card,
  not the pushed player screen. Declared here rather than silently absent.

## 5. The audit re-drive (U-checks)

Both runs re-drove every captured cell and measured the DOM behind the frame;
the full reports are the audit tool's own (`audit-report.md`, `audit-report.json`
per run), and §2 carries their tables. The verdicts, verbatim:

- **Run 1** (six devices, 100 %, shared relay): `948 cells, 25131 check rows,
  19447 measured, 442 FAIL, 5684 BLOCKED (0 unmeasurable) · palette loaded` —
  exit 1. The 442 failures are D8 (434) and D9 (8); every other check measured
  clean.
- **Run 2** (iphone-se, 100/135/200 %, its own relay instance): `474 cells,
  12978 check rows, 10206 measured, 0 FAIL, 2772 BLOCKED (0 unmeasurable) ·
  palette loaded` — **verdict PASS**, exit 0.

`BLOCKED` is not a pass — the tool's own line is "a run whose only non-PASS rows
are BLOCKED exits 3". The largest blocked groups are structural: U-04 in run 1
(0 measured — the scale dimension needs two settings in one run, which is why
run 2 exists), U-38/U-39 on cells with no table (888 each), and U-41/U-42's
per-surface scoping. 5684 of run 1's 25131 rows are in that state, and the
report names each one.

**Post-fix re-audit (the fixed cells, final head).** The two fixed surfaces were
re-driven from the tree that merges: `18 cells, 473 check rows, 384 measured,
4 FAIL, 89 BLOCKED (47 unmeasurable)`. **Every one of the 4 FAILs is a D8-class
U-01 row on `android-compact`** (the recorded class, untouched by this pass);
no fixed surface produced a FAIL on any check — in particular no U-07 clipped
text on the header cells and no U-01/U-03 rows on the drawer's skeletons. 23
rows were `state-not-reproduced` because the re-drive's own first cell hit the
same first-load race § 1 describes — the flake reproduces on the harness's
re-drive path, which is why it is described as a run-shape property rather than
a property of any build.

## 6. Teardown

Every process this pass started was reaped by exact pid, and nothing was killed
by name:

- **Both mock relays** — the shared one (pid 76024, port 56783) and the second
  instance run 2's parallel re-drive used (pid 53362, port 51840) — killed by
  pid; both ports verified closed and no `relay.ts` process remains.
- **Headless Chrome** — every capture and audit closed its own instance; both
  audit profiles and every capture profile were removed by their runs, the
  audit's own teardown reporting 0 survivors, and each capture run's line reads
  `0 process(es) left by this run, 0 orphan(s) from earlier runs reaped, 0 live
  owner(s) left alone`. One Chrome instance (pid 4557, started 02:01, before
  this session) was left alone — it is not this pass's.
- **Worktree**: `~/local-operator-mobile-worktrees/design-audit-1011` is
  removed after merge; raw captures and manifests live in this session's
  scratchpad, and only the purposeful frames cited above are committed.
