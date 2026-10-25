# Store screenshots

Frame templates for the listing screenshots, sized to what each store accepts
today, plus the **26 rendered listing frames** made with them: nine for the
6.9-inch iPhone class, nine for the 13-inch iPad class, and eight for Google
Play's phone class.

Each template draws the canvas at the exact required size and reserves the app's
screen area inside it, so a real app capture dropped into that slot becomes a
correctly-sized asset. All three sets are rendered and committed (below); the
templates themselves stay in the tree as the empty slots they are.

| Template | Canvas | Slot | Where it is required | Rendered set |
|---|---|---|---|---|
| `iphone-6.9.html` | 1320 × 2868 | 1000 × 2172 | App Store Connect, 6.9-inch iPhone class | `appstore-iphone-6.9/` — 9 |
| `ipad-13.html` | 2064 × 2752 | 1400 × 1867 | App Store Connect, 13-inch iPad class — **required, the app runs on iPad** | `appstore-ipad-13/` — 9 |
| `play-phone.html` | 1080 × 1920 | 1080 × 1700 | Google Play, phone | `play-phone/` — 8 |

Render them with `node design/preview/capture.mjs --target frames`, which **asserts
every output's size against the store's spec** — an off-by-one canvas is rejected
by the store, so the script fails rather than shipping a frame nobody measured.
The three templates rendered with no query land in `out/` (gitignored); the 26
listing frames land in the three directories above (committed).

## The iPhone 6.9-inch set — nine frames

**The nine files in `appstore-iphone-6.9/` are the App Store listing's iPhone
6.9-inch screenshots**, in the order the store takes them (one to ten allowed).
Every one is 1320 × 2868, 24-bit PNG, no alpha. The app screen inside each frame
is a real capture — a web build of this repository driven against the mock relay by
`tools/visual/capture.ts` — and no part of that screen is drawn, retouched or
replaced. What the template draws is the frame AROUND it: the canvas, the caption
band and the wordmark. The frame carries no build metadata: an earlier revision put
a spec block (`App Store · 6.9"`, `1320 × 2868 @1x`, the alt-size list) beside the
wordmark, and the render now FAILS a composed frame that contains one. Sizes belong
to this document and to the renderer's own output, not to the image.

| # | File | Shows | Captured from | World |
|---|---|---|---|---|
| 01 | `01-session-transcript.png` | A running session: turns, tool rows, the tasks and subagents strips, the composer. | `S5/populated` | `every-entry-kind` |
| 02 | `02-session-diff.png` | A real fenced diff, a fenced code block and two tables. | `S5/rich-rows` | `store-diff` |
| 03 | `03-approval-card.png` | The approval card: Approve, Deny, always-allow. | `S8/approval` | `approval-destructive` |
| 04 | `04-checkpoint-rail.png` | The per-turn checkpoint rail down the transcript's edge. | `S5/rail` | `store-rail` |
| 05 | `05-session-search.png` | The in-conversation find sheet on a query. | `S5/find-results` | `long-transcript` |
| 06 | `06-sessions-remote.png` | The sessions list with another computer's sessions in it. | `S15/mesh-remote` | `store-mesh` |
| 07 | `07-move-receipt.png` | A move's receipt: prepared, handing off, committed, done. | `S15/move-receipt` | `store-move-receipt` |
| 08 | `08-new-chat.png` | The home composer, idle, with the relay's ranked catalogue behind its model chip. | `S4/idle` | `store-home` |
| 09 | `09-sign-in.png` | Sign-in, the real sparse state. | `path:/sign-in/empty` (unseeded) | — |

The copy on each frame — eyebrow and headline — is in `frames.json`, which is the
single source for all three sets: the caption, the capture that fills the slot,
and the harness cell and world that capture came from.

## The iPad 13-inch and Play sets

The same nine states, at each surface's own device profile (all named in
`frames.json`). Captions are the plan's, except frame 01 on iPad, which carries
the iPad template's own headline ("Every session, on a bigger screen.").

| Set | Files | Capture device | App captures | Composition |
|---|---|---|---|---|
| `appstore-ipad-13/` | 9 (01–09) | `tablet-pro` (1024 × 1366 at 2x: 2048 × 2732) | `app-captures/ipad-13/` | inset slot 1400 × 1867, radius 110 |
| `play-phone/` | 8 (01–08) | `android-small` (360 × 780 at 3x: 1080 × 2340) | `app-captures/play-phone/` | full-bleed slot 1080 × 1700, capture cropped to an edge |

- **Play takes 01–08**: the store's per-device cap is eight, and sign-in (09) is
  App Store only. The iPad set has all nine.
