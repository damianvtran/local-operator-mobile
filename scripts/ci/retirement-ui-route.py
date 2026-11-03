#!/usr/bin/env python3
"""Fail-closed REGISTERED manual routes; ordinary PR/push classification unchanged.
Replay source is the checked-out caller SHA, not an arbitrary runner assertion.
"""
import json
import os
import re


def route(mode, proof, compile_run='', runner_artifact='', runner_source='', observe_only=False, expected_source=None):
    if not isinstance(mode, str) or mode not in ('standard', 'retirement-ui-setup', 'retirement-seed-replay'):
        raise ValueError('Unknown manual iOS mode')
    if type(proof) is not bool or type(observe_only) is not bool:
        raise ValueError('Manual booleans required')
    if any(not isinstance(value, str) for value in (compile_run, runner_artifact, runner_source)):
        raise ValueError('Replay strings required')
    if mode != 'standard' and proof:
        raise ValueError('Independent route cannot build the proof app')
    if mode == 'retirement-seed-replay':
        for value in (compile_run, runner_artifact):
            if not re.fullmatch('[1-9][0-9]{0,15}', value) or int(value) > 9007199254740991:
                raise ValueError('Exact compile/artifact identifiers required')
        if not re.fullmatch('[a-f0-9]{40}', runner_source) or expected_source is not None and runner_source != expected_source:
            raise ValueError('Runner and checked-out host source differ')
    elif compile_run or runner_artifact or runner_source or observe_only:
        raise ValueError('Replay inputs forbidden outside replay')
    return mode


if __name__ == '__main__':
    try:
        chosen = route(os.environ.get('IOS_MANUAL_MODE'),
                       json.loads(os.environ.get('IOS_PROOF_JSON', 'null')),
                       os.environ.get('REPLAY_COMPILE_RUN', ''),
                       os.environ.get('REPLAY_RUNNER_ARTIFACT', ''),
                       os.environ.get('REPLAY_RUNNER_SOURCE', ''),
                       json.loads(os.environ.get('REPLAY_OBSERVE_ONLY_JSON', 'false')),
                       os.environ.get('GITHUB_SHA'))
    except (ValueError, TypeError):
        raise SystemExit('Manual iOS routing refused')
    print('manual iOS route: ' + chosen)
