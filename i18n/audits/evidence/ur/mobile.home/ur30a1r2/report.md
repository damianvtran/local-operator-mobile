# Urdu (`ur`) DELTA audit — `mobile.home` — `ur30a1r2`

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 new findings.

- Delta of `ur30a1` (round 1). Auditor: `i18n-auditor`, session `b2d033d640d5`, model `anthropic/claude-sonnet-5-5` (no fallback seen). Route: ordinary worktree reads; `read_public_copy` refused for `src/i18n/**`; sidecars not routable; no copy-route receipt obtained or claimed.
- Round-1 target sha256 `6181c9bf8198ccc599883578625f7f1293539794021d952f5b761952c5c1e213`; current `108b20000f9a2036c7e5a00e78692d1c9c1361c53770148f6290f93129c32a07` — **changed**. en and context sha256 identical to round 1: {'en_identical': True, 'context_identical': True}.

## Changed keys (exactly these; no other key in this file changed)

- `mobile.home.connect_disabled_reason` (ur30a1-M1, MAJOR): `بھیجنے کے لیے کمپیوٹر سے منسلک ہو جائیں۔` — byte-exact whole string (40 chars). Carries both clauses of the source: the purpose “to send” (بھیجنے کے لیے) and the connect directive in the polite imperative. Role=status, “short, shares a slot with the connect action”: 40 chars vs 35 in round 1 — a +5 growth, acceptable for one sentence; the 29-cell alternative «…کمپیوٹر جوڑیں۔» stays available if the composer slot is measured tight.
- `mobile.home.tip.parallel` (ur30a1-m1, MINOR): `ذیلی ایجنٹس کو پھیلانے کے لیے متوازی کام مانگیں` — byte-exact whole string; 47 chars <= TIP_CHAR_BUDGET 48 (counted in code points by render.ts; sidecar: fragment, no final stop — none present).
- `mobile.home.suggestion.wake_summary` (ur30a1-m2, MINOR): `مجھے خلاصہ دے کر جگائیں` — byte-exact whole string; 23 chars. Carries “wake me” + “with a summary”; no final stop (sidecar). Fits the proposed ur=24 budget with 1 to spare; longest other chip is linear_mcp at 22.

Method: the current bytes with each prescribed replacement reverted hash to the round-1 sha256, so the changed-key set is exact (audit.log, `reverted_sha_matches_r1=True`).

## Width
- Tips (cap 48): parallel 47, schedule 41, search 41 — all fit.
- Chips vs proposed `SUGGESTION_CHAR_BUDGET.ur = 24`: wake_summary 23, linear_mcp 22, review_repo 20, team_of_agents 20, phone_access 17, last_turn 16 — all fit. Counts are code points, not measured pt width. **Action for the implementer:** `SUGGESTION_CHAR_BUDGET` is `Record<ShippedLocale, number>`; `ur: 24` must be added when ur ships (cf. `hi: 24`, with a measured-width comment).

## Not applied (optional)
- `ur30a1-n2` `startup_queue.unconfirmed` NIT left as `شروع ہونے کی تصدیق نہیں` — optional in round 1; open NIT only.

## Rendered
Through `formatMessage(parseMessage(·),{},'ur')` (ur not yet shipped, so `renderFor` would return English): each changed key renders to its catalogue text unchanged — see audit.log.

## Mechanical (audit.log)
`generate.ts --check` exit 0; `check-strings.ts` exit 0 (284 baselined, 0 new); bidi controls 0; redaction markers 0; Arabic yeh/kaf 0.

Evidence: `audit.log` sha256 `9f5fe7d720b0821b252df47a8553473ee79dc258051cb0839f1b4d300098d3d9`.

> Artefact hashes in this report were recomputed after publication path normalisation; see `../NOTE-paths.md` for what changed and why.
