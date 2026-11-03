#!/usr/bin/env python3
"""Fail-closed manual routing for the REGISTERED iOS workflow, not a native-diff
exemption. PR/push classification remains unchanged, including mixed diffs."""
import json
import os


def route(mode, proof):
    if not isinstance(mode, str) or mode not in ('standard', 'retirement-ui-setup'):
        raise ValueError('Unknown manual iOS mode')
    if type(proof) is not bool:
        raise ValueError('Manual proof input must be boolean')
    if mode == 'retirement-ui-setup' and proof:
        raise ValueError('Setup and proof replay cannot be combined')
    return mode


if __name__ == '__main__':
    mode = os.environ.get('IOS_MANUAL_MODE')
    try:
        proof = json.loads(os.environ.get('IOS_PROOF_JSON', 'null'))
        chosen = route(mode, proof)
    except (ValueError, TypeError):
        raise SystemExit('Manual iOS routing refused')
    print('manual iOS route: ' + chosen)
