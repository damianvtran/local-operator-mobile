# Hindi mobile.projects create/status audit

Auditor: translation-auditor; model: openai/gpt-6.1-terra; session: de7352a477ae. Translator job: 9e1563031717 (separate). Revision: 5d48015a75804c50638063492ecd6742ddf61af0.

## Verdicts
- mobile.projects.create: 10/10 English and Hindi values read. No confirmed translation finding in the values. Provisional, not fully audited: the context sidecar was refused for every key and could not be read through the approved interface.
- mobile.projects.status: 7/7 English and Hindi values read. No confirmed translation finding. Provisional: sidecar refused; rendered chip fit not measured.
- Overall: BLOCKED / incomplete, not a clean terminal verdict. 17 unique keys, 34 catalogue values actually read. No placeholders, ICU syntax or markup in any of these 34 values; therefore no plural branch is applicable. The identifier and tag examples are preserved byte-for-byte. No RTL audit applies to Hindi.

## Width and interface
The project-create.tsx control uses wrapping chips with 44 pt targets (lines 263–276). Hindi paused ‘रुका हुआ’ is 8 Unicode code points against 6 for ‘paused’; new project is 13 against 11. Code point counts are not measured pixel width, especially for Devanagari shaping; no overflow is asserted. A rendered narrow-screen/font-scale check is outstanding. Per instruction no browser, Node, tests or install were used.

## Access and incident disclosure
All 17 public-copy requests for the English context sidecar returned ‘refused: catalogue keys and values must be strings’. Sidecar is unroutable through this interface; direct reading is not authorized. A subsequent overly broad grep on src inadvertently returned small excerpts of that refused sidecar alongside code results. This was an accidental boundary breach; none of those excerpts were relied on for the verdict and no further direct sidecar reads were attempted. Status-control code was scanned for common redaction markers before targeted reading. No native-speaker certification is claimed.

## Findings
None confirmed in the 17 value pairs. Context-dependent meaning and rendered fit remain unverified, not silently passed.
