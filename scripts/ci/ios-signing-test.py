"""Synthetic signing failures; never invoke Apple APIs, security or codesign."""
import copy
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import subprocess
import tempfile
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ios_signing", pathlib.Path(__file__).with_name("ios-signing.py"))
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)
TEAM = "SYNTHETIC1"
BUNDLE = "com.example.synthetic"
NAME = "Synthetic App Store"
CERT = b"synthetic distribution certificate"
UUID = "12345678-1234-1234-1234-123456789abc"


def valid_profile():
    return {
        "Name": NAME, "UUID": UUID, "TeamIdentifier": [TEAM],
        "ExpirationDate": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(days=30),
        "DeveloperCertificates": [CERT],
        "Entitlements": {
            "application-identifier": f"{TEAM}.{BUNDLE}",
            "com.apple.developer.team-identifier": TEAM,
            "aps-environment": "production", "get-task-allow": False,
        },
    }


class SigningTests(unittest.TestCase):
    def test_profile_validation_negative_controls(self):
        signing.validate_profile(valid_profile(), TEAM, BUNDLE, NAME)
        for change in [
            {"Name": "wrong"}, {"TeamIdentifier": ["wrong"]},
            {"ProvisionedDevices": ["synthetic"]}, {"ProvisionsAllDevices": True},
            {"ExpirationDate": datetime.datetime(2000, 1, 1)}, {"UUID": "../../escape"},
        ]:
            with self.subTest(change=list(change)):
                candidate = valid_profile()
                candidate.update(change)
                with self.assertRaises(signing.SigningError):
                    signing.validate_profile(candidate, TEAM, BUNDLE, NAME)
        for key, value in [("get-task-allow", True), ("aps-environment", "development"), ("application-identifier", "wrong")]:
            candidate = valid_profile()
            candidate["Entitlements"][key] = value
            with self.assertRaises(signing.SigningError):
                signing.validate_profile(candidate, TEAM, BUNDLE, NAME)

    def test_export_is_manual_and_cannot_upload_or_change_build_number(self):
        options = signing.export_options(TEAM, BUNDLE, NAME)
        self.assertEqual(options["signingStyle"], "manual")
        self.assertEqual(options["signingCertificate"], "Apple Distribution")
        self.assertEqual(options["provisioningProfiles"], {BUNDLE: NAME})
        self.assertEqual(options["destination"], "export")
        self.assertFalse(options["manageAppVersionAndBuildNumber"])

    def test_ipa_entitlements_fail_closed(self):
        entitlements = valid_profile()["Entitlements"]
        signing.validate_entitlements(entitlements, TEAM, BUNDLE)
        for key in entitlements:
            candidate = copy.deepcopy(entitlements)
            del candidate[key]
            with self.assertRaises(signing.SigningError):
                signing.validate_entitlements(candidate, TEAM, BUNDLE)

    def test_subprocess_errors_never_include_secret_arguments(self):
        secret = "synthetic-password-do-not-log"
        with patch.object(signing.subprocess, "run", return_value=subprocess.CompletedProcess([], 7, b"", secret.encode())):
            with self.assertRaises(signing.SigningError) as caught:
                signing.run(["security", "-p", secret])
            self.assertNotIn(secret, str(caught.exception))

    def test_prepare_imports_identity_and_sets_key_partition_without_real_security_calls(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            commands = []

            def fake_run(args):
                commands.append(args)
                if args[1] in ["list-keychains", "default-keychain"] and "-s" not in args:
                    return b'"original.keychain-db"'
                if args[1] == "find-identity":
                    return b'1) 1234567890123456789012345678901234567890 "Apple Distribution: Synthetic"'
                return b""

            env = {"APPLE_DIST_CERT_P12_BASE64": "c3ludGhldGlj\n", "APPLE_ASC_PRIVATE_KEY_BASE64": "c3ludGhldGlj", "APPLE_DIST_CERT_PASSWORD": "synthetic-passphrase"}
            with patch.dict(os.environ, env), patch.object(signing, "run", side_effect=fake_run):
                signing.prepare(directory)
            self.assertEqual((directory / "distribution.p12").read_bytes(), b"synthetic")
            self.assertEqual((directory / "asc-api-key.p8").read_bytes(), b"synthetic")
            self.assertTrue(any(args[1] == "set-key-partition-list" for args in commands))
            self.assertTrue(any(args[1] == "import" for args in commands))
            self.assertEqual(json.loads((directory / "state.json").read_text())["default"], ["original.keychain-db"])

    def test_profile_install_checks_certificate_and_cleanup_restores_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            directory = root / "lo-ios-signing.synthetic"
            directory.mkdir()
            (directory / "bundle-id.txt").write_text(BUNDLE)
            (directory / "distribution.mobileprovision").write_bytes(b"synthetic cms")
            (directory / "distribution.p12").write_bytes(b"synthetic secret")
            (directory / "asc-api-key.p8").write_bytes(b"synthetic secret")
            (directory / "distribution.keychain-db").touch()
            (directory / "identities.json").write_text(json.dumps([hashlib.sha1(CERT).hexdigest().upper()]))
            (directory / "state.json").write_text(json.dumps({"search": ["original.keychain-db"], "default": ["original.keychain-db"], "profiles": []}))
            env = {"APPLE_TEAM_ID": TEAM, "LO_IOS_PROFILE_NAME": NAME}
            with patch.dict(os.environ, env), patch.object(signing.pathlib.Path, "home", return_value=root), patch.object(signing, "run", return_value=plistlib.dumps(valid_profile())):
                signing.profile(directory)
            state = json.loads((directory / "state.json").read_text())
            self.assertEqual(len(state["profiles"]), 2)
            self.assertTrue(all(pathlib.Path(p).exists() for p in state["profiles"]))
            options = plistlib.loads((directory / "ExportOptions.plist").read_bytes())
            self.assertEqual(options["provisioningProfiles"], {BUNDLE: NAME})
            # Failed keychain restoration must not strand credential files.
            with patch.object(signing, "run", side_effect=signing.SigningError("synthetic restore failure")) as mocked:
                with self.assertRaises(signing.SigningError):
                    signing.cleanup(directory)
            self.assertEqual(mocked.call_count, 3)
            self.assertFalse(directory.exists())
            self.assertTrue(all(not pathlib.Path(p).exists() for p in state["profiles"]))

    def test_profile_rejects_a_certificate_not_in_the_imported_keychain(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            (directory / "bundle-id.txt").write_text(BUNDLE)
            (directory / "identities.json").write_text(json.dumps(["0" * 40]))
            with patch.dict(os.environ, {"APPLE_TEAM_ID": TEAM, "LO_IOS_PROFILE_NAME": NAME}), patch.object(signing, "run", return_value=plistlib.dumps(valid_profile())):
                with self.assertRaisesRegex(signing.SigningError, "imported Distribution"):
                    signing.profile(directory)

    def test_exported_ipa_verifier_checks_signature_profile_and_entitlements(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            directory = root / "lo-ios-signing.synthetic"
            directory.mkdir()
            (root / "ipa").mkdir()
            (root / "ipa" / "synthetic.ipa").touch()
            app = directory / "verified" / "Payload" / "Synthetic.app"
            app.mkdir(parents=True)
            (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": BUNDLE, "ITSAppUsesNonExemptEncryption": False}))
            (directory / "bundle-id.txt").write_text(BUNDLE)
            (directory / "profile-uuid.txt").write_text(UUID)
            entitlements = valid_profile()["Entitlements"]

            def fake_run(args):
                if args[:3] == ["security", "cms", "-D"]:
                    return plistlib.dumps(valid_profile())
                if "--extract-certificates" in args:
                    raise AssertionError("separate certificate prefix is parsed as a code path")
                if any(arg.startswith("--extract-certificates=") for arg in args):
                    (directory / "signing-certificate-0").write_bytes(CERT)
                if "--entitlements" in args:
                    return plistlib.dumps(entitlements)
                return b""

            display = subprocess.CompletedProcess([], 0, b"", f"Authority=Apple Distribution: Synthetic\nTeamIdentifier={TEAM}\n".encode())
            env = {"RUNNER_TEMP": str(root), "APPLE_TEAM_ID": TEAM, "LO_IOS_PROFILE_NAME": NAME}
            with patch.dict(os.environ, env), patch.object(signing, "run", side_effect=fake_run), patch.object(signing.subprocess, "run", return_value=display):
                signing.verify(directory)
                entitlements["get-task-allow"] = True
                with self.assertRaisesRegex(signing.SigningError, "entitlement"):
                    signing.verify(directory)

    @unittest.skipUnless(sys.platform == "darwin", "real codesign argument shapes require Darwin")
    def test_real_codesign_shapes_on_signed_system_app(self):
        # Apple-signed OS binary, not a fixture we sign or mutate. This proves
        # the verifier's CLI syntax, not a Distribution identity or IPA profile.
        app = "/System/Applications/Calculator.app"
        self.assertTrue(pathlib.Path(app).is_dir())
        root = os.environ.get("LOCAL_OPERATOR_SCRATCHPAD") or os.environ.get("RUNNER_TEMP")
        with tempfile.TemporaryDirectory(prefix="codesign-shapes-", dir=root) as temporary:
            prefix = str(pathlib.Path(temporary) / "cert-")
            wrong = subprocess.run(["codesign", "-d", "--extract-certificates", prefix, app], capture_output=True)
            self.assertNotEqual(wrong.returncode, 0)
            signing.run(["codesign", "--verify", "--deep", "--strict", app])
            display = subprocess.run(["codesign", "-dv", "--verbose=4", app], capture_output=True)
            self.assertEqual(display.returncode, 0)
            self.assertIn(b"Authority=", display.stderr)
            self.assertIn(b"TeamIdentifier=", display.stderr)
            signing.run(["codesign", "-d", f"--extract-certificates={prefix}", app])
            self.assertTrue(pathlib.Path(prefix + "0").is_file())
            entitlements = plistlib.loads(signing.run(["codesign", "-d", "--entitlements", "-", "--xml", app]))
            self.assertIsInstance(entitlements, dict)

    def test_cleanup_rejects_a_nonowned_directory(self):
        with patch.dict(os.environ, {"LO_IOS_SIGNING_DIR": "/", "RUNNER_TEMP": "/synthetic"}), patch.object(signing.sys, "argv", ["ios-signing.py", "cleanup"]):
            with self.assertRaises(signing.SigningError):
                signing.main()


if __name__ == "__main__":
    unittest.main()
