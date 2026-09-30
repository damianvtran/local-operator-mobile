# Audit: the current `lop mobile` web client

Scope: the React web client the relay serves today
(`local_operator/mobile/web/` in the Local Operator repo), judged as the
baseline the native app must beat. Read-only; nothing in that repo was changed.

- **Code read:** `origin/main` at `5bfff4a61` (2026-09-29): `src/screens/*`,
  `src/components/*`, `src/store.ts`, `src/api.ts`, `src/router.ts`,
  `docs/mobile.md`.
- **Evidence read:** PR #1777 (merged, "UX batch 1", review/design/UX/QA rounds)
  and PR #1784 (**open** at the time of reading, "UX batch 2") via
  `gh pr view <n> --comments`.
- **Walked live:** a bundle built from that `origin/main` and served by the
  repo's own synthetic-projection fixture (`scripts/mobile_overflow_fixture.py`,
  isolated HOME, loopback port, no real sessions or daemon touched), driven with
  installed Chrome headless over CDP at 390×844 @2x, 360×780 and 320×568, with
  the root font size raised to 24 px/32 px to approximate 150 %/200 % text. All
  numbers below are from those runs unless marked otherwise. Frames stay in the
  author's scratch and are **not** committed (the repo rule: evidence lives on
  the PR, not in the tree).

Label key: **[measured]** = observed in the walk; **[code]** = read from source;
**[PR]** = stated in a PR review round; **[inferred]** = my reading.

## 1. What the web client is

A hash-routed SPA (`#/`, `#/new`, `#/past`, `#/pair`, `#/s/:id`,
`#/s/:id/a/:job`) that talks to the daemon over cookie-authenticated JSON plus
two SSE channels (session list, one per open session). Screens:

| Screen | Purpose | Notes |
|---|---|---|
| Login (server-rendered) | Password → cookie | The Radient route bypasses it; the gateway injects the cookie |
| Session list `#/` | Active sessions, search, pin, footer: new session · past · projects · theme | Search is a persistent field; hint "touch and hold a row to pin it" |
| Session view `#/s/:id` | Transcript, todos, subagents, pending card, composer | Header: back · title · pin ★ · "needs you"/"approvals" |
| Agent view `#/s/:id/a/:job` | Full-screen subagent transcript | Back-to-parent crumb |
| New session `#/new` | Working directory (home + recents + free path), model, start | |
| Past sessions `#/past` | Resume ended conversations | |
| Pair `#/pair` | Claim a `lop pair` code, generate a non-extractable device key | For signing authority-increasing approvals |
| Sheets | Slash commands, model, effort, gate (`/approvals`), agents, projects, theme (31 palettes) | |

## 2. Strengths to keep

Each is something the native app should reproduce or consciously improve.

1. **The pending decision is unmissable and never unreachable.** The approval /
   ask card is pinned above the composer, accent-bordered, has a `1 of N` badge,
   caps to a fraction of the *column* (not the viewport, so it survives the soft
   keyboard) and splits into meta row / scroller / controls so `approve` and
   `deny` are never scrolled away **[code: `pending-card.tsx` header comment;
   measured]**. At 390×844 the approve/deny pair is fully on screen for a
   paragraph-long command **[measured]**. This is the single best interaction in
   the product; the historical bugs (options unreachable, 1426 px card in an
   844 px viewport) are documented in the file.
2. **Secrets are handled honestly.** A secret ask renders a masked field with
   "secret — sent directly, not shown in the transcript" **[measured]**.
3. **Never lose a typed instruction.** Drafts persist per session
   (`lo-mobile-draft:`), and an instruction whose delivery is *unknown* is kept
   as a retry envelope with a stable UUID so the daemon de-duplicates
   (`docs/mobile.md` L196-232; `continuation-command.ts`) **[code]**. Offline
   send produced "Couldn't send this instruction. Try again." with the text
   preserved and a *Retry earlier instruction* button **[measured]**.
