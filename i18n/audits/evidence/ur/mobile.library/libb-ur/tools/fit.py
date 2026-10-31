"""Cell widths of every value, measured with rich.cells.cell_len in core's venv (the same measure the style
guides use). No maxCells/maxChars hint exists in the en sidecar for this namespace, so fit is judged against the
English width and the widget that renders the string."""
import json, sys
from rich.cells import cell_len
root = "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues"
en = json.load(open(f"{root}/en/mobile.library.json"))
for loc in ("ur", "hi"):
    d = json.load(open(f"{root}/{loc}/mobile.library.json"))
    print(f"== {loc}")
    print(f"{'key':42} {'en':>4} {'tgt':>4} {'ratio':>6}")
    worst = []
    for k in en:
        e, t = cell_len(en[k]), cell_len(d[k])
        worst.append((t / max(e, 1), k, e, t))
        print(f"{k.replace('mobile.library.',''):42} {e:4} {t:4} {t/max(e,1):6.2f}")
    worst.sort(reverse=True)
    print("widest relative to English:", [(k, e, t) for _, k, e, t in worst[:3]])
    print("hints in en sidecar:", sum(1 for _ in open(f"{root}/en/mobile.library.context.json") if "maxCells" in _ or "maxChars" in _))
