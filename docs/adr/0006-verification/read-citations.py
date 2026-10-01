"""Print, for every code citation in the ADR, the claim beside it and the pinned line itself.

Resolution is not support (QA round 5 Q-F6): this is the read-the-line half of the check.
Usage: factcheck.py <adr> <pin> [filter-regex]
"""
import re, subprocess, sys, pathlib
adr = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("docs/adr/0006-push-and-ack-sync.md")
pin = sys.argv[2] if len(sys.argv) > 2 else "40ca7910e49a"
filt = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
text = adr.read_text()
row = next(l for l in text.splitlines() if l.startswith("| **local-operator**"))
maps = dict(re.findall(r"`(local_operator/[^`]+\.py)` → `([^`]+\.py)`", row))
rev = {sh: full for full, sh in maps.items()}
flat = " ".join(text.split())
seen = set()
bodies: dict[str, list[str]] = {}
for m in re.finditer(r"([A-Za-z_][\w/]*\.py)`?:(\d+)(?:-(\d+))?", flat):
    path, ln, ln2 = m.group(1), m.group(2), m.group(3)
    full = rev.get(path) or (path if path.startswith("local_operator/") else None)
    if not full or full.startswith("local_operator/mobile/web/") or (full, ln) in seen:
        continue
    seen.add((full, ln))
    if filt and not filt.search(full):
        continue
    if full not in bodies:
        out = subprocess.run(["git", "-C", str(pathlib.Path("~/local-operator").expanduser()),
                              "show", f"{pin}:{full}"], capture_output=True, text=True)
        if out.returncode:
            print(f"!! {path}:{ln}  PATH MISSING"); continue
        bodies[full] = out.stdout.splitlines()
    body = bodies[full]
    i = int(ln) - 1
    line = body[i].strip()[:88] if i < len(body) else "<beyond EOF>"
    claim = flat[max(0, m.start()-72):m.start()].replace("*", "").strip()
    print(f"{path}:{ln}\n    claim: …{claim}\n    line : {line}")
