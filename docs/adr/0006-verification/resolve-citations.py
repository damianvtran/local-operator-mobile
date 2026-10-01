"""Resolve every code citation in the ADR at the pinned revision: PATH first, then lines.

    LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/resolve-citations.py

Optional positional arguments: ``<adr-path>`` and ``<pin>`` (defaults: the ADR, and the pin the
document names). The pinned source checkout comes from ``$LOCAL_OPERATOR_REPO`` and defaults to
``~/local-operator``; it must be a git repository containing the pin, and the script says so and
exits 2 rather than reporting a resolution failure when it is not.

WHAT THIS CHECKS, EXACTLY — and what it does not:

* checked: every ``<file>.py:<line>`` / ``<file>.py:<line>-<line>`` citation in the ADR whose file
  the provenance table maps (shorthand) or which is written as a full ``local_operator/...`` path.
  For each, the **path is resolved first** (``git cat-file -e <pin>:<path>``) and only then the line
  (or range) is checked against the file's length. Path-first is the whole point (QA round 4 Q-F1:
  "re-resolved" was true of the line numbers and false of the path).
* not checked: citations in ``.md``/``.ts``/``.tsx`` files (they resolve at a different pin — the
  mobile repository's), and any citation the table neither maps nor spells out. An unmapped
  *Python* citation is a **failure**, not a skip; the others are counted and listed as not-checked
  so no reader has to guess the denominator.
* not checked either: whether the cited line **supports** the claim beside it. That is
  ``read-citations.py``'s job and, ultimately, a human's — ``attention.py:1611`` resolved for
  several rounds while the fact it was cited for lives at ``:2047`` (QA round 5 Q-F6).
"""
import collections
import os
import pathlib
import re
import subprocess
import sys

adr = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("docs/adr/0006-push-and-ack-sync.md")
pin = sys.argv[2] if len(sys.argv) > 2 else "40ca7910e49a"
#: PR #1864's head, cited with an explicit `(#1864)` marker after the range (and `push_devices.py`
#: always, since that file exists only there). Two refs, one document, no ambiguity: a `daemon.py`
#: or `cli.py` citation without the marker is checked against the PIN, and fails loudly if its line
#: does not exist there — which is the signal that it needed the marker.
pr_ref = "d089f7e0fc0a324c38d6499290c27b2569714549"
pr_only_files = {"push_devices.py"}
repo = pathlib.Path(os.environ.get("LOCAL_OPERATOR_REPO", "~/local-operator")).expanduser()
text = adr.read_text()


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


if git("rev-parse", "--git-dir").returncode != 0:
    print(f"UNUSABLE CHECKOUT: {repo} is not a git repository — set LOCAL_OPERATOR_REPO to a clone "
          f"that contains {pin}", file=sys.stderr)
    raise SystemExit(2)
if git("cat-file", "-e", f"{pin}^{{commit}}").returncode != 0:
    print(f"UNUSABLE CHECKOUT: {repo} has no commit {pin} — fetch it, or point "
          f"LOCAL_OPERATOR_REPO at a clone that does", file=sys.stderr)
    raise SystemExit(2)

# --- the mappings the table declares: `full/path.py` -> `shorthand.py`
row = next(l for l in text.splitlines() if l.startswith("| **local-operator**"))
maps = dict(re.findall(r"`(local_operator/[^`]+\.py)` → `([^`]+\.py)`", row))
rev = {shorthand: full for full, shorthand in maps.items()}
assert maps, "no mappings parsed"

