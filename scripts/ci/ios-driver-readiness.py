#!/usr/bin/env python3
"""App-free hosted Maestro readiness; never a mobile application acceptance test.

Use the already provisioned, digest-pinned distribution's simulator resources,
not a locally compiled runner. See docs/ci.md for the dispatch/artifact contract.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import secrets
import socket
import subprocess
import sys
import time
import zipfile

VERSION = "2.11.0"
RUNNER = "dev.mobile.maestro-driver-iosUITests.xctrunner"
# Keep the existing LocalXCTestInstaller startup budget and chrome-ios-proof's
# hierarchy budget. These are deadlines, not retries or timeout extensions.
STARTUP_SECONDS = 120
HIERARCHY_SECONDS = 120
COMMAND_SECONDS = 60
RESOURCE = "driver-iPhoneSimulator/"
CONFIG = RESOURCE + "maestro-driver-ios-config.xctestrun"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate_hierarchy(payload):
    require(isinstance(payload, dict), "hierarchy must be a JSON object")
    require(type(payload.get("depth")) is int and payload["depth"] > 0,
            "hierarchy depth must be positive")
    nodes = []

    def visit(node):
        require(isinstance(node, dict), "invalid AXElement")
        require(isinstance(node.get("label"), str) and
                isinstance(node.get("identifier"), str) and
                type(node.get("elementType")) is int, "invalid AXElement fields")
        frame = node.get("frame")
        require(isinstance(frame, dict) and all(type(frame.get(k)) in (int, float)
                for k in ("X", "Y", "Width", "Height")), "invalid AXElement frame")
        nodes.append(node)
        children = node.get("children")
        require(children is None or isinstance(children, list), "invalid children")
        for child in children or []:
            visit(child)

    visit(payload.get("axElement"))
    # Fresh simulator + Home button + an actual SpringBoard application subtree:
    # arbitrary parseable JSON (or a runner's own empty UI) is not readiness.
    require(any(n["elementType"] == 2 and n["label"] == "SpringBoard"
                for n in nodes), "missing SpringBoard application subtree")
    require(len(nodes) > 1, "empty SpringBoard hierarchy")
    return len(nodes)


def listener_pid(listeners, jobs, commands, udid):
    pids = {int(p) for p in listeners.split()}
    owned = set()
    for line in jobs.splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[0].isdigit():
            label = fields[2].removeprefix("UIKitApplication:").split("[", 1)[0]
            if label == RUNNER:
                owned.add(int(fields[0]))
    require(len(pids) == 1 and pids == owned,
            "listener is not the exact runner in the owned simulator")
    pid = next(iter(pids))
    command = commands.get(pid, "")
    require(udid in command and "maestro-driver-iosUITests-Runner.app/" in command,
            "listener executable is not in the owned simulator")
    return pid


class Proof:
    def __init__(self, root):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_path = self.root / "owner.json"
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("CMUX_", "LOP_", "LOCAL_OPERATOR_"))
                    and k not in ("GH_TOKEN", "GITHUB_TOKEN", "XPC_FLAGS")}
        home = self.root / "home"
        home.mkdir(exist_ok=True)
        self.env.update(HOME=str(home), CFFIXED_USER_HOME=str(home))
        self.process = None

    def save(self):
        self.state_path.write_text(json.dumps(self.state, indent=2) + "\n")

    def run(self, name, args, timeout=COMMAND_SECONDS, accepted=(0,)):
        start = time.monotonic()
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   env=self.env, start_new_session=True)
        output, failure = b"", None
        try:
            output, _ = process.communicate(timeout=timeout)
        except BaseException as error:
            failure = str(error)
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            output, _ = process.communicate()
            raise
        finally:
            (self.root / f"{name}.log").write_bytes(output)
            with (self.root / "commands.jsonl").open("a") as log:
                log.write(json.dumps(dict(name=name, argv=args, exit=process.returncode,
                                          error=failure, seconds=time.monotonic() - start)) + "\n")
        require(process.returncode in accepted, f"{name}: exit {process.returncode}")
        return output.decode()

    def ownership(self, deadline):
        def remaining():
            value = deadline - time.monotonic()
            require(value > 0, "ownership deadline expired")
            return value

        port, udid = self.state["port"], self.state["udid"]
        self.state["ownershipChecks"] = self.state.get("ownershipChecks", 0) + 1
        prefix = f"ownership-{self.state['ownershipChecks']}"
        listeners = self.run(f"{prefix}-listeners", ["lsof", "-nP", f"-iTCP:{port}",
                                           "-sTCP:LISTEN", "-t"], accepted=(0, 1), timeout=remaining())
        jobs = self.run(f"{prefix}-launchctl", ["xcrun", "simctl", "spawn", udid, "launchctl", "list"], timeout=remaining())
        commands = {int(pid): self.run(f"{prefix}-listener-{pid}",
                    ["ps", "-p", pid, "-o", "command="], timeout=remaining()) for pid in listeners.split()}
        pid = listener_pid(listeners, jobs, commands, udid)
        self.state["listenerPid"] = pid
        self.save()

    def request(self, name, path, body=None, timeout=HIERARCHY_SECONDS):
        deadline = time.monotonic() + timeout
        self.ownership(deadline)
        remaining = deadline - time.monotonic()
        require(remaining > 0, f"{name} deadline expired")
        args = ["curl", "--silent", "--show-error", "--fail-with-body", "--noproxy", "*",
                "--connect-timeout", "1", "--max-time", str(remaining),
                "--output", str(self.root / f"{name}.json"),
                f"http://127.0.0.1:{self.state['port']}/{path}"]
        if body is not None:
            args += ["--header", "Content-Type: application/json", "--data", json.dumps(body)]
        start = time.monotonic()
        try:
            self.run(name, args, timeout=remaining)
        finally:
            self.state.setdefault("requests", {})[name] = dict(seconds=time.monotonic() - start)
            self.save()
        self.ownership(deadline)
        return (self.root / f"{name}.json").read_text()

    def apps(self, name, udid):
        self.run(name, ["xcrun", "simctl", "listapps", udid])
        payload = self.run(f"{name}-json", ["plutil", "-convert", "json", "-o", "-", str(self.root / f"{name}.log")])
        apps = json.loads(payload)
        require(isinstance(apps, dict), "listapps is not an object")
        return set(apps)

    def prepare(self, maestro):
        require(os.environ.get("MAESTRO_VERSION") == VERSION, "Maestro pin differs from 2.11.0")
        # The shared installer authenticates the release zip. Record the selected
        # jar too, so evidence identifies the exact compiled runner, not source.
        jars = []
        for jar in (maestro / "lib").glob("*.jar"):
            with zipfile.ZipFile(jar) as archive:
                if CONFIG in archive.namelist():
                    jars.append(jar)
        require(len(jars) == 1, "expected one bundled simulator runner resource jar")
        jar = jars[0].resolve()
        self.state.update(maestroVersion=VERSION, resourceJar=str(jar),
                          resourceJarSha256=hashlib.sha256(jar.read_bytes()).hexdigest())
        self.save()
        products = self.root / "products"
        self.run("extract-resources", ["unzip", "-q", str(jar), RESOURCE + "*", "-d", str(products)])
        for name in ("maestro-driver-iosUITests-Runner", "maestro-driver-ios"):
            archive = products / RESOURCE / "Debug-iphonesimulator" / f"{name}.zip"
            require(archive.is_file(), f"missing bundled {name}.zip")
            self.run(f"extract-{name}", ["unzip", "-q", str(archive), "-d", str(archive.parent)])
        config = products / CONFIG
        self.state["config"] = str(config)
        devices = json.loads(self.run("devices-before", ["xcrun", "simctl", "list", "devices", "available", "--json"]))["devices"]
        choices = [(runtime, d) for runtime, ds in devices.items() if ".iOS-" in runtime
                   for d in ds if d.get("isAvailable") and d["name"].startswith("iPhone")]
        choices.sort(key=lambda pair: (pair[1]["name"] == "iPhone 17",
                     tuple(int(x) for x in pair[0].split(".iOS-")[1].split("-"))), reverse=True)
        require(bool(choices), "no provisioned iPhone simulator/runtime")
        runtime, device = choices[0]
        udid = self.run("create", ["xcrun", "simctl", "create", self.root.name,
                                  device["deviceTypeIdentifier"], runtime]).strip()
        self.state.update(udid=udid, runtime=runtime)
        self.save()
        self.run("boot", ["xcrun", "simctl", "boot", udid])
        self.run("bootstatus", ["xcrun", "simctl", "bootstatus", udid, "-b"], timeout=STARTUP_SECONDS)
        before = self.apps("apps-before", udid)
        require(all(app.startswith("com.apple.") for app in before), "fresh simulator has non-system apps")
        self.state["appsBefore"] = sorted(before)
        self.save()
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            self.state["port"] = reservation.getsockname()[1]
        self.save()
        require(not self.run("port-before", ["lsof", "-nP", f"-iTCP:{self.state['port']}",
                                            "-sTCP:LISTEN", "-t"], accepted=(0, 1)).strip(),
                "assigned port already has a listener")
        args = ["xcodebuild", "test-without-building", "-xctestrun", str(config),
                "-destination", f"id={udid}", "-derivedDataPath", str(self.root / "derived-data"),
                "-parallel-testing-enabled", "NO", "-only-testing:maestro-driver-iosUITests/maestro_driver_iosUITests/testHttpServer"]
        # Descendants inherit this per-launch nonce. A surviving member anchors
        # ownership even after xcodebuild exits; a stale/reused PGID alone never
        # authorizes a signal. Persist before launching for fallback cleanup.
        self.state["groupToken"] = secrets.token_hex(32)
        self.save()
        env = dict(self.env, TEST_RUNNER_PORT=str(self.state["port"]),
                   LOP_READINESS_GROUP=self.state["groupToken"])
        with (self.root / "xctest.log").open("wb") as log:
            self.process = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT,
                                            env=env, start_new_session=True)
        self.state.update(pgid=self.process.pid, launch=args)
        self.save()
        # Poll only socket availability inside the original startup deadline;
        # never restart/reinstall the runner or retry a failed HTTP operation.
        deadline = time.monotonic() + STARTUP_SECONDS
        while True:
            require(self.process.poll() is None, "XCTest runner exited before readiness")
            require(time.monotonic() < deadline, "driver startup deadline exceeded")
            try:
                with socket.create_connection(("127.0.0.1", self.state["port"]), timeout=1):
                    break
            except OSError:
                time.sleep(0.5)
        remaining = deadline - time.monotonic()
        status = json.loads(self.request("status", "status", timeout=min(100, remaining)))
        require(status == {"status": "ok"}, "unexpected status response")
        # XCTest may leave its own host in front. Go Home, not into Operator;
        # the same hierarchy deadline includes this system-only positioning.
        hierarchy_deadline = time.monotonic() + HIERARCHY_SECONDS
        self.request("home", "pressButton", {"button": "home"},
                     timeout=hierarchy_deadline - time.monotonic())
        tree = json.loads(self.request("hierarchy", "viewHierarchy",
                         {"appIds": ["com.apple.springboard"], "excludeKeyboardElements": False},
                         timeout=hierarchy_deadline - time.monotonic()))
        self.state["hierarchyNodes"] = validate_hierarchy(tree)
        after = self.apps("apps-after", udid)
        added = after - before
        require(added <= {RUNNER, "dev.mobile.maestro-driver-ios"},
                f"unexpected non-driver apps: {sorted(added)}")
        self.state["appsAdded"] = sorted(added)
        self.state["ready"] = True
        self.save()

    def group_members(self, pgid):
        rows = self.run("cleanup-group", ["ps", "-axo", "pid=,pgid="])
        return [int(pid) for pid, group in (row.split() for row in rows.splitlines())
                if int(group) == pgid]

    def group_is_owned(self, members):
        token = self.state.get("groupToken")
        if not token:
            return False
        for pid in members:
            # ps's environment output can contain host credentials: inspect only
            # in memory, never send it through run()'s persisted command logs.
            result = subprocess.run(["ps", "eww", "-p", str(pid), "-o", "command="],
                                    env=self.env, capture_output=True, text=True,
                                    timeout=COMMAND_SECONDS)
            require(result.returncode in (0, 1), "cannot verify process group owner")
            if f"LOP_READINESS_GROUP={token}" in result.stdout.split():
                return True
        return False

    def cleanup(self):
        errors = []
        pgid = self.state.get("pgid")
        if pgid:
            try:
                members = self.group_members(pgid)
                if members:
                    require(self.group_is_owned(members), "refusing to kill an unowned process")
                    try:
                        os.killpg(pgid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if self.process is not None:
                    self.process.wait(timeout=COMMAND_SECONDS)
                # Orphaned children are reaped by the host, not Popen.wait().
                # Wait within the existing command budget before certifying the
                # group absent; this is teardown, not a readiness retry.
                deadline = time.monotonic() + COMMAND_SECONDS
                while self.group_members(pgid) and time.monotonic() < deadline:
                    time.sleep(0.01)
            except Exception as error:
                errors.append(str(error))
        udid = self.state.get("udid")
        if udid:
            for name, args in (("shutdown", ["xcrun", "simctl", "shutdown", udid]),
                               ("delete", ["xcrun", "simctl", "delete", udid])):
                try:
                    devices = json.loads(self.run(f"cleanup-{name}-state", ["xcrun", "simctl", "list", "devices", "--json"]))["devices"]
                    owned = [d for ds in devices.values() for d in ds if d["udid"] == udid]
                    if owned and (name == "delete" or owned[0]["state"] != "Shutdown"):
                        self.run(f"cleanup-{name}", args)
                except Exception as error:
                    errors.append(str(error))
            try:
                devices = json.loads(self.run("devices-after", ["xcrun", "simctl", "list", "devices", "--json"]))["devices"]
                require(not any(d["udid"] == udid for ds in devices.values() for d in ds), "owned simulator remains")
            except Exception as error:
                errors.append(str(error))
        listener = self.state.get("listenerPid")
        if listener:
            try:
                remaining = self.run("listeners-after", ["lsof", "-nP", f"-iTCP:{self.state['port']}",
                                     "-sTCP:LISTEN", "-t"], accepted=(0, 1))
                require(str(listener) not in remaining.split(), "owned runner still listening after teardown")
            except Exception as error:
                errors.append(str(error))
        if pgid:
            try:
                os.killpg(pgid, 0)
                errors.append("owned process group remains")
            except ProcessLookupError:
                pass
        self.state["cleanup"] = dict(ok=not errors, errors=errors)
        self.save()
        require(not errors, "; ".join(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--maestro-dir", type=Path)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    proof = Proof(args.out)
    if args.cleanup:
        proof.cleanup()
        return 0
    require(args.maestro_dir is not None, "--maestro-dir is required")
    require(not proof.state, "output already has an owner; never reuse an old listener")
    proof.state["ready"] = False
    proof.save()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit("terminated"))
    failed = False
    try:
        proof.prepare(args.maestro_dir.resolve())
    except BaseException as error:
        failed = True
        proof.state["error"] = str(error)
        print(f"::error::{error}", file=sys.stderr)
    finally:
        try:
            proof.cleanup()
        except Exception as error:
            failed = True
            print(f"::error::cleanup: {error}", file=sys.stderr)
        proof.state["result"] = "FAIL" if failed else "PASS"
        proof.save()
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
