# ur mobile.notifications — round 2 delta audit (ur30b3r2)

Auditor: i18n-auditor (lopdev), model anthropic/claude-sonnet-5-5 (no fallback observed). Delta re-audit of round ur30b3. Route: ordinary worktree reads; read_public_copy refused for src/i18n/**; sidecars not routable; no receipt claimed. No human native review, no device frame.

Evidence: `audit.log` (one real run of `tools/run2.sh`), `tools/revert.py` (hash-revert proof), `tools/render2.ts` (byte-exact + renders through the app's parseMessage/formatMessage).

## Hash proof (a)
Every prescribed replacement was reverted in the current ur file and sha256 recomputed; the result equals the round-1 `input_hashes.ur` for all four group-B namespaces (schedules aba7a013…, projects 8beeb0a9…, notifications 100b416e… with zero swaps, computers a209bc7d…). en and context sidecars unchanged. So no key outside the prescribed set changed anywhere in group B.

## Hygiene (d, e)
bidi/zero-width controls 0 and redaction markers 0 in all 12 inputs; `generate.ts --check` rc 0; `check-strings.ts` rc 0 (0 new); scoped vitest 67 pass, 1 fail = `ur` not yet in SHIPPED_LOCALES (wiring, not copy; identical to round 1). Worktree status unchanged after the run (read-only).

## Verdict: PASSED (0 BLOCKER, 0 MAJOR, 0 open minors)

`mobile.notifications.json` (ur) is sha256-identical to round 1 (100b416e13a6ac49…), zero replacements prescribed or applied; en and context unchanged. The ur-vs-ur hash proof therefore covers the whole file.

N1 (MINOR) `dismiss` / `detail.nothing_to_dismiss` use «ہٹائیں»: NOT applied by the implementer; ACCEPTED. My round-1 grading was MINOR / allowed variance, not a glossary breach, and the TUI already uses «ہٹائیں», so changing the mobile copy to «خارج کریں» would split one concept across surfaces. Closed as accepted variance; no further action.

Open minors: none.
