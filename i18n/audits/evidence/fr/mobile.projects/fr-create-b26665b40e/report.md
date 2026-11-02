# Independent French audit — mobile.projects create/status

Auditor: translation-auditor, openai/gpt-6.1-terra; independent of translator job 0ce612caa381 (same model, different agent). Scope: 17 newly added keys (10 create, 7 status). Source context and French diff read side by side.

## Finding

- MINOR — `mobile.projects.status.qa`: current `contrôle qualité`; proposed: retain meaning but **check rendered fit**; a possible shorter label is `qualité` only if context unambiguously conveys QA. English `qa` is 2 code points versus 16; `project-create.tsx:263–266` expects seven chips in two rows, while wrapping is enabled. This is a real width risk, not a claim of observed overflow.

Other materially longer text to check: `create.tags` 4→10 (`Tags` → `Étiquettes`), `create.tags_help` 31→44, `create.title` 11→14, `status.done` 4→7, `status.paused` 6→8 and `status.planning` 8→13; the latter are chips. No rendered evidence under the resource hold. Counts are code points, not device widths.

## Verdict

`mobile.projects`: clean with minor width follow-up; 17/17 keys examined. No blockers or majors. Meaning and formal register match context; no glossary drift detected among these keys; name/tag examples comply with source context; none of the 17 has placeholders, ICU branches, markup, numbers/date skeletons, or plural messages. French is not RTL. No native-speaker review claimed.

## Provenance and constraints

English 17/17 keyed public-copy requests succeeded. French 17/17 keyed requests refused because the target is uncommitted; French values were visible in the earlier ordinary git diff and reviewed from that diff; do not describe those reads as keyed successes. English context sidecar was read directly after checking for redaction markers; source/target catalogue bytes were also marker-checked before keyed requests. Hashes, individual receipts and per-key comparisons are in `record.json` and `audit.log`. Source context and code show chips wrap; no pixel-level fit claim is made. No Node, tests, browser or installation performed.
