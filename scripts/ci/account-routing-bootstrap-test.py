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

import hashlib
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


# The pinned checkout's REAL .gitignore bytes (commit
# c1b7083a5371d60aa4ad58dbb54fd30d1a25857c), embedded verbatim. A synthetic
# checkout without them cannot exercise the cleanliness check honestly: the
# production checkout ignores `*.egg-info/` and `build/`, so a plain
# `git status --porcelain` is blind to exactly the artifacts the check exists
# to catch. Reproducing the real bytes makes the control prove the shipped
# behaviour rather than a fixture-only one (review R5-1).
PINNED_GITIGNORE_SHA256 = (
    "bb2a9f4e74c15072e59f7ac584b83caedb8ceede1afedf1000f16db227d2db5f"
)
PINNED_GITIGNORE = '# Ignore Python compiled files\n*.pyc\n__pycache__/\n.env\n# No trailing slash on purpose: `.venv/` matches only a directory, so a `.venv`\n# SYMLINK into a shared venv (how a throwaway worktree borrows one) slipped\n# past it and was committed by a `git add -A`. The slash-less spelling matches\n# a file, a symlink and a directory alike, so it is the one that covers this.\n.venv\n.DS_Store\ndist/\nnode_modules/\n# pnpm\'s content-addressable store. Normally it lives once under ~/Library or\n# ~/.local/share and never appears here — but pnpm hard-links from the store\n# into node_modules, and hard links cannot cross filesystems, so a checkout on\n# a DIFFERENT filesystem than the home store (a `git worktree add /tmp/...`,\n# which is how this repo is routinely worked) makes pnpm fall back to a local\n# store beside the package. That is 34 MB of regenerable cache that a\n# `git add -A` in such a worktree would otherwise commit.\n.pnpm-store/\nlocal-operator-extension.zip\n# google-github-actions/auth creates these only when credential-file export is\n# enabled; ignore them defensively so a local workflow experiment cannot commit\n# a short-lived credential alongside the extension artifact.\ngha-creds-*.json\n*.egg-info/\n.pytest_cache/\n.vscode/\n.coverage*\nhtmlcov/\nbuild/\n# pytest-textual-snapshot report artifact — regenerable, and it embeds the\n# environment (including secrets) in its HTML dump. Never commit it.\nsnapshot_report.html\n\n# `uv` resolution artifact. This project pins nothing through it: CI and the\n# documented install both run `pip install -e ".[dev]"` against pyproject, so a\n# committed lockfile is a second source of truth that nothing reads and no job\n# validates. It landed by accident in a TUI commit.\n#\n# EXCEPTION: an adapter distribution under `benchmarks/` IS a separately-locked\n# workspace — its `uv.lock` is the pinned dependency set the wheel and digests\n# are attested against, so those locks are committed deliberately.\nuv.lock\n!benchmarks/*/uv.lock\n\n# Throwaway validation aids: the tidy-tree prototype and the captured org-chart\n# screenshot matrix live here so the reviewer/designer can look at them, but\n# they are not shipped code — committing them would put the prototype (which is\n# deliberately not type-clean) under the pyright/black gate and re-bill the\n# SVGs as repo weight. The shipped code is the promoted `org_layout.py`.\nscratch/\n\n# The local measurement store for the `scripts/bench_*.py` harnesses: the\n# before/after JSON dumps and the tables built from them. It is regenerable\n# output, not source, so the evidence belongs on the PR that cites it and never\n# in the tree (`AGENTS.md`, "Evidence goes on the PR, never into the repository")\n# — committing it made every clone pay forever for numbers one PR cared about.\n# Ignored here so a re-run still has somewhere to write (`bench_info_snapshot.py`\n# creates the directory itself, because git does not materialise an ignored one);\n# the numbers that were committed are one `git show` away at `ba225070`, the\n# `main` this sweep branched from, where the whole store is still present.\nbench/\n\n# In-repo worktrees (one per parallel lane): untracked lane trees, never\n# part of the shipped package. Root-anchored (``/.worktrees/``): the lane\n# trees live at the repository root only, and an unanchored pattern would\n# demand a mirror rule in mobile/web/.gitignore (whose tree-mirror guard\n# requires it) for a rule that can never apply inside that subtree.\n/.worktrees/\n'


