# Urdu archived wording — delta audit

Auditor: translation-auditor, openai/gpt-6.1-terra; session 37d4a14cbda7. Scope: 52e26313ca7b7f628b2fb70a42d0a11cf1cc6a4d..543111e908ea9a5657236e5ded084810d235775e; independent of translator job c9c413086a50. This is a focused review of one changed key, not a fresh audit of the other 16 keys.

## Verdict

**Clean — mobile.projects.status.archived, one key pair read.** English `archived`; old Urdu `محفوظ شدہ`; new Urdu `آرکائیو شدہ`. The new wording unambiguously names an archived state instead of merely saved or preserved and resolves the prior minor wording finding. The unchanged English context says the label identifies the `archived` status code on a selectable create-sheet chip; it is a suitable concise state label. There are no placeholders, ICU branches, markup, numeric skeletons or embedded Latin runs in the new value. RTL rendering and physical chip width were not exercised; the label has 11 Unicode code points versus 8 in English, so check layout in a rendered screen rather than infer overflow.

Two committed per-key public-copy reads succeeded at the head. The source and context hashes match the earlier reviewed input; the prior context note was reused, not reread. Marker scans of source, target and context at both commits and checkout found no matches for the listed pattern. A JSON key-value comparison found exactly this key changed. No tests, Node, install, browser, or translation edits. The separate earlier QA-chip-width and mixed-direction-example observations remain outside this delta's scope.
