# ur mobile.computers — round 2 delta audit (ur30b4r2)

Auditor: i18n-auditor (lopdev), model anthropic/claude-sonnet-5-5 (no fallback observed). Delta re-audit of round ur30b4. Route: ordinary worktree reads; read_public_copy refused for src/i18n/**; sidecars not routable; no receipt claimed. No human native review, no device frame.

Evidence: `audit.log` (one real run of `tools/run2.sh`), `tools/revert.py` (hash-revert proof), `tools/render2.ts` (byte-exact + renders through the app's parseMessage/formatMessage).

## Hash proof (a)
Every prescribed replacement was reverted in the current ur file and sha256 recomputed; the result equals the round-1 `input_hashes.ur` for all four group-B namespaces (schedules aba7a013…, projects 8beeb0a9…, notifications 100b416e… with zero swaps, computers a209bc7d…). en and context sidecars unchanged. So no key outside the prescribed set changed anywhere in group B.

## Hygiene (d, e)
bidi/zero-width controls 0 and redaction markers 0 in all 12 inputs; `generate.ts --check` rc 0; `check-strings.ts` rc 0 (0 new); scoped vitest 67 pass, 1 fail = `ur` not yet in SHIPPED_LOCALES (wiring, not copy; identical to round 1). Worktree status unchanged after the run (read-only).

## Verdict: PASSED (0 BLOCKER, 0 MAJOR, 0 open minors)

| id | key | result |
|---|---|---|
| C1 MINOR | password_placeholder | `lop mobile سے ملنے والا پاس ورڈ` byte-exact. `lop mobile` verbatim as the sidecar requires; the Latin command sits at the start of the string so the bidi algorithm keeps it an intact LTR island with no reorder of the command. Noun phrase = a placeholder, not an instruction. |

Nothing else in the computers file changed (hash proof above).

Open minors: none.
