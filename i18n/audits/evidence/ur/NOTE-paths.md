# Publication normalisation of these bundles

These audit bundles were written by agents running on one developer's machine,
so their captured commands, logs and quotes named absolute paths under that
machine's home directory, its session scratchpad and the operating system's
temporary directory. This repository is public and those paths are meaningless to
anyone else, so they were normalised **after the audits, before merge**.

| Written by the auditors | Here |
| --- | --- |
| the mobile checkout | `<repo>` |
| the core checkout beside it | `<core>` |
| the auditing session's scratchpad | `<scratch>` |
| the operating system's temporary directory | `<tmp>` |
| the machine's home directory prefix | `~` |

## What this changes, stated exactly

The auditors hashed their own artefacts — `report.md` and `audit.log` — into each
`record.json`, so normalising those files necessarily invalidated those hashes.
Rather than delete the attestations, each affected record now carries **both**:

- `sha256` — the hash of the bytes in this repository (normalised);
- `sha256_pre_normalisation` — the value the auditor wrote at audit time.

`report.md` files that quoted the pre-normalisation hash now quote the current
one and say so in a closing note. **36 artefact hashes were recomputed and all 36
verify against the files as committed.**

Round-1 records for namespaces that were remediated attest the **round-1**
catalogue, not the shipped one. Those records carry a `superseded_by` block naming
the round-2 bundle and the shipped hash, so a reader cannot mistake the
difference for drift.

## What this does not touch

The audited catalogue and the English source: their hashes are unchanged, and the
round-2 records' `input_hashes.target.sha256` still equal the shipped files. The
findings, verdicts, and every command's arguments beyond a path prefix are also
unchanged. No `report.md` prose was rewritten.
