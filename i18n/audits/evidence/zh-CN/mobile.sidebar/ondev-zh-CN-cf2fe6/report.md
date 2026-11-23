# Translation audit — on-device slice — zh-CN / mobile.sidebar

Audit id: ondev-zh-CN-cf2fe6 · Auditor: translation-auditor (team lopdev), session cf2fe68da622, model anthropic/claude-opus-5-5 · Translator session: 6029da975dc7 (independent)
Source: d1ed0e2a (feat/i18n-on-device-label), en sha256 fa75c73f… verified · Draft sha256 a1ef25567cd36ef793c4c676b50cd4db3bcaee5b69d57d2145c1fc4f5e10a18b

## mobile.sidebar.row.on_device
English: `On {device}` · Draft: `在{device}上`
「在{device}上」 — natural circumfix for 'running on a device'; byte-identical to the shipped row_label.on_device (no case in Han script, so identical visible/spoken forms is correct). No CJK–Latin spacing, consistent with the existing key and catalogue. Frame = 2 wide glyphs (~4 Latin widths) vs 3. Trailing 上 follows the name, so a name long enough to ellipsize clips 上 (renders 「在MacBook Pro of…」): the leading 在 still marks location and the name remains first-visible, so this meets the brief's 'name must stay visible' requirement; dropping 上 would be less idiomatic. Not a finding.
Placeholder: brace set {device} exact (audit.log). Bidi controls: none. NFC: yes.

## mobile.sidebar.row_label.join
English: `{first}, {second}` · Draft: `{first}，{second}`
「{first}，{second}」 — full-width comma U+FF0C, no spaces; matches the brief's locale_hint. Deliberately differs from withheld_reasons_join '、' (enumeration comma for homogeneous nouns): row-label fragments are heterogeneous clauses (title, 等待你批准, 在…上, 当前已打开), for which GB/T 15834 prescribes '，', and the catalogue's own clause join row.asks_not_blocker '{asks}，不阻塞智能体工作' uses '，'. I verified both catalogue strings. Correct choice; not a consistency defect since the two keys join different kinds of unit. Never 和, no 。.
Placeholders: {first},{second} exact, order kept (audit.log).

## Findings
None. Both keys clean.

## Verdict
mobile.sidebar (2 keys read): **passed** — 0 BLOCKER/MAJOR.
Repo parser: both values parse with the worktree's parseMessage and format as expected (audit.log). LLM audit only; native-speaker review not a gate.
