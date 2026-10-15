"""Manual-only source diagnostic, never a native producer/identity sidecar.

Unknown shell precedence is a useful result, not permission to execute a phase.
Raw tool output stays in owned staging; only typed, bounded JSON is publishable.
All subprocesses have one absolute deadline and exact owned process-group reap.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import time

BASELINE = "b5a20fec2db9416fbdaf385b20338cb950effe32"
KIND = "producer-contract-diagnostic-only"
LIMIT = 48 * 1024
RAW_LIMIT = 8 * 1024 * 1024
FILES = {
    ".github/workflows/ios.yml", "scripts/ci/producer-contract-diagnostic.py",
    "scripts/ci/producer-contract-sdk.cjs", "scripts/ci/test_producer_contract_diagnostic.py",
    "docs/qa/producer-contract-diagnostic.md",
}
VERSIONS = {"expo": "57.0.26", "@expo/cli": "57.0.27", "@expo/metro-config": "57.0.12",
            "@expo/config-plugins": "57.0.9", "react-native": "0.86.3",
            "@react-native/community-cli-plugin": "0.86.3", "hermes-compiler": "250829098.0.17",
            "metro-source-map": "0.84.5", "@expo/metro": "56.0.2"}
ROLES = {"resolve-entry", "rn-bundle-phase", "rn-compose-map", "expo-embed", "expo-serializer", "expo-map"}
CODES = {"INPUT_REJECTED", "SETUP_PREREQUISITE", "COMMAND_FAILED", "TIMEOUT", "BYTE_BUDGET",
         "NODE_REQUIRED", "PNPM_REQUIRED", "JDK17_REQUIRED", "PLUTIL_REQUIRED", "SOURCE_CHANGED",
         "SDK_PREREQUISITE", "PROJECT_COUNT", "PHASE_COUNT", "PBX_INVALID", "ENTRY_RESOLUTION_FAILED",
         "PATH_REFUSED", "PUBLIC_SCHEMA", "PREBUILD_FAILED", "SDK_REQUIRED", "XCODE_PREREQUISITE",
         "COLLECTOR_FAILED", "OWNED_GROUP_NOT_REAPED", "PREBUILD_JAVA_HOME_ERROR"}
# JDK17_REQUIRED remains valid ONLY for historical P artifacts: it conflated
# initial tool/version checks and a later prebuild stderr marker. Never infer
# an old artifact's execution stage from that code or its null result fields.


class Stop(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise Stop(code)


def input_guard(event, mode):
    # The workflow routes ANY non-native manual mode here. An invalid input must
    # fail, not fall through to the expensive native/signed execution graph.
    need(event == "workflow_dispatch" and mode == "contract-only", "INPUT_REJECTED")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_./@+%=~-]{1,512}", value)) and not value.startswith("/") and ".." not in value.split("/")


def file_info(root, value, cap=262144):
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    path = path.resolve(strict=True)
    need(path.is_relative_to(root) and path.is_file(), "PATH_REFUSED")
    relative = path.relative_to(root).as_posix()
    need(safe_path(relative) and not path.name.startswith(".env")
         and path.suffix not in {".pem", ".p8", ".p12", ".key", ".keystore"}, "PATH_REFUSED")
    size = path.stat().st_size
    need(0 < size <= cap, "BYTE_BUDGET")
    raw = path.read_bytes()
    need(len(raw) == size, "BYTE_BUDGET")
    return {"path": relative, "bytes": size, "sha256": digest(raw)}


def phase_facts(pbx):
    need(type(pbx) is dict and type(pbx.get("objects")) is dict, "PBX_INVALID")
    phases = [item for item in pbx["objects"].values() if type(item) is dict and item.get("isa") == "PBXShellScriptBuildPhase"
              and (item.get("name") == "Bundle React Native code and images" or
                   "react-native-xcode.sh" in str(item.get("shellScript", "")) or
                   "export:embed" in str(item.get("shellScript", "")))]
    need(len(phases) == 1, "PHASE_COUNT")
    script = phases[0].get("shellScript")
    need(isinstance(script, str) and 0 < len(script.encode()) <= 32768, "PBX_INVALID")
    # Do NOT serialize unknown assignments or arbitrary shell excerpts. Presence
    # is deliberately weaker than precedence: sourced .xcode.env, guards and
    # dynamic substitutions can override any apparently simple first assignment.
    assignments = {}
    for name in ("ENTRY_FILE", "CLI_PATH", "BUNDLE_COMMAND", "SOURCEMAP_FILE"):
        assignments[name] = min(32, len(re.findall(r"(?m)^\s*(?:export\s+)?" + name + r"\s*=", script)))
    guards = {name: bool(re.search(r"(?m)^\s*if\b[^\n]*-z\s+[\"']?\$(?:\{" + name + r"\}|" + name + r")(?=$|[\"'\s;\]])", script)) for name in assignments}
    return {"sha256": digest(script.encode()), "bytes": len(script.encode()),
            "emptyGuardPatternSeen": guards,
            "precedence": "UNKNOWN", "reason": "UNEXECUTED_SHELL_PRECEDENCE",
            "assignments": assignments, "sourcesExternalEnvironment": bool(re.search(r"(?m)^\s*(?:source\s|\.\s)", script))}


class Runner:
    def __init__(self, directory, seconds=360):
        self.directory = directory
        self.deadline = time.monotonic() + seconds
        self.total = 0
        self.count = 0

    def run(self, args, *, timeout=20, cap=32768, failure="COMMAND_FAILED"):
        remaining = min(timeout, self.deadline - time.monotonic())
        need(remaining > 0 and self.count < 24, "TIMEOUT")
        self.count += 1
        env = {key: os.environ[key] for key in ("HOME", "PATH", "TMPDIR", "RUNNER_TEMP", "PNPM_HOME", "JAVA_HOME") if key in os.environ}
        env.update(CI="1", EXPO_NO_TELEMETRY="1")
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True, env=env)
        end = time.monotonic() + remaining
        output = [bytearray(), bytearray()]
        output_hash = hashlib.sha256()
        observed = [0, 0]
        try:
            with (self.directory / f"{self.count:02d}.bin").open("xb") as raw, selectors.DefaultSelector() as selector:
                # Fully withhold raw text even in staging. SDK/prebuild output
                # may contain arbitrary private strings: regex redaction is not
                # a guarantee, especially across read boundaries.
                raw.write(b"OUTPUT WITHHELD; see bounded stream digest metadata\n")
                for index, pipe in enumerate((process.stdout, process.stderr)):
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, index)
                while selector.get_map():
                    need(time.monotonic() < end, "TIMEOUT")
                    events = selector.select(max(0, end - time.monotonic()))
                    need(bool(events), "TIMEOUT")
                    for key, _ in events:
                        try:
                            chunk = os.read(key.fileobj.fileno(), min(65536, cap - sum(map(len, output)) + 1))
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        observed[key.data] += len(chunk)
                        output_hash.update(chunk)
                        need(time.monotonic() < end, "TIMEOUT")
                        need(sum(map(len, output)) + len(chunk) <= cap and self.total + len(chunk) <= RAW_LIMIT, "BYTE_BUDGET")
                        self.total += len(chunk)
                        output[key.data].extend(chunk)
            try:
                process.wait(timeout=max(.001, end - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise Stop("TIMEOUT") from None
            need(time.monotonic() <= end, "TIMEOUT")
            if process.returncode != 0:
                # Classification is a fixed enum, never an exception/log snippet.
                if failure == "PREBUILD_FAILED":
                    if b"Android SDK" in output[1]:
                        failure = "SDK_REQUIRED"
                    elif b"JAVA_HOME" in output[1]:
                        # This proves only a nonzero PREBUILD command whose stderr
                        # contains the marker, not a Java version or root cause.
                        failure = "PREBUILD_JAVA_HOME_ERROR"
                    elif b"xcrun" in output[1]:
                        failure = "XCODE_PREREQUISITE"
                raise Stop(failure)
            return bytes(output[0]), bytes(output[1])
        finally:
            # Reap the whole owned group even when its leader already exited:
            # an inherited output pipe can otherwise outlive both the deadline
            # and the native job's process. Never name-match or touch live PIDs.
            try:
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    try:
                        os.killpg(process.pid, sig)
                    except ProcessLookupError:
                        pass
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    raise Stop("OWNED_GROUP_NOT_REAPED") from None
                gone = False
                for _ in range(20):
                    try:
                        os.killpg(process.pid, 0)
                    except ProcessLookupError:
                        gone = True
                        break
                    time.sleep(.05)
                need(gone, "OWNED_GROUP_NOT_REAPED")
            finally:
                process.stdout.close()
                process.stderr.close()
                (self.directory / f"{self.count:02d}.json").write_text(json.dumps({
                    "stdoutBytes": observed[0], "stderrBytes": observed[1],
                    "observedCombinedSha256": output_hash.hexdigest(), "rawTextRetained": False}))


def validate_public(value):
    need(type(value) is dict and set(value) == {"schema", "kind", "nativeCompiled", "status", "code", "checkout", "sdk", "phase", "entry"}, "PUBLIC_SCHEMA")
    need(value["schema"] == 1 and value["kind"] == KIND and value["nativeCompiled"] is False, "PUBLIC_SCHEMA")
    if value["status"] == "BLOCKED":
        need(value["code"] in CODES and all(value[key] is None for key in ("checkout", "sdk", "phase", "entry")), "PUBLIC_SCHEMA")
        return
    need(value["status"] == "SOURCE_DIAGNOSTIC_ONLY" and value["code"] is None, "PUBLIC_SCHEMA")
    need(isinstance(value["checkout"], str) and re.fullmatch(r"[0-9a-f]{40}", value["checkout"]), "PUBLIC_SCHEMA")
    sdk = value["sdk"]
    need(type(sdk) is dict and set(sdk) == {"schema", "kind", "packages", "sources"} and sdk["schema"] == 1 and sdk["kind"] == "installed-sdk-metadata-only", "PUBLIC_SCHEMA")
    need(type(sdk["packages"]) is list and len(sdk["packages"]) == len(VERSIONS), "PUBLIC_SCHEMA")
    need({item.get("name") for item in sdk["packages"] if type(item) is dict} == set(VERSIONS), "PUBLIC_SCHEMA")
    for item in sdk["packages"]:
        need(set(item) == {"name", "version", "path", "sha256"} and VERSIONS.get(item["name"]) == item["version"], "SDK_PREREQUISITE")
        need(safe_path(item["path"]) and item["path"].startswith("node_modules/") and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]), "PUBLIC_SCHEMA")
    need(type(sdk["sources"]) is list and len(sdk["sources"]) == len(ROLES) and {item.get("role") for item in sdk["sources"] if type(item) is dict} == ROLES, "PUBLIC_SCHEMA")
    for item in sdk["sources"]:
        need(set(item) == {"role", "path", "sha256", "bytes"} and safe_path(item["path"]) and item["path"].startswith("node_modules/"), "PUBLIC_SCHEMA")
        need(type(item["bytes"]) is int and 0 < item["bytes"] <= 262144 and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]), "PUBLIC_SCHEMA")
    phase = value["phase"]
    need(type(phase) is dict and set(phase) == {"sha256", "bytes", "precedence", "reason", "assignments", "emptyGuardPatternSeen", "sourcesExternalEnvironment"}, "PUBLIC_SCHEMA")
    need(phase["precedence"] == "UNKNOWN" and phase["reason"] == "UNEXECUTED_SHELL_PRECEDENCE" and type(phase["sourcesExternalEnvironment"]) is bool, "PUBLIC_SCHEMA")
    need(type(phase["bytes"]) is int and 0 < phase["bytes"] <= 32768 and re.fullmatch(r"[0-9a-f]{64}", phase["sha256"]), "PUBLIC_SCHEMA")
    need(type(phase["emptyGuardPatternSeen"]) is dict and set(phase["emptyGuardPatternSeen"]) == {"ENTRY_FILE", "CLI_PATH", "BUNDLE_COMMAND", "SOURCEMAP_FILE"} and all(type(flag) is bool for flag in phase["emptyGuardPatternSeen"].values()), "PUBLIC_SCHEMA")
    need(type(phase["assignments"]) is dict and set(phase["assignments"]) == {"ENTRY_FILE", "CLI_PATH", "BUNDLE_COMMAND", "SOURCEMAP_FILE"} and all(type(number) is int and 0 <= number <= 32 for number in phase["assignments"].values()), "PUBLIC_SCHEMA")
    entry = value["entry"]
    need(type(entry) is dict and set(entry) == {"path", "bytes", "sha256", "kind"} and entry["kind"] == "SDK_RESOLVED_ONLY" and safe_path(entry["path"]), "PUBLIC_SCHEMA")
    need(type(entry["bytes"]) is int and 0 < entry["bytes"] <= 262144 and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), "PUBLIC_SCHEMA")


def promote(output, value):
    validate_public(value)
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    need(len(raw) <= LIMIT, "BYTE_BUDGET")
    name = "STOP.json" if value["status"] == "BLOCKED" else "diagnostic.json"
    stage = output / "approved"
    stage.mkdir()
    # Hash the exact bytes BEFORE atomic promotion; no artifact ID/self hash is
    # fabricated inside the diagnostic. Raw files are never upload candidates.
    (stage / name).write_bytes(raw)
    (stage / "sha256.json").write_text(json.dumps({"schema": 1, "file": name, "bytes": len(raw), "sha256": digest(raw)}))
    stage.rename(output / "public")


def verify_public(directory):
    public = directory / "public"
    need(public.is_dir() and not public.is_symlink(), "PUBLIC_SCHEMA")
    names = {path.name for path in public.iterdir()}
    need(names in ({"diagnostic.json", "sha256.json"}, {"STOP.json", "sha256.json"}), "PUBLIC_SCHEMA")
    name = "STOP.json" if "STOP.json" in names else "diagnostic.json"
    for item in public.iterdir():
        need(item.is_file() and not item.is_symlink() and item.stat().st_size <= LIMIT, "PUBLIC_SCHEMA")
    raw = (public / name).read_bytes()
    value = json.loads(raw)
    validate_public(value)
    need((name == "STOP.json") == (value["status"] == "BLOCKED"), "PUBLIC_SCHEMA")
    hashes = json.loads((public / "sha256.json").read_bytes())
    need(hashes == {"schema": 1, "file": name, "bytes": len(raw), "sha256": digest(raw)}, "PUBLIC_SCHEMA")
    return value


def finalize(directory):
    # Upload is conditioned on this check's explicit safe=true output, not just
    # always(). A symlink/partial/tampered publication must never be uploaded.
    try:
        verify_public(directory)
    except Exception:
        public = directory / "public"
        if public.exists() or public.is_symlink():
            public.rename(directory / "withheld-public")
        approved = directory / "approved"
        if approved.exists() or approved.is_symlink():
            approved.rename(directory / "withheld-approved")
        promote(directory, blocked("SETUP_PREREQUISITE"))
        verify_public(directory)
    output = os.environ.get("GITHUB_OUTPUT")
    need(output is not None, "SETUP_PREREQUISITE")
    with open(output, "a") as target:
        target.write("safe=true\n")


def blocked(code):
    return {"schema": 1, "kind": KIND, "nativeCompiled": False, "status": "BLOCKED", "code": code,
            "checkout": None, "sdk": None, "phase": None, "entry": None}


def project_file(root):
    projects = []
    for candidate in (root / "ios").glob("*.xcodeproj/project.pbxproj"):
        projects.append(candidate)
        need(len(projects) <= 1, "PROJECT_COUNT")
    need(len(projects) == 1, "PROJECT_COUNT")
    need(projects[0].resolve().is_relative_to(root) and projects[0].stat().st_size <= 2 * 1024 * 1024, "PATH_REFUSED")
    return projects[0]


def resolver_argv(root, sdk):
    # Expo 57.0.26 reads argv[1:4], despite its direct-script usage comment.
    # A constant eval loader preserves that layout without interpolating paths
    # into executable code. Only the measured, pinned Expo script may be loaded;
    # never require the resolved application entry or an arbitrary helper role.
    packages = [item for item in sdk["packages"] if item.get("name") == "expo"]
    sources = [item for item in sdk["sources"] if item.get("role") == "resolve-entry"]
    need(len(packages) == 1 and packages[0].get("version") == VERSIONS["expo"]
         and len(sources) == 1, "SDK_PREREQUISITE")
    package, source = packages[0], sources[0]
    measured_package = file_info(root, package["path"], cap=65536)
    need(measured_package["sha256"] == package["sha256"]
         and Path(measured_package["path"]).name == "package.json"
         and measured_package["path"].startswith("node_modules/"), "SDK_PREREQUISITE")
    expo = (root / measured_package["path"]).parent
    expected = (expo / "scripts/resolveAppEntry.js").resolve(strict=True)
    actual = file_info(root, source["path"])
    need(expected.is_relative_to(expo) and root / actual["path"] == expected
         and all(actual[key] == source[key] for key in actual), "SDK_PREREQUISITE")
    return ["node", "--eval", "require(process.argv[4]);", str(root), "ios", "absolute", str(expected)]


def collect(root, runner):
    # This path generates iOS source only. Pinned Expo CLI selects ios mods and
    # --no-install skips native dependency installation; an exact Java17 gate
    # borrowed from a full native/Android job is not an evidenced prerequisite.
    # Actual prebuild failures still STOP below; no toolchain is provisioned.
    for tool, code in (("node", "NODE_REQUIRED"), ("pnpm", "PNPM_REQUIRED"), ("plutil", "PLUTIL_REQUIRED")):
        need(shutil.which(tool), code)
    out, _ = runner.run(["node", "--version"])
    need(re.fullmatch(rb"v24\.[0-9]+\.[0-9]+\s*", out), "NODE_REQUIRED")
    out, _ = runner.run(["pnpm", "--version"])
    need(out.strip() == b"12.6.0", "PNPM_REQUIRED")
    out, _ = runner.run(["git", "diff", "--name-only", BASELINE, "--"], failure="SOURCE_CHANGED")
    need(all(path in FILES for path in out.decode().splitlines()), "SOURCE_CHANGED")
    out, _ = runner.run(["git", "rev-parse", "HEAD"])
    checkout = out.decode().strip()
    runner.run(["pnpm", "install", "--frozen-lockfile"], timeout=180, cap=4 * 1024 * 1024)
    out, _ = runner.run(["node", "scripts/ci/producer-contract-sdk.cjs", str(root)], failure="SDK_PREREQUISITE")
    sdk = json.loads(out)
    # Validate installed source paths against their actual bytes, not helper JSON
    # supplied filenames. Realpath excludes external/shared/quarantined trees.
    need(type(sdk) is dict and type(sdk.get("sources")) is list, "SDK_PREREQUISITE")
    for source in sdk["sources"]:
        actual = file_info(root, source["path"])
        need(all(actual[key] == source[key] for key in actual), "SDK_PREREQUISITE")
    resolver = [item for item in sdk["sources"] if item.get("role") == "resolve-entry"]
    need(len(resolver) == 1, "SDK_PREREQUISITE")
    runner.run(["pnpm", "exec", "expo", "prebuild", "--platform", "ios", "--no-install"], timeout=120, cap=2 * 1024 * 1024, failure="PREBUILD_FAILED")
    # Resolve AFTER generation, using the same measured installed SDK script;
    # this is still not evidence the unexecuted Xcode phase chose that entry.
    for source in sdk["sources"]:
        need(file_info(root, source["path"])["sha256"] == source["sha256"], "SDK_PREREQUISITE")
    for package in sdk["packages"]:
        need(file_info(root, package["path"], cap=65536)["sha256"] == package["sha256"], "SDK_PREREQUISITE")
    out, _ = runner.run(resolver_argv(root, sdk), failure="ENTRY_RESOLUTION_FAILED")
    entry = file_info(root, out.decode().strip())
    entry["kind"] = "SDK_RESOLVED_ONLY"
    project = project_file(root)
    out, _ = runner.run(["plutil", "-convert", "json", "-o", "-", str(project)], cap=2 * 1024 * 1024, failure="PBX_INVALID")
    return {"schema": 1, "kind": KIND, "nativeCompiled": False, "status": "SOURCE_DIAGNOSTIC_ONLY", "code": None,
            "checkout": checkout, "sdk": sdk, "phase": phase_facts(json.loads(out)), "entry": entry}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("guard", "collect", "failure"))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    runner_temp = os.environ.get("RUNNER_TEMP")
    need(runner_temp is not None and output.name == "producer-contract-diagnostic"
         and output.parent.resolve() == Path(runner_temp).resolve(), "PATH_REFUSED")
    # Paths are workflow-owned RUNNER_TEMP children. Refuse an existing link,
    # never pick a fallback home, and never overwrite a previously published set.
    need(not output.is_symlink(), "PATH_REFUSED")
    output.mkdir(parents=True, exist_ok=True)
    if args.action == "failure":
        finalize(output)
        return
    try:
        input_guard(os.environ.get("DIAGNOSTIC_EVENT"), os.environ.get("DIAGNOSTIC_MODE"))
        if args.action == "guard":
            return
        root = Path.cwd().resolve()
        raw = output / "raw"
        raw.mkdir()
        runner = Runner(raw)
        def interrupted(_signum, _frame):
            raise Stop("TIMEOUT")
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        value = collect(root, runner)
        promote(output, value)
    except Exception as error:
        code = str(error) if isinstance(error, Stop) and str(error) in CODES else "COLLECTOR_FAILED"
        if not (output / "public").exists():
            # A failed promotion may have a partial approved directory; it is
            # intentionally outside upload paths. Use a fresh fixed STOP staging.
            if (output / "approved").exists():
                (output / "approved").rename(output / "withheld")
            promote(output, blocked(code))
        raise SystemExit(code) from None


if __name__ == "__main__":
    main()
