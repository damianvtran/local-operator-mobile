# Mobile components

The primitive spec for the native Local Operator app: anatomy, sizes, states, and
where each one already exists in the shipped phone web client.

Read [`brand-kit.md`](./brand-kit.md) first — that is the *why*; this file is the
*what*, and it never restates a colour. Values live in
`design/tokens/tokens.json`; the utilities that expose them are generated into
`design/tokens/tailwind-preset.js`.

**A component names a ROLE, never a hue.** `bg-surface`, `text-ink-muted`,
`border-control` — the theme decides what those are. A hex in a component is a
defect.

## 0. The eight states, defined once

Every interactive primitive is specified against the same eight. Where a
component genuinely has no such state, this document says **n/a** and says why,
rather than inventing one.

| State | Definition | System-wide default |
|---|---|---|
| **rest** | Idle, pointer or finger elsewhere | The variant's base binding |
| **hover** | (desktop/hardware only) | A colour or border step. Never a transform |
| **pressed** | Touch down | A further colour step: `accent` → `accent-active`, `surface` → `elevated`. **Never a scale** |
| **focus-visible** | Keyboard focus (hardware keyboard, switch control) | The one focus ring (§ 1) |
| **disabled** | Present, not operable | A colour change, **never an opacity change** |
| **loading** | Operation in flight | Label persists, width pinned, `aria-busy`/`accessibilityState.busy` |
| **error** | The operation failed | Adjacent text, never colour alone |
| **selected** | One of a set, currently chosen | Tinted fill **plus** a non-colour mark |

Two of them are load-bearing on a phone:

- **Disabled changes colour, not opacity.** An opacity-faded control also fades
  its background, so the same button on `surface` and on `sunken` ends up two
  different colours and neither is the specified one.
- **Pressed is a colour step, not a scale.** A 0.97 scale on a phone is the
  single clearest tell of a web view wrapped in a shell. The press feedback is
  the colour alone, at `instant` (80 ms).

### 0.1 The three touch rules that apply to every component here

| Rule | Value | Why |
|---|---|---|
| Minimum hit area | **44pt iOS / 48dp Android** | `tokens.json § size.touchTarget`. The shipped client already uses `min-h-11` (44px) for every button and chip |
| A visually smaller control gets **slop**, not a smaller target | pad to 44 | A 12pt status dot may sit inside a 44pt hit area, and hit areas may never overlap |

**Slop is native-only, and that is why the box is the floor here.**
`react-native-web` implements `hitSlop` on the legacy `Touchable` and **not** on
`Pressable`, which is what this kit uses — so on the web build a control that reached
the floor only through slop had no slop at all. Measured: Button `sm` (32 pt visual)
was a 32 pt target in every web frame, and the audit's target-size checks saw it
correctly, because they can only see the box. The rule that follows: a control below
the floor gets **real box geometry** (padding, or a floor-height pressable with the
pill centred inside it), and slop is an extra only where a control genuinely cannot
afford the box on native.
| Any text field is set at **≥16pt** | `type.steps.body` = 16 | Below 16, iOS zooms the page on focus, which moves the layout under the reader's thumb |

---

## 1. The focus ring

One treatment for the whole app, defined once:

| Property | Value |
|---|---|
| Width | 2 (`tokens.json § focus.ring.width`) |
| Offset | 2 |
| Colour | `accent` |
| Shape | follows the control's own radius |
| Form-control exception | offset **1**, because a field's own 1px border sits where a 2px offset would put the ring, and the two strokes then read as two borders |
| Photographic-ground exception | the two-tone ring: inner `#fffefb` at 2, outer `#14110c` at 4 |

**On a phone this is rarely seen and it is not optional.** A hardware keyboard, a
switch control, and a remote all reach it, and the shipped client keeps it for
exactly that reason. The ring is `accent`, which clears the 3:1 non-text floor on
every ground in both themes — asserted by `contrast-contract.mjs`.

---

## 2. Button

The one action affordance. Anything that **navigates** is a link, not a button.

**Existing implementation:** `local_operator/mobile/web/src/components/ui/button.tsx`
— variants `primary | outline | quiet | danger`, `min-h-11`, `rounded-md`, `px-4`,
`text-body-sm`, one `transition-colors` at `duration-fast`.

### Anatomy

