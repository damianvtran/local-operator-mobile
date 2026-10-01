# Verification for ADR 0006 (push and ack-sync)

Three scripts, kept here so the next author can re-run what the ADR's provenance paragraph claims
instead of trusting a number in a comment. They read the ADR and `docs/push-plan.md` from this
repository and the cited **sources** from a second checkout with `git show <ref>:<path>` — never
from a working tree, because shared checkouts carry other sessions' staged work.

```sh
cd <this repository>
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/verify-documents.py [git-ref]
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/resolve-citations.py
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/read-citations.py [filter]
```

`LOCAL_OPERATOR_REPO` defaults to `~/local-operator`. **Setup failures exit 2 and content failures
exit non-zero — one `!!` line is never a pass.** The table below is what each script *does*,
measured rather than asserted (round 9 Q-F31, round 10 R10-M1/m1/Q-F33/Q-F34):

| failure | `verify-documents.py` | `resolve-citations.py` | `read-citations.py` |
|---|---|---|---|
| `$LOCAL_OPERATOR_REPO` is not a git repository | **0** — this script never opens it | **2** | **2** |
| a ref the document names is absent from the checkout | **2** | **2** | **2** |
| a document cannot be read | **2** | **2** | **2** |
| a cited **path** is missing at a ref the checkout *does* carry | **0** — it never opens the sources | **1** | **1** (`!!`) |
| a cited **line** is beyond EOF | **0** | **1** | **1** (`!!`) |
| a citation into a dual-ref file carries no marker | **0** | **1** | not checked here |
| a document self-assertion fails | **1** | — | — |
| the parser no longer matches its own citation forms | — | **3** | — |

A missing clone, a typo'd SHA, or a ref the clone lacks is a setup error, and saying so is the only
useful thing to do about it; a traceback is not an answer. Two of these rows were wrong before round
10: `read-citations.py` printed one `!!` per citation for an absent ref and still exited **0** (154
of them), and the worktree default of `verify-documents.py` raised `FileNotFoundError`.

`resolve-citations.py` runs a **parser self-test** at startup and exits **3** if its own patterns
stop matching the citation forms below — and the self-test covers **both directions**: a bare
mention (``daemon.py``) must match the mention counter while a citation (``daemon.py`:3377-3380`)
must NOT. A counter whose lookahead cannot fail reports zero forever while this README promises it
prints, so the negative arm is the assertion that keeps it alive (round 9, R9-M1; QA round 8,
Q-F26).

`read-citations.py` exits **1** when it prints any `!!` line — a citation beyond EOF *or* a path
missing at a ref the checkout carries — so a reading aid that could not read something is not
mistaken for a clean pass. (It exits **2** when the checkout itself is the problem: not a
repository, or missing the ref the document cites.)

## Two refs, and how a citation says which

| Ref | What it is | How it is cited |
|---|---|---|
| `40ca7910e49a` | the `local-operator` pin the ADR's provenance table names | `(pin)` after the range, or no marker for a file that exists only there |
| `d089f7e0fc0a324c38d6499290c27b2569714549` | **PR #1864's head**, **merged as `813c6bf89`** (in `v0.64.13`) — the implementation the ADR adopts | `(#1864)` after the range; `push_devices.py` needs none, the file exists only there |

`daemon.py` and `cli.py` exist at **both** refs with different code on the same line numbers, so **a
citation into either without a marker is a failure** — that is the check that stops an author citing
a
#1864 line that happens to exist at the pin (QA round 8). A **bare continuation** (`:3382-3388`)
inherits the last named file *and its ref*, which is how the prose reads.

## Reproducing a failure arm (so a check is not taken on faith)

