# Navigation and gesture model

A screen under `app/(app)` is one of two kinds, and the kind is a property of the
route — never of how the reader arrived:

- **Top-level**: the drawer can open it. The stack is always `[Home]`,
  `[Home, T]`, or `[Home, T, nested…]`, with one top-level screen above Home.
  The header shows ☰.
- **Nested**: everything reached from inside a top-level screen. The header
  shows ‹, and the native stack pops one page.

| Top-level | Nested |
|---|---|
| `index` (Home / new chat) | `session/[id]/agent/[jobId]`, `session/[id]/video` |
| `conversations` (Home, panel forced open) | `theme` |
| `session/[id]` | `projects/[key]`, `library/[id]`, `notifications/[id]` |
| `settings`, `past`, `projects`, `schedules`, `library` | `new` (new-session picker) |
| `notifications/index` | `team-bridge/[tenantId]/[conversationId]/thread/[rootId]` |
| `team-bridge`, `team-bridge/[tenantId]/[conversationId]` | `community/[communityId]` and its pages |
| `community` | |

`src/features/sessions/top-level-routes.ts` is the single source for this table,
and `top-level-routes.test.ts` reads `app/(app)` so a new screen must declare its
class. Top-level routes are declared per route in `app/(app)/_layout.tsx` with
`gestureEnabled: false` and `animation: 'none'`; the shared stack options stay
untouched for nested routes and for the root and `(auth)` stacks.

## A drawer pick replaces; it never stacks

Picking a destination resets the `(app)` stack to `[Home, target]` (`[Home]` for
Home or New chat) in ONE `RESET`, key-preserving for Home. Home stays mounted, so
a draft and its scroll position survive; the destination mounts under the
closing panel, so the swap has no slide and the drawer's exit is the only motion.
Picking the screen already showing only closes the drawer.

Sessions opened from Past, Notifications, a Library record, a search result, an
ask's "answer in conversation" or a warm deep link follow the same rule: the
session replaces the list rather than stacking a second top-level screen.

`src/features/sessions/top-level-navigation.ts` owns the plan (`planTopLevelStack`)
and the one hook (`useOpenTopLevel`) every call site uses.

## The drawer

