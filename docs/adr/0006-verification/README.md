# Verification for ADR 0006 (push and ack-sync)

Three scripts, kept here so the next author can re-run the checks the ADR's own
provenance paragraph describes instead of trusting a number in a comment. They
read the ADR and `docs/push-plan.md` from this repository and the **pinned**
`local-operator` sources with `git show <pin>:<path>` — never from a working
tree, because the shared checkouts carry other sessions' staged work.

```sh
# from the repository root; the local-operator clone is at ~/local-operator (set REPO inside if not)
python3 docs/adr/0006-verification/verify-documents.py            # the document's own assertions
python3 docs/adr/0006-verification/resolve-citations.py           # every path, then every line
python3 docs/adr/0006-verification/read-citations.py              # the cited LINE, printed beside its claim
```

**`verify-documents.py`** asserts the statements the ADR makes about itself and
about the plans — that a cited design element is present, that a retired shape is
gone, that the two documents agree on a vocabulary. *What it proves:* the
documents say what their remediation comments claim. *What it does not prove:*
that any of it is true of the code — it never opens the pinned sources.

**`resolve-citations.py`** resolves each mapping the table declares, **path
first** (`git cat-file -e <pin>:<path>`), then checks the cited line (or range)
against the file's length. *What it proves:* every mapped path exists at the pin
and every cited line resolves. *What it does not prove:* that the cited line
**supports** the claim — `attention.py:1611` resolved for several rounds while
the kind vocabulary it was cited for lives at `:2047` (QA round 5 Q-F6). Its
counts count **distinct `(path, line-range)` pairs**, which is why two people
counting by table row get different totals.

**`read-citations.py`** is the half that catches that class: it prints, for every
citation, the claim beside it and the pinned line itself. It is a reading aid,
not an oracle — a human still has to look at the two columns — but it is what
turned up the `:1611` → `:2047` and `daemon.py:777-813` → `:778-782`
corrections. **Run it whenever citations change**, and read the output.
