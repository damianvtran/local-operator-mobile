"""Private fixture bridge to the PINNED real core setting facade, never a router.

Only trusted fixture startup supplies paths/profile. HTTP bodies can supply the
one canonical value, never a config key/path or Python source. Keep this bridge
stdlib-only until the explicit source path and ownership marker are verified;
no auth/credential store, provider, SecretStore or native keychain is constructed.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sys
from pathlib import Path

CORE_BLOB = "b08458247ac5babb43acd696c44bc3630e01d787"
FIXTURE_SHA256 = "ff4f4b39f7f12cf8fa8bf546f0ef4aa7c91b3bd2e4ad63ce48cafbb22b8297a0"


def run() -> dict:
    parser = argparse.ArgumentParser()
    parser.add_argument("--core-root", required=True)
    parser.add_argument("--private-root", required=True)
    parser.add_argument("--profile", choices=("a", "b"), required=True)
    args = parser.parse_args()
    core = Path(args.core_root).resolve(strict=True)
    private = Path(args.private_root).resolve(strict=True)
    marker = private / ".loh12-account-routing-fixture"
    if not marker.is_file() or marker.read_text() != "loh12-canonical-account-routing-v1\n":
        raise ValueError("missing private fixture ownership marker")
    source = core / "local_operator/mobile/account_routing.py"
    raw = source.read_bytes()
    blob = hashlib.sha1(
        b"blob " + str(len(raw)).encode() + b"\0" + raw, usedforsecurity=False
    ).hexdigest()
    if blob != CORE_BLOB:
        raise ValueError("stale or wrong core account-routing source")
    fixture = (
        Path(__file__).resolve().parents[2]
        / "src/features/settings/__fixtures__/account-routing.core.json"
    )
    fixture_bytes = fixture.read_bytes()
    if hashlib.sha256(fixture_bytes).hexdigest() != FIXTURE_SHA256:
        raise ValueError("changed canonical native projection fixture")

    def private_facade_only(event: str, _args: tuple) -> None:
        # The one-setting facade needs neither a provider probe nor any child
        # credential/keychain client. Fail the fixture before those side effects,
        # without substituting/mocking the canonical projection or config writer.
        if event in {
            "socket.connect", "socket.getaddrinfo", "subprocess.Popen",
            "os.system", "os.posix_spawn",
        }:
            raise RuntimeError("private policy fixture attempted network or child-process I/O")

    sys.addaudithook(private_facade_only)
    sys.path.insert(0, str(core))
    facade = importlib.import_module("local_operator.mobile.account_routing")
    if Path(facade.__file__).resolve() != source.resolve():
        raise ValueError("core import resolved outside the pinned source root")
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) - {"method", "body"}:
        raise ValueError("invalid private bridge request")
    method = request.get("method")
    if method not in {"PROBE", "GET", "PATCH"}:
        raise ValueError("unsupported private bridge method")
    # The probe root is unreachable by HTTP profile selection and stays fresh.
    # A/B config roots persist across bridge processes, so readback is real disk
    # state, not a canned return value or another phone-side default policy.
    root = private / ("probe" if method == "PROBE" else args.profile)
    if root.is_symlink() or not root.resolve().is_relative_to(private):
        raise ValueError("private computer profile escaped fixture storage")
    config_file = root / facade.CONFIG_FILE_NAME
    if config_file.is_symlink():
        raise ValueError("private config file cannot alias another configuration")
    root.mkdir(mode=0o700, exist_ok=True)
    try:
        payload = facade.policy_payload(root, request.get("body"), write=method == "PATCH")
    except facade.AccountRoutingError as exc:
        return {"status": exc.status, "body": {"code": exc.code, "error": str(exc)}}
    if method == "PROBE" and payload != json.loads(fixture_bytes):
        raise ValueError("actual core projection differs from the canonical native fixture")
    return {
        "status": 200,
        "body": payload,
        "source": {
            "core_blob": blob,
            "fixture_sha256": FIXTURE_SHA256,
            "import_relative": str(Path(facade.__file__).resolve().relative_to(core)),
        },
    }


if __name__ == "__main__":
    try:
        print(json.dumps(run(), ensure_ascii=False))
    except Exception as exc:
        # Startup must stop, not silently fall back to a static policy fixture.
        print(json.dumps({"fixture_error": str(exc)}))
        raise SystemExit(2) from exc
