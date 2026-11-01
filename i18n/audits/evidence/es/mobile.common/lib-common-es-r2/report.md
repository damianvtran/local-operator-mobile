# lib-common-es-r2 - mobile.common (es) - DELTA audit of lib-common-es-r1

**Verdict: passed** - 0 BLOCKER, 0 MAJOR. 6/6 keys. Auditor: i18n-auditor, session c1967ad9dd38, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text (AS SHIPPED NOW): `src/i18n/catalogues/es/mobile.common.json` sha256 `7a7984bee951441f16fb3c461863ea62896621c49219bc60c8362ca237e75880`; en `3d1a8007b0ea260984f2868949859e55bfa31ea14beb2b6574fb2a2c578e604d`; context `6d8c765e302f556f53140aae70ac2dba66125cac7fbf04e81dc7fcbf43edf633`. Round-1 bundle recorded `ed13003eed33e826439bcf11cca0c85089df3585a20226b0f7782d1373b313c2` and judged «Listo»; the shipped file now has «Hecho», so lib-common-es-r1 does not attest the shipped bytes (same defect class as review R1-1). This bundle does.

## Key changed since round 1 (derived)
- `mobile.common.done`: «Listo» → «Hecho». No other key changed.

Proof: `tools/common_delta.py` reverts «Hecho»→«Listo» in the shipped raw bytes; the result hashes to the sha256 recorded by lib-common-es-r1 (audit.log: "== recorded round-1 sha256 : True"). `git diff HEAD` shows the same single-line change. The round-1 bundle's one finding (n1, `back` «Atrás» vs desktop «Volver», NIT, keep) is untouched by this change.

## Verdict on «Hecho» in this context
**Correct; keep.** The sidecar role is a sheet-closing button whose choices already applied ("nothing is submitted by pressing it"). Core es renders the same role - `relay.session.tags.done`, sidecar "Closes the sheet; every assignment already landed as its own write" - as «Hecho», so the two surfaces now agree. «Hecho» is a past-participle state label ("it is done") that fits a button closing already-applied choices, and unlike «Listo» ("ready", which can read as "ready to go/submit") it does not suggest a pending action - the sidecar LIMIT says this is not save/submit. Distinct from `save` «Guardar» and `cancel` «Cancelar»; no punctuation; 5 chars, no fit hazard. It is rendered by the three Library sheets (library-screen.tsx:439, 550, 625); no other call site. «Hecho»/«Listo» now occurs exactly once across all 10 es mobile namespaces (audit.log), so there is no internal inconsistency. Register: tú-neutral, matches the other imperative/infinitive labels.

## Other stale mobile.common bundles
None. All seven `mobile.common` round-1 records were compared (audit.log, common_stale.py): fr, hi, ru, ur, vi, zh-CN match both target bytes and the en/context hashes; only es was stale. en and context hashes match for all seven including es.

## What was checked (audit.log)
`generate.ts --check` current (180 keys, 12 namespaces); 6 keys = en = sidecar; valid JSON; non-empty strings; NFC; no Cf/Cc/bidi; no placeholders/ICU arms (none in source); no final stops; six values pairwise distinct; each rendered through `parseMessage`/`formatMessage` (src/i18n/messages.ts): Atrás, Cancelar, Hecho, Guardar, Enviar, Reintentar.

## Findings
None new. (`lib-common-es-r1-n1` NIT, keep, remains as recorded in round 1.)
