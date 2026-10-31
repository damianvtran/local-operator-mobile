# ur mobile.schedules — round 2 delta audit (ur30b1r2)

Auditor: i18n-auditor (lopdev), model anthropic/claude-sonnet-5-5 (no fallback observed). Delta re-audit of round ur30b1. Route: ordinary worktree reads; read_public_copy refused for src/i18n/**; sidecars not routable; no receipt claimed. No human native review, no device frame.

Evidence: `audit.log` (one real run of `tools/run2.sh`), `tools/revert.py` (hash-revert proof), `tools/render2.ts` (byte-exact + renders through the app's parseMessage/formatMessage).

## Hash proof (a)
Every prescribed replacement was reverted in the current ur file and sha256 recomputed; the result equals the round-1 `input_hashes.ur` for all four group-B namespaces (schedules aba7a013…, projects 8beeb0a9…, notifications 100b416e… with zero swaps, computers a209bc7d…). en and context sidecars unchanged. So no key outside the prescribed set changed anywhere in group B.

## Hygiene (d, e)
bidi/zero-width controls 0 and redaction markers 0 in all 12 inputs; `generate.ts --check` rc 0; `check-strings.ts` rc 0 (0 new); scoped vitest 67 pass, 1 fail = `ur` not yet in SHIPPED_LOCALES (wiring, not copy; identical to round 1). Worktree status unchanged after the run (read-only).

## Verdict: PASSED (0 BLOCKER, 0 MAJOR, 0 open minors)

| id | key | result |
|---|---|---|
| S1 MAJOR | state.dormant | `خوابیدہ` byte-exact, whole value (one word, no full stop, as the sidecar requires). Row-slot state word, visibly different from `disabled`=«بند» and from the parked clause «رکا ہوا — …», so the dormant/disabled distinction the English draws is now carried. |
| S2 MAJOR | supervisor.not_running | byte-exact WHOLE sentence. Clause check against EN+sidecar: installed (انسٹال تو ہے) + not running (مگر چل نہیں رہی) + consequence (نہیں چلیں گی) + scope "below" (نیچے دی گئی) — all present, nothing dropped. Gender agreement سروس…رہی correct. Side by side with unsupported/unverifiable the three now share «بیداریوں کی نگرانی»; the trio reads as one family. |
| S3 MINOR | show_more.wakes/.monitors | byte-exact. Renders at 1/2/21: «1 مزید بیداری دکھائیں» / «2 مزید بیداریاں دکھائیں» / «21 مزید بیداریاں دکھائیں»; «1 مزید نگرانی دکھائیں» / «2 مزید نگرانیاں دکھائیں» / «21 مزید نگرانیاں دکھائیں». Singular only at 1 (Intl.PluralRules ur: 1→one, 2/21/100→other), matching the sidecar; «اور» ambiguity gone. |

Composed lines (b): `head.next` «3 شیڈول شدہ · اگلی بار 4m بعد», `head.overdue` «3 شیڈول شدہ · 2h سے تاخیر», `summary.monitors_*` «5 فعال», «5 میں سے 2 کو توجہ درکار», `tail.failed` «3 ناکام», `truncated` at 5/1, 5/2, 21/21 — all unchanged and correct. State slots side by side: بند / خوابیدہ / میعاد ختم / پرانی / انتظار میں — five distinct words.

Open minors: none.
