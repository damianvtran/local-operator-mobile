# Spanish M2 remediation — round 1

Translator: `i18n-translator`, session `7321a144837e`; ACTUAL served model `openai/gpt-6.1-sol` (session header). No fallback/model switch, MT API, SDK or service used. Lane: bounded translation fix (<2 h). This is translation remediation and mechanical validation, NOT an independent audit or a passed ledger entry. No repository/catalogue/ledger edits or commits.

Inputs: `keys32.json`, `es.v1.json`, `r1/audit-es-A.md` (auditor session 7df96d3445f1, deepseek/deepseek-flash), `r1/audit-es-B.md` (reported anthropic/claude-sonnet-5-5), core `docs/I18N.md`, `docs/design/i18n.md` §§2.2/6, `i18n/style-guides/es.md`, `i18n/glossary.md`, existing mobile and core Spanish catalogues. Source/context is the manager-owned keys32 sidecar; the mobile worktree still contains the English expression call sites.

Output: `es.v2.json`, 32 keys in source order: 27 retained keys (9 changed values) plus 5 newly translated keys. Dispositions below count audit findings, including duplicate findings across streams: **9 fixed / 2 declined**.

## Recounted shipped usage (derived here)

Scanned all string values in `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/es/*.json` and `~/local-operator/local_operator/i18n/catalogues/es/*.json` with Python; case-sensitive whole-token regex, occurrences / strings containing term. These are working-tree catalogue counts, not claims that M2 candidate values have landed.

| Term | Mobile | Core |
|---|---:|---:|
| máquina | 46 / 46 | 40 / 40 |
| ordenador | 7 / 7 | 0 / 0 |
| equipo | 4 / 4 | 49 / 48 |
| vídeo | 1 / 1 | 1 / 1 |
| video | 0 / 0 | 1 / 1 |
| conectando | 1 / 1 | 1 / 1 |
| inactivo | 0 / 0 | 3 / 3 |
| activo | 3 / 3 | 3 / 3 |
| en directo | 0 / 0 | 0 / 0 |
| No responde | 1 / 1 | 2 / 2 |
| no responde | 1 / 1 | 1 / 1 |
| est. | 0 / 0 | 0 / 0 |
| aprox. | 0 / 0 | 0 / 0 |

Earlier approximate máquina counts (49/51) are not reproduced at these inputs: 46 is the present mobile recount, still dominant over ordenador. `equipo` is also a team term, so its core count is not evidence for translating computer that way.

Verified exact catalogue entries: mobile and core `relay.chrome.session.subtitle.not_answering = No responde`; `relay.chrome.session.subtitle.idle = Inactiva`; mobile `mobile.computers.badge.connecting = conectando`; `mobile.settings.diagnostics.stream = Flujo`; `mobile.session.highlights.video_open = Reproducir vídeo {name}`; `mobile.session.sheet_title.status = Tareas y agentes`; `mobile.settings.connection.status = Estado`. Thus lowercase diagnostic `inactivo` agrees with Flujo; `activo` denotes a healthy stream, distinct from `inactivo`, `conectando`, `No responde`, `sin conexión`. There is no shipped mobile `en directo` precedent requiring a new live term.

## Audit A — each finding

- **M2-es-01 — fixed.** `status.no_connection`: `Aún sin conexión`. `settings.tsx:717` is the unrouted branch; `:725–726` is stream offline. They must differ. `Aún` preserves “yet”; offline stays `Sin conexión` and diagnostic offline `sin conexión`.
- **M2-es-02 — fixed.** Narrow context values use `ctx`, not ambiguous `cont.`. Developer shorthand is deliberate, as allowed by the binding manager decision. At percent=45, normal/narrow are **15/7 cells**, estimated normal/narrow **24/16 cells**. No width exception. See width details below.
- **M2-es-03 — fixed.** Both estimate forms use `(aprox.)`, a readily understood approximate-value label, rather than requiring readers to expand `est.`. I do not adopt the auditor's categorical claim that `est.` cannot refer to estimado; the reason is clarity in a terse numeric strip, not proof that every other reading is invalid. The claimed +3-cell increase is also incorrect: `(aprox.)` is 8 cells versus `(est.)` 6, **+2**, counted here.
- **M2-es-04 — fixed.** `Esperando a que responda tu máquina en {host}.` puts the response verb earlier and preserves the host modifier. Kept the second sentence verbatim; it correctly distinguishes a provisioned route from a running machine. This is a readability choice, not correction of an ungrammatical v1 sentence.
- **M2-es-05 — fixed.** `Conectado directamente a {baseUrl}` uses the destination preposition `a` and retains the connected-state predicate. Also resolves B-5 without two competing formulations.
- **M2-es-06 — declined.** Keep `Vídeo` to match this screen's shipped `Reproducir vídeo {name}`. Mobile has 1 vídeo / 0 video; core has 1 each. A cross-catalogue spelling standardization is outside this slice, and changing this noun alone would create local drift. The finding itself advised not changing it in isolation. No blanket claim that one RAE-accepted spelling is uniquely correct is needed.

