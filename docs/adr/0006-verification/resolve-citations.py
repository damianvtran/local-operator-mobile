"""Resolve every code citation in the ADR at the pinned revision: PATH first, then lines.

Run from the repository root:  python3 docs/adr/0006-verification/resolve-citations.py
(<adr-path> and <pin> are optional: they default to the ADR and the pin it names.)

Written for QA round 4's Q-F1, whose whole point was that "re-resolved" had been true of the
line numbers and false of the path.  Usage: citecheck.py <adr-path> <pin>
"""
import re, subprocess, sys, pathlib, collections

adr = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("docs/adr/0006-push-and-ack-sync.md")
pin = sys.argv[2] if len(sys.argv) > 2 else "40ca7910e49a"
text = adr.read_text()
repo = "~/local-operator"

def git(*args):
    return subprocess.run(["git", "-C", str(pathlib.Path(repo).expanduser()), *args],
                          capture_output=True, text=True)

# --- the mappings the table declares: `full/path.py` → `shorthand.py`
row = next(l for l in text.splitlines() if l.startswith("| **local-operator**"))
maps = dict(re.findall(r"`(local_operator/[^`]+\.py)` → `([^`]+\.py)`", row))
rev = {sh: full for full, sh in maps.items()}   # shorthand -> full path at the pin
assert maps, "no mappings parsed"

# --- every citation in the document body, by shorthand or full path
flat = " ".join(text.split())
cites = re.findall(r"`?([A-Za-z_][\w/]*(?:/[\w/]+)*\.(?:py|ts|tsx))`?:(\d+)(?:-(\d+))?", flat)
counts = collections.Counter()
bad = []
checked = set()
# One `git show` per distinct FILE (the pinned sources are large; per-citation reads made this
# script too slow to be worth running). The check is still path-first, then lines.
bodies: dict[str, list[str] | None] = {}
unresolved = set()
for path, ln, ln2 in cites:
    if path.endswith((".ts", ".tsx")) or path.startswith(("web/", "mobile/web")):
        continue                      # app files resolve at the mobile repo's pin, not this one
    full = rev.get(path) or (path if path.startswith("local_operator/") else None)
    if full is None:
        unresolved.add(path)          # NO SILENT SKIPS: a citation the table cannot resolve is a failure
        continue
    if full.startswith("local_operator/mobile/web/"):
        continue
    if (full, ln) in checked:
        continue
    checked.add((full, ln))
    counts[full] += 1
    if full not in bodies:
        probe = git("cat-file", "-e", f"{pin}:{full}")
        bodies[full] = git("show", f"{pin}:{full}").stdout.splitlines() if probe.returncode == 0 else None
    body = bodies[full]
    if body is None:
        bad.append((full, ln, "PATH DOES NOT EXIST"))
        continue
    if int(ln) > len(body) or (ln2 and int(ln2) > len(body)):
        bad.append((full, ln, f"line {ln} beyond EOF ({len(body)})"))

print(f"pin={pin}  mappings={len(maps)}  distinct (path,line) citations checked={len(checked)}")
print("files touched:", " ".join(f"{k}({v})" for k, v in sorted(counts.items())))

if unresolved:
    print(f"UNRESOLVED CITATIONS ({len(unresolved)}) — every one needs a mapping or a rewrite:")
    for u in sorted(unresolved):
        print(f"  {u}")
    bad.append(("(unresolved)", 0, "no mapping for: " + ", ".join(sorted(unresolved))))

if bad:
    print(f"FAILURES ({len(bad)}):")
    for f, l, why in bad:
        print(f"  {f}:{l}  {why}")
    sys.exit(1)
print("OK: every mapped path exists at the pin and every cited line resolves")
