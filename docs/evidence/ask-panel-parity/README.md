# Ask sheet parity with the relay page — rendered evidence

Simulator frames of the real app (`com.localoperator.mobile` debug build, Metro
from the PR worktree) on the shared iPhone 18 Pro (iOS 27.2). The sheet is the
REAL `AsksSheet` against a throwaway fake relay with fixture asks, rendered through
a harness that is never committed. BEFORE is origin/main `3a9656a2` (the base),
AFTER is this branch.

Which head each frame comes from: `pairs/` and most of `frames/` are from `3c6d0d4f`
(round 2); the AX-large frames (`14*`, `31*`) are from the final head `5ebf393a`
(after the stacked footer's progress sentence was fixed, QA round 4). Between those
heads only these changed: a few English strings (`Nothing left…`, saved-secret notice,
`Deadline passed … ago`, `Answer this question`), `checked` state on multi-select
rows, the `Dismiss…` link's 44 pt minimum width and its own row at large text.
Light unless the name says dark.

## pairs/ — BEFORE | AFTER

- `01-…`: a waiting ask with the question first, tinted option rows with a trailing ring, `· Urgent`, footer with `Send answers` / `Decline` and a quiet `Dismiss…`.
- `03-…`: a timed-out ask (read-only card, one `Dismiss`).
- `04-…`: a three-question ask partly answered, Send disabled and why.
- `08-…`: the open card, other waiting asks as question-first rows, the `Settled` heading, the honesty line last.
- `26a-…`: collapsed rows with a foreign conversation name and a long question.
- `29-…`: `Settled` rows.
- `11a-…`: a refused answer keeps the relay's own sentence above Send. `11b-…` (dark): read failed with `Try again`.

## frames/ — AFTER only

- `25a`, `25c`: option rows at rest (ring / square) and selected (filled disc / box with ✓), light and dark.
- `27a`, `27b`: `Dismiss…` normal, and hidden while the keyboard is up.
- `10b`: the reasons panel on a multi-question ask ("Dismiss these questions").
- `28`: empty state.
- `13g`: Urdu with the layout truly mirrored (✕ left, ring left, accent edge right, ◂).
- `14c`, `14e`: accessibility-large text: Send and Decline stacked at equal width, progress sentence present, `Dismiss…` on its own row (footer ≈ 28 % of the sheet; 12 % at default size).
- `31a`, `31c`: Vietnamese and Russian at accessibility-large: no clipped labels.

## Not verified

VoiceOver speech and the `checkbox`/`radio` roles (the hierarchy dump carries no roles;
pinned by `asks-sheet.render.test.tsx`); a short phone (one shared simulator, iPhone 18
Pro only); Android; landscape; text sizes above accessibility-large; a real relay;
the non-English wording (written without a native speaker; flagged in the catalogue
context file).
