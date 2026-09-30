# design/

The mobile design system for `local-operator-mobile`, and the assets that come out
of it. Everything here is derived from the product's existing brand — nothing is
invented.

| Path | What it is |
|---|---|
| `tokens/tokens.json` | **The source of truth.** Colour roles for both themes, the type ramp, space, radii, touch geometry, safe areas, elevation, motion |
| `tokens/tailwind-preset.js` | Generated. The same roles as Tailwind utilities — a `theme.extend` preset for NativeWind, plus `cssVariables()` / `themeBlock()` strings for Uniwind's CSS-only path |
| `tokens/contrast-contract.mjs` | The executable gate: 1000+ assertions over both themes, exits non-zero on a violation |
| `tokens/build-preset.mjs` | Regenerates the preset and the preview's CSS variables from `tokens.json` |
| `app-icon/` | The app icon, launcher, notification, splash and store assets, generated from the real mark |
| `store-screenshots/` | Frame templates at the sizes App Store Connect and Google Play require |
| `preview/` | The kit preview sheet and the headless-Chrome capture script |

Prose lives in `docs/design/`: [`brand-kit.md`](../docs/design/brand-kit.md) is
the why, [`components.md`](../docs/design/components.md) is the per-primitive
spec.

## The gates and the generators

The three `--check` commands are **gates**: each must exit 0, and each re-derives
its artefact and compares it with the committed file, so a stale or damaged asset
fails the run instead of passing quietly.

```sh
node design/tokens/contrast-contract.mjs           # gate: 1056 assertions over both themes
node design/tokens/build-preset.mjs                # generate: the preset + the preview's CSS
node design/tokens/build-preset.mjs --check        # gate: those two files match tokens.json
node design/app-icon/build-icons.mjs               # generate: every icon/splash/store PNG + the SVG layers
node design/app-icon/build-icons.mjs --check       # gate: re-renders all 33 files and compares them
node design/preview/capture.mjs                    # generate: the preview sheet, both themes
node design/preview/capture.mjs --check            # gate: EVERY target — the 5 committed captures (4 sheet
                                                   #   frames + the Play feature graphic) + the 3 frame sizes
node design/preview/capture.mjs --target feature   # generate: just the Play feature graphic
```

**`--check` defaults to every target; generation defaults to the sheet.** That
asymmetry is deliberate on both sides: a gate whose default scope is narrower than
this page is the same defect as a gate that cannot fail (the feature graphic sat
outside `--check`'s default for a round while this page said five captures were
covered), and rendering the sheet is the common generation case. `--target`
narrows either mode.

Each gate compares **bytes**, falling back to a decoded **pixel** comparison where
an external encoder makes the bytes non-reproducible, reports which of the two
passed, and treats a missing decoder as a failure rather than a pass. `build-icons
--check` and `capture --check` therefore need the same tools their generators
need (an SVG rasterizer; Chrome) and say so, in install lines, when one is
missing.

Two properties the generators hold so the gates can be strict:

- **Both delete their per-run scratch tree on every exit path**, failures
  included (`process.on("exit")`, not the success branch) — a cleanup that only
  runs when nothing went wrong is the one case that never needs it, and five
  abandoned trees accumulated across one round's failing runs before this was
  fixed. Pass `--keep-scratch` to `capture.mjs` to keep one for inspection.
- **Both strip the encoder's timestamp chunks** (`png:exclude-chunks=time,date`).
  ImageMagick writes a `tIME` chunk by default, so re-running the generator a
  second later produced a different FILE with identical pixels: the Play icon
  showed as modified after every regeneration and no byte gate could pass on it
  without the pixel fallback. Encode is now a function of the pixels alone.

`design/app-icon/build-icons.mjs` needs an SVG rasterizer (`rsvg-convert` or
ImageMagick); `design/preview/capture.mjs` needs the installed Google Chrome,
headless. Both generators' outputs are committed, so building the app needs
neither.

### The committed preview frames are the resting frames

`capture.mjs` injects `animation: none; transition: none` into every capture. An
animated affordance — the streaming shimmer, the working-line spinner — has no
fixed phase in a still, so a committed still of one is a different image every
run and cannot be checked at all (that is exactly how the capture gate's first
version failed on the full-height sheets while the 844-tall frames matched).
Freezing renders each animation at its **resting frame**, which is also what the
reduced-motion contract draws, so the committed PNGs are reproducible and
diffable.

## Conventions

- **Roles, never hues.** A component names `bg-surface` / `text-ink-muted` /
  `border-control`; a hex outside `tokens.json` is a defect.
- **Generated files are never hand-edited**, and they carry a header saying so.
  `--check` makes drift a failure rather than a review catch.
- **Scratch stays out of the tree.** The capture script writes its Chrome profile
  to `$LOCAL_OPERATOR_SCRATCHPAD` (or the system temp) and the frame renders to
  `store-screenshots/out/`, which is gitignored.
- Docs use `~/` rather than absolute home paths, and carry no personal details:
  this repository is public.
