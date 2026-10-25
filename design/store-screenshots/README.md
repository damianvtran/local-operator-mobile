# Store screenshots

Frame templates for the listing screenshots, sized to what each store accepts
today, plus the **nine rendered iPhone 6.9-inch frames** made with the first of
them.

Each template draws the canvas at the exact required size and reserves the app's
screen area inside it, so a real app capture dropped into that slot becomes a
correctly-sized asset with no resampling. The iPhone set is rendered and
committed (below); the iPad and Play templates are still empty slots.

| Template | Canvas | Slot | Where it is required |
|---|---|---|---|
| `iphone-6.9.html` | 1320 × 2868 | 1000 × 2172 | App Store Connect, 6.9-inch iPhone class |
| `ipad-13.html` | 2064 × 2752 | 1400 × 1867 | App Store Connect, 13-inch iPad class — **only if the app runs on iPad** |
| `play-phone.html` | 1080 × 1920 | 1080 × 1700 | Google Play, phone |

Render them with `node design/preview/capture.mjs --target frames`, which **asserts
every output's size against the store's spec** — an off-by-one canvas is rejected
by the store, so the script fails rather than shipping a frame nobody measured.
The two still-empty templates land in `out/` (gitignored); the nine iPhone frames
land in `appstore-iphone-6.9/` (committed).

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
single source for the set: the caption, the capture that fills the slot, and the
harness cell and world that capture came from.

### Regenerating the set

```sh
pnpm export:web                                        # the web build, into dist/
node design/store-screenshots/capture-frames.mjs       # the nine app captures
node design/preview/capture.mjs --target frames        # the nine listing frames
```

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

The first two produce `app-captures/iphone-max/<slug>.png` — the raw app screens,
1290 × 2796 (a 6.9-inch phone at 3x), committed so the composed frames can be
checked without a relay. The third composes each one into the template and writes
`appstore-iphone-6.9/<slug>.png`, failing on a wrong canvas size or a slot whose
image did not load.

`node design/preview/capture.mjs --check` re-renders all nine and compares them
with the committed files — bytes where the encoder matches, pixels otherwise, and
the script prints which comparison it made (CI's Chrome encodes PNGs differently
from a developer's, and reports `pixels identical`). Either way a caption, a
template or a capture edit that leaked into the assets fails. CI runs
`--target frames --check` as its own hard step, so a stale listing cannot merge
behind the preview sheet's font warning.

`capture-frames.mjs` starts its own mock relay on an ephemeral port and reaps it;
`--relay <url>` uses one you started instead. It names the WORLD each frame comes
from (`--scenario`), rather than letting the harness take the registry's first
match for a cell: the listings are read by a person, and the corpus's default
worlds for these cells say "Hello from the mock provider".

### What these frames deliberately do not fix

- **The route label — open, and a decision for the release owner.** Frames 06–08
  show the connected route as `127.0.0.1:<port>`. It is the app printing the route
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
  the route as the app prints it, or capture 06–08 from a device on a real tunnel)
  is on `docs/publishing/checklist.md` C2, where the upload gate reads it.
- **The truncated conversation title.** A phone header gives about 260 pt to the
  title, so "Refactor the relay client" renders on frames 01–05 as the app's own
  middle-ellipsis form ("Refactor t…ay client"). That is the app's behaviour, not
  a capture artefact.
- **The sessions pane is a drawer on a phone.** Frames 06–07 show it over the
  home, which is how the phone presents it; the iPad set carries the two-pane
  version.
- **iPad 13-inch and Google Play are not rendered yet** — a later slice; their
  templates' slots are still empty and `out/` is where their placeholders go.

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

1. Capture the app at the surface's device size — for iPhone, `iphone-max`
   (430 × 932 at 3x: 1290 × 2796) through `tools/visual/capture.ts`;
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
bars.
