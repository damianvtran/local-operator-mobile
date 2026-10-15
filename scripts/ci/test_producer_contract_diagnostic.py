"""Prepared fixture SOURCE ONLY: not run under the implementation allocation.

Synthetic metadata/children are not SDK/native evidence. Future tests need an
explicit cheap execution allocation; they do not prebuild or install anything.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("diagnostic", Path(__file__).with_name("producer-contract-diagnostic.py"))
diag = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diag)
ROOT = Path(__file__).resolve().parents[2]


def pbx(script="export ENTRY_FILE=example\nexport BUNDLE_COMMAND=export:embed"):
    return {"objects": {"phase": {"isa": "PBXShellScriptBuildPhase", "name": "Bundle React Native code and images", "shellScript": script}}}


def payload():
    # Deliberately synthetic hashes: validation proof, NOT recorded SDK bytes.
    return {"schema": 1, "kind": diag.KIND, "nativeCompiled": False, "status": "SOURCE_DIAGNOSTIC_ONLY", "code": None,
            "checkout": "a" * 40,
            "sdk": {"schema": 1, "kind": "installed-sdk-metadata-only",
                    "packages": [{"name": name, "version": version, "path": f"node_modules/{name}/package.json", "sha256": "b" * 64} for name, version in diag.VERSIONS.items()],
                    "sources": [{"role": role, "path": "node_modules/expo/scripts/resolveAppEntry.js" if role == "resolve-entry" else f"node_modules/example/{role}.js", "bytes": 1, "sha256": "c" * 64} for role in sorted(diag.ROLES)]},
            "phase": diag.phase_facts(pbx()),
            "entry": {"kind": "SDK_RESOLVED_ONLY", "path": "node_modules/expo-router/entry.js", "bytes": 1, "sha256": "d" * 64}}


class GuardTests(unittest.TestCase):
    def test_only_explicit_manual_opt_in_is_accepted(self):
        diag.input_guard("workflow_dispatch", "contract-only")
        for event, mode in [("push", "contract-only"), ("pull_request", "contract-only"), (None, None),
                            ("workflow_dispatch", "native"), ("workflow_dispatch", ""),
                            ("workflow_dispatch", "unknown"), ("workflow_dispatch", True)]:
            with self.subTest(event=event, mode=mode), self.assertRaises(diag.Stop):
                diag.input_guard(event, mode)

    def assert_signed_job_contracts(self, text):
        # Guard order is job-specific: internal also needs native-change and
        # credential readiness. Counting a shared literal prefix mistakes that
        # stronger valid gate for a missing guard, and comments prove nothing.
        expected = {
            "credentials": "github.event_name == 'push' && github.ref == 'refs/heads/main'",
            "internal": "needs.changes.outputs.native == 'true' && github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.credentials.outputs.all_present == 'true'",
        }
        lines = text.splitlines()
        for job, condition in expected.items():
            header = f"  {job}:"
            self.assertEqual(lines.count(header), 1)
            body = []
            for line in lines[lines.index(header) + 1:]:
                if line.strip() and not line.startswith("    "):
                    break
                body.append(line)
            self.assertEqual([line for line in body if line.startswith("    if:")], [f"    if: {condition}"])
            self.assertIn("    environment: release", body)
            if job == "internal":
                self.assertEqual([line for line in body if line.startswith("    needs:")],
                                 ["    needs: [changes, ios, credentials]"])

    def test_signed_job_predicate_weakening_is_rejected_in_each_job(self):
        text = (ROOT / ".github/workflows/ios.yml").read_text()
        self.assert_signed_job_contracts(text)
        guards = {
            "credentials": "github.event_name == 'push' && github.ref == 'refs/heads/main'",
            "internal": "needs.changes.outputs.native == 'true' && github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.credentials.outputs.all_present == 'true'",
        }
        for job, guard in guards.items():
            predicates = ["github.event_name == 'push'", "github.ref == 'refs/heads/main'"]
            if job == "internal":
                predicates += ["needs.changes.outputs.native == 'true'", "needs.credentials.outputs.all_present == 'true'"]
            for predicate in predicates:
                with self.subTest(job=job, predicate=predicate):
                    original = f"    if: {guard}"
                    replacement = f"    if: {guard.replace(predicate, 'true', 1)}\n    # if: {guard}"
                    self.assertIn(original, text)
                    weakened = text.replace(original, replacement, 1)
                    with self.assertRaises(AssertionError):
                        self.assert_signed_job_contracts(weakened)
        # The dependency edge is a separate contract, not just words in if:.
        weakened = text.replace("    needs: [changes, ios, credentials]", "    needs: [changes, ios]", 1)
        self.assertNotEqual(weakened, text)
        with self.assertRaises(AssertionError):
            self.assert_signed_job_contracts(weakened)

    def test_workflow_keeps_normal_and_signed_paths_and_gates_upload(self):
        text = (ROOT / ".github/workflows/ios.yml").read_text()
        self.assertIn("default: native", text)
        self.assertIn("if: github.event_name != 'workflow_dispatch' || inputs.producer_mode == 'native'", text)
        self.assertIn("if: github.event_name == 'workflow_dispatch' && inputs.producer_mode != 'native'", text)
        self.assert_signed_job_contracts(text)
        contract = text.split("  producer-contract:\n", 1)[1].split("  changes:\n", 1)[0]
        self.assertIn("timeout-minutes: 10", contract)
        self.assertIn("steps.publication.outputs.safe == 'true'", contract)
        self.assertIn("persist-credentials: false", contract)
        self.assertNotIn("DIAGNOSTIC_MODE: ${{ inputs.producer_mode }}", contract)
        self.assertIn("inputs.producer_mode == 'contract-only' && 'contract-only' || 'invalid'", contract)
        self.assertIn("producer-contract-diagnostic-only", contract)
        for forbidden in ("xcodebuild", "simctl", "pod install", "setup-java", "source-identity.json", "ios-simulator", "secrets."):
            self.assertNotIn(forbidden, contract)
        native = text.split("  ios:\n", 1)[1]
        self.assertIn("CODE_SIGNING_ALLOWED=NO", native)
        self.assertIn("needs: changes", native)


class PhaseAndPathTests(unittest.TestCase):
    def test_guard_patterns_are_observations_not_precedence_proof(self):
        script = 'if [[ -z "$ENTRY_FILE" ]]; then\nexport ENTRY_FILE=example\nfi\nif [[ -z "${CLI_PATH}" ]]; then\nexport CLI_PATH=example\nfi'
        facts = diag.phase_facts(pbx(script))
        self.assertTrue(facts["emptyGuardPatternSeen"]["ENTRY_FILE"])
        self.assertTrue(facts["emptyGuardPatternSeen"]["CLI_PATH"])
        self.assertFalse(facts["emptyGuardPatternSeen"]["BUNDLE_COMMAND"])
        self.assertEqual(facts["precedence"], "UNKNOWN")

    def test_actual_phase_is_hash_and_typed_unknown_not_raw_shell(self):
        script = 'export PRIVATE_KEY="synthetic-private-value"\nsource .xcode.env\nexport ENTRY_FILE=$(dynamic-command)\nexport CLI_PATH=private/path'
        facts = diag.phase_facts(pbx(script))
        self.assertEqual(facts["precedence"], "UNKNOWN")
        self.assertEqual(facts["assignments"]["ENTRY_FILE"], 1)
        published = json.dumps(facts)
        for value in ("PRIVATE_KEY", "synthetic-private-value", "dynamic-command", "private/path", ".xcode.env"):
            self.assertNotIn(value, published)
        self.assertEqual(facts["sha256"], diag.digest(script.encode()))

    def test_zero_many_and_malformed_bundle_phases_stop(self):
        for value in ({"objects": {}}, {"objects": []}, pbx("")):
            with self.subTest(value=value), self.assertRaises(diag.Stop):
                diag.phase_facts(value)
        value = pbx()
        value["objects"]["other"] = value["objects"]["phase"].copy()
        with self.assertRaises(diag.Stop):
            diag.phase_facts(value)

    def test_zero_many_projects_and_symlink_escape_stop(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            with self.assertRaises(diag.Stop):
                diag.project_file(root)
            first = root / "ios/A.xcodeproj/project.pbxproj"
            first.parent.mkdir(parents=True)
            first.write_text("synthetic")
            self.assertEqual(diag.project_file(root), first)
            second = root / "ios/B.xcodeproj/project.pbxproj"
            second.parent.mkdir()
            second.write_text("synthetic")
            with self.assertRaises(diag.Stop):
                diag.project_file(root)
            external = Path(outside) / "entry.js"
            external.write_text("NEVER EXECUTED")
            (root / "escaped.js").symlink_to(external)
            for path in (external, root / "escaped.js"):
                with self.assertRaises(diag.Stop):
                    diag.file_info(root, path)
            entry = root / "entry.js"
            entry.write_text("safe synthetic fixture")
            self.assertEqual(diag.file_info(root, entry)["sha256"], diag.digest(entry.read_bytes()))
            with self.assertRaises(diag.Stop):
                diag.file_info(root, entry, cap=1)


class PublicationTests(unittest.TestCase):
    def test_legacy_jdk_stop_cannot_be_promoted_to_an_execution_stage(self):
        # The same old body represented missing-tool, version-command failure,
        # non17, and late prebuild markers at P. Nulls/code cannot distinguish
        # those histories; accepting old schema is not reclassifying old E.
        legacy = diag.blocked("JDK17_REQUIRED")
        diag.validate_public(legacy)
        self.assertTrue(all(legacy[key] is None for key in ("checkout", "sdk", "phase", "entry")))
        self.assertNotIn("stage", legacy)
        self.assertNotEqual(legacy["code"], "PREBUILD_JAVA_HOME_ERROR")
        for stage in ("early-missing-tool", "early-version-command-failed", "early-non17", "late-prebuild"):
            with self.subTest(stage=stage), self.assertRaises(diag.Stop):
                diag.validate_public(dict(legacy, stage=stage))

    def test_positive_publication_and_hash_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = payload()
            diag.promote(root, value)
            self.assertEqual(diag.verify_public(root), value)
            self.assertEqual({p.name for p in (root / "public").iterdir()}, {"diagnostic.json", "sha256.json"})

    def test_extra_private_fields_wrong_versions_and_oversized_data_rejected(self):
        mutations = []
        extra = payload(); extra["rawPhase"] = "synthetic secret"; mutations.append(extra)
        extra = payload(); extra["phase"]["script"] = "synthetic secret"; mutations.append(extra)
        extra = payload(); extra["sdk"]["packages"][0]["version"] = "wrong"; mutations.append(extra)
        extra = payload(); extra["entry"]["path"] = "/private/entry.js"; mutations.append(extra)
        extra = payload(); extra["entry"]["path"] = "../entry.js"; mutations.append(extra)
        extra = payload(); extra["nativeCompiled"] = True; mutations.append(extra)
        for value in mutations:
            with self.subTest(value=value), self.assertRaises(diag.Stop):
                diag.validate_public(value)
        with tempfile.TemporaryDirectory() as directory, patch.object(diag, "LIMIT", 1), self.assertRaises(diag.Stop):
            diag.promote(Path(directory), payload())

    def test_tampered_publication_is_withheld_before_upload_admission(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            diag.promote(root, payload())
            (root / "public/diagnostic.json").write_text('{"raw":"synthetic-private-value"}')
            output = root / "action-output"
            with patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}):
                diag.finalize(root)
            self.assertEqual(output.read_text(), "safe=true\n")
            value = diag.verify_public(root)
            self.assertEqual(value["status"], "BLOCKED")
            self.assertNotIn("synthetic-private-value", (root / "public/STOP.json").read_text())
            self.assertTrue((root / "withheld-public/diagnostic.json").exists())

    def test_symlink_publication_never_uploads_external_data(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            external = Path(outside)
            (external / "STOP.json").write_text("synthetic-private-value")
            (root / "public").symlink_to(external, target_is_directory=True)
            with patch.dict(os.environ, {"GITHUB_OUTPUT": str(root / "output")}):
                diag.finalize(root)
            self.assertFalse((root / "public").is_symlink())
            self.assertEqual((external / "STOP.json").read_text(), "synthetic-private-value")
            self.assertEqual(diag.verify_public(root)["status"], "BLOCKED")


class SyntheticCollectTests(unittest.TestCase):
    def assert_resolver_invocation(self, args, root):
        self.assertEqual(args, ["node", "--eval", "require(process.argv[4]);", str(root), "ios", "absolute",
                                str(root / "node_modules/expo/scripts/resolveAppEntry.js")])

    def test_argument_contract_rejects_old_direct_shifted_and_extra_vectors(self):
        root = Path("/synthetic/mobile91-root")
        script = str(root / "node_modules/expo/scripts/resolveAppEntry.js")
        correct = ["node", "--eval", "require(process.argv[4]);", str(root), "ios", "absolute", script]
        self.assert_resolver_invocation(correct, root)
        for wrong in (["node", script, str(root), "ios", "absolute"],
                      ["node", "--eval", "require(process.argv[4]);", script, str(root), "ios", "absolute"],
                      correct + ["unexpected"]):
            with self.subTest(argv=wrong), self.assertRaises(AssertionError):
                self.assert_resolver_invocation(wrong, root)

    def test_resolver_requires_pinned_measured_expo_script_not_arbitrary_loads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            package = root / "node_modules/expo/package.json"
            script = package.parent / "scripts/resolveAppEntry.js"
            script.parent.mkdir(parents=True)
            package.write_text('{"name":"expo","version":"57.0.26"}')
            script.write_text("synthetic metadata only; never executed")
            sdk = {"packages": [{"name": "expo", "version": "57.0.26", **diag.file_info(root, str(package))}],
                   "sources": [{"role": "resolve-entry", **diag.file_info(root, str(script))}]}
            self.assert_resolver_invocation(diag.resolver_argv(root, sdk), root)
            for field in ("version", "package_hash", "script_hash", "duplicate_role", "other_script"):
                bad = copy.deepcopy(sdk)
                if field == "version":
                    bad["packages"][0]["version"] = "0.0.0"
                elif field == "package_hash":
                    bad["packages"][0]["sha256"] = "0" * 64
                elif field == "script_hash":
                    bad["sources"][0]["sha256"] = "0" * 64
                elif field == "duplicate_role":
                    bad["sources"].append(copy.deepcopy(bad["sources"][0]))
                else:
                    other = script.with_name("other.js")
                    other.write_text("must not load arbitrary module")
                    bad["sources"][0].update(diag.file_info(root, str(other)))
                with self.subTest(field=field), self.assertRaises(diag.Stop):
                    diag.resolver_argv(root, bad)
            # Even a re-hashed role cannot turn the expected SDK filename into
            # a symlink load outside its actual package root.
            outside = root / "node_modules/other.js"
            outside.write_text("never loaded")
            script.unlink()
            script.symlink_to(outside)
            escaped = copy.deepcopy(sdk)
            escaped["sources"][0].update(diag.file_info(root, str(script)))
            with self.assertRaises(diag.Stop):
                diag.resolver_argv(root, escaped)

    def test_synthetic_ios_collection_with_no_java_lookup_or_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            sdk = copy.deepcopy(payload()["sdk"])
            for package in sdk["packages"]:
                file = root / package["path"]
                file.parent.mkdir(parents=True, exist_ok=True)
                raw = json.dumps({"name": package["name"], "version": package["version"]}).encode()
                file.write_bytes(raw)
                package["sha256"] = diag.digest(raw)
            for source in sdk["sources"]:
                file = root / source["path"]
                file.parent.mkdir(parents=True, exist_ok=True)
                raw = b"synthetic fixture, never imported or executed"
                file.write_bytes(raw)
                source.update(bytes=len(raw), sha256=diag.digest(raw))
            entry = root / "app/entry.ts"
            entry.parent.mkdir()
            entry.write_text("synthetic application entry, never executed")
            calls = []
            assert_resolver_invocation = self.assert_resolver_invocation
            class Fake:
                def run(self, args, **kwargs):
                    calls.append(args)
                    if args == ["node", "--version"]:
                        return b"v24.1.0", b""
                    if args == ["pnpm", "--version"]:
                        return b"12.6.0", b""
                    if args[:2] == ["git", "diff"]:
                        return b"", b""
                    if args[:2] == ["git", "rev-parse"]:
                        return ("a" * 40).encode(), b""
                    if args[:2] == ["pnpm", "install"]:
                        return b"", b""
                    if args[:2] == ["node", "scripts/ci/producer-contract-sdk.cjs"]:
                        return json.dumps(sdk).encode(), b""
                    if args[:3] == ["pnpm", "exec", "expo"]:
                        project = root / "ios/Fixture.xcodeproj/project.pbxproj"
                        project.parent.mkdir(parents=True)
                        project.write_text("synthetic PBX, parsed only by the fake below")
                        return b"", b""
                    if args[:2] == ["node", "--eval"]:
                        assert_resolver_invocation(args, root)
                        return str(entry).encode(), b""
                    if args[0] == "plutil":
                        return json.dumps(pbx()).encode(), b""
                    raise AssertionError("unexpected command in synthetic source fixture")
            # This fixture proves the collector itself does not require/invoke
            # Java; Fake prebuild success is NOT real Expo-without-Java proof.
            with patch.object(diag.shutil, "which", side_effect=lambda name: None if name in {"java", "javac"} else "/synthetic/tool") as which:
                value = diag.collect(root, Fake())
            self.assertNotIn(unittest.mock.call("java"), which.call_args_list)
            self.assertNotIn(unittest.mock.call("javac"), which.call_args_list)
            self.assertTrue(all(args[0] not in {"java", "javac"} for args in calls))
            diag.validate_public(value)
            self.assertFalse(value["nativeCompiled"])
            self.assertEqual(value["entry"]["kind"], "SDK_RESOLVED_ONLY")
            self.assertEqual(value["phase"]["precedence"], "UNKNOWN")
            resolver_path = root / next(source["path"] for source in sdk["sources"] if source["role"] == "resolve-entry")
            expected_resolver = ["node", "--eval", "require(process.argv[4]);", str(root), "ios", "absolute", str(resolver_path)]
            self.assertEqual(calls.count(expected_resolver), 1)
            self.assertLess(next(i for i, args in enumerate(calls) if args[:3] == ["pnpm", "exec", "expo"]),
                            next(i for i, args in enumerate(calls) if args == expected_resolver))


class ResourceAndPrerequisiteTests(unittest.TestCase):
    def test_missing_tools_stop_before_dependency_install(self):
        for missing, code in [("node", "NODE_REQUIRED"), ("pnpm", "PNPM_REQUIRED"), ("plutil", "PLUTIL_REQUIRED")]:
            with self.subTest(missing=missing), patch.object(diag.shutil, "which", side_effect=lambda name: None if name == missing else "/synthetic/tool"):
                runner = unittest.mock.Mock()
                with self.assertRaisesRegex(diag.Stop, code):
                    diag.collect(ROOT, runner)
                runner.run.assert_not_called()

    def test_prebuild_failures_are_typed_and_output_not_retained(self):
        for message, expected in [("Android SDK missing", "SDK_REQUIRED"), ("JAVA_HOME missing", "PREBUILD_JAVA_HOME_ERROR"),
                                  ("xcrun missing", "XCODE_PREREQUISITE"), ("synthetic-private-value", "PREBUILD_FAILED")]:
            with tempfile.TemporaryDirectory() as directory:
                runner = diag.Runner(Path(directory))
                script = f"import sys;sys.stderr.write({message!r});sys.exit(1)"
                with self.assertRaisesRegex(diag.Stop, expected):
                    runner.run([sys.executable, "-c", script], failure="PREBUILD_FAILED")
                for path in Path(directory).iterdir():
                    self.assertNotIn(message, path.read_text())

    def test_java_home_marker_is_classified_only_at_failed_prebuild_stage(self):
        for failure, expected in [("PREBUILD_FAILED", "PREBUILD_JAVA_HOME_ERROR"),
                                  ("ENTRY_RESOLUTION_FAILED", "ENTRY_RESOLUTION_FAILED"),
                                  ("COMMAND_FAILED", "COMMAND_FAILED")]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                runner = diag.Runner(Path(directory))
                # A marker from a different failed command must not fabricate a
                # prebuild stage; no environment value or raw text is published.
                with self.assertRaisesRegex(diag.Stop, expected):
                    runner.run([sys.executable, "-c", "import sys;sys.stderr.write('JAVA_HOME synthetic-private-value');sys.exit(1)"], failure=failure)
                self.assertTrue(all("synthetic-private-value" not in path.read_text() for path in Path(directory).iterdir()))

    def test_partial_output_no_eof_and_noisy_child_are_bounded(self):
        for script, timeout, cap, code in [("import os,time;os.write(1,b'x');time.sleep(10)", .15, 128, "TIMEOUT"),
                                          ("import os,time;os.write(1,b'x'*4096);time.sleep(10)", 1, 128, "BYTE_BUDGET")]:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                runner = diag.Runner(Path(directory))
                with self.assertRaisesRegex(diag.Stop, code):
                    runner.run([sys.executable, "-c", script], timeout=timeout, cap=cap)
        with tempfile.TemporaryDirectory() as directory, patch.object(diag, "RAW_LIMIT", 1):
            runner = diag.Runner(Path(directory))
            with self.assertRaisesRegex(diag.Stop, "BYTE_BUDGET"):
                runner.run([sys.executable, "-c", "print('oversized')"])

    def test_resolution_command_failure_is_sanitized(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = diag.Runner(Path(directory))
            with self.assertRaisesRegex(diag.Stop, "ENTRY_RESOLUTION_FAILED"):
                runner.run([sys.executable, "-c", "raise RuntimeError('synthetic-private-value')"], failure="ENTRY_RESOLUTION_FAILED")
            self.assertTrue(all("synthetic-private-value" not in p.read_text() for p in Path(directory).iterdir()))


if __name__ == "__main__":
    unittest.main()
