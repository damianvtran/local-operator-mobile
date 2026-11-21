# Translation audit — on-device slice — ru / mobile.sidebar

Audit id: ondev-ru-cf2fe6 · Auditor: translation-auditor (team lopdev), session cf2fe68da622, model anthropic/claude-opus-5-5 · Translator session: 6029da975dc7 (independent)
Source: d1ed0e2a (feat/i18n-on-device-label), en sha256 fa75c73f… verified · Draft sha256 176e8c311d7855c7cebb5409ad6b1916dc68a6ee22db06e1d437d3f68dea0d1d

## mobile.sidebar.row.on_device
English: `On {device}` · Draft: `На {device}`
«На {device}» — 'на' is the standard Russian preposition for running on a computer/phone; identical to the shipped fragment «на {device}» save sentence case. Frame 3 chars = English. Latin names (the common case) are indeclinable, so «На Studio Mac» is fully grammatical. See A-ru-1 (NIT) for Cyrillic common-noun names.
Placeholder: brace set {device} exact (audit.log). Bidi controls: none. NFC: yes.

## mobile.sidebar.row_label.join
English: `{first}, {second}` · Draft: `{first}, {second}`
«{first}, {second}» — Russian enumeration comma + space; byte-identical to ru withheld_reasons_join. No «и», no full stop, order kept.
Placeholders: {first},{second} exact, order kept (audit.log).

## Findings
- **A-ru-1 NIT** `mobile.sidebar.row.on_device` — current `На {device}` → Keep «На {device}»; only correct the translator note. The note says the name needs no case ending because it is 'an indeclinable label'; that holds for Latin names, but a Cyrillic common-noun name (e.g. «Ноутбук») renders «На Ноутбук» instead of the prepositional «На ноутбуке». This is inherent to the source's rule that {device} is never altered and is shared with the shipped fragment «на {device}»; a case-free frame like «Устройство: {device}» costs ~10 chars on a ~200 dp row, so keeping «На» is the right trade-off.

## Verdict
mobile.sidebar (2 keys read): **passed** — 0 BLOCKER/MAJOR, 1 NIT (non-gating).
Repo parser: both values parse with the worktree's parseMessage and format as expected (audit.log). LLM audit only; native-speaker review not a gate.
