# Translation audit — on-device slice — fr / mobile.sidebar

Audit id: ondev-fr-cf2fe6 · Auditor: translation-auditor (team lopdev), session cf2fe68da622, model anthropic/claude-opus-5-5 · Translator session: 6029da975dc7 (independent)
Source: d1ed0e2a (feat/i18n-on-device-label), en sha256 fa75c73f… verified · Draft sha256 65fe290841522526d227cb3eb73f25ab8ce098c196db8ccdbf17b70f9613b2a8

## mobile.sidebar.row.on_device
English: `On {device}` · Draft: `Sur {device}`
« Sur {device} » — accurate; « sur » is the idiomatic French preposition for something running on a machine (« sur Studio Mac », « sur mon iPhone »). Identical to the shipped spoken fragment « sur {device} » apart from sentence-case capital, so visible and spoken forms agree. Frame 4 chars vs English 3 (+1): negligible against ~200 dp, name stays first-visible and only the name's tail can be ellipsized. Plain text, no full stop, no elision issue (no « l' » before a vowel-initial name). Register neutral.
Placeholder: brace set {device} exact (audit.log). Bidi controls: none. NFC: yes.

## mobile.sidebar.row_label.join
English: `{first}, {second}` · Draft: `{first}, {second}`
« {first}, {second} » — comma + space is the French enumeration separator (no espace insécable before a comma). Byte-identical to fr withheld_reasons_join. No « et », no full stop, order kept.
Placeholders: {first},{second} exact, order kept (audit.log).

## Findings
None. Both keys clean.

## Verdict
mobile.sidebar (2 keys read): **passed** — 0 BLOCKER/MAJOR.
Repo parser: both values parse with the worktree's parseMessage and format as expected (audit.log). LLM audit only; native-speaker review not a gate.
