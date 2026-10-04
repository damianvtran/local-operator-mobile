# Brand kit

What the Local Operator mobile app looks like, why, and which decisions are
already made. This file is the *why*; [`components.md`](./components.md) is the
*what* for each primitive, and `design/tokens/tokens.json` is the *values*.

Written 2026-09-29 for `damianvtran/local-operator-mobile`, a new public
repository. The app is a native iOS and Android client for the `lop mobile`
relay — the same product as the desktop app (`damianvtran/local-operator-ui`)
and the marketing site (`local-operator-site`), on a phone.

---

## 0. The one sentence

**Warm paper, near-black ink, one green that means "the agent is working", and a
mono voice for anything the machine said.**

Everything below is a consequence of that sentence. Where a rule looks arbitrary,
the sentence is the tiebreak.

### 0.1 What this kit is derived from, and what it is not

Three artefacts already exist. This kit is a *port*, not a fourth opinion.

| Artefact | What it is | How this kit uses it |
|---|---|---|
| `~/local-operator-site/docs/design-kit/` | The marketing site's system: tokens, typography, components, motion, voice, and the executable `contrast-contract.mjs` | The **register** — the warm-paper grounds, the semantic triples, the two shadows, the motion durations and easings, the contrast floors, and the contract script's shape. Its light accent is the one value NOT taken, and § 2.1 gives the measurement |
| `~/local-operator-ui/docs/branding.md` + `src/renderer/src/shared/themes/palettes/local-operator.ts` | The desktop app's 59-theme system and its two brand palettes, `localOperatorDark` and `localOperatorLight` | The **palette and the role names**, including the accent ramp in full. These are the app's own brand palettes and they ship here verbatim |
| `~/local-operator/local_operator/mobile/web/src/` | The shipped phone web client (React + Tailwind v4) | The **phone-shaped decisions** — the touch floors, the 16pt input floor, the machine-voice split, the 44px control height, the streaming shimmer, the diff row tint |

The precedence rule, inherited from the desktop app and unchanged here: **on the
brand the kit wins; on how a phone should behave this repository wins, because a
surface read at arm's length in a moving hand is not a page read once at a
desk.** Where they disagree, this file says so explicitly and says which clause
invoked it.

### 0.2 The three families of rule in this file

1. **Brand** — colour values, the mark, the type families. These come from the
   existing kits and are **not** open for retuning by an implementation pass. A
   brand colour changes in the kits and is followed here.
2. **Phone behaviour** — touch geometry, safe areas, keyboard, Dynamic Type.
   The shipped web client and the two platform guidelines are the authority.
3. **Proposals** — the mobile type steps, the component specs, the app-icon
   layering. Researched, measured where measurable, and **expected to be
   validated on a real device**. Marked as proposals where they are.

---

## 1. The mark

### 1.1 Which mark, and where it came from

There is exactly **one** mark: a figure whose limbs terminate in graph nodes — a
head circle, a raised arm ending in a node, a foot node, a torso stroke. It is
rendered from the same geometry the site ships as `LogoMark`
(`~/local-operator-site/src/components/ui/logo-mark.tsx`, `viewBox="285 253 520
520"`, traced from `src/assets/lo-logo-light-mode.png` rather than redrawn).

**The mark is monochrome and inherits `currentColor`.** That is not a
simplification, it is why it works on a phone: one asset serves both themes,
there is no light/dark PNG pair to keep in sync, no `filter: invert` to break in
dark mode, and no resampling blur at 20pt.

Three overlapping sources paint marks, and they are not interchangeable:

| Source | What it is | Where it is right |
|---|---|---|
| **SVG, `currentColor`, stroke** | The mark as vector strokes, the site's own geometry | **Everything in the app's UI.** Headers, empty states, the about screen. One file, both themes, any size |
| `~/local-operator-ui/resources/icon.png` (1024²) | The mark **inverted to white**, on a near-black filled circle that fills the whole canvas | The **app icon**, where iOS/Android supply the mask. Never in-flow: a filled disc in a list header is a logo pretending to be a button |
| `local-operator-icon-2-{light,dark}-clear.png` (2048×750) | Mark + wordmark lockup, horizontal, clear background | **Store listings, README, the website.** It is a lockup, so it is wide by construction — 318×348 of actual artwork in a 2048×750 canvas, i.e. mostly empty. Never scale it down to fit a header; crop or use the SVG |

### 1.2 Usage

| Surface | Mark | Rules |
|---|---|---|
| App bar / header | SVG, 24pt, `ink` | Paired with the wordmark or with a back control that already carries a name; never the sole content of a control unless that control carries the name |
| Empty states | SVG, 48pt, `ink-dim` | The mark is decoration here; the state's sentence is the content |
| Launch screen / splash | SVG, 96pt, `ink` on `canvas` | One mark, centred, nothing else |
| App icon | `icon.png` family, 1024² source | See § 6. The icon is **not** the mark at 24pt with padding — see § 6.2 for why the family has a minimum |
| Store listing | The 2048×750 lockup | Plus the app icon at 512², and screenshots (§ 7) |
| Favicon / web surfaces | Existing site favicons | There are none in this app; the site owns them |

### 1.3 Clear space and minimum sizes

**Clear space** is one **node radius** on every side — the small circle in the
raised arm, i.e. **0.081 × the mark's rendered size**. In practice: at 24pt, 2pt
of clear space; at 48pt, 4pt. The rule exists because the mark's outermost
element is a circle, and a circle touching a rule or a neighbouring glyph reads
as clipped even when it is not.

**Minimum sizes**, and there is more than one floor because the mark has three
kinds of detail:

