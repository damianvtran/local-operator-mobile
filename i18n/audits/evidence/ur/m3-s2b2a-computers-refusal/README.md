# ur — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `urs2b2a` | `m3s2b2/audits/ur/` | none | `record.json` | `966397c41fed1d028b4c07496290b0f8c5131c4c16995818c7eee11c6364aa11` |
| `urs2b2a` | `m3s2b2/audits/ur/` | none | `report.md` | `e9e8fe88886f519de8cb0952d6812560f0403a1e3f966917d04cb744d1216736` |
| `urs2b2a` | `m3s2b2/audits/ur/` | none | `audit.log` | `b69a1a14432e4971971631af3f7326eae4b041a7ef92354e05befc6f09fc1828` |
| `urs2b2ar2` | `m3s2b2/audits/ur-r2/` | none | `record.json` | `08b3eb6e821bc683710c550e3b70347bb02f6f9102eb84f4d51efba5d34fe29b` |
| `urs2b2ar2` | `m3s2b2/audits/ur-r2/` | none | `report.md` | `0a7131e95f2c22bc55e2012a8f782de2b1b2f2d9e77a65c4d0e94eeade76db69` |
| `urs2b2ar2` | `m3s2b2/audits/ur-r2/` | none | `audit.log` | `14ea10717e9026c49a624197b6b856cb512a2004f37525b6cd895246450701aa` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator jobs: `3e9cacebe527`, `3b60246e93b4` (v1, then the v2 remediation).
- Draft v1 sha256: `46211c4e2757deca94e7eab22fd61c95c49f20a83e419929d71d2b5ea7e1233b`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/ur/mobile.computers.json`): `635d03a2df1490804485455d07522192a9e29c09b17c65975447798520166c20`; equal to the v2 hash in `urs2b2ar2/record.json`.
- `urs2b2a` (round 1): auditor session `ae9561e2347a`, model `anthropic/claude-opus-5-5`; verdict `changes_requested`.
- `urs2b2ar2` (round 2): auditor session `75699937d8a2`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `urs2b2a/audit.log` contains 1 literal `[redacted]` string; `urs2b2ar2/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
- Round 1 also raised UR-C1 (the Latin-initial `open_console` Button label laid out LTR on an RTL page); fixed in code with `labelDir={composedDir}` in `src/ui/components/refusal-surface.tsx`, with a source-level and a rendered test in `src/features/auth/ur-latin-initial-sites.test.ts`.

## Deferred

- `UR2-N1` (NIT, non-gating): deferred; see `urs2b2ar2/report.md`.
- `UR2-N2` (NIT, non-gating): deferred; see `urs2b2ar2/report.md`.
