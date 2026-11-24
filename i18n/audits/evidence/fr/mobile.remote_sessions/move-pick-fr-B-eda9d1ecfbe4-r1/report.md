# French fresh B audit — Move PickBody

Frozen source: `9362cce8a631791b676b2d2c9eda90c43fc7e11c`. Locale: fr. Namespace: `mobile.remote_sessions.move_pick`. Exactly **7 keys read and judged**; no whole-app audit.

## Independence and provenance
B auditor: session `eda9d1ecfbe4`, actual model `openai/gpt-6.1-sol`, verified by the visible model-switch receipt (temporary fallback from anthropic/claude-opus-5-5 due to provider quota failure). Translator `3e5cf4a65579`; A auditor `e5caed1bcb4e`: distinct sessions, same-model actors allowed. A reasoning/report was not used for judgement. The ledger necessarily exposed A status/minor summaries during input discovery; fresh comparison was made from the actual seven values, English, sidecar, usage and glossary before schema inspection. A record was subsequently inspected for field schema only. No native-human proof; human review waived.

## Per-key linguistic assessment

### mobile.remote_sessions.move_pick.cannot_reach
- EN: Can't reach {device}
- FR: {device} est injoignable
- PASS: Natural concise status. Injoignable matches existing French remote/session statuses. The arbitrary computer name remains a single opaque device placeholder; no translation or grammatical inflection is imposed on its contents.
- Width: 20 → 24 codepoints (1.2×); placeholders unexpanded; not rendered proof.

### mobile.remote_sessions.move_pick.destination_heading
- EN: Move or copy to
- FR: Déplacer ou copier vers
- PASS: Natural infinitive section heading, not a started-operation assertion. Both déplacer and copier are preserved; vers correctly introduces destination choices. Existing row hint uses déplacer ou copier.
- Width: 15 → 23 codepoints (1.533×); placeholders unexpanded; not rendered proof.

### mobile.remote_sessions.move_pick.discovery_help
- EN: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- FR: Seuls les appareils associés aux sessions visibles sont proposés. Un appareil sans session visible ne peut pas encore être sélectionné. Ouvrez Local Operator sur l’autre ordinateur, puis tirez la liste des sessions vers le bas pour l’actualiser.
- PASS: Idiomatic professional French with Ouvrez and tirez (vous). Visible sessions constrain the eligible devices, rather than claiming network-wide discovery. Both opening Local Operator on the other computer and pulling the session list downward to refresh remain explicit. Added downward direction explains the mobile gesture, not a different operation.
- Width: 178 → 245 codepoints (1.376×); placeholders unexpanded; not rendered proof.

### mobile.remote_sessions.move_pick.no_answer
- EN: It did not answer when this computer asked.
- FR: Il n’a pas répondu à la demande de cet ordinateur.
- PASS: Il naturally refers to the remote ordinateur in this status context. La demande de cet ordinateur retains the connected-computer requester, without reassigning it to the phone. Calm client fallback only; the source expression preserves nonblank server reasons verbatim.
- Width: 43 → 50 codepoints (1.163×); placeholders unexpanded; not rendered proof.

### mobile.remote_sessions.move_pick.no_devices
- EN: No other devices are visible.
- FR: Aucun autre appareil n’est visible.
- PASS: Correct concise statement of visibility only. It does not say the other devices are offline or absent from the network. Appareil follows the locale glossary.
- Width: 29 → 35 codepoints (1.207×); placeholders unexpanded; not rendered proof.

### mobile.remote_sessions.move_pick.on_this_computer
- EN: On this computer
- FR: Sur cet ordinateur
- PASS: Natural compact location status; ordinateur correctly denotes the connected relay computer, not the phone. Sur aligns with the existing Sur {device} reusable key.
- Width: 16 → 18 codepoints (1.125×); placeholders unexpanded; not rendered proof.

### mobile.remote_sessions.move_pick.right_now
- EN: Right now
- FR: Actuellement
- PASS: Actuellement is idiomatic for present location. Unlike immédiatement, it does not turn the current-location heading into urgency or an instruction.
- Width: 9 → 12 codepoints (1.333×); placeholders unexpanded; not rendered proof.

## Findings

### B-FR-1 — minor — mobile.remote_sessions.move_pick.destination_heading
Current: Déplacer ou copier vers
Proposed: retain Déplacer ou copier vers
Source-codepoint expansion 15 to 23 (1.533x) may add wrapping; these counts are not pixel or rendered overflow proof.
Retain idiomatic wording; defer to rendered narrow-phone wrapping/height check. No translation-only remediation cycle.

### B-FR-2 — minor — mobile.remote_sessions.move_pick.discovery_help
Current: Seuls les appareils associés aux sessions visibles sont proposés. Un appareil sans session visible ne peut pas encore être sélectionné. Ouvrez Local Operator sur l’autre ordinateur, puis tirez la liste des sessions vers le bas pour l’actualiser.
Proposed: retain Seuls les appareils associés aux sessions visibles sont proposés. Un appareil sans session visible ne peut pas encore être sélectionné. Ouvrez Local Operator sur l’autre ordinateur, puis tirez la liste des sessions vers le bas pour l’actualiser.
Source-codepoint expansion 178 to 245 (1.376x) may add wrapping; these counts are not pixel or rendered overflow proof.
Retain idiomatic wording; defer to rendered narrow-phone wrapping/height check. No translation-only remediation cycle.

## Integrity and evidence boundaries
Full source/draft/brief hashes independently verified, including usage file; exact checks and actual output are in audit.log. All seven source/context rows matched the brief. {device} occurs exactly once in cannot_reach; the other six messages take no arguments. Local Operator remains Latin unchanged. NFC passes; banned bidi controls absent. Input-copy redaction-marker scan returns zero; whole-draft metadata scan is separately recorded and can match descriptions of the scan itself. No claim of secret scanning beyond those markers.
ICU/CLDR: N/A for these seven simple messages: no plural/select, count, number/date skeletons or markup to preserve. French CLDR one/many/other was read in the style guide but no branches need inventing here. French is LTR; Urdu source-codepoint tracing and native RTL ordering claims are outside this audit.
Usage read confirms unchanged reuse of mobile.sidebar.row.on_device, blank/missing-only server-reason fallback, current-location and destination-heading roles. Draft bytes preserved. No repository edits, hook execution, tests, compiler, build, installs, push, browser or native work. Pseudo expansion is a source-length risk assessment, not a pseudo-render execution. SOURCEHOOKGAP remains OPEN and unvalidated.

## Verdict
Namespace mobile.remote_sessions.move_pick: **PASS WITH MINORS**, 7/7 linguistically clean, 0 unresolved blocker/major; two deferred width-check risks. Overall B-only verdict: **PASS WITH MINORS**. Parent must independently check A/B pair clearance; no claim here of pair clearance, shippability or rendered fit. No other namespace or locale audited.
