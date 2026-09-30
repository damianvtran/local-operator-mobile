# Icon Composer layers

The source layers for an iOS 26 `.icon` bundle, plus what to do with them.

## The files

| File | Layer | Contents |
|---|---|---|
| `01-background.svg` | 1 of 2, **backmost** | A flat opaque ground, `#14110c`. No gradient, no vignette |
| `02-mark.svg` | 2 of 2, **frontmost** | The mark alone, `#f1eee6`, on a transparent 1024 canvas |

Both are flat, opaque and unshadowed **on purpose**. Depth, blur, specular
response, refraction and translucency belong to Icon Composer; baking them into
the source art removes the ability to tune them per appearance, and it means the
art has to be redrawn for each one.

## Layer ordering — the part that is easy to get backwards

- In the **source files**, `01` is the bottom of the z-stack and `02` sits above
  it, which is the order a human expects.
- In a generated `icon.json`, `groups[].layers` is written **front to back**:
  the FIRST entry renders on TOP. Local evidence from Icon Composer and Quick
  Look agrees on this, and it is the opposite of the source numbering. If the
  background ends up over the mark, that is why.
- Treat the `.icon` schema as **observed, not documented**: it is not a stable
  public format (Apple's own docs cover the tool, not the file). Fields seen in
  real bundles include `groups[].layers[].image-name`, `position`, `opacity`,
  `blend-mode`, `fill`, and their `-specializations` variants, plus group-level
  `specular`, `translucency`, `refractivity`, `shadow` and `blur-material`. The
  conservative defaults above are deliberate.

## How to build the bundle

Icon Composer is a macOS app and is **not** available in this repository's CI or
on a Linux contributor's machine, which is why the layers are committed as SVG
and the three rendered PNGs are committed alongside them:

1. Open Icon Composer, create an icon, and import `01-background.svg` then
   `02-mark.svg`.
2. Set the canvas to 1024.
3. Check all three appearances — default, dark and tinted. The tinted appearance
   is derived from the user's wallpaper; do not set a hue here.
4. Export the `.icon` directory into the app's assets and point
   `ios.icon` at it (Expo SDK 54+ supports a `.icon` directory; see
   <https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/>,
   read 2026-09-29).

If the project does not adopt a `.icon` bundle in its first release, the three
committed PNGs are the fallback and cover the same three appearances:
`ios.icon = { light, dark, tinted }`.

## Regenerating the layers

`node design/app-icon/build-icons.mjs` rewrites both layers from the geometry in
that script, which is the site's own mark. Do not hand-edit either SVG: the
geometry is generated precisely so that nobody has to keep two copies of the mark
in sync.
