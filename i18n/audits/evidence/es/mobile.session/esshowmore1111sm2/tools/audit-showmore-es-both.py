#!/usr/bin/env python3
"""Independent mechanical audit — es — of BOTH candidate pairs for
mobile.session.user_message.show_more / show_less.

  A = shipped in integration PR #237 (head 8fdfb2e9), written by the #235 coder:
      "Mostrar más" / "Mostrar menos"
  B = the translator's follow-on candidate (session d5aaf8ba6ba5):
      "Ver más" / "Ver menos"

Same invariant set generate.ts enforces (key parity, non-empty, message parse /
placeholder parity) plus the locale checks it does not do (NFC, bidi, edge
whitespace, final stop, English leftovers, cells, es punctuation). Negative
controls run against BOTH pairs so the proof is not pair-specific.
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

SCR = Path("/Users/damian/.local-operator/sessions/d1d6f85b4577/scratchpad")
EN = SCR / "en-mobile.session@8fdfb2e9.json"
EN_CTX = SCR / "en-mobile.session.context@8fdfb2e9.json"
ES_SHIPPED = SCR / "es@8fdfb2e9-mobile.session.json"
CAND = Path("/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/followon-show-more/es.json")
KEYS = [
    "mobile.session.user_message.show_more",
    "mobile.session.user_message.show_less",
]
BUDGET_CELLS = 14
ENGLISH_STOPWORDS = {"show", "more", "less", "fewer", "expand", "collapse", "read", "view"}
PLACEHOLDER = re.compile(r"\{([^{}]*)\}")


def cells(s: str) -> int:
    n = 0
    for ch in s:
        if unicodedata.combining(ch):
            continue
        n += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return n


def check(cand: dict, en: dict) -> list[str]:
    p: list[str] = []
    if sorted(cand) != sorted(en):
        p.append(f"key parity: {sorted(cand)} != {sorted(en)}")
    for k in KEYS:
        v = cand.get(k)
        if not isinstance(v, str) or not v.strip():
            p.append(f"{k}: empty or non-string {v!r}")
            continue
        if v != unicodedata.normalize("NFC", v):
            p.append(f"{k}: not NFC")
        if v != v.strip():
            p.append(f"{k}: edge whitespace")
        bad = [hex(ord(c)) for c in v if unicodedata.category(c) in ("Cc", "Cf")]
        if bad:
            p.append(f"{k}: control/bidi characters {bad}")
        if v.endswith("."):
            p.append(f"{k}: trailing full stop")
        if v == en.get(k):
            p.append(f"{k}: identical to English (untranslated)")
        if sorted(PLACEHOLDER.findall(en.get(k, ""))) != sorted(PLACEHOLDER.findall(v)):
            p.append(f"{k}: placeholder mismatch")
        if any(t in v for t in ("<", "`")):
            p.append(f"{k}: markup/backtick introduced")
        if cells(v) > BUDGET_CELLS:
            p.append(f"{k}: {cells(v)} cells > {BUDGET_CELLS}")
        leaked = set(re.findall(r"[a-z']+", v.lower())) & ENGLISH_STOPWORDS
        if leaked:
            p.append(f"{k}: English leftover {sorted(leaked)}")
        if re.search(r"\s[:;?!]", v):
            p.append(f"{k}: space before es punctuation")
    return p


def canon(obj: dict) -> tuple[str, str]:
    blob = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return blob.decode(), hashlib.sha256(blob).hexdigest()


def sha(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main() -> int:
    en_full = json.loads(EN.read_text())
    en = {k: en_full[k] for k in KEYS}
    es_full = json.loads(ES_SHIPPED.read_text())
    A = {k: es_full[k] for k in KEYS}
    B = json.loads(CAND.read_text())

    print("=== inputs (file bytes) ===")
    for label, path in (
        ("en catalogue @8fdfb2e9", EN),
        ("en context @8fdfb2e9", EN_CTX),
        ("es catalogue @8fdfb2e9 (pair A, shipped)", ES_SHIPPED),
        ("translator candidate (pair B)", CAND),
    ):
        print(f"  {label}: {path}\n    sha256={sha(path)}")

    print("\n=== values, cells, codepoints ===")
    for name, pair in (("A shipped #237", A), ("B translator", B)):
        print(f"{name}:")
        for k, v in pair.items():
            print(f"  {k} = {v!r}  cells={cells(v)}")
            print("     " + " ".join(f"U+{ord(c):04X}" for c in v))

    results = {}
    print("\n=== mechanical checks ===")
    for name, pair in (("A shipped #237", A), ("B translator", B)):
        probs = check(pair, en)
        results[name] = probs
        print(f"{name}: {'PASS (0 problems)' if not probs else 'FAIL'}")
        for x in probs:
            print("   -", x)

    print("\n=== negative controls on BOTH pairs (each mutation must FAIL) ===")
    allcaught = True
    for name, pair in (("A", A), ("B", B)):
        muts = {
            "empty value": {**pair, KEYS[0]: ""},
            "english leftover": {**pair, KEYS[0]: "Show more"},
            "identical to English": {**en},
            "introduced placeholder": {**pair, KEYS[0]: "Mostrar más {count}"},
            "trailing full stop": {**pair, KEYS[1]: pair[KEYS[1]] + "."},
            "bidi control U+202B": {**pair, KEYS[1]: "‫" + pair[KEYS[1]]},
            "NFD accent": {**pair, KEYS[0]: unicodedata.normalize("NFD", pair[KEYS[0]])},
            "overflow": {**pair, KEYS[1]: pair[KEYS[1]] + " de este mensaje largo"},
            "leading space": {**pair, KEYS[0]: " " + pair[KEYS[0]]},
        }
        for label, m in muts.items():
            got = check(m, en)
            if not got:
                allcaught = False
            print(f"  {name}/{label}: {'caught' if got else '!! NOT CAUGHT !!'} {got[:1]}")

    print("\n=== canonical hashes ===")
    for name, pair in (("A shipped #237", A), ("B translator", B), ("english source", en)):
        blob, h = canon(pair)
        print(f"{name}\n  json={blob}\n  sha256={h}")

    print("\n=== pair comparison ===")
    for k in KEYS:
        print(f"  {k}: A={A[k]!r} B={B[k]!r} same={A[k] == B[k]}")
    return 0 if all(not v for v in results.values()) and allcaught else 1


if __name__ == "__main__":
    sys.exit(main())
