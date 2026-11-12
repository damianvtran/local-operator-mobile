#!/usr/bin/env python3
"""M2 fr DELTA audit checks — PR #236, round 2, scope 3af477ee..c4024b49.

Read-only against the manager-owned worktree: every catalogue read goes through
`git show <rev>:<path>`, so the audit is pinned to commits, not to a mutable tree.
Prints a digest; the caller tees it to audit.log.
"""

import hashlib
import json
import subprocess
import sys
import unicodedata

WT = "/Users/damian/local-operator-mobile/.worktrees/i18n-m2-scanner"
OLD = "3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a"
NEW = "c4024b49" + "7a4db3118aae70d8bb132301ea3ab097"
NS = ["computers", "session", "settings"]

GROUPS = {"mobile.computers": 4, "mobile.session": 15, "mobile.settings": 14}


def git_show(rev, path):
    return subprocess.run(
        ["git", "-C", WT, "show", f"{rev}:{path}"],
        capture_output=True, text=True, check=True,
    ).stdout


def load(rev, path):
    return json.loads(git_show(rev, path))


def cat(rev, loc, ns):
    return load(rev, f"src/i18n/catalogues/{loc}/mobile.{ns}.json")


def sidecar(rev, loc, ns):
    return load(rev, f"src/i18n/catalogues/{loc}/mobile.{ns}.context.json")


def pairs_sha(mapping, compact=False):
    sep = (",", ":") if compact else None
    text = json.dumps(mapping, sort_keys=True, ensure_ascii=False, separators=sep)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def blob_sha(rev, path):
    return hashlib.sha256(git_show(rev, path).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- key inventory
final = load(NEW, "i18n/audits/evidence/fr/m2-expression-literals/final.json")
keys33 = sorted(final)
print("== inventory ==")
print(f"final.json keys: {len(keys33)}")
import collections
counts = collections.Counter(".".join(k.split(".")[:2]) for k in keys33)
print("group counts:", dict(counts), "expected:", GROUPS)
assert dict(counts) == GROUPS, "33-key group does not match 4/15/14"

values = {rev: {} for rev in (OLD, NEW)}
for rev in (OLD, NEW):
    for ns in NS:
        d = cat(rev, "fr", ns)
        for k in keys33:
            if k in d:
                values[rev][k] = d[k]
    print(f"{rev[:8]} fr values collected: {len(values[rev])}")
    assert sorted(values[rev]) == keys33, "key set drift"

# bilingual + sidecar snapshots
en = {}
fr_old, fr_new = values[OLD], values[NEW]
for rev in (OLD, NEW):
    for ns in NS:
        d = cat(rev, "en", ns)
        for k in keys33:
            if k in d:
                en.setdefault(rev, {})[k] = d[k]
ctx = {}
for rev in (OLD, NEW):
    acc = {}
    for ns in NS:
        s = sidecar(rev, "en", ns)
        for k in keys33:
            if k in s:
                acc[k] = s[k]
    ctx[rev] = acc
    print(f"{rev[:8]} en values / sidecar notes: {len(en[rev])} / {len(acc)}")

# ------------------------------------------------------------------- 1. delta
print("\n== 1. delta over the 33 fr values (3af477ee -> c4024b49) ==")
changed = [k for k in keys33 if fr_old[k] != fr_new[k]]
print(f"changed: {len(changed)}")
for k in changed:
    print(f"  {k}\n    old={fr_old[k]!r}\n    new={fr_new[k]!r}")
    o, n = fr_old[k], fr_new[k]
    print(f"    case-only (NFD-stripped lower equal): {o.casefold() == n.casefold()},"
          f" same length: {len(o) == len(n)}")
unchanged = [k for k in keys33 if k not in changed]
print(f"unchanged: {len(unchanged)} keys, byte-identical:")
print("  ok" if all(fr_old[k] == fr_new[k] for k in unchanged) else "  MISMATCH")

print("\n== 2. reversion proof ==")
rev_map = dict(fr_new)
for k in changed:
    rev_map[k] = fr_old[k]
print("reverting the changed keys reproduces the 3af477ee target hash:",
      pairs_sha(rev_map) == pairs_sha(fr_old))
print("en source values unchanged over the delta:",
      en[OLD] == en[NEW], pairs_sha(en[OLD]) == pairs_sha(en[NEW]))
side_changed = [k for k in keys33 if ctx[OLD].get(k) != ctx[NEW].get(k)]
print(f"sidecar notes changed: {len(side_changed)} -> {side_changed}")

# ------------------------------------------------------------------- 3. hashes
print("\n== 3. SHA-256 ==")
print(f"target33 fr {NEW[:8]} default separators: {pairs_sha(fr_new)}")
print(f"target33 fr {NEW[:8]} compact           : {pairs_sha(fr_new, compact=True)}")
print(f"target33 fr {OLD[:8]} default separators: {pairs_sha(fr_old)}")
print(f"target33 fr {OLD[:8]} compact           : {pairs_sha(fr_old, compact=True)}")
print(f"source33 en {NEW[:8]} default separators: {pairs_sha(en[NEW])}")
print(f"source33 en {NEW[:8]} compact           : {pairs_sha(en[NEW], compact=True)}")
print(f"source33 en {OLD[:8]} default separators: {pairs_sha(en[OLD])}")
print(f"context33 en {NEW[:8]} (role+note)      : {pairs_sha(ctx[NEW])}")
print(f"context33 en {OLD[:8]} (role+note)      : {pairs_sha(ctx[OLD])}")
for ns in NS:
    for loc in ("fr", "en"):
        p = f"src/i18n/catalogues/{loc}/mobile.{ns}.json"
        print(f"file {loc} {ns:10s} {NEW[:8]}: {blob_sha(NEW, p)}  (delta: {blob_sha(OLD, p) if loc == 'fr' else 'n/a'})")
print(f"bundle final.json {NEW[:8]}: {blob_sha(NEW, 'i18n/audits/evidence/fr/m2-expression-literals/final.json')}")
bundle = load(NEW, "i18n/audits/evidence/fr/m2-expression-literals/final.json")
print("bundle final.json == 3af477ee (pre-delta) 33 values:",
      {k: bundle[k] for k in keys33} == fr_old)
print("bundle final.json == c4024b49 (live) 33 values:",
      {k: bundle[k] for k in keys33} == fr_new, "-> differs on:",
      [k for k in keys33 if bundle[k] != fr_new[k]])

# -------------------------------------------------------------- 4. mechanical
print("\n== 4. mechanical (placeholders, structure, glyphs, encoding) ==")
import re

PH = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)(?:,\s*(?:plural|select))?")


