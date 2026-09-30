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

## The four commands

```sh
node design/tokens/contrast-contract.mjs          # the colour gate; must exit 0
node design/tokens/build-preset.mjs               # regenerate the preset + preview CSS
node design/tokens/build-preset.mjs --check       # fail if the generated files are stale
node design/preview/capture.mjs                   # capture the preview sheet (both themes)
```

`node design/app-icon/build-icons.mjs` regenerates the icon and splash PNGs; it
needs an SVG rasterizer (`rsvg-convert` or ImageMagick) and says so with install
lines if it cannot find one. The PNGs are committed, so building the app never
needs it.

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