## Audit B — each finding

- **B-1 — fixed.** Same source-state evidence and `Aún sin conexión` fix as A-01.
- **B-2 — fixed.** `status.not_connected = No conectado`. `settings.tsx:718` is refusal, while stream-offline is a separate branch. Avoids implying a previously established link was dropped; agrees with the unconnected wording the A report itself names as shipped. A's preference for Desconectado was not a defect finding; this is an explicit choice between valid alternatives, favoring state specificity.
- **B-3 — fixed.** `ctx` in both narrow strings; independently measured narrower than wide forms. Full contexto would defeat the under-340pt purpose, so that alternative is declined, not the finding.
- **B-4 — declined.** Keep `Vídeo`, for the same direct shipped-screen evidence as A-06. No out-of-scope global spelling edit.
- **B-5 — fixed.** `Conectado directamente a {baseUrl}` restores the predicate, retains destination preposition `a`, and parallels `Conectado a {name}.`.

## Binding manager decisions / new keys / composition

1. `status.not_answering` remains **No responde**; `diagnostics.stream_degraded` changes from `degradado` to **No responde**, byte-identical to shipped relay.chrome. `statusFor` maps health `degraded` to Not answering (`settings.tsx:727–728`), and the diagnostic row reads the same `streamHealth` (`:595–597`). There is no evidence for a distinct degraded meaning here. Capital N in the diagnostic value is an intentional exception to the generic lower-case note because the explicit manager instruction requires verbatim reuse. Other diagnostic words remain lowercase.
2. Narrow forms are `{percent}% ctx` / `{percent}% ctx (aprox.)`; wide forms retain `de contexto`. At a two-digit percentage: `45% de contexto` = 15 cells, `45% ctx` = 7; `45% de contexto (aprox.)` = 24, `45% ctx (aprox.)` = 16. All characters in these rendered Spanish samples occupy one cell, combining characters zero; CJK would count as 2. The narrow pair saves 8 cells at every identical percentage length. Cell counts are not rendered phone-width proof; no layout evidence is claimed.
3. `Aún sin conexión` is distinct from offline, as above.
4. Computer composition: `Conectado a tu máquina.` / `Conectado a Mac mini.` both natural; computer fallback remains `tu máquina`. Session composition: new `Volver a {name}`; revise the existing session fallback **sesión → tu sesión**. `Volver a tu sesión` and `Volver a Plan de lanzamiento` are grammatical. `tu sesión` is also a natural lower-case noun phrase as the untitled-session header. This uses the manager's permission to revise a fallback to preserve both contexts: the bare citation noun would yield the unnatural `Volver a sesión`. **No split-key request** with this small possessive expansion. The source note's bare-noun preference is relaxed explicitly for grammatical composition; if a strict one-word header is required, split a navigation fallback `tu sesión` from header `sesión` instead.
5. Video noun stays `Vídeo`, matching the shipped screen.
6. Connecting/idle/live reuse `conectando`, `inactivo`, `activo`; idle inflection follows masculine Flujo rather than feminine sesión. Five stream states remain distinguishable.
7. Five added keys: `region.label.working = actividad`, `.subagents = agentes`, `.todos = tareas`, `.strip = estado`, `back_to = Volver a {name}`. `agentes`, `tareas`, `estado` reuse shipped label nouns, lowercased for inline composition. Example: `actividad · agentes · tareas · estado abajo · desplazar ↓` — no agreeing adjective is attached to the mixed list, and both punctuation tokens remain unchanged.

## Glossary proposals (not authoritative amendments)

- `ctx`: developer-facing narrow-only abbreviation for contexto; wide form stays contexto.
- `(aprox.)`: estimated numeric context-use fact; no shipped est./aprox. precedent found by the recount, so this is a new local wording choice for independent audit.
- `actividad`: inline working/activity region noun; other new region labels reuse established catalogue terms.

## Mechanical validation actually executed

Python assertions against the read-back `es.v2.json`: 32 keys; exact source order; placeholder-name sets equal English and source notes per key; no empty or edge-padded values; NFC; deliberate English-identical values only: `mobile.settings.account.app_name = Local Operator` (product name) and `mobile.session.tray.context_short = {percent}% ctx` (shared developer abbreviation). No plural/select messages occur in this slice. An initial local assertion allowed only the product name and correctly rejected the newly shared ctx string; corrected its explicit allowed set, reran, PASS. This was a validation expectation correction, not a translation bypass.

Repository catalogue validator actually run in mobile worktree: `node scripts/i18n/generate.ts --check` — exit 0; `src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`. Node emitted the pre-existing MODULE_TYPELESS_PACKAGE_JSON warning for messages.ts; not an error. This checks the existing repository catalogues, NOT this unintegrated scratch candidate. Candidate validation is the separate Python check, not a claim that catalogue integration or independent audit has passed.
