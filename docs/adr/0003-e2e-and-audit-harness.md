# ADR 0003 — End-to-end and design-audit harness

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-29
- **Deciders:** mobile app maintainers
- **Depends on:** [ADR 0001 — Framework](0001-framework.md), [ADR 0002 — Connection and auth](0002-connection-and-auth.md)
- **Related:** [ADR 0004 — CI/CD](0004-ci-cd.md)

**Provenance.** This document cites documents, vendor pages and file paths rather
than code lines; where it names a file in a code repository, the revision convention
is the one stated in [ADR 0002](0002-connection-and-auth.md) — local-operator
`fc851a94e`, agent-server `dcafe852`, user-console `8597fdba`, expo
`500d25dea3746c8ceeb751b3c55f432b269be410` — resolved with `git show <ref>:<path>`
(or the GitHub contents API for expo), never from a working tree.

## Context

This repository has no Xcode and no Android SDK on the primary development
machine, and the repository's own conventions forbid installing them as a side
effect of a script or test (`AGENTS.md`, "Build host assumptions"). Everything a
maintainer or an agent runs locally has to work with **Node.js, pnpm and the
installed Google Chrome**, and anything that genuinely needs a simulator or an
emulator runs in CI.

At the same time the product is a **live, stateful, real-time client** whose hard
cases are not "does the button render" but:

- a stream that is cut every 60 seconds and must reconnect without visible loss;
- a projection that must survive an epoch change, a reconnect, and an app
  foreground;
- a tunnel that is up while the *computer* is down, and a computer that is up while
  its *relay* is down — two different user-facing states that come from the same
  HTTP status code (ADR 0002, §4);
- a transcript that is dense enough that typography, spacing and colour are part of
  correctness rather than decoration.

Reviewers in this project must audit **design** and **UX** as well as behaviour: a
`designer` pass needs rendered frames in light and dark at phone sizes, and a
`ux-reviewer` pass needs to walk a real flow rather than look at stills. That means
the harness is a deliverable in its own right, not test scaffolding.

### What the harness has to prove

| # | Claim | Evidence that counts |
|---|---|---|
| H1 | The app talks to the real relay contract | A run against a real `lop mobile serve` on an isolated config dir, with captured request/response pairs |
| H2 | Every connection state renders correctly | Mock-relay runs producing a frame per state, in light and dark |
| H3 | Streaming survives the 60-second lease | A long-running stream that crosses ≥ 4 lease cuts with no gap the user can see |
| H4 | The native apps actually build and run | Maestro flows on an iOS simulator and an Android emulator, run in CI, with per-step screenshots |
| H5 | The design system holds | Contrast contract pass, token audit, and frames from the design kit's own register |
| H6 | It is usable without sight and at large text sizes | Accessibility tree assertions, VoiceOver/TalkBack smoke flows, and 200 % text-size frames |

## Decision

A **four-layer harness**, with the layers deliberately unequal in cost:

1. **Unit and component** — `jest-expo` + `@testing-library/react-native` for
   logic, stores, reducers, the SSE framer, the retry envelope, and the connection
   state machine. Fast, local, runs on every push.
2. **Web target** — the app's Expo web export, driven by **installed headless
   Chrome** over the DevTools protocol. This is the local visual and interaction
   harness: it produces frames, runs `axe-core`, and lets an agent without Xcode
   exercise a flow for real.
3. **Mock relay** — a small Node server implementing the relay's documented routes
   with fault injection, plus a **fixture corpus** captured from a real relay. Runs
   in the web target and in the native E2E flows alike.
4. **Native E2E** — **Maestro** flows against built apps on a simulator and an
   emulator, in CI only.

### Layer 2 — web target visual harness

- Build with `npx expo export --platform web` (or `expo start --web` for an
  interactive session) and serve the static output on a loopback port.
- Drive the installed Chrome exactly as the sibling repository's rules require:
  `--headless=new --use-mock-keychain --password-store=basic`, a throwaway profile
  directory, viewport set through CDP
  (`Emulation.setDeviceMetricsOverride`), then kill the browser by the exact pid and
  delete the profile (`~/local-operator/AGENTS.md`, "Capturing a browser surface").
  **No downloaded engine, ever** — no `playwright install`, no bundled Chromium.
- The capture script is a plain Node script using CDP over a WebSocket, so it has
  no dependency beyond `ws`/`node:http` and stays runnable in any environment. It
  owns: viewport, device pixel ratio, colour scheme (light/dark), text scale,
  reduced motion, navigation, a scripted interaction list, and a screenshot per
  step.
- Accessibility: inject `axe-core` into the page and fail on violations of the
  `wcag2a`/`wcag2aa` rule sets, then repeat the run with the OS-level
  "accessibility" flags the RN web target exposes (`aria-*` roles come from the
  same props the native app uses, so this catches missing labels before they reach
  a device).
