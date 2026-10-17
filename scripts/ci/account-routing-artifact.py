"""Owned simulator artifact extraction/identity, stdlib-only and no SDK process.

Do not trust an upload name or executable bit: reject unsafe ZIP entries first,
then inspect the actual plist, Mach-O platform and embedded JS bytes. This helper
never downloads, installs, boots or invokes credential clients.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import stat
import struct
import sys
import zipfile

MAX_EXPANDED = 512 * 1024 * 1024
CPUS = {0x0100000C: "arm64", 0x01000007: "x86_64"}


def members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    result = archive.infolist()
    seen: set[str] = set()
    total = 0
    for entry in result:
        name = entry.filename
        if not name or name.startswith("/") or "\\" in name or "\0" in name:
            raise ValueError("unsafe artifact path")
        parts = name.rstrip("/").split("/")
        if any(part in {"", ".", ".."} for part in parts) or ":" in parts[0]:
            raise ValueError("artifact path traversal")
        folded = str(PurePosixPath(name)).casefold()
        if folded in seen or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError("duplicate/case-colliding or symlink artifact entry")
        seen.add(folded)
        total += entry.file_size
        if total > MAX_EXPANDED or entry.flag_bits & 1:
            raise ValueError("expanded/encrypted artifact refused")
    return result


def extract(archive: Path, destination: Path) -> Path:
    if destination.exists():
        raise ValueError("artifact destination must be newly owned and absent")
    with zipfile.ZipFile(archive) as zipped:
        validated = members(zipped)
        destination.mkdir(mode=0o700)
        # No extractall until the ENTIRE central directory passes. Symlinks and
        # case aliases are refused, so no earlier entry can redirect a later one.
        for entry in validated:
            target = destination / entry.filename
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("artifact escaped owned extraction root")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output, zipped.open(entry) as source:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
    apps = [p.parent for p in destination.rglob("Info.plist") if p.parent.suffix == ".app"]
    if len(apps) != 1:
        raise ValueError("expected exactly one simulator app")
    return apps[0]


def macho_facts(raw: bytes) -> list[dict]:
    if len(raw) < 32:
        raise ValueError("missing Mach-O header")
    magic = raw[:4]
    if magic in {b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}:
        count = struct.unpack_from(">I", raw, 4)[0]
        width = 32 if magic[-1] == 0xBF else 20
        if not 1 <= count <= 8 or len(raw) < 8 + count * width:
            raise ValueError("invalid fat Mach-O table")
        output = []
        for index in range(count):
            entry = 8 + index * width
            offset, size = struct.unpack_from(">QQ" if width == 32 else ">II", raw, entry + 8)
            if offset + size > len(raw):
                raise ValueError("Mach-O slice escaped archive file")
            output.extend(macho_facts(raw[offset:offset + size]))
        return output
    endian = "<" if magic == b"\xcf\xfa\xed\xfe" else ">" if magic == b"\xfe\xed\xfa\xcf" else None
    if endian is None:
        raise ValueError("unsupported actual Mach-O executable")
    cpu = struct.unpack_from(endian + "I", raw, 4)[0]
    commands, command_bytes = struct.unpack_from(endian + "II", raw, 16)
    if cpu not in CPUS or 32 + command_bytes > len(raw):
        raise ValueError("unsupported simulator CPU/load-command bounds")
    position = 32
    platforms = []
    for _ in range(commands):
        if position + 8 > 32 + command_bytes:
            raise ValueError("truncated Mach-O command")
        command, size = struct.unpack_from(endian + "II", raw, position)
        if size < 8 or position + size > 32 + command_bytes:
            raise ValueError("invalid Mach-O command size")
        if command == 0x32:
            if size < 24:
                raise ValueError("truncated LC_BUILD_VERSION")
            platforms.append(struct.unpack_from(endian + "I", raw, position + 8)[0])
        position += size
    if platforms != [7]:
        raise ValueError("actual binary is not an iOS SIMULATOR build")
    return [{"architecture": CPUS[cpu], "platform": "iOS Simulator", "platform_code": 7}]


def inspect(app: Path, markers: list[str] | None = None) -> dict:
    app = app.resolve(strict=True)
    with (app / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    executable, bundle = info.get("CFBundleExecutable"), info.get("CFBundleIdentifier")
    if not isinstance(executable, str) or not executable or Path(executable).name != executable or executable in {".", ".."} or not isinstance(bundle, str):
        raise ValueError("invalid actual bundle executable/identifier")
    binary = app / executable
    if binary.is_symlink():
        raise ValueError("executable symlink refused")
    raw = binary.read_bytes()
    architectures = macho_facts(raw)
    assets = []
    for path in app.rglob("*"):
        if path.is_symlink():
            raise ValueError("app contains an unverified symlink")
        if not path.is_file():
            continue
        if path.suffix in {".jsbundle", ".hbc"}:
            content = path.read_bytes()
            assets.append({"path": str(path.relative_to(app)), "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "marker_matches": {marker: marker.encode() in content or marker.encode("utf-16-le") in content for marker in (markers or [])}})
        # Artifact transport strips mode bits. Restore ONLY owned actual Mach-O
        # files, never recursive chmod on the runner or a source checkout.
        with path.open("rb") as stream:
            header = stream.read(4)
        if header in {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}:
            path.chmod(path.stat().st_mode | stat.S_IXUSR)
    if not assets:
        raise ValueError("no actual embedded JS/Hermes asset found")
    assets.sort(key=lambda item: item["path"])
    return {"app": str(app), "bundleId": bundle, "executable": executable, "version": info.get("CFBundleShortVersionString"), "build": info.get("CFBundleVersion"), "architectures": [item["architecture"] for item in architectures], "machO": architectures, "executableSha256": hashlib.sha256(raw).hexdigest(), "jsAssets": assets}


if __name__ == "__main__":
    action, source, *rest = sys.argv[1:]
    if action == "extract":
        target = extract(Path(source), Path(rest[0]))
        print(json.dumps(inspect(target, rest[1:])))
    elif action == "inspect":
        print(json.dumps(inspect(Path(source), rest)))
    else:
        raise SystemExit("unknown artifact action")
