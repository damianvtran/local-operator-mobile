# Short-portrait conversation rows at ordinary text sizes

This evidence covers a bounded change to the existing pinned-footer policy, not
a Team Bridge launch, native iOS certification, or full audit approval.

## Reproduction and source

Base: `9bc0e961f037fb16973c6a8f076839ca1d7308d9`.
The ordinary UI in proof PR147 at `602012cc` is identical in the relevant pane/
policy paths. Its normal hosted capture (job124721644358, artifact13068131406)
reported a zero-height list at SE320×568/100% and135%; the larger200% setting
already used the scroller. [Actual CI before frame](before-ci-100.png).

| Scale | Before list client / visible rows | After local list client / visible rows |
|---|---|---|
|100%|0px /0|448px /1|
|135%|0px /0|448px /1|
|200%|428px /1|448px /1|

The CI pane had a20px top environment inset; this browser fixture has zero
native environment inset (its declared probe variables still say20). The list
top therefore differs140→120px. These are **not pixel-identical environments**.
The evidence establishes visible rows and reachability, not identical dimensions
across environments.

## Why the change is bounded

The existing route-height floor already selects one footer placement before
first paint. Previously ordinary text returned early without consulting that
budget, although a richer footer's caption/status still exhausted the pane.
Six/seven-route footers now use the existing conservative628/688px floors at
ordinary text too. Ordinary five-route behavior, split panes, landscape and
roomy controls retain their prior behavior. There is no second scroller, target/
font shrink, min-height overlay, capture-ID exception or post-paint toggle.

Three `src` files change; their exact identities are in
[the rendered receipt](rendered-receipt.json). The deliberately reviewed595-file
source digest moves from `7421f2e1d211b5b6be8f0eb9deade886507b2aa1038f10fe132a82a4d0b22740`
to `038d73efc89fc41f7a4e19567d7929b9ec70a526a1c27e27d8dde80da89eff5d`.
No corpus selector, historical pin, instrument pin or audit threshold changes.

## Actual rendered frames

Dark: [100%](after-requested-dark-100.png),
[135%](after-requested-dark-135.png), [200%](after-requested-dark-200.png).

Genuine Light: [100%](after-genuine-light-100.png),
[135%](after-genuine-light-135.png), [200%](after-genuine-light-200.png),
[contact sheet](genuine-light-contact.png),
[actual Settings selection](actual-settings-light.png).

**Failed first Light attempt retained honestly:** files named
`after-requested-light-*` actually painted dark. The query/probe label was not
appearance proof. The follow-up used the browser tool to click the application's
actual Settings→Appearance→Light control, then Settings Back→Open conversations
in the **same document**, at each scale. Actual canvas is `rgb(242,237,227)`;
root CSS `color-scheme` still reports OS-dark. The approval basis is the actual
selected application theme and pixels, not that OS label. The original invalid
attempt is not recast as valid Light evidence.

[100% move](direct-move-100.png), [135% move](direct-move-135.png), and
[footer→Sign in gate](direct-footer-gate-100.png) were exercised through direct
browser `iframe >>>` selectors on the actual row, confirm, close and Team Bridge
controls. Fixture probes/scenario setup remain assisted; this is not native
input/gesture proof. Menu/tags and complete200% traversal were not covered by
this bounded lease. Consecutive dark100% and genuine-Light200% screenshots were
pixel-identical after settling.

The app was exported once successfully with one Metro worker from the recorded
source. Its compiled entry SHA256 is
`e5bb37000cd591f70edaa789f0694ac65b966966c11d3a855c74255b33588f5b`.
A prior default-worker attempt exceeded its enforced2GiB group budget and failed;
that is not counted as success. No dependency installation, custom browser
engine, native SDK, operator account or live hub was used. The browser tool ran
one inactive owned tab; existing socket-relay fixtures and existing pre-paint/
measurement probes supplied synthetic data. The wrapper frames the real app at
320×568; crops use measured iframe bounds, not reconstructed UI.

## Executed validation and review limits

- Failing-first policy regression: actual `false` versus expected `true`.
- Final focused size-class suite: **51/51 PASS**; app `tsc --noEmit` exit0.
- Scoped Biome:0 issues after a disclosed wrapping-only formatting correction.
- Actual content-identity CLI: `U08 content identity matches the pinned baseline`,
  exit0 on2026-11-01T21:01:19Z. Source inclusion/negative guards remain intact.
- Independent source, recorded QA, and design/UX reviews inspected supplied
  pixels/identities. The initial Light evidence finding was retained, remediated
  and reviewed in the same bounded round. These are scoped reviews, not full CI.
- Both owned fixture leases ended normally: browser closed first, authenticated
  own stop control called normal server/relay closure, receipt errors empty,
  recorded ports refused connections and the observed owned PID exited. No
  process signals or cancellation fallback was used.

Fresh committed-head review/comment binding and required hosted CI remain separate.
No live APNs/FCM receipt, native six-phase proof, same-environment full matrix,
merge, deployment, feature-flag change or App Store release is claimed here.
