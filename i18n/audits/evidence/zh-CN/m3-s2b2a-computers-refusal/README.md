# zh-CN — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `zh-CNs2b2a` | `m3s2b2/audits/zh-CN/` | none | `record.json` | `93d2bacb5d825befca5d72a08532fa5c58c1d36b7184efc09092e2f0f59e26cc` |
| `zh-CNs2b2a` | `m3s2b2/audits/zh-CN/` | none | `report.md` | `bd9fa3639d627a8ad00136a772fbe36767e87893c98487caf17abf10dc911f14` |
| `zh-CNs2b2a` | `m3s2b2/audits/zh-CN/` | none | `audit.log` | `b162ed3d4ff4ab85ead86ca3ad4818b55f874504c1901a42b2cbb22814744fce` |
| `zh-CNs2b2ar2` | `m3s2b2/audits/zh-CN-r2/` | none | `record.json` | `9cf00f0d656f36844c821f7749da3f69a1fad39ced9e30e902f08a22e56e883b` |
| `zh-CNs2b2ar2` | `m3s2b2/audits/zh-CN-r2/` | none | `report.md` | `244f63f06d4ef74373861f99f534ee6b64c21f1af8ef06c0a4d30aa168e07adc` |
| `zh-CNs2b2ar2` | `m3s2b2/audits/zh-CN-r2/` | none | `audit.log` | `6f8cdd5fd1ddda5346646dff5a9fbbeaaf2e31c8bed34525bd210c1b969abb04` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator sessions: `67e397a5ab7f`, `26a9563a2aca` (v1, then the v2 remediation).
- Draft v1 sha256: `04cc9ee2e3237467c9e542bf708820196bfd8a8308e3172f6592cff790f57bdd`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/zh-CN/mobile.computers.json`): `4b5cd4b6c1b532d9921c1d847b8b4caeaf12ec8e60da2d1eedfeb166827c2cbd`; equal to the v2 hash in `zh-CNs2b2ar2/record.json`.
- `zh-CNs2b2a` (round 1): auditor session `e1685cdf64ae`, model `anthropic/claude-opus-5-5`; verdict `changes_requested`.
- `zh-CNs2b2ar2` (round 2): auditor session `ace3569ca688`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `zh-CNs2b2a/audit.log` contains 1 literal `[redacted]` string; `zh-CNs2b2ar2/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
