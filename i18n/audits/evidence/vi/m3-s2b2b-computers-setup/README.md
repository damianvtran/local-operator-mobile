# vi — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `vis2b2b` | `m3s2b2b/audits/vi/` | none | `record.json` | `d5471f146d1ace37ec3339a2d9f72f6de3a1337851df8bc995dfa90616d425c9` |
| `vis2b2b` | `m3s2b2b/audits/vi/` | none | `report.md` | `47724546fca47f1e3dd7c6853360a97062a8a4568ba648a75519e0cbc21d6b17` |
| `vis2b2b` | `m3s2b2b/audits/vi/` | none | `audit.log` | `0f309215a15e321425b8d3ada708a6532f6d90f7d8fc18859481a60319721943` |
| `vis2b2br2` | `m3s2b2b/audits/vi-r2/` | none | `record.json` | `d2ec12ba24aaed5a1f86916ffdd1f9840afa941ff004dc96e2dc878e82e17881` |
| `vis2b2br2` | `m3s2b2b/audits/vi-r2/` | none | `report.md` | `c515578a7a08e80521e5768abd29a4e59393b70f22836446860534bebc8579bd` |
| `vis2b2br2` | `m3s2b2b/audits/vi-r2/` | none | `audit.log` | `2408580e2a962bc655e5c99c85f6fb578aef6686ba9824aa04f629b129405ecd` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `64abbc676f27`, `6a9c0ad96fff` (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `1c68a37a66d0442e774bd0081314503a4d0d1c341cedada3637174536abfd359`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/vi/mobile.computers.json`): `5edfb40e9dab476a844bb7b201f32890d09e434ed7a2c98dd58244f69a8de755`; equal to the v2 hash in `vis2b2br2/record.json`.
- `vis2b2b` (round 1): auditor session `3c4d0d641ed3`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 0 MINOR, 4 NIT).
- `vis2b2br2` (round 2): auditor session `18c977d47179`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved or its rejection upheld.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `vis2b2b/audit.log` contains 1 literal `[redacted]` string in a command line: the auditor's own check that no redaction marker reached the brief or the drafts (it found none). It is not a redacted value.

## Deferred

- `VI-R2-N1` (NIT, non-gating): deferred; see `vis2b2br2/report.md`.
