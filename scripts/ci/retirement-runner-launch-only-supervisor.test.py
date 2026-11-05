"""Controller/supervisor controls; never native runner evidence."""
import datetime
from types import SimpleNamespace
from unittest.mock import patch
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).parent


def load():
    return runpy.run_path(str(HERE / 'retirement-runner-launch-only-supervisor.py'))


class Bounds(unittest.TestCase):
    def test_memory_is_group_scoped_and_controller_separate(self):
        api = load()
        self.assertTrue(api['memory_admitted']('10 10 100\n11 20 100\n12 99 99999999', 10, {20}))
        self.assertFalse(api['memory_admitted']('10 10 524289', 10, set()))
        self.assertFalse(api['memory_admitted']('10 10 1\n11 20 2097153', 10, {20}))
        with self.assertRaises(ValueError):
            api['memory_admitted']('unknown inventory', 10, set())

    def test_watchdog_stops_crashed_or_memory_refused_child(self):
        api = load()
        watchdog = api['WATCHDOG']
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            result = watchdog['attempt']([sys.executable, '-c', 'import time;time.sleep(30)'], root, time.monotonic() + 2, 2, memory_check=lambda _pid, _groups: False)
            self.assertEqual(result['stopReason'], 'memory-limit')
            self.assertTrue(result['workerReaped'])
            self.assertTrue(result['groupsAbsent'])

    def test_controller_crash_still_runs_owned_cleanup(self):
        watchdog = load()['WATCHDOG']
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            marker = root / 'fallback-ran'
            result = watchdog['supervise']([sys.executable, '-c', 'import os;os._exit(9)'],
                [sys.executable, '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).write_text("owned-cleanup")', str(marker)],
                root, work_seconds=1, cleanup_seconds=2)
            self.assertEqual(result['first']['workerExit'], 9)
            self.assertTrue(result['first']['workerReaped'])
            self.assertEqual(result['fallback']['workerExit'], 0)
            self.assertEqual(marker.read_text(), 'owned-cleanup')

    def test_work_timeout_and_cleanup_clock_are_not_renewed(self):
        watchdog = load()['WATCHDOG']
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            result = watchdog['attempt']([sys.executable, '-c', 'while True: pass'], root, time.monotonic() + 0.1, 2)
            self.assertEqual(result['stopReason'], 'work-deadline')
            self.assertTrue(result['workerReaped'])
            before = (root / 'cleanup-start.json').read_bytes()
            first = watchdog['cleanup_remaining'](root, 2)
            second = watchdog['cleanup_remaining'](root, 2)
            self.assertLessEqual(second, first)
            self.assertEqual((root / 'cleanup-start.json').read_bytes(), before)

    def test_exporter_drops_private_and_unknown_fields(self):
        api = load()
        value = api['closed_receipt']({'controllerSource': 'c' * 40, 'compiledRunnerSource': api['INPUTS']['SOURCE'], 'raw': 'Bearer secret', 'stopOutcome': 'private-url', 'failure': 'secret', 'protocol': {'readyReceived': 'secret'}, 'mobileAcceptanceComplete': True})
        rendered = json.dumps(value)
        self.assertEqual(value['compiledRunnerSource'], api['INPUTS']['SOURCE'])
        self.assertEqual(value['runnerArtifactID'], 13398590341)
        self.assertEqual(value['runnerArtifactExpiresAt'], '2026-11-06T07:54:42Z')
        self.assertNotIn('secret', rendered)
        self.assertNotIn('private-url', rendered)
        self.assertFalse(value['mobileAcceptanceComplete'])
        self.assertEqual(value['failure'], 'internal')
        self.assertFalse(value['protocol']['readyReceived'])

    def test_expiry_life_and_source_are_fixed(self):
        api = load()['INPUTS']
        expiry = api['epoch'](api['EXPIRY'])
        metadata = {'id': 13398590341, 'size_in_bytes': 6844204, 'digest': 'sha256:' + api['PROBE']['DIGEST'], 'expired': False, 'expires_at': api['EXPIRY'], 'workflow_run': {'id': 41985836532, 'head_sha': api['SOURCE']}}
        # Freeze only the existing checker's wall clock. Its source/hash/expiry
        # predicates stay real, and the fixture remains valid after pin expiry.
        class FrozenDateTime(datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls.fromtimestamp(expiry - 1200, tz)
        frozen = SimpleNamespace(datetime=FrozenDateTime, timezone=datetime.timezone)
        with patch.dict(api['PROBE']['identity'].__globals__, datetime=frozen):
            for dispatch, start, now, accepted in [(expiry-10801, expiry-1201, expiry-1200, True), (expiry-10799, expiry-1201, expiry-1200, False), (expiry-10801, expiry-1199, expiry-1198, False), (expiry-10801, expiry-1201, expiry+1, False)]:
                if accepted:
                    self.assertEqual(api['expiry_gate'](metadata, dispatch, start, now), expiry)
                else:
                    with self.assertRaises(ValueError): api['expiry_gate'](metadata, dispatch, start, now)
            metadata['workflow_run']['head_sha'] = 'c' * 40
            with self.assertRaises(Exception): api['expiry_gate'](metadata, expiry-10801, expiry-1201, expiry-1200)


class FailureClasses(unittest.TestCase):
    """QA34-M1 / QA34-m1: the shared clock and the retained failure class.

    Both regressions are exercised through the production helpers, so a future
    edit that restores the old behaviour fails here rather than in a hosted run.
    """

    def test_work_clock_is_the_persisted_wall_clock_not_monotonic(self):
        api = load()
        # A clock written by the acquisition process is read by this one. Wall
        # clock is comparable; monotonic is not (negative deltas measured on
        # this host), which is the defect QA34-M1 named.
        clock = {'jobStart': time.time() - 120.5, 'acquisitionMs': 1000}
        self.assertAlmostEqual(api['remaining_work'](clock), 179.5, places=1)
        # A clock step backwards must refuse rather than grant a fresh budget.
        for bad in ({'jobStart': time.time() + 60, 'acquisitionMs': 0},
                    {'jobStart': time.time() - 301, 'acquisitionMs': 0},
                    {'jobStart': time.time() - 1, 'acquisitionMs': 90001}):
            with self.assertRaises(ValueError):
                api['remaining_work'](bad)
        self.assertNotIn('monotonicStart', (HERE / 'retirement-runner-launch-only-supervisor.py').read_text())

    def test_a_controller_recorded_preflight_failure_is_not_relabelled_internal(self):
        api = load()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / 'work-clock.json').write_text(json.dumps({'jobStart': time.time(), 'acquisitionMs': 10}))
            (root / 'replay-cleanup.json').write_text(json.dumps({'cleanupComplete': True, 'inventoryAbsent': True, 'exit': 0}))
            (root / 'launch-receipt.json').write_text(json.dumps({'failure': 'preflight', 'controllerSource': 'a' * 40}, ))
            # A clean self-exit 1 with a receipt and a clean reap is the controller
            # refusing on purpose; the export must keep that class.
            def supervise(*_a, **_k):
                return {'first': {'workerExit': 1, 'workerReaped': True, 'groupsAbsent': True, 'stopReason': None}, 'fallback': None}
            with patch.dict(api['WATCHDOG'], {'supervise': supervise}):
                self.assertFalse(api['run']('run', root, root / 'out.json'))
            exported = json.loads((root / 'out.json').read_text())
            self.assertEqual(exported['failure'], 'preflight')
            self.assertFalse(exported['supervisorFailed'])
            self.assertFalse(exported['forcedStop'])

    def test_a_supervisor_induced_stop_still_reports_internal(self):
        api = load()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / 'work-clock.json').write_text(json.dumps({'jobStart': time.time(), 'acquisitionMs': 10}))
            (root / 'replay-cleanup.json').write_text(json.dumps({'cleanupComplete': True, 'inventoryAbsent': True, 'exit': 0}))
            (root / 'launch-receipt.json').write_text(json.dumps({'failure': 'none', 'controllerSource': 'a' * 40}))
            def supervise(*_a, **_k):
                return {'first': {'workerExit': None, 'workerReaped': True, 'groupsAbsent': True, 'stopReason': 'work-deadline'}, 'fallback': None}
            with patch.dict(api['WATCHDOG'], {'supervise': supervise}):
                self.assertFalse(api['run']('run', root, root / 'out.json'))
            exported = json.loads((root / 'out.json').read_text())
            self.assertEqual(exported['failure'], 'internal')
            self.assertTrue(exported['supervisorFailed'])
            self.assertTrue(exported['forcedStop'])

    def test_a_nonzero_worker_exit_with_a_clean_receipt_is_not_success(self):
        # Round-34 delta re-check: dropping `workerExit != 0` let an external
        # SIGKILL (exit -9, no stopReason) pass with a pre-spawn `none` receipt.
        api = load()
        for exit_code in (-9, 1, 143):
            with tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                (root / 'work-clock.json').write_text(json.dumps({'jobStart': time.time(), 'acquisitionMs': 10}))
                (root / 'replay-cleanup.json').write_text(json.dumps({'cleanupComplete': True, 'inventoryAbsent': True, 'exit': 0}))
                (root / 'launch-receipt.json').write_text(json.dumps({'failure': 'none', 'controllerSource': 'a' * 40}))
                fake = {'first': {'workerExit': exit_code, 'workerReaped': True, 'groupsAbsent': True, 'stopReason': None}, 'fallback': None}
                with patch.dict(api['WATCHDOG'], {'supervise': lambda *_a, **_k: fake}):
                    self.assertFalse(api['run']('run', root, root / 'out.json'))
                exported = json.loads((root / 'out.json').read_text())
                self.assertEqual(exported['failure'], 'internal', exit_code)
                # The supervisor did not fail here; the exit is unexplained.
                self.assertFalse(exported['supervisorFailed'])

    def test_a_prior_class_forces_internal_over_a_clean_receipt(self):
        api = load()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / 'work-clock.json').write_text(json.dumps({'jobStart': time.time(), 'acquisitionMs': 10}))
            (root / 'replay-cleanup.json').write_text(json.dumps({'cleanupComplete': True, 'inventoryAbsent': True, 'exit': 0}))
            (root / 'launch-receipt.json').write_text(json.dumps({'failure': 'none', 'controllerSource': 'a' * 40}))
            (root / 'prior.json').write_text(json.dumps({'failure': 'launch'}))
            fake = {'first': {'workerExit': 0, 'workerReaped': True, 'groupsAbsent': True, 'stopReason': None}, 'fallback': None}
            with patch.dict(api['WATCHDOG'], {'supervise': lambda *_a, **_k: fake}):
                self.assertFalse(api['run']('run', root, root / 'prior.json'))
            self.assertEqual(json.loads((root / 'prior.json').read_text())['failure'], 'internal')

    def test_a_missing_receipt_is_internal(self):
        api = load()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / 'work-clock.json').write_text(json.dumps({'jobStart': time.time(), 'acquisitionMs': 10}))
            (root / 'replay-cleanup.json').write_text(json.dumps({'cleanupComplete': True, 'inventoryAbsent': True, 'exit': 0}))
            def supervise(*_a, **_k):
                return {'first': {'workerExit': 0, 'workerReaped': True, 'groupsAbsent': True, 'stopReason': None}, 'fallback': None}
            with patch.dict(api['WATCHDOG'], {'supervise': supervise}):
                self.assertFalse(api['run']('run', root, root / 'out.json'))
            self.assertEqual(json.loads((root / 'out.json').read_text())['failure'], 'internal')


if __name__ == '__main__':
    unittest.main()
