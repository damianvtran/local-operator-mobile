#!/usr/bin/env python3
"""HOSTED INSTALLED-APP PROOF ONLY: regenerate the synthetic face fixtures.

WHY: design review D4.3 (local-operator-mobile #304, round 3) could not judge
the circular crop of a sender photo because the mock's photo is one flat
colour. These are simple ILLUSTRATED faces drawn from geometry here — not a
photo, not a real person — with a face centred the way a profile photo is, so
a bad crop (off-centre, cut chin, square corners) is visible on a frame.

Two different faces (hair, skin, background) so a multi-sender conversation
shows at a glance whether each row carries its own sender (D3 / U7).

The PNGs are committed beside this script (harness only; never in the app).
Run: python3 make_faces.py  (writes face-mia.png, face-kenji.png)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pngtools import Image, write  # noqa: E402

SIDE, SS = 256, 3  # output side, supersampling factor for smooth edges

FACES = {
    "mia": {"bg": (92, 141, 214), "skin": (241, 194, 160), "hair": (58, 36, 24), "shirt": (236, 236, 236),
            "long_hair": True},
    "kenji": {"bg": (238, 180, 72), "skin": (198, 140, 100), "hair": (24, 24, 30), "shirt": (40, 96, 74),
              "long_hair": False},
}


def inside_ellipse(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0


def colour_at(x: float, y: float, f: dict) -> tuple[int, int, int]:
    # Painter's order, last match wins: shoulders, long hair, face, hair cap,
    # eyes, mouth. Coordinates are in 0..1 of the output square.
    c = f["bg"]
    if inside_ellipse(x, y, 0.5, 1.08, 0.42, 0.3):
        c = f["shirt"]
    if f["long_hair"] and inside_ellipse(x, y, 0.5, 0.5, 0.27, 0.33) and y > 0.3:
        c = f["hair"]
    if inside_ellipse(x, y, 0.5, 0.47, 0.2, 0.25):
        c = f["skin"]
    if inside_ellipse(x, y, 0.5, 0.34, 0.23, 0.17) and y < 0.36:
        c = f["hair"]
    for ex in (0.42, 0.58):
        if inside_ellipse(x, y, ex, 0.47, 0.022, 0.03):
            c = (30, 30, 30)
    # Smile: a thin band of an ellipse's lower half.
    if (inside_ellipse(x, y, 0.5, 0.55, 0.08, 0.06) and not inside_ellipse(x, y, 0.5, 0.535, 0.075, 0.055)
            and y > 0.56):
        c = (150, 60, 60)
    return c


def draw(f: dict) -> Image:
    rows = []
    n = SIDE * SS
    for oy in range(SIDE):
        row = bytearray()
        for ox in range(SIDE):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    cr, cg, cb = colour_at((ox * SS + sx + 0.5) / n, (oy * SS + sy + 0.5) / n, f)
                    r, g, b = r + cr, g + cg, b + cb
            k = SS * SS
            row += bytes((r // k, g // k, b // k))
        rows.append(row)
    return Image(SIDE, SIDE, 3, rows)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for name, spec in FACES.items():
        write(os.path.join(here, f"face-{name}.png"), draw(spec))
        print(f"face-{name}.png")
