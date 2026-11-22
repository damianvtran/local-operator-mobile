# French move-picker translation audit — round 1

**Verdict: PASS with two deferred minor width risks; 0 blocker/major linguistic findings.** Read **7/7 new keys** in `mobile.remote_sessions.move_pick.*`; this is not an audit of the entire pre-existing namespace.

Source: `9362cce8a631791b676b2d2c9eda90c43fc7e11c`. Translator `3e5cf4a65579`; independent auditor `e5caed1bcb4e`. Actual auditor model **openai/gpt-6.1-sol**, per visible quota-fallback receipt. Translator also disclosed that model; independence is by distinct session/agent, not model brand.

## Route and provenance
Ordinary explicitly approved absolute git/worktree and scratch file reads (Python pathlib/json, shell cat/sed; git rev-parse/ls-files). Nested JSON context read directly; read_public_copy was not invoked and no public/keyed-reader receipt is claimed. Mobile has no tracked locale style/glossary file; core French style/glossary read as shared reference and checked against actual mobile catalogues. No repository edits.

Frozen brief and draft SHA-256 both match delegated values; English, context and component match all three frozen authoring hashes. Full input hashes are in record.json. No edits/commits/hooks/tests/build/browser/native/install; no human-native proof is claimed.

## Per-key audit

### `mobile.remote_sessions.move_pick.cannot_reach`
- English: Can't reach {device}
- French: {device} est injoignable
- Analysis: Accurate calm reachability status, consistent with shipped « injoignable ». Subject is the remote computer, not phone connectivity. Exact {device} is preserved once; no article/gender rewriting or name translation. Arbitrary-name substitution checks are string checks only.
- Verdict: **passed**. Codepoints EN → FR: 20 → 24; ratio 1.2.

### `mobile.remote_sessions.move_pick.destination_heading`
- English: Move or copy to
- French: Déplacer ou copier vers
- Analysis: Natural infinitive heading preserving both déplacer and copier, matching row_long_press_hint. « vers » introduces destinations rather than claiming work has begun. No final punctuation. Width risk F1 only.
- Verdict: **passed_with_minor_width_risk**. Codepoints EN → FR: 15 → 23; ratio 1.5333.

### `mobile.remote_sessions.move_pick.discovery_help`
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- French: Seuls les appareils associés aux sessions visibles sont proposés. Un appareil sans session visible ne peut pas encore être sélectionné. Ouvrez Local Operator sur l’autre ordinateur, puis tirez la liste des sessions vers le bas pour l’actualiser.
- Analysis: Accurately restricts offered destinations to visible sessions, rather than claiming network-wide discovery. « pas encore » preserves yet; both ordered steps remain: open Local Operator on the other computer, then pull the session list downward to refresh. Professional vous imperatives Ouvrez/tirez; appareil/session/actualiser match the existing catalogue. Product name byte-exact. Width risk F2 only.
- Verdict: **passed_with_minor_width_risk**. Codepoints EN → FR: 178 → 245; ratio 1.3764.

### `mobile.remote_sessions.move_pick.no_answer`
- English: It did not answer when this computer asked.
- French: Il n’a pas répondu à la demande de cet ordinateur.
- Analysis: « Il » refers to the previously displayed remote ordinateur; « cet ordinateur » remains the connected relay computer, not téléphone. « à la demande » naturally renders the request/answer relationship. Source usage confirms trimmed server reason wins and this is only the fallback; no server text translated.
- Verdict: **passed**. Codepoints EN → FR: 43 → 50; ratio 1.1628.

### `mobile.remote_sessions.move_pick.no_devices`
- English: No other devices are visible.
- French: Aucun autre appareil n’est visible.
- Analysis: Preserves other and visible; does not infer offline status or absence from the network. Singular agreement after Aucun is grammatical, not a missing ICU plural. appareil matches glossary.
- Verdict: **passed**. Codepoints EN → FR: 29 → 35; ratio 1.2069.

