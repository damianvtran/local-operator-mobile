# hi — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `his2b2b` | `m3s2b2b/audits/hi/` | none | `record.json` | `a02189d1df474c59b9814ac1bed091857239980a99f5bcdbf80139f1c4bc0109` |
| `his2b2b` | `m3s2b2b/audits/hi/` | none | `report.md` | `d22eb0e8fef61255e1fd7153370b43c2ab6c8f8bf2c123f6476f792f472cfb71` |
| `his2b2b` | `m3s2b2b/audits/hi/` | none | `audit.log` | `47c302f413ca31682baa46ddfb5e18cbceb1aace9b66de0e19cd11ba97f7e612` |
| `his2b2br2` | `m3s2b2b/audits/hi-r2/` | none | `record.json` | `f0822474117cf5876653e2c1634d5edc90ab3a91e0b59e40eba1d6d876da7122` |
| `his2b2br2` | `m3s2b2b/audits/hi-r2/` | none | `report.md` | `94d7b0fbb1d2c99aaaa570152c6153c8d2675f46ee751fd417c8a4e23eac3bde` |
| `his2b2br2` | `m3s2b2b/audits/hi-r2/` | none | `audit.log` | `4d882e065c8b1007803b4f2132c25681d2babf861ac3446ac2b4768a4d79222d` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `b8d8cd17b9d9`, `72960e7a07ef` (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `702c6790308cf7636023d13b7724fc86e995af476ce120e07875ec15860d5cc4`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/hi/mobile.computers.json`): `2beb40d0d7ae4676c036a3387a746fcd0b36fb597c63f48035a78375d14d1a5d`; equal to the v2 hash in `his2b2br2/record.json`.
- `his2b2b` (round 1): auditor session `49ff9c33b2d7`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT).
- `his2b2br2` (round 2): auditor session `b5334e435051`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved or its rejection upheld.
- `his2b2br2` was written to a fallback location and copied into the lane's `audits/hi-r2/`: record.json `write_location_note` — "lane dir audits/hi-r2/ refused by guardrail; written to auditor scratchpad for the lane to copy".

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `his2b2b/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
- `his2b2br2/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
- `your_computer` is the bare transliterated/native noun (कंप्यूटर) so it fits every refusal headline's postposition; no value contains Latin-script 'computer' (checked); per-slot headline variants for the unnamed fallback are a later slice (manager decision, option a).
