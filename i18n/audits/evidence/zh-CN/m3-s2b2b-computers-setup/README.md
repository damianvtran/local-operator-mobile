# zh-CN — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `zh-CNs2b2b` | `m3s2b2b/audits/zh-CN/` | none | `record.json` | `72a5c83114c32e40acc31f695a485354ee8929900a828a58f4dc5963692f7f90` |
| `zh-CNs2b2b` | `m3s2b2b/audits/zh-CN/` | none | `report.md` | `289e711ce91defe168ff69b88c548da092b10c51182b5d44b1d138ca9d68fee9` |
| `zh-CNs2b2b` | `m3s2b2b/audits/zh-CN/` | none | `audit.log` | `f852e2190b942ab113900eb819fd6db1fde4c3885ef73190e7d31cd465b1fb54` |
| `zh-CNs2b2br2` | `m3s2b2b/audits/zh-CN-r2/` | none | `record.json` | `34813f2c74c05e976739aa39e025559f5baf954cd186f70a5ff6d7338c4071d6` |
| `zh-CNs2b2br2` | `m3s2b2b/audits/zh-CN-r2/` | none | `report.md` | `70c2b22e9c06527c7bf91a2ae19863a8469cc44a8dcc0e48a2719492e181a8b8` |
| `zh-CNs2b2br2` | `m3s2b2b/audits/zh-CN-r2/` | none | `audit.log` | `19334d182c00d787b8c8b2f11dbab01791e18220f84a747ade616e3aa105b7dc` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `40852865913c`, `dc349a33aded` (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `b53ea37786ad51ed7a5fa8a992eb093fc9ddddc8cd1bea553feb8425bef6b99c`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/zh-CN/mobile.computers.json`): `6abc5a181d3b63a312273af4e0b4ec15dbed81abda17503655aa337299e63d23`; equal to the v2 hash in `zh-CNs2b2br2/record.json`.
- `zh-CNs2b2b` (round 1): auditor session `6877c6310b02`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT).
- `zh-CNs2b2br2` (round 2): auditor session `a7ef3ef01f5e`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved or its rejection upheld.
- `zh-CNs2b2br2` was written to a fallback location and copied into the lane's `audits/zh-CN-r2/`: record.json `written_location_note` — "auditor scratchpad; guardrail refused writes to /Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/m3s2b2b/audits/zh-CN-r2 (brief fallback)".

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `zh-CNs2b2br2/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.
