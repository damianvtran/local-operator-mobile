"""Resolve every code citation in the ADR (and the plan) at the ref each one names: PATH first.

    LOCAL_OPERATOR_REPO=~/local-operator python3 docs/adr/0006-verification/resolve-citations.py \
        [<doc-path> ...]

Defaults to `docs/adr/0006-push-and-ack-sync.md` and `docs/push-plan.md`. The pinned checkout comes
from `$LOCAL_OPERATOR_REPO` (default `~/local-operator`) and must be a git repository holding the
refs below; the script says so and exits 2 rather than reporting a resolution failure when it is not.

WHAT IS CHECKED — exactly, because the claim must not be wider than the run:

* Every citation of the form `<file>.py:<line>`, `<file>.py:<line>-<line>`, and a BARE continuation
  `:<line>` / `:<line>-<line>` that follows a named citation in the same flow (the document's own
  style, e.g. `` `daemon.py`:3377-3380, `:3382-3388` ``). A bare one inherits the last named FILE and
  that file's REF, which is how the prose reads.
* Ref attribution: a citation into a file that exists at both refs must say which — the marker
  `(#1864)` after the range means PR #1864's head; `(pin)` means the pin. **A citation into a
  dual-ref file with NO marker is an ERROR**, because the two trees have different line numbers for
  the same path and an unmarked one could silently resolve against the wrong tree. `push_devices.py`
  needs no marker: the file exists only in #1864.
* Path first, then the line (`git cat-file -e <ref>:<path>`, then the line against the file's length).

WHAT IS NOT CHECKED, so the denominator is never implied to be larger:

* Non-Python citations (`.md`, `.ts`, `.tsx`) — a different pin; counted and printed.
* A backticked file name with no line number (prose, not a citation) — counted and printed.
* Whether a cited line SUPPORTS its claim — that is `read-citations.py`'s job, and a human's.
* Anything the mapping table neither maps nor spells out as a full path: an unmapped *Python*
  citation is a FAILURE, never a silent skip.

Self-test: the parser asserts its own patterns match the forms above before doing anything, and exits
3 if they do not — a checker whose regex silently stops matching reports "all clear" for a document
nothing was extracted from, which is the failure this file exists to prevent.
"""
import collections
import os
import pathlib
import re
import subprocess
import sys

TICK = chr(96)
DOCS = sys.argv[1:] or ["docs/adr/0006-push-and-ack-sync.md", "docs/push-plan.md"]
PIN = "40ca7910e49a"
PR_REF = "d089f7e0fc0a324c38d6499290c27b2569714549"   # PR #1864's head, cited as (#1864)
#: Files that exist at BOTH refs: a citation into one of these must carry a marker.
DUAL_REF_FILES = {"daemon.py", "cli.py"}
PR_ONLY_FILES = {"push_devices.py"}

NAMED = re.compile(
    "[`]?([A-Za-z_][A-Za-z0-9_/]*(?:/[A-Za-z0-9_/]+)*[.](?:py|ts|tsx|md))[`]?:([0-9]+)(?:-([0-9]+))?"
)
BARE = re.compile("[`]?:([0-9]+)(?:-([0-9]+))?[`]?")
#: A mention of a file with NO line number. The lookahead must be able to FAIL — with an optional
#: subpattern inside it (`(?![`:]?)`) it never can, every citation counts as a mention too, and the
#: counter reports zero forever while the README promises it prints (round 9, R9-M1). Asserted by the
#: self-test below on both sides: a bare mention matches, a citation does not.
MENTION = re.compile("[" + TICK + "]([A-Za-z_][A-Za-z0-9_/]*[.]py)[" + TICK + "](?![`:])")

# --- the parser self-test (exit 3 rather than a false all-clear) -------------------------------
for pattern, sample, want in (
    (NAMED, "`daemon.py`:3377-3380", ("daemon.py", "3377", "3380")),
    (NAMED, "`push_devices.py`:519", ("push_devices.py", "519", None)),
    (BARE, "`:3382-3388`", ("3382", "3388")),
    (BARE, "`:9`", ("9", None)),
    (BARE, ":99999", ("99999", None)),
    (MENTION, "`daemon.py` on its own", ("daemon.py",)),
    (MENTION, "`daemon.py`:3377-3380", None),
    (MENTION, "`daemon.py:3377`", None),
):
    m = pattern.search(sample)
    got = tuple(m.groups()) if m else None
    # `want is None` means "this must NOT match" — a pattern whose lookahead cannot fail, or whose
    # required group went optional, is caught here rather than reporting an empty counter forever.
    if got != want:
        print(f"PARSER SELF-TEST FAILED: {pattern.pattern!r} on {sample!r} gave {got}, wanted {want}",
              file=sys.stderr)
        raise SystemExit(3)

