# Ask sheet: two sizes and the keyboard — rendered evidence

Simulator frames of the real app (`com.localoperator.mobile` debug build, Metro
from the PR worktree) on the shared iPhone 18 Pro (iOS 27.2). The sheet is the
REAL `AsksSheet` against a throwaway fake relay with one ask of three questions
(the first with three labelled options plus the `Other` door), rendered through a
harness that is never committed. Head of this set: the round-2 remediation
(`d734d7ed` + the round-3 pins); the pill and the layouts in these frames are
unchanged by the later fixes (the grab bar's invisible frame narrowed, a hint
string, a guard).

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
- `06-light-four-lines-cap.png`: the field grown to its 100 pt cap (four lines),
  the whole field visible above the footer.
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
- `13-light-swipe-down-before.png` / `14-light-swipe-down-after.png`: a downward
  swipe on the body with the keyboard up (`keyboardDismissMode="interactive"`) —
  keyboard up, then gone, sheet still open. (QA's round-2 run, same head family.)

Dark:

- `15-dark-other-kb.png`: `Other` field focused with the keyboard up.
- `16-dark-plain-sheet.png`: a plain, non-resizable `Sheet` — no grab bar.

Not verified here: VoiceOver spoken output (the tree is pinned by tests and by
QA's hierarchy dumps); Urdu/RTL rendering; accessibility text sizes above
`extra-extra-large`; Android. A plain-sheet light frame is not included (dark
`16` shows the same primitive); the empty tail of the body is a device check.