| Rendering | Floor | Why |
|---|---|---|
| SVG, both themes | **16pt** | Below this the three stroke weights (35, 29, 33 in source units) collapse to under a pixel each and the nodes fill in. 16pt is one pixel of stroke at 1x |
| App icon, iOS | **1024² source** | Platform requirement, and it is the honest one: the icon is scaled to 40pt in a notification context and 1024 gives the rasteriser room |
| Any raster of the mark | **Avoid** | A rasterised 24pt mark on a 3x screen is a second, softer rendering of the same idea. If a platform forces a raster (an icon, a splash on Android), export it at the exact size class it will be drawn |
| Wordmark lockup | **96pt tall** | Below it the wordmark's counters close up. This is why the lockup is for store art and nothing in-app |

### 1.4 Light and dark

One SVG, two inks. On `canvas` in dark, the mark is `ink` (`#f1eee6`); in light,
`ink` (`#211e18`). **The mark is never `accent`.** The green is spent on state
(§ 3.4); a logo in the accent colour spends the signal on the brand, which is
exactly the trade the accent budget exists to prevent.

### 1.5 Do / don't

| Do | Don't |
|---|---|
| Use the SVG at 24pt in a header | Crop the 2048×750 lockup down to a header glyph |
| Keep the mark monochrome, on `ink` or `ink-dim` | Recolour the mark green, or gradient-fill it |
| Pair it with a wordmark or a named control | Give the SVG a `<title>` when a sibling already names it (it is announced twice) |
| Let the platform mask the app icon | Bake rounded corners, a shadow, or a bezel into the icon source |
| Keep one node-radius of clear space | Place the mark so a circle touches a divider or a screen edge |
| Put the wordmark sideways-on the icon | Put text **beside** the mark inside the icon — Apple's own guideline, and it is why the icon family needs no wordmark |

---

## 2. Colour

### 2.1 The mapping decision, stated

**The default dark theme is the desktop app's `localOperatorDark`; the default
light theme is `localOperatorLight`.** Not the site's ramp, and not a new one.

```
localOperatorDark   canvas #22201c   ink #f1eee6   accent #38c96a
localOperatorLight  canvas #f2ede3   ink #211e18   accent #137742
```

Why the app's palettes rather than the site's, when the site's is the one
designed as a brand artefact:

1. **The phone is the same product as the desktop app**, and the warm-near-black
   ground is what a user who has used both already recognises. A user moving
   from the desktop app to the phone should see the same surface, not a
   differently-temperatured one.
2. **The desktop ramp is already solved for a working surface** — four grounds
   with a measured ladder, three ink weights at 7.0 / 5.5 / 5.0 on all six
   grounds, and a row-state pair (`rowHover`, `rowSelected`) the site does not
   have at all. A phone list needs hover/press/selected row states more than a
   marketing page does.
3. **`info` exists here and not on the site.** The desktop contract defines a
   fourth semantic; the phone needs it (a queued command, a hunk header, a
   neutral notice). Deriving a fourth semantic for a new palette is how a fourth
   hue gets invented by accident; taking the one that already exists does not.

