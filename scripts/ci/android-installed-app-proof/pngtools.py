"""HOSTED INSTALLED-APP PROOF ONLY: the few PNG operations the driver needs,
in the standard library.

WHY not Pillow: the hosted runner's system Python has no Pillow, and the rig
rules forbid scratch dependency installs. `adb exec-out screencap -p` writes
8-bit, non-interlaced RGBA (colour type 6); the synthetic face fixtures are
8-bit RGB (colour type 2). Those two shapes are all `decode` accepts — anything
else raises rather than guessing.

Used for: per-row crops of shade frames (design D3/D4: judge each row's
avatar), and the mean-luminance check that proves a "dark" frame is dark
(API 29 rendered a light shade under `cmd uimode night yes` in run
44267910444).
"""
from __future__ import annotations

import struct
import zlib

SIG = b"\x89PNG\r\n\x1a\n"


class Image:
    def __init__(self, width: int, height: int, channels: int, rows: list[bytearray]):
        self.width, self.height, self.channels, self.rows = width, height, channels, rows

    def crop(self, left: int, top: int, right: int, bottom: int) -> "Image":
        left, top = max(0, left), max(0, top)
        right, bottom = min(self.width, right), min(self.height, bottom)
        if right <= left or bottom <= top:
            raise ValueError(f"empty crop {left},{top},{right},{bottom}")
        c = self.channels
        return Image(right - left, bottom - top, c, [bytearray(r[left * c:right * c]) for r in self.rows[top:bottom]])

    def mean_luminance(self, step: int = 4) -> float:
        """Rec. 709 luma, 0-255, sampled every `step` pixels on both axes."""
        c, total, n = self.channels, 0.0, 0
        for y in range(0, self.height, step):
            row = self.rows[y]
            for x in range(0, self.width, step):
                i = x * c
                total += 0.2126 * row[i] + 0.7152 * row[i + 1] + 0.0722 * row[i + 2]
                n += 1
        return total / n if n else 0.0


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)


def decode(data: bytes) -> Image:
    if data[:8] != SIG:
        raise ValueError("not a PNG")
    pos, idat, ihdr = 8, bytearray(), None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    if ihdr is None:
        raise ValueError("no IHDR")
    width, height, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or interlace or ctype not in (2, 6):
        raise ValueError(f"unsupported PNG depth={depth} type={ctype} interlace={interlace}")
    c = 4 if ctype == 6 else 3
    raw = zlib.decompress(bytes(idat))
    stride = width * c
    rows: list[bytearray] = []
    prev = bytearray(stride)
    for y in range(height):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(c, stride):
                line[i] = (line[i] + line[i - c]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = line[i - c] if i >= c else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                left = line[i - c] if i >= c else 0
                up_left = prev[i - c] if i >= c else 0
                line[i] = (line[i] + _paeth(left, prev[i], up_left)) & 255
        elif f != 0:
            raise ValueError(f"bad filter {f}")
        rows.append(line)
        prev = line
    return Image(width, height, c, rows)


def encode(img: Image) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ctype = 6 if img.channels == 4 else 2
    raw = b"".join(b"\x00" + bytes(r) for r in img.rows)
    return (SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", img.width, img.height, 8, ctype, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def read(path: str) -> Image:
    with open(path, "rb") as f:
        return decode(f.read())


def write(path: str, img: Image) -> None:
    with open(path, "wb") as f:
        f.write(encode(img))
