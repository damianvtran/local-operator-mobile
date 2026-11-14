# fr — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `frs2b2a` | `m3s2b2/audits/fr/` | none | `record.json` | `0155c2361680b13687aa4b48b90421e2f46ad14d62ad35326f49993f2064b27f` |
| `frs2b2a` | `m3s2b2/audits/fr/` | none | `report.md` | `335723c5f1af9fc85385bae5dd467cbf75d494b907e6486242f7249197367203` |
| `frs2b2a` | `m3s2b2/audits/fr/` | none | `audit.log` | `af2090b6092ad2b781d880076d74b230c54342572780ab1ce8c40155bb4adea6` |
| `frs2b2ar2` | `m3s2b2/audits/fr-r2/` | none | `record.json` | `79f43a155fc72647d14eba5bbe2366048f6d3f30df4e82ca1b630a4fa362fe09` |
| `frs2b2ar2` | `m3s2b2/audits/fr-r2/` | none | `report.md` | `98e33b22f42b8566d6401f4478e5068728fc302a6708f18607bcdde099bf4f13` |
| `frs2b2ar2` | `m3s2b2/audits/fr-r2/` | none | `audit.log` | `632cae484e78937cbeb966d778817faa7504253712a6b4b0ef0e834d26618d19` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator jobs: `9fb915e773aa`, `229d22205b83` (v1, then the v2 remediation).
- Draft v1 sha256: `f772103e61bbe87e18603b57b5152d360cf48a999a8fc04bafc96a8a192985f4`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/fr/mobile.computers.json`): `68e4448105633f3c82444a58def0f0fa94c3f7e2e93ed1dbe8909663df32a44b`; equal to the v2 hash in `frs2b2ar2/record.json`.
- `frs2b2a` (round 1): auditor session `41808e7144c1`, model `anthropic/claude-opus-5-5`; verdict `passed`.
- `frs2b2ar2` (round 2): auditor session `c64a4d591431`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
