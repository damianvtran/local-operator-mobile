#!/usr/bin/env python3
"""Fail closed before emulator dispatch; no software-acceleration fallback.

A node's existence or permission bits do not prove usable KVM. Open it with
O_RDWR as the actual runner user and require Linux's stable API version 12:
https://docs.kernel.org/virt/kvm/api.html#kvm-get-api-version
Self-tests inject host failures; they are NOT a hardware/native test pass.
"""
import errno
import fcntl
import os
import stat
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

KVM_GET_API_VERSION = 0xAE00  # Linux _IO(KVMIO=0xAE, 0x00), no argument.


def probe(*, node="/dev/kvm", get_stat=os.stat, opener=os.open,
          ioctl=fcntl.ioctl, closer=os.close):
    try:
        info = get_stat(node)
    except OSError as error:
        raise RuntimeError(f"KVM node unavailable: {node}; errno={error.errno}") from error
    if not stat.S_ISCHR(info.st_mode):
        raise RuntimeError(f"KVM node is not a character device: {node}")
    try:
        fd = opener(node, os.O_RDWR | os.O_CLOEXEC)
    except OSError as error:
        raise RuntimeError(f"KVM O_RDWR open denied/unavailable: errno={error.errno}") from error
    try:
        try:
            version = ioctl(fd, KVM_GET_API_VERSION, 0)
        except OSError as error:
            raise RuntimeError(f"KVM_GET_API_VERSION failed: errno={error.errno}") from error
        if version != 12:
            raise RuntimeError(f"Unsupported KVM API version: {version}; expected 12")
        return version
    finally:
        closer(fd)


class ProbeControls(unittest.TestCase):
    def calls(self, **kwargs):
        return dict(get_stat=Mock(return_value=SimpleNamespace(st_mode=stat.S_IFCHR)),
                    opener=Mock(return_value=7), ioctl=Mock(return_value=12),
                    closer=Mock(), **kwargs)

    def test_missing_node(self):
        calls = self.calls()
        calls["get_stat"].side_effect = FileNotFoundError(errno.ENOENT, "missing")
        with self.assertRaisesRegex(RuntimeError, "node unavailable.*errno=2"):
            probe(**calls)
        calls["opener"].assert_not_called()

    def test_regular_file_is_not_hardware(self):
        calls = self.calls()
        calls["get_stat"].return_value.st_mode = stat.S_IFREG
        with self.assertRaisesRegex(RuntimeError, "not a character device"):
            probe(**calls)
        calls["opener"].assert_not_called()

    def test_permission_denied(self):
        calls = self.calls()
        calls["opener"].side_effect = PermissionError(errno.EACCES, "denied")
        with self.assertRaisesRegex(RuntimeError, "open denied.*errno=13"):
            probe(**calls)
        calls["ioctl"].assert_not_called()

    def test_character_node_without_kvm(self):
        calls = self.calls()
        calls["ioctl"].side_effect = OSError(errno.ENOTTY, "not KVM")
        with self.assertRaisesRegex(RuntimeError, "API_VERSION failed.*errno=25"):
            probe(**calls)
        calls["closer"].assert_called_once_with(7)

    def test_wrong_api(self):
        calls = self.calls()
        calls["ioctl"].return_value = 11
        with self.assertRaisesRegex(RuntimeError, "expected 12"):
            probe(**calls)
        calls["closer"].assert_called_once_with(7)

    def test_success_requires_actual_open_and_ioctl(self):
        calls = self.calls()
        self.assertEqual(probe(**calls), 12)
        calls["opener"].assert_called_once_with("/dev/kvm", os.O_RDWR | os.O_CLOEXEC)
        calls["ioctl"].assert_called_once_with(7, KVM_GET_API_VERSION, 0)
        calls["closer"].assert_called_once_with(7)


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        unittest.main(argv=[sys.argv[0]], verbosity=2)
    else:
        try:
            print(f"KVM usable by uid={os.geteuid()}: O_RDWR + API {probe()}")
        except (OSError, RuntimeError) as error:
            print(f"::error title=KVM preflight failed::{error}. A KVM-capable Linux host is required; emulator dispatch is stopped.", file=sys.stderr)
            sys.exit(1)
