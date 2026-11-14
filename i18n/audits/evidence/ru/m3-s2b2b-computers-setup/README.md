# ru — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `rus2b2b` | `m3s2b2b/audits/ru/` | none | `record.json` | `52ff250f4ffebc0f3ecce18a64cbda06011b09b44ba4d6a8d64d85480bb21fdc` |
| `rus2b2b` | `m3s2b2b/audits/ru/` | none | `report.md` | `2292ed8c1b6faed2f7f2fd10de87233ab1edf49ecccc2123a7dafe5c76f74ec8` |
| `rus2b2b` | `m3s2b2b/audits/ru/` | none | `audit.log` | `f6fea41b03d2d1b9acd08afaf97e34c78369199427f3b83a9f4ead5ffbd12b2f` |
| `rus2b2br2` | `m3s2b2b/audits/ru-r2/` | none | `record.json` | `40a711d50a06f93788920d9b5d80202ef02fcfca2df60d10922a6dd1d7f4f56e` |
| `rus2b2br2` | `m3s2b2b/audits/ru-r2/` | none | `report.md` | `a5a8751d2231815e491415d73c16cc71cfd5fd0f49ef8aafda8c239652c880b5` |
| `rus2b2br2` | `m3s2b2b/audits/ru-r2/` | none | `audit.log` | `fea33316fe6ceb4bb5e46263a52ec133f51205fccbc5553ddc9f549b478d33ea` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `d6471ba1d021`, `526f25a44b25` (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `28bfa56580a845402811ab27f6a2ee08ed52d94cfd665c11c46174727f1e8b6a`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/ru/mobile.computers.json`): `c3fca87183de74c51b7cff563e166fb97a7af2c71bfefe847b43f5ebf89bc9d0`; equal to the v2 hash in `rus2b2br2/record.json`.
- `rus2b2b` (round 1): auditor session `ca31bb01f337`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT).
- `rus2b2br2` (round 2): auditor session `77cafd2f0293`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved or its rejection upheld.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `{subject}` in the refusal headlines is filled with the `your_computer` fallback mid-sentence; its capitalisation and grammatical case in that position, and per-slot headline variants for the unnamed fallback, are a later slice (manager decision, option a).

## Deferred

- `RU-3` (NIT, attach_label): rejected by the translator in v2; the round-2 auditor upheld the rejection (see `rus2b2br2/report.md`). Non-gating.
