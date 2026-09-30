# Fonts

The kit's two faces, vendored so the app can render them offline. Both are under
the SIL Open Font License 1.1, and `OFL.txt` in this directory carries the
upstream copyright notices and the licence text — the obligation that travels with
the files.

| File | Face | Weight | Consumer |
|---|---|---|---|
| `figtree-variable-latin.woff2` | Figtree (variable, latin) | 300–900 | the web target |
| `jetbrains-mono-variable.woff2` | JetBrains Mono (variable, full) | 100–800 | the web target |
| `Figtree-Regular.ttf` | Figtree | 400 | iOS, Android |
| `Figtree-Medium.ttf` | Figtree | 500 | iOS, Android |
| `Figtree-SemiBold.ttf` | Figtree | 600 | iOS, Android |
| `JetBrainsMono-Regular.ttf` | JetBrains Mono | 400 | iOS, Android |
| `JetBrainsMono-SemiBold.ttf` | JetBrains Mono | 600 | iOS, Android |

## Why two formats

The web target needs a file a browser can fetch. Figtree's is the latin subset the
marketing site already ships (`@fontsource-variable/figtree`, 20 KB); JetBrains
Mono's is the **full-charset** variable file (111 KB), not the latin subset the site
ships (40 KB), because the machine voice prints the state glyphs — `✓` `✗` on a
banner, an alert and a toast — and those are outside the latin subset. Measured, and
the measurement is why the subset was dropped rather than given a wider
`unicode-range`: with the range bypassed by an injected face, the latin file still
rendered the glyphs from the platform's symbol font, so it does not contain them.
A wider range alone would not have fixed it.

`scripts/build-theme.ts` copies both files to `public/fonts/` — which Expo serves at
`/fonts/…` — and emits the matching `@font-face` rules into `src/ui/theme.css`,
stating the subset range only for the face that is a subset. The copy is verified by
`pnpm theme:check`: a served file that drifts from its source is a face that silently
falls back to the platform font.

Native needs files the packager can embed, and React Native picks a face by
**family and weight**, not by a variation axis. So the native half is one static
file per weight the type ramp actually uses (400, 500 and 600 for Figtree; 400 and
600 for JetBrains Mono), listed in the `expo-font` plugin in `app.config.ts`.

The variable *TTF* is deliberately not used natively even though it is one file per
face: its family record is `Figtree Light` (its typographic family is `Figtree`, its
family record is not), so a style asking for `Figtree` matches nothing and falls
back to the platform face — the exact defect this directory exists to remove. The
weight instances avoid the question entirely.

## Provenance

| Face | Source | Version |
|---|---|---|
| Figtree | `github.com/erikdkennedy/figtree`, `fonts/ttf/` (statics) and `fonts/variable/` | upstream `master`, read 2026-09-30 |
| JetBrains Mono | `github.com/JetBrains/JetBrainsMono`, `fonts/ttf/` (statics) and `fonts/webfonts/` (variable woff2) | upstream `master`, read 2026-09-30 |

Figtree's woff2 subset was copied from the installed `@fontsource-variable` package in
the marketing site checkout, so the app and the site render the same file for it.

What was verified before vendoring (and how, so it can be repeated): each TTF's
`name` table was parsed for the family, subfamily and PostScript records, which is
what the two platforms match a style against. `JetBrainsMono-SemiBold.ttf` and
`Figtree-Medium.ttf`/`Figtree-SemiBold.ttf` carry their weight in the *subfamily*
record and the bare family in the typographic record, which is the naming the
platforms resolve — the `Figtree Light` case above is what that check is for.

Weights not vendored are weights no step uses. Adding one means adding the file
here and to the plugin list in `app.config.ts`, in the same commit as the step that
needs it.
