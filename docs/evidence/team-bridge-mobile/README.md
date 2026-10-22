# Team Bridge mobile — browser evidence

All images use placeholder identities and a synthetic-token HTTP hub, never a
real account. These are the **actual Expo/React Native web app**, not rendered
mockups. They are not native screenshots or APNs/FCM receipt evidence.

## Initial review frames

Source reviewed: `309f7a170a67727ec5275ed690735857109a2c68`.
Independent designer used the harness browser tool, real 390×844 iframe viewport
(also 320×844 narrow probes), light and dark. The wrapper scales its display to
fit the browser host without changing the iframe's layout viewport. Native
simulator/SDK absence is documented in `../../team-bridge.md`.

- [Light gates/list states](before-light-states.png)
- [Dark gates/list states](before-dark-states.png)
- [Thread states](before-thread-states.png)
- [People and chiefs of staff](before-lower-sections.png)
- [Cold vs warm identity defect, before remediation](before-cold-vs-warm.png)

The initial design round found cold-entry directory hydration missing (D1).
Code review separately found lifecycle/read/paging issues, and independent
browser QA reproduced create-on-first-send and preference changes. Their PR
comments are the evidence ledger, not an implication these frames approve a
later head.

## Geometry and honest limits

Measured initial viewport/root: 390×844; rows68px, buttons48px; narrow root320px
without horizontal expansion. The fixture's visible DOM geometry report uses
its own same-origin iframe and the browser tool, not a separate browser engine.
No native keyboard, notification shade, OS delivery or real OAuth interaction is
claimed. A fixture request-abort crash interrupted the initial QA session; the
mock's cancellation boundary was fixed and the independent QA retried the
interrupted preference cases successfully.

## Remediation after frames

Fresh export at `15f1e5bc112c526f4ff0fefae8f65834e690bf6d`, web entry
`entry-b0de988dfa49ba2fe6c6bc9959f79b8a.js`:

- [Cold/warm after gallery, light/dark390 and dark320](after-cold-warm-gallery.png)
- [Cold-entry before/after comparison](cold-entry-before-after.png)

The independent designer opened and inspected these frames and posted terminal
scoped design round2. Cold/direct and list entry now both resolve Ada/AD and
Aida (Ben). Consecutive sampled phone crops were byte/pixel stable (0 changed
pixels of740610 at390,607680 at320). The independent browser QA round2 also
verified self has no borrowed unread, first/second sends share one created DM,
and notification preference changes persist across closing/reopening the sheet.

Subsequent OAuth/push retirement-only changes do not alter the leaf list/thread
layout or message rendering; these frames do not claim native or provider
behaviour. Before frames remain labelled before, not current-head proof.

## Follow-up: compact large-text navigation

The required web capture at `4dd8d0f6c8e45b8dd324a3ea1bc0621b5f476280`
(job119395910829) exposed a conversation-panel regression at320×568 /200%:
its pinned secondary navigation consumed the list. This is evidence from the
existing CI artifact, not a new local browser or native screenshot.

- [Actual failing frame](navigation-large-text-before.png)
- [Sanitized measured geometry and frame identity](navigation-large-text-before.json)

Measured pane568px high /264px wide, footer449.78125px high, list client height0,
visible rows0. The fix extends the existing shared-footer scroller policy to
compact large text, using the existing `LARGE_TEXT_SCALE` threshold. It does not
shrink text/targets, create another scroller or weaken the capture witness.
Normal-scale portrait and roomy tablet policy remain unchanged.

The policy test was observed failing before the fix, then the44 affected
size-class/S15-flow/S15-proof tests and app TypeScript passed. The existing
targeted S15 workflow omits the affected iPhone SE, so it was not dispatched as
a misleading substitute for the required capture.

### Actual after capture and interaction receipts

The normal CI capture at `6b12c68f32807c53ed243bf2f9a7f9e519a47b90`
(run39659627289/job119434268809/artifact12380152570) completed successfully:
1128 cells, zero unmeasurable cells. The later rubric phase failed8 U-08 rows;
that failure is not concealed or called a green end-to-end gate.

