# asks-open-default — the web-target frames

PR evidence for `feat/asks-open-by-default` (local-operator-mobile). These frames
are NOT part of that PR's branch: this ref exists so reviewers can open them, and
it carries nothing else.

Captured by a scratch rig outside the repository, driving the repo's own mock
relay + static server + headless Chrome (`--use-mock-keychain`), at phone sizes,
against two web exports:

- `before__*` — the export of `main` at the branch's fork point (`9196c22`)
- `after__*`  — the export of the branch head (`025da93`)

Filenames: `<build>__<state>__<device>__<theme>.png`. States: `none` (nothing
queued), `open` (pending on open), `answered` (all addressed), `dismissed`
(closed by the reader while pending), `reentered` (left the conversation and
came back). The `dismissed`/`reentered` states are only reachable on `after`:
the `before` build never opens the sheet, which is the defect this feature fixes.