Each row of the table above was produced by actually breaking something, and the recipe matters:
`verify-documents.py` asserts the **documents**, not the files they cite, so breaking a file
elsewhere in the repository changes nothing. To move it, break the string it asserts — e.g. edit the
ADR's own `architecture.md`:299 mention at `:223` to `:29X`; the run then reports `FAIL B1 three
sites: architecture.md:299` and exits **1**. Its one check that *does* read a file it is about — the
amended `docs/architecture.md` row — moves when that file's row changes, and that file is read
**from the ref being validated**, never from the CWD.

## Residuals, stated rather than implied (round 12)

* **The ref check in `read-citations.py` is LAZY.** It runs only when a citation's `git show` fails,
  so a checkout missing a ref that the documents never cite *in a Python file* would exit 0 — the
  resolver, by contrast, validates both refs up front and would exit **2** on that same checkout.
  For these documents the case cannot be reached: `(pin)` and `(#1864)` each appear on citations in
  the ADR, so the first failing `git show` is always a ref check. Verified in both directions, and
  the two scripts say it differently — both exit **2**, but the line is not the same one:
  `read-citations.py` prints `MISSING REF: <ref> is not in <repo> — set LOCAL_OPERATOR_REPO to a
  clone that carries it`, while `resolve-citations.py` prints `UNUSABLE CHECKOUT: <repo> has no
  commit <ref> — fetch it, or point LOCAL_OPERATOR_REPO at a clone that does`. Measured on a clone
  carrying only the pin and on one carrying only PR #1864's head.
* **The backtick counts, and the method behind them.** Two methods, stated because they differ:
  excluding the fence **marker** lines still counts fenced *contents*; excluding the fenced
  **blocks** does not. At the `docs/adr-0006-hygiene` head the ADR reads **2028** by the first
  method and **1920** by the second (2088 over all lines); `docs/push-plan.md` **548** by both (554
  over all lines — the six extra sit on fence markers); this README **132** by both (138 over all
  lines, and a *reading*, not an invariant: it moves whenever this file is edited). Every figure is
  **even** under both methods, which is the claim being made — an unbalanced pair shows as an odd
  count. That is how the one real stray was found: an extra backtick after a citation's closing
  parenthesis, on the `gateway.py`:310-319 `*(NEW)*` line, removed in round 10.

## What each script proves, and what it does not

**`verify-documents.py`** asserts the statements the ADR and the plan make about themselves: that a
cited design element is present, that a retired shape is gone, that the two documents agree on a
vocabulary. Pass a git ref as its first argument to check a pushed tree rather than the working
copy. *Does not prove:* anything about the code — it never opens the pinned sources.

**`resolve-citations.py`** resolves each citation **path first** (`git cat-file -e <ref>:<path>`),
then the line or range against the file's length, at the ref the citation names. *Proves:* every
cited path exists at its ref and every cited line resolves. *Does not prove:* that the line supports
the claim — `attention.py:1611` resolved for several rounds while the fact it was cited for lives at
`:2047` (QA round 5 Q-F6).

**`read-citations.py`** is that half: for every citation it prints the claim beside it and the line
from the tree the citation names (so `(#1864)` and `push_devices.py` entries are read at PR #1864's
head). It is a reading aid, not an oracle: a human compares the two columns.

### Exactly what is NOT checked (round 8, QA Q-F26/Q-F27)

* **Citations in `.md`, `.ts` and `.tsx` files** — they resolve at the *mobile* repository's pin,
  not the one these scripts read. Counted and printed as `NOT CHECKED`, never silently skipped.
* **A backticked file name with no line number** — prose, not a citation. Counted and printed
  (`MENTIONS WITHOUT A LINE NUMBER`).
* **A line number written as prose** (`... line 5`) — not a parsed citation form. Reported
  (`CITATIONS WRITTEN AS PROSE`) so it is visible; write `file.py`:5 instead.
* **An unmapped Python citation is a FAILURE, not a skip** — that strictness is what found seven
  unmapped paths in round 6 and the `server.py` mismatch in round 8.
* **Whether a citation's line supports its claim** — see `read-citations.py` above.
* **The `(#1864)` citations' content against core's *current* head**: they are checked against the
  head this document names. If #1864 moves, re-run against its new head and update the marker's ref.
