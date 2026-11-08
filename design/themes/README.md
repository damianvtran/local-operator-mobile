# The desktop themes, on the phone

The phone ships the desktop app's theme palettes — the 59 in
[`local-operator-ui` `src/renderer/src/shared/themes`](https://github.com/damianvtran/local-operator-ui/tree/main/src/renderer/src/shared/themes),
which are the product's source of truth. The mobile relay keeps its own older
copies, and those have drifted, so they are not used.

| File | What it is |
|---|---|
| `desktop-palettes.json` | The palettes as data, exported (never hand-edited) from the desktop at one commit. |
| `desktop-palettes.lock.json` | That commit plus the sha256 of every source file and of the export. |
| `export-desktop-palettes.mjs` | Writes both (`--from <checkout> --ref <commit>`), or proves them (`--check`, which re-derives the export from GitHub at the locked commit). |
| `derive.mjs` | Maps a desktop palette onto the phone's 47 colour roles: 34 copied, 13 derived and solved against the contrast floors, desktop-only roles dropped. |
| `fleet.mjs` | Runs every derived palette through the contrast contract's per-palette rules (`design/tokens/palette-rules.mjs`) and decides which ones ship. `EXPECTED_WITHHELD` pins the ones that don't, with the reason. |

`scripts/build-theme.ts` emits the palettes that ship as `THEMES` in
`src/ui/tokens.gen.ts`. At run time the app overwrites the `light` and `dark`
colour variables with the reader's two picks (`src/ui/appearance.tsx`).

## Bumping to a newer desktop

```sh
node design/themes/export-desktop-palettes.mjs --from ~/local-operator-ui --ref <commit>
node scripts/build-theme.ts
node design/tokens/contrast-contract.mjs   # read the fleet section: a palette that now
                                           # fails or now passes turns this red until
                                           # EXPECTED_WITHHELD is updated with the reason
```

## The catalogue and `design/tokens/tokens.json` are different files

`tokens.json` is the design KIT's brand layer, pinned to a kit slice and released on
the kit's cadence; `desktop-palettes.json` is the product's palette catalogue, pinned to a
desktop commit. They are allowed to disagree, and they do: the desktop re-lit its dark
ladder on 2026-11-03 (canvas L* 12.3 -> 9.9) and the phone adopted the palette, so the
canvas a frame paints is `#1d1b17` while the kit's token file still says `#22201c`.

Anything that compares a rendered frame against "the theme's canvas" must therefore read
the CATALOGUE, not the token file — `tools/visual/theme-tokens.ts`'s `paintedCanvases`
does exactly that, and `canvasExpectation` keeps the token file as the fallback for a
mode the catalogue does not carry. Measured the hard way: the web capture gate once
failed 636 dark frames for painting the right colour (QA round 1, Q164-1).

This is an interim home. Once the design kit's `app-family.json` carries the
palettes (a data-only kit release), this directory is deleted in favour of the kit
pin in `design-kit.lock.json`.
