"""Explicit CI-only CoreC1 base bootstrap; never install from inside the fixture.

C1 has no uv.lock. Record the authoritative 23 requirements and actual resolved
versions instead of claiming frozen Python resolution. No project installation,
extras, SDK or operator HOME/config/store is used.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib
import venv

CORE = "c1b7083a5371d60aa4ad58dbb54fd30d1a25857c"
BLOB = "b08458247ac5babb43acd696c44bc3630e01d787"


def requirements(core: Path) -> list[str]:
    values = tomllib.loads((core / "pyproject.toml").read_text())["project"]["dependencies"]
    if len(values) != 23 or any(not isinstance(value, str) or "\n" in value for value in values) or (core / "uv.lock").exists():
        raise ValueError("CoreC1 base dependency metadata changed")
    raw = (core / "local_operator/mobile/account_routing.py").read_bytes()
    if hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw, usedforsecurity=False).hexdigest() != BLOB:
        raise ValueError("CoreC1 facade source mismatch before dependency setup")
    return values


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted" or os.environ.get("LOH12_NATIVE_PROOF_ADMITTED") != "1":
        raise RuntimeError("dependency bootstrap is separately admitted hosted CI only")
    if sys.version_info < (3, 12):
        raise RuntimeError("existing Python>=3.12 required; do not download a runtime")
    core, work = (Path(value).resolve() for value in sys.argv[1:3])
    if not work.is_relative_to(Path(os.environ["RUNNER_TEMP"]).resolve()):
        raise ValueError("bootstrap root is not owned runner temp")
    safe = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "LANG", "TMPDIR", "SSL_CERT_FILE"}}
    safe.update({"PIP_CONFIG_FILE": os.devnull, "PIP_INDEX_URL": "https://pypi.org/simple", "PIP_DISABLE_PIP_VERSION_CHECK": "1", "GIT_CONFIG_SYSTEM": os.devnull, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/false"})
    actual = subprocess.check_output(["git", "-C", str(core), "rev-parse", "HEAD"], env=safe, text=True).strip()
    if actual != CORE:
        raise ValueError("wrong public Core checkout")
    subprocess.run(["git", "-C", str(core), "diff", "--quiet", "HEAD", "--", "local_operator"], env=safe, check=True)
    declared = requirements(core)
    identity = hashlib.sha256(json.dumps(declared).encode()).hexdigest()
    receipt_file = work / "core-bootstrap.json"
    environment = work / "core-python"
    executable = environment / "bin/python"
    if receipt_file.exists():
        previous = json.loads(receipt_file.read_text())
        current = subprocess.check_output([str(executable), "-m", "pip", "freeze", "--all"], env=safe, text=True).splitlines()
        if previous.get("core") != CORE or previous.get("requirementsSha256") != identity or previous.get("resolved") != current:
            raise ValueError("existing bootstrap receipt/environment is stale")
        print(json.dumps(previous))
        return
    if environment.exists():
        raise ValueError("unreceipted Python environment; no overwrite or hidden repair")
    work.mkdir(parents=True, exist_ok=True)
    source = work / "core-base-requirements.txt"
    source.write_text("\n".join(declared) + "\n")
    venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run([str(executable), "-m", "pip", "install", "--only-binary=:all:", "--disable-pip-version-check", "-r", str(source)], env=safe, timeout=240, check=True)
    resolved = subprocess.check_output([str(executable), "-m", "pip", "freeze", "--all"], env=safe, text=True).splitlines()
    receipt = {"core": CORE, "facadeBlob": BLOB, "baseCount": len(declared), "requirementsSha256": identity, "declared": declared, "resolved": resolved, "python": str(executable), "version": subprocess.check_output([str(executable), "--version"], text=True).strip(), "frozenResolution": False}
    receipt_file.write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
