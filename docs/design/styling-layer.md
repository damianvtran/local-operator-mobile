# The styling layer

How the design kit's tokens become the utilities the app is styled with, and the
two things about that pipeline that are easy to get wrong. ADR 0001 § "Styling
sub-decision" is the decision record; this is the implementation note, written
after the scaffold pass measured the failure modes rather than assuming them.

## The pipeline

```
design/tokens/tokens.json          the only source of colour, type and space
        │
        ├─ design/tokens/build-preset.mjs ──▶ tailwind-preset.js   (framework-agnostic)
        │
        └─ scripts/build-theme.ts ──┬─▶ src/ui/theme.css          (the styling layer)
                                     └─▶ src/ui/tokens.gen.ts      (the same values, typed)

src/ui/variants.ts    variant × size × state → class names, as pure functions
src/ui/components/    the primitives, which render what variants.ts returns
```

`scripts/build-theme.ts` reads the flattened role set from
`design/tokens/tailwind-preset.js` and **fails** if its own flattening disagrees,
so the app cannot quietly disagree with the kit about what `surface` means. Both
generated files are committed; `pnpm theme:check` fails when either is stale.

Colour roles resolve through `--color-<role>` custom properties. A component
names a role (`bg-surface`, `text-ink-muted`, `border-control`) and never a hue —
`useTokenColor()` exists only for the two APIs that cannot take a class name, a
vector icon's `color` prop and native chrome.

## The faces: a variable is not a face

`--font-sans` and `--font-mono` were emitted from the start, and every screen still
rendered in the platform face — while the kit's own reference stills render
Figtree, so the look that was approved and the look that shipped were two different
faces. Three things are needed for a face to appear, and each one failed on its own:

1. **The file.** No font file was in the repository and the export contained no
   `@font-face` rule, so `'Figtree'` resolved to nothing and the stack fell through
   to `system-ui`. Fixed by vendoring both faces (`design/fonts`) and generating the
   `@font-face` rules, with the weight range read from the token file's own `axes`.
   The served copy under `public/fonts` is verified by `pnpm theme:check`.
2. **A binding that names the family.** react-native-web hands every text node a
   platform stack, so a variable alone changes nothing; `* { font-family:
   var(--font-sans) }` in the `base` layer is the default voice, and a rule on the
   node itself is what beats an inherited value.
3. **The step's own face.** The machine voice never rendered: `text-mono`,
   `text-mono-sm`, `text-mono-code` and `text-mono-label` carried no family, so every
   chip, badge, list-row and banner identifier was sans. Tailwind's `text-<step>`
   utility reads only `--line-height`, `--letter-spacing` and `--font-weight` from a
   step's theme entry — there is **no family slot**, so a step cannot carry its face
   that way. The generated layer therefore writes one `@layer utilities` rule per
   step, from that step's own `face` token, which is also what makes the mono steps
   mono on a device.

Native needs its own handling of the same question: the family must be named in the
style, which is what those per-step rules do for text that uses a step.

**When to revisit:** if Tailwind gains a family slot on the text steps, the per-step
rules collapse into the step declarations and the note above goes with them.

---

## Uniwind, and the web target

The ADR chose Uniwind (Tailwind v4) with NativeWind v4 as the fallback. **The
fallback was not taken**: `expo export --platform web` renders the token layer
truthfully, which is the check the ADR set, and the local design and UX rounds
depend on that. Verified 2026-09-29 by exporting, serving `dist/`, and capturing
390×844 at dpr 3 in installed headless Chrome in both themes: `canvas` and `ink`
resolve to the right roles, the type ramp applies, and the OS appearance and the
in-app override each take effect.

Two defects were found on the way, and both are worth knowing because neither
reports itself as an error.

### 1. The CSS entry must be the file the bundle imports

`metro.config.js`'s `cssEntryFile` and the module the app imports have to be the
**same document**. Tailwind only compiles the CSS the bundle pulls in, so splitting
them — the token declarations in the imported module, the `@import`/`@source`
directives in a file nothing imports — produced an export where every custom
property was present and **not one utility class was**, and `expo export` still
reported success. The screen rendered completely unstyled. This is why
`src/ui/theme.css` carries both the directives and the declarations, and why there
is no second file.

### 2. One missing file upstream takes the whole web bundle down

Uniwind replaces react-native-web's component modules with its own shims: its Metro
resolver rewrites a resolution that lands on
`react-native-web/dist/exports/<Name>/index.js` into `uniwind/components/<Name>`
for every name in its `SUPPORTED_COMPONENTS` list. That list contains
`InputAccessoryView`, and uniwind 1.12.0 ships only the **native** shim for it
(`src/components/native/InputAccessoryView.tsx`) — there is no web one, so
`exports["./components/*"]` points at a file that does not exist. The resolver then
throws, and because react-native-web's own `dist/index.js` re-exports that
component, the entire `--platform web` bundle fails with
`Unable to resolve module ./exports/InputAccessoryView`.

`metro.config.js` carries a guard scoped to **that one specifier**: when uniwind
throws on `InputAccessoryView`, Metro's own resolution is used instead, and a
warning is printed. For this component that is also the correct answer —
react-native-web renders it as `UnimplementedView`, and uniwind ships no web
implementation for it to shadow. Nothing in `app/` or `src/` imports it; it is in
the graph only because react-native-web's index re-exports every component.

**Why the guard is scoped rather than general.** A blanket "fall back whenever
uniwind declines" would convert any *future* uniwind failure into a silent
downgrade: a component the app does use would lose its class-name handling, the
screen would render unstyled, and `expo export` would still report success. That is
the one failure mode of this pipeline that does not announce itself. Scoped this
way, any other failure fails the build loudly.

**When to revisit:** the warning is the signal. If uniwind ships the missing shim
the guard is dead code and should go; a warning that ever names a *different*
module cannot happen while the guard is scoped — the build will fail instead, and
that failure is the signal that a component the app uses has hit the same gap.
