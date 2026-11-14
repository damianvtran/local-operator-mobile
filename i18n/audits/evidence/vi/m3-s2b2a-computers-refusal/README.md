# vi — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `vis2b2a` | `m3s2b2/audits/vi/` | none | `record.json` | `a41a83fbbf2510c49d3bb4dca9afe9cacb80a04b3160841fdce4c9d670a9f0e8` |
| `vis2b2a` | `m3s2b2/audits/vi/` | none | `report.md` | `91a3b5c9337e3e7cb97802714e84266928c165055311563be5d525d1dcdcc24f` |
| `vis2b2a` | `m3s2b2/audits/vi/` | none | `audit.log` | `d4164fd6c7043790173792ac2cc15e4a1a6e06568ef0424f695240bf220a3cc2` |
| `vis2b2ar2` | `m3s2b2/audits/vi-r2/` | none | `record.json` | `ed436478680c525c91b2e8d0669546eafa917e72257116355952067acbe9d8d1` |
| `vis2b2ar2` | `m3s2b2/audits/vi-r2/` | none | `report.md` | `8e9803de9dc5c96d4936a8004d4dd6691d4577007addf16fc8722f0983e7f688` |
| `vis2b2ar2` | `m3s2b2/audits/vi-r2/` | none | `audit.log` | `0a18ef49c8f1d0a6c1e11a9a9d8a32e43d1f0ad3d078edb1aa0e0ccaf8fa63c7` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator jobs: `1f94f733895a`, `a4333a19e1fb` (v1, then the v2 remediation).
- Draft v1 sha256: `6bcbba45988d6560a60bfe91fd629ce77331411277a943417d58e8787abe8c0d`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/vi/mobile.computers.json`): `ebffe8892091bfaf595c270471f07124186925138ae60a54c49ba26e890a5fc8`; equal to the v2 hash in `vis2b2ar2/record.json`.
- `vis2b2a` (round 1): auditor session `e4feb0b40788`, job `cbb7a592c00f`, model `anthropic/claude-opus-5-5`; verdict `passed`.
- `vis2b2ar2` (round 2): auditor session `4c17c03552ee`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `vis2b2a/audit.log` contains 1 literal `[redacted]` string; `vis2b2ar2/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
