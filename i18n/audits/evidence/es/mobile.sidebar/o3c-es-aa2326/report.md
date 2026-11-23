# O3-c es audit — mobile.sidebar (o3c-es-aa2326)

Verdict: **passed** — 0 BLOCKER/MAJOR. Keys: 9. Auditor: i18n-auditor (team lopdev), session aa2326d64c30, anthropic/claude-opus-5-5 (independent of translator a0a12eebb67d).
Inputs: draft sha256 e86851c57eaaddd6d615a1cff8ec5fb12422be6c3501dae6d31e880b330d84dd, brief e88beb09366b9ff795bf0ac916f30cef1c9a93c35fa4617575e904c7a6f5fd17, source e7ebc391. Redaction marker hits: draft 0, English 0, brief 0 (excluding its own redaction_scan.pattern field).

Read route: ordinary file reads (bash cat / python open) of the draft, the brief, the worktree catalogues and ~/local-operator/i18n glossary + style-guides/es.md; English via git show at e7ebc391. The checker ran on a sha-verified copy of the draft in the auditor's scratchpad (a guardrail refused handing the translator session's path directly to tsx; the copy hashes identically).

## Mechanical
Repo parseMessage (worktree tsx, read-only): no errors; params identical (`device` text; `kind` select with arms approval/other); keyset 9/9, none extra; all NFC; lowercase; no leading/trailing punctuation. Nine negative controls (drop key, rename placeholder, drop arm, rename select arg, unbalanced, redaction, NFD, over-width, trailing punct) all CAUGHT. Widths vs hints: approval 10/10, question 8/10, not_reachable 12/14, ended 10/10, not_answering 11/14. Rendered label: `Payments, aprobación pendiente, finalizada, en Studio Mac, sin conexión, abierta`.

## Linguistic review (all 9 keys)
- row_status.approval `aprobación`, question `pregunta`: correct nouns; match glossary approvals → aprobaciones and shipped row.asks `pregunta`. approval sits exactly at the 10-char hint.
- row_status.ended `finalizada`: feminine, agrees with implied conversación/sesión like shipped row.new `nueva`; matches relay.chrome `Finalizada`. Neutral receipt.
- row_status.not_answering `no responde`: identical to shipped diagnostics.stream_degraded; neutral.
- row_label.waiting `aprobación pendiente` / `pregunta pendiente`: whole idiomatic phrases, not a glued "esperando X"; correct agreement.
- row_label.working `trabajando`: matches relay.chrome `Trabajando`.
- row_label.on_device `en {device}`: natural; placeholder untouched.
- row_label.open `abierta`: feminine agreement consistent with the strip. (`finalizada, … abierta` in one label reads as oddly as English `ended, … open`; that is source structure, not a translation fault.)
- Register: fragments, no tú/usted exposure; neutral Spanish, no regionalisms.

## Findings

### ES-S1 — NIT — `mobile.sidebar.row_status.not_reachable`
- Current: `sin conexión`
- Problem: "sin conexión" is the shipped es rendering of en "offline" (mobile.settings.status.offline, diagnostics.stream_offline), so two distinct en states share one es word. On a remote row after "en {device}" it reads correctly and neutrally (no connection to that device) and fits 12/14; the shipped "No se puede contactar…" phrasing would not fit the chip.
- Proposed: Keep "sin conexión" (no change required); "no disponible" (13) only if a later slice must keep the phone's own Offline state distinct on the same screen.

## Out-of-scope observation (not a translation finding, does not gate)
`src/ui/components/list-row.tsx` line 356 paints `On {remote.device}` as a hard-coded English literal at e7ebc391, so an es reader sees `On Studio Mac` on the row while the screen-reader label says `en Studio Mac`. Source-side i18n gap for the slice owner.
