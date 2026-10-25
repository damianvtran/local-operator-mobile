# Store listing screenshots — the intended set

**Status: the pause is lifted (2026-10-24), and the iPhone set is rendered.** The
App Store 6.9-inch frames — all nine — are committed in
`design/store-screenshots/appstore-iphone-6.9/`, composed from the raw app captures
beside them in `design/store-screenshots/app-captures/iphone-max/`. The iPad and
Play sets are still to render. This file remains the plan: which screenshots each
listing carries, how many, in what order, in which theme, and how the final assets
are made. `design/store-screenshots/README.md` holds the set's own table, the
regeneration commands, and what these frames deliberately leave to the pre-upload
content pass.

The nine shots below are the listing assets. The repository README's screens
(`docs/assets/screenshots/`) are **not** this set — they are documentation
images — and the last section records their freshness.

## The set — nine shots, claim-first order

One capture per shot; the same nine states serve every surface (Play takes the
first eight). The order is **claim-first** — `docs/design/brand-kit.md` § 7.1
puts the transcript, the diff and the approval card first because they are the
product's three claims — and frames 01–02 are what most viewers see, so they
must stand alone.

| # | File slug (same in all three sets) | Shows | Caption (eyebrow · headline) |
| --- | --- | --- | --- |
| 01 | `01-session-transcript` | a running session: turns, tool rows, tasks and subagents strips, composer | 01 · Sessions — "Every session on your machine, in your pocket." |
| 02 | `02-session-diff` | a real fenced diff, a code block and tables | 02 · Code — "Diffs and code blocks, as your agent writes them." |
| 03 | `03-approval-card` | the approval card: Approve/Deny and always-allow | 03 · Approvals — "Approve each command, before it runs." |
| 04 | `04-checkpoint-rail` | the per-turn checkpoint rail | 04 · Checkpoints — "Every turn, marked as it finishes." |
| 05 | `05-session-search` | the in-conversation find sheet on a query | 05 · Search — "Find any message in the conversation." |
| 06 | `06-sessions-remote` | the session list including remote rows | 06 · Computers — "Every computer's sessions, in one list." |
| 07 | `07-move-receipt` | a move/offload receipt and its steps | 07 · Handoff — "Move a session between your computers." |
| 08 | `08-new-chat` | the home composer, idle | 08 · New chat — "Ask your agent — it runs on your computer." |
| 09 | `09-sign-in` | sign-in, the real sparse state | 09 · Connect — "Connect to your own computer." |

- 01's caption is the templates' committed copy; the iPad template carries its
  own headline ("Every session, on a bigger screen."). 02–09 were authored for
  this set and change with one re-render each — wording is the one open item
  here, listed under "Open at resume".
- Every slot shows the real app driven against the mock relay; the conversations
  and labels in it are the relay's fixtures, and nothing in the frame is faked.

## Count and order per store surface

| Surface | Template | Rendered dir | Count | Order |
| --- | --- | --- | --- | --- |
| App Store, iPhone 6.9" | `design/store-screenshots/iphone-6.9.html` | `design/store-screenshots/appstore-iphone-6.9/` — **rendered** | **9** (cap 1–10) | 01 → 09 |
| App Store, iPad 13" | `design/store-screenshots/ipad-13.html` | `appstore-ipad-13/` — to render | **9** (cap 1–10) | 01 → 09 |
| Google Play, phone | `design/store-screenshots/play-phone.html` | `play-phone/` — to render | **8** (cap 8 per device type) | 01 → 08 |

- **09 is App Store only**: Play's per-device cap is 8 and the eight feature
  states carry the listing; sign-in stays in the App Store sets.
- The iPad class is **required, not optional** — the app sets
  `supportsTablet: true` and ships two-pane layouts — and its captures are the
  tablet layouts, not scaled phone shots.
- Fix the set before upload: after an App Store review, changing screenshots
  needs a new version.

## One theme

The set uses **one theme throughout: dark**. Every app capture is the dark
theme, on the frame's light brand canvas; no frame pairs light and dark and no
frame mixes. A light set is a re-capture and re-render, not an upload-time
choice, and is not what these files were rendered from.

## Mapping onto the templates

| Rendered dir | Template | Canvas | App slot | Caption band |
| --- | --- | --- | --- | --- |
| `appstore-iphone-6.9/` | `iphone-6.9.html` | 1320 × 2868 | 1000 × 2172, radius 88 | top, 380 px (13.2 %) |
| `appstore-ipad-13/` | `ipad-13.html` | 2064 × 2752 | 1400 × 1867, radius 110 | top, 470 px (17.1 %) |
| `play-phone/` | `play-phone.html` | 1080 × 1920 | 1080 × 1700, full-bleed | bottom, 220 px (11.5 %) |