- The design kit already ships an executable contrast check
  (`~/local-operator-site/docs/design-kit/contrast-contract.mjs`) that recomputes
  every permitted foreground/ground pair from `tokens.json`. Vendor a copy of the
  token file and run the check in CI; a token edit that breaks a permitted pair
  fails the build rather than shipping.

### Layer 3 — mock relay and the fixture corpus

The mock relay is a **first-class artifact** (`tools/mock-relay/`), because the
states that matter most are the ones that are hard to produce on demand:

| Surface | States the mock must reproduce deterministically |
|---|---|
| Session list | empty; one session; many; streaming shimmer; needs-attention badge; running-subagent chip; `degraded`; `ended`; a session whose `activity` label is long |
| Session view | idle; streaming assistant text; thinking; a running tool; a failed tool; a long diff; queued user messages; `stop_reason: aborted`; `cut_off: true`; pending approval; pending ask with options; several pending (`pending_count > 1`); a 400-entry transcript; a transcript at the history boundary |
| Subagents | no subagents; one; a tree with ancestry; a child with its own transcript and history |
| Todos | flat; phased; long phases; empty |
| Past sessions | empty; results; a query with no results; a search error (`degraded`) |
| New session | directory list; recent directories; a start failure |
| Images | an attachment on a user turn; a missing image (404) |
| Transport | clean 60-second lease cuts; a silent stall; `401` + `X-Radient-Login`; edge `503` text; gateway `503` JSON for each `reason`; gateway `502`; `404` unknown host; `429` |
| Connection | no tunnel; tunnel but computer offline; tunnel + computer, relay down; wrong password; expired session |

Mechanics that make it trustworthy:

- **Everything is driven by a scenario file** (name → routes → frames → status →
  timing), so a state is a fixture, not a code path someone has to reproduce.
