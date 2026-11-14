# fr — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `frs2b2b` | `m3s2b2b/audits/fr/` | none | `record.json` | `efab0b2ce1f8d6c22e7c965b07b5f07643d93e0544f7d55855ddcab75a1435ce` |
| `frs2b2b` | `m3s2b2b/audits/fr/` | none | `report.md` | `78e18dee0f69a38390e8df0705a01b5a42489982919a21093392c42a413f5c21` |
| `frs2b2b` | `m3s2b2b/audits/fr/` | none | `audit.log` | `65037b5850425614957da2c342b1f41aa612ccc7285c7a78de52341799f16679` |
| `frs2b2br2` | `m3s2b2b/audits/fr-r2/` | none | `record.json` | `4fc84ef16598fb924ecc7a84c76a6b1b8aea6cb79555114bc0afd92d7b7c1e2d` |
| `frs2b2br2` | `m3s2b2b/audits/fr-r2/` | none | `report.md` | `18c468066f4bb96347fddb8b9e5639774bcfe8f265d3f8cab215964165961079` |
| `frs2b2br2` | `m3s2b2b/audits/fr-r2/` | none | `audit.log` | `d072b3708280fd41c14a4e184c8cc040145a08a79d40283a2410b37d5ca738da` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `3855e519638f`, `be835a5ba56f` (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `8166df188a62a69a94e540c68589a8095286c8e6d483cb1c817cb5948310729a`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/fr/mobile.computers.json`): `860ee7c42a4e96e2d71c5e5756c7501fd801c4850d70e6c715f2a6f19dc151b5`; equal to the v2 hash in `frs2b2br2/record.json`.
- `frs2b2b` (round 1): auditor session `354214f74cea`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 4 MINOR, 3 NIT).
- `frs2b2br2` (round 2): auditor session `4ea18dfd629a`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved, except `FR-4`, accepted as a source-side item (below).
- `frs2b2br2` was written to a fallback location and copied into the lane's `audits/fr-r2/`: record.json `write_location_note` — "Guardrail dangerous-delete refused writing to /Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/m3s2b2b/audits/fr-r2/ (another session's scratchpad); files written to this auditor's own scratchpad per brief fallback.".

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `frs2b2b/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
- `{subject}` in the refusal headlines is filled with the `your_computer` fallback mid-sentence; its capitalisation in that position, and per-slot headline variants for the unnamed fallback, are a later slice (manager decision, option a). This is round-1 `FR-4` (`your_computer`: value kept, a source-side code item), which round 2 records as accepted with the value byte-identical; it is not a catalogue change.
