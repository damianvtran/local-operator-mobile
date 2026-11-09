# Russian project creation audit

Auditor: translation-auditor; model: openai/gpt-6.1-terra. Independent of translator job bf74d41ccb23. Scope: 17 new keys in mobile.projects.create (10) and mobile.projects.status (7).

## Findings

- Minor — mobile.projects.status.qa: current «тестирование»; proposed «тестирование» (retain pending rendered check). Twelve characters against source «qa» (two) in a wrapping chip group; check the narrowest supported viewport for crowding and unexpected extra rows. No overflow was demonstrated.
- Minor — mobile.projects.status.planning: current «планирование»; proposed «планирование» (retain pending rendered check). Twelve characters against eight in «planning»; check the narrow chip layout before declaring width safe.
- Minor — mobile.projects.status.done: current «завершён»; proposed «завершён» (retain pending rendered check). Eight characters against four in «done»; check the same layout rather than assuming width from character counts.

## Verdict

- mobile.projects.create: clean, 10 keys. Examples retain their valid Latin form; formal plural imperative is consistent with nearby existing copy.
- mobile.projects.status: linguistically clean with three width-check flags, 7 keys. Status chips wrap in project-create.tsx; no rendered proof was requested or performed.
- Overall: 17/17 keys compared, no blocker or major. Width remains unverified; no claim of actual overflow. No placeholders, ICU branches, number/date skeletons, or markup appear in these 17 source values. Russian plural rules therefore do not apply here.

## Acquisition and limitations

Inputs were scanned for sensitive credential patterns before catalogue reads; zero matches. read_public_copy returned 17 English successes and refused all 17 Russian reads because the translator's file differs from HEAD. The Russian content was read directly as a redaction-scanned public catalogue; English context sidecar was directly read after the same scan (not a read_public_copy receipt). Exact results and tool call identifiers are in audit.log. File SHA-256 values are in record.json; public-copy receipt hashes refer to individual returned key payloads, not whole-file hashes. No catalogue changes, Node, tests, installs, or browser were performed.