### `mobile.remote_sessions.move_pick.on_this_computer`
- English: On this computer
- French: Sur cet ordinateur
- Analysis: Natural compact location fragment using ordinateur, parallel to shipped sidebar « Sur {device} ». Does not replace relay computer with phone; no punctuation drift.
- Verdict: **passed**. Codepoints EN → FR: 16 → 18; ratio 1.125.

### `mobile.remote_sessions.move_pick.right_now`
- English: Right now
- French: Actuellement
- Analysis: « Actuellement » naturally labels current location, avoiding the urgency of « Tout de suite ». Sentence case and no punctuation match neighboring headings.
- Verdict: **passed**. Codepoints EN → FR: 9 → 12; ratio 1.3333.

## Findings and dispositions

### F1 — minor — `mobile.remote_sessions.move_pick.destination_heading`
- Current: Déplacer ou copier vers
- Proposed text: **retain unchanged** — Déplacer ou copier vers
- Reason: 23 versus 15 source codepoints (+53.3%) in a compact heading; wrapping is allowed but fit has not been rendered.
- Action: Retain this accurate wording; flag for narrow-phone rendered wrapping/height verification in the owning visual lane. No translator rewrite required on this evidence.
- Disposition: deferred — outside this read-only linguistic audit; no minor-only new translation round.

### F2 — minor — `mobile.remote_sessions.move_pick.discovery_help`
- Current: Seuls les appareils associés aux sessions visibles sont proposés. Un appareil sans session visible ne peut pas encore être sélectionné. Ouvrez Local Operator sur l’autre ordinateur, puis tirez la liste des sessions vers le bas pour l’actualiser.
- Proposed text: **retain unchanged** — Seuls les appareils associés aux sessions visibles sont proposés. Un appareil sans session visible ne peut pas encore être sélectionné. Ouvrez Local Operator sur l’autre ordinateur, puis tirez la liste des sessions vers le bas pour l’actualiser.
- Reason: 245 versus 178 source codepoints (+37.6%) in phone body copy; added height/wrapping needs a rendered check, not an inference from counts.
- Action: Retain this accurate wording; flag for narrow-phone rendered wrapping/height verification in the owning visual lane. No translator rewrite required on this evidence.
- Disposition: deferred — outside this read-only linguistic audit; no minor-only new translation round.

## Mechanical results / limitations
All seven exact key values, frozen hashes and context rows verified independently. `{device}` appears exactly once only in cannot_reach; simple braces balanced, three malformed negative controls rejected. NFC passed, 0 bidi controls, 0 Arabic characters in French values. No plural/select/date/number skeleton or markup; CLDR plural branches are N/A. Arbitrary Latin, CJK and Arabic names survived literal substitution verbatim; this is not a runtime formatter or bidi rendering test.

Explicit redaction-marker scan: **0 copy-input hits** (brief key/context/glossary payload, draft values, English and context). A first whole-file scan encountered 8 literal marker strings in the translator’s scan-pattern metadata; inspected those exact matches before classifying. They are not redacted UI values. Both initial failure and final actual checks remain in audit.log; no claim of zero raw-file literals.

Pseudo examples are mechanical synthetic padding, not native/browser-fit evidence. Formula: bracket the French source and append a space plus ceil(35% × source codepoints) tildes; placeholders untouched. Heading pseudo example: `⟦Déplacer ou copier vers ~~~~~~~~~⟧` (35 codepoints). Help pseudo example is logged in full (334 codepoints). Measurements count source Unicode codepoints, including whitespace and unexpanded tokens, not cells or pixels. No stronger fit conclusion is available. Long device names are also an explicit unresolved rendered risk.

## Separate process gap
**Source-hook evidence GAP OPEN** (delegator-provided status, not independently executed). Not a linguistic failure, and not fixed by this audit. No repository ledger or source-hook receipt was created.

## Namespace / overall verdict
`mobile.remote_sessions` — scoped seven new move_pick values: **linguistically clean, 7/7 read; PASS with two deferred minor expansion risks**. Overall same verdict; 0 blocker, 0 major, 2 minor width risks, 0 nits. Existing catalogue values used for context/glossary only, not represented as a full-namespace pass. Human native-speaker requirement waived; this is an independent LLM audit only.
