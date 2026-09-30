# ADR 0001 — App framework and styling stack

- **Status:** Proposed (for implementation)
- **Date:** 2026-09-29
- **Deciders:** Local Operator Mobile maintainers
- **Supersedes:** none
- **Related:** [ADR 0002 — Connection and authentication](0002-connection-and-auth.md), [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md), [ADR 0004 — CI/CD](0004-ci-cd.md)

## Context

Local Operator Mobile is a **native iOS and Android client** for the `lop mobile`
relay that ships with Local Operator (`relay` below). It is a public, MIT-licensed
repository, written for a small team of maintainers and coding agents, and it must
be buildable and testable **without a local Xcode or Android SDK** — neither is
installable on the primary development machine, and CI has to carry the native
builds.

What the app has to do, in the order the constraint binds:

1. **Hold one long-lived authenticated session against a remote HTTP+SSE API** —
   the relay deliberately speaks HTTP and Server-Sent Events, never WebSocket
   (`~/local-operator/docs/mobile.md`, "Security invariants"), pushes whole
   snapshots rather than deltas, and sits behind an identity proxy that cuts any
   stream at 60 seconds (`~/local-operator/local_operator/tunnels/gateway.py:34`,
   `MAX_STREAM_SECONDS = 60`). The client must therefore stream responses
   incrementally, reconnect at least every minute, and re-render a full projection
   on every push.
2. **Send custom request headers**, including `Cookie` and `Origin`, on the same
   requests that stream. The Radient tunnel edge rejects a mutation whose `Origin`
   is not the tunnel origin and forwards a per-request assertion
   (`~/radient-ml/agent-server/edge/tunnel-worker/src/index.ts:122-131`, `:246-259`),
   and the relay itself rejects a cross-origin mutation
   (`~/local-operator/local_operator/mobile/daemon.py:2334-2355`).
3. **Do browser-based sign-in**, because the identity providers behind Radient
   (Google, Microsoft) block embedded WebViews — sign-in must run in the system
   browser session (`ASWebAuthenticationSession` on iOS, Chrome Custom Tabs on
   Android), never in a WebView.
4. **Store two secrets at rest** — an opaque 30-day tunnel-session refresh token
   and a rolling 90-day Radient OAuth refresh token — in the platform keystore.
5. **Render a dense, text-heavy, real-time UI** (transcripts of markdown, tool
   rows with diffs, subagent trees, todo lists, streaming text) in the register of
   the Local Operator design kit, i.e. Tailwind-style utility classes over a token
   set that already exists (`~/local-operator-site/docs/design-kit/tokens.json`).
6. **Ship to the App Store and Google Play** through CI, with a realistic story for
   end-to-end tests that produce screenshots, and with a path to push
   notifications and over-the-air JS updates later.

Two organisational constraints matter as much as the technical ones. First, the
team already writes React 19 + TypeScript + Tailwind v4 and has a working
reference client for this exact protocol (the relay's own web client, ~11k lines
under `~/local-operator/local_operator/mobile/web/src`, including a store, an SSE
wrapper, and a transcript renderer). Second, the design kit is Tailwind-v4-shaped
(`@theme` roles such as `bg-surface`, `text-ink-muted`, `border-control`), and the
sibling repos pin Tailwind `4.3.3`.

### Criteria, in priority order

| # | Criterion | Why it is weighted here |
|---|---|---|
| C1 | Android **and** iOS from one codebase, plus a **web build** for local iteration and visual audits | The team cannot build native locally; a web target is the only way an agent without Xcode can render a real frame |
| C2 | Streaming HTTP with custom headers and abort, in the framework's own client | The whole product is one long stream |
| C3 | Tailwind-class styling and shadcn-style components | The design system is already Tailwind v4 tokens; a second styling language is a permanent tax |
| C4 | Reuse of the team's React/TS skills and of existing client logic | The relay contract, fixtures, and renderers already exist in TS |
| C5 | System-browser auth session + platform keystore | Non-negotiable for Google/Microsoft sign-in and for token storage |
| C6 | Native builds and E2E in CI without local Xcode/Android SDK | The primary machine has neither (`AGENTS.md`, "Build host assumptions") |
| C7 | Background/notification future, OTA updates, store-policy fit | The roadmap says push notifications and fast fixes matter |
| C8 | Community health, licence, and long-term maintainability | Public OSS repo; every dependency is a commitment |

Versions below were read on **2026-09-29** from the npm registry and from project
sites; anything that moves monthly (SDK minors, toolchain) is quoted with the date
it was read.

## Options

