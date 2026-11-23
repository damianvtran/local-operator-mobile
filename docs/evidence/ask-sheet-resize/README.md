# Ask sheet: two sizes and the keyboard — rendered evidence

Simulator frames of the real app (`com.localoperator.mobile` debug build, Metro
from the PR worktree) on the shared iPhone 18 Pro (iOS 27.2), 402 pt wide. The
sheet is the REAL `AsksSheet` against a throwaway fake relay with one ask of
three questions (the first with three labelled options plus the `Other` door),
rendered through a harness that is never committed.

Two heads contribute, and each bullet says which: most frames are from the
round-2 head (`d734d7ed`), whose sheet, field and footer are unchanged by the
later fixes; the bar frames (17, 18), the four-line frame (06) and the swipe pair
(13, 14) were re-shot on the round-3 head after the bar was re-centred. Swipe-down
(13→14) and its keyboard-up frame are QA's round-2 run, the same run and device as
the pair's second frame.

Light, default text size:

- `01-light-opens-large.png`: the sheet opens at **Large** when the content does
  not fit Medium (top 7.8 % of the screen).
- `02-light-other-one-tap-kb.png`: ONE tap on `Other` opens the door, focuses its
  field and raises the keyboard.
- `03-light-field-revealed-kb.png`: the body scrolled the field into view above
  the pinned footer while typing.
- `04-light-store-probe-after-close.png`: after closing the sheet the harness's
  probe reads the in-memory draft — `multi@fixture-session:
  others[q1:keep this answer]`.
- `05-light-reopened-draft-no-kb.png`: reopened, the typed answer is back in the
  field, the door ticked, and **no keyboard** is raised.
- `06-light-four-lines-cap.png`: the Other field grown to its 100 pt cap (four
  lines), the whole field visible above the footer (round-3 head).
- `07-light-done-key.png`: Return ("Done") put the keyboard away and submitted
  nothing — 1/3 still current, 2/3 and 3/3 still listed, Answer/Decline pinned.
- `08-light-header-drag.png`: a header drag with the keyboard up dismissed the
  keyboard and left the size where it was (Large).
- `09-light-scrim-first-tap.png`: the first tap on the dim strip with the keyboard
  up hid the keyboard and kept the sheet open.
- `10-light-dragged-medium.png`: a header drag down settled on **Medium**
  (top 39.8 %), still open.
- `11-light-bar-tap-large.png`: a tap on the grab bar went back to **Large**.
- `12-light-scrim-kbdown-closed.png`: with the keyboard down, a scrim tap closes
  the sheet (home screen; the probe still holds the draft, the ask is open).
- `13-light-swipe-down-kb-up.png` / `14-light-swipe-down-after.png`: a downward
  swipe on the body with the keyboard up (`keyboardDismissMode="interactive"`) —
  keyboard up over the focused field, then gone, sheet still open at Large.
- `17-light-bar-centred.png`: the grab bar's pill on the sheet's centre line. The
  measured frame is `[141,69][261,113]` pt — 120 × 44, centre x 201 of 402. A tap
  at (10 %, 9 %) — over the title's first words, outside that frame — left the
  size at Large (the session index holds that frame and the dump).

Dark:

- `15-dark-other-kb.png`: `Other` field focused with the keyboard up.
- `16-dark-plain-sheet.png`: a plain, non-resizable `Sheet` — no grab bar.
- `18-dark-bar-centred.png`: the centred grab bar on the dark sheet.

Not verified here: VoiceOver spoken output (the tree is pinned by tests and by
QA's hierarchy dumps); Urdu/RTL rendering; accessibility text sizes above
`extra-extra-large`; Android; the body's empty tail as a dismissal route (a
device check); a plain-sheet frame in light (dark `16` shows the same primitive).
