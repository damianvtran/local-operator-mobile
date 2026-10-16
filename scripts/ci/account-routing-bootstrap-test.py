"""Controls for the CoreC1 bootstrap metadata fix (CI run 38840447956 regression).

The defect was NOT a missing dependency: the facade imports
``local_operator.config``, whose ``_package_version`` reads
``importlib.metadata.version("local-operator")`` at import time, and a base-deps
venv has no such distribution. These controls prove the two properties the fix
depends on, without installing anything or touching an operator environment:

1. A clean venv genuinely lacks the metadata (the failure is reproducible), and
2. the bootstrap's verification accepts the PINNED checkout's version and
   rejects a distribution resolved OUTSIDE the isolated environment, so an
   ambient ``local-operator`` on PATH cannot satisfy it.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
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


def probe(executable: str, env: dict, code: str) -> str:
    return subprocess.check_output([executable, "-c", code], env=env, text=True)


class BootstrapMetadataControls(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("LOCAL_OPERATOR_SCRATCHPAD") or os.environ.get(
            "RUNNER_TEMP"
        )
        if not root:
            raise RuntimeError("supply owned scratch, not default /tmp")
        self.temp = tempfile.TemporaryDirectory(prefix="bootstrap-unit-", dir=root)
        self.root = Path(self.temp.name)
        self.env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(self.root / "home"),
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        }
        # The pinned checkout is read-only here: these controls never install into
        # it and never invoke pip.
        self.core = Path(
            os.environ.get("LOH12_CORE_ROOT", str(Path.home() / "local-operator"))
        ).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def test_pinned_checkout_metadata_matches_its_own_pyproject(self):
        declared, version = bootstrap.core_metadata(self.core)
        project = tomllib.loads((self.core / "pyproject.toml").read_text())["project"]
        self.assertEqual(declared, project["dependencies"])
        self.assertEqual(len(declared), 23)
        # The expectation comes from the checkout, never a literal here: a
        # hard-coded version would pass while the pinned source said something else.
        self.assertEqual(version, project["version"])
        self.assertNotIn("\n", version)

    def test_clean_venv_really_lacks_the_metadata(self):
        environment = self.root / "clean"
        venv.EnvBuilder(with_pip=False).create(environment)
        executable = str(environment / "bin/python")
        code = (
            "import importlib.metadata as m\n"
            "try:\n"
            "    m.version('local-operator')\n"
            "except m.PackageNotFoundError:\n"
            "    print('MISSING')\n"
        )
        self.assertEqual(probe(executable, self.env, code).strip(), "MISSING")
        # The bootstrap's own check must fail closed on that same environment.
        with self.assertRaises(ValueError):
            bootstrap.verify_metadata(executable, "0.0.0", environment, self.env)

    def test_verification_rejects_metadata_outside_the_isolated_environment(self):
        """An ambient install with a MATCHING version must still be refused.

        This is the discriminating control for the path assertion: version equality
        alone would silently accept the operator's editable install.
        """
        # The editable core venv is the real ambient case: it HAS the
        # distribution, so a version-only check would wrongly accept it.
        ambient = Path(
            os.environ.get(
                "LOH12_CORE_PYTHON",
                str(Path.home() / "local-operator" / ".venv" / "bin" / "python"),
            )
        )
        facts = probe(
            str(ambient),
            self.env,
            "from importlib.metadata import version;print(version('local-operator'))",
        ).strip()
        self.assertTrue(facts)
        environment = self.root / "isolated"
        venv.EnvBuilder(with_pip=False).create(environment)
        with self.assertRaises(ValueError):
            bootstrap.verify_metadata(
                str(ambient), facts, environment, self.env
            ), "matching version from outside the venv must be refused"


if __name__ == "__main__":
    unittest.main()
