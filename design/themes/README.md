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

This is an interim home. Once the design kit's `app-family.json` carries the
palettes (a data-only kit release), this directory is deleted in favour of the kit
pin in `design-kit.lock.json`.
