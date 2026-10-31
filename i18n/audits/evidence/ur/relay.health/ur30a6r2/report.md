# Urdu (`ur`) DELTA audit — `relay.health` — `ur30a6r2`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 new findings.

- Delta of `ur30a6` (round 1). Auditor: `i18n-auditor`, session `b2d033d640d5`, model `anthropic/claude-sonnet-5-5` (no fallback seen). Route: ordinary worktree reads; `read_public_copy` refused for `src/i18n/**`; sidecars not routable; no copy-route receipt obtained or claimed.
- Round-1 target sha256 `8588632afd90999a47232def24678eb2db64da3be442f0829012c35182e6aa0e`; current `8588632afd90999a47232def24678eb2db64da3be442f0829012c35182e6aa0e` — **IDENTICAL**. en and context sha256 identical to round 1: {'en_identical': True, 'context_identical': True}.

Nothing changed in this namespace; the round-1 `passed` verdict stands. Group-wide gates re-run: `generate.ts --check` exit 0, `check-strings.ts` exit 0, bidi 0, redaction markers 0 (audit.log).

## Mechanical (audit.log)
`generate.ts --check` exit 0; `check-strings.ts` exit 0 (284 baselined, 0 new); bidi controls 0; redaction markers 0; Arabic yeh/kaf 0.

Evidence: `audit.log` sha256 `d936abb07191f0a9ce1afcb7cb5ec527451b0ef1690ed447efc2b9f0f83315fb`.