def phs(msg):
    """Placeholder names, including those nested in ICU arms."""
    return sorted(re.findall(r"\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[,}]", msg))


def plural_cats(msg):
    return sorted(set(re.findall(r"(zero|one|two|few|many|other)\s*\{", msg)))


bad = []
for k in keys33:
    a, b = en[NEW][k], fr_new[k]
    if phs(a) != phs(b):
        bad.append((k, "placeholder name/multiplicity", phs(a), phs(b)))
    # a placeholder used in text but missing from the type signature of the other
    if sorted(set(phs(a)) - set(phs(b))) or sorted(set(phs(b)) - set(phs(a))):
        bad.append((k, "placeholder set", phs(a), phs(b)))
    if plural_cats(a) != plural_cats(b):
        bad.append((k, "ICU categories", plural_cats(a), plural_cats(b)))
    for tok in ("`", "·", "↑", "↓", "%", "«", "»"):
        if a.count(tok) != b.count(tok) and tok != "«":
            # arrows/dot/percent/backticks are structural; report drift
            if tok in ("·", "↑", "↓", "`") and a.count(tok) != b.count(tok):
                bad.append((k, f"glyph {tok}", a.count(tok), b.count(tok)))
print("placeholder/ICU/glyph drift:", bad if bad else "none")

