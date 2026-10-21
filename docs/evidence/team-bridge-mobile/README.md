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
size-class/S15-flow/S15-proof tests and app TypeScript passed. **Rendered after
geometry/interaction evidence and refreshed design/QA are still pending normal
PR CI.** The browser host is unavailable; no alternate engine or local export
was started. The existing targeted S15 workflow omits the affected iPhone SE,
so it was not dispatched as a misleading substitute for the required capture.
