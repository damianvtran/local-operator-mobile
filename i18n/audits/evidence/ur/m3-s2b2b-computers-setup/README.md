# ur — M3 S2b-2b audit bundles (mobile.computers setup.*, route_invalid.*, your_computer; 27 keys)

Byte-identical copies of the programme's audit bundles; the files are not edited.
The directory name follows the `<locale><slice><round>` id convention of
`m3-s1-signin-computers/`; where a `record.json` carries no `audit_id`, or one
in another shape, the directory name is derived and the mapping is recorded here.

| Directory | Source bundle | `audit_id` in record.json | File | sha256 |
|---|---|---|---|---|
| `urs2b2b` | `m3s2b2b/audits/ur/` | none | `record.json` | `6867d06bc296b1bc6d8681dbb5c0af7325bad76db9f0c90456d821bed8a8d482` |
| `urs2b2b` | `m3s2b2b/audits/ur/` | none | `report.md` | `016cf6c80f2ef7e3f1c1234e4bb51090275ac618bff2d063ec5613d4f9b8c1f1` |
| `urs2b2b` | `m3s2b2b/audits/ur/` | none | `audit.log` | `2eaefa178cdd0417bbfd1efe05b693fd0dc96e1241ad2fa131fa63c197da250c` |
| `urs2b2br2` | `m3s2b2b/audits/ur-r2/` | none | `record.json` | `dcae1dde36f4fd08c9d031d0e866d112cd21a3eb4d8cd6aaf60d0feb7ffefe27` |
| `urs2b2br2` | `m3s2b2b/audits/ur-r2/` | none | `report.md` | `020e3df95f72ba9b4c5df7fdc87536192603daad696a1d2b3600b29030ad2dbb` |
| `urs2b2br2` | `m3s2b2b/audits/ur-r2/` | none | `audit.log` | `8c2ae70e79e62db7a6afa5b132400b56fbfba8f0036e1169e974e21157d9e148` |

## Provenance

- Brief: `brief-s2b2b.json` sha256 `9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67` (27 keys).
- Translator jobs/sessions: `21e12a3778c1`, `f866fbf7b531` (v2 session) (v1, then the v2 remediation), as recorded in the two `record.json` files.
- Draft v1 sha256: `aa7a5029f089a8920eb21700b64f01b8a45ee492fce87f4f845a10a1fd121c63`.
- Draft v2 sha256 (applied to `src/i18n/catalogues/ur/mobile.computers.json`): `7c089b934b892abc62f2d02a5cfdded492fa9e16948915b387a96f5b3cdd9bb0`; equal to the v2 hash in `urs2b2br2/record.json`.
- `urs2b2b` (round 1): auditor session `e12483c5cbc6`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed` (0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT).
- `urs2b2br2` (round 2): auditor session `c5f4eb470a3d`, model `anthropic/claude-opus-5-5` (no fallback recorded); verdict `passed`, no unresolved BLOCKER/MAJOR; every round-1 finding resolved or its rejection upheld.

## Route and review

- Route: ordinary git and scratchpad reads. `read_public_copy` was not used: core refuses mobile catalogue paths. The context sidecars are nested JSON and not routable through it.
- Native-speaker review: waived by the operator. An independent LLM audit (the two rounds above, each by a session independent of the translator and of the other round) was done instead.
- `your_computer` is the bare transliterated/native noun (کمپیوٹر) so it fits every refusal headline's postposition; no value contains Latin-script 'computer' (checked); per-slot headline variants for the unnamed fallback are a later slice (manager decision, option a).
- The only Latin-initial value is `setup.tui_label` (`TUI`): one strong-LTR token, nothing to reorder, so the auditor asked for no code change; `src/features/auth/ur-latin-initial-sites.test.ts` lists it in the whole-namespace premise.

## Deferred

- `UR-R2-N1` (NIT, non-gating; the line numbers quoted in the translator's v2 notes, not a catalogue value): deferred; see `urs2b2br2/report.md`.
