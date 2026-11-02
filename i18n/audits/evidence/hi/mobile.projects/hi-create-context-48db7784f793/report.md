# Hindi mobile.projects create/status audit — context addendum

Auditor: translation-auditor; model: openai/gpt-6.1-terra; session de7352a477ae. Translator job: 9e1563031717 (independent). Reviewed commit: 5d48015a75804c50638063492ecd6742ddf61af0.

## Verdicts
- mobile.projects.create: clean, 10 unique keys read in both languages and against their English context; no confirmed findings.
- mobile.projects.status: clean on translation, 7 unique keys read in both languages and against their English context; no confirmed findings. Rendered fit remains unverified.
- Overall: clean on the 17-key translation audit with a rendered-width caveat. No blocker or major finding. This is not a claim of native-speaker certification or visual QA.

The context confirms the identifier and tag examples, optional fields, form action, and status chips; the translations convey these roles. Both examples preserve the English bytes. The 34 source/target messages contain no placeholders, ICU syntax, markup or count, so no ICU branch or plural is applicable. Hindi is not RTL. The two action instructions use consistent polite imperative forms. Glossary consistency assessment is limited to these 17 keys; no claim is made about unrelated catalogues.

Width caveat: status.paused “रुका हुआ” has 8 Unicode code points versus 6 in “paused”; create.title “नया प्रोजेक्ट” has 13 versus 11 in “New project”. Code points are not pixels, especially in Devanagari; source uses wrapping chips with 44 pt targets (project-create.tsx 263–276). Flag for a narrow-screen, increased-font rendered check; no overflow is claimed. Per instruction no browser, Node, tests or installs were used.

## Method and prior incident
The preceding bundle hi-create-7def18afc31d contains 34 successful audited per-key catalogue reads and 17 structurally refused context-sidecar calls. The sidecar has nested JSON values and cannot be routed through read_public_copy's string-only catalogue parser; the operator explicitly authorized ordinary direct reads after marker scanning. The sidecar was rescanned: zero common redaction markers, SHA-256 5cf6fd4a2be5cf01f71ae4fea8380a0935afa42907d6273ae7331feaa1aef65b; only these 17 context entries were read directly. All prior bundle input hashes were revalidated unchanged.

Prior incident retained: a broad grep inadvertently surfaced excerpts of the sidecar following the structural refusal. Those excerpts were not relied upon in the prior verdict; this explicitly authorized, scoped read supplies the context for this addendum. The prior blocked bundle is preserved unmodified.