The drawer is an overlay, not a route, and it is **full width**. On native it is
an absolute-fill view rendered after the route stack; on web it is a `Modal`
(the focus trap and Escape are the browser's own). Its content is the same
conversations pane in both shells.

- **Width**: 100 % of the screen, on phones and tablets. Home's split pane keeps
  its 316 pt sidebar; that is a different surface.
- **Motion**: `cubic-bezier(0.42, 0, 0.58, 1)` (CSS `ease-in-out`), 320 ms for a
  full-width travel, floor 120 ms. One curve for tap-open, drag release,
  spring-back and close. A release resumes the curve from the position the
  finger left it at — time left is `320 ms × (1 − curve time)`, never a fresh
  ease-in from standstill.
- **Scrim**: fades with the travel and sits behind the panel at rest. A
  full-width panel leaves no page to tap; the scrim is the dismiss target only
  while the panel is mid-travel.
- **Reduced motion**: the cap applies to the settle (`effectiveDuration`), never
  to direct manipulation.
- **Focus and back**: opening dismisses the keyboard and moves accessibility
  focus to the panel; closing returns it to the trigger. On Android, back closes
  the drawer while it is open; a `Modal` above it takes back first. On iOS the
  overlay is `accessibilityViewIsModal`, and the two-finger escape closes it.
- **Nested modals**: a sheet raised inside the drawer paints its own dim, because
  the full-width drawer never claims the page's dim.

## Swipe

A rightward swipe starting on a top-level screen's CONTENT opens the drawer; a
leftward drag starting on the open panel closes it. Both drive the same
`progress` shared value the button opens settle on, so the panel tracks the
finger 1:1 and a release resumes the curve from the position the finger left it.

- **Thresholds** (`src/features/sessions/drawer-pan.ts`, `DRAWER_PAN`): activate
  after **16 pt rightward**; fail after **16 pt leftward** (that direction is
  "back", not "open") or **12 pt vertical** (the transcript's scroll owns that
  axis). The panel's close drag mirrors them: 16 pt leftward activates.
- **Release**: commit past **50 % of the width**, or at a fling of at least
  **1000 pt/s** once the finger has travelled **20 %**. `decideRelease` in
  `src/ui/drawer-motion.ts` is the one rule for opening and closing (a close
  passes its travel and speed as positives). A cancelled touch never commits.
- **Where it is live** (`panEnabled`): top-level routes only, never while the
  drawer is visible, never while a message selection is live (`E5`, read through
  `useSyncExternalStore` like `selectable-message.tsx`), never on web. Nested
  routes keep the native stack (iOS full-width pop — see below) and Android has
  no in-content version of it.
- **Host**: `PageSwipeHost` is mounted per screen through the stack's
  `screenLayout` (`app/(app)/_layout.tsx`), which also publishes the screen's pan
  ref to the claims inside it. The panel's SHELL mounts at touch-down (`prime`),
  so its fill is not late; the pane's CONTENT — its 60 s timer, the tag
  catalogue read and its modal entry — mounts only once the touch is a rightward
  drag past `DRAWER_PAN.contentRevealPt` (6 pt, `reveal`), so a tap or a
  vertical scroll never pays for it. A touch that turns out to be either drops
  the shell (`onFinalize` → `abandon`); one that took a running settle over
  hands it back (`resume`).
- **Keyboard**: dismissed when the gesture ACTIVATES, not at touch-down.
- **Android**: the pan's start region is shrunk by 24 dp on both edges
  (`hitSlop` with negative insets), so the system back strips stay the system's.

### What owns a horizontal touch, and how it is proven

The page pan is an ancestor recogniser, so a sideways scroller under the finger
is not something a threshold can beat. Two mechanisms, one per kind of surface:

- **`HORIZONTAL_SCROLL_PROPS`** (`src/ui/horizontal-scroll.ts`) on every
  horizontal `ScrollView` — tables and code blocks in `markdown.tsx`, diagram
  blocks, inline-UI previews, the library's kind row, the attachment strip and
  the image pager. On iOS it adds `directionalLockEnabled`, so a diagonal drag
  cannot change axis halfway. A scroller that overflows keeps scrolling even at
  its left end (the operator's P4, no handoff in v1); a table that FITS opens the
  drawer on Android and bounces on iOS, which is the platform gap the memo
  accepts and records.
- **`DrawerSwipeClaim`** (`src/ui/drawer-swipe-claim.tsx`) around the surfaces
  that are not scrollers: the inline chart's scrub `PanResponder`, and the
  composer at its two call sites (`src/features/home/home.tsx`,
  `app/(app)/session/[id].tsx` — `composer.tsx` belongs to another change). The
  claim is `Gesture.Native().blocksExternalGesture(pageRef)`, so the page pan
  waits for it to fail and a touch that starts there never opens the drawer.
  Its children sit inside a plain `View collapsable={false}` because that is
  what the recogniser attaches to: a custom child (the composer) swallowed the
  cloned `collapsable` and its host node was flattened on Fabric, so the page
  pan took a composer drag (QA round 2, Q2; `drawer-swipe-claim.test.tsx` pins
  the shape). The drawer panel's close drag uses the same plain-host-view shape
  for the same reason.

Proven in vitest, not on a device: the pan's configured numbers and its
`enabled` gate (`drawer-pan.test.ts`, `page-swipe-host.test.tsx`), that a claim
blocks THAT screen's pan ref (wiring, not arbitration), the content reveal
threshold and the shell/content mount split, and a source ledger
(`drawer-swipe-ledger.test.ts`) that fails any horizontal `ScrollView` under
`src/` without the props or a named exemption, and any exemption whose witness
disappeared. No Node test proves WHO WINS a real touch: the scrollers' evidence
is config plus the platform's own recogniser rule, and the claim's is wiring
plus RNGH's documented relation. What only a device can settle: whether a plain
RN scroller really wins the touch on iOS 26 at a table's left end (the memo's
E4 race), whether the claim blocks for the whole touch on a plain `View` (the
memo's unverified item, fallback: a JS touch-start flag read by a
`manualActivation` pan), and the prime's lead on a fast flick (E3).

### Nested back on iOS 26 (E2)

Nested `(app)` screens now accept UIKit's own rule: no `gestureResponseDistance`,
so the native pop is full width, and screens' arbitration makes a sideways
scroller win (`RNSScreenStack.mm` asks the screen's scroll pans to fail, and a
scroll view wider than its frame answers NO at its left end). The root stack and
`(auth)` keep #373's 44 pt edge limit: they are outside this model, have no
sideways scrollers, and nothing measured them full width. The full option set is
in `src/ui/stack-options.ts`, and `stack-options.test.ts` pins all three cases.

## RTL

The drawer stays on the physical left and opens with a rightward gesture in
every language. RTL here is a Yoga layout direction, not a UIKit mirror, so a
drawer that mirrored while the native back swipe did not would split "up" into
two directions.

## Evidence

Rendered frames are the evidence for this surface: light and dark, 320–430 pt
phones and tablet, before and after, with the drawer at rest, mid-travel and
with a sheet raised inside it. A green unit test proves the arithmetic and the
plan, not the pixels; native device QA covers the focus and back behaviour.