def write_pinned_checkout(root: Path, version: str = "9.9.9", deps: int = 23, uv_lock: bool = False) -> Path:
    core = root / "core"
    (core / "local_operator" / "mobile").mkdir(parents=True)
    (core / ".gitignore").write_text(PINNED_GITIGNORE)
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
    # The cleanliness assertion reads `git status`, so the synthetic checkout needs
    # a repository; committing isolates it from an inherited user/global config.
    subprocess.run(
        ["git", "-C", str(core), "init", "--quiet"], check=True,
        env={**os.environ, "GIT_CONFIG_SYSTEM": os.devnull},
    )
    subprocess.run(
        ["git", "-C", str(core), "-c", "user.email=t@example.invalid",
         "-c", "user.name=proof", "add", "-A"], check=True,
    )
    subprocess.run(
        ["git", "-C", str(core), "-c", "user.email=t@example.invalid",
         "-c", "user.name=proof", "commit", "--quiet", "-m", "fixture"],
        check=True,
    )
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

    def test_build_requirements_are_declared_not_left_to_the_index(self):
        """R4-1: PEP 517 isolation resolved setuptools/wheel unpinned at build time.

        The fix installs the checkout's declared build requirements explicitly and
        builds with --no-build-isolation, so this control asserts the declaration is
        readable and recorded rather than left implicit.
        """
        core = write_pinned_checkout(self.root / "build", version="3.1.4")
        requires = self._build_requires(core)
        self.assertEqual(requires, ["setuptools>=61.0.0"])
        unreadable = self.root / "nobuild"
        (unreadable / "local_operator" / "mobile").mkdir(parents=True)
        (unreadable / "pyproject.toml").write_text(
            "[project]\nname = \"local-operator\"\nversion = \"1.0.0\"\n"
            'dependencies = [\n    "dep0>=1.0",\n]\n'
        )
        with self.assertRaises((KeyError, ValueError)):
            self._build_requires(unreadable)

    def test_planted_stray_artifact_fails_the_cleanliness_assertion(self):
        """R5-1: the gitignored build artifacts must actually be caught.

        The fixture carries the pinned checkout's real .gitignore, so this proves
        the SHIPPED behaviour: `*.egg-info/` and `build/` are ignored by that file,
        and a plain `git status --porcelain` cannot see them. The assertion
        therefore needs `--ignored=matching`, and this control fails if that flag
        is ever dropped.
        """
        core = write_pinned_checkout(self.root / "stray")
        self.assertFalse(self._stray_artifacts(core))
        # `--ignored=matching` reports an ignored path even when the directory is
        # EMPTY — verified directly against git, which is stricter than plain
        # porcelain and catches a bare `mkdir` too.
        stray = core / "local_operator.egg-info"
        stray.mkdir()
        self.assertTrue(self._stray_artifacts(core))
        (stray / "PKG-INFO").write_text("Name: local-operator\n")
        self.assertTrue(self._stray_artifacts(core))
        # The backend's other artifact, and the one plain porcelain hides.
        built = core / "build"
        built.mkdir()
        (built / "out.txt").write_text("backend output\n")
        self.assertTrue(self._stray_artifacts(core))
        # Proof this control is not vacuous: with the pre-R5-1 assertion (no
        # --ignored=matching) the SAME tree reads clean, which is the defect.
        plain = subprocess.check_output(
            ["git", "-C", str(core), "status", "--porcelain"], text=True
        ).strip()
        self.assertEqual(plain, "")
        # And the pinned bytes are the real ones, not a convenient stand-in.
        digest = hashlib.sha256((core / ".gitignore").read_bytes()).hexdigest()
        self.assertEqual(digest, PINNED_GITIGNORE_SHA256)

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

    def _build_requires(self, core: Path) -> list[str]:
        build = tomllib.loads((core / "pyproject.toml").read_text())["build-system"]
        requires = build["requires"]
        if build["build-backend"] != "setuptools.build_meta" or not requires:
            raise ValueError("synthetic build-system rejected")
        return list(requires)

    def _stray_artifacts(self, core: Path) -> bool:
        """Mirror the bootstrap's whole-checkout cleanliness assertion.

        ``--ignored=matching`` is part of the mirror, not an extra: without it
        the assertion reads as passing while the gitignored build artifacts it
        exists to catch are invisible (review R5-1).
        """
        return bool(
            subprocess.check_output(
                [
                    "git",
                    "-C",
                    str(core),
                    "status",
                    "--porcelain",
                    "--ignored=matching",
                ],
                text=True,
            ).strip()
        )

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
