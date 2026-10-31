# Urdu (`ur`) DELTA audit — `mobile.session_health` — `ur30a3r2`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 new findings.

- Delta of `ur30a3` (round 1). Auditor: `i18n-auditor`, session `b2d033d640d5`, model `anthropic/claude-sonnet-5-5` (no fallback seen). Route: ordinary worktree reads; `read_public_copy` refused for `src/i18n/**`; sidecars not routable; no copy-route receipt obtained or claimed.
- Round-1 target sha256 `4651263d664ab5ebb0dee5612f5ee6b8dfa31bc60b113968d5f9894ed09f0b86`; current `c7c08dbd0eb85fb7f06815229295a9f254cb7584d5eabb9f929d6ce875e89f4d` — **changed**. en and context sha256 identical to round 1: {'en_identical': True, 'context_identical': True}.

## Changed keys (exactly these; no other key in this file changed)

- `mobile.session_health.resume_no_route` (ur30a3-M1, MAJOR): `اس سیشن کو جاری رکھنے کے لیے کمپیوٹر سے منسلک ہو جائیں۔` — byte-exact whole string (55 chars). Keeps all clauses: “this session”, “to resume” (جاری رکھنے کے لیے), the missing prerequisite (computer), directive. Names the prerequisite, does not blame the session (sidecar).
- `mobile.session_health.resume_gone` (ur30a3-M2, MAJOR): `یہ سیشن اب محفوظ شدہ نہیں ہے۔` — byte-exact whole string (29 chars). Reads as “saved”, not “secure”; states the fact and does not invite a retry (sidecar: never invite a retry).
- `mobile.session_health.still_reopening` (ur30a3-n1, NIT): `اب بھی کھل رہا ہے — ابھی تک تیار نہیں ہوا۔` — byte-exact whole string (42 chars). Both clauses of the source (still reopening / has not come up yet) retained, em dash retained.

Method: the current bytes with each prescribed replacement reverted hash to the round-1 sha256, so the changed-key set is exact (audit.log, `reverted_sha_matches_r1=True`).

## Rendered
Through `formatMessage(parseMessage(·),{},'ur')` (ur not yet shipped, so `renderFor` would return English): each changed key renders to its catalogue text unchanged — see audit.log.

## Mechanical (audit.log)
`generate.ts --check` exit 0; `check-strings.ts` exit 0 (284 baselined, 0 new); bidi controls 0; redaction markers 0; Arabic yeh/kaf 0.

Evidence: `audit.log` sha256 `9f5fe7d720b0821b252df47a8553473ee79dc258051cb0839f1b4d300098d3d9`.

> Artefact hashes in this report were recomputed after publication path normalisation; see `../NOTE-paths.md` for what changed and why.
