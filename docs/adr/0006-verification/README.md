# Verification for ADR 0006 (push and ack-sync)

Three scripts, kept here so the next author can re-run what the ADR's provenance paragraph claims
instead of trusting a number in a comment. They read the ADR and `docs/push-plan.md` from this
repository and the cited **sources** from a second checkout with `git show <ref>:<path>` — never from
a working tree, because shared checkouts carry other sessions' staged work.

```sh
cd <this repository>
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/verify-documents.py [git-ref]
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/resolve-citations.py
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/read-citations.py [filter]
```

`LOCAL_OPERATOR_REPO` defaults to `~/local-operator`. Both source-checking scripts **exit 2 with a
clear message** when that path is not a git repository or lacks the refs they need — a missing clone
is a setup error, and saying so is the only useful thing to do about it. `resolve-citations.py` also
runs a **parser self-test** at startup and exits 3 if its own patterns stop matching the citation
forms below: a checker whose regex silently stops matching reports "all clear" for a document nothing
was extracted from (QA round 8, Q-F26).

## Two refs, and how a citation says which

| Ref | What it is | How it is cited |
|---|---|---|
| `40ca7910e49a` | the `local-operator` pin the ADR's provenance table names | `(pin)` after the range, or no marker for a file that exists only there |
| `d089f7e0fc0a324c38d6499290c27b2569714549` | **PR #1864's head** (open, not merged) — the implementation the ADR adopts | `(#1864)` after the range; `push_devices.py` needs none, the file exists only there |

`daemon.py` and `cli.py` exist at **both** refs with different code on the same line numbers, so **a
citation into either without a marker is a failure** — that is the check that stops an author citing a
#1864 line that happens to exist at the pin (QA round 8). A **bare continuation** (`:3382-3388`)
inherits the last named file *and its ref*, which is how the prose reads.

## What each script proves, and what it does not

**`verify-documents.py`** asserts the statements the ADR and the plan make about themselves: that a
cited design element is present, that a retired shape is gone, that the two documents agree on a
vocabulary. Pass a git ref as its first argument to check a pushed tree rather than the working copy.
*Does not prove:* anything about the code — it never opens the pinned sources.

**`resolve-citations.py`** resolves each citation **path first** (`git cat-file -e <ref>:<path>`),
then the line or range against the file's length, at the ref the citation names. *Proves:* every cited
path exists at its ref and every cited line resolves. *Does not prove:* that the line supports the
claim — `attention.py:1611` resolved for several rounds while the fact it was cited for lives at
`:2047` (QA round 5 Q-F6).

**`read-citations.py`** is that half: for every citation it prints the claim beside it and the line
from the tree the citation names (so `(#1864)` and `push_devices.py` entries are read at PR #1864's
head). It is a reading aid, not an oracle: a human compares the two columns.

### Exactly what is NOT checked (round 8, QA Q-F26/Q-F27)

* **Citations in `.md`, `.ts` and `.tsx` files** — they resolve at the *mobile* repository's pin, not
  the one these scripts read. Counted and printed as `NOT CHECKED`, never silently skipped.
* **A backticked file name with no line number** — prose, not a citation. Counted and printed
  (`MENTIONS WITHOUT A LINE NUMBER`).
* **A line number written as prose** (`... line 5`) — not a parsed citation form. Reported
  (`CITATIONS WRITTEN AS PROSE`) so it is visible; write `file.py`:5 instead.
* **An unmapped Python citation is a FAILURE, not a skip** — that strictness is what found seven
  unmapped paths in round 6 and the `server.py` mismatch in round 8.
* **Whether a citation's line supports its claim** — see `read-citations.py` above.
* **The `(#1864)` citations' content against core's *current* head**: they are checked against the
  head this document names. If #1864 moves, re-run against its new head and update the marker's ref.
