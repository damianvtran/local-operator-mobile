# zh-CN mobile.projects — independent audit

Auditor: translation-auditor, openai/gpt-6.1-terra, session c5e41b9f7f26. Translator: job 9c9b184d11aa. HEAD: 8d0ee6a4082a2b9c19b331eab724637797150798.

## Finding

- **Minor — width, `mobile.projects.status.qa`**: current `质量测试`; proposed `QA`, or retain it after a rendered chip-width check. Four CJK characters are materially wider than the source `qa` in a selectable status chip; no visual check was performed.

## Verdict

`mobile.projects`: **clean with non-blocking width check**; 17 of 17 scoped keys read in both languages. Overall: **clean with the same follow-up**. Wording, status distinctions, register, both identifier/tag examples, and within-namespace terminology were checked. The scoped strings contain no ICU, interpolation placeholders, date/number skeletons or markup; Chinese is not RTL. No translation edit was made.

The English context sidecar was read directly after marker scan in the preceding blocked attempt; `read_public_copy` refused it because its values are objects, not strings. English and zh-CN key reads in this completed pass produced 34 successful keyed receipts pinned to HEAD; IDs and returned-value hashes are in record.json. File hashes and scope are recorded there. Only the projects namespace was consulted for terminology; no native-speaker certification or rendered check is claimed. Tests, Node, installs and browser were not used. Prior blocked evidence was preserved.
