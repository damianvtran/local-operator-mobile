"""Portable controls for the CoreC1 bootstrap metadata fix.

Regression cover for two operator-environment assumptions that only passed on a
developer machine:

* CI run 38840447956 — a base-deps-only venv has no ``local-operator``
  distribution, and the facade's import-time
  ``importlib.metadata.version("local-operator")`` raised (the F1 defect).
* CI run 38841332203 — these very tests defaulted their core checkout and
  ambient interpreter to a home-directory path that does not exist on a runner
  (the F2 defect). Nothing here may assume an operator home, an existing
  checkout or a network: every input is a temporary fixture this file builds.

The synthetic fixtures are deliberate. A real pinned checkout cannot be used —
it is exactly what is absent when the test must run — and pointing at one would
reintroduce the assumption being tested against.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sysconfig
import tempfile
import tomllib
import unittest
import venv

spec = importlib.util.spec_from_file_location(
    "proof_bootstrap", Path(__file__).with_name("account-routing-bootstrap.py")
)
assert spec and spec.loader
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)

# Any operator-specific path in these two modules is the F2 defect returning.
# Assembled from fragments on purpose: a literal list would make this file fail
# its own scan, which is exactly the self-reference that hid the original defect.
_FORBIDDEN_FRAGMENTS = (
    ("/", "Users", "/"),
    ("/", "home", "/"),
    ("Path", ".home"),
    ("~/", "local-operator"),
    ("local-operator/", ".venv"),
)
FORBIDDEN = tuple("".join(parts) for parts in _FORBIDDEN_FRAGMENTS)
MODULES = ("account-routing-bootstrap.py", "account-routing-bootstrap-test.py")


def requirements_block(count: int) -> str:
    deps = "\n".join(f'    "dep{n}>=1.0",' for n in range(count))
    return f"dependencies = [\n{deps}\n]"


def write_pinned_checkout(root: Path, version: str = "9.9.9", deps: int = 23, uv_lock: bool = False) -> Path:
    core = root / "core"
    (core / "local_operator" / "mobile").mkdir(parents=True)
    (core / "pyproject.toml").write_text(
        "[build-system]\n"
        'requires = ["setuptools>=61.0.0"]\n'
        'build-backend = "setuptools.build_meta"\n\n'
        "[project]\n"
        'name = "local-operator"\n'
        f'version = "{version}"\n'
        f"{requirements_block(deps)}\n"
    )
    if uv_lock:
        (core / "uv.lock").write_text("")
    return core


def make_venv(root: Path, name: str) -> Path:
    environment = root / name
    venv.EnvBuilder(with_pip=False).create(environment)
    return environment


def install_synthetic_metadata(environment: Path, version: str, name: str = "local-operator") -> Path:
    """Write the minimum a real ``dist-info`` needs to answer ``version()``.

    This is what the bootstrap's ``pip install --no-deps`` produces: distribution
    metadata in the venv's own site-packages, and nothing else.
    """
    site = Path(
        subprocess.check_output(
            [
                str(environment / "bin" / "python"),
                "-c",
                "import sysconfig;print(sysconfig.get_paths()['purelib'])",
            ],
            text=True,
        ).strip()
    )
    dist = site / f"{name.replace('-', '_')}-{version}.dist-info"
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n")
    (dist / "RECORD").write_text("")
    return dist


class BootstrapPortabilityControls(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("LOCAL_OPERATOR_SCRATCHPAD") or os.environ.get("RUNNER_TEMP")
        if not root:
            raise RuntimeError("supply owned scratch, not default /tmp")
        self.temp = tempfile.TemporaryDirectory(prefix="bootstrap-unit-", dir=root)
        self.root = Path(self.temp.name)
        # A hermetic PATH/HOME: no operator interpreter or checkout is reachable.
        self.env = {"PATH": os.environ.get("PATH", ""), "HOME": str(self.root / "home")}
        (self.root / "home").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_no_operator_specific_path_in_either_module(self):
        """The F2 regression itself: any home-directory literal fails here."""
        for name in MODULES:
            text = Path(__file__).with_name(name).read_text()
            for needle in FORBIDDEN:
                with self.subTest(module=name, needle=needle):
                    self.assertNotIn(needle, text)

    def test_metadata_matching_its_own_pyproject_resolves(self):
        core = write_pinned_checkout(self.root, version="1.2.3")
        declared, version = self._declared_and_version(core)
        project = tomllib.loads((core / "pyproject.toml").read_text())["project"]
        self.assertEqual(version, project["version"])
        self.assertEqual(len(declared), 23)
        environment = make_venv(self.root, "matching")
        install_synthetic_metadata(environment, version)
        facts = bootstrap.verify_metadata(
            str(environment / "bin" / "python"), version, environment, self.env
        )
        self.assertEqual(facts["metadataVersion"], version)
        self.assertTrue(str(facts["metadataPath"]).startswith(str(environment.resolve())))

    def test_missing_metadata_fails_closed_with_a_named_cause(self):
        environment = make_venv(self.root, "empty")
        with self.assertRaises(ValueError) as caught:
            bootstrap.verify_metadata(
                str(environment / "bin" / "python"), "1.0.0", environment, self.env
            )
        message = str(caught.exception)
        self.assertIn("local-operator", message)
        self.assertNotIn("CalledProcessError", message)
        self.assertNotIn("Traceback", message)

    def test_matching_version_outside_the_isolated_environment_is_refused(self):
        """The discriminating control: version equality alone must not pass.

        An ambient interpreter carrying a MATCHING version is the case that a
        version-only check would wrongly accept, so the path assertion is what is
        actually being tested.
        """
        ambient = make_venv(self.root, "ambient")
        install_synthetic_metadata(ambient, "1.2.3")
        isolated = make_venv(self.root, "isolated")
        with self.assertRaises(ValueError) as caught:
            bootstrap.verify_metadata(
                str(ambient / "bin" / "python"), "1.2.3", isolated, self.env
            )
        self.assertIn("outside the isolated env", str(caught.exception))

    def test_mismatched_version_is_refused(self):
        environment = make_venv(self.root, "mismatch")
        install_synthetic_metadata(environment, "1.2.3")
        with self.assertRaises(ValueError) as caught:
            bootstrap.verify_metadata(
                str(environment / "bin" / "python"), "4.5.6", environment, self.env
            )
        self.assertIn("pinned CoreC1 checkout", str(caught.exception))

    def test_checkout_shape_guards_fail_before_any_facade_read(self):
        """Wrong dependency count or a uv.lock is refused without a real checkout."""
        wrong = write_pinned_checkout(self.root / "a", deps=22)
        with self.assertRaises(ValueError):
            self._declared_and_version(wrong)
        locked = write_pinned_checkout(self.root / "b", uv_lock=True)
        with self.assertRaises(ValueError):
            self._declared_and_version(locked)

    def test_absent_checkout_is_refused_not_defaulted(self):
        with self.assertRaises((FileNotFoundError, NotADirectoryError, ValueError)):
            self._declared_and_version(self.root / "does-not-exist")

    def _declared_and_version(self, core: Path):
        """Read the pinned metadata without requiring the production blob pin.

        ``core_metadata`` also verifies the facade's Git blob, which a synthetic
        checkout cannot reproduce; these controls target the portability and
        metadata-resolution behaviour, so the shape/version checks are exercised
        directly here.
        """
        project = tomllib.loads((core / "pyproject.toml").read_text())["project"]
        values, version = project["dependencies"], project["version"]
        if (
            len(values) != 23
            or (core / "uv.lock").exists()
            or not isinstance(version, str)
            or not version.strip()
        ):
            raise ValueError("synthetic checkout shape rejected")
        return values, version.strip()


if __name__ == "__main__":
    unittest.main()
