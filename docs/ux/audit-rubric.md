# Audit rubric

The score sheet the E2E design/UX audit harness applies to **every screen ×
state**. It is written to be executed, not admired: each check states what to do,
what to capture, and the pass criteria, and each is anchored to a principle in
`principles.md` and to a flow or state id in `flows.md`. §9 carries the same
checks as machine-readable data, so the rubric's own consistency (id uniqueness,
principle coverage, cap discipline) is unit-testable rather than trusted.

**Citation ref.** Code line citations here are against the committed refs **by
SHA**: `~/local-operator` at `5bfff4a61` (2026-09-29) and `~/radient-ml/agent-server`
at `dcafe852349ebad3421010b06cfc36e61ac9c5bf`. Read them with
`git show <sha>:<path>` — not `git show origin/main:<path>`: `main` has moved past
the pin, the working tree is a third state, and both have already produced a wrong
line number in this document's history.

## How the harness uses this

1. **Drive the real app.** The scored surface is the app running against real
   relay data or the shipped fixture data — never a component story. Terminal
   surfaces in this project have an established harness idiom (real app, real
   render, exported frame); the mobile equivalent is the app under test with an
   isolated config/state directory and synthetic sessions.
2. **Enumerate the matrix.** For each screen in §1, capture every state in §2
   that the screen can be in. A screen with an uncaptured state is unscored, not
   passing. Connection states are named `C1`…`C7` in `flows.md` §9; cite the id,
   not a description.
3. **Run the automated checks** (§3), which emit measurements.
4. **Run the manual checks** (§4-§7) and attach the artifact named in the check.
5. **Report** one line per check: id, screen, state, result (PASS / FAIL /
   BLOCKED), the measured value or the artifact path, and — for a FAIL — the
   reproduction step. Findings use `U`-ids of their own (`U1`, `U2`, …) and the
   severity ladder BLOCKER / MAJOR / MINOR / NIT.

**Two id spaces, deliberately distinct.** A **check** id is hyphenated
(`U-01`…`U-42`) and belongs to this rubric: it is a question the harness asks of
every screen. A **finding** id is bare (`U1`, `U2`, …) and belongs to a review
round: it is a defect a check (or a walk) surfaced, and it is what a remediation
answers. Check `U-05` failing on the Session screen may raise finding `U7`; the
same check failing on Settings raises another. Keeping the two spellings apart is
what lets a remediation round say "U7 fixed" without ambiguity about which
question produced it.

**A pass requires an artifact.** "Looks fine" is not a result; the artifact is a
frame at a named viewport, an accessibility-tree extract, or a timing
measurement.

**The text-scale dimension is judged per type role.** `U-04` reads the 200 % frames
only when the harness has shown the dimension is live, and "live" is now a per-role
statement: for each (screen, state, device, theme) captured at 100 % and 200 %, every
type role the page rendered — each distinct text size relative to the root font size —
must be present in the 200 % frame at the declared factor. Node COUNTS are not
compared: a responsive layout may add or drop a node whose role scaled. A role that is
still on screen at its 100 % size makes the cell UNREADY and names the role; a 100 % role
with no scaled counterpart is reported as a note, not a failure.

The guard is composition-insensitive on purpose. An earlier version compared the
cell's **median** text box, which moves when the MIX of sizes changes even though every
role scaled — so a text node that gained the type role it was missing made the cell
fail for improving (measured: `S15/loading__tablet-landscape__200` fell to a 1.852×
median with all fifteen nodes scaling exactly 2×, the factor `SCALES` declares for the
200 % id).

