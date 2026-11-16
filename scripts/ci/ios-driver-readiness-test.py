#!/usr/bin/env python3
"""Control-flow/HTTP negative controls, NOT native iOS readiness evidence."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("readiness", Path(__file__).with_name("ios-driver-readiness.py"))
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)
UDID = "11111111-2222-3333-4444-555555555555"
PID = 987654
APP = readiness.RUNNER
COMMAND = f"/devices/{UDID}/data/maestro-driver-iosUITests-Runner.app/runner"
FRAME = dict(X=0, Y=0, Width=393, Height=852)
TREE = dict(depth=2, axElement=dict(label="SpringBoard", identifier="", elementType=2,
            frame=FRAME, children=[dict(label="Home", identifier="home", elementType=1, frame=FRAME)]))


class ListenerTests(unittest.TestCase):
    def test_owned_runner(self):
        self.assertEqual(readiness.listener_pid(str(PID), f"{PID} 0 UIKitApplication:{APP}[abc]", {PID: COMMAND}, UDID), PID)

    def test_wrong_simulator_stale_listener_multiple_listeners(self):
        for listeners, jobs, command in (
            (str(PID), f"{PID} 0 {APP}", COMMAND.replace(UDID, "another-simulator")),
            (str(PID), f"9999 0 {APP}", COMMAND),
            (str(PID), f"{PID} 0 some.other.app", COMMAND),
            (f"{PID}\n9999", f"{PID} 0 {APP}", COMMAND),
            ("", "", ""),
        ):
            with self.subTest(listeners=listeners, jobs=jobs), self.assertRaises(RuntimeError):
                readiness.listener_pid(listeners, jobs, {PID: command, 9999: command}, UDID)

    def test_hierarchy_rejects_parseable_but_wrong_payloads(self):
        self.assertEqual(readiness.validate_hierarchy(TREE), 2)
        for tree in ({"status": "ok"}, [], dict(TREE, depth=0),
                     dict(TREE, axElement=dict(TREE["axElement"], label="Operator")),
                     dict(TREE, axElement=dict(TREE["axElement"], children=[])),
                     dict(TREE, axElement=dict(TREE["axElement"], children=[None]))):
            with self.subTest(tree=tree), self.assertRaises(RuntimeError):
                readiness.validate_hierarchy(tree)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.proof = readiness.Proof(Path(self.tmp.name))
        self.mode = "ok"
        self.paths = []
        self.release = threading.Event()
        test = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.reply()

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                if self.path == "/viewHierarchy":
                    test.assertEqual(json.loads(body), {"appIds": ["com.apple.springboard"], "excludeKeyboardElements": False})
                self.reply()

            def reply(self):
                test.paths.append(self.path)
                if self.path == "/viewHierarchy" and test.mode == "hang":
                    test.release.wait(2)
                if self.path == "/status":
                    body = b'{"status":"ok"}'
                elif test.mode == "malformed":
                    body = b'not JSON'
                else:
                    body = json.dumps(TREE).encode()
                self.send_response(200)
                self.end_headers()
                try:
                    self.wfile.write(body)
                except BrokenPipeError:
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.proof.state.update(port=self.server.server_port, udid=UDID)
        # Synthetic HTTP transport only: no claim about actual native ownership.
        self.owner = patch.object(self.proof, "ownership")
        self.ownership = self.owner.start()
        self.addCleanup(self.owner.stop)

    def close_server(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def hierarchy(self, timeout=1):
        return self.proof.request("hierarchy", "viewHierarchy", {
            "appIds": ["com.apple.springboard"], "excludeKeyboardElements": False}, timeout=timeout)

    def test_status_and_real_http_hierarchy(self):
        self.assertEqual(json.loads(self.proof.request("status", "status")), {"status": "ok"})
        self.assertEqual(readiness.validate_hierarchy(json.loads(self.hierarchy())), 2)
        self.assertEqual(self.ownership.call_count, 4)
        self.assertTrue((self.proof.root / "hierarchy.json").exists())

    def test_status_ok_hierarchy_hangs_fails_without_retry(self):
        self.mode = "hang"
        self.assertEqual(json.loads(self.proof.request("status", "status")), {"status": "ok"})
        with self.assertRaises((RuntimeError, subprocess.TimeoutExpired)):
            self.hierarchy(timeout=1)
        self.assertEqual(self.paths, ["/status", "/viewHierarchy"])
        self.assertNotIn("ready", self.proof.state)

    def test_status_ok_malformed_hierarchy_fails(self):
        self.mode = "malformed"
        self.proof.request("status", "status")
        with self.assertRaises(json.JSONDecodeError):
            json.loads(self.hierarchy())
        self.assertEqual(self.paths.count("/viewHierarchy"), 1)

    def test_wrong_listener_fails_before_http(self):
        self.ownership.side_effect = RuntimeError("wrong simulator listener")
        with self.assertRaisesRegex(RuntimeError, "wrong simulator"):
            self.proof.request("status", "status")
        self.assertEqual(self.paths, [])

    def test_ownership_time_counts_against_request_deadline(self):
        self.ownership.side_effect = lambda _: time.sleep(0.02)
        with self.assertRaisesRegex(RuntimeError, "deadline expired"):
            self.hierarchy(timeout=0.01)
        self.assertEqual(self.paths, [])


class PrepareTests(unittest.TestCase):
    def test_one_runner_requires_status_and_hierarchy_before_ready(self):
        # Compile/boot/HTTP remain mocked here; this proves orchestration, not
        # simulator readiness. The separate HTTPTests exercise curl itself.
        for response in (TREE, {"status": "ok"}, RuntimeError("hierarchy timeout")):
            with self.subTest(response=response), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                proof = readiness.Proof(root / "proof")
                maestro = root / "maestro"
                (maestro / "lib").mkdir(parents=True)
                with zipfile.ZipFile(maestro / "lib" / "driver.jar", "w") as jar:
                    jar.writestr(readiness.CONFIG, "fixture")
                products = proof.root / "products" / readiness.RESOURCE / "Debug-iphonesimulator"
                products.mkdir(parents=True)
                for name in ("maestro-driver-iosUITests-Runner", "maestro-driver-ios"):
                    (products / f"{name}.zip").touch()

                def run(name, args, **_):
                    if name == "devices-before":
                        return json.dumps({"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
                            dict(name="iPhone 17", isAvailable=True, deviceTypeIdentifier="type")
                        ]}})
                    return UDID if name == "create" else ""

                replies = [json.dumps({"status": "ok"}), "", response if isinstance(response, Exception) else json.dumps(response)]
                with patch.dict(os.environ, MAESTRO_VERSION="2.11.0"), \
                        patch.object(proof, "run", side_effect=run), \
                        patch.object(proof, "apps", side_effect=[{"com.apple.springboard"}, {"com.apple.springboard", APP}]), \
                        patch.object(proof, "request", side_effect=replies), \
                        patch.object(subprocess, "Popen") as popen, \
                        patch.object(readiness.socket, "create_connection"):
                    popen.return_value.pid = PID
                    popen.return_value.poll.return_value = None
                    if response == TREE:
                        proof.prepare(maestro)
                        self.assertTrue(proof.state["ready"])
                    else:
                        with self.assertRaises(RuntimeError):
                            proof.prepare(maestro)
                        self.assertNotIn("ready", proof.state)
                    popen.assert_called_once()
                    self.assertEqual(popen.call_args.kwargs["env"]["LOP_READINESS_GROUP"],
                                     proof.state["groupToken"])
                    self.assertIn("test-without-building", popen.call_args.args[0])


class CleanupTests(unittest.TestCase):
    def test_main_failure_and_cancellation_always_clean_up(self):
        for error in (RuntimeError("bad hierarchy"), SystemExit("terminated")):
            with tempfile.TemporaryDirectory() as tmp, \
                    patch.object(sys, "argv", ["proof", "--out", tmp, "--maestro-dir", tmp]), \
                    patch.object(readiness.Proof, "prepare", side_effect=error) as prepare, \
                    patch.object(readiness.Proof, "cleanup") as cleanup, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(readiness.main(), 1)
                prepare.assert_called_once()
                cleanup.assert_called_once()
                self.assertEqual(json.loads((Path(tmp) / "owner.json").read_text())["result"], "FAIL")

    def test_cleanup_failure_is_not_success(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(sys, "argv", ["proof", "--out", tmp, "--maestro-dir", tmp]), \
                patch.object(readiness.Proof, "prepare"), \
                patch.object(readiness.Proof, "cleanup", side_effect=RuntimeError("delete failed")), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(readiness.main(), 1)
            self.assertEqual(json.loads((Path(tmp) / "owner.json").read_text())["result"], "FAIL")

    def test_exact_owned_group_and_simulator_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            proof = readiness.Proof(Path(tmp))
            proof.state.update(pgid=PID, udid=UDID, config="/owned/config.xctestrun")
            calls = []

            def run(name, args, **_):
                calls.append(args)
                if name == "cleanup-group":
                    return ""
                if name.startswith("cleanup-") and name.endswith("-state"):
                    return json.dumps({"devices": {"runtime": [{"udid": UDID, "state": "Booted"}]}})
                if name == "devices-after":
                    return '{"devices": {}}'
                return ""

            with patch.object(proof, "run", side_effect=run), \
                    patch.object(proof, "group_members", side_effect=[[PID], []]), \
                    patch.object(proof, "group_is_owned", return_value=True), \
                    patch.object(os, "killpg", side_effect=[None, ProcessLookupError()]) as kill:
                proof.cleanup()
                self.assertEqual(kill.call_args_list[0].args, (PID, signal.SIGKILL))
            self.assertIn(["xcrun", "simctl", "shutdown", UDID], calls)
            self.assertIn(["xcrun", "simctl", "delete", UDID], calls)
            self.assertTrue(proof.state["cleanup"]["ok"])

    def test_exited_leader_live_child_and_repeated_fallback(self):
        # Real host processes, not native tools: the launcher has already been
        # reaped, so only the inherited ownership marker can anchor its group.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            proof = readiness.Proof(root / "proof")
            token = secrets.token_hex(32)
            env = dict(proof.env, LOP_READINESS_GROUP=token)
            leader = subprocess.Popen([sys.executable, "-c",
                "import subprocess,sys; p=subprocess.Popen([sys.executable,'-c',"
                "'import time; time.sleep(300)'], stdout=subprocess.DEVNULL, "
                "stderr=subprocess.DEVNULL); print(p.pid, flush=True)"],
                env=env, start_new_session=True, stdout=subprocess.PIPE, text=True)
            sentinel = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"],
                                        env=proof.env, start_new_session=True)
            try:
                child = int(leader.stdout.readline())
                leader.wait(timeout=5)
                leader.stdout.close()
                os.kill(child, 0)
                stale = readiness.Proof(root / "stale")
                stale.state.update(pgid=sentinel.pid, groupToken=token,
                                   config="/owned/config.xctestrun")
                with self.assertRaisesRegex(RuntimeError, "unowned process"):
                    stale.cleanup()
                self.assertFalse(stale.state["cleanup"]["ok"])
                self.assertIsNone(sentinel.poll())
                print("stale group: refused; unrelated sentinel alive; cleanup.ok=false", flush=True)
                proof.state.update(pgid=leader.pid, groupToken=token,
                                   config="/owned/config.xctestrun", ready=False, result="FAIL")
                proof.save()
                for attempt in (1, 2):
                    # Reload exactly as the workflow's --cleanup fallback does.
                    result = subprocess.run([sys.executable, str(Path(readiness.__file__)),
                                             "--out", str(proof.root), "--cleanup"],
                                            env=proof.env, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    fallback = readiness.Proof(proof.root)
                    self.assertTrue(fallback.state["cleanup"]["ok"])
                    self.assertFalse(fallback.state["ready"])
                    self.assertEqual(fallback.state["result"], "FAIL")
                    self.assertIsNone(sentinel.poll())
                    with self.assertRaises(ProcessLookupError):
                        os.killpg(leader.pid, 0)
                    print(f"cleanup {attempt}: owned group absent; unrelated sentinel alive; "
                          "cleanup.ok=true; ready=false; result=FAIL", flush=True)
            finally:
                # Exact groups created by this test only, even on the old-code
                # failing control. Never leave the negative control's child up.
                for process in (leader, sentinel):
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    try:
                        os.killpg(leader.pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.01)
                else:
                    self.fail("test-owned group survived exact rig teardown")

    def test_reused_pid_is_never_killed(self):
        with tempfile.TemporaryDirectory() as tmp:
            proof = readiness.Proof(Path(tmp))
            proof.state.update(pgid=PID, config="/owned/config.xctestrun")
            proof.state["groupToken"] = "original-owner-nonce"
            with patch.object(proof, "group_members", return_value=[PID]), \
                    patch.object(subprocess, "run", return_value=subprocess.CompletedProcess(
                        [], 0, stdout="somebody else's process LOP_READINESS_GROUP=other-nonce")), \
                    patch.object(os, "killpg", side_effect=ProcessLookupError()) as kill, \
                    self.assertRaisesRegex(RuntimeError, "unowned process"):
                proof.cleanup()
            self.assertEqual(kill.call_args_list[0].args, (PID, 0))
            self.assertFalse(proof.state["cleanup"]["ok"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