repo = pathlib.Path(os.environ.get("LOCAL_OPERATOR_REPO", "~/local-operator")).expanduser()


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


if git("rev-parse", "--git-dir").returncode != 0:
    print(f"UNUSABLE CHECKOUT: {repo} is not a git repository — set LOCAL_OPERATOR_REPO to a clone "
          f"that contains {PIN} and {PR_REF}", file=sys.stderr)
    raise SystemExit(2)
for ref in (PIN, PR_REF):
    if git("cat-file", "-e", f"{ref}^{{commit}}").returncode != 0:
        print(f"UNUSABLE CHECKOUT: {repo} has no commit {ref} — fetch it, or point "
              f"LOCAL_OPERATOR_REPO at a clone that does", file=sys.stderr)
        raise SystemExit(2)

bad: list[tuple[str, str, str]] = []
unresolved: set[str] = set()
unmarked: set[str] = set()
not_checked: collections.Counter[str] = collections.Counter()
line_less: list[str] = []
prose_lines: list[str] = []
counts: collections.Counter[str] = collections.Counter()
checked: set[tuple[str, str, str]] = set()
bodies: dict[tuple[str, str], list[str] | None] = {}

line_less: list[str] = []
prose_lines: list[str] = []
for doc in DOCS:
    text = pathlib.Path(doc).read_text()
    flat = " ".join(text.split())
    # --- the mapping table is the ADR's; the plan cites by the same shorthands
    try:
        row = next(l for l in text.splitlines() if l.startswith("| **local-operator**"))
        maps = dict(re.findall("[" + TICK + "](local_operator/[^" + TICK + "]+[.]py)[" + TICK + "]"
                               " → [" + TICK + "]([^" + TICK + "]+[.]py)[" + TICK + "]", row))
    except StopIteration:
        maps = {}
    if not maps:
        adr = pathlib.Path("docs/adr/0006-push-and-ack-sync.md")
        row = next(l for l in adr.read_text().splitlines() if l.startswith("| **local-operator**"))
        maps = dict(re.findall("[" + TICK + "](local_operator/[^" + TICK + "]+[.]py)[" + TICK + "]"
                               " → [" + TICK + "]([^" + TICK + "]+[.]py)[" + TICK + "]", row))
    rev = {shorthand: full for full, shorthand in maps.items()}

    # --- one ordered pass over both forms, so a bare range inherits the file it follows
    marks: list[tuple[int, str, str, str, str]] = []
    for m in NAMED.finditer(flat):
        marks.append((m.start(), "named", m.group(1), m.group(2), (m.group(3) or "")))
    for m in BARE.finditer(flat):
        # a bare match inside a named one is noise: keep only those not overlapping a named span
        marks.append((m.start(), "bare", "", m.group(1), (m.group(2) or "")))
    named_spans = [(m.start(), m.end()) for m in NAMED.finditer(flat)] + [(None, None)]  # kept simple
    named_spans = named_spans[:-1]
    marks = [m for m in marks if m[1] == "named"
             or not any(a is not None and m[0] >= a and m[0] < b for a, b in named_spans)]
    marks.sort(key=lambda t: (t[0], 0 if t[1] == "named" else 1))

    last_full: str | None = None
    last_marked = False
    for pos, kind, name, line, line2 in marks:
        if kind == "named" and name and not name.endswith((".md", ".ts", ".tsx")):
            after = flat[pos: pos + 40]        # the marker must follow the citation, not float near it
            marked = "#1864" in after
            pinned = "(pin)" in after
            last_full, last_marked = name, marked
            if name in DUAL_REF_FILES and not (marked or pinned):
                unmarked.add(f"{doc}:{name}:{line}")
                continue
            if name.endswith(".py"):
                ref = PR_REF if (marked or name in PR_ONLY_FILES) else PIN
                cites = [(name, line, line2, ref)]
            else:
                cites = []
        elif kind == "named":
            not_checked[name.rsplit(".", 1)[-1]] += 1
            continue
        else:                       # bare continuation
            if not last_full:
                continue
            ref = PR_REF if (last_marked or last_full in PR_ONLY_FILES) else PIN
            cites = [(last_full, line, line2, ref)]

        for path, ln, ln2, ref in cites:
            full = rev.get(path) or (f"local_operator/mobile/{path}" if path in PR_ONLY_FILES
                                     else (path if path.startswith("local_operator/") else None))
            if full is None:
                unresolved.add(path)
                continue
            key = (ref, full, ln)
            if key in checked:
                continue
            checked.add(key)
            counts[full] += 1
            if (ref, full) not in bodies:
                probe = git("cat-file", "-e", f"{ref}:{full}")
                bodies[(ref, full)] = (git("show", f"{ref}:{full}").stdout.splitlines()
                                       if probe.returncode == 0 else None)
            body = bodies[(ref, full)]
            if body is None:
                bad.append((full, ln, f"PATH DOES NOT EXIST at {ref[:7]}"))
                continue
            if int(ln) > len(body) or (ln2 and int(ln2) > len(body)):
                bad.append((full, ln, f"line {ln} beyond EOF ({len(body)} lines) at {ref[:7]}"))

    line_less += [m.group(1) for m in MENTION.finditer(flat)]
    # a line number written as PROSE ("`gateway.py` line 5") is not a citation form we parse; it is
    # reported so nothing is silently outside the denominator (QA round 8, Q-F26's probe).
    prose_lines += [m.group(0)[:60] for m in re.finditer(
        "[`]?[A-Za-z_][A-Za-z0-9_/]*[.]py[" + TICK + "]?[^.\n]{0,24}?line[ ]+[0-9]+", flat)]

