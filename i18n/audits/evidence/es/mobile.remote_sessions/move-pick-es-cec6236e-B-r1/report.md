# Spanish fresh B translation audit — Move PickBody

## Verdict
**PASS WITH MINOR WIDTH RISKS** for `mobile.remote_sessions` **only the seven new `move_pick.*` keys**. All seven are linguistically clean; **0 blocker, 0 major, 3 minor width-risk notes, 0 nit**. No other namespace or whole-app coverage is claimed. Pair clearance remains **PENDING parent verification**, not granted by this B report.

- Source: `9362cce8a631791b676b2d2c9eda90c43fc7e11c` in the requested frozen worktree.
- B auditor: `translation-auditor`, session `cec6236edd99`, distinct from translator `e9b2c7a56448` and A `4ea33df6bad7`.
- Actual model: **openai/gpt-6.1-sol**, from the explicit conversation `[model switch]` receipt (provider failure: quota, fallback from anthropic/claude-opus-5-5). This is a conversation-visible execution receipt, not independent provider telemetry. Linguistic judgement and bundle production occurred after the switch; initial required reads began before it. Model diversity is not claimed or required; actor independence is established by distinct session IDs.
- Native-human review: waived by the supplied brief. This is independent native-language LLM judgement, not a claim of human identity.
- Original draft preserved; SHA-256 `1e929c06d54c13309587f3f6965165a30943bb381bde41333a636c768a550fb8` re-derived from bytes.
- Brief SHA-256 `5a72dfd72dc820b1fa8e73d78b97807581572334ee0fd25eb2eab346e759ebca` independently verified.

## Method and independence
Read the actual seven Spanish values beside English, their seven context rows, PickBody source lines 444–537, current Spanish remote-session and sidebar glossary examples, core Spanish style guide and shared glossary. Formed the independent linguistic verdict before examining A's schema field names; A report/per-key reasoning was not read. The manager-supplied ledger necessarily exposes previous summary fields, but they are not evidence for this judgement. A record was inspected only for field names/shapes after judgement. No other locale was audited.

Read route: ordinary approved absolute-path JSON/TSX/guidance reads and dependency-free Python/git blob reads. Nested context JSON is explanatory data, not a routable copy key; no `read_public_copy` or keyed-reader receipt is claimed. Full-file hashes are integrity evidence, not a claim of full-file linguistic coverage.

## Per-key linguistic judgement

### `mobile.remote_sessions.move_pick.cannot_reach` — PASS
- English: Can't reach {device}
- Spanish: No se puede contactar con {device}
- Reason: Natural impersonal connection status, not a claim that the phone is disconnected. Matches existing unreachable: No se puede contactar con el equipo propietario. The opaque name occupies the exact single {device} slot; no article or translation is imposed on it.
- Length: 20 → 34 codepoints, 1.700×; synthetic +30% literal-growth stress sample: 44 codepoints including brackets.

### `mobile.remote_sessions.move_pick.destination_heading` — PASS
- English: Move or copy to
- Spanish: Mover o copiar a
- Reason: Mover and copiar retain the established verbs in row_long_press_hint. Infinitives are idiomatic for a destination heading, and a introduces the destination radio choices; no operation-start claim or final punctuation.
- Length: 15 → 16 codepoints, 1.067×; synthetic +30% literal-growth stress sample: 23 codepoints including brackets.

### `mobile.remote_sessions.move_pick.discovery_help` — PASS
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Spanish: Esta app solo ofrece los dispositivos que aparecen en tus sesiones. Si un dispositivo no tiene ninguna sesión visible, aún no puedes seleccionarlo. Abre Local Operator en el otro equipo y desliza la lista hacia abajo para actualizarla.
- Reason: Idiomatic tú register in tus/puedes/Abre/desliza, consistent with Comprueba/Actualiza in the existing namespace. Solo makes the documented visibility limitation explicit, not an invented restriction. dispositivos names generic destinations; equipo means the other computer. No visible session remains the selection limitation; both opening Local Operator and pulling the list downward to refresh are present.
- Length: 178 → 235 codepoints, 1.320×; synthetic +30% literal-growth stress sample: 308 codepoints including brackets.

### `mobile.remote_sessions.move_pick.no_answer` — PASS
- English: It did not answer when this computer asked.
- Spanish: No respondió a la solicitud de este equipo.
- Reason: Respondió a la solicitud is normal computing prose, not the literal calque preguntó. The omitted subject is the unreachable computer in the preceding status; de este equipo correctly identifies the requesting relay computer, not the phone. Source branch retains nonblank server reasons verbatim; this sentence is fallback only.
- Length: 43 → 43 codepoints, 1.000×; synthetic +30% literal-growth stress sample: 58 codepoints including brackets.

### `mobile.remote_sessions.move_pick.no_devices` — PASS
- English: No other devices are visible.
- Spanish: No hay otros dispositivos visibles.
- Reason: No hay otros dispositivos visibles is natural neutral Spanish and preserves visible, rather than asserting that other devices are offline or absent from the network. dispositivo matches the shared device glossary.
- Length: 29 → 35 codepoints, 1.207×; synthetic +30% literal-growth stress sample: 48 codepoints including brackets.

### `mobile.remote_sessions.move_pick.on_this_computer` — PASS
- English: On this computer
- Spanish: En este equipo
- Reason: En este equipo is compact and idiomatic. equipo matches equipo propietario/conectado and este equipo in the existing remote-session namespace; it does not rename the relay computer as the phone. The unrelated existing sidebar máquina does not create new drift in this seven-key scope.
- Length: 16 → 14 codepoints, 0.875×; synthetic +30% literal-growth stress sample: 21 codepoints including brackets.

