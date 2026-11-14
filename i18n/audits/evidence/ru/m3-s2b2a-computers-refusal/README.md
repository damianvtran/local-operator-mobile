# ru — M3 S2b-2a audit bundles (mobile.computers.refusal.*, 24 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `rus2b2a` | `m3s2b2/audits/ru/` | none | `record.json` | `4f399717b537688a8586b7afab26707718fa95b13fcd7e985f563ab40d981812` |
| `rus2b2a` | `m3s2b2/audits/ru/` | none | `report.md` | `b47772fc550922765d85924e551023ba79e45d95c1c1db08da0e6f22035561b9` |
| `rus2b2a` | `m3s2b2/audits/ru/` | none | `audit.log` | `e4ee611780c2aebc59d1ca8026c7163d80d8ca8aad86451eb89d219dcc276a94` |
| `rus2b2ar2` | `m3s2b2/audits/ru-r2/` | none | `record.json` | `3bafdc0107d696ccc07d80683e3f97285b3f3555a4ad86c6085cdb84104d713c` |
| `rus2b2ar2` | `m3s2b2/audits/ru-r2/` | none | `report.md` | `86f8f86212f40da338ada2ebc5187d155c992461c94ce6f87ff9002858c70941` |
| `rus2b2ar2` | `m3s2b2/audits/ru-r2/` | none | `audit.log` | `482c5c32dd897472ee7803a9a29b42234954b5c4ab9420fffb052021065d49e1` |

## Provenance

- Brief: `brief-s2b2a.json` sha256 `d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40` (24 keys).
- Translator jobs: `332734020f56`, `7cc5dbc90b02` (v1, then the v2 remediation).
- Draft v1 sha256: `ccbafb2df76eb2d73c7509394eadd268e886988f59b456c4df252c0e7d448f36`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/ru/mobile.computers.json`): `c393839d825ac456eb6c0f730db0fdaa1369382ad8827f0b667bec44daaf6d4d`; equal to the v2 hash in `rus2b2ar2/record.json`.
- `rus2b2a` (round 1): auditor session `476cde7c4696`, model `anthropic/claude-opus-5-5`; verdict `passed`.
- `rus2b2ar2` (round 2): auditor session `28e3915989d0`, model `anthropic/claude-opus-5-5`; verdict `passed`, no unresolved BLOCKER/MAJOR.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
