# Verification for ADR 0006 (push and ack-sync)

Three scripts, kept here so the next author can re-run the checks this ADR's provenance paragraph
describes instead of trusting a number in a comment. They read the ADR and `docs/push-plan.md` from
this repository, and the cited **sources** from a second checkout with `git show <ref>:<path>` —
never from a working tree, because the shared checkouts carry other sessions' staged work.

```sh
cd <this repository>
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/verify-documents.py
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/resolve-citations.py
LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/read-citations.py [filter]
```

`LOCAL_OPERATOR_REPO` defaults to `~/local-operator`. Both source-checking scripts **exit 2 with a
clear message** when that path is not a git repository or does not contain the ref they need, rather
than reporting a resolution failure — a missing clone is a setup error, and saying so is the only
useful thing to do about it.

## Two refs, and how a citation says which

The document cites two trees, and a citation's ref is part of its meaning:

| Ref | What it is | How it is cited |
|---|---|---|
| `40ca7910e49a` | the `local-operator` pin the provenance table names | the plain form, `` `gateway.py`:537 `` |
| `d089f7e0fc0a324c38d6499290c27b2569714549` | **PR #1864's head** (open, not merged) — the implementation this ADR adopts | with an explicit **`(#1864)`** marker after the range, `` `daemon.py`:4730-4770 (#1864) ``; `push_devices.py` needs no marker because the file exists only there |

Two files are cited at both refs (`daemon.py`, `cli.py`), which is exactly why the marker exists: a
`daemon.py` citation **without** it is checked against the pin, and fails loudly if its line is not
there — the signal that it needed a marker.

## What each script proves, and what it does not

**`verify-documents.py`** asserts the statements the ADR and the plan make about themselves: that a
cited design element is present, that a retired shape is gone, that the two documents agree on a
vocabulary. *What it does not prove:* that any of it is true of the code — it never opens the pinned
sources. Pass a git ref as its first argument (e.g. a commit SHA) to check the pushed tree instead of
the working copy.

**`resolve-citations.py`** resolves each citation **path first** (`git cat-file -e <ref>:<path>`),
then checks the line or range against the file's length. It handles both citation forms the document
uses: a **named** one (`` `daemon.py`:3377-3380 ``) and a **bare continuation** (`` `:3382-3388` ``),
which inherits the last named file *and that file's ref*, the way the prose reads. *What it proves:*
every mapped path exists at its ref and every cited line resolves. *What it does not prove:* that the
cited line **supports** the claim — `attention.py:1611` resolved for several rounds while the kind
vocabulary it was cited for lives at `:2047` (QA round 5 Q-F6).

**`read-citations.py`** is that half: for every citation it prints the claim beside it and the pinned
line itself. It is a reading aid, not an oracle — a human compares the two columns — but it is what
turned up the `:1611` → `:2047` and `daemon.py:777-813` → `:778-782` corrections.

### Exactly what is NOT checked (round 7, QA's note on an overstated claim)

* **Citations in `.md`, `.ts` and `.tsx` files.** They resolve at the *mobile* repository's pin, not
  the one these scripts read, so they are counted and printed as `NOT CHECKED` — the run reports the
  denominator rather than implying it checked them.
* **A bare range that follows no named file** (nothing to inherit).
* **A backticked file name with no line number** — prose, not a citation. They are counted and
  printed (`MENTIONS WITHOUT A LINE NUMBER`) rather than skipped in silence: a citation-shaped
  token the resolver does not understand is a hole in the denominator, and round 7's QA found
  one being skipped with `rc=0`.
* **Whether a citation's line supports its claim** — see `read-citations.py` above.
* **The `(#1864)` citations' *content* against core's current head.** They are checked against the
  head this document names (`d089f7e0f`). If #1864 moves, re-run against its new head and update the
  marker's ref; the document says which head it read.
* **Anything the table neither maps nor spells out**: an unmapped *Python* citation is a **failure**,
  never a silent skip — that strictness is what found seven unmapped paths in round 6.