### `mobile.remote_sessions.move_pick.right_now` — PASS
- English: Right now
- Spanish: Ahora mismo
- Reason: Ahora mismo is a normal temporal section heading, not an instruction to act. Sentence case and lack of final punctuation match the source and surrounding compact labels.
- Length: 9 → 11 codepoints, 1.222×; synthetic +30% literal-growth stress sample: 17 codepoints including brackets.

## Findings — one batched list

### ES-B1 — minor — `mobile.remote_sessions.move_pick.cannot_reach`
- Current text: No se puede contactar con {device}
- Proposed text: retain `No se puede contactar con {device}` pending a rendered check.
- Reason: Measured 20→34 codepoints (1.700× English); wrapping is allowed but overflow/extra height remains unverified without a rendered frame.
- Translator recommendation: Retain the accurate current wording; defer a narrow-phone rendered wrapping check. Do not open a minor-only translation round.
- Disposition: deferred — rendering excluded from this audit; no linguistic fix required.

### ES-B2 — minor — `mobile.remote_sessions.move_pick.no_devices`
- Current text: No hay otros dispositivos visibles.
- Proposed text: retain `No hay otros dispositivos visibles.` pending a rendered check.
- Reason: Measured 29→35 codepoints (1.207× English); wrapping is allowed but overflow/extra height remains unverified without a rendered frame.
- Translator recommendation: Retain the accurate current wording; defer a narrow-phone rendered wrapping check. Do not open a minor-only translation round.
- Disposition: deferred — rendering excluded from this audit; no linguistic fix required.

### ES-B3 — minor — `mobile.remote_sessions.move_pick.discovery_help`
- Current text: Esta app solo ofrece los dispositivos que aparecen en tus sesiones. Si un dispositivo no tiene ninguna sesión visible, aún no puedes seleccionarlo. Abre Local Operator en el otro equipo y desliza la lista hacia abajo para actualizarla.
- Proposed text: retain `Esta app solo ofrece los dispositivos que aparecen en tus sesiones. Si un dispositivo no tiene ninguna sesión visible, aún no puedes seleccionarlo. Abre Local Operator en el otro equipo y desliza la lista hacia abajo para actualizarla.` pending a rendered check.
- Reason: Measured 178→235 codepoints (1.320× English); wrapping is allowed but overflow/extra height remains unverified without a rendered frame.
- Translator recommendation: Retain the accurate current wording; defer a narrow-phone rendered wrapping check. Do not open a minor-only translation round.
- Disposition: deferred — rendering excluded from this audit; no linguistic fix required.

## Integrity and limits
- Verified worktree HEAD, English/context/usage hashes against approved brief and their committed blobs; verified current Spanish glossary hashes against draft and committed blobs. Exact seven-key set, English/context equality and independent actor IDs checked.
- `{device}` survives exactly once in `cannot_reach`; other six strings have no arguments. Renamed/dropped-placeholder and injected-bidi negative controls were detected. Device-name values are not translated or normalized by this audit; source passes `remoteDeviceLabel(session)` directly. No runtime formatting behaviour is claimed.
- All seven draft values are NFC, with zero Unicode bidi controls. Local Operator survives in exact Latin spelling once in discovery help. Source and target have no markup tokens to preserve.
- **ICU/CLDR: N/A** beyond the simple `{device}` argument. No plural/select/ordinal branch, count, number/date/time skeleton exists in these messages; Spanish `one/many/other` is therefore not applicable here.
- `equipo` = computer; `dispositivo` = device; `mover`/`copiar` = move/copy. No invented term or glossary drift in these seven keys. Tú address and sentence case are consistent; existing sidebar máquina is outside this copy delta and was not changed.
- Static source inspection confirms a trimmed nonblank server unreachable_reason still wins; server reasons are not translated. Existing `mobile.sidebar.row.on_device` reuse and its `{device}` mapping remain untouched. This is source inspection, not executable validation.
- Exact-pattern redaction-marker scan found zero hits in the seven English/Spanish values, seven context rows and selected glossary examples; separately, zero in raw draft/brief/ledger including metadata. The exact regex and scopes are in audit.log. Not a secret audit or proof against every possible marker spelling.
- Width evidence is Unicode codepoint counts and synthetic +30% literal-padding samples with placeholders preserved: neither pixels nor font/layout measurements. Minor flags are conservative risks, not demonstrated overflow. Small relative expansion in Ahora mismo (9→11) and heading (15→16) does not justify another finding absent a tighter measured budget; all rows' counts are recorded.
- Spanish is LTR: Urdu codepoint trace/native ordering requirements are not applicable. No claim is made about embedded arbitrary-name bidi presentation.
- No repo edits, commits, hooks, testsuite, compiler, build, install, push, browser or native execution. No generated catalogue or baseline changes. **SOURCEHOOKGAP remains OPEN and is not validated or repaired by this audit.**

## Namespace and overall conclusion
`mobile.remote_sessions` (seven new `move_pick` keys): **linguistically clean, 7/7 read; pass with 3 deferred minor width risks**. Overall B audit: **PASS WITH MINOR WIDTH RISKS**, unresolved blocker/major **0**. Pair clearance, hook gap disposition and release/runtime validation remain the parent's responsibility. Batch these notes with other B readers before translator remediation; preserve this exact original draft.
