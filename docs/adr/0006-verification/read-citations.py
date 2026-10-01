"""Print, for every code citation in the ADR (and the plan), the claim beside it and the pinned line.

    LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/read-citations.py [filter]

Optional positional arguments: `[<doc-path> ...]`, `[<pin>]`, `[filter-regex]`. Defaults: the ADR and
the plan, the pin the document names, no filter. The checkout comes from `$LOCAL_OPERATOR_REPO`
(default `~/local-operator`).

Ref attribution is the resolver's (`(#1864)` after a citation means PR #1864's head; files that exist
at both refs must carry a marker), so this script prints the line from the tree the citation actually
names — which is what makes it useful for the `push_devices.py` / `(#1864)` citations too.

Resolution is not support (QA round 5 Q-F6): `resolve-citations.py` proves a cited line *exists*; this
script prints the two columns a human must compare. It is a reading aid, not an oracle.
"""
import os
import pathlib
import re
import subprocess
import sys

TICK = chr(96)
DOCS = [a for a in sys.argv[1:] if a.endswith((".md",))]
DOCS = DOCS or ["docs/adr/0006-push-and-ack-sync.md", "docs/push-plan.md"]
filt = re.compile(sys.argv[-1]) if sys.argv[1:] and not sys.argv[-1].endswith(".md") else None
PIN = "40ca7910e49a"
PR_REF = "d089f7e0fc0a324c38d6499290c27b2569714549"
DUAL_REF_FILES = {"daemon.py", "cli.py"}
PR_ONLY_FILES = {"push_devices.py"}

NAMED = re.compile(
    "[`]?([A-Za-z_][A-Za-z0-9_/]*(?:/[A-Za-z0-9_/]+)*[.](?:py|ts|tsx|md))[`]?:([0-9]+)(?:-([0-9]+))?"
)
BARE = re.compile("[`]?:([0-9]+)(?:-([0-9]+))?[`]?")

repo = pathlib.Path(os.environ.get("LOCAL_OPERATOR_REPO", "~/local-operator")).expanduser()
problems = 0  #: a printed `!!` is a failure, not decoration (round 9)
bodies: dict[tuple[str, str], list[str]] = {}
seen: set[tuple[str, str, str]] = set()


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


if git("rev-parse", "--git-dir").returncode != 0:
    print(f"UNUSABLE CHECKOUT: {repo} is not a git repository — set LOCAL_OPERATOR_REPO", file=sys.stderr)
    raise SystemExit(2)

for doc in DOCS:
    flat = " ".join(pathlib.Path(doc).read_text().split())
    row = next((l for l in pathlib.Path(doc).read_text().splitlines()
                if l.startswith("| **local-operator**")), "")
    rev = {sh: full for full, sh in re.findall(
        "[" + TICK + "](local_operator/[^" + TICK + "]+[.]py)[" + TICK + "] → [" + TICK + "]([^" +
        TICK + "]+[.]py)[" + TICK + "]", row)}
    if not rev:                      # the plan has no table of its own: borrow the ADR's
        adr = pathlib.Path("docs/adr/0006-push-and-ack-sync.md").read_text()
        row = next(l for l in adr.splitlines() if l.startswith("| **local-operator**"))
        rev = {sh: full for full, sh in re.findall(
            "[" + TICK + "](local_operator/[^" + TICK + "]+[.]py)[" + TICK + "] → [" + TICK + "]([^" +
            TICK + "]+[.]py)[" + TICK + "]", row)}

    marks: list[tuple[int, str, str, str, str]] = []
    for m in NAMED.finditer(flat):
        marks.append((m.start(), "named", m.group(1), m.group(2), m.group(3) or ""))
    named_spans = [(m.start(), m.end()) for m in NAMED.finditer(flat)]
    for m in BARE.finditer(flat):
        if not any(a <= m.start() < b for a, b in named_spans):
            marks.append((m.start(), "bare", "", m.group(1), m.group(2) or ""))
    marks.sort(key=lambda t: (t[0], 0 if t[1] == "named" else 1))

    last_full, last_marked = None, False
    for pos, kind, name, line, line2 in marks:
        if kind == "named":
            if name.endswith((".md", ".ts", ".tsx")):
                continue
            after = flat[pos: pos + 40]
            marked = "#1864" in after
            last_full, last_marked = name, marked
            path = name
        else:
            if not last_full:
                continue
            path, marked = last_full, last_marked
        ref = PR_REF if (marked or path in PR_ONLY_FILES) else PIN
        full = rev.get(path) or (f"local_operator/mobile/{path}" if path in PR_ONLY_FILES
                                 else (path if path.startswith("local_operator/") else None))
        if full is None:
            continue
        if filt and not filt.search(full):
            continue
        key = (ref, full, line)
        if key in seen:
            continue
        seen.add(key)
        if (ref, full) not in bodies:
            out = git("show", f"{ref}:{full}")
            if out.returncode:
                print(f"!! {path}:{line}  PATH MISSING at {ref[:7]}")
                continue
            bodies[(ref, full)] = out.stdout.splitlines()
        body = bodies[(ref, full)]
        start = int(line)
        end = int(line2) if line2 else start
        if start > len(body):
            print(f"!! {path}:{line}  BEYOND EOF ({len(body)} lines) at {ref[:7]}")
            problems += 1
            continue
        context = " ".join(x.strip() for x in body[max(0, start - 4): start - 1])
        print(f"\n{path}:{line}   [{ref[:7]}]")
        print(f"    claim: …{context[-150:]}")
        for number in range(start, min(end, len(body)) + 1):
            print(f"    line {number}: {body[number - 1].strip()[:150]}")

sys.exit(1 if problems else 0)
