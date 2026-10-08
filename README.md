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

The rig that made them is in `rig/` (`rig.mjs` — it imports the repository's own
`tools/mock-relay/relay.ts`, `tools/lib/static-server.ts` and
`tools/lib/chrome.ts`, so it drives the same mock relay and headless-Chrome
launcher the repo harness does; the one in-process bridge it adds answers
`GET /api/asks`, which the mock relay has no route for yet, from the pinned
scenario's own rows). `rig/*.log` are the runs' stdout:
`rig-full.log` (14 flows, 14/14 PASS), `rig-open.log` (the five re-shot
open/dismiss flows after the deadline fix, 5/5), `rig-quiet.log` (the six
no-ask flows after clearing the corpus's stale `activity` copy, 6/6).

Usage (from a machine with this repo checked out and its web exports built):

    WT=<worktree> node rig/rig.mjs
    RIG_ONLY=after/open,after/dismiss WT=<worktree> node rig/rig.mjs


## Round 1 remediation (head `19ef825`)

`r1/` holds the frames re-shot on the REMEDIATED web export (`19ef825`), plus the
round-1 comparison pairs against the previous head (`025da93`):

- `r1/after__*` — the original four-state matrix re-run against `19ef825`
  (`rig/rig-r1-after.mjs`, log `rig/rig-r1-after.log`, 9/9 PASS). These supersede
  the root-level `after__*` frames, which show `025da93`.
- `r1/before-r1__*` / `r1/after-r1__*` — `025da93` vs `19ef825` on the same world:
  `open` (iphone-15 dark+light, iphone-se dark), `collapsed` (the row's caret),
  `readfail` (the aggregate read answers 503), `dismissed` (focus after close).
  Driver `rig/r1-driver.mjs`, log `rig/r1-driver.log`, 15/15 PASS.

Local home-directory paths are scrubbed from every committed log and JSON
(`~/` in place of the home prefix).