| Slot | Binding |
|---|---|
| Root | inline-flex, centred both axes, `flex-shrink: 0`, never wraps |
| Corner | `radius.sm` (6) at every size |
| Border | 1px solid, `transparent` when the variant has none, so a variant switch never changes the box size |
| Leading icon | `size.controls.*.icon`, `pointer-events: none`, `flex-shrink: 0` |
| Label | `label` step (`meta` at `sm`) |
| Gap | 8 (`md`), 6 (`sm`), 10 (`lg`) |

### Sizes

| Size | Height | Padding X | Icon | Type | Use |
|---|---|---|---|---|---|
| `sm` | 32 visual / **44 hit** | 12 | 14 | `meta` | Dense chrome only |
| `md` | 44 | 16 | 16 | `label` | Default |
| `lg` | 50 | 24 | 18 | `label` | One per screen: the pending card's Approve |
| `icon` | 44 square | 0 | 20 | — | Standard icon-only control |
| `fab` | 56 square | 0 | 24 | — | The composer's send (§ 12) |

### Variants and their states

| Variant | rest | pressed | disabled |
|---|---|---|---|
| `primary` | fill `accent`, ink `on-accent`, no border | fill `accent-active` | fill `sunken`, ink `ink-disabled` |
| `outline` | fill `surface`, ink `ink`, border `border-control` | fill `elevated` | ink `ink-disabled`, border `hairline` |
| `quiet` | transparent, ink `ink-muted`, no border | ink `ink`, fill `elevated` | ink `ink-disabled` |
| `danger` | fill `danger-wash`, ink `danger`, border `danger-border` | same fill, heavier border | ink `ink-disabled` |

**`on-accent` is near-black in dark, not white.** White on the dark `accent`
measures **2.16:1** — the one hard prohibition in the system, asserted as a
negative by the contract. This is the most common contrast bug in green palettes
and the reason the pair is pinned.

### Hierarchy

- **At most one `primary` per screen.** On a phone that usually means one in the
  whole viewport.
- Where two actions are both plausible, the reversible one is `primary`.
- **`error` is not a button state:** the failure is surfaced in an adjacent alert
  (§ 15) and the button returns to rest, because a reader needs to know *what*
  failed and a red button cannot say it.

---

## 3. IconButton

Same box as Button `icon` (44×44), transparent fill, `ink-muted` ink,
`border-control` border only where the icon does not carry the affordance alone.

**Existing implementation:** the back button and the image-attach button in
`components/composer.tsx` / `screens/session-view.tsx` (`min-h-8 min-w-8` for the
back affordance, which relies on its position for the target and is the one place
the 44 floor is met by slop rather than by the box).

Rules that are easy to get wrong:

- **The icon never receives the pointer.** A press that lands on the glyph must
  resolve to the button.