- **The mock speaks the real wire format**, and its frames are validated against
  the same schema the app validates responses with (ADR 0001's `zod` boundary). A
  mock that drifts from the contract must fail rather than quietly pass.
- **Timings are injectable** (a virtual clock in tests, real time in captures), so
  "streaming then settled" is reproducible rather than flaky.
- **Fixtures are captured, not hand-written, wherever possible**: a script runs
  against a real relay on an isolated config dir and records `projection` frames,
  which are then checked in. A second script re-captures and diffs to detect
  contract drift. The real-relay mode is opt-in and never touches a developer's
  live relay: it uses its own config dir, its own port, its own sessions, and
  synthetic ids (never the operator's live daemon on its default port).

### Layer 4 — native E2E with Maestro

**Maestro** is the choice, for reasons that are about this team rather than about
the tool's absolute merits:

- It pilots the app from outside through the platform's own accessibility tree, so
  it needs **no test build, no instrumentation, no Detox-native dependency**, and
  the same YAML flow runs on iOS and Android
  ([docs.maestro.dev, "Android", read 2026-09-29](https://docs.maestro.dev/get-started/supported-platform/android)).
- `takeScreenshot` per step is a first-class command, which is exactly what the
  design and UX audit rounds need; `launchApp: { clearState: true }` gives a
  reproducible start; `-e`/`--env` parameterises ids and base URLs so one flow set
  covers both platforms and both connection routes.
- It runs in **CI on a macOS runner for iOS and a Linux runner with KVM for
  Android**, and it is Apache-2.0 with an active project (16k stars, releases
  through 2026-09-29).

Rejected alternatives: **Detox** (in-process, requires a native test build and
per-platform configuration that CI must maintain, and its value — synchronisation
with the JS thread — is largely covered by the mock relay's deterministic timings
plus the screenshot matrix); **Appium** (a driver-server topology with more moving
parts than this project wants, for no capability we need); **Patrol** (a Flutter
ecosystem tool; not applicable to ADR 0001's stack).

The flows are **few and high-value**: sign-in (against the mock edge), connect to a
mock relay, list, open, stream, answer an approval, send a steer, open a subagent,
search and resume, switch model, log out. Everything else is cheaper to cover in
layers 1–3, and a large Maestro suite on emulators is the classic way a mobile repo
gets a 40-minute CI.

**CI wiring and cost** are specified in [ADR 0004](0004-ci-cd.md): screenshot
artifacts, per-flow logs, and a retry policy of exactly one re-run (a second
failure is a failure).

### Accessibility and large text

Accessibility is checked mechanically where it can be, and by a named reviewer
where it cannot:

- **Token contrast** is the design kit's own contract: `contrast-contract.mjs`
  recomputes every permitted foreground/ground pair from `tokens.json` and fails on
  a violation (`~/local-operator-site/docs/design-kit/tokens.md`, §1). The app's
  generated theme file is derived from the same source, so the contract runs in CI
  against the generated artefact, not the source it came from.
- **Labels are real, not decoration.** Every interactive element carries an
  `accessibilityRole`, a label, and an `accessibilityIdentifier`. The identifiers
  are the Maestro selectors, so a control without one cannot be tested — the test
  suite is what enforces the convention. Streaming regions use
  `accessibilityLiveRegion="polite"` and announce a *state change* ("streaming
  finished"), never every token.
- **Web target floor:** inject `axe-core` through CDP (`Runtime.evaluate`) into the
  exported web build at each matrix state and fail on serious/critical violations.
  This is a floor for the web render, not a claim about the native render.
- **Large text:** the matrix's 200 % text-scale dimension is the check that matters
  most for this UI — a transcript row that clips a tool result at 200 % is a defect,
  and it is the failure mode a phone user is most likely to hit.
- **Reduced motion:** when `AccessibilityInfo.isReduceMotionEnabled()` is true, the
  shimmer and settle animations are disabled; a flow asserts the reduced-motion
  render matches the settled frame.
- **VoiceOver / TalkBack walkthrough:** one named flow (sign-in → list → session →
  answer an approval) is walked with a screen reader on a real device by the
  ux-reviewer as part of the interaction round, and the findings are `U`-prefixed
  on the pull request.

### The screenshot matrix

The matrix is the interface between the harness and the audit rounds. It is
generated, not curated, and its dimensions are:

| Dimension | Values |
|---|---|
| Device | small phone (320 pt class), current iPhone, large iPhone, Android phone, 7-inch tablet |
| Theme | light, dark |
| Text scale | default, 200 % |
| Orientation | portrait (landscape only for tablet/foldable checks) |
| State | the scenario list in layer 3, restricted to what the change touches + its neighbours |

Naming is `screen__state__device__theme__scale.png`, so a diff tool can pair a
before-frame with an after-frame. Proposals for what a change must capture:

- A visual change captures **before and after**, light and dark, at the phone size
  where the change lives.
- A layout change that can wrap captures **both text scales**.
- A stateful or animated change captures **consecutive frames** (first paint and
  settled), because a first frame that differs from the settled frame is motion the
  user sees whether or not it was intended.
- Frames go on the pull request (and into CI artifacts), **never into the
  repository**.

### What the harness is not

- It is not a substitute for the QA pass on a real device against a real relay.
- It does not attempt to test the tunnel edge itself; that is Radient's surface,
  and our rule is to keep the app compatible with the documented contract and add
  a compatibility test when the contract changes (ADR 0002, §7 S7).
- It does not gate on visual-regression diffing at v1. Pixel diffing on mobile is a
  maintenance tax, and the audit rounds require a human/agent *looking*; tolerance
  thresholds can be added once the frames are stable for a few weeks.

## Consequences

**Positive**

- Every claim in the *What the harness has to prove* table has a named, cheap
  artifact — and four of the six run without Xcode.
- Design and UX rounds have a repeatable source of frames, so their findings are
  comparable across rounds instead of "here is a screenshot I took once".
- The mock relay becomes the fastest way to develop any connection state, which
  makes the hard states (degraded, cut-off, re-minted session) routine to build
  against.

**Negative**

- A second implementation of the relay's wire format exists (the mock), and it can
  drift. The schema-validation rule and the capture-and-diff script are what keep
  that honest; both are required, not optional.
- Maestro cannot drive a *real* browser-session sign-in (it cannot type into the
  system browser), so the sign-in flow is covered against a mock edge and by hand
  on a real tunnel — that gap is real and should be stated in the QA report rather
  than papered over.
- Emulator-based flows in CI are the slowest and most flake-prone part of the
  pipeline; they are therefore limited to the high-value flow set and the release
  gate rather than every push.

## Open risks

| Risk | Mitigation |
|---|---|
| iOS simulator availability on GitHub's macOS runners drifts with Xcode releases | Pin the runner image and the simulator device by name in the workflow; treat a missing simulator as a CI configuration bug with its own fix commit |
| Android emulator flakiness on Linux runners | Boot once per job, cache the AVD, use a hardware-accelerated profile, and allow exactly one retry |
| Mock drift | Zod validation of every mock response against the app's own schemas + the re-capture diff job |
| Screenshot sprawl in CI storage | Retention limit on artifacts (30 days) and per-scenario pruning as scenarios merge |
| A state nothing reproduces ("it only happens on my tunnel") | Every such report becomes a scenario in the mock relay as part of the fix, or the fix is not complete |

## What would change this decision

- **Maestro's iOS support lagging a required iOS version** (its documentation has
  historically trailed new API levels) would push the iOS native layer to
  XCUITest-driven flows on the simulator, or to web-target coverage plus manual
  device checks. Evidence: a flow that cannot launch on the current simulator.
- **The web target diverging from native** (Uniwind classes compiling to visibly
  different results on web and native) would demote layer 2 to a smoke harness and
  move the visual matrix into layer 4, at a large CI cost.
- **A Flutter or Compose stack** (ADR 0001 reversed) would replace layer 4 with
  `integration_test`/Patrol and delete the web target, since neither renders
  Tailwind's register on the web the same way.