- **The iPad captures are the app's tablet layouts**, not scaled phone shots.
- **The Play slot is 0.635 while a phone screen is 0.46**, so each capture is
  anchored to the slot's top or bottom edge (01 top, 02 top, 03 bottom, 04 top,
  05 bottom, 06 top, 07 bottom, 08 bottom — the plan's mapping) and the template
  crops the rest. Nothing is letterboxed, and the app screen is not retouched.
- Every frame is 24-bit PNG with no alpha, and carries no build metadata — the
  render asserts the last two on every surface.

### Regenerating the set

```sh
pnpm export:web                                        # the web build, into dist/
node design/store-screenshots/capture-frames.mjs       # all 26 app captures
node design/preview/capture.mjs --target frames        # all 26 listing frames
```

`capture-frames.mjs` reads every surface in `frames.json`, starts its own mock
relay and reaps it, and **keeps a capture whose PNG already exists** — presence
is the cache key. A re-run after adding one surface therefore captures only the
new files, which is what keeps adding a surface from re-taking the other two.
Pass `--surface <id>` to narrow the run, and `--force` after the web build, a
cell or a world changed; deleting one file re-takes that one.

Two things a re-run on a fresh `git worktree` has to know, both measured in review
round 1's QA pass:

- **`pnpm <script>` does not run in a worktree whose `node_modules` is a symlink to
  the primary checkout** (this repository's own sharing convention): pnpm refuses
  before the script with `workspace hoist directory is not a real directory`. Run
  the underlying command (`./node_modules/.bin/expo export --platform web`) or work
  in a checkout with its own tree.
- **A first export in a fresh tree can emit the uncompiled stylesheet** (7 KB of
  raw `@source`/`@theme` with no utility classes, instead of ~31 KB). The build
  still prints `Exported: dist`. Pass `--clear`, and treat "the frames came back as
  unstyled text on a transparent canvas" as this, not as an app fault: the capture
  harness reports it as a theme problem and refuses the cell.

The first two produce `app-captures/{iphone-max,ipad-13,play-phone}/<slug>.png` —
the raw app screens (1290 × 2796, 2048 × 2732 and 1080 × 2340, the three profiles'
own pixels), committed so the composed frames can be checked without a relay. The
third composes each one into its surface's template and writes that surface's
directory, failing on a wrong canvas size, a slot whose image did not load, or a
frame that carries build metadata.

`node design/preview/capture.mjs --check` re-renders all 26 and compares them
with the committed files — bytes where the encoder matches, pixels otherwise, and
the script prints which comparison it made and on what tolerance: `byte-identical`,
`pixels identical` at zero, or `pixels identical within the N% fuzz` beside the
count that differs at zero tolerance and the largest channel difference. CI's
Chrome encodes PNGs differently from a developer's and resamples the iPad slot
slightly differently too; every surface carries its own `compareFuzz` in
`frames.json`, set from those measurements rather than from a shared default, and
the log prints the numbers the value can be checked against. Either way a caption, a
template or a capture edit that leaked into the assets fails. CI runs
`--target frames --check` as its own hard step, so a stale listing cannot merge
behind the preview sheet's font warning.

`capture-frames.mjs` starts its own mock relay on an ephemeral port and reaps it;
`--relay <url>` uses one you started instead. It names the WORLD each frame comes
from (`--scenario`), rather than letting the harness take the registry's first
match for a cell: the listings are read by a person, and the corpus's default
worlds for these cells say "Hello from the mock provider".

### What these frames deliberately do not fix

- **The route label — open, and a decision for the release owner.** The iPhone and
  iPad frames 06–08, and Play frame 06, show the connected route as
  `127.0.0.1:<port>`. It is the app printing the route
  it was given, and a served web build's route IS the harness's origin; on a device
  it is the user's tunnel hostname. Review round 1 asked for one bounded attempt at
  a non-loopback origin, and it was made and refused BY THE APP:

  ```
  $ node tools/visual/capture.ts … --host studio-mini.lop.localhost --cells S15/mesh-remote
  …site declared 'mesh-remote' … the app made no request to the mock relay for this
  cell
  ```

  `src/connection/profile.ts` (`isPrivateHost`, `validateCustomBaseUrl`) allows
  `http://` only for a literal private ADDRESS — `127.x`, `10.x`, `192.168.x`,
  `172.16–31`, `169.254`, `::1`, CGNAT — so a name, `*.localhost` included, is
  refused before a request is made. Serving the build over `https://` would need a
  certificate the harness does not have, and a LAN address would make the committed
  PNG irreproducible across machines. The frame is not masked. The choice (accept
  the route as the app prints it, or capture those frames from a device on a real
  tunnel) is on `docs/publishing/checklist.md` C2, where the upload gate reads it.
- **The truncated conversation title.** A phone header gives about 260 pt to the
  title, so "Refactor the relay client" renders on frames 01–05 as the app's own
  middle-ellipsis form ("Refactor t…ay client"). That is the app's behaviour, not
  a capture artefact.
- **The sessions pane is a drawer on a phone.** Frames 06–07 show it over the
  home, which is how the phone presents it; the iPad set carries the two-pane
  version, with the sessions list beside the home composer.
- **The mock relay's 1×1 image fixture.** The `every-entry-kind` world carries a
  user message with an image attachment, and the relay answers that route with a
  1×1 PNG (`tools/mock-relay/relay.ts`), which the app stretches into the card.
  The taller iPad screen shows the message, so iPad frames 01, 02 and 04 carry it
  as a solid block. It is the app rendering a real relay answer, not a composited
  placeholder; the pre-upload content pass owns whether that fixture is replaced
  before submission — the same pass that owns the route label.

## App Store Connect

Source: <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>
(read 2026-09-29).

- **6.9-inch iPhone class** accepts 1260 × 2736, 1290 × 2796 and 1320 × 2868
  (portrait) or their landscape transposes. This template uses the largest.
  Required if the app runs on iPhone and no other class supplies screenshots.
- **13-inch iPad class** accepts 2064 × 2752 or 2048 × 2732. Required if the app
  runs on iPad.
- One to ten screenshots per size, at least one required.
- Screenshots must be PNG or JPEG and must **not** be transparent.
- The image itself is validated, so a caption band stacked on top of a native-size
  capture is rejected — which is why every template insets the app inside the
  canvas instead.
- Screenshots are directionally cropped on some surfaces, so the composition must
  survive a narrower crop.

## Google Play

Source: <https://support.google.com/googleplay/android-developer/answer/9866151>
(read 2026-09-29).

- **Required to publish:** at least **two** screenshots across different device
  types, JPEG or 24-bit PNG, **no alpha**, each side between **320 and 3840 px**,
  and no side more than twice the other's length. `play-phone.html`'s 1080 × 1920
  satisfies all of these.
- **Recommended** (and required to be eligible for the large promotional
  formats): at least **four** screenshots at a minimum of 1080 px on the short
  side, 9:16 portrait.
- Content rules that bind the composition: show the real app experience; keep any
  tagline under **20% of the image** (the frame's caption band is 220 / 1920 =
  11.5%); no ranking, award, testimonial or price claims; no call to action
  ("Install now"); do not show fingers on a device.
- **Also required to publish:** a feature graphic at 1024 × 500, JPEG or 24-bit
  PNG with no alpha — `design/app-icon/store/play-feature-graphic.html`, rendered
  by the same capture script — and an app icon at 512 × 512 as a 32-bit PNG with
  alpha, up to 1 MB (`design/app-icon/store/play-icon-512.png`).
- Do not bake rounded corners or drop shadows into the Play icon: Play renders
  both.

## How a real capture gets in

A capture is never pasted into a template. The slot is filled from the query
string — `?eyebrow=…&headline=…&capture=<path>` — so the image is a PATH relative
to the template, the caption travels beside it, and both come from `frames.json`
when `design/preview/capture.mjs --target frames` renders the set. The template
keeps the `.slot` shell (radius, shadow, clip) either way: replacing the element
with a bare `<img>` would lose the device rounding.

1. Capture the app at the surface's device size — `iphone-max` (430 × 932 at
   3x: 1290 × 2796), `tablet-pro` (1024 × 1366 at 2x: 2048 × 2732) or
   `android-small` (360 × 780 at 3x: 1080 × 2340) through `tools/visual/capture.ts`;
   `capture-frames.mjs` does it from `frames.json`.
2. Add or edit that frame's entry in `frames.json` (slug, copy, capture, cell,
   scenario) — the render reads it, and nothing else needs editing.
3. Run the render, which re-asserts the canvas size and that the slot's image
   loaded at the capture's own pixel size, then look at the result before
   uploading it: a size check is not visual evidence.

The slot's aspect matches its canvas exactly in the two App Store templates, so
the capture scales to fit with no letterboxing. The Play template's slot is
deliberately taller relative to its width (0.635 against a phone's 0.46): at a
1920-tall canvas there is no room for a caption band at the phone's own aspect, so
feed it a capture cropped to the slot's aspect rather than one scaled down with
bars. `frames.json`'s `crop` names the edge each shot is anchored to, and the
template applies it with `object-position` — the capture file itself is untouched.