problems = []
for k, v in fr_new.items():
    if not v or v != v.strip():
        problems.append((k, "empty or padded"))
    if unicodedata.normalize("NFC", v) != v:
        problems.append((k, "not NFC"))
    if "'" in v:
        problems.append((k, "ASCII apostrophe"))
    if "\u202b" in v or "\u202a" in v or "\u200f" in v:
        problems.append((k, "bidi control char"))
    if v.rstrip().endswith((".", "!", "?")) != en[NEW][k].rstrip().endswith((".", "!", "?")):
        problems.append((k, "terminal stop differs from en"))
print("encoding/padding/bidi problems:", problems if problems else "none")
print("ASCII-only values:", [k for k, v in fr_new.items() if v.isascii()])

# plural question for this group
plural_keys = [k for k in keys33 if "plural" in en[NEW][k]]
print("ICU plural keys in group:", plural_keys or "none -> no CLDR arm question for fr")

# ------------------------------------------------------- 5. note-driven checks
print("\n== 5. sidecar note-driven constraints ==")
for k in keys33:
    note = ctx[NEW][k]["note"].lower()
    v = fr_new[k]
    flags = []
    if "lower-case" in note or "lower case" in note:
        first = v.lstrip("{")[:1]
        letters = [c for c in v if c.isalpha()]
        if letters and letters[0].isupper():
            flags.append("UPPER")
    if "one word" in note:
        words = [w for w in re.split(r"[\s\u202f]+", v) if w and not w.startswith("{")]
        if len(words) > 1:
            flags.append(f"multi-word({len(words)})")
    if flags:
        print(f"  {k}: {v!r} -> {flags}")

# ------------------------------------------------------------ 6. siblings/unit
print("\n== 6. lowercase sibling control (diagnostics.stream_* column, fr) ==")
d = cat(NEW, "fr", "settings")
for k in sorted(d):
    if k.startswith("mobile.settings.diagnostics.stream_"):
        print(f"  {k:50s} {d[k]!r}")
print("status column (different keys, sentence case):")
for k in sorted(d):
    if k.startswith("mobile.settings.status."):
        print(f"  {k:50s} {d[k]!r}")

# ------------------------------------------------------------ 7. negative ctrl
print("\n== 7. negative control (mutation in memory, nothing written) ==")
mut = []
m = dict(fr_new)
m["mobile.computers.added.connected_to"] = "Connecté à {nom}."
mut.append(("placeholder rename", m["mobile.computers.added.connected_to"], phs(m["mobile.computers.added.connected_to"]) != phs(en[NEW]["mobile.computers.added.connected_to"])))
m2 = dict(fr_new)
m2["mobile.session.region.end"] = "fin · défiler"
mut.append(("glyph dropped", m2["mobile.session.region.end"], m2["mobile.session.region.end"].count("↑") != en[NEW]["mobile.session.region.end"].count("↑")))
m3 = dict(fr_new)
m3["mobile.settings.account.route_direct"] = m3["mobile.settings.account.route_direct"] + " "
mut.append(("trailing pad", repr(m3["mobile.settings.account.route_direct"]), m3["mobile.settings.account.route_direct"] != m3["mobile.settings.account.route_direct"].strip()))
m4 = dict(fr_new)
m4["mobile.settings.diagnostics.stream_degraded"] = "Ne répond pas"
mut.append(("case regression (the delta undone)", m4["mobile.settings.diagnostics.stream_degraded"], [c for c in m4["mobile.settings.diagnostics.stream_degraded"] if c.isalpha()][0].isupper()))
m5 = dict(fr_new)
m5["mobile.session.back_to"] = en[NEW]["mobile.session.back_to"]
mut.append(("identical to en", m5["mobile.session.back_to"], m5["mobile.session.back_to"] == en[NEW]["mobile.session.back_to"]))
m6 = dict(fr_new)
m6["mobile.session.tray.context_short"] = "{percent} % du ctx"
mut.append(("wrong percent spacing (U+202F dropped)", repr(m6["mobile.session.tray.context_short"]), "\u202f" not in m6["mobile.session.tray.context_short"]))
for name, val, flagged in mut:
    print(f"  {'FLAGGED  ' if flagged else 'not flagged'} {name}: {val!r}")
print("target hash of a mutated set differs from the real one:",
      pairs_sha(m) != pairs_sha(fr_new))

print("\ndone")
