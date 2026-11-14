# es — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `ess2b2b` | `m3s2b2b/audits/es/` | none | `record.json` | `5f8ed8325abcd8c7b0047295d31e95304cdbdab1f230738a69eec7ab5d324671` |
| `ess2b2b` | `m3s2b2b/audits/es/` | none | `report.md` | `afcfef0205f1a69bfcb915d5bbce1bd4eeb0a26a3909577544a248522cf55150` |
| `ess2b2b` | `m3s2b2b/audits/es/` | none | `audit.log` | `1d782c8a94537c401979e2e1908747644e2d9dd2746fb494033f2a8d0b7c5cbf` |
| `ess2b2br2` | `m3s2b2b/audits/es-r2/` | none | `record.json` | `b870c33fba622b1ea38ad4ca87853076513b8548a658de1c62b22633759fb59f` |
| `ess2b2br2` | `m3s2b2b/audits/es-r2/` | none | `report.md` | `5dd949a3a127693b46bf33540a87eb4c21d1ab48fffc0193d9294d880febdc89` |
| `ess2b2br2` | `m3s2b2b/audits/es-r2/` | none | `audit.log` | `fc1074c5f3f22cd86c247ecb447dfd3cb1ffb645de10ccf643c9861f83c7c853` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `0bd7a05014d5`, `17e3058aff61` (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `f262c2deb8e5e32c9dd1f41e3ca1d55ee1440985ec98d5bb86aa21f32589677a`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/es/mobile.computers.json`): `25282ad118814e73f09f36d4da4bb90bb3dbb85be5b1ec1872054667404c5552`; equal to the v2 hash in `ess2b2br2/record.json`.
- `ess2b2b` (round 1): auditor session `6f3c42e4c00a`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT).
- `ess2b2br2` (round 2): auditor session `ca3b41d58102`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved or its rejection upheld.
- `ess2b2br2` was written to a fallback location and copied into the lane's `audits/es-r2/`: record.json `write_location` — intended `/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/m3s2b2b/audits/es-r2/`, actual `/Users/damian/.local-operator/sessions/ca3b41d58102/scratchpad/es-r2/out/`, reason: dangerous-delete guardrail refused writes to the lane path.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `ess2b2br2/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
- `{subject}` in the refusal headlines is filled with the `your_computer` fallback mid-sentence; its capitalisation in that position, and per-slot headline variants for the unnamed fallback, are a later slice (manager decision, option a).