4. **Honest, quiet session-state vocabulary.** `approval`/`question` in danger
   ink with a dot; `new` in accent for unread completions (explicitly *not*
   danger, never pulsing); streaming = shimmering name; `ended` / `not
   answering` quiet chips (PR #1777 design round: min chip contrast 4.86:1)
   **[measured/PR]**. Exactly one state renders per row.
5. **Touch targets were audited and fixed.** After #1777 every interactive on
   the list and new-session screens is ≥ 44 px (0 controls under 44 on either
   screen in my sweep) **[measured]**, and the session header's 32 px controls
   carry 6 px hit slop **[code]**.
6. **Safe areas and reduced motion are handled.** `viewport-fit=cover`,
   `env(safe-area-inset-*)` on every header/footer/composer/sheet, three
   `prefers-reduced-motion` blocks **[code]**.
7. **Real touch, real thumbs.** The audit harness scrolls with
   `Input.dispatchTouchEvent`, not `scrollTop=`, so "reachable" means reachable
   by a finger. Keep this rule for the native E2E harness (see
   `audit-rubric.md`).
8. **Transcript parity with the TUI.** User/assistant/tool/notice/steer/
   compaction/peer-message rows; one-line tool rows with state glyphs and diff
   counts, tap to expand args/output/diff; todos and subagent panels with
   drill-down **[code]**.
9. **Per-session composer with slash sheet, model/effort chips, attach (images),
   voice dictation, stop/steer/resume morphing** **[code]**.
10. **31 palettes from one contract**, with a contrast contract of 1209
    assertions (`check-themes`) **[PR]**. The native app should inherit the
    design-kit tokens, not this palette list (see the brand stream).

## 3. Pain points a native redesign should fix

Severity here is *impact on a phone user of the current client*, not a review
verdict. IDs (`R1…`) are referenced from `flows.md` and `principles.md`.

### Connection & auth

- **R1 - MAJOR: connection loss is not shown on the session screen (on `main`).**
  With the daemon killed mid-session, twelve seconds later the session view
  still shows a ticking "coordinating remediation 10m26s" working line, the
  `stop` button, and an enabled composer; the words *reconnect* and *offline*
  never appear **[measured: text scan at t+1/3/6/12 s, plus frame]**. The list
  screen likewise renders its last state. The store retries SSE with 1 s→15 s
  backoff (`store.ts` L143-181) but nothing surfaces it. PR #1784 (open) adds a
  `reconnecting…` chip and session strips **[PR]**, which validates the finding;
  the native app must ship connection honesty from day one (principle P-5).
- **R2 - MAJOR: a 401 hard-reloads the page.** `handleUnauthorized()` clears
  private storage and calls `location.reload()` (`api.ts` L64-70) **[code]**.
  Correct for a cookie web app; wrong for a native app where the token may be
  refreshable and a *reload* would drop navigation, scroll and sheet state.
  Native needs a distinct refresh → re-auth ladder (flows.md §9).
- **R3 - MAJOR: no notion of "which computer".** There is one origin = one
  daemon. Nothing lists computers, shows which one is connected, or lets you
  switch. The Radient login at the edge is invisible to the app.
- **R4 - MINOR: sign-out/session management is absent from the SPA.** `main.tsx`
  records that no logout control exists; logout is a server route
  (`/logout`) reached by URL **[code]**. Store review requires an in-app
  sign-out/account-deletion path (see `flows.md` §10).
- **R5 - MINOR: SSE is cut every 60 s on the Radient route** (gateway
  `MAX_STREAM_SECONDS = 60`). The client reconnects, but the seam is not
  designed: no "still live" affordance and no proof the repaint is gapless.
  Native must treat the 60 s cut as a normal heartbeat, not an error.

### Discoverability & first run

- **R6 - MAJOR: no onboarding, no empty-state guidance.** An empty list has no
  copy about starting a session; past sessions says "no past sessions yet"
  **[measured]**. There is no explanation of what the app is or how it reaches
  the computer. For a store-distributed app this is the first 60 seconds.
- **R7 - MINOR: pin is discoverable only through a permanent hint line**
  ("touch and hold a row to pin it") and an unlabeled star in the session header
  **[measured]**. Long-press has no visual affordance and no haptic; iOS/Android
  users expect swipe actions or a context menu.
- **R8 - MINOR: the footer mixes destinations and settings** - `new session`,
  `projects`, `past`, and a bare half-moon glyph (`◐`) for theme
  **[measured]**. No settings screen, no account, no about/licences/privacy.
- **R9 - MINOR: slash commands are a raw command dump.** The sheet lists ~20
  TUI commands (`/reload`, `/update`, `/aida`, `/move`…) with truncated
  descriptions ("Pick a past conversation to resume, or resume …")
  **[measured]**. Commands that cannot work from a phone are still listed.

### Steering & trust

- **R10 - MAJOR: approvals raised by a terminal session cannot be answered from
  the phone** (deliberate v1 boundary, `docs/mobile.md` L189-194) - the phone
  "shows the wait and says so". This is the top reason people open a
  remote-control app (competitive-research §9.3). Not fixable client-side; the
  native app must state it plainly and the backlog should track the protocol.
- **R11 - MINOR: stop and steer share one button slot** that morphs with turn
  state (`aria-label` changes send→steer→stop). The queue is invisible
  (competitors: Replit's queue drawer). No confirmation on stop.
- **R12 - MINOR: "remember this choice" is an unlabelled 16 px checkbox** in the
  approval card: `<input type=checkbox class="size-4">` has no accessible name
  and is 16×16 **[measured: nameless control + sub-24 target]**. Its scope
  ("this command"? "this tool"? "this session"?) is not stated.
- **R13 - NIT: copy uses developer notation** (`~`, raw ids in refusals). #1784
  fixed several (U25/U26) **[PR]**; the native copy pass must keep that
  standard from the start.

### Text scaling & layout

- **R14 - MAJOR: the session title collapses to a single character at large
  text.** At root font 32 px (≈200 %), the header on the session view shows
  `S` for "Secret ask", with the pin star and `needs you` taking the rest of the
  row **[measured, frame]**. The list screen also loses its third footer button
  (`projects` clipped) and a session row extends 99 px past the 390 px viewport
  (`scrollWidth 489`) **[measured]**. At 24 px (150 %) nothing overflows
  **[measured]**. Native Dynamic Type/font-scale at 200 % is a launch criterion
  (rubric U-30…U-33).
- **R15 - MINOR: the composer's textarea is 24 px tall** with a py-2 shell
  (~40 px hit area) - accepted by the #1777 design round as a "text field, not a
  tap target" **[PR/measured]**. Native text inputs should be ≥ 44 pt.
- **R16 - MINOR: the primary composer controls sit in the middle of the
  bottom edge but `model`/effort is a tiny 12 px monospaced word under the
  send row** at the far right corner (`model`, 36×32) **[measured]**. It is the
  least reachable control on the screen and the only way to change model.

### Performance & platform

- **R17 - MINOR: no push, no background presence.** `docs/mobile.md` lists push
  as a non-goal. The `needs attention` badge is only visible if the tab is open.
- **R18 - MINOR: document title carries the count `(7) local operator`** - fine
  on web, meaningless in a native app; use the app icon badge instead.
- **R19 - NIT: theme picker is 31 palettes.** A phone needs Light / Dark /
  System and at most a handful of accents; the palette zoo multiplies the
  contrast-test matrix for little user value.

## 4. Evidence log (commands and what they returned)

Environment: Chrome 154 headless (`--headless=new --use-mock-keychain
--password-store=basic`, throwaway profile, killed by process group; final
sweep `pgrep -f <scratch>` = 0), fixture on a loopback port, torn down after each
run (`lsof -i :<port>` = 0).

| # | Probe | Result |
|---|---|---|
| E1 | Interactive controls < 44 px on `#/` and `#/new` at 390×844 (post-#1777 bundle) | 0 |
| E2 | Same on the pre-#1777 bundle (older worktree) | 9 list rows at 34 px; back/pin 32 px; `or type another path…` 36 px |
| E3 | Controls with no accessible name on a pending approval | 2: the 16 px "remember" checkbox; the hidden file input |
| E4 | Text scan for `reconnect`/`offline` at t+1/3/6/12 s after killing the daemon (session view) | never present |
| E5 | Offline `send` | `Couldn't send this instruction. Try again.` + draft + `Retry earlier instruction`; stop button still shown |
| E6 | Horizontal overflow at root font 16 / 24 / 32 px on list | 390 / 390 / **489** (viewport 390) |
| E7 | Same on the ask-free session | no overflow at any size; title truncates to one glyph at 32 px |
| E8 | Slash sheet on `/` | ~20 rows, several description texts truncated with `…` |
| E9 | `document.title` on list | `(7) local operator` |

## 5. Verdict for the native redesign

Keep: the pending-card contract, retry-envelope semantics, quiet state
vocabulary, real-touch verification, safe-area discipline. Replace: connection
honesty (R1), auth ladder (R2), computer switcher (R3), first-run (R6),
settings/account (R4, R8), text scaling (R14), and push (R17). Everything in
"Improve" maps to a screen or state in `flows.md`, and every "keep" is a
principle in `principles.md`.
