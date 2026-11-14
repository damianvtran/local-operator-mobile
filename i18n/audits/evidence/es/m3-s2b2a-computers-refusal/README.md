# es — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `ess2b2a` | `m3s2b2/audits/es/` | none | `record.json` | `455ac1660086da2b4a1c9458a051d5d692a55d8cdfb64df84b6acd10f8eca2f6` |
| `ess2b2a` | `m3s2b2/audits/es/` | none | `report.md` | `1433e06b6cf5965bade410dee439ee495e0cce015020d84a69397e85b509bbf0` |
| `ess2b2a` | `m3s2b2/audits/es/` | none | `audit.log` | `c5aa169228b6432761c46aa7151f88d6d5a550471dd810fc50d78d75c3c14e27` |
| `ess2b2ar2` | `m3s2b2/audits/es-r2/` | none | `record.json` | `4af25873f87f7db7a5b562790992ffa706aa301787600a2586dee58844db7158` |
| `ess2b2ar2` | `m3s2b2/audits/es-r2/` | none | `report.md` | `750c5406936f29739ac8f9ac96b2bf6b0b4cdf521d4f5100034bd87a26379970` |
| `ess2b2ar2` | `m3s2b2/audits/es-r2/` | none | `audit.log` | `caa33ddbd6db0d83a7bf61396a350b38fda1f2446516db5efa2012b29397a9f6` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator jobs: `ba7a91cef29d`, `825860dfb698` (v1, then the v2 remediation).
- Draft v1 sha256: `d1d9734623f37ee5b093c1d6cad4904d5f348b605e84dcd7fb5191049f17fdb9`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/es/mobile.computers.json`): `7fd8d7014664c96481b7dd9193301b0dcbd907de32630cfa299982ce571d03a7`; equal to the v2 hash in `ess2b2ar2/record.json`.
- `ess2b2a` (round 1): auditor session `57d45b0513a4`, model `anthropic/claude-opus-5-5`; verdict `passed`.
- `ess2b2ar2` (round 2): auditor session `b29128e837d8`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
