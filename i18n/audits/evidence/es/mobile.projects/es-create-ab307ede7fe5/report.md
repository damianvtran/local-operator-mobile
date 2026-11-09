# Independent Spanish audit — mobile.projects create/status

Auditor: translation-auditor, openai/gpt-6.1-terra, session ab307ede7fe5. Translator distinct job: 18c2bf0471c7. Scope: 17 newly added keys (10 create, 7 status); only these keys are assessed. English and context at HEAD 194558899182dedf18198eb9db9876131fa190a5; Spanish is uncommitted. File SHA-256 values and full key list are in record.json.

## Verdict

**mobile.projects: clean, with a non-blocking rendered-width check.** All 17 entries read individually with their English source and context; no blocker, major, minor or nit language finding. The register uses tú consistently in the instruction, infinitive for the action, sentence case, and proyecto/etiquetas consistently in this scope. Examples are retained as valid identifiers. Neither locale contains placeholders, ICU/plural branches, number/date skeletons or markup tokens in these 17 entries; plural-category comparison is inapplicable. Spanish is LTR, so RTL checks are not applicable.

## Width risk, not a proven defect

- `mobile.projects.status.qa`: current `control de calidad`, 18 Unicode code points versus English `qa`, 2. The source sidecar identifies a selectable chip. `project-create.tsx:263-271` uses `flex-wrap`, but the adjacent comment's two-row expectation does not establish actual fit. Flag for a rendered narrow-screen check, not a claim of overflow; `QA` is a possible shorter technical abbreviation only if understood and consistent with product terminology.
- `mobile.projects.status.done`: `completado` (10 versus 4); `mobile.projects.status.planning`: `planificación` (13 versus 8); `mobile.projects.create.tags`: `Etiquetas` (9 versus 4). Status chips merit the same visual check. Do not replace accurate text without measuring.

## Readback

- `mobile.projects.create.description` — EN: Description | ES: Descripción | context: Label for an optional project description.
- `mobile.projects.create.description_placeholder` — EN: What this project is for | ES: Para qué es este proyecto | context: Placeholder prompting an optional project description.
- `mobile.projects.create.name` — EN: Name | ES: Nombre | context: Label for the project identifier field; the nearby help states its grammar.
- `mobile.projects.create.name_placeholder` — EN: my-project | ES: my-project | context: Example of a valid project identifier; preserve the hyphen and use only letters, digits, dot, underscore or hyphen, never starting with a hyphen.
- `mobile.projects.create.status` — EN: Status | ES: Estado | context: Label for the project status choices.
- `mobile.projects.create.submit` — EN: Create | ES: Crear | context: Submits the new project form.
- `mobile.projects.create.tags` — EN: Tags | ES: Etiquetas | context: Label for optional project tags.
- `mobile.projects.create.tags_help` — EN: Separate with commas or spaces. | ES: Sepáralas con comas o espacios. | context: Explains how to separate multiple project tags.
- `mobile.projects.create.tags_placeholder` — EN: ios, q4 | ES: ios, q4 | context: Examples of two tags, separated by a comma; use valid short tag examples.
- `mobile.projects.create.title` — EN: New project | ES: Nuevo proyecto | context: Title of the sheet for creating a project.
- `mobile.projects.status.active` — EN: active | ES: activo | context: Display label for the project status code active; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.
- `mobile.projects.status.archived` — EN: archived | ES: archivado | context: Display label for the project status code archived; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.
- `mobile.projects.status.done` — EN: done | ES: completado | context: Display label for the project status code done; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.
- `mobile.projects.status.paused` — EN: paused | ES: pausado | context: Display label for the project status code paused; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.
- `mobile.projects.status.planning` — EN: planning | ES: planificación | context: Display label for the project status code planning; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.
- `mobile.projects.status.qa` — EN: qa | ES: control de calidad | context: Display label for the project status code qa; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.
- `mobile.projects.status.validation` — EN: validation | ES: validación | context: Display label for the project status code validation; translate the label, not the underlying code. Shown in the create sheet as a selectable chip.

## Method and limitations

Before value reads, scanned the three input files for `[REDACTED…]`, `<redacted>`, `***REDACTED***` (case-insensitive): zero in each; additionally scanned case-insensitive `redacted` as a broader marker check: zero in each. Scanned the project-create code, shared glossary and Spanish style guide for `redacted`: zero in each before reading. English keys were read through the sanctioned `read_public_copy` keyed route: 17 successful receipts, audit log `~/.local-operator/audit/public-copy-reads.jsonl`; the tool reported checkout HEAD above. Its SHA is for the returned keyed copy, not the whole file. A Spanish keyed request was actually attempted and refused because the catalogue differs from HEAD; no Spanish receipt is claimed. The sidecar is not routable. Spanish and sidecar were read directly after scanning. This is an LLM language audit, not a native-speaker certification or a full glossary audit. No app, screenshots, tests, Node, installations or browser were used. Counts are code points, not pixels or measured chip widths.
