# Vietnamese project creation: context-only delta

Auditor: translation-auditor, openai/gpt-6.1-terra. Head: edff6663a3efc5492af73600da94096dcac05c22. Prior linguistic audit: `vi-create-audit-4f6866fce770`; its English and Vietnamese file hashes match the current inputs exactly.

- `mobile.projects.create`: **clean against context**, 10 keys. The name field is a project identifier; `my-project` preserves its valid hyphenated example. The two tag examples and separator guidance match the sidecar. Optionality is conveyed by the UI rather than asserted by the labels, consistent with English.
- `mobile.projects.status`: **clean against context**, 7 keys. Translations are display labels for selectable chips rather than changes to status codes. No context-driven wording finding.
- Overall: **clean context delta**, 17 keys; prior linguistic clean verdict remains subject to a rendered chip-width check, not conducted here. No translated code or tests changed.

The nested English sidecar was read directly under explicit authorization after the literal `[REDACTED]` marker scan. Each English and Vietnamese value was read through a successful keyed `read_public_copy` call at the requested head. An initial batch timed out after 30 seconds before producing a result; the successful batch was rerun with a longer timeout. No Node, tests, browser, installation, or signals used. See record.json for hashes and audit.log for receipts.
