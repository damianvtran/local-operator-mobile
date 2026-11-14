# fr audit — round 2 (delta) — M3 S2b-2b

Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT (no new findings on the delta). Auditor: i18n-auditor, anthropic/claude-opus-5-5 (no fallback), session 4ea18dfd629a. Independent of the translator (3855e519638f / be835a5ba56f) and of the round-1 auditor (job bf50e3f03b14).

Hashes recomputed and matching: brief 9b37cb3d…c67, v1 8166df18…729a, v2 860ee7c4…51b5. Redaction-marker hits in brief: 0.

## Mechanical (delta)
- v1→v2: 27 keys each, same order; exactly the 6 keys listed in notes-fr-v2.md changed; other 21 byte-identical (raw diff: 6 lines out, 6 in, 29 lines each).
- Each changed value parses with messages.ts `parseMessage` and renders with `formatMessage(…, "fr")`; argument set equals English (amount_note: amount, command; not_address: scheme; http_public: example, insecure, scheme; the rest have none).
- No bidi controls, no U+0027, NFC; typography (U+2019, U+202F before ':', ' — ') matches the existing fr catalogue.

## Round-1 findings
| ID | Key | Disposition | Ruling |
|---|---|---|---|
| FR-1 | setup.create_title | « Créer un tunnel sur l’ordinateur » | Resolved; now parallel to « Associer un tunnel existant » |
| FR-2 | setup.attach_help | « est réservée à un tunnel existant » | Resolved |
| FR-3 | setup.amount_note | « indique où trouver ce prix » | Resolved; pronoun ambiguity removed, meaning (step 1 points to where the price is shown) kept |
| FR-4 | your_computer | value kept, source-side code item | Accepted per round-1 ruling; value byte-identical |
| FR-5 | route_invalid.not_address | « L’adresse doit commencer par {scheme}. » | Resolved |
| FR-6 | route_invalid.http_public | comma before « ou » removed | Resolved |
| FR-7 | setup.intro | « les sessions qui tournent sur votre propre ordinateur » | Resolved; v2 uses U+202F before ':' where the round-1 suggestion had U+0020, so v2 is the more correct of the two |

## New findings on the delta
None. I checked « tournent » next to the catalogue’s « exécuter »: here it describes sessions running on a machine, not a program being executed, so it is idiomatic and the register is neutral. The connector clause in the same sentence still uses « exécuter », which is consistent.

Write location: a guardrail refused the lane directory audits/fr-r2/, so these files are in the auditor’s own scratchpad (the lane copies them). Ledger not written; no repo writes.