- The App Store frames **inset** the app so the caption never stacks on a
  native-size capture (App Store Connect validates the raw image); the slot's
  aspect matches its canvas, so nothing letterboxes.
- The Play slot is taller than a phone screen; each capture is **cropped to the
  slot**, anchored top or bottom per shot (01 top, 02 top, 03 bottom, 04 top,
  05 bottom, 06 top, 07 bottom, 08 bottom), never letterboxed.
- Every canvas size is asserted at render time by
  `node design/preview/capture.mjs --target frames` — an off-size canvas fails
  rather than shipping. The slot rule and the store sources live in
  `design/store-screenshots/README.md`.

## How the final assets get made

The flow the current files were made with — repeat it on the frozen
pre-submission build (step 1 is provisional until the capture-method item under
"Open at resume" is decided):

1. **Capture** the app's web export against the mock relay (`tools/mock-relay/`)
   through `tools/visual/capture.ts` — `design/store-screenshots/capture-frames.mjs`
   drives it from `frames.json`, one PNG per frame, and names the world each capture
   needs. Today's captures are `iphone-max` (430 × 932 at 3x: 1290 × 2796); the iPad
   and Play sets will name their own device profiles in the same file.
2. **Fill the template's slot** — the frame is DATA, not a pasted image: the
   capture's path, the eyebrow and the headline arrive as query parameters from
   `frames.json`, and the slot's shell (radius, clip, shadow) is kept.
3. **Render** with `node design/preview/capture.mjs --target frames`, which asserts
   every canvas against the store's spec and every slot's image against the
   capture's own pixels.
4. **Verify before upload**: no alpha (Play wants 24-bit PNG; App Store Connect
   rejects transparency), no secret or harness-world text on any frame, and view
   every frame once — a size check is not visual evidence.

The 26 rendered files (`appstore-iphone-6.9/` ×9, `appstore-ipad-13/` ×9,
`play-phone/` ×8), the raw captures and `MANIFEST.sha256` survive in the parity
lane's scratchpad mirror —
`~/.local-operator/sessions/0fb6ba9da093/scratchpad/appcaps/deliverable/`, its
`MANIFEST.sha256` re-verified 26/26 (the lane's report and compose pipeline sit
one level up in `appcaps/`) — after the `store-shots` worktree that rendered
them (`design/store-screenshots/out/`, gitignored by design) was pruned.
Those files were rendered off the `02da0334` tree; main has moved on, and the
pre-upload content pass (13 of 26 of them carry harness-world text) stays the
standing gate before submission — `submission-runbook.md`, "Store assets —
produced, parked with the work".

The nine committed iPhone frames are the ones the iPhone listing takes: they are
rendered from the current tree and reproducible in place. They are not exempt from
that content pass — `design/store-screenshots/README.md` names exactly what they
still carry (a seeded web build's `127.0.0.1` route label, and the app's own
middle-ellipsis title) rather than leaving it to be discovered at upload.

## Related captures: the README screenshots are not this set

`docs/assets/screenshots/` holds seven screens in light and dark for the
repository README: welcome, sign-in, session-list, session-view, approval,
refusal, settings — 780 px wide (a 390 pt phone downsampled from a 3× web
capture against the mock relay; the refusal pair is a 430 pt phone, 780 × 1691),
far too small for any store slot. Verified 2026-10-10 by provenance and change
analysis against `main` @ `6628f26` (not re-rendered):

| Screen | Last captured | Verdict |
| --- | --- | --- |
| welcome | #26 (2026-10-03); no changes to its files since | no known drift |
| sign-in | #26; no changes to its files since | no known drift |
| refusal | #26; surface and copy unchanged, and the verdict module gained the local-network outcome additively (#54) | no known drift |
| session-list | #26 | **cannot vouch** — the home/drawer restructure (#34) and remote rows (c0fa8b5) redraw this surface |
| session-view | #55 (2026-10-07) | **cannot vouch** — checkpoint rail (#68), find (#63), the image-generation card and asks states landed after |
| approval | #26 | **cannot vouch** — the card itself is unchanged since #12, but its transcript context was reworked (#55 onwards) |
| settings | #26 | **cannot vouch** — push notice (#41) and local-network copy (#54) landed after |

## Open at resume

- **Caption wording 02–09** — authored for this set, editable with one
  re-render each; approve or edit before the final render.
- **Capture method for the submission files** — the produced files are
  web-export renders; `apple-app-store.md` § 9.2 describes captures from CI (a
  simulator job) or a Mac. Reconcile at the frozen-build re-shoot so the
  submission method is a decision, not a drift.
- Everything else — counts, order, the single theme, the template mapping — is
  approval-only.

Sources: `design/store-screenshots/README.md` (sizes and slot rule; store specs
read 2026-09-29), `docs/design/brand-kit.md` § 7.1, and the `store-shots` lane's
report (2026-10-09).
