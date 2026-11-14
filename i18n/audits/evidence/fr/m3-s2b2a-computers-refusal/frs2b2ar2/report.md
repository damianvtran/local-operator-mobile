# French (fr) round-2 DELTA audit — mobile.computers.refusal.* (M3 S2b-2a)

Auditor: i18n-auditor (lopdev), session c64a4d591431, model anthropic/claude-opus-5-5 (session system prompt; no fallback observed). Independent of translator (9fb915e773aa / 229d22205b83) and of the round-1 auditor session (41808e7144c1).
Brief sha256 d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40 · v1 f772103e61bbe87e18603b57b5152d360cf48a999a8fc04bafc96a8a192985f4 · v2 68e4448105633f3c82444a58def0f0fa94c3f7e2e93ed1dbe8909663df32a44b · notes-v2 c5604cac5df004a8accbcd1b5fae15d6f7788b1169fe1ba74c464c56c73924f8 — all recomputed, all match. Redaction marker hits: brief 0, v1 0, v2 0.

## Verdict: **passed** (0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT new; all 5 round-1 findings resolved)

## Mechanical (delta)
- v2 keys = brief keys, same 24, same order.
- Exactly 5 values differ v1→v2: relay_stopped_title, console_title, offline_next, console_next, certificate_next — the 5 the notes list. Raw `diff` of the two files: 10 changed lines (5 pairs); the other 19 values byte-identical.
- messages.ts (worktree @ cd249ed1) parses all 24 v2 values; parameter sets equal English for every key (0 mismatches); wait_seconds unchanged: 0,1→one, 2,5,30→other, 1000000→many.
- v2: 0 bidi controls, 0 non-NFC values, 0 ASCII apostrophes (U+2019 used); changed values contain only é è ’ — non-ASCII.

## Round-1 findings
| ID | Sev | Key | v2 | Status |
|---|---|---|---|---|
| F1 | MINOR | offline_next | « … Le dernier état connu de l’ordinateur figure ci-dessus. » | RESOLVED — possessive ambiguity gone; « ci-dessus » keeps 'earlier on this screen'. |
| F2 | MINOR | relay_stopped_title | « Le relais n’est pas lancé sur {subject}. » | RESOLVED — states 'not running', not 'broken'; agrees with « Relancez le relais » and « le connecteur est lancé ». |
| F3 | NIT | console_title | « {subject} nécessite une intervention dans Radient. » | RESOLVED — Radient untranslated; {subject} kept as a separate word; ~40-char heading budget plus subject, wraps per note. |
| F4 | NIT | console_next | « Ouvrez la console Radient pour y régler le problème. Se reconnecter sur ce téléphone n’y changera rien. » | RESOLVED — the two « y » refer to different things (the console; the problem) in separate sentences; both idiomatic, no ambiguity in reading. |
| F5 | NIT | certificate_next | « … ou remplacez tout certificat autosigné — … » | RESOLVED — indefinite, matches own_tunnel.verdict_tls; {scheme} intact, renders « l’adresse https:// ». |

No rejections to rule on.

## New findings on the delta
None. Considered and not raised: offline_next repeats « ordinateur » (« cet ordinateur … de l’ordinateur »): the repetition is the cost of removing F1's ambiguity, reads naturally, and does not merit a finding. « lancé » for the relay agrees with the existing catalogue (« exécute le relais », « est lancé »).

Read route: ordinary scratchpad and worktree reads; read_public_copy not used (core route refuses mobile catalogue paths).
