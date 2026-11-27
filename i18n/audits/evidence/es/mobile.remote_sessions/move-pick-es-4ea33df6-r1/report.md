# Spanish translation audit — round 1

Scope: `9362cce8a631791b676b2d2c9eda90c43fc7e11c` · `mobile.remote_sessions.move_pick.*` · exactly **7 keys read**. Namespace slice verdict: **passed_with_minors**; overall linguistic verdict **passed**. **0 unresolved blocker/major; 3 deferred minor width risks.** Not a clearance for the whole namespace or shipping.

Auditor: independent translation-auditor session `4ea33df6bad7`; translator session `e9b2c7a56448`. Actual served model **openai/gpt-6.1-sol**, from visible execution [model switch] receipt (quota fallback from anthropic/claude-opus-5-5). Independent session, same fallback model family as translator; no claim of different-model diversity or human native-speaker review. Spanish-language LLM judgment, not API translation or human/native proof.

## Per-key assessment

### mobile.remote_sessions.move_pick.cannot_reach
**EN:** Can't reach {device}
**ES:** No se puede contactar con {device}
Natural calm impersonal reachability status, reusing existing «No se puede contactar con». The remote computer remains the subject of the status; {device} occurs exactly once and is opaque, without gender/article rewriting. No phone error implied.
Verdict: passed_with_minor_width_risk; findings: S1. Width (codepoints only): {"english_codepoints": 20, "spanish_codepoints": 34, "ratio": 1.7, "delta_codepoints": 14}

### mobile.remote_sessions.move_pick.destination_heading
**EN:** Move or copy to
**ES:** Mover o copiar a
Natural infinitive section heading, not an imperative or progress claim. Mover and copiar exactly match existing row_long_press_hint; a introduces the destination choices. Sentence case and no punctuation match context. One extra codepoint is not material expansion.
Verdict: passed; findings: none. Width (codepoints only): {"english_codepoints": 15, "spanish_codepoints": 16, "ratio": 1.0667, "delta_codepoints": 1}

### mobile.remote_sessions.move_pick.discovery_help
**EN:** This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
**ES:** Esta app solo ofrece los dispositivos que aparecen en tus sesiones. Si un dispositivo no tiene ninguna sesión visible, aún no puedes seleccionarlo. Abre Local Operator en el otro equipo y desliza la lista hacia abajo para actualizarla.
Idiomatic professional tú register: tus, puedes, Abre, desliza match existing Comprueba/Actualiza. Restricts offers to devices visible through sessions, retains aún and both steps in order: open Local Operator on the other equipo, then swipe the list downward to refresh. Local Operator unchanged; no claim of network-wide discovery. Dispositivo is generic destination; equipo is computer. App is natural neutral contemporary UI Spanish, not a register defect.
Verdict: passed_with_minor_width_risk; findings: S3. Width (codepoints only): {"english_codepoints": 178, "spanish_codepoints": 235, "ratio": 1.3202, "delta_codepoints": 57}

### mobile.remote_sessions.move_pick.no_answer
**EN:** It did not answer when this computer asked.
**ES:** No respondió a la solicitud de este equipo.
Idiomatic omitted remote-computer subject; respondió a la solicitud naturally renders the English computer request, avoiding a literal anthropomorphic preguntó. Este equipo remains the requesting relay computer, not the phone. Code inspection confirms this is a client fallback only when trimmed server reason is absent; server reason is not translated.
Verdict: passed; findings: none. Width (codepoints only): {"english_codepoints": 43, "spanish_codepoints": 43, "ratio": 1.0, "delta_codepoints": 0}

### mobile.remote_sessions.move_pick.no_devices
**EN:** No other devices are visible.
**ES:** No hay otros dispositivos visibles.
Natural factual status preserving otros and visibles: it does not say devices are offline or absent from the network. Generic dispositivo remains distinct from computer equipo. Grammatical plural is not ICU count logic.
Verdict: passed_with_minor_width_risk; findings: S2. Width (codepoints only): {"english_codepoints": 29, "spanish_codepoints": 35, "ratio": 1.2069, "delta_codepoints": 6}

### mobile.remote_sessions.move_pick.on_this_computer
**EN:** On this computer
**ES:** En este equipo
Natural location fragment En este equipo matches existing equipo conectado/propietario and reused remote-location En {device}. Does not substitute phone or introduce ordenador/máquina. No punctuation.
Verdict: passed; findings: none. Width (codepoints only): {"english_codepoints": 16, "spanish_codepoints": 14, "ratio": 0.875, "delta_codepoints": -2}