**Two things are checked before any role is compared.** The 200 % frame's root font size
must be the factor's multiple of the 100 % frame's: a page that pins its root (`font-size:
… !important` outranks the inline property the harness writes) renders both frames at
100 %, and a comparison made against each frame's own root would call that live. And a role
is counted by its **box**, not by whether it draws — `visibility: hidden` is excluded (the
same thing the readiness rule's `visible()` says), while a node at `opacity: 0` and a child
clipped away inside a zero-height container ARE counted, because the audit reads the app's
clipped placeholder proxy on purpose. **What that cannot catch, and a signer must not
assume away:** text painting from a **zero-height box** is skipped — the role goes
unreported and the pair reads live. That is a CLASS, not a list: the shapes seen so far are
`height: 0` with `overflow: visible`, `line-height: 0`, `display: contents` and
`contain: size`, *including but not limited to* those, over elements that hold direct text.
Two further escapes have a different cause and are not box cases at all — generated content
(`::before` / `::after`) is not an element holding direct text, and text inside a shadow root
is never traversed. `painted-carrier-text-scale` pins three of the box shapes as a known
miss. Read a live verdict as "every role the box tree knows about grew", and **not** as
"there is no frozen text here".

**A note in `scaleNotes` is a third answer, and it is the common one.** Three different
things leave a 100 % role without a scaled counterpart — a node that did not move with
the root font size, a node a responsive layout drops or clips at 200 %, a node resized to a
size the factor does not produce (`calc()`, `clamp()`, an `em` under a fixed-px parent),
and (in the other direction) a size the 200 % frame shows that no 100 % role explains — and
two frames cannot tell them apart, so the guard names the role and does not fail the cell.
`U-04` is therefore signed per ROLE, not per node: **a role present at both scales whose
nodes only partly moved is reported as a note, so a live verdict says every role grew,
never that every text node did.** The `calc()` case has a measured size — a probe carrying
`calc(10px + 0.5rem)` renders **18 px → 26 px (1.444×)**, named rather than failing the cell
— and it does not occur on the app's own tiers: there is no `calc()`, `clamp()` or
viewport-unit font size in `app/`, `src/` or `design/`. On the `ci` capture the note fires
on **96 of 136 pairs** while all 136 pairs read live — a live tier run is not evidence that no
text is frozen. The measurement, its manifest fields and its controls are in
`docs/e2e/README.md` §"How text scale is actually driven".

## 1. Screens to score

| # | Screen | Flows |
|---|---|---|
| S1 | Sign in (first screen) + system-browser hand-off | F-1 |
| S2 | Set up a computer (no tunnel yet; waiting; connected) | F-2 |
| S3 | Computers (list, switcher, add manually) | F-4, F-3 |
| S4 | Home (new chat: composer, splash, suggestions) | F-8 |
| S5 | Session (transcript, tool rows, todos, subagent strip, pending card, composer) | F-6 |
| S6 | Subagent | F-7 |
| S7 | New session (directory picker, model) | F-8 |
| S8 | Pending card: approval / single question / multi-question / secret / free-text | F-6 |
| S9 | Sheets: commands, model & effort, gate, projects, appearance | F-6, F-10 |
| S10 | Past sessions / resume | F-8 |
| S11 | Settings (§10 of flows.md) | F-10 |
| S12 | Pair this phone | F-6 |
| S13 | Connection loss, re-auth, relay refusal | F-9 |
| S14 | Demo mode | F-10 |
| S15 | Sessions (the conversations panel: live / degraded / ended, pinned, sections, search, past, computers; docked pane on a tablet) | F-5, F-8 |
| S16 | Projects (the listing, its pushed detail, and the lifecycle writes: create, delete, milestones) | F-10 |

## 2. States to capture for every screen

`loading` · `empty` · `populated` · `populated-long` (a 60-character session
name, a 400-character question) · `error` · `degraded` (`C3`) · `offline` (`C4`) ·
`narrow` (320 pt) · `text-200%` · `dark` · `light` · `reduce-motion on` ·
`large-device` (tablet / iPad split).

The connection states are named `C1`…`C7` in `flows.md` §9; the connector-setup
states are `W1`…`W5` in `flows.md` §2. Where a check or a finding concerns a
connection state, cite the id (`C3`), never a description ("the degraded one"), so
the rubric and the flow cannot drift apart — which is what round 1's M2 was.

**`C1` (the 60 s rotation) is deliberately absent from this list.** It is a state
of the *transport*, not of a screen: nothing is painted for it, and a capture in
which it is visible is a FAIL of U-16/U-27(a), not a state to add to the matrix.

Not every cell is meaningful for every screen; a cell may be marked `n/a` **with
a reason**, never skipped silently.

## 3. Automated checks

| ID | Check | How to verify | Pass criteria | Principle |
|---|---|---|---|---|
| U-01 | Touch-target size | Dump every interactive node's frame from the accessibility tree; compute min(width, height) | **≥ 44 pt** for anything a thumb aims at. 24 pt is the hard floor only for controls in a dense list *with* ≥ 8 pt spacing — and that exception must be recorded, not assumed | P-2, P-11 |
| U-02 | Contrast, body text | Compute every text node's colour against its effective background, per theme, per state | **≥ 4.5:1** for text below 18 pt (or 14 pt bold); **≥ 3:1** for large text, icons and UI boundaries | P-11 |
| U-03 | Contrast, non-text carriers | For each status that uses colour (pending, failed, streaming), check the colour is not the only carrier | A word, glyph or shape accompanies every colour-coded state | P-3, P-11 |
| U-04 | Font scale to 200 % | Set the OS text size to each of 100/150/200 % (iOS: Accessibility text sizes; Android: `fontScale`) and re-capture every screen | No clipped text, no overlap, no horizontal scroll, no control below 44 pt, no truncation of a *controlling* label (a title may ellipsize; a button label may not) | P-11 |
| U-05 | Safe areas | Capture on a device/home-indicator and one with a notch/Dynamic Island; measure content box vs unsafe inset | No content under the notch or the home indicator; no control within 8 pt of an unsafe edge; safe-area padding present on every full-bleed scroll. Three shapes are set aside and counted with their reason on the pass: a full-bleed **container that is not a control** (>= 90 % of the viewport wide, >= 60 % tall) — its background is not content, and the text and controls inside it are judged on their own; a **modal dialog's own ground** (no word and no control of its own, reaching an unsafe edge); and a modal's **full-bleed dismiss layer**, which is not a control a reader must reach | P-2, P-11 |
| U-06 | Horizontal overflow | Measure content width vs viewport at every state and every text scale | Never exceeds the viewport at 100 %; at 200 % overflowing *only* inside an explicitly scrollable region | P-11 |
| U-07 | Clipped text | For each text node, compare rendered box vs scroll extent; flag `overflow: hidden`/clip with hidden content | No clipped text except deliberate single-line ellipsis with a full value available on tap or in the accessibility label | P-11 |
| U-08 | Overlap | Pair-wise rectangle intersection over text and interactive boxes | Zero overlaps between two elements that both convey meaning. **Judged on PAINTED regions**, never on layout boxes: a node an ancestor clips part of the way keeps its full layout box, so a pair whose layout boxes intersect while their painted regions do not is *not* an overlap | P-11 |
| U-09 | Accessible name | Walk the accessibility tree; every interactive node must have a name | No unnamed buttons, links, inputs, toggles. Icon-only controls carry a label; a decorative icon is hidden from the tree | P-11 |
| U-10 | Label-in-name | Compare the visible label with the accessible name | The accessible name **contains** the visible label, so voice control ("tap approve") works | P-11 |
| U-11 | Heading/landmark order | Dump the tree's heading levels and reading order | Levels do not skip; the reading order matches the visual order top-to-bottom, bottom-sheet content reads after the content behind it (or is modal-isolated) | P-11 |
| U-12 | Focus order | Walk with keyboard/switch control through each screen | Focus order equals the visual order; focus is never trapped except inside a modal sheet, where it is trapped on purpose and Escape/back dismisses | P-2, P-11 |
| U-13 | Motion | Capture consecutive frames during every transition; enable "reduce motion" and repeat | Nothing animates for more than ~400 ms on a state change; under reduce-motion, transitions are instant and nothing loops | P-11 |
| U-14 | Haptics | Trigger each haptic path and log the call | Haptics fire only on: send accepted, approval answered, error, and destructive confirm — never on scroll, streaming ticks, or navigation. All are suppressed when the OS setting is off | P-2, P-8 |
| U-15 | Latency feedback | Timestamp tap → first visible acknowledgement, and tap → result, for: open session, send, approve, resume, switch computer, open sheet | Acknowledgement within **100 ms** for every tap; if the result takes > 400 ms, an in-progress state is visible with a name ("Sending…", "Connecting…"), never a bare spinner | P-5, P-9 |
| U-16 | Stream liveness, and the rotation that is not a fault | With a session streaming, sample the transcript's newest row at a fixed interval across **at least three 60 s rotations** (`MAX_STREAM_SECONDS = 60`, `gateway.py` L34 at the pinned `5bfff4a61`). Then two separate faults: (a) kill the relay's connector; (b) hold the socket **open and silent** — no chunk, no close — and watch the state over at least 90 s | Newest content keeps advancing **across every rotation** (`C1`); no `C2`/`C3` appears for a rotation at all. (a) names the state and its reason within the window; (b) raises `C3` **at `KEEPALIVE_GRACE_S = 75` and not before it** — the basis is the daemon's 25 s SSE keepalive (`SSE_KEEPALIVE_S`, `daemon.py` L104-105), so an earlier window would flap against the cadence (`flows.md` §9, "The grace window"). Never on "an SSE error" as such: an orderly close is `C1` | P-5, P-9 |
| U-17 | Cold-start time | Cold launch → first meaningful list from cache, and → first fresh relay frame | Cache render < 1 s; a "updated N ago" marker until fresh data arrives | P-9 |
| U-38 | Markdown tables render as tables | Render a fixture whose answer carries both a 3-column numeric table and a 2-column table; count nodes under a `md-table` testID, read each cell's text, and read the parser's own `session-tables` flag against the DOM | Three halves, each separately blindable: the leak scan reads each node's **full** text for the string `\|`, which **never** appears in rendered text; the structure half requires every `md-table` to render **its header** (a header-only table is legal per §1.7 — the divider is structure, not content) with cells containing no `\|` and no `---`; the marker half fails any frame whose transcript carries `session-tables` while the DOM carries zero `md-table` nodes — the pipe-source defect's signature, which the other two cannot catch (raw pipes carry no backslash escape, and with no table node the structure half never runs). A frame with no table at all is `n/a` for the structure half — the leak half still runs — and a frame with no marker is `n/a` for the cross-check | P-10 |
| U-39 | Table columns are priced from content | For each `md-table` cell, compare the cell's rendered min-content against its longest whitespace-delimited run; report any cell whose longest word is broken | No cell breaks a token shorter than the 64-character cap — inclusive, because sha256-hex is exactly 64 characters and must stay whole; every column's width ≥ its longest word | P-11 |
| U-40 | A horizontal scroller carries a cue | For every node with `overflow-x: auto/scroll` whose scrollWidth exceeds its clientWidth: assert a cue node exists (the fade's testID) and that the scroller's box bleeds past the content rail | Every overflowing horizontal scroller exposes a cue; no cue exists on a scroller that does not overflow. A scroller that is not a table's viewport (the code block) is reported as a recorded deferral, never passed silently — its cue is a separate decision (design pass §6.2) | P-11 |
| U-41 | A wrapped summary row keeps one rail and one caret line | For every multi-line summary row: collect each text line's left edge and the disclosure caret's box | Every text line's left edge is on the row's rail within ±2 pt; the caret's vertical centre is within ±4 pt of the **first** line's centre; a row whose first line starts more than 24 pt inside its own box is judged off the rail — that 24 pt window finds the first line, and the ±2 pt tolerance applies from there. Sites this change does not own are RECORDED in the check's exemption ledger with their reason and their measured numbers, and reported as EXCEPTION rows; a reading that moves off a record fails again, and a row outside the ledger is a FAIL | P-11 |
| U-42 | Spacing steps come from the scale | Read every element's computed `padding*`, `margin*`, `gap`, `rowGap`, `columnGap` on the scored screen | Every non-zero value is a step in `design/tokens/tokens.json` `space.scale`; a margin side computed as `auto` is layout, not a spacing decision, and is not scored (its resolved pixels depend on the viewport, not the scale), and a recorded site whose value the TEXT SCALE computes (an optical alignment offset) is recorded by path rather than by value; report each off-scale value with its selector. Sites this change does not own are RECORDED as declared exemptions, with their reason, and reported as EXCEPTION rows; an off-scale value with no record is a FAIL | P-11 |

## 4. Copy checks (manual, one pass per screen)

| ID | Check | Pass criteria | Principle |
|---|---|---|---|
| U-18 | Every string names the computer when it matters | A sentence about work, files or a failure names **where** it happens ("on *Studio*"), not "the server" | P-5, P-10 |
| U-19 | Errors are recoverable and worded for the user | Every error states what happened + one action; no status codes, no stack traces, no raw ids; a refusal that has a remedy offers it as a control on the phone | P-5, P-6, P-10 |
| U-20 | Vocabulary matches the terminal and the relay | Every noun used in the app appears with the same meaning in `docs/mobile.md`/the TUI; relay-owned strings are rendered, not reworded | P-10 |
| U-21 | No jargon noun, no adjective doing a verb's job | Each user-facing string passes the voice rules: say what happens; no compound abstract nouns; no unverifiable claim | P-10 |
| U-22 | Empty states say what the screen is for | Every empty state has one sentence of purpose + one action; never a bare "No data" | P-5 |
| U-23 | Confirmations are proportionate | Destructive actions confirm and name the consequence; reversible actions do not confirm and offer undo | P-2 |
| U-24 | Disabled controls explain themselves | A disabled control is accompanied by why, within reading distance; a disabled *submit* never sits alone | P-9 |

## 5. Flow checks (manual, per flow)

| ID | Check | Pass criteria | Principle |
|---|---|---|---|
| U-25 | No dead ends | From any screen, back/up reaches a stable parent; Android's back gesture never exits the app from a mid-flow screen; every sheet dismisses by swipe and by back | P-1, P-2 |
| U-26 | The feature is discoverable without the docs | A user who has never seen the app can reach the session list and answer a pending decision without reading anything outside the app | P-3 |
| U-27 | Connection honesty, rotation included | (a) Hold a session open for **three rotations uninterrupted**: `C1` must be invisible — no banner, no flash, no word. (b) Kill the computer's connector mid-session: the app names `C3`/`C7` and the reason (immediately if the close is observed, otherwise within `KEEPALIVE_GRACE_S`), the transcript stays readable, and nothing appears to have been sent. (c) Compare (a) and (b) side by side: the routine case must not wear the same visual as the fault | P-5, P-9 |
| U-28 | Re-auth ladder | Expire the edge session: the app offers **Sign in again** in place, does not wipe the draft, and returns to the same screen after re-auth | P-4, P-5 |
| U-29 | Ambiguous send | Interrupt a send mid-flight: the app marks it unknown, keeps the text, offers retry, and retrying does not duplicate the instruction | P-4 |
| U-30 | Keyboard avoidance | Open the composer with the soft keyboard up on a small phone: the field, the send control and any pending decision above it stay visible; the layout below them scrolls | P-2 |
| U-31 | One-handed reach | Every primary action on the scored screen lies within a thumb arc measured from the bottom-right corner on a 375-pt device (a 44-pt target whose centre is within the lower-third band and horizontally within the device's outer 80 %) | P-2 |
| U-32 | Interruption safety | Put the app in the background mid-turn, kill it, relaunch: drafts survive, the session state is re-read, no phantom "sending" persists | P-4 |
| U-33 | Theme and personalisation axes | Every scored screen captured in the app's supported axes (dark/light/system, accent, largest and smallest text) with no state-only-in-one-theme defect | P-11 |
| U-34 | Slow/flaky network | Throttle to a high-latency, lossy profile with the stream rotating underneath: no freeze, no double-send, reconnects resume without replaying a stale snapshot (the projection `version` drops the older epoch), `C3` names the state once `KEEPALIVE_GRACE_S` (75 s) passes and not before, and recovery is automatic | P-5, P-9 |
| U-35 | Multi-computer correctness | With two computers connected, switching never mixes their sessions, models, credentials or caches; a session's computer is visible on its screen | P-5, P-10 |
| U-36 | The pending decision is reachable | With a pending approval/question on screen: the decision control is visible and tappable with the soft keyboard up, at the smallest supported device and at 200 % text, with a paragraph-length question and a 10-option ask | P-2, P-7 |
| U-37 | Local data is visible and clearable | *Clear local data* removes drafts, caches and tokens and says what it removed; sign-out does the same; the app makes no network request the user was not told about (verified against the network log for a full flow) | P-4, P-12 |

## 6. Per-screen specifics the harness must not skip

- **S15 Sessions (the panel):** a row's state must be readable without opening it (word +
  colour); search must survive a reconnect; a degraded computer's rows must be
  visually distinct from an ended session's; loading and empty must be
  distinguishable to the eye (their markers are `sidebar/loading` and the
  sessions empty state).
- **S16 Projects:** the listing's sections are the relay's own board order and an
  unrecognised status takes its own trailing section rather than vanishing; a
  milestone's chip is the status the RELAY derived (never one the client
  recomputed from the dates); the stale badge is the relay's verdict and clears
  with it; and a refusal shows the daemon's own sentence — including the
  near-miss name a `404 project_not_found` carries — never a bare status.
  **The writes are the surface now, and their rules are:** a create form offers
  the status and the tags the relay accepts (not a read-path subset), and a taken
  name or an invalid value comes back as the STORE's own sentence; the delete and
  the milestone removal each sit behind a confirm whose FIRST press sends nothing
  (neither is undoable); a milestone name carrying a slash is refused WHILE IT IS
  TYPED, with the reason, rather than offered a control that cannot work; a write
  in flight shows on the control that is waiting, and an unanswered one says the
  outcome is unknown rather than that nothing happened; and a milestone whose
  project vanished under the write returns to the listing with the relay's own
  sentence rather than standing a refusal under a row that is gone.
- **S5 Session / S8 Pending card:** the decision controls must be reachable with
  the keyboard open on the smallest supported device, and with a paragraph-length
  question. This is the highest-value screen in the app and the one with the
  worst historical failures (see `current-relay-audit.md` §2.1).
- **S13 Connection loss:** every relay refusal reason
  (`control_plane_unreachable`, `authorization_refused`, `tunnel_not_authorized`,
  `authorization_lease_pending`, `login_required`) must render as its own
  sentence with its own action; the audit enumerates them, it does not sample.
- **S14 Demo mode:** must be labelled, must touch no network, and must exercise
  every screen (store reviewers must be able to see the whole app).

## 7. Scoring

Per screen × state, count the FAILs by severity:

- **BLOCKER** — unusable or dishonest: a decision control unreachable, a state
  that lies about connection, a crash, content under the home indicator, an
  unnamed primary control.
- **MAJOR** — a user cannot complete the flow without guessing or working around
  it: clipped controlling label, overflow at 200 %, an error with no action, a
  dead end.
- **MINOR** — friction with a workaround: sub-optimal ordering, a weak sentence,
  a missing haptic.
- **NIT** — polish.

**Release gate:** zero BLOCKER and zero MAJOR on every scored cell, on the
current head, with the round's artifacts attached. MINOR and NIT findings are
listed and triaged, capped at five each so the real problems are not buried.

## 8. Notes on method

- **Measure, never estimate.** Every number in a finding comes from an artifact.
- **Capture before and after** for any change to an existing screen.
- **One axis at a time** when isolating a defect (text scale *or* viewport *or*
  theme), then re-combine for the final pass.
- **A green automated run is a floor, not a verdict**: §4-§6 still have to be
  walked by a person driving the real app.
- **Never score a still only.** A flow has timing, focus and state; the frames
  are evidence for the checks that are about appearance, not a substitute for
  driving the flow.
- **A failing check is not automatically a regression.** Diff it against a run of
  the previous head before filing it: an intermittent a11y-tree or overflow
  reading is a flake, and reporting it as a defect spends a remediation round on
  the harness.

## 9. The machine-readable manifest, and the rubric's own tests

The same checks live as data in `audit-checks.json`, beside this file. The
markdown is the spec — what to do, how to verify, and the pass criteria — and the
JSON is the index the harness and its tests load, so the two cannot silently
diverge:

```json
{
  "schema": 1,
  "citation_ref": "local-operator 5bfff4a61 (2026-09-29); agent-server dcafe85",
  "severity_ladder": ["BLOCKER", "MAJOR", "MINOR", "NIT"],
  "severity_caps": { "MINOR": 5, "NIT": 5 },
  "release_gate": {
    "blockers_on_head": 0,
    "majors_on_head": 0,
    "requires_artifacts": true,
    "scored_per": "screen x state"
  },
  "states_are_named_in": "flows.md section 2 (W1-W5) and section 9 (C1-C7)",
  "principles_unchecked": [],
  "checks": [
    { "id": "U-01", "title": "Touch-target size", "method": "automated",
      "principles": ["P-2", "P-11"] }
  ]
}
```

**The harness's own unit tests assert, on every change to this pair:**

| # | Assertion | Why it exists |
|---|---|---|
| R1 | Every `U-\d\d` in the markdown tables appears in `checks`, and every check appears in the markdown | The two forms are one rubric; a one-sided edit is how a check quietly dies |
| R2 | Ids are unique and contiguous from `U-01` to the last, and `method` is one of `automated` / `manual-walk` | A renamed or duplicated id makes a remediation's `U7 fixed` ambiguous |
| R3 | Every `P-n` referenced by a check exists in `principles.md`, and every principle `P-1`…`P-12` is referenced by at least one check (or is listed in `principles_unchecked` with a reason) | A principle nothing checks is a principle nothing enforces — and this is the assertion that caught `P-6`/`P-7`/`P-12` having no check in round 1 |
| R4 | `severity_caps` caps MINOR and NIT at 5 each, and the ladder is exactly BLOCKER/MAJOR/MINOR/NIT | The cap is what keeps the real findings from being buried |
| R5 | The release gate requires zero BLOCKER and zero MAJOR and `requires_artifacts: true` | The gate is a property of the rubric, not a sentence in a review comment |
| R6 | Every state id cited anywhere in this file exists in `flows.md` (`C1`…`C7`, `W1`…`W5`) | Round 1's M2 was exactly this class of drift: a rubric asserting a connection rule the flow did not state |

Those assertions are cheap, deterministic and run in milliseconds, which is why
they belong in the harness's unit suite rather than in a review round. **They are
the only part of this rubric that is pass/fail without a device** — everything
else in §3-§7 needs the real app on a real screen size.
