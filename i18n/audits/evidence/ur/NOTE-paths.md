# Publication normalisation of these bundles

These audit bundles were written by agents running on one developer's machine,
so their captured commands and logs named absolute paths under that machine's
home directory and its session scratch root. This repository is public and those
paths are meaningless to anyone else, so they were normalised **after the audits,
before merge**: nothing in the evidence's substance changed, and the substitution
is mechanical.

| Written by the auditors | Here |
| --- | --- |
| the mobile checkout (`…/local-operator-mobile`) | `<repo>` |
| the core checkout beside it (`/…/local-operator`) | `<core>` |
| the auditing session's scratchpad | `<scratch>` |
| the machine's home directory prefix | `~` |

What this does **not** touch: the audited catalogue, its hashes, the findings,
the verdicts, or any command's arguments beyond the path prefix. No `record.json`
attested the hash of its own `audit.log`, so normalising a log cannot invalidate a
record; the hashes in each record are of the CATALOGUE and the English source, and
were re-verified against the shipped files at review.

This file is the record of the edit. A reader who needs the original path can put
the conventional home-directory prefix back in front of the mapped form.
