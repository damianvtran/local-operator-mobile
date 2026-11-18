#!/usr/bin/env python3
"""HOSTED INSTALLED-APP PROOF ONLY: the artifact manifest and its preflight.

WHY: a device run is only evidence about the candidate if the APK on the device
is the candidate. The build job records one manifest (source SHA, app/driver APK
SHA-256, target package, instrumentation target, signer digests, embedded JS
SHA-256); every emulator row re-derives each fact from the downloaded bytes
BEFORE booting anything and refuses to dispatch on any mismatch. `selftest`
proves the refusals are real: a wrong source SHA, a bundle without the fixture
seam and a driver targeting another package must each fail, by name.

  preflight.py manifest <dir> <source-sha>   (build job; writes <dir>/manifest.json)
  preflight.py check <dir> <expected-sha>    (emulator job, before boot)
  preflight.py selftest <dir> <expected-sha> (negative controls; must all refuse)
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile

MARKER = b"LOP_INSTALLED_PROOF_FIXTURE_54832"
APP, DRIVER = "app-debug.apk", "app-debug-androidTest.apk"
BUNDLE = "assets/index.android.bundle"


class Refused(Exception):
    pass


def tool(name: str) -> str:
    found = sorted(glob.glob(os.path.join(os.environ["ANDROID_HOME"], "build-tools", "*", name)))
    if not found:
        raise Refused(f"build-tools {name} not found")
    return found[-1]


def run(*cmd: str) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def package_of(badging: str) -> str:
    m = re.search(r"^package: name='([^']+)'", badging, re.M)
    if not m:
        raise Refused("no package in badging")
    return m.group(1)


def instrumentation_target(xmltree: str) -> str | None:
    # aapt xmltree prints `E: instrumentation` then indented attributes.
    block = xmltree.split("E: instrumentation", 1)
    if len(block) < 2:
        return None
    m = re.search(r'android:targetPackage\([^)]*\)="([^"]+)"', block[1])
    return m.group(1) if m else None


def signers(apk: str) -> list[str]:
    out = run(tool("apksigner"), "verify", "--print-certs", apk)
    return sorted(set(re.findall(r"certificate SHA-256 digest: ([0-9a-f]+)", out)))


def facts(d: str) -> dict:
    app, driver = os.path.join(d, APP), os.path.join(d, DRIVER)
    with zipfile.ZipFile(app) as z:
        bundle = z.read(BUNDLE)
    return {
        "source_sha": open(os.path.join(d, "source-head.txt")).read().strip(),
        "app_apk_sha256": sha(open(app, "rb").read()),
        "driver_apk_sha256": sha(open(driver, "rb").read()),
        "app_package": package_of(run(tool("aapt"), "dump", "badging", app)),
        "driver_package": package_of(run(tool("aapt"), "dump", "badging", driver)),
        "driver_xmltree": run(tool("aapt"), "dump", "xmltree", driver, "AndroidManifest.xml"),
        "app_signers": signers(app),
        "driver_signers": signers(driver),
        "bundle_sha256": sha(bundle),
        "bundle_has_fixture": MARKER in bundle,
    }


def check(manifest: dict, actual: dict, expected_sha: str) -> list[str]:
    """Every refusal, by name; empty means dispatch may proceed."""
    bad = []
    if not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
        bad.append("expected SHA is not a full commit id")
    if actual["source_sha"] != expected_sha or manifest["source_sha"] != expected_sha:
        bad.append(f"wrong source SHA: built {actual['source_sha']}, expected {expected_sha}")
    for key in ("app_apk_sha256", "driver_apk_sha256", "bundle_sha256", "app_package", "driver_package"):
        if manifest[key] != actual[key]:
            bad.append(f"{key} differs from the build manifest")
    if not actual["bundle_has_fixture"]:
        bad.append("missing fixture: embedded bundle lacks the job-only seam")
    target = instrumentation_target(actual["driver_xmltree"])
    if target != actual["app_package"]:
        bad.append(f"cross-app driver: instrumentation targets {target}, app is {actual['app_package']}")
    if not actual["app_signers"] or actual["app_signers"] != actual["driver_signers"]:
        bad.append("driver is not signed by the app's debug signer")
    return bad


def main() -> int:
    mode, d, expected = sys.argv[1], sys.argv[2], sys.argv[3]
    if mode == "manifest":
        f = facts(d)
        f["source_sha"] = expected
        f["instrumentation_target"] = instrumentation_target(f.pop("driver_xmltree"))
        json.dump(f, open(os.path.join(d, "manifest.json"), "w"), indent=2, sort_keys=True)
        print(json.dumps(f, indent=2, sort_keys=True))
        return 0
    manifest = json.load(open(os.path.join(d, "manifest.json")))
    actual = facts(d)
    if mode == "check":
        bad = check(manifest, actual, expected)
        printable = {k: v for k, v in actual.items() if k != "driver_xmltree"}
        printable["instrumentation_target"] = instrumentation_target(actual["driver_xmltree"])
        print(json.dumps(printable, indent=2, sort_keys=True))
        for b in bad:
            print(f"::error title=Installed-app preflight refused::{b}")
        print("PREFLIGHT " + ("REFUSED" if bad else "PASS"))
        return 1 if bad else 0
    if mode == "selftest":
        assert not check(manifest, actual, expected), "selftest needs a passing baseline"
        controls = {
            "wrong source SHA": (manifest, actual, "0" * 40),
            # Real bytes: the candidate's NORMAL export (no define), which the
            # build job staged beside the proof APK.
            "missing fixture": (manifest, {**actual, "bundle_has_fixture": MARKER in open(
                os.path.join(d, "normal", "index.android.bundle"), "rb").read()}, expected),
            "cross-app driver": (manifest, {**actual, "driver_xmltree": actual["driver_xmltree"].replace(
                f'="{actual["app_package"]}"', '="com.example.other"')}, expected),
        }
        ok = True
        for name, (m, a, e) in controls.items():
            bad = check(m, a, e)
            hit = any(b.startswith(name) for b in bad)
            print(f"NEGATIVE CONTROL {name}: {'REFUSED' if hit else 'NOT REFUSED'} {bad}")
            ok &= hit
        return 0 if ok else 1
    raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    sys.exit(main())