- **One stroke weight (lucide's default 2), never restated.** Five weights had
  accumulated in the desktop app's tree before the same rule was written down.
- **Sizes: 12 / 14 / 16 / 20 / 24.** 12 is the floor; under it, stop shrinking
  the glyph and increase the contrast instead (weight is stroke × contrast).
- **No icon-only control without an accessible name.** `aria-label` on the
  control, never a `<title>` inside the SVG.

---

## 4. Input and Textarea

**Existing implementation:** the composer's field in `components/composer.tsx`
(`text-[16px]`, `rounded-md`, `border-control`, `bg-elevated`, auto-grow to six
lines then scroll).

### Anatomy and sizes

| Slot | Binding |
|---|---|
| Height | `min-height` 44 (single-line); the textarea grows |
| Padding X | 12 |
| Corner | `radius.sm` (6) — the composer's *container* is `radius.frame` (16); the field inside it is not |
| Fill | `elevated` inside the composer, `surface` standalone |
| Border | `border-control` (structural: it is the field's only boundary on a plain ground) |
| Type | **`body` = 16pt, always.** See § 0.1 |
| Placeholder | `ink-muted`; a placeholder is never the only label |
| Caret | `accent` |

### States

| State | Binding |
|---|---|
| rest | fill `surface`/`elevated`, border `border-control` |
| focus-visible | the ring at offset **1** |
| disabled | fill `sunken`, ink `ink-disabled`, border `hairline` |
| invalid | border `danger`, plus an adjacent message in `body-sm` |
| loading | n/a for a field; the *action* it feeds shows loading |

### Textarea specifics

- **Auto-grow to six lines, then scroll** — `MAX_TEXTAREA_PX = 6 * 22` in the
  shipped client. A field that grows without bound pushes the transcript off the
  top of the screen.
- `enterKeyHint="send"` on the keyboard; Enter sends on a hardware keyboard and
  Shift+Enter inserts a newline. On a touch keyboard the send button sends —
  never Enter alone, because there is no way to type a newline otherwise.
- **Secret input:** an ask carrying a credential renders as a masked field, and
  the value is never echoed into a log or a snapshot (see the ask card, § 14).

---

## 5. Card

An in-flow block: a session card, a tool-card, the about panel.

| Property | Value |
|---|---|
| Fill | `surface` |
| Border | 1px `hairline` (decorative: the card sits on `canvas` and the 2.5–5 L\* ground step is what separates it; the hairline just sharpens the edge) |
| Corner | `radius.md` (10) |
| Padding | 12 inside a list, 16 standalone |
| Elevation | **none.** In-flow content is never lifted by a shadow |

**Elevation is a background step, never a shadow.** There are exactly two shadows
in the system and both belong to objects that leave the flow (sheet, dialog).
A card that needs to stand out takes `elevated`, not a shadow.

---

## 6. Badge and Chip

Two different things that look similar, and the difference is functional.

| | Badge | Chip |
|---|---|---|
| Interactive | **no** | **yes** — it opens a sheet |
| Existing | — | `components/ui/chip.tsx` |
| Fill | the semantic wash or `accent-muted` | `surface` (rest), `accent-muted` (selected) |
| Border | the semantic border | `border-control` / `accent-border` |
| Ink | the semantic ink, or `accent-active`(L)/`accent-hover`(D) on `accent-muted` | `ink-muted`, `accent-active`/`accent-hover` when selected |
| Corner | `radius.sm` (6) | `radius.sm` (6) |
| Height | 20–22 | **44 hit area**, `min-h-11` |
| Type | `meta` | `mono-sm` — a chip carries a machine word (model, effort) |

**A badge is never interactive.** Making one a control makes its
border-vs-own-fill pair a 3:1 requirement, which is a violation the contract
documents; a static badge is exempt because a reader resolves the badge against
the *page*, not against its own fill.

**A chip's grounds are `canvas`, `surface` and `elevated` — not the row states.**
On a selected row, the dark selected chip's fill measures 1.06 against the row and
its border 2.88, so it has no resolvable edge; a chip lives in a header or a
sheet, and the row state belongs to the row.

---

## 7. ListRow — the session row

**Existing implementation:** `SessionCard` in
`local_operator/mobile/web/src/screens/session-list.tsx`.

### Anatomy, left to right

| Slot | Width | Binding |
|---|---|---|
| **Indicator slot** | 12, `flex: none` | **One reserved slot for every state.** See below |
| Title | `flex: 1`, `truncate` | `body-sm` + `font-medium`; `shimmer` while streaming |
| Attention word | `shrink-0` | `meta` in `danger` — the word `approval` or `question` |
| Unread mark | `shrink-0` | `meta` in `accent`: `new` |
| Subagent count | `shrink-0`, `mono-sm` `ink-dim` | `2 agents` |
| Todo count | `shrink-0`, `mono-sm` `ink-dim` | `3 todos` |
| Second line | — | `cwd` (`mono-sm` `ink-dim`, home-shortened) and the model label, right-aligned |
| Row | min-height 56 (two-line 64), padding 16/10 | The whole row is the control |

### The reserved slot, and the ladder inside it

Every state occupies the **same 12×12 box**, so every title starts at the same x
forever. Indicators change colour, never geometry.

The ladder, first match wins:

1. **A pending decision** — a 6px `danger` dot, pulsing (`lo-pulse`). This is the
   only motion in the system reserved for danger.
2. **Streaming** — a 12px spinner.
3. **Unread** — a 6px `accent` dot.
4. Otherwise — an empty 12px box.

**The ladder is the whole design.** An approval gate runs *inside* a turn, so the
loudest state in the list (a question waiting on the reader) arrives carrying both
`pending` and `streaming` at once. Testing `streaming` first replaces the danger
pulse with a neutral spinner on exactly the row that most needs attention. The
shimmer still says "working" on that row, which is enough, and costs no geometry.

### States

| State | Binding |
|---|---|
| rest | transparent fill, `canvas` ground |
| pressed | fill `row-hover` |
| selected (the open session) | fill `row-selected` **plus** the accent title/label, never colour alone |
| streaming | title in `shimmer` + spinner in the slot |
| needs attention | danger dot + the word; **never colour alone** |
| unread | `new` mark + accent dot |
| disabled | n/a — a row is always openable |

### Do not

- Do not add a second mark for "working" on a row that already shows the danger
  dot; the slot's alignment is what the layout is built on.
- Do not let a row's counts truncate; the **title** yields. The client learned
  this the hard way: with a long MCP tool name pinned `shrink-0`, the deficit
  landed on the elapsed clock, and `59m 59s` rendered as `59m` — a shorter string
  that is itself a valid duration, so nothing looked wrong.

---

## 8. Sheet (bottom sheet)

**Existing implementation:** `components/ui/sheet.tsx` — used by the model sheet,
the effort rungs, the slash sheet, and the subagent detail.

**Bottom-anchored, not centred.** A centred dialog on a phone is under neither
thumb.

| Property | Value |
|---|---|
| Fill | `elevated` |
| Corner | `radius.lg` (14) top corners |
| Shadow | `elevation.overlay` — the one shadow for objects that leave the flow |
| Scrim | `scrim` token (never a hardcoded black alpha) |
| Entrance | rise from the bottom edge, `duration.slow` (240 ms), `ease-out-expo` |
| Scrim entrance | fade, `duration.fast` (120 ms) |
| Dismiss | tap the scrim, `Escape`, or the Close control |

### Detents (proposed)

| Detent | Height | Use |
|---|---|---|
| `content` | fit content, capped at 60% of the **column** | A picker with a few rows |
| `half` | 50% | The model list |
| `full` | 92%, leaving the status bar and a grab strip | The subagent drill-in |

**The cap is a fraction of the scroll COLUMN, not of the viewport.** The two are
the same number until a keyboard opens, which is precisely when the mistake bites:
the shipped client measured a `60dvh` card putting its own send button under the
column's clipped foot at 360×780.

### Rules

- **The covered application is `inert` and `aria-hidden`.** `aria-modal` alone
  does not remove it from keyboard or screen-reader navigation.
- **Focus: on open, focus the sheet's first control; on close, return focus to the
  opener.** The client stores the opener before moving focus.
- **A control that answers the sheet may not scroll out of reach** — see the
  three-region rule in § 13.
- **No drag gesture in v1.** A drag handle with no drag is worse than no handle.

---

## 9. Dialog and Alert

**Dialog** = a sheet's centred sibling, and on a phone it is the exception rather
than the rule: use it only for a destructive confirmation that must be answered
before anything else, where a bottom sheet's swipability undercuts the weight.
`radius.lg`, `elevated`, `overlay` shadow, scrim, focus trapped.

**Alert** (inline) = a block of text with a semantic border and wash, **never a
dialog**. Three severities, and every one of them carries a **word or a glyph**
besides the colour:

| Severity | Fill | Border | Ink | Glyph | Existing |
|---|---|---|---|---|---|
| error | `danger-wash` | `danger-border` | `ink` (+ `danger` for the word) | `✗` | `NoticeRow` in `components/transcript.tsx` |
| warning | `warning-wash` | `warning-border` | `ink` | `!` | same |
| info | `info-wash` | `info-border` | `ink` | `·` | same |
| success | `success-wash` | `success-border` | `ink` | `✓` | the "N passed" result banner |

In dark, the semantic borders clear 3:1 on `elevated` (3.14–3.16, measured), so an
alert is legal on any ground here — which is *not* true of the site's kit, whose
own borders measured 2.9 there. That difference is asserted in the contract.

---

## 10. Toast

Transient confirmation for something that already happened and has no place else
to appear: "Copied", "Screenshot saved", "Approval sent".

| Property | Value |
|---|---|
| Placement | above the composer, inside the safe area and clear of the keyboard |
| Fill | `elevated` |
| Border | `hairline` |
| Ink | `ink`; the leading glyph takes the semantic role |
| Duration | `1.5 × duration.beat` = ~1050 ms at minimum; long enough for one short line to be read |
| Exit | fade at `duration.fast`; never a slide that could be mistaken for a sheet |
| Count | **one at a time.** A second replaces the first; a queue on a phone is a stack of things nobody reads |
| Under reduced motion | appears and stays for the same time, then disappears without a fade |

**Never a toast for a failure.** A failure the reader must act on is an alert
(§ 9) or the pending card (§ 13). A toast that disappears cannot carry an action.

---

## 11. Tabs and Segmented

| Property | Tabs | Segmented |
|---|---|---|
| Job | Switch *views* (Sessions / Past) | Choose *one value* (the effort rung) |
| Track | `sunken` | `sunken` |
| Selected item | `surface` fill + `accent` label + **a heavier label weight** | `accent-muted` fill + `accent-active`/`accent-hover` label |
| Corner | `radius.sm` | `radius.sm`, track `radius.sm` |
| Height | 44 | 36 visual / 44 hit |
| Motion | the indicator moves at `duration.base` (180 ms) — the shortest duration in which a *position* change reads as movement rather than a jump | none |

**Selection is never colour alone:** the selected tab carries the heavier weight
as well, because an accent tint at 1.0x luminance ratio is not a difference a
low-vision reader can see.

---

## 12. The composer

**Existing implementation:** `components/composer.tsx` — the most complicated
primitive in the app, and the one that carries the most information.

```
┌──────────────────────────────────────────────────────────┐
│  [ attachments strip, when present ]                     │
│  ┌────────────────────────────────────┐  ⬤  ⬤           │
│  │ Message…                           │  stop  send       │
│  └────────────────────────────────────┘                  │
│  2 queued                             opus-4.6   high    │
└──────────────────────────────────────────────────────────┘
```

| Slot | Binding |
|---|---|
| Field | `elevated` fill, `radius.frame` (16) on the container, `border-control`; **16pt text** |
| Send / steer | 44 circle, `accent` fill, `on-accent` glyph `↑`, `fab` is 56 where it stands alone |
| Stop | 44 circle, transparent fill, `danger-border`, `danger` `■` at 13pt |
| Queued count | `mono-sm` `ink-dim`, left; the count is the only thing on that line that changes |
| Model chip | `mono-sm` `ink-dim`, opens the model sheet |
| Effort chip | `mono-sm` `ink-dim`, opens the rung sheet |
| Attachments | 64 thumbs with a remove control; each image capped at **1568 px** on its long edge before upload |
| Slash sheet | the same sheet in § 8, filtered as the draft starts with `/` |
| Leading chip (`leadingChip`, home only) | the folder chip: `homeShortened(target.cwd, home)`, `size="sm"`, tap pushes `/new` |

### Home's use of it, and the two additive props

Home (S4) mounts the same composer with two additive props, one of which it
leaves empty:

- `leadingChip` — the **folder chip** above the field's row, naming the folder a
  new session would start in (`homeShortened`, so `$HOME` shortens first); tap
  pushes `/new`, the deliberate path. It is the home's only new chip.
- `effortChip` — **`null` on home**: there is no turn yet to apply an effort to,
  and the view's rule (`new-session.tsx:36-39`) is that a chip whose enabled
  state disagrees with its label is a dead end; the same composer still renders
  the effort chip beside `modelChip` on the session view.

The home also passes `fieldRef` — a handle to the platform field — because
*New chat* (in the conversations panel) closes the panel and puts the caret in
the field it names. The session view leaves it out and the internal ref is used
as before.

The composer's foot position is invariant on home too: suggestions and the
splash sit *above* it, and when the region stops fitting it scrolls
(`keyboardShouldPersistTaps="handled"`) rather than pushing the field down.

### The send / steer / stop morph

This is the state machine, and it is the part a naive port gets wrong:

| Session state | The primary control |
|---|---|
| Idle, draft empty | disabled: fill `sunken`, ink `ink-disabled`, glyph `↑` |
| Idle, draft present | `accent` fill, `↑`, **op `prompt`** |
| Streaming, draft empty | `accent` fill, `↑`, **op `steer`** — same control, same place, different command |
| Streaming, draft present | as above; the stop control appears beside it |
| Sending | label `…`, control disabled, width pinned |

**The button never changes size or position while morphing.** A control that
swaps its label for a spinner changes width and moves everything after it, which
on a phone means the send button moves under the thumb that is about to press it.

### After an abort

The client shows a **resume** affordance driven by the wire fact
(`stop_reason === "aborted"`), not by a guess: `Retry earlier instruction`, with a
hint when a queued instruction must be resolved first. A refusal surfaces as text
beside it.

---

## 13. The pending card (approval, and ask)

**Existing implementation:** `components/pending-card.tsx`.

Pinned above the composer, the **most prominent object on the screen**, because a
question for the reader is the only thing that needs a decision.

### The three regions, and the contract between them

| Region | Rule |
|---|---|
| Meta row | `shrink-0`, pinned **above** the scroller: `approval requested · bash` |
| Body | `min-h-0 flex-1`, scrollable: title, detail, options |
| Controls | `shrink-0`, pinned **below** the scroller: Approve/Deny, and the error line |

**Content may scroll; the control that answers the card may not.** This was
learned from a measured failure: putting the whole card in one scroller capped the
card correctly and then let the *decision* scroll out of reach — an approval with a
long detail arrived with `approve` showing **30 of its 44 px at 390×844 and 0 of
44 px — invisible — at 360×780**, where the uncapped card before it had shown both
buttons whole. The stale-tap error landed ~26 px below the fold for the same
reason, so a refused tap greyed every option out and explained nothing.

### Anatomy

| Part | Binding |
|---|---|
| Frame | fill `accent-wash`, border `accent-border`, `radius.md` (10), padding 10 |
| Meta row | `meta` in `accent`; the tool name in `mono-sm` `ink-dim` |
| Title | `body` + `font-medium` |
| Detail | `body-sm` `ink-muted`, `pre-wrap` (a command keeps its own line breaks) |
| Approve | `primary`, 44, `flex: 1` |
| Deny | `danger`-variant, 44, `flex: 1` |
| Remember | a 44-high row with a 16 checkbox, `accent` tick |
| Free-text answer | field at `surface`/`elevated`, `border-control`, 16pt; **masked when the ask is a secret** |
| Error line | `body-sm` in `danger`, inside the pinned controls region |

### Multi-question asks

A card with several questions shows `Question N of M` and **re-renders the whole
card** for the next question, keyed on `request_id` + `question_index`. The key
lives at the render site, not inside the component, because a component cannot key
itself — and without it a stale `busy` flag leaves the next question's options
disabled and untappable, and a stale draft carries a typed answer forward.

### Ask options

Each option is a tap target with its **consequence line** under it — an option
without a consequence is a guess the reader has to make. Options are capped to a
fraction of the column with a **fade at the cut edge**, not a "more" row: the cap
was measured costing first-glance options 6→3 at 390×844, and a pinned row would
give back the space the cap just bought.

---

## 14. Transcript rows

**Existing implementation:** `components/transcript.tsx`, `components/tool-row.tsx`,
`components/working-line.tsx`, `components/markdown.tsx`.

| Row kind | Treatment | Ink |
|---|---|---|
| **user** | bubble, `max-width: 85%`, right-aligned, fill `surface`, border `hairline` + a 2px `accent` left edge, `radius.md`, padding 12/6 | `body` in `ink` |
| user, steer | no accent edge, no fill: a quiet right-aligned block | `body-sm` in `ink-muted` |
| **assistant** | no bubble at all: plain column, full width, markdown | `body-lg` in `ink` |
| tool | one line + a disclosure (§ 15) | see § 15 |
| parent / subagent / peer | labelled block with a 2px left edge (`accent` for parent/peer, `hairline` for subagent) and a `meta` label | `body-sm` in `ink` |
| notice / compaction | glyph + text in the severity colour | `body-sm` |
| working line | spinner glyph + verb + elapsed, in-place, the **only** in-progress indicator | `body-sm`, label in `shimmer` |

**The assistant's turn has no bubble.** A bubble is a container for something the
reader is separating from other things; the answer is the page.

**One animation per thing.** While a turn streams, the assistant row simply grows
and the working line carries "alive, what it is doing, and for how long". A second
in-progress animation elsewhere is a defect.

### The user's own attachments render inline

An image the reader sent is part of the turn, not a `[image attached]` note. The
attachment component owns its own loading and failure states so a flaky fetch
never shows a broken glyph or reflows the bubble.

---

## 15. Tool row

**Existing implementation:** `components/tool-row.tsx`.

```
✓ read   design/tokens/tokens.json                       0.4s   ▸
✗ bash   magick montage … (no font)                      0.9s   ▸
✓ edit   design/tokens/tailwind-preset.js         +18 −4  1.2s  ▾
```

### Anatomy

| Slot | Binding |
|---|---|
| State glyph | 12pt wide, `mono-sm`, **identity colour** (see below) |
| Name | `mono-sm` `ink-muted`, `min-w-0 truncate` |
| Summary | `body-sm` `ink-dim`, `flex-1 truncate` |
| Diff counts | `mono-sm`: `+N` in `success`, `−N` in `danger`; **suppressed when both are zero** |
| Elapsed | `mono-sm` `ink-dim`, `tabular-nums`, `shrink-0` |
| Disclosure | `▸` / `▾` in `ink-dim`, only when there are details |

### The glyph is a text glyph, not an icon

| State | Glyph | Colour |
|---|---|---|
| composing | `⟳` | `ink-dim` |
| queued | `⋯` | `ink-dim` |
| running | `⟳` | `accent`, pulsing (`lo-pulse`, 1.2 s) |
| done | `✓` | `success` |
| failed | `✗` | `danger` |
| interrupted | `–` | `warning` |

**Eight characters, not an icon font.** They were chosen because they survive
every system font and never render as tofu — the shipped client moved *off*
`⟳ / ☐` codepoints for exactly that reason and then kept them where they are
drawn from a font that has them. A second pen for state is a second visual
language for one idea.

### The expanded row

- **The args block is hidden for `write`/`edit`/`apply_patch`/`patch`**: their
  args *are* the diff, and showing both says the same thing twice.
- The diff block is bounded (`max-height`) and scrolls, **wrapping** its lines
  (`pre-wrap`): a horizontally-scrolled diff on a phone is a gesture the reader
  has no cue to perform.
- **Diff line tints** come from the diff roles and are asserted against the well
  in both themes — see `brand-kit.md` § 2.6, where the dark tints had to be
  re-solved because the dark wash measured 1.11:1 inside the well.
- Interrupted or aborted tools keep their partial output and say so.

---

## 16. Todos panel

**Existing implementation:** `components/todos-panel.tsx`.

| Slot | Binding |
|---|---|
| Header | `tasks` + `n/m` in `mono-sm` `ink-dim`; the disclosure chevron |
| Closed by default | Yes — an auto-expanded list pushed the conversation off the screen on a phone |
| Body | capped to a fraction of the column, scrolls internally |
| Glyph | `☐` pending `ink`, `☑` done `success`, `~` blocked `warning`, `-` dropped `ink-dim` |
| Row text | `body-sm`; done → `ink-dim`, dropped → `ink-dim` + line-through, blocked → `ink-muted` + the reason in `warning` |
| Held shut | while a decision is pending, and the header is **dimmed per-part** (`opacity-60`), never as a whole |

**Held-shut dimming is applied per part, not to the header.** `opacity`
composites the whole subtree, so a blanket dim also dims a failure count that must
stay legible in exactly the state that dims it (measured: `3.30:1` dimmed against
`7.08:1` undimmed).

**A headerless flat list is legal**: one phase named `Todos` is the implicit
carrier and renders without a header, matching the TUI's `_IMPLICIT_PHASE` rule.
Keep that string in sync or the two surfaces will disagree about the same list.

---

## 17. Subagents panel

**Existing implementation:** `components/subagents-panel.tsx`,
`screens/agent-view.tsx` (the drill-in).

| Slot | Binding |
|---|---|
| Status glyph | 16pt column, `mono-sm`: running `⟳` `accent`, done `✓` `success`, failed `✗` `danger`, interrupted `–` `warning` |
| Label | `body-sm` `ink`, `truncate` |
| Metadata | `meta` `ink-dim`: the agent kind · effort |
| Elapsed | `mono-sm` `ink-dim`, `tabular-nums`, `shrink-0`; **`null` contributes nothing** (a roster with no age for a child shows no clock, not `0s`) |
| Summary row | `N agents` · `N failed` in the header, **never dimmed** |
| Drill-in | a full-height sheet/route: the subagent's own prompt, conversation tail and outcome |

**A nested roster is indented, not nested in a card.** Depth is carried by
indentation and the metadata line, because a card inside a card inside a panel on a
390-wide screen leaves ~300 pt of text.

---

## 18. Connection status pill

**Existing implementation:** the `connected` flag rendered as text in
`screens/session-list.tsx` and `screens/session-view.tsx` (`"connecting…"` /
`"no sessions running"`).

| State | Fill | Ink | Text | Dot |
|---|---|---|---|---|
| connected | none (in the header) | `ink-dim` | the session's own state words | `success` |
| connecting | `warning-wash` | `warning` | `Reconnecting…` | `warning`, pulsing |
| disconnected | `danger-wash` | `danger` | `Offline — reconnect` | `danger` |
| degraded (SSE cut, retrying) | `info-wash` | `info` | `Reconnecting… the stream was cut at 60s` | `info` |

**The pill is the one place a message may be a full sentence**, because "the
relay cut the stream at 60 s" is information the reader needs and cannot infer.

**SSE is cut every 60 s by design** (the gateway's `MAX_STREAM_SECONDS = 60`), so
`degraded` is a normal state, not an error: the client must reconnect seamlessly
and say so quietly, and must never present a 60-second cut as a failure.

---

## 19. Skeleton

| Property | Value |
|---|---|
| Fill | `elevated` — **not** `sunken` |
| Shape | three bars for a transcript, one row per list item |
| Animation | a gentle brightness pulse at 1.4 s |
| Under reduced motion | the pulse stops; the bars keep their resting tone |

**`sunken` is the wrong fill and it was measured**: at ~1.3:1 a `sunken` skeleton
bar vanishes in a still frame, so the loading state reads as an empty one. The
resting tone must be visible without the animation, because the animation is the
first thing reduced motion removes.

---

## 20. Empty state

| Slot | Binding |
|---|---|
| Fill | none — the page ground |
| Mark | the logo mark at 48, `ink-dim`, `aria-hidden` |
| Headline | `body` in `ink-muted` — **not** a display step, and never a marketing line |
| Second line | `body-sm` `ink-dim`, the *action* the reader can take |
| Action | one `outline` button, or nothing |

**Empty is not an error.** An empty session list says what to do
(`start one below, or from the TUI on your machine`); it does not apologise and it
does not show a warning colour.

**An empty state with no second line is a dead end** — the copy work is to name
the next action, and the shipped client does.

---

## 21. Error and degraded banner

A full-width banner at the top of the list when the relay is unreachable, distinct
from the inline alert (§ 9) in that it is **the page's status**, not a response to
an action.

| Property | Value |
|---|---|
| Fill | `danger-wash` / `warning-wash` |
| Border | 1px bottom `danger-border` / `warning-border` |
| Ink | `ink` with the leading word in the semantic colour |
| Glyph | `✗` / `!` |
| Action | **one** — `Retry`, in the same banner |
| Exit | on the first successful poll; never a manual dismiss that hides a real failure |

---

## 22. Layout primitives

| Primitive | Rule |
|---|---|
| **Screen** | `canvas` fill; the header is opaque (a translucent header over a scrolling transcript is unreadable at 14 pt) |
| **Safe area** | `top` on the header, `bottom` on the composer (`max(inset.bottom, 8)`), `left`/`right` in landscape |
| **Column** | One 390-ish column, 16 gutters; the transcript caps its **measure**, not its width, and centres on a tablet (`maxContentWidth` 560–640) |
| **Stack tiers** | 4/8/12 inside a component, 12/16/24 between components, 32/48 between sections |
| **The container owns the gap** | A component does not carry its own outer margin |
| **Tablet** | Above 700 pt: list (360) + detail (640), collapsing to one column at half a split (~320). A two-column layout that does not collapse is a defect |
| **Landscape** | The column caps at 620 pt and centres; a 45-character measure across a 900 pt screen is unreadable |

---

## 23. Component-level anti-patterns

1. A hex in a component instead of a role.
2. A shadow on in-flow content.
3. A scale or transform on press.
4. `opacity` for a disabled state.
5. A circle-and-animation for danger where a word would do — or the reverse.
6. A spinner where the label could stay.
7. A tooltip as the only affordance on a touch surface.
8. An icon-only control with no accessible name.
9. A row whose height is fixed while its text can grow.
10. A fixed-height panel whose last row can clip.
11. A button that navigates.
12. Two in-progress animations for one operation.
13. A second pen (icon font) for state that text glyphs already carry.
14. A placeholder used as a label.
15. A horizontal scroller with no cue that it scrolls.
16. A cap with no signal that there is more, on content a reader must see.
17. A colour-only signal for selection, danger or status.
18. `pointer-events: none` on a disabled control (it removes the cursor feedback that says "disabled" rather than "broken").
19. A platform-default control (native alert, native picker) dropped into a themed screen and left unstyled.
20. A haptic on a state change that has no visual change.

---

## 24. What ships first

An implementation order that keeps the app usable at every step, because each
stage is a real screen rather than a component gallery:

| Stage | Primitives | The screen it makes usable |
|---|---|---|
| 1 | Screen, ListRow, Skeleton, Empty state, Connection pill | The session list |
| 2 | Transcript rows, Tool row, Markdown, Working line | Reading a session |
| 3 | Composer, Sheet, Chip | Sending a message, switching model |
| 4 | Pending card (approval, then ask) | Answering the agent |
| 5 | Todos, Subagents, Agent drill-in | Watching the work |
| 6 | Toast, Alert, Dialog, Segmented | The polish pass |
