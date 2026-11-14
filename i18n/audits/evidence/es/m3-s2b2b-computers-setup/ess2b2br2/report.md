# es audit, round 2 (delta): M3 S2b-2b (mobile.computers.setup.* / route_invalid.* / your_computer)

Auditor: i18n-auditor (team lopdev), session ca3b41d58102, model anthropic/claude-opus-5-5 (taken from the session system prompt's "Model:" line; no fallback seen). Independent of translator jobs 0bd7a05014d5 and 17e3058aff61, and of the round-1 auditor session 6f3c42e4c00a. No MT or translation service was used.
Inputs: brief sha256 9b37cb3d773809276595ae41ccf1eeab8c6385e9c8d33203187e97704f196c67 · v1 f262c2deb8e5e32c9dd1f41e3ca1d55ee1440985ec98d5bb86aa21f32589677a · v2 25282ad118814e73f09f36d4da4bb90bb3dbb85be5b1ec1872054667404c5552. All recomputed and all match. 27 keys. Redaction-marker hits: brief 0, v2 0.
Scope: v1..v2 delta only (round 1 at audits/es/report.md).

## Verdict: **passed**. 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT (no new findings)

## Mechanical
- v1→v2 changes exactly the 3 keys named in notes-es-v2.md: intro, create_title, create_help. The JSON line diff touches only lines 2, 5 and 6 (one key per line). The other 24 values are byte-identical, the key order is unchanged, and the order matches the brief.
- The 3 changed values parse with the repo parser e0027e61:src/i18n/messages.ts (blob 354697cf…). Their parameter maps are empty, which matches the English and the brief's `placeholders: []`. formatMessage output is identical to the source text.
- Whole of v2: 0 bidi controls; all values are NFC.

## Round-1 findings
- ES-S2B2B-01 MINOR create_title: **resolved**. The value is now «Crear uno en la máquina», exactly as suggested. The infinitive matches the two sibling headings, and the masculine «uno» agrees with its implicit antecedent «túnel» (the brief note says this route creates a new tunnel).
- ES-S2B2B-02 MINOR intro: **resolved**. «…ejecutar un conector y no entrar en reposo.» is grammatical: both infinitives depend on «tiene que». It matches the es catalogue's existing wording «Evita que entre en reposo» and «no está en reposo», and it no longer collides with the «activa» badge word.
- ES-S2B2B-03 NIT create_help: **resolved**. «En una terminal de la máquina que quieres controlar:» keeps the trailing colon that the call site needs. terminal_label «Terminal» is unaffected, because it has no article.

## Delta review (accuracy, register, terminology, fit)
None of the 3 values adds meaning, omits meaning or flips polarity. All are in tú register, and the terms match the catalogue (máquina, conector). Fit: create_title is 23 chars against 26 in English.

## Note
The lane path audits/es-r2/ was refused by the dangerous-delete guardrail (it treats files inside the local-operator state root as overwrites). These files were written to the auditor's own scratchpad for the lane to copy.
