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

## Swipe (not in this build)

The drawer opens by its button today. The swipe half of the model — a page pan
that opens the drawer from top-level screens, a close drag on the panel, the
16/12 pt axis thresholds, the 50 %-or-fling release rule, and the claim that
keeps sideways scrollers and the composer owning their touch — lands as a
follow-up change, and is documented with its own thresholds when it ships.

The destinations' release rule, which the follow-up will use, is already
implemented and tested: commit past 50 % of the width, or at a fling of at least
1000 pt/s past 20 % of it; a cancelled gesture never commits.

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
