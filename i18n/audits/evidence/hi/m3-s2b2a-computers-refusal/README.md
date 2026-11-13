# hi — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `his2b2a` | `m3s2b2/audits/hi/` | none | `record.json` | `37767fff14e349473e59f475629463dbe1ab721f4c672c3c26a6154f8c255c57` |
| `his2b2a` | `m3s2b2/audits/hi/` | none | `report.md` | `d04728f4b96124cc96e793c500f139e90cfeb2b7d8f074f799d3a7c316a99a74` |
| `his2b2a` | `m3s2b2/audits/hi/` | none | `audit.log` | `ac6a9f9577c96c894d2837ed0a81247ddacea3164e7afa6a20dff63d5dad5158` |
| `his2b2ar2` | `m3s2b2/audits/hi-r2/` | none | `record.json` | `29c256281559a18b3c24a4c62eaf86c11deb0d1efec50b969306e0323071fb03` |
| `his2b2ar2` | `m3s2b2/audits/hi-r2/` | none | `report.md` | `13b1fa085abfa6387291dcd378a32de8a46850f46975a0492a6218eb914bb1e8` |
| `his2b2ar2` | `m3s2b2/audits/hi-r2/` | none | `audit.log` | `e72d8f167dd47e44646d8d7429da5bd163262c61b7b9f8694fedb2232885c30c` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator jobs: `ee0b2003be8e`, `35d709c49b96` (v1, then the v2 remediation).
- Draft v1 sha256: `e24b300418f841277a2d3c6cab80d3086a92ff3b765d2fe7eaaaf0a87a35dd03`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/hi/mobile.computers.json`): `9cc1892c9da83f945aa8fe8af90d9f57dde0462ecd8dcf6d8f086ebd8c2be5b7`; equal to the v2 hash in `his2b2ar2/record.json`.
- `his2b2a` (round 1): auditor session `42a9d3be53a4`, model `anthropic/claude-opus-5-5`; verdict `changes_requested`.
- `his2b2ar2` (round 2): auditor session `fdb2ce531d10`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.

## Deferred

- `HI-R2-N1` (NIT, non-gating): deferred; see `his2b2ar2/report.md`.