### A. Expo / React Native (SDK 57, React Native 0.86.3, React 19.2)

Expo SDK 57 is the current stable (announced 2026-06-30; `expo@57.0.26` published
2026-09-29), built on React Native 0.86.3 — the second of React Native's
"non-breaking" releases — with React 19.2 and Hermes V1. Expo SDK 58 entered beta
on 2026-09-15 (React Native 0.88 RC, iOS 27 SDK support, native tabs and Expo UI
for SwiftUI/Compose), so the stable line has a clear upgrade path and a
predictable cadence
([SDK 57](https://expo.dev/changelog/sdk-57), [SDK 58 beta](https://expo.dev/changelog/sdk-58-beta),
[RN releases](https://reactnative.dev/releases/overview)).

Against the criteria:

- **C1/C2** — `expo/fetch` is a WinterCG `fetch` with a real streaming body
  (`resp.body.getReader()`), custom headers, and `AbortSignal`; since SDK 57 it is
  installed as the global `fetch` on Android and iOS, and it is the only client
  covered by the relay's own upgrade path
  ([expo/fetch docs](https://docs.expo.dev/versions/latest/sdk/expo/), read 2026-09-29).
  Critically for this app, its native implementations expose an exact cookie
  policy: with `credentials: 'omit'` iOS sets `httpShouldHandleCookies = false` and
  Android installs `CookieJar.NO_COOKIES`
  (`packages/expo/ios/Expo/Fetch/ExpoURLSessionTask.swift:28-35`,
  `packages/expo/android/src/main/java/expo/modules/fetch/NativeRequest.kt:41-43`),
  so the client can own the `Cookie` header itself instead of fighting a cookie
  jar. Expo also ships a web target (`expo export --platform web`) that runs on
  React Native Web.
- **C3** — Tailwind-for-React-Native is a solved, competitive space on this stack
  (see the styling decision below).
- **C4** — highest of any option: the protocol types, the SSE reconnect wrapper
  (`web/src/store.ts:109-160`), the defensive normalisation (`store.ts:57-71`) and
  the markdown/tool-row renderers are all TypeScript already.
- **C5** — first-party modules: `expo-web-browser` (`openAuthSessionAsync` →
  `ASWebAuthenticationSession` on iOS, Custom Tabs on Android),
  `expo-crypto` for PKCE, `expo-secure-store` for Keychain/Keystore
  ([WebBrowser](https://docs.expo.dev/versions/latest/sdk/webbrowser/),
  [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore.md), read 2026-09-29).
- **C6** — no Xcode needed locally: `npx expo prebuild` + EAS Build or plain
  `xcodebuild`/Gradle in CI. Development builds (`expo-dev-client`) are the
  intended local device path; note Expo Go now requires a login
  ([changelog](https://expo.dev/changelog/expo-go-57-login), 2026-09-03) and is
  explicitly not recommended for production apps, so device testing uses dev builds.
- **C7** — `expo-notifications`, `expo-updates` (OTA JS updates), `expo-app-intents`
  (Siri/Shortcuts, SDK 58 alpha), and a documented `expo prebuild` path for native
  modules we later need (e.g. Android Auth Tab, see ADR 0002).
- **C8** — the largest ecosystem of any option here on mobile UI; MIT-licensed
  core; but note Expo tooling requires **Node 22.13+/24.3+** and EAS builds carry
  a free-tier ceiling (below).

Weaknesses to accept: a JavaScript bundle and a bridge (no true native text
rendering for very long transcripts); Android Custom Tabs cannot be dismissed
programmatically from `expo-web-browser` (`src/WebBrowser.ts:404-407`: "We can't
dismiss the browser on Android… users need to manually press the 'x' button");
and the Expo SDK release train (3–4 releases a year) is a recurring upgrade cost.

### B. Flutter (3.47.5 stable, 2026-09-18; Dart 3.13.4)

Flutter has the strongest out-of-the-box rendering story of the group and an
excellent E2E story (`integration_test` + `flutter drive`, `patrol`), plus a mature
tablet/desktop story.

Against the criteria: **C3 and C4 fail**. Flutter has no Tailwind: styling is Dart
widgets and `ThemeData`, so the design kit would be re-expressed as a Dart theme
system, and the existing TypeScript protocol/rendering work would be rewritten in
Dart. **C2 is workable but has no first-party answer** for SSE on the client
(`http` supports streamed responses; SSE framing is hand-rolled or a package such
as `flutter_client_sse`). **C7**: OTA for Flutter means a paid third-party patcher
(Shorebird). **C6** is good (CI builds fine) but local iteration needs the Flutter
SDK on the machine, which the team does not have today. Verdict: rejected — it buys
rendering quality we do not need at the cost of the two criteria we care most about.

### C. Kotlin / Compose Multiplatform (1.12.0, 2026-08; Kotlin 2.4.0)

Compose for iOS has been stable since 1.8.0 (May 2025) and 1.12.0 is current, so
this is a genuinely first-class native option with excellent performance and a real
native feel.

Against the criteria: **C3 and C4 fail** (no Tailwind; every line is new Kotlin,
and the protocol types are mirrored by hand or by codegen). **C6** is the worst of
the group: local iteration and even CI setup need a JDK, Android SDK, and Xcode —
the harness rules explicitly forbid installing those on the development machine,
and GitHub runners would need a full Android+Gradle+macOS toolchain per job.
Verdict: rejected for this team even though the runtime is the closest to
"native" of all options.

### D. Capacitor / Ionic (@capacitor/core 8.5.2)

The fastest possible path to parity: wrap the existing relay web client
(`~/local-operator/local_operator/mobile/web`) in a native shell, or ship a new
Vite app against the same API. Reuses 100% of existing TS and Tailwind.

Against the criteria: **C1 is partial** — it is one WebView, not a native UI, and
the program's explicit goal is a *redesigned, better native* client; a WebView
shell is a repackaged website, which is exactly the shape App Store guideline 4.2
("Minimum Functionality") is aimed at
([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), read 2026-09-29).
**C5/C7** are the real blockers: cookie and header control inside WKWebView requires
URLProtocol/ATS shims for the `Origin` header the tunnel edge demands, and WKWebView
cannot be given the tunnel's `__Host-` grant cookie without a native data-store
hand-off; background work and notifications are second-class. Verdict: rejected as
the primary path. It is, however, the right *emergency* fallback and a good
secondary deliverable (see "Consequences"): an installable PWA over the same
contract can be shipped from this repository with no store review at all.

### E. Tauri 2 mobile (2.12.0)

Tauri 2 on iOS/Android also renders a WebView for the UI, so it inherits D's UI
constraints, but its Rust core can make HTTP requests with arbitrary headers
(`tauri-plugin-http`) — which solves the header problem Capacitor has. It adds a
Rust toolchain and a second language to a TypeScript team, and iOS builds still
require Xcode in CI, and it has the smallest share of the four non-webview options.
Verdict: rejected — the same UI answer as D with a higher tooling cost.

### F. .NET MAUI 10

MAUI 10 shipped with .NET 10 (GA November 2025) and is supported and documented;
the Blazor Hybrid mode would let the team reuse web code.

Against the criteria: **C3/C4 fail** (XAML/C#, no Tailwind); **C6** requires a full
.NET mobile toolchain plus Xcode/Android SDK in CI; community size on mobile is
the smallest here. Verdict: rejected.

### G. Lynx (@lynx-js/react 0.126.2)

ByteDance's framework renders native UI from React with real CSS and a dual-thread
architecture, and it is production-proven inside TikTok. In 2026 its third-party
ecosystem is still thin — few community libraries, limited documentation, and few
hires; the 2026 roadmap is still adding "production-ready UI components"
([Lynx roadmap 2026](https://lynxjs.org/next/blog/lynx-open-source-roadmap-2026),
read 2026-09-29). Against the criteria: **C3 is a poor fit in practice** (CSS is
real but there is no Tailwind toolchain, no shadcn-equivalent, no
`lucide`/`radix`-style component layer), **C5/C7** have no mature answer for
ASWebAuthenticationSession-class flows, secure storage, or OTA, and **C8** is the
weakest. Verdict: rejected for v1; worth re-evaluating in 12 months.

### H. NativeScript 9.1.2

Real native UI with JS/TS, and unlike RN it has a direct native API surface. It
supports Tailwind through the NativeWind-derived `@nativescript/tailwind`, but on
Tailwind v3 semantics, with a much smaller component ecosystem and fewer
maintainers. **C4** is partial (TS, but none of the RN/React component work
transfers), **C8** is materially weaker than Expo's. Verdict: rejected — the
closest alternative to A on the styling criterion, but not close enough to justify
giving up the ecosystem.

### I. PWA only

All of the above can be complemented, not replaced, by a web build. A PWA is
genuinely attractive here: no store review, the existing web client already works
against the relay, and it is the fastest way to reach a phone. It fails the
program's stated goal (a native client) and has real gaps against the relay's
contract: iOS Safari cannot hold a background SSE reliably, there is no push
without a service worker plus APNs (web push on iOS is available but tied to
"installed web apps" and user gesture), and the tunnel's cookie story is browser-
managed. Verdict: not the product, but ship it as a by-product (Consequences).

## Decision

**Adopt Expo SDK 57 / React Native 0.86.3 / React 19.2 in TypeScript, with Expo
Router for navigation, Uniwind (Tailwind v4) for styling, components adapted from
react-native-reusables, and the Local Operator design kit's tokens as the single
source of colour, type and spacing.**

### Pinned stack (verified 2026-09-29)

| Concern | Choice | Version |
|---|---|---|
| Runtime | `expo` (SDK 57), `react-native`, `react` | 57.0.26 / 0.86.3 / 19.2 |
| Language | `typescript` | 7.0.2 |
| Package manager | `pnpm` (matches `~/local-operator` web workspace) | 11.22.0 |
| Navigation | `expo-router` (typed routes, native tabs) | 57.0.24 |
| HTTP/streaming | `expo/fetch` (global `fetch` on native) | bundled with `expo` |
| SSE framing | `eventsource-parser` (pure TS, no DOM) | 4.1.1 |
| Styling | `uniwind` (MIT, Tailwind v4, CSS-first `@theme`) + `tailwindcss` | 1.12.0 / 4.3.3 |
| Class utilities | `clsx`, `class-variance-authority`, `tailwind-merge` | 2.1.x / 0.7.1 / 3.7.0 |
| Components | react-native-reusables registry (vendored source, MIT) via `@react-native-reusables/cli`; Radix-style primitives from `@rn-primitives/*` | CLI 0.7.1 / primitives 1.5.x |
| Icons | `lucide-react-native` + `react-native-svg` | 1.49.0 / 15.15.5 |
| Client state | `zustand` (same choice as `~/local-operator-ui` and the site) | 5.0.15 |
| Validation | `zod` at the relay boundary | 4.6.5 |
| Lists | `@shopify/flash-list` (transcript, subagent trees) | 2.3.2 |
| Auth session | `expo-web-browser` (+ `expo-crypto` for PKCE S256) | 57.0.3 / 57.0.3 |
| Secrets at rest | `expo-secure-store` | 57.0.4 |
| Deep links / diagnostics | `expo-linking`, `expo-application`, `expo-file-system` | 57.0.x |
| Notifications (later) | `expo-notifications` | 57.0.21 |
| OTA (later, see ADR 0004) | `expo-updates` | 57.0.24 |
| Unit tests | `jest-expo` + `@testing-library/react-native` | 57.0.5 / 14.0.1 |
| Lint/format | `@biomejs/biome` (same tool as the sibling JS repos) | 2.5.14 |
| Native E2E | Maestro CLI | 2.11.0 |

Markdown rendering: use a small tokenizer feeding our own components rather than a
full RN markdown library, because the transcript's typography and tool/diff rows
are part of the design contract and the web client already renders them that way
(`web/src/components/markdown.tsx`, `tool-row.tsx`). Pin the tokenizer's major at
implementation time.

### Styling sub-decision

Three candidates were weighed against the design kit:

1. **NativeWind v4** (`4.2.7`, stable) — Tailwind **v3** semantics; v5
   (`5.0.0-rc.0`) is a release candidate whose own docs say it "is not intended for
   production use" ([nativewind.dev/v5](https://www.nativewind.dev/v5), read
   2026-09-29). Choosing v4 means re-expressing the design kit's v4 tokens as a
   v3 config; choosing v5 means shipping on an RC.
2. **Uniwind** (`1.12.0`, MIT) — Tailwind **v4** with `@theme`, CSS variables,
   media queries, dark mode; positioned as a drop-in replacement for NativeWind,
   and react-native-reusables documents it as a supported styling backend; the
   maintainers are the Unistyles authors, and the changelog tracks React Native
   releases (1.11.0 added RN 0.87 compatibility). Pro is an optional paid native
   engine; the free package is what we use.
3. **Tamagui (`2.7.7`) / gluestack (`5.0.15`) / HeroUI Native (`1.0.10`)** — full
   design systems, each with its own token and theming model. They would replace
   the design kit rather than implement it, and each locks the component layer to
   one vendor.

**Decision:** Uniwind + react-native-reusables-style vendored components, with the
token layer generated from `design-kit/tokens.json` into a `uniwind.css`
`@theme` block, so `bg-surface` / `text-ink-muted` / `border-control` mean exactly
what they mean on the web surfaces. **Fallback:** if Uniwind turns out to be
incompatible with a component we cannot replace, switch to NativeWind v4 and
re-express the tokens in a v3 config — a contained, one-directory change, because
no component may contain a raw colour literal.

Tailwind v4 utilities only compile to what React Native can express; a class that
has no native equivalent is dropped, so the design kit's web-only utilities
(shadows beyond `boxShadow`, `backdrop-filter`, focus rings on non-focusable
views) are handled per-case in a documented exceptions file rather than assumed.

### What we are implicitly giving up, and how it is covered

- **True native text/scroll performance** → mitigated by capping the transcript
  the phone renders (the relay already caps its projection tail —
  `relay types.py`, `SessionProjection`) and by only loading older entries on
  demand through `/api/sessions/{id}/history`.
- **Local native builds** → CI (ADR 0004) and dev builds; locally we render the
  web target (ADR 0003).
- **Android browser auto-dismiss in the auth flow** → the app must render a
  "return to the app" page at its loopback callback and tell the user to switch
  back (`expo-web-browser` cannot close a Custom Tab programmatically). A custom
  native module using Chrome's Auth Tab or `CustomTabsIntent` teardown is the fix
  if this proves annoying (ADR 0002, hardening path).

## Consequences

**Positive**

- The relay contract, its types, its SSE reconnect discipline, and a working
  reference client all transfer; the first vertical slice (list → session →
  stream) is mostly assembly plus native chrome.
- The design kit stays the single source of truth: one generated token file, no
  second styling language, and the contrast contract
  (`design-kit/contrast-contract.mjs`) keeps applying.
- Both stores are reachable with one codebase and one CI pipeline; the web export
  doubles as the local visual harness and an optional PWA.
- Hiring and contribution are easy: React/TypeScript is the team's language, and
  it is the market's.

**Negative / costs**

- We inherit a dependency on Expo's SDK train (roughly quarterly) and on the
  JavaScript bridge for a text-dense UI.
- Uniwind is a young project (1.x, 2026) with a small number of maintainers; the
  migration fallback to NativeWind v4 is a real contingency we must keep exercised
  (a token-export test that fails if the classes drift).
- Android's auth tab cannot be dismissed from JS today, so the sign-in flow has a
  rough edge unless we write a small native module.
- Native (Swift/Kotlin) debugging skill is still required occasionally, even
  though neither is written by hand at v1.

## Open risks

| Risk | Why it matters | Mitigation / owner |
|---|---|---|
| `expo/fetch` cookie semantics differ from the docs on a real device | The whole tunnel auth path depends on owning the `Cookie` header | Spike S1 (ADR 0002) must prove `credentials: 'omit'` + manual `Cookie`/`Origin` works on iOS 26/27 and Android 16 before more is built |
| Uniwind / react-native-reusables incompatibility with a needed component | Blocking styling rework | Keep the token export and class names behind one module; time-box a NativeWind v4 fallback (1 day) |
| Expo SDK 58 (iOS 27) lands mid-flight | Upgrading during feature work is a distraction | Pin SDK 57; schedule the upgrade right after the first store release |
| Long transcripts jank on low-end Android | Core UX | FlatList-v2 budget and a measured frame-time check in the harness (ADR 0003) |
| App Store guideline 4.2 (Minimum Functionality) on a "remote control for your computer" app | Rejection risk at review | App carries real offline state (sessions list, cached transcripts, diagnostics) and is not a website wrapper; document the review narrative in the publishing docs |
| Guideline 4.8 (Login Services) | Sign-in is Radient-only | Guideline 4.8 carves out "a client for a specific third-party service [whose] users are required to sign in … directly" — record the reasoning and the fallback (offer Sign in with Apple via Radient) at submission time |

## What would change this decision

- **A spike (S1, ADR 0002) showing that the tunnel session cannot be driven from a
  native client** — e.g. if the edge rejects a non-browser `Cookie`/`Origin`
  combination in a way that cannot be worked around. Evidence that would settle it:
  a captured request/response from a real tunnel with a hand-built client.
- **Uniwind or `expo/fetch` being unimplementable with the components the design
  requires** — evidence: a two-screen prototype rendered on both platforms without
  platform-specific style forks.
- **A React-Native-to-native cost that shows up in the harness numbers** — e.g.
  sustained frame drops on a mid-range Android device with a 400-entry transcript
  while streaming. If that happens, the answer is a native text-rendering module
  inside this stack, not a different stack.
- **Expo's licensing or pricing changing for the parts we depend on.** The
  framework is MIT and EAS is optional here (ADR 0004 builds on GitHub Actions),
  so this is a low-probability trigger, but the exit is plain React Native with
  prebuild.
