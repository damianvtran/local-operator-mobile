"""Explicit CI-only CoreC1 base bootstrap; never install from inside the fixture.

C1 has no uv.lock. Record the authoritative 23 requirements and actual resolved
versions instead of claiming frozen Python resolution. No extras, SDK or
operator HOME/config/store is used.

WHY THE PINNED CHECKOUT'S OWN METADATA IS INSTALLED TOO. The canonical facade
imports ``local_operator.config``, whose ``_package_version`` reads
``importlib.metadata.version("local-operator")`` at import time. A base-deps-only
venv has no such distribution, so the fixture HTTP layer failed with
``No package metadata was found for local-operator`` (CI run 38840447956). Only
the package DISTRIBUTION METADATA is added (``--no-deps``); the 23 base
requirements stay the only runtime dependencies, and the installed version must
match the pinned checkout rather than an ambient install.
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


def core_metadata(core: Path) -> tuple[list[str], str, list[str]]:
    project = tomllib.loads((core / "pyproject.toml").read_text())["project"]
    build = tomllib.loads((core / "pyproject.toml").read_text())["build-system"]
    values = project["dependencies"]
    version = project["version"]
    requires = build["requires"]
    backend = build["build-backend"]
    if (
        len(values) != 23
        or any(not isinstance(value, str) or "\n" in value for value in values)
        or (core / "uv.lock").exists()
    ):
        raise ValueError("CoreC1 base dependency metadata changed")
    if not isinstance(version, str) or not version.strip() or "\n" in version:
        raise ValueError("pinned CoreC1 project version missing")
    # The backend is asserted too: pinning terms without checking the backend can
    # still be built by would leave the isolation boundary unverified.
    if (
        not isinstance(requires, list)
        or not requires
        or any(not isinstance(entry, str) or not entry.strip() for entry in requires)
        or backend != "setuptools.build_meta"
    ):
        raise ValueError("unexpected CoreC1 build-system metadata")
    raw = (core / "local_operator/mobile/account_routing.py").read_bytes()
    if (
        hashlib.sha1(
            b"blob " + str(len(raw)).encode() + b"\0" + raw, usedforsecurity=False
        ).hexdigest()
        != BLOB
    ):
        raise ValueError("CoreC1 facade source mismatch before dependency setup")
    return values, version.strip(), [entry.strip() for entry in requires]


def verify_metadata(executable: str, expected: str, environment: Path, env: dict) -> dict:
    """Prove the facade's metadata lookup resolves inside THIS isolated env.

    A version match alone could be satisfied by an ambient `local-operator`
    install on PATH, so the distribution path must also sit inside the venv this
    bootstrap created.
    """
    probe = (
        "import json\n"
        "from importlib.metadata import version, distribution\n"
        "d = distribution('local-operator')\n"
        "print(json.dumps({'v': version('local-operator'), 'p': str(d.locate_file(''))}))\n"
    )
    try:
        output = subprocess.check_output(
            [executable, "-c", probe], env=env, text=True, timeout=60, stderr=subprocess.PIPE
        )
    except subprocess.CalledProcessError as error:
        # Fail closed with the cause, not a raw traceback: the whole point of this
        # check is to name a missing/mismatched distribution (CI 38840447956).
        detail = (error.stderr or "").strip().splitlines()
        tail = detail[-1] if detail else "no stderr"
        raise ValueError(
            f"local-operator distribution metadata unavailable in the isolated env: {tail}"
        ) from error
    facts = json.loads(output)
    path = Path(facts["p"]).resolve()
    if facts["v"] != expected:
        raise ValueError("installed version differs from the pinned CoreC1 checkout")
    if not path.is_relative_to(environment.resolve()):
        raise ValueError("local-operator metadata resolved outside the isolated env")
    return {"metadataVersion": facts["v"], "metadataPath": str(path)}


def main() -> None:
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        or os.environ.get("LOH12_NATIVE_PROOF_ADMITTED") != "1"
    ):
        raise RuntimeError("dependency bootstrap is separately admitted hosted CI only")
    if sys.version_info < (3, 12):
        raise RuntimeError("existing Python>=3.12 required; do not download a runtime")
    core, work = (Path(value).resolve() for value in sys.argv[1:3])
    if not work.is_relative_to(Path(os.environ["RUNNER_TEMP"]).resolve()):
        raise ValueError("bootstrap root is not owned runner temp")
    safe = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "LANG", "TMPDIR", "SSL_CERT_FILE"}
    }
    safe.update(
        {
            "PIP_CONFIG_FILE": os.devnull,
            "PIP_INDEX_URL": "https://pypi.org/simple",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "GIT_CONFIG_SYSTEM": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ASKPASS": "/bin/false",
        }
    )
    actual = subprocess.check_output(
        ["git", "-C", str(core), "rev-parse", "HEAD"], env=safe, text=True
    ).strip()
    if actual != CORE:
        raise ValueError("wrong public Core checkout")
    subprocess.run(
        ["git", "-C", str(core), "diff", "--quiet", "HEAD", "--", "local_operator"],
        env=safe,
        check=True,
    )
    declared, version, build_requires = core_metadata(core)
    identity = hashlib.sha256(json.dumps(declared).encode()).hexdigest()
    receipt_file = work / "core-bootstrap.json"
    environment = work / "core-python"
    executable = environment / "bin/python"
    if receipt_file.exists():
        previous = json.loads(receipt_file.read_text())
        current = subprocess.check_output(
            [str(executable), "-m", "pip", "freeze", "--all"], env=safe, text=True
        ).splitlines()
        metadata = verify_metadata(str(executable), version, environment, safe)
        if (
            previous.get("core") != CORE
            or previous.get("requirementsSha256") != identity
            or previous.get("resolved") != current
            or previous.get("metadataVersion") != metadata["metadataVersion"]
        ):
            raise ValueError("existing bootstrap receipt/environment is stale")
        print(json.dumps(previous))
        return
    if environment.exists():
        raise ValueError("unreceipted Python environment; no overwrite or hidden repair")
    work.mkdir(parents=True, exist_ok=True)
    source = work / "core-base-requirements.txt"
    source.write_text("\n".join(declared) + "\n")
    venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run(
        [
            str(executable),
            "-m",
            "pip",
            "install",
            "--only-binary=:all:",
            "--disable-pip-version-check",
            "-r",
            str(source),
        ],
        env=safe,
        timeout=240,
        check=True,
    )
    # Build requirements are installed EXPLICITLY and recorded, then the checkout
    # is built with --no-build-isolation. Without this, PEP 517 isolation resolved
    # setuptools/wheel from the index at build time, unpinned and unrecorded (R4-1,
    # review 6206979138): the same source could build under a different backend on
    # a different day with nothing in the receipt to show it.
    subprocess.run(
        [
            str(executable),
            "-m",
            "pip",
            "install",
            "--only-binary=:all:",
            "--disable-pip-version-check",
            *build_requires,
        ],
        env=safe,
        timeout=180,
        check=True,
    )
    # BUILD FROM A PRISTINE COPY, NOT THE PINNED CHECKOUT.
    #
    # `pip install --no-deps --no-build-isolation <tree>` runs the setuptools
    # backend with the source tree as its working directory, so it writes
    # `build/` and `local_operator.egg-info/` INTO that tree — measured directly
    # on this checkout: after the install both directories exist beside the
    # source. The pinned checkout's own .gitignore lists `*.egg-info/` and
    # `build/`, so a plain `git status --porcelain` reported NOTHING for exactly
    # the artifacts the cleanliness check existed to catch (review R5-1); the
    # check passed because git hid the pollution. Building in an isolated copy
    # extracted from the pinned commit keeps the checkout genuinely untouched,
    # and the assertion below is then a real one that can fail.
    build_source = work / "core-build-source"
    if build_source.exists():
        raise ValueError("unreceipted build staging tree; no overwrite")
    build_source.mkdir(parents=True)
    archive = subprocess.check_output(
        ["git", "-C", str(core), "archive", "--format=tar", CORE],
        env=safe,
        timeout=180,
    )
    subprocess.run(
        ["tar", "-x", "-C", str(build_source)],
        input=archive,
        env=safe,
        timeout=180,
        check=True,
    )
    subprocess.run(
        [
            str(executable),
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--no-build-isolation",
            "--disable-pip-version-check",
            str(build_source),
        ],
        env=safe,
        timeout=300,
        check=True,
    )
    # The pinned checkout must be untouched ANYWHERE after the build: an egg-info
    # or build/ directory is an install-time artifact, and the earlier check only
    # covered `local_operator/` (R4-1).
    #
    # `--ignored=matching` is REQUIRED, not belt-and-braces: the pinned checkout's
    # .gitignore lists `*.egg-info/`, `build/` and `dist/`, so a plain
    # `status --porcelain` reports NOTHING for exactly the artifacts this check
    # exists to catch, and reports them only once it is asked about ignored paths.
    stray = subprocess.check_output(
        ["git", "-C", str(core), "status", "--porcelain", "--ignored=matching"],
        env=safe,
        text=True,
    ).strip()
    if stray:
        raise ValueError(
            "install-time artifact modified the pinned checkout: "
            + stray.splitlines()[0]
        )
    build_resolved = subprocess.check_output(
        [str(executable), "-m", "pip", "freeze", "--all"], env=safe, text=True
    ).splitlines()
    metadata = verify_metadata(str(executable), version, environment, safe)
    resolved = subprocess.check_output(
        [str(executable), "-m", "pip", "freeze", "--all"], env=safe, text=True
    ).splitlines()
    receipt = {
        "core": CORE,
        "facadeBlob": BLOB,
        "baseCount": len(declared),
        "requirementsSha256": identity,
        "declared": declared,
        "resolved": resolved,
        "buildRequiresDeclared": build_requires,
        "buildRequiresResolved": build_resolved,
        "buildIsolation": False,
        "metadataInstallCommand": (
            f"pip install --no-deps --no-build-isolation <core checkout> ({version})"
        ),
        "python": str(executable),
        "version": subprocess.check_output(
            [str(executable), "--version"], text=True
        ).strip(),
        # The distribution metadata is pinned to the checkout; the DEPENDENCY
        # RESOLUTION is still not lock-frozen, and saying so keeps the receipt honest.
        "frozenResolution": False,
        **metadata,
    }
    receipt_file.write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
