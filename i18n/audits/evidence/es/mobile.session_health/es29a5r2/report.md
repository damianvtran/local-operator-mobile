# Delta audit — mobile.session_health (es), round 2

- **Audit ID:** es29a5r2 · **Date:** 2026-10-29 · **Locale:** `es` · **Namespace:** `mobile.session_health`
- **Auditor:** `i18n-auditor` (lopdev team); session `3ef3aad1f731`; **served model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (provider quota; from this session's model-switch headers)
- **Head audited:** `f1c782f22a1f4a3f31f025282849cc62ba41b8c6` (branch `feat/i18n-spanish`)
- **Previous round:** `es29a5` at `c5f491ec`, `changes_requested` — 1 MAJOR (S-01), 2 accepted NIT (S-2, S-3)
- **This round's verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 0 new findings. S-01 resolved.

## What changed in this namespace

One of the 11 values differs from the round-1 bytes (`8552e560a683…` → `16c491040c36…`). The other ten are byte-identical to the values the round-1 report quotes for them — nine in its per-key table and `resume_refused` in its S-2 finding — compared as strings in `audit.log`, not by eye. The changed string is also the **same length as the one it replaced** (43 characters), so a length or layout check would have missed it entirely; the proof of the delta is the comparison against the quoted round-1 value. English source and context sidecar are unchanged (`727b7e49…`, `df998922…`), so the target moved against a fixed source.

| Key | Round 1 | Now |
|---|---|---|
| `still_reopening` | Sigue reabriendo — todavía no ha arrancado. | **Sigue reabriéndose — todavía no está lista.** |

## S-01 — RESOLVED

- **English:** "Still reopening — it has not come up yet." · **Context note:** replaces `reopening` after the reference client's 20 s cap; the reopen is still pending and the reader should know it has not silently failed.
- **The grammatical half is fixed.** `reabrir` is transitive, so round 1's «Sigue reabriendo» read as *it keeps reopening something* — repeated attempts, the opposite of the fact the line exists to state. The pronominal «Sigue reabriéndose» is the intransitive form Spanish requires here: the session is reopening (core uses the same verb family for this process — «reabrir la sesión», «la reabre» — while keeping «Reanudar» for the button, so the pair is intact).
- **The lexical half is fixed.** «todavía no está lista» states the pending fact in the app's own register: it is not the daemon's startup verb (`arrancar`, which core uses for a program: «Al arrancar…») and it does not claim a failure. It agrees with its referent (*la sesión*, feminine), which the preceding line «Reabriendo — esto puede tardar unos segundos» establishes, and the line keeps the two-clause shape of the English with a spaced em dash (U+2014 with a space either side) and a closing full stop matching `reopening`.
- **Safety.** The line promises nothing, invites no retry, and does not soften a failure into a wait: it says the reopen is still in progress and not finished. That is exactly the distinction the context note asks the string to carry.
- **Naturalness.** Read as a native: «Sigue reabriéndose — todavía no está lista.» is what a Spanish product ships for this state. The only nuance worth recording is that English says "has not come up yet" while Spanish says "not ready yet"; in a status line about a session those are the same reader-facing fact, and *lista* is the more idiomatic collocation after *reabriéndose*.
- **Note on provenance of the wording:** it matches the round-1 suggestion. I judged it on its own this round and the independent second pass, reading it without my findings, called it clean for the same grammatical reason — the agreement is a cross-check, not the basis of the verdict.

## Looked for, not found

The manager's risk for this fix was an over-shortening that loses the distinction the line exists for. I checked each way it could have gone wrong and none did: it does not revert to "still retrying", it does not claim success, it does not name a failure, it does not drop the pending/not-pending distinction, and it does not borrow startup vocabulary. No wording change is requested.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; `catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr)`; `check-strings: 284 finding(s), all baselined; 0 new; no growth vs c5f491ece9db`.
- 11 en / 11 es / 11 context; no missing, no extra, context parity true.
- **No placeholder, plural or select exists in this namespace**, so there is no ICU category or argument-name check to fail.
- Typography on the changed string: U+2014 spaced, full stop, no ASCII hyphen, no NBSP/U+202F, no double space, no leading/trailing space, no bidi control, no ASCII apostrophe or ellipsis.
- `npx vitest run src/i18n/__tests__/ src/features/home/` → 9 files, 121 tests pass (the suites that assert per-locale catalogue parity, key shape and the shipped-locale budget gates).

## Fit evidence (executed, same run)

At the status line's own type role (`meta` 12 px/500 per `tokens.gen.ts`), CoreText/SF Pro:

| String | Chars | Measured |
|---|---|---|
| «Sigue reabriéndose — todavía no está lista.» | 43 | **267.3 pt** |
| «Reabriendo — esto puede tardar unos segundos.» (unchanged, ships) | 45 | 300.6 pt |
| "Still reopening — it has not come up yet." (EN) | 41 | 248.6 pt |

It is 7.5 % wider than the English source — well inside the style guide's 15–25 % expectation for `es`, so the sentence grew less than budgeted — and narrower than the sibling line it alternates with. It introduces no fit risk. This is text metrics, not a rendered frame; no clipping claim is made.

**Calibration note.** Round 1's widths read ~2.7 % wider than this run's at the same nominal size (its 274.7 pt for this string reproduces at 12.33 pt here, not at the token's 12 pt; its chips read ~13 % wider, reproducing at 16 pt). Neither instrument changes this verdict — the delta is a few points and the string has ~100 pt of slack.

## Second independent pass

Reviewer job `ac1915638e4e`, read-only, served `radient/auto` (pinned `anthropic/claude-sonnet-5-5`; the same three-step quota fallback as this session), reading the changed value without my analysis: **clean**. It gave the same reason independently — *reabrir* is transitive, so the unreflexive form would read as repeated reopening of something, and «todavía no está lista» states the pending fact without the daemon's startup verb, agreeing with *la sesión*. It raised nothing new here; its two MINOR and two NIT belong to `mobile.home` and are recorded in that bundle.

## Previous rounds' accepted NITs

S-2 (`resume_refused` uses *reabrir* while the button says *Reanudar*) and S-3 (`ended_placeholder` drops the destination clause) are unchanged and remain accepted for the reasons in `es29a5`; neither is re-litigated here, and neither is a gate item.

## Limits

- No human native-speaker review. No rendered frame; the fit claim is executed text metrics against the type role, with no pixel or truncation claim.
- The auditor is not independent *by model*: both passes and the translator were served `radient/auto`. Independence is process, context and agent — disclosed, not closed.
- Translator provenance is as supplied by the requesting manager; this auditor did not observe the translator's run.
- No translation API, SDK, MT service or back-translation was used.
- This repository has no `i18n/ledger.json` and no audit-ledger command at this head; a ledger-ready row is proposed in `record.json`, explicitly unwritten, and this bundle is the durable record.
