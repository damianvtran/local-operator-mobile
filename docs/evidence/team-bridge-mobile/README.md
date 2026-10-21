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

After/remediation captures are added and identified separately after a fresh
export. Do not label before frames as current-head proof.
