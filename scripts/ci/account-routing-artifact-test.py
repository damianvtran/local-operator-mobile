"""Offline synthetic-archive controls, never an artifact download/SDK test."""
import importlib.util
import os
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("proof_artifact", Path(__file__).with_name("account-routing-artifact.py"))
assert spec and spec.loader
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


def macho(platform=7, cpu=0x0100000C):
    return struct.pack("<8I", 0xFEEDFACF, cpu, 0, 2, 1, 24, 0, 0) + struct.pack("<6I", 0x32, 24, platform, 0, 0, 0)


class ArtifactControls(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("LOCAL_OPERATOR_SCRATCHPAD") or os.environ.get("RUNNER_TEMP")
        if not root:
            raise RuntimeError("supply owned scratch, not default /tmp")
        self.temp = tempfile.TemporaryDirectory(prefix="native-proof-unit-", dir=root)
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def zip(self, entries):
        path = self.root / "input.zip"
        with zipfile.ZipFile(path, "w") as archive:
            for name, content in entries:
                archive.writestr(name, content)
        return path

    def test_actual_binary_plist_js_identity(self):
        info = plistlib.dumps({"CFBundleExecutable": "Runner", "CFBundleIdentifier": "invalid.example.proof", "CFBundleShortVersionString": "1.0", "CFBundleVersion": "1"}, fmt=plistlib.FMT_BINARY)
        source = self.zip([("Proof.app/Info.plist", info), ("Proof.app/Runner", macho()), ("Proof.app/assets/actual.jsbundle", b"owned-marker")])
        app = artifact.extract(source, self.root / "owned")
        result = artifact.inspect(app, ["owned-marker"])
        self.assertEqual(result["architectures"], ["arm64"])
        self.assertEqual(result["machO"][0]["platform_code"], 7)
        self.assertEqual(result["jsAssets"][0]["path"], "assets/actual.jsbundle")
        self.assertTrue(result["jsAssets"][0]["marker_matches"]["owned-marker"])
        self.assertTrue((app / "Runner").stat().st_mode & 0o100)

    def test_device_binary_not_simulator(self):
        with self.assertRaisesRegex(ValueError, "SIMULATOR"):
            artifact.macho_facts(macho(platform=2))

    def test_unknown_architecture_and_truncated_command(self):
        for content in (macho(cpu=1), macho()[:35]):
            with self.assertRaises(ValueError):
                artifact.macho_facts(content)

    def test_traversal_refused_before_destination_exists(self):
        path = self.zip([("Good.app/file", b"safe"), ("../escape", b"bad")])
        destination = self.root / "out"
        with self.assertRaises(ValueError):
            artifact.extract(path, destination)
        self.assertFalse(destination.exists())
        self.assertFalse((self.root / "escape").exists())

    def test_absolute_backslash_dot_and_drive_names(self):
        for index, name in enumerate(("/root", "a\\b", "a/./b", "C:/bad")):
            with self.subTest(name=name):
                path = self.root / f"bad{index}.zip"
                with zipfile.ZipFile(path, "w") as archive:
                    archive.writestr(name, b"bad")
                with self.assertRaises(ValueError):
                    artifact.extract(path, self.root / f"out{index}")

    def test_case_collision_and_symlink(self):
        for index, entries in enumerate((["App/A", "App/a"], ["App/link"])):
            path = self.root / f"case{index}.zip"
            with zipfile.ZipFile(path, "w") as archive:
                for name in entries:
                    entry = zipfile.ZipInfo(name)
                    if index:
                        entry.create_system = 3
                        entry.external_attr = 0o120777 << 16
                    archive.writestr(entry, b"target")
            with self.assertRaises(ValueError):
                artifact.extract(path, self.root / f"caseout{index}")

    def test_existing_destination_is_never_overwritten(self):
        source = self.zip([])
        destination = self.root / "existing"
        destination.mkdir()
        with self.assertRaises(ValueError):
            artifact.extract(source, destination)


if __name__ == "__main__":
    unittest.main()