**What is taken from the site instead:** the semantic triples, the accent WASH
values as the faintest tint, the line weights (`hairline` decorative,
`border-control` structural), the two shadows, the motion tokens, the radii cap
("nothing above 16px; an out-of-scale value renders a square corner rather than
silently working"), and the scroll/segment conventions.

#### The one value the two sources disagree on, and why the app's wins

The **light accent** is the single divergence, and it is recorded rather than
smoothed over. The site ships `#177b45` for that role; this app ships the desktop
app's `#137742`. Measured on 2026-09-29 against this role set, the site's value
fails the contract on two of the app's grounds:

| Pair | Site `#177b45` | App `#137742` | Floor |
|---|---|---|---|
| accent on `sunken` | **4.27** ✗ | 4.51 | 4.5 |
| accent on `row-selected` | **4.29** ✗ | 4.53 | 4.5 |
| accent on `canvas` | 4.55 | 4.81 | 4.5 |
| accent on `surface` | 4.87 | 5.14 | 4.5 |

**The cause is the ground ramp, not the hue.** The desktop app's light ramp is
deliberately wider than the site's — the desktop branding doc names exactly two
sanctioned deviations from the kit, and this is the first: a page renders one
surface where this app stacks four, so the site's near-white ladder made a panel
on canvas and a popover on that panel the same pixel to the eye. A link colour
solved for one page ground therefore does not clear the four grounds plus two row
states this app has, and `sunken`/`row-selected` are exactly where it lands
short. The dark accents agree between the two sources (`#38c96a`), so this is a
light-theme question only.

Reconciling it means changing one of the two ramps, not shipping `#177b45` into
the app; anyone who wants the site's green here has to bring the grounds that
made it work with it. `tokens.json § $meta.accentDivergence` carries the same
measurement next to the values.

### 2.2 The four grounds, and the ladder

`canvas` (page) → `surface` (cards, rows, inputs) → `elevated` (sheets, dialogs,
pressed rows), plus `sunken` **recessed below canvas** for wells: tool output,
diffs, code, tracks.

The ladder is a measurable contract, not a mood, and
`design/tokens/contrast-contract.mjs` asserts it as lightness inequalities
(`elevated > surface > canvas > sunken`, with `message-surface` between `surface`
and `elevated`). Measured L\* on 2026-09-29:

**The four grounds, and the message surface:**

| Ground | Light L\* | Dark L\* |
|---|---|---|
| `elevated` | 99.31 | 18.67 |
| `message-surface` | 98.59 | 17.21 |
| `surface` | 96.51 | 15.87 |
| `canvas` | 93.88 | 12.33 |
| `sunken` | 91.41 | 9.92 |

**Row states — a step of the panel's own value at the panel's own hue, NOT a
rung of the ladder.** They are listed separately because the arithmetic that
makes a row state right is different from the arithmetic that makes a ground
right: `row-hover` sits *below* light `canvas` (93.35 < 93.88), and dark
`row-selected` sits *above* dark `elevated` (19.93 > 18.67). Both are correct —
a hover is a step of the surface it is drawn on, and a selected row is a step
*depending on the selection* — and both would look like a ladder violation in a
single table. Do not "fix" them into it.

| Row state | Light L\* | Dark L\* | What it is |
|---|---|---|---|
| `row-hover` | 93.35 | 18.65 | the panel at its own hue, +2.78 L\* in dark |
| `row-selected` | 91.58 | 19.93 | +4.06 L\* in dark, the pair ranking 1.28 L\* and 5.4 C\* apart |

Two consequences worth naming, because both are the reason a phone palette goes
wrong:

- **Elevation for in-flow content is a background step, never a shadow.** A
  phone has less room for a soft edge and more need for grounds to be told apart
  by their own value. There are exactly two shadows in the system and both are
  for objects that *leave* the flow (§ 5).
- **The grounds are separated by 2.5–5 L\*, not by taste.** On a phone held at
  arm's length in daylight, a 1 L\* step between a card and the page is not a
  card.

### 2.3 Roles, never hues

A component names `bg-surface`, `text-ink-muted`, `border-control`. It never
names a colour. This is what lets the palette be swapped — and it is not
hypothetical: the desktop app ships **59 selectable themes** and the phone web
client already ships 28 of the same palettes.

**The consequence for this app is a scope decision, stated rather than implied:
the mobile app's theme *system* is the same role contract, but the shipped theme
*set* is `localOperatorDark` and `localOperatorLight` plus a "follow the system"
option.** Porting 59 palettes to a phone is a port of 59 palettes' worth of
contrast verification, and the contrast contract here asserts two themes. If a
later pass wants the community themes, it ports the palettes *and* widens
`design/tokens/contrast-contract.mjs` to loop over them (the site's script
already documents that shape), in the same change. Shipping a palette that no
script has measured is the failure mode the contract exists to prevent.

### 2.4 The accent budget

One green. `#137742` on light, `#38c96a` on dark. It means **"the agent is doing
something, or you can act here"**, and it is spent on:

| Spent on | Why |
|---|---|
| The one primary action in view (send, approve) | There is at most one per screen; two things equally important means neither is |
| Working state: the streaming caret, the shimmer, the spinner's arc | Motion plus colour is the strongest signal available, and it is the app's core claim |
| The focus ring | Non-text, needs 3:1, and is the only place a system-wide ring can get it |
| Links, and a selected segmented item | Convention |
| An unread dot on a list row | The one "there is something new" mark |

**Never spent on:** the mark, headings, a static decoration, a border that is not
focus, or a second action in the same band. The budget is real: a screen with
green in four places has no accent, only a colour scheme.

**The one hard prohibition, inherited from the site kit: white ink never touches
the dark accent.** `#ffffff` on `#38c96a` measures **2.16:1**; it is the most
common contrast bug in green systems and the contract pins it as a negative
assertion. The dark ramp's ink on the dark accent is near-black `#16130e`,
measuring **8.58:1**. In light the accent is dark enough that white is correct
(`on-accent` `#F6FAF8`, **5.33:1**).

### 2.5 Ink weights and the structure ink

| Role | Light | Dark | Job |
|---|---|---|---|
| `ink` | `#211e18` | `#f1eee6` | Headings and body prose. 13.4–16.3 (light) / 11.4–14.8 (dark) on every ground |
| `ink-muted` | `#4e4940` | `#c2bcaf` | Secondary body, a tool row's verb, a card's body |
| `ink-dim` | `#656056` | `#a6a091` | Captions, counts, meta, placeholder, a diff's context lines. The dimmest ink that still clears 4.5:1 everywhere: measured 5.02 minimum (light, on `sunken`) |
| `ink-disabled` | `#9a9488` | `#5f5a4e` | Disabled control text **only**, exempt under SC 1.4.3 |
| `border-control` | `#857f70` | `#837c6d` | The **structural** line: any 1px rule that is the *sole* boundary of required content. 3.20–3.92 light, 3.18–4.14 dark |
| `panel-edge` | `#dad5cb` | `#857b69` | **Scoped**: the edge of an overlay panel over a scrim — the conversations drawer. It reads against the dimmed content it separates from: 4.53:1 dark against the scrim ground and 3.28:1 against its own panel; light keeps the hairline's step (5.68:1 against the light scrim ground). Never a control boundary — controls keep `border-control` |

`hairline` and `hairline-strong` are **decorative and may never be a sole
boundary**: measured 1.18–1.54 across all grounds. The contract asserts that as a
*negative* — if a hairline ever reaches 3:1, the distinction between a rule and a
border has been lost, and the run fails to make someone read it.

**`ink-dim` is the dimmest text on a phone.** The site kit compiles a list of
pairs that may not use it (its `accent-muted` measures 4.24 light / 3.67 dark
there). This ramp's `accent-muted` is a different value and `ink-dim` on it
measures **4.70 light / 4.77 dark** — legal, measured, so the prohibition list
here is shorter than the site's. That is not a licence to reach for it: the rule
is that a *solid tinted fill* takes `ink` or an accent step, and it holds here by
margin rather than by luck. The contract pins `on-accent` on `accent-muted`
(1.26 / 1.49) as prohibited so a future edit cannot drift into it.

### 2.6 Semantics, and the diff

Four semantics, each a triple (`ink`, its `wash` ground, its `border` for the
box's own edge):

| Semantic | Light | Dark | Meaning |
|---|---|---|---|
| `success` | `#19764a` | `#57c785` | Completed, added, connected |
| `warning` | `#8a5800` | `#e0b04b` | Blocked, degraded, budget |
| `danger` | `#b23a31` | `#ef8078` | Failed, denied, removed, needs a decision |
| `info` | `#2368a8` | `#86b3f2` | Neutral notice, a queued item, a hunk header |

**A semantic colour is never the only channel.** Every one of the eight states
in [`components.md`](./components.md) § 1 carries a mark, a word, or a glyph
beside the colour, because a red button cannot say *what* failed.

**The diff is evidence, not decoration.** Tool output is the app's proof that
work happened, so the diff has its own measured roles rather than borrowing the
semantic inks freehand:

| Role | Light | Dark | Job |
|---|---|---|---|
| `diff-add` / `diff-add-surface` | `#19764a` / `#e6f1ea` | `#57c785` / `#23352a` | An added line's ink and row tint, and the `+N` counter |
| `diff-remove` / `diff-remove-surface` | `#b23a31` / `#f7e7e4` | `#ef8078` / `#432a26` | A removed line and `−N` |
| `diff-hunk` / `diff-hunk-surface` | `#2368a8` / `#e9ebef` | `#86b3f2` / `#22303f` | A `@@` header |
| `diff-context` | `#656056` | `#a6a091` | Unchanged context: dimmer than the change, so the change is what the eye lands on |

**The dark tints are NOT the dark semantic washes, and the reason is a
measurement.** A wash is painted on `canvas`; a diff tint is painted inside the
`sunken` well, which is darker. Reusing the dark wash (`#16281d`) there measures
**1.11:1** against the well — a step no reader can see, so the diff's only
channel was its text colour, and the row tints may as well not have been drawn
(this was found by looking at the rendered sheet, not by reading the tokens). The
dark tints are re-solved to a perceivable step — **1.28–1.32:1** against
`sunken` — while keeping their chroma.

**The light tints are unchanged, at 1.04–1.07:1, and that is not an
inconsistency.** At L\* ~92 chroma resolves easily, so a pale green row beside a
beige one reads as two rows on hue alone; at L\* ~10 chroma compresses and only a
luminance step survives. The lesson generalises past this table and is the reason
the kit measures both themes rather than one: **a value that works in light can be
invisible in dark without anything about the token looking wrong.**

Measured ink-on-tint, light / dark: success **4.86 / 6.14**, danger **4.94 /
5.02**, info **4.86 / 6.24** — all above the 4.5:1 floor. The tint is the *wash*
and never a saturated fill: a long diff in saturated red is a wall, and the
reader stops reading the lines. `design/tokens/contrast-contract.mjs` asserts the
tint step against the well in both themes, in a band per theme, so an edit that
moves a tint out of its band re-opens this reasoning rather than passing
silently.

---

## 3. Typography

### 3.1 What ships in the app, and the licence to do it

**Two families ship: Figtree (sans) and JetBrains Mono (mono). Fraunces does not
ship in the UI.**

| Role | Family | Weights | Licence | Copyright notice to retain |
|---|---|---|---|---|
| UI and body | **Figtree Variable** | 300–900 | **SIL OFL-1.1** | `Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)` |
| Machine voice | **JetBrains Mono Variable** | 100–800 | **SIL OFL-1.1** | `Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)` |
| Display (store art / launch only) | **Fraunces Variable** | 100–900, `opsz` | **SIL OFL-1.1** | `Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces)` |

**Licence obligations, discharged in this repository:**

- OFL-1.1 permits bundling, embedding in an installed app, subsetting and
  redistribution including commercially. Two obligations bind: **keep the
  copyright and licence notice with the font files**, and **do not sell the fonts
  on their own**. Since this repository is **MIT** and ships an app that is free
  and open source, the second is trivially satisfied; the first is why
  `design/fonts/OFL.txt` carries all three notices verbatim and sits beside
  whatever font files an implementation pass bundles.
- **Do not rename the families.** The OFL's Reserved Font Name clause is the one
  people trip on: a variant named "Local Operator Mono" is a licence violation.
- Fonts are **self-hosted, never fetched at runtime**. Three reasons, in order:
  a phone may be offline; a font request from a local-first app is an
  unexplained outbound call; and a late-loading font reflows the transcript
  under the reader's thumb. React Native takes `require`d asset files; a web
  target takes the same version-stamped `woff2` files the site serves
  (`figtree-5.3.0-latin.woff2` and friends, ~20 KB and ~40 KB, plus the
  `-latin-ext` companions where a translation needs them).
- A convenient delivery route, if the toolchain is Expo: `@expo-google-fonts/figtree`
  and `@expo-google-fonts/jetbrains-mono` (both `0.4.1`, `MIT AND OFL-1.1`,
  ~1.97 MB and ~3.43 MB unpacked, checked 2026-09-29) — the OFL files ship in
  the package. Bundling the two `woff2`/`ttf` files directly is smaller and
  gives the same legal position; either is fine, and the licence text must be
  present either way.

### 3.2 Why Fraunces is not in the app UI

Fraunces is a **marketing-register** choice: it says "a well-made thing" to
someone deciding whether to download. An app a user is *inside*, on a phone, for
minutes at a time has different priorities, and a serif in a dense tool reads as
costume. The desktop app's handoff doc reaches the same conclusion and calls it
an open question rather than a ruling
(`~/local-operator-site/docs/design-kit/handoff-local-operator-ui.md`, read
2026-09-29: *"adopt Figtree for everything in the app … treat the display serif
as a separate proposal evaluated on a real screen"*).

**This kit takes that recommendation and names where Fraunces does earn its
place**: the store listing, the launch screen's wordmark, and the first frame of
onboarding. Those are the three surfaces where the register is a decision rather
than a working surface. If a later pass wants a display step on an empty state,
that is a proposal to be judged on a rendered frame — and the type scale survives
either answer, because a step never encodes a family.

### 3.3 The mobile scale

The scale is the desktop app's, with the reading steps raised one step for a
device held at arm's length. Full table in `design/tokens/tokens.json` § `type`.

| Step | pt | Line height | Weight | Face | Used for |
|---|---|---|---|---|---|
| `display` | 28 | 1.20 | 600 | sans | The screen title: Sessions, a conversation name on its own screen |
| `title` | 20 | 1.30 | 600 | sans | Sheet titles, section titles |
| `heading` | 17 | 1.35 | 600 | sans | Group headings, card titles |
| `body-lg` | 17 | 1.50 | 400 | sans | **The reading surface**: assistant prose and the user's own turn |
| `body` | 16 | 1.50 | 400 | sans | Default prose, form labels, **the composer** |
| `body-sm` | 14 | 1.45 | 400 | sans | List rows, a tool row's summary, card body |
| `meta` | 12 | 1.40 | 500 | sans | Captions, counts, the attention word |
| `label` | 15 | 1.20 | 600 | sans | Buttons, tabs, segmented items |
| `mono` | 13 | 1.50 | 400 | mono | Paths, model slugs, ids, elapsed, counts |
| `mono-sm` | 12 | 1.45 | 400 | mono | The same voice in a dense row: tool names, diff counts, the cwd line |
| `mono-code` | 13 | 1.60 | 400 | mono | Code blocks and diff lines — the one place mono may wrap |

**`body` is 16pt, and that is a floor, not a preference.** Below 16px **iOS
zooms the whole page on focus**, which moves the layout under the user's thumb
exactly when they are typing. The shipped web client sets its textarea at
`text-[16px]` for this reason and the contract asserts the step.

**Weight 600 rather than 700.** Figtree at 700 on a warm ground next to a
near-black ink reads as shouting at 14pt; 600 holds the hierarchy with room left
for an emphasized word inside a row.

### 3.4 Dynamic Type, and what a naive implementation gets wrong

Scaling **is left on** for every text style. No `allowFontScaling={false}`
anywhere; on Android no size in `dp` where it should be `sp`. There is no case
in this app where a reader asking their phone for larger text should be refused.

| Rule | Value |
|---|---|
| Default cap | **2.0×** |
| Cap where geometry is fixed by something other than text | **1.4×** |
| Routine test multiplier | **1.3×** — every layout must survive it with nothing clipped or overlapping |
| Accessibility case | **2.0×** — a long value may wrap to a second line there; it may never be cut |

The 1.4× cap is permitted **only** where a row's height is pinned by something
other than its text *and* the text can ellipsize: a session row's title, a tool
row's name, a chip label. **Capping a step whose text has room to grow is a
defect**: the cap is a layout constraint, never a preference.

**Rows are sized by content plus padding, not by a fixed height.** The 44pt touch
floor is a *minimum*, and a row grows past it at 1.5× rather than clipping. This
is the single most common Dynamic Type failure in list-heavy apps and it is worth
stating in the token file rather than discovering on a device.

### 3.5 Numerals and the machine voice

`tabular-nums` on anything in a column or changing in place: elapsed times,
counts, diff totals, `2/5` task counts. A proportional numeral in a row that
ticks makes the whole row jitter.

**Monospace is machine voice, and it is a signal — rationing it is what keeps it
one.** Mono is for: paths, cwd, filenames, model slugs, ids, versions, counts,
elapsed times, diff lines, code, and a tool row's *object*. It never carries
prose, a heading, a button label or an error sentence.

The shipped client's split is the model: a tool row's **verb** is a word in the
reader's language and sits at `body-sm` in `ink-muted`; the **name** beside it is
mono in `ink-dim`. The whole row in mono reads as a terminal, which is the
failure mode the split exists to prevent.

**State glyphs are text, not icons.** `✓ ✗ ⟳ ⋯ – ☐ ☑ ~ -` in the mono face, as
the TUI and the web client both ship them, because they survive every system font
and never render as tofu — the shipped client's own comment records that `⟳` and
`☐` *did* render as tofu in one icon-font path and that the text marks are the
fix. An icon font for state would also be a second drawing pen in a system whose
whole icon rule is *one pen*.

---

## 4. Voice

The site's voice file is the authority
(`~/local-operator-site/docs/design-kit/voice.md`, and `docs/copy.md` for the
string-level register); this section is the pointer plus the phone-specific
additions. Eight principles, of which four are load-bearing on a small screen:

| # | Principle | The phone consequence |
|---|---|---|
| V1 | **Say what happens, on whose machine.** Name the computer, the files, the code | "Started in `~/local-operator`", not "Session initialised" |
| V2 | **No jargon noun where an everyday noun works** | "agents", "tasks", "waiting for you" — never "subagent dispatch", "tool invocation" |
| V3 | **No adjective doing a verb's job.** Every claim is checkable or it is cut | "3 files changed", never "smoothly handled" |
| V5 | **Second person, possessive, plain negation** | "your files don't leave your computer" |
| V8 | **Honesty about friction is a voice feature** | A dropped stream says so, in the same register as everything else. The shipped client's `Couldn't continue this conversation. Try again.` and `Retry earlier instruction` are the model |

**Phone-specific rules:**

- **The label keeps the noun and drops the sentence.** A button says `Send`,
  `Approve`, `Deny`, `Stop`, `Retry`. A failure is never a button's label; it is
  the line beside it (see `components.md` § 9).
- **An error names the thing that failed and the next action**, in that order.
  `Couldn't reach your computer. Check the tunnel is running.` beats `Network
  error` — and it must not promise a recovery the app cannot perform.
- **Empty states do not apologise and do not exhort.** `No sessions yet` plus
  what to do. The shipped client's `no sessions running` / `start one below, or
  from the TUI on your machine` is the register.
- **Never claim a feature is shipped before it is.** The store description is
  prose the team has to keep true.

---

## 5. Motion, elevation and haptics

Motion tokens are the kit's, unchanged, and the contract is the site's with one
phone addition.

| Token | Value | Used for |
|---|---|---|
| `instant` | 80 ms | A press's colour step. Below ~100 ms reads as instantaneous, which is what a press should feel like |
| `fast` | 120 ms | Hover/press/focus/border transitions, and the reduced-motion transition cap |
| `base` | 180 ms | Active indicators, segmented moves: the shortest duration in which a *position* change reads as movement rather than a jump |
| `slow` | 240 ms | A sheet rising, a height change |
| `reveal` | 320 ms | Scroll entrances. A phone reads less at once, so this is rarer here than on the web |
| `draw` | 480 ms | Stroke draw (~400 ms reads as a flicker rather than a hand) |
| `beat` / `close` | 700 / 400 ms | A multi-step emphasis sequence, in the store art and the site — **not in the app** |

Easings: `out-quart` is the default, `out-expo` for an overlay arriving,
`in-out` for a reversible toggle, `linear` for loops only.

**No spring. No bounce. No overshoot. Anywhere.** Spring physics say *this object
has mass and just landed*; nothing in this interface is an object with mass, and
a spring makes the duration non-deterministic, so it cannot be budgeted for a
reduced-motion reader. Total auto-playing sequences stay under **4.4 s** (clear
of SC 2.2.2's five-second threshold).

**Reduced motion is not a kill switch** — every piece of information the motion
carried must survive it. The table of what survives is in `tokens.json`
§ `motion.reducedMotion.mustSurvive`: the shimmer stops and a still caret
remains, the danger pulse stops and the word `approval` remains, the spinner
stops and a static ellipsis plus a polite live region remain, the skeleton keeps
its lifted resting tone (which is lifted *precisely so* a still frame still
reads as a placeholder).

**The kit's own committed frames are captured with motion off**, so every still
in `docs/design/preview/` is the resting frame of each animation. That is not a
convenience: an animation has no fixed phase in a still, so a committed capture
of one is a different image every run and cannot be diffed at all — which is how
the capture gate first failed on the full-height sheets while the 844-tall frames
matched byte for byte. See `design/README.md`.

**Elevation.** Two shadows and no more: `overlay` (a sheet, a dialog, a popover —
an object that leaves the flow) and `frame` (an image shown as a matted object).
React Native sets `shadow*` for iOS and `elevation` for Android and gets nothing
on the other platform if only one is set; both values are in the token file
(`elevation.overlay.androidElevation = 8`).

**Haptics — a phone addition, and it is not decoration.** The phone has a channel
the desktop does not, and the rule is the same as colour: it carries state, never
enthusiasm.

| Event | Feedback | Why |
|---|---|---|
| Send, approve, deny | `impactLight` (iOS) / `HapticFeedbackConstants.CONFIRM` (Android) | The action is committed by a tap on a small target; the tap needs a receipt |
| A decision arrives (an approval or a question) | `notificationWarning` | The one event that must reach a user who is not looking at the screen |
| A turn completes | `notificationSuccess` | The work the user asked for is done |
| A failure | `notificationError` | Failed is a different event from done |
| Scroll, hover, selection, theme change | **Nothing** | Haptics on ambient motion is the tell of an app that has mistaken feedback for texture |

**Every one of these is suppressible in settings**, and none of them is the only
channel for its message: a user with haptics off still sees the same state.

---

## 6. App icon and launch assets

Generated by `design/app-icon/build-icons.mjs` from the existing assets — **no
new logo is drawn.** Sources, in precedence order:
`~/local-operator-ui/resources/icon.png` (1024²), `icon-180x180.png`,
`icon-180x180-dark.png`, `icon-small.png`, and the site's `favicon-512x512.png`
(which is the mark on white inside a circle, not the app's filled-ground icon).

### 6.1 What was generated

| Path | Size | Notes |
|---|---|---|
| `design/app-icon/ios/icon-light-1024.png` | 1024² | Opaque; the light ground `#f2ede3` with the mark in `#211e18` |
| `design/app-icon/ios/icon-dark-1024.png` | 1024² | Opaque; the icon's own night ground `#14110c` with the mark in `#f1eee6` — see § 6.3 for why that is not the app's dark `canvas` |
| `design/app-icon/ios/icon-tinted-1024.png` | 1024² | **Greyscale, transparent background.** iOS 26 tints it from the user's wallpaper, so a coloured tinted variant is wrong by definition |
| `design/app-icon/ios/layers/*.svg` | vector | The layer stack for Icon Composer (§ 6.4) |
| `design/app-icon/android/ic_launcher_foreground-432.png` | 432² | Adaptive foreground, artwork inside the **66 dp safe zone** |
| `design/app-icon/android/ic_launcher_background-432.png` | 432² | Adaptive background: a flat ground, no gradient |
| `design/app-icon/android/ic_launcher_monochrome-432.png` | 432² | The themed-icon layer: **one colour, alpha only** |
| `design/app-icon/android/mipmap-*/ic_launcher.png` | 48–192 px | Legacy launcher icons for pre-API-26 devices |
| `design/app-icon/android/ic_notification.png` | 24 dp (96 px @4x) | The status-bar small icon: monochrome, alpha-only, **no ground** |
| `design/app-icon/splash/splash-light.png`, `splash-dark.png` | 1024² transparent | Centred mark at ~34% of the canvas height |
| `design/app-icon/store/play-feature-graphic-1024x500.png` | 1024×500 | Play feature graphic, **no alpha** (JPEG or 24-bit PNG is what Play accepts) |
| `design/app-icon/store/play-icon-512.png` | 512² | Play store icon, 32-bit PNG **with** alpha, well under Play's 1 MB limit |

### 6.2 The one rule that shapes all of it

**The app icon is the mark on a full-bleed ground, never the mark in a circle on
a transparent canvas.** The existing `icon.png` is the mark inverted to white
inside a near-black filled circle that fills its canvas — that is *already* an
app icon. Two consequences the generator enforces:

- **iOS icons are opaque.** The platform applies the mask, the corner radius and
  (in iOS 26) the glass treatment. A source with rounded corners, a bezel or a
  transparency halo is a defect, and `icon-180x180.png` — whose circle does *not*
  reach the canvas edge — is **not** used as an icon source for this reason.
- **Android's adaptive icon needs the artwork inside a safe zone**, because the
  launcher can mask it to a circle, a squircle or a rounded square. Foreground
  artwork is drawn at 66/108 of the canvas (the documented safe zone) so nothing
  is clipped by any mask. A foreground that fills its canvas loses the foot node
  on a circular mask.

### 6.3 The dark icon's ground: measured, and a place where the brand palette is
*not* the answer

The dark app icon uses the icon's own night ground (`#14110c`, the kit's
"island"), not the app's dark `canvas` (`#22201c`). Reason: an app icon sits on a
wallpaper chosen by the user, and the darkest of the two grounds reads as a
deliberate object against a light wallpaper while `canvas` reads as a slightly
lighter grey square. The mark stays `#f1eee6`. Measured 2026-09-29: the pairing
is **16.24:1** where the same mark on the app's dark `canvas` is **14.03:1** —
both far above any floor, so this is a taste call rather than a contrast one,
made once and recorded here so a later pass changes it deliberately rather than
by accident. The two grounds are 7.13 L\* apart (`#14110c` L\* 5.2, `#22201c`
L\* 12.33); the icon chooses the darker one because an icon is seen at 60 pt
among other icons, where a low-contrast ground reads as "no icon".

### 6.4 iOS 26 Icon Composer layering

iOS 26 renders app icons through Liquid Glass, and Expo SDK 54+ supports an
`.icon` bundle directly (`ios.icon`, "Support for Liquid Glass icons and Icon
Composer", `expo.dev/changelog/sdk-54`, read 2026-09-29). Two supported routes,
and the project should take the first:

1. **Icon Composer `.icon` bundle** — one file that carries the layers and the
   appearance annotations. What the generator writes:
   `design/app-icon/ios/layers/01-background.svg` (a flat ground, no gradient)
   and `design/app-icon/ios/layers/02-mark.svg` (the mark as strokes). Keep the
   layers **flat and opaque** and let Icon Composer add blur, specular,
   refraction and shadow — baking those into the source SVG removes the ability
   to tune them per appearance. Layer groups are ordered **front to back** in
   `icon.json`, and specializations accept one default plus at most one `dark`
   and one `tinted` (no invented appearance names).
2. **Three PNGs** (`ios.icon = { light, dark, tinted }`) — still supported and
   what the generator also emits, so a build can ship before an `.icon` bundle
   exists.

**What this repository cannot do and says so:** `.icon` bundles are authored in
Apple's Icon Composer app, which requires Xcode — not installable on the
reference host (Command Line Tools only, and the repository forbids making
simulators or Xcode a build dependency). The generator therefore writes the
**layer stack, the SVGs and a `layers/README.md` describing the exact group
order and settings to apply**, and the `.icon` bundle is a one-off authoring step
on a machine that has Icon Composer. The three exported PNGs are the shippable
fallback until then.

---

## 7. Imagery

**There is no photography in this app, and there should not be.** The product's
claim is that it touches real things — real files, real paths, real code. A stock
photograph of a person at a laptop is the one image type that makes that claim
less believable.

What the app shows instead, in order of how much it earns its space:

1. **The user's own content**: their code, their diffs, their file names, their
   screenshots sent as prompt images. This is the app's imagery. A diff block is
   more persuasive than any illustration.
2. **The mark**, in empty states and on the launch screen. Monochrome, quiet.
3. **Non-photographic illustrations**: none. If a state needs an image to explain
   itself, the copy is wrong.

**Screenshots for the stores** are the exception, and they are still of the real
app: `design/store-screenshots/` contains frame templates and a README with the
exact specifications (§ 7.1). A store screenshot is a real captured frame in a
device frame with a caption, never a mock-up of a feature that does not exist.

### 7.1 Store image specifications, with sources

Read from the platform documentation on **2026-09-29**; a spec copied from a blog
is a spec that will be wrong.

| Asset | Requirement | Source |
|---|---|---|
| **App Store, iPhone 6.9"** | **1320×2868**, or 1290×2796, or 1260×2736 portrait (landscape the same transposed). **Required** if the app runs on iPhone and no 6.9" set is provided under another accepted size | [Apple, Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications) |
| **App Store, iPad 13"** | **2064×2752** portrait, or 2048×2732. Required if the app runs on iPad | same |
| **App Store, 6.5"** | 1242×2688 / 1284×2778 — required *if* 6.9" is not supplied; supplying 6.9" makes this optional | same |
| **Play, phone screenshots** | Min **2**, up to 8 per device type. JPEG or **24-bit PNG, no alpha**. Each side 320–3840 px, and the long side no more than **twice** the short side. Portrait 9:16, and **≥1080 px on the short side to be eligible for large-format promotion** | [Google Play, Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) |
| **Play, feature graphic** | **1024×500**, JPEG or 24-bit PNG, **no alpha**. Keep the focal point centred, keep key elements out of the cut-off zones, and avoid pure white / near-black because it blends into Play's own background | same |
| **Play, app icon (listing)** | **512×512**, 32-bit PNG **with** alpha, ≤1024 KB. This is the *listing* icon, not the launcher icon — Play applies its own mask and shadow, so supply no corners and no shadow | same |
| **Play, tablet** | Same rules, 16:9 for large screens. Not required for this app's first listing, but the iPad-class layouts exist and the templates run at both sizes | same |

**Captions and framing rules** that the templates encode:

- Taglines cover at most **20%** of the image (Play's guideline) and are the
  caption band, never the screenshot.
- **No call-to-action verbs** ("Download now", "Try it"), no ranking or award
  words ("#1", "Best", "New"), no price or promotional text.
- **No device imagery** in the *feature graphic* (Play lists it explicitly as
  something to avoid, because it dates); device frames in *screenshots* are
  conventional and allowed.
- The first three screenshots carry the UI: list the transcript, the diff, and the
  approval card first, because those are the product's three claims.

---

## 8. Do / don't, in one table

| | Do | Don't |
|---|---|---|
| **Colour** | Name a role (`bg-surface`); let the theme resolve it | Write a hex in a component |
| | Spend the accent on one action and on working state | Use green for the mark, a heading or a decoration |
| | Separate grounds by 2.5–5 L\* | Draw a shadow to lift in-flow content |
| | Put a word or glyph beside every semantic colour | Signal failure with red alone |
| **Type** | Keep `body` at 16pt in any input | Set an input at 14pt "because it fits" |
| | Leave Dynamic Type scaling on, cap at 1.4× only where geometry is pinned | `allowFontScaling={false}`, or a fixed row height |
| | Ration mono to machine voice | Set a paragraph, a heading or a button in mono |
| | Use the text state glyphs | Add an icon font, or draw a second pen |
| **Space** | 4pt tiers: 4/8/12 inside, 12/16/24 between components | Invent a 7pt gap |
| | Let a row grow past 44pt at large text | Pin a row height |
| | Give the container the gap | Give a component its own outer margin |
| **Motion** | Colour-only feedback at 80–120 ms | Overshoot, spring, bounce, elastic |
| | Say what survives with motion off | Treat reduced motion as "delete the animation" |
| **Radius** | 6 controls, 10 panels/alerts, 14 dialogs, 16 the composer, 2 bars, 9999 dots/pills | Anything above 16 on a surface |
| **Mark** | One SVG, `currentColor`, both themes | A PNG pair, a recolour, a baked corner |
| **Voice** | Name the machine, the file, the number | Adjectives doing a verb's job; a claim that cannot be checked |

---

## 9. What is decided, what is proposed, and what is not this stream's

**Decided (do not re-litigate in an implementation PR):**

- The mark, and that it is one monochrome SVG.
- The palette: `localOperatorDark` default dark, `localOperatorLight` default
  light, and the mapping in § 2.1.
- Figtree + JetBrains Mono ship; Fraunces is store/launch only.
- The contrast floors, and that `design/tokens/contrast-contract.mjs` is the
  gate: `node design/tokens/contrast-contract.mjs` must exit 0.
- Touch floors: 44pt iOS, 48dp Android; `body` = 16pt in inputs.

**Proposed (validate on a device, then update this file):**

- The exact mobile type steps in § 3.3, especially `body-lg` at 17pt for the
  transcript.
- The 1.4× Dynamic Type cap's *application list* — which specific rows lose the
  ability to grow.
- The haptic map in § 5, and which of those are on by default.
- The dark icon's ground choice in § 6.3.

**Not this stream's decision, and flagged for the architect:**

- **The toolchain** (Expo/React Native vs another native path) and therefore
  whether the styling layer is **NativeWind** (JS config) or **Uniwind** (CSS
  only, Tailwind 4, no JS config — `docs.uniwind.dev/theming/global-css`, read
  2026-09-29). `design/tokens/tailwind-preset.js` supports both: a
  `theme.extend` preset for NativeWind and `preset.cssVariables()` +
  `preset.themeBlock()` strings for Uniwind's `global.css`. **Consequence
  to note: `tailwind-preset.js` is generated and verified structurally, but it
  has not been compiled by a real Tailwind build** — no Tailwind is installed on
  the reference host and this repository has no dependency tree yet. The first
  implementation PR that picks a toolchain should compile a probe stylesheet and
  confirm the roles emit.
- Whether the app ships more than the two brand palettes (§ 2.3).
- Where the fonts are bundled from (the site's `woff2` files vs an
  `@expo-google-fonts` package) and in which format the chosen toolchain wants.

**Open, and genuinely not answerable without a device or a store console:**

- The Play listing's tablet screenshots: whether this app's first release targets
  tablets as a supported form factor at all (the layouts exist in
  `components.md` § 12; the listing decision is a product one).
- Whether an Icon Composer `.icon` bundle ships in the first release or the
  three-PNG route does (§ 6.4).