print(f"checkout={repo}  pin={PIN}  pr_ref={PR_REF[:7]}  mappings={len(rev)}  "
      f"distinct (ref,path,line) citations CHECKED={len(checked)}  dual-ref pairs checked="
      f"{sum(1 for (r, f, _) in checked if f.rsplit('/', 1)[-1] in DUAL_REF_FILES)}")
if counts:
    print("files touched:", " ".join(f"{k}({v})" for k, v in sorted(counts.items())))
if line_less:
    #: Accumulated across EVERY document (round 9: a per-document reset made the report describe only
    #: the last file read, so the ADR's own mentions vanished whenever the plan was scanned too).
    distinct = sorted(set(line_less))
    print(f"MENTIONS WITHOUT A LINE NUMBER (not checked, {len(line_less)} in {len(distinct)} names): "
          + ", ".join(distinct[:6]) + (" …" if len(distinct) > 6 else ""))
if prose_lines:
    print(f"CITATIONS WRITTEN AS PROSE (not checked, {len(prose_lines)}) — write `file.py`:N instead:")
    for pl in sorted(set(prose_lines))[:5]:
        print(f"  {pl}")
if not_checked:
    print("NOT CHECKED (different pin):", ", ".join(f"{k} x{v}" for k, v in sorted(not_checked.items())))
if unmarked:
    print(f"CITATIONS INTO DUAL-REF FILES WITH NO MARKER ({len(unmarked)}) — each needs `(#1864)` or "
          f"`(pin)`, because the two trees put different code on the same line:")
    for u in sorted(unmarked):
        print(f"  {u}")
    bad.append(("(unmarked)", "0", "no ref marker for: " + ", ".join(sorted(unmarked))))
if unresolved:
    print(f"UNRESOLVED CITATIONS ({len(unresolved)}) — each needs a mapping or a rewrite:")
    for u in sorted(unresolved):
        print(f"  {u}")
    bad.append(("(unresolved)", "0", "no mapping for: " + ", ".join(sorted(unresolved))))

if bad:
    print(f"FAILURES ({len(bad)}):")
    for path, ln, why in bad:
        print(f"  {path}:{ln}  {why}")
    raise SystemExit(1)
print("OK: every cited path exists at its ref and every cited line resolves")
