# Translation audit — on-device slice — es / mobile.sidebar

Audit id: ondev-es-cf2fe6 · Auditor: translation-auditor (team lopdev), session cf2fe68da622, model anthropic/claude-opus-5-5 · Translator session: 6029da975dc7 (independent)
Source: d1ed0e2a (feat/i18n-on-device-label), en sha256 fa75c73f… verified · Draft sha256 997a975747dbf81930803af8890f648c5a714ea0f4d271dc76f836c215169d9f

## mobile.sidebar.row.on_device
English: `On {device}` · Draft: `En {device}`
«En {device}» — accurate and idiomatic for location on a device («En Studio Mac», «En el iPhone de…» would only arise from the user's own name). Identical to the shipped fragment «en {device}» save sentence-case. Frame 3 chars = English. No article needed (proper-name label). No full stop.
Placeholder: brace set {device} exact (audit.log). Bidi controls: none. NFC: yes.

## mobile.sidebar.row_label.join
English: `{first}, {second}` · Draft: `{first}, {second}`
«{first}, {second}» — Spanish enumeration comma + space; byte-identical to es withheld_reasons_join. No «y», no full stop, order kept.
Placeholders: {first},{second} exact, order kept (audit.log).

## Findings
None. Both keys clean.

## Verdict
mobile.sidebar (2 keys read): **passed** — 0 BLOCKER/MAJOR.
Repo parser: both values parse with the worktree's parseMessage and format as expected (audit.log). LLM audit only; native-speaker review not a gate.
