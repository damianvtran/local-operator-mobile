"""Print, for every code citation in the ADR, the claim beside it and the pinned line itself.

    LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/read-citations.py [filter-regex]

Optional positional arguments: ``<adr-path>``, ``<pin>``, ``[filter-regex]`` (defaults: the ADR, the
pin the document names, no filter). The checkout comes from ``$LOCAL_OPERATOR_REPO`` and defaults to
``~/local-operator``.

Resolution is not support (QA round 5 Q-F6): ``resolve-citations.py`` proves a cited line *exists*,
and this script is the read-the-line half — it prints the two columns a human has to compare. It is
a reading aid, not an oracle.
"""
import os
import pathlib
import re
import subprocess
import sys

adr = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("docs/adr/0006-push-and-ack-sync.md")
pin = sys.argv[2] if len(sys.argv) > 2 else "40ca7910e49a"
filt = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
repo = pathlib.Path(os.environ.get("LOCAL_OPERATOR_REPO", "~/local-operator")).expanduser()
text = adr.read_text()
row = next(l for l in text.splitlines() if l.startswith("| **local-operator**"))
maps = dict(re.findall(r"`(local_operator/[^`]+\.py)` → `([^`]+\.py)`", row))
rev = {shorthand: full for full, shorthand in maps.items()}
flat = " ".join(text.split())
seen: set[tuple[str, str]] = set()
bodies: dict[str, list[str]] = {}


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


if git("rev-parse", "--git-dir").returncode != 0:
    print(f"UNUSABLE CHECKOUT: {repo} is not a git repository — set LOCAL_OPERATOR_REPO", file=sys.stderr)
    raise SystemExit(2)

for match in re.finditer(r"([A-Za-z_][\w/]*\.py)`?:(\d+)(?:-(\d+))?", flat):
    path, line, line2 = match.group(1), match.group(2), match.group(3)
    full = rev.get(path) or (path if path.startswith("local_operator/") else None)
    if not full or (full, line) in seen:
        continue
    seen.add((full, line))
    if filt and not filt.search(full):
        continue
    if full not in bodies:
        out = git("show", f"{pin}:{full}")
        if out.returncode:
            print(f"!! {path}:{line}  PATH MISSING at {pin}")
            continue
        bodies[full] = out.stdout.splitlines()
    body = bodies[full]
    start = int(line)
    end = int(line2) if line2 else start
    if start > len(body):
        print(f"!! {path}:{line}  BEYOND EOF ({len(body)} lines)")
        continue
    context = " ".join(x.strip() for x in body[max(0, start - 4) : start - 1])
    print(f"\n{path}:{line}")
    print(f"    claim: …{context[-150:]}")
    for number in range(start, min(end, len(body)) + 1):
        print(f"    line {number}: {body[number - 1].strip()[:150]}")
