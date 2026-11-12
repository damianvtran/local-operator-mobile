# m2-au-es-B — es, Lane B (round 1) — verdict: clean-with-findings
Auditor model actually served: anthropic/claude-sonnet-5-5. Candidate es.v1.json (27 keys).
Mechanical (python3): key set and order == keys27.json; placeholders ({baseUrl},{percent}x4,{labels},{host},{name}) identical; no empties; all NFC; only English-identical = app_name (deliberate). No manual bidi controls (n/a es).
Recounted shipped usage (es catalogues, mobile.*): máquina ≈51 vs ordenador 7 -> candidate's "máquina" follows dominant shipped/M1 term. Shipped: "No responde" (relay.chrome), "conectando" (computers.badge), "vídeo" (session.highlights.video_open), "{percent}%" no space (text_size).
connected_to + fallback_name: "Conectado a tu máquina." / "Conectado a Mac mini." grammatical; no article/case hazard.
Counts: 0 BLOCKER, 0 MAJOR, 3 MINOR, 2 NIT.
1 MINOR mobile.settings.status.no_connection "Sin conexión" == status.offline "Sin conexión" (and stream_offline): different states in the same Status row collapse; "yet" lost. Suggest "Aún sin conexión".
2 MINOR mobile.settings.status.not_connected "Desconectado" (refused) implies a dropped link. Suggest "No conectado".
3 MINOR mobile.session.tray.context_short / context_short_estimate "{percent}% cont." — "cont." ambiguous (contenido/continuación). Suggest "{percent}% ctx" / "{percent}% ctx (est.)", or full "{percent}% de contexto".
4 NIT mobile.session.video.title_fallback "Vídeo": consistent with shipped mobile, but wire catalogue uses "video" and guide wants region-neutral; decide once across catalogues.
5 NIT mobile.settings.account.route_direct "Conexión directa con {baseUrl}" drops the verb; "Conectado directamente a {baseUrl}" would parallel connected_to.
