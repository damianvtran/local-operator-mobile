# Urdu (`ur`) DELTA audit — `mobile.account_routing` — `ur30a4r2`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 new findings.

- Delta of `ur30a4` (round 1). Auditor: `i18n-auditor`, session `b2d033d640d5`, model `anthropic/claude-sonnet-5-5` (no fallback seen). Route: ordinary worktree reads; `read_public_copy` refused for `src/i18n/**`; sidecars not routable; no copy-route receipt obtained or claimed.
- Round-1 target sha256 `d1308a7739a7ff12c0196989b26d223748007a049dcd189180ec679ba769054b`; current `5cd4429d292440f3a7d7100625e0ce8a9406d311b10463736568ef17e1df1103` — **changed**. en and context sha256 identical to round 1: {'en_identical': True, 'context_identical': True}.

## Changed keys (exactly these; no other key in this file changed)

- `mobile.account_routing.disconnected` (ur30a4-M1, MAJOR): `اکاؤنٹ روٹنگ تبدیل کرنے کے لیے کسی کمپیوٹر سے منسلک ہو جائیں۔` — byte-exact whole string (61 chars). Keeps “to change account routing” (the purpose clause) and “a computer” (کسی); does not call the relay outdated or claim an empty policy (sidecar).

Method: the current bytes with each prescribed replacement reverted hash to the round-1 sha256, so the changed-key set is exact (audit.log, `reverted_sha_matches_r1=True`).

## Rendered
Through `formatMessage(parseMessage(·),{},'ur')` (ur not yet shipped, so `renderFor` would return English): each changed key renders to its catalogue text unchanged — see audit.log.

## Mechanical (audit.log)
`generate.ts --check` exit 0; `check-strings.ts` exit 0 (284 baselined, 0 new); bidi controls 0; redaction markers 0; Arabic yeh/kaf 0.

Evidence: `audit.log` sha256 `9f5fe7d720b0821b252df47a8553473ee79dc258051cb0839f1b4d300098d3d9`.

> Artefact hashes in this report were recomputed after publication path normalisation; see `../NOTE-paths.md` for what changed and why.
