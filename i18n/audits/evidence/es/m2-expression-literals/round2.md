# m2-a2-es — es, ROUND 2 delta audit — verdict: clean-with-findings (0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT)

Auditor: i18n-auditor (independent of translator). ACTUAL served model: anthropic/claude-sonnet-5-5 (session header; no fallback). No MT/translation service; reasoning + python only. Nothing edited (the guardrail also refused writing into the m2-prep session's scratchpad, so this report lives in this session's scratchpad).

Inputs (sha256): es.v3.json a302af3d9727a0394653c665b23667364fccba7d75688c6c8cb1445d4aca967f; keys33.json f3a96f9a9d92cfdb7be5e981b02c3ad9be6bc15b0eba96e4967223ea85bc4a8f; es.v1.json b73f8235ab54305a44223355e8770df4da6acc2f461bc575c054b781418ebf3c.

## 1. Diff v1 -> v3 (python3)
Changed (8): account.route_direct (Conexión directa con {baseUrl} -> Conectado directamente a {baseUrl}); status.no_connection (Sin conexión -> Aún sin conexión); status.not_connected (Desconectado -> No conectado); diagnostics.stream_degraded (degradado -> No responde); computers.wait.host_answering (word order); tray.context_short (cont. -> ctx); tray.context_estimate (est. -> aprox.); tray.context_short_estimate (cont. (est.) -> ctx (aprox.)).
Added (6): region.label.working/subagents/todos/strip, back_to, back_to_session. 27 -> 33 keys.
session.fallback_name: v1 "sesión" -> v2 "tu sesión" -> v3 "sesión" (net v3 == v1; the v2 detour is reverted because back_to_session now carries the unnamed case).

## 2. Mechanical (python3 read-back of v3 vs keys33)
33/33 keys, order identical to keys33; placeholders per key == English == sidecar; no empties/edge whitespace; all NFC; no ICU plural/select in slice; English-identical values: app_name "Local Operator" (product) and tray.context_short "{percent}% ctx" (identical to English by design: sidecar calls ctx the standard abbreviation). No bidi controls (n/a es). PASS.

## 3. Round-1 findings adjudicated (A = deepseek, B = sonnet)
Own recount of shipped es catalogues (i18n-app-scan worktree, whole-token, case-sensitive): máquina 46 vs ordenador 7 (máquina dominant; translator's 46 confirmed, B's ~51 not reproduced); vídeo 1 / video 0 mobile (session.highlights.video_open); core vídeo 1 (wire.settings.static.description) / video 1 (wire.errors.files.video_type); conectando 1 (computers.badge.connecting); inactivo 0 / inactiva 2 (core relay.chrome subtitle.idle, schedules.state.dormant); activo 3; "No responde" 1 mobile + core relay.chrome.session.subtitle.not_answering; "no responde" 1 (session.subagent.unavailable_next, inside a sentence); "Desconectado" 0, "desconectado" 1 (history.gap_load_hint); aprox./est./ctx 0 shipped.

- A-01 / B-1 no_connection collision: FIXED correctly. "Aún sin conexión" keeps "yet"; differs from status.offline "Sin conexión" and stream_offline "sin conexión".
- A-02 / B-3 "cont." ambiguity: FIXED. "ctx" = 7 cells vs 15 for "de contexto" at 2 digits; genuinely narrower; wide forms keep "de contexto".
- A-03 "(est.)": FIXED. "(aprox.)" is native. Translator's +2-cell correction (8 vs 6) is right; A's +3 was overstated. Narrow estimate 16 cells vs wide 24.
- A-04 host_answering order: FIXED; "Esperando a que responda tu máquina en {host}." natural; second sentence unchanged and correct.
- A-05 / B-5 route_direct: FIXED; "Conectado directamente a {baseUrl}" grammatical, parallels connected_to, matches English predicate.
- B-2 "Desconectado" -> "No conectado": FIXED; mirrors English "Not connected" (refused), avoids "dropped link"; distinct from "Aún sin conexión"/"Sin conexión".
- A-06 / B-4 Vídeo vs video: DECLINED — UPHELD (mobile ships only "vídeo"; changing in isolation creates drift). Catalogue-wide spelling remains a manager call (core has both). Carried as NIT n1.

## 4. New / changed values, judged fresh
- region.label.working "actividad", subagents "agentes", todos "tareas", strip "estado": lowercase single words; read inside "{labels} abajo · desplazar ↓" as "actividad · agentes · tareas · estado abajo · desplazar ↓"; "abajo" is invariant so no agreement problem. agentes/tareas/estado reuse shipped terms (sheet_title.status "Tareas y agentes").
- back_to "Volver a {name}": reads with a real name ("Volver a Plan de lanzamiento"); matches shipped "Volver a Local Operator". A title beginning "El" would give "Volver a El plan" (no contraction on free-form titles; normal UI practice, not a defect).
- back_to_session "Volver a la sesión": natural, complete, sentence case, glossary term. Correct.
- fallback_name "sesión": lowercase bare noun, right as header title.
- connected_to + computers.added.fallback_name: "Conectado a tu máquina." / "Conectado a Mac mini." grammatical.
- Integration note (not a translation defect): back_to's sidecar note still says {name} may be the fallback noun; with fallback_name = "sesión" a call site that still composed back_to with fallback_name would render "Volver a sesión". back_to_session's note says it replaces back_to for unnamed parents — manager should confirm video.tsx and agent/[jobId].tsx switch (I did not open the branch).

## 5. Pair / distinctness / safety
- "Not answering": status.not_answering "No responde" == core relay.chrome.session.subtitle.not_answering "No responde" byte-identical (verified). diagnostics.stream_degraded changed degradado -> "No responde": consistent with the sidecar note ("open but not answering"); the translator cites statusFor mapping health degraded to Not answering (settings.tsx:727-728, 595-597) — taken from its changes file, not re-derived from the branch.
- no_connection "Aún sin conexión" / offline "Sin conexión" / stream_offline "sin conexión" / not_connected "No conectado": four distinct; offline vs stream_offline differ only by case, correct for pill vs lowercase diagnostic row.
- Stream row: inactivo / conectando / activo / sin conexión / No responde — five distinguishable states; masculine, agrees with "Flujo".
- Terse labels: none destructive or permission text; none safety-ambiguous.

## 6. Findings
MINOR m1 — mobile.settings.diagnostics.stream_degraded "No responde": only capitalized value in a row whose sidecar note requires "Lower-case diagnostic word, monospace line, one word". Translator records a deliberate exception for verbatim reuse of relay wording under a manager decision I cannot see. Suggested: "no responde" (lowercase form already shipped in session.subagent.unavailable_next). If verbatim reuse is binding, accept; does not gate.
NIT n1 — mobile.session.video.title_fallback "Vídeo": vídeo/video split across catalogues; neutral-Spanish guide would prefer "video". Keep for screen consistency; catalogue-wide decision.
NIT n2 — mobile.session.region.label.working "actividad": shipped copy for the same band says "línea de trabajo" (status_tray.hint). "actividad" is fine and fits the 'activity' sidecar; optional alignment.

No BLOCKER/MAJOR remains; round-1 MAJOR (M2-es-01) resolved. Ledger-eligible as `passed` (no ledger/record written by me).