### mobile.remote_sessions.move_pick.right_now
**EN:** Right now
**ES:** Ahora mismo
Ahora mismo is an idiomatic current-state section label in this position, not a command to act immediately. Existing sidebar also uses ahora mismo; sentence case and no punctuation match the compact heading.
Verdict: passed; findings: none. Width (codepoints only): {"english_codepoints": 9, "spanish_codepoints": 11, "ratio": 1.2222, "delta_codepoints": 2}

## Findings (all non-gating, deferred)

### S1 — minor — mobile.remote_sessions.move_pick.cannot_reach
Current: No se puede contactar con {device}
Proposed: No se puede contactar con {device}
Reason: 34 vs 20 source codepoints (+14, 70.0% expansion); potential phone wrapping/height risk, not observed overflow.
Action: Retain accurate wording; owning visual lane should check wrapping/height on narrow phones with long device names where applicable. No translation rewrite on codepoint evidence alone.
Disposition: deferred — rendered verification is outside this read-only linguistic audit; no minor-only remediation round

### S2 — minor — mobile.remote_sessions.move_pick.no_devices
Current: No hay otros dispositivos visibles.
Proposed: No hay otros dispositivos visibles.
Reason: 35 vs 29 source codepoints (+6, 20.7% expansion); potential phone wrapping/height risk, not observed overflow.
Action: Retain accurate wording; owning visual lane should check wrapping/height on narrow phones with long device names where applicable. No translation rewrite on codepoint evidence alone.
Disposition: deferred — rendered verification is outside this read-only linguistic audit; no minor-only remediation round

### S3 — minor — mobile.remote_sessions.move_pick.discovery_help
Current: Esta app solo ofrece los dispositivos que aparecen en tus sesiones. Si un dispositivo no tiene ninguna sesión visible, aún no puedes seleccionarlo. Abre Local Operator en el otro equipo y desliza la lista hacia abajo para actualizarla.
Proposed: Esta app solo ofrece los dispositivos que aparecen en tus sesiones. Si un dispositivo no tiene ninguna sesión visible, aún no puedes seleccionarlo. Abre Local Operator en el otro equipo y desliza la lista hacia abajo para actualizarla.
Reason: 235 vs 178 source codepoints (+57, 32.0% expansion); potential phone wrapping/height risk, not observed overflow.
Action: Retain accurate wording; owning visual lane should check wrapping/height on narrow phones with long device names where applicable. No translation rewrite on codepoint evidence alone.
Disposition: deferred — rendered verification is outside this read-only linguistic audit; no minor-only remediation round

## Integrity, scope and limitations
Pinned brief/draft/source hashes independently verified; exactly seven expected keys, English and nested context match brief; duplicate JSON keys rejected. One exact {device}, six empty argument sets; synthetic name substitutions preserve opaque names. No ICU plural/select branches, number/date skeletons or markup: CLDR plural review **N/A** for all seven (Spanish has one/many/other, but none required here). Spanish is LTR: RTL review **N/A**; banned bidi controls absent. No added product-name translation. Existing 24-key remote-sessions and 53-key sidebar catalogues read for glossary/register context, not independently certified as translated scope. Existing sidebar máquina is pre-existing and not propagated; new equipo follows remote-session computer terminology, not glossary equipo=team.
Redaction scan explicit regex and actual output are in audit.log: zero approved-copy input hits and zero draft-copy hits; metadata-inclusive hits separately counted, not mistaken for masked user-facing copy. No keyed/public-reader receipt: ordinary approved worktree/scratch reads; nested context is explanatory data, not a routable key.
Pseudo examples use brackets plus 35% tilde padding and measured codepoint counts only. No font geometry, shaping, rendered fit, device/native, human-native, tests, build, install, hook or runtime claims. Source hook evidence gap remains **OPEN**, not validated or fixed by this audit. Source inspection of server fallback is not execution evidence. Repository status remained clean.
No blocker/major translator remediation required. If such findings arise in a later audit, return them to translator; never self-author/fix reviewed copy.

## Verdict
`mobile.remote_sessions` seven-key move_pick slice: **passed_with_minors** (7/7 linguistic pass). Overall: **passed_with_minors**, 7 keys audited; width S1–S3 deferred to rendered verification, separate source-hook gap OPEN.
