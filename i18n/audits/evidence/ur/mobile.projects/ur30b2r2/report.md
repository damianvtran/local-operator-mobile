# ur mobile.projects — round 2 delta audit (ur30b2r2)

Auditor: i18n-auditor (lopdev), model anthropic/claude-sonnet-5-5 (no fallback observed). Delta re-audit of round ur30b2. Route: ordinary worktree reads; read_public_copy refused for src/i18n/**; sidecars not routable; no receipt claimed. No human native review, no device frame.

Evidence: `audit.log` (one real run of `tools/run2.sh`), `tools/revert.py` (hash-revert proof), `tools/render2.ts` (byte-exact + renders through the app's parseMessage/formatMessage).

## Hash proof (a)
Every prescribed replacement was reverted in the current ur file and sha256 recomputed; the result equals the round-1 `input_hashes.ur` for all four group-B namespaces (schedules aba7a013…, projects 8beeb0a9…, notifications 100b416e… with zero swaps, computers a209bc7d…). en and context sidecars unchanged. So no key outside the prescribed set changed anywhere in group B.

## Hygiene (d, e)
bidi/zero-width controls 0 and redaction markers 0 in all 12 inputs; `generate.ts --check` rc 0; `check-strings.ts` rc 0 (0 new); scoped vitest 67 pass, 1 fail = `ur` not yet in SHIPPED_LOCALES (wiring, not copy; identical to round 1). Worktree status unchanged after the run (read-only).

## Verdict: PASSED (0 BLOCKER, 0 MAJOR, 0 open minors)

| id | key | result |
|---|---|---|
| P1 MAJOR | project_name_hint | byte-exact WHOLE sentence. All source clauses survive: length 1–64, allowed character classes (letters, digits, dot, underscore, hyphen), no spaces, cannot start with a hyphen. |
| P2 MINOR | draft_kept_note | byte-exact; both sentences intact (kept from last visit + clear fields to start something new). |

### (c) Truth of the hint against `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
(core `projects.py` line 85 read from origin/main; truth table run in audit.log.) «صرف انگریزی حروف» is true: Urdu letters (پروجیکٹ), accented Latin (é) REJECT. «0 سے 9 تک ہندسے» is true: Arabic-Indic (٣٤), Extended (۱۲) and Devanagari (१२) digits REJECT; ASCII digits ACCEPT. Dot/underscore/hyphen inside ACCEPT; 64 chars ACCEPT, 65 REJECT; space and leading hyphen REJECT. Hence the Urdu hint is now a true statement of the grammar, and in fact more accurate than a bare «letters» for an Urdu reader whose own script has letters the field refuses.

Remaining gap, unchanged and NOT an Urdu defect: the regex also rejects a leading `.` or `_` (the first character must be alphanumeric), but the English source says only "can't start with a hyphen", and the Urdu faithfully mirrors it. This is an observation about the English source (and its sidecar's "must stay exact"); fixing it in Urdu alone would make ur diverge from the other locales. Suggested source wording for whoever owns en: "…can't start with a dot, underscore or hyphen." Not gating.

`write_receipt` unaffected: all project/milestone × created/completed/reopened/added/updated/removed/deleted renders unchanged («پروجیکٹ “alpha” بنایا گیا۔», «سنگ میل “alpha” حذف کیا گیا۔» …).

Open minors: none (the en-source observation above is not a ur finding).
