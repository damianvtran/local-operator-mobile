# fr audit — round 2 DELTA — M3 S2b-1 — audit id frs2b1r2

- Auditor: i18n-auditor (team lopdev), session 9679eedbe7ab, model anthropic/claude-opus-5-5 (session header; no fallback). Independent of translator jobs d676bc7c4b78/0d15f1a2975a and round-1 auditor ae20f99bf5e3.
- Source 254e6fba (feat/i18n-m3-s2b1). All four input sha256 MATCH (see audit.log).
- **Verdict: PASS — passed.** 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.

## Mechanical (executed)
- Brief v1→v2: 41 entries, same order; only `verdict_forbidden` english+note differ.
- Draft v1→v2: 41 keys, same order; exactly the 7 keys in notes-fr-v2.md changed; 34 byte-identical (not re-audited).
- All 41 v2 values parse with src/i18n/messages.ts@254e6fba (node, old space 256 MB); 0 placeholder mismatches vs v2 English; changed keys: ’ only, NNBSP before : ; , no bidi controls.

## Round-1 findings
| ID | Key | Ruling |
|---|---|---|
| F-01 MAJOR | verdict_forbidden | RESOLVED — « le relais refuse lui aussi les requêtes provenant de toute autre origine » matches v2 EN "the relay itself also refuses requests from any other origin"; the invented "not from the tunnel" mechanism is gone. Same implicit "other than the allowed one" as EN. |
| F-02 | foreground_note | RESOLVED (verbatim suggestion) |
| F-03 | rotate_note | RESOLVED — « vous », « la valeur », « donc » restored |
| F-04 | verdict_tls | RESOLVED — « tout certificat autosigné » restores EN conditionality |
| F-05 | before_saving | RESOLVED — « sans aucune explication » |
| N-01 | rotate_label | RESOLVED — « Définir ou changer le mot de passe », 34 vs 26 chars (+31%). Role: CommandBlock header `<Text>` in a `flex-row flex-wrap` row with no `numberOfLines` → wraps (pushes Copy to next line on narrow phones), never clips. Not an overflow defect. |
| N-02 | test_again | RESOLVED — « Tester à nouveau »; Button in flex-wrap row, no `labelLines` → wraps. |
| N-03 | verdict_local_network(_ios) | REJECTION ACCEPTED — « Rien n’a répondu à cette adresse » is idiomatic, keeps the subject, consistent across both keys. |

## New findings
None. I checked the changed values for regressions (agreement, pronoun antecedents, NNBSP, em-dash spacing unchanged from v1) and found none.

## Claims not made
No rendered frame, no MT service, no ledger command run (writes were restricted to this directory).