# --- every citation in the document body, by shorthand or full path
flat = " ".join(text.split())
# Two forms, and both are checked: a NAMED citation (`daemon.py`:3380 or `daemon.py`:3377-3380) and
# a BARE continuation (`:3382-3388`), which the document uses inside a paragraph to keep pointing at
# the file it just named. A bare range inherits the last named file AND that file's ref, which is how
# the prose reads — so a paragraph that names `cli.py` (#1864) and then three bare ranges gets all
# four checked against PR #1864's tree.
cites: list[tuple[str, str, str, bool]] = []
last_full: str | None = None
last_marked = False
for m in re.finditer(
    r"`?(?P<name>[A-Za-z_][\w/]*(?:/[\w/]+)*\.(?:py|ts|tsx|md))`?:(?P<line>\d+)(?:-(?P<line2>\d+))?"
    r"|`?:(?P<bare>\d+)(?:-(?P<bare2>\d+))`?",
    flat,
):
    marked = "#1864" in flat[m.end() : m.end() + 24]
    if m.group("name"):
        last_full, last_marked = m.group("name"), marked
        cites.append((m.group("name"), m.group("line"), m.group("line2"), marked))
    elif last_full:
        cites.append((last_full, m.group("bare"), m.group("bare2"), last_marked))

counts: collections.Counter[str] = collections.Counter()
bad: list[tuple[str, str, str]] = []
unresolved: set[str] = set()
not_checked: collections.Counter[str] = collections.Counter()
checked: set[tuple[str, str, str]] = set()
# One `git show` per distinct FILE (pinned sources are large; a read per citation made this script
# too slow to run, which is its own kind of failure). The check is still path-first, then lines.
bodies: dict[tuple[str, str], list[str] | None] = {}

for path, line, line2, marked in cites:
    if path.endswith((".ts", ".tsx", ".md")):
        not_checked[path.rsplit(".", 1)[-1]] += 1
        continue
    ref = pr_ref if (marked or path in pr_only_files) else pin
    full = rev.get(path) or (path if path.startswith("local_operator/") else None)
    if full is None and path in pr_only_files:
        full = f"local_operator/mobile/{path}"   # PR-only file: only the ref differs
    if full is None:
        unresolved.add(path)            # NO SILENT SKIPS: unresolvable is a failure
        continue
    key = (ref, full, line)
    if key in checked:
        continue
    checked.add(key)
    counts[full] += 1
    if (ref, full) not in bodies:
        probe = git("cat-file", "-e", f"{ref}:{full}")
        bodies[(ref, full)] = git("show", f"{ref}:{full}").stdout.splitlines() if probe.returncode == 0 else None
    body = bodies[(ref, full)]
    if body is None:
        bad.append((full, line, "PATH DOES NOT EXIST"))
        continue
    if int(line) > len(body) or (line2 and int(line2) > len(body)):
        bad.append((full, line, f"line {line} beyond EOF ({len(body)} lines)"))

print(f"checkout={repo}  pin={pin}  mappings={len(maps)}  "
      f"distinct (path,line) citations CHECKED={len(checked)}")
print("files touched:", " ".join(f"{k}({v})" for k, v in sorted(counts.items())))
# A backticked file with no `:line` is prose, not a citation — but it is counted and named here so
# "everything the document cites was checked" is never implied when it was not (QA round 7, row 3:
# a citation-shaped token the regex does not match used to be skipped in silence).
mention_spans = list(re.finditer(r"`([A-Za-z_][\w/]*\.py)`(?![`:])", flat))
line_less = [m.group(1) for m in mention_spans if not re.match(r"`?:\d", flat[m.end() : m.end() + 2])]
if line_less:
    sample = ", ".join(sorted(set(line_less))[:6])
    print(f"MENTIONS WITHOUT A LINE NUMBER (not checked, {len(line_less)}): {sample}"
          + (" …" if len(set(line_less)) > 6 else ""))

if not_checked:
    print("NOT CHECKED (different pin or non-Python):",
          ", ".join(f"{k} x{v}" for k, v in sorted(not_checked.items())))
if unresolved:
    print(f"UNRESOLVED CITATIONS ({len(unresolved)}) — each needs a mapping or a rewrite:")
    for u in sorted(unresolved):
        print(f"  {u}")
    bad.append(("(unresolved)", "0", "no mapping for: " + ", ".join(sorted(unresolved))))

if bad:
    print(f"FAILURES ({len(bad)}):")
    for path, line, why in bad:
        print(f"  {path}:{line}  {why}")
    raise SystemExit(1)
print("OK: every mapped path exists at the pin and every cited line resolves")
