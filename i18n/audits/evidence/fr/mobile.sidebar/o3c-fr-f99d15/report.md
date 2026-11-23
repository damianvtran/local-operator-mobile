# O3-c fr audit — mobile.sidebar (o3c-fr-f99d15)

Verdict: **passed** — 0 BLOCKER/MAJOR. Keys: 9. Auditor: i18n-auditor, session f99d15fd59f3, anthropic/claude-opus-5-5 (independent of translator 0942405d8cd5).
Inputs: draft sha256 8512afaa…f547 (verified), brief e88beb09…fd17 (verified), source e7ebc391. Read route: ordinary file reads. Redaction marker hits: draft 0, English 0, brief 0 (pattern field excluded).

## Per-key

| key | fr | note |
|---|---|---|
| `mobile.sidebar.row_status.approval` | `approbation` | glossary term; 11/10 → FR-C1 |
| `mobile.sidebar.row_status.question` | `question` | ok, 8/10 |
| `mobile.sidebar.row_status.not_reachable` | `injoignable` | matches shipped « injoignable »; neutral; 11/14 |
| `mobile.sidebar.row_status.ended` | `terminée` | feminine, matches relay « Terminée » and row.new « nouvelle » |
| `mobile.sidebar.row_status.not_answering` | `ne répond pas` | matches shipped « Ne répond pas »; 13/14 |
| `mobile.sidebar.row_label.waiting` | `{kind, select, approval {approbation en attente} other {question en attente}}` | select kept (approval/other); whole natural phrases, 22/24 |
| `mobile.sidebar.row_label.working` | `en cours` | matches « En cours » |
| `mobile.sidebar.row_label.on_device` | `sur {device}` | {device} kept; matches shipped « sur {owner} » |
| `mobile.sidebar.row_label.open` | `ouverte` | ok; optional FR-C2 |

## Findings

### FR-C1 — MINOR — `mobile.sidebar.row_status.approval`
- Current: `approbation`
- Problem: 11 chars vs ~10 hint (+1). Glossary term (approvals → approbations) and noun pairing with « question » are right. The note's fallback « à approuver » is 11 chars too, so it buys nothing; « validation » (10) would break the glossary. Chip is shrink-0 (list-row.tsx L285-293); a design call only if the strip measures tight.
- Proposed: Keep « approbation »; correct the translator note (« à approuver » is also 11 chars, not 10).

### FR-C2 — NIT — `mobile.sidebar.row_label.open`
- Current: `ouverte`
- Problem: Spoken last for the conversation currently on screen. « ouverte » is idiomatic but, after « terminée » (« Paiements, terminée, ouverte »), can be heard as a lifecycle state (not closed). « affichée » names the on-screen sense unambiguously. English has the same ambiguity, so not gating.
- Proposed: affichée (optional)
