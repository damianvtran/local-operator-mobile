#!/usr/bin/env python3
"""Independent mechanical audit for the es candidate pair of
mobile.session.user_message.show_more / show_less.

Read-only wrt the repo: the candidate values live in the translator's scratch
JSON (not applied to any catalogue). Implements the invariants generate.ts
enforces (key parity, non-empty, message parses / placeholder parity), plus the
locale checks generate.ts does NOT do (placeholder names, NFC, bidi controls,
edge whitespace, final stop, English leftovers, cell width).

Includes negative controls: in-memory mutations that the checker must reject.
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

CAND = Path("/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/followon-show-more/es.json")
EN_SNAPSHOT = Path("/Users/damian/.local-operator/sessions/d1d6f85b4577/scratchpad/en-mobile.session@8fdfb2e9.json")
CONTEXT_SNAPSHOT = Path(
    "/Users/damian/.local-operator/sessions/d1d6f85b4577/scratchpad/en-mobile.session.context@8fdfb2e9.json"
)
BUDGET_CELLS = 14  # pill budget stated in the brief; the real control is full-width in the bubble

KEYS = [
    "mobile.session.user_message.show_more",
    "mobile.session.user_message.show_less",
]

ENGLISH_STOPWORDS = {"show", "more", "less", "fewer", "expand", "collapse", "read", "view"}


def cells(s: str) -> int:
    """Terminal/text cells: East Asian Wide/Fullwidth = 2, combining marks = 0."""
    n = 0
    for ch in s:
        if unicodedata.combining(ch):
            continue
        n += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return n


PLACEHOLDER = re.compile(r"\{([^{}]*)\}")


def placeholders(s: str) -> list[str]:
    # good enough for these two keys: none in en, so any {..} in target is suspect
    return sorted(PLACEHOLDER.findall(s))


def check(cand: dict, en: dict) -> list[str]:
    problems: list[str] = []
    if sorted(cand) != sorted(en):
        problems.append(f"key parity: candidate {sorted(cand)} != en {sorted(en)}")
    for k in KEYS:
        if k not in cand:
            problems.append(f"{k}: missing")
            continue
        v = cand[k]
        if not isinstance(v, str) or not v.strip():
            problems.append(f"{k}: empty or non-string value {v!r}")
            continue
        if v != unicodedata.normalize("NFC", v):
            problems.append(f"{k}: not NFC (has combining sequence)")
        if v != v.strip():
            problems.append(f"{k}: leading/trailing whitespace")
        if any(unicodedata.category(ch) in ("Cc", "Cf") for ch in v):
            problems.append(f"{k}: control/bidi character present "
                            f"{[hex(ord(c)) for c in v if unicodedata.category(c) in ('Cc','Cf')]}")
        if v.endswith("."):
            problems.append(f"{k}: trailing full stop")
        if v == en.get(k):
            problems.append(f"{k}: identical to English source (untranslated)")
        p_en, p_tg = placeholders(en.get(k, "")), placeholders(v)
        if p_en != p_tg:
            problems.append(f"{k}: placeholder mismatch en={p_en} target={p_tg}")
        if ("<" in v) or ("`" in v) or ("</" in v):
            problems.append(f"{k}: markup/backtick introduced")
        if cells(v) > BUDGET_CELLS:
            problems.append(f"{k}: {cells(v)} cells > budget {BUDGET_CELLS}")
        words = set(re.findall(r"[a-z']+", v.lower()))
        leaked = words & ENGLISH_STOPWORDS
        if leaked:
            problems.append(f"{k}: English leftover token(s) {sorted(leaked)}")
        # es typography: no space before ; : ? !
        if re.search(r"\s[:;?!]", v):
            problems.append(f"{k}: space before es punctuation")
    return problems


def main() -> int:
    en_full = json.loads(EN_SNAPSHOT.read_text())
    missing_en = [k for k in KEYS if k not in en_full]
    if missing_en:
        print("!! English source at 8fdfb2e9 lacks", missing_en)
        return 2
    en = {k: en_full[k] for k in KEYS}  # slice-scoped parity: this group is 2 keys
    cand = json.loads(CAND.read_text())
    for label, path in (
        ("candidate (target bytes)", CAND),
        ("en catalogue @8fdfb2e9", EN_SNAPSHOT),
        ("en context @8fdfb2e9", CONTEXT_SNAPSHOT),
    ):
        print(f"input {label}: {path} sha256={hashlib.sha256(Path(path).read_bytes()).hexdigest()}")
    print("candidate file:", CAND)
    print("candidate bytes sha256:", hashlib.sha256(CAND.read_bytes()).hexdigest())
    print("candidate parsed:", json.dumps(cand, ensure_ascii=False, sort_keys=True))
    print("cells:", {k: cells(v) for k, v in cand.items()})
    for k, v in cand.items():
        print(f"codepoints {k}:", " ".join(f"U+{ord(c):04X}" for c in v))

    problems = check(cand, en)
    print("\nREAL CANDIDATE:", "PASS (0 problems)" if not problems else "FAIL")
    for p in problems:
        print("  -", p)

    # ---- negative controls: the checker must bite on each mutation ----
    controls = {
        "empty value": {**cand, KEYS[0]: ""},
        "english leftover": {**cand, KEYS[0]: "Show more"},
        "identical to English (both)": {**en},
        "placeholder introduced": {**cand, KEYS[0]: "Ver {count} más"},
        "trailing full stop": {**cand, KEYS[1]: "Ver menos."},
        "bidi control": {**cand, KEYS[1]: "Ver\u202b menos"},
        "NFD decomposed accent": {**cand, KEYS[0]: unicodedata.normalize("NFD", "Ver más")},
        "overflow": {**cand, KEYS[1]: "Mostrar menos elementos de este mensaje"},
        "ctrl-ws": {**cand, KEYS[0]: " Ver más"},
    }
    print("\nNEGATIVE CONTROLS (each must FAIL):")
    ok = True
    for name, mutated in controls.items():
        got = check(mutated, en)
        verdict = "FAIL-as-required" if got else "!! NOT CAUGHT !!"
        if not got:
            ok = False
        print(f"  {name}: {verdict} -> {got[:2]}")

    # ---- provenance hashes for the record ----
    shipped = {k: cand[k] for k in KEYS}
    en_pair = {k: en[k] for k in KEYS}
    for label, obj in (("shipped candidate pair", shipped), ("english pair", en_pair)):
        blob = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        print(f"{label} canonical-json sha256: {hashlib.sha256(blob).hexdigest()}")
        print(f"  canonical json: {blob.decode()}")
    return 0 if (not problems and ok) else 1


if __name__ == "__main__":
    sys.exit(main())