- Paired [dark before](navigation-large-text-before.png) /
  [dark after](navigation-large-text-after-dark.png), and
  [light before](navigation-large-text-before-light.png) /
  [light after](navigation-large-text-after-light.png).
- [After geometry](navigation-large-text-after-geometry.json): list client
  height**444px**, visible rows**1**, versus**0px/0** before. Same320×568,
  200%, pane width264px and footer height449.78125px.
- Consecutive [dark first](navigation-large-text-dark-f0.png),
  [250ms](navigation-large-text-dark-f250.png),
  [settled](navigation-large-text-after-dark.png), and
  [light first](navigation-large-text-light-f0.png),
  [250ms](navigation-large-text-light-f250.png),
  [settled](navigation-large-text-after-light.png). First frames are the app's
  bootstrap, not presented as ready. The light250ms/settled pixels are identical;
  dark differs only at one vertical boundary pixel column, not a content reflow.
- [276 sanitized S15 records](navigation-large-text-after-witnesses.json)
  preserve source/job/frame identity and actual opener outcomes. SE200% menu,
  move, tags-menu and tags-sheet actions succeeded; tag rows required actual
  scrolling, not an identical-chrome capture exception.
- [Live footer reachability](navigation-footer-live-proof.json): a briefly
  recovered browser host ran the exact CI `web-export` artifact12372933761, not
  a new local build. The same-origin320×568 iframe and transparent wrapper
  controls forward normal app handlers. Actual list scroll top610.5/client464/
  content1074 exposed the Team Bridge control (hit-test confirmed), and its
  real handler opened `/team-bridge` with the signed-out Sign in gate. This
  browser has zero safe-area insets rather than CI's20px top inset, so its
  geometry is separately labelled. The host disconnected after this receipt;
  the final gate screenshot could not be captured. The owned tab closed and
  fixture/diagnostic services stopped. No native or provider-push claim.

### G1: the remaining U-08 checker defect, not a tolerance relaxation

All8 CI failures concern the same two selector pairs under the move-progress
sheet (SE, dark/light,135%/200% labels). The older checker tested a separator
against the pair's **layout** intersection, but tested the final overlap using
**painted/clipped** boxes. This mixes coordinate policies: a sheet need not cover
pixels that neither member can paint outside the viewport.

[Actual browser frame](navigation-modal-actual-browser.png) and
[four unchanged actual DOM nodes](navigation-modal-actual-dom.json) provide a
concrete counterexample on that same-head app, not only a synthetic unit case:

- Row153 layout ends at625px; Moving label224 layout ends at591px. Their
  layout intersection extends to591px, below the opaque sheet212's568px edge.
  Their **painted** intersection is230×120 at(17,447), ending at567px and wholly
  inside that opaque sheet (0,370,320,198), which belongs only to label224.
- Timestamp161 similarly has a32×28 painted intersection wholly covered by
  sheet212. The old rule produced2 failures on this actual DOM; the corrected
  rule produces0 and explicitly records modal-surface coverage.
- These macOS/zero-inset measurements differ from Linux CI's230×108/32×8;
  they are not called a pixel-identical CI replay or proof that all8 CI rows
  have disappeared. A fresh normal CI run remains required.

The repair uses the **existing `paintedBox` helper on both pair members** before
separator coverage. Opacity, exactly-one-subtree membership, modal declaration,
thresholds and reporting stay unchanged. Narrow or transparent separators,
shared ancestors and uncovered same-dialog controls still fail. Null/disjoint
paint retains the existing gates.

Observed actual-DOM RED on the6b12 checker: the new fixture test failed with the
same two path pairs. Restoring the repair gives**83/83** focused checker/geometry
tests passing, including the actual DOM and negative controls; real tools
TypeScript passes. Scoped Biome reports0 errors and18 existing warnings. The
checker change requires explicit independent review; a prior code approval and
the old browser canary are not claimed to approve this new gate. Refreshed
navigation design/QA and the new normal CI verdict remain pending.
