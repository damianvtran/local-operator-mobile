# Delta audit (round 2) — ru / mobile.session_health (ru30a3r2)

**Verdict: `passed`** — 1 of 1 round-1 finding fixed byte-exactly and re-measured inside the field at 320 pt (171.5 of 278 pt); 1 new MINOR (non-gating) on the verb; no BLOCKER and no MAJOR

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.session_health` |
| Keys | 11 (English = target = context) |
| Branch / head | `feat/i18n-russian` / `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88` |
| Round-1 bundle | `i18n/audits/evidence/ru/mobile.session_health/ru30a3/` |
| Auditor | i18n-auditor (lopdev team), session c9aa2aca8837, **radient/auto** — same agent as round 1; the self-review is disclosed in record.json |
| Second independent pass | reviewer (lopdev team), job d473234f21a9, radient/auto (pinned anthropic/claude-opus-5-5) |
| Machine translation | none |

## Round-1 findings, re-checked against the shipped bytes

| Round-1 id | Severity | Key | Byte-exact vs prescription | Status |
|---|---|---|---|---|
| ru30a3-F1 | MAJOR | `mobile.session_health.ended_placeholder` | yes | fixed |

## Round-1 findings in detail

### ru30a3-F1 — `mobile.session_health.ended_placeholder` (fixed)

- **Prescribed (round 1):** Отправка откроет её…
- **Shipped at this head:** Отправка откроет её…
- **Byte-exact vs the prescription:** yes
- **Width of the value round 1 rejected → the value shipped now:** 316.0 pt → 171.5 pt
- **Judgement:** Byte-exact. 316.0 → 171.5 pt at 16 pt/400 against the 278 pt field at a 320 pt viewport: 61.7 % of the box with 106.5 pt of headroom, where the old value overflowed it by ~38 pt and clipped on its single clamped line. Cells: 20 against the sidecar's recorded 36-cell budget (the old value was 37, or 38 counting the ellipsis as two). The destination is not lost from the ru catalogue: the sidecar's own recorded remedy moves it to the health sheet, and ru's relay.health.ended_detail does say it — «…чтобы снова открыть сессию в вашей домашней папке.» — so the shortening drops nothing the locale does not state elsewhere.

## Delta findings

### r2-F1 — MINOR, `mobile.session_health.ended_placeholder`

- **Current:** Отправка откроет её…
- **Problem:** The fit and the honesty are fixed, but the verb is not this file's own. The source says *reopen*, and the app names that action «возобновить» (resume_refused, resume_no_route) and «открывается заново» (reopening), with the button itself reading «Возобновить» — while the placeholder says bare «откроет». A reader of an ENDED conversation is told sending will open it, not that it reopens or resumes it. There is room for the extra syllable now: the field is 278 pt and the budget 36 cells, and this string uses 20.
- **Recommended:** Отправка возобновит её… — measures 200.0 pt
- **Alternative:** Отправка откроет её заново… — 228.4 pt
- **Gating:** MINOR — non-gating. The sentence is not false (an ended session cannot be opened without reopening it), but it uses a different verb from the control that performs the same action.

## Considered and accepted (no change requested)

- `the 10 unchanged keys` — identical bytes and identical English/context sidecars, so round 1's verdict carries byte-for-byte; the mechanical suite was re-run over all 11 keys (111 checks, 0 failed).

## What was executed

`audit.log` is the captured `bash set -x` transcript of, in order: `git rev-parse` for branch and commit; `shasum -a 256` of the ru catalogue; the repository's own copy gate in both halves — `npm run -s i18n:catalogue:check` (`scripts/i18n/generate.ts --check`: the generated projection matches the JSON authoring source, every message parses, and every locale directory defines exactly the English keys namespace by namespace) and `npm run -s i18n:strings:check` (`scripts/i18n/check-strings.ts` against the shrink-only baseline); `node verify.mjs <namespace>`, which reads the strings through the repo's OWN parser and renderer (`parseMessage` / `formatMessage` / `pluralCategory`) and checks placeholder names and types, plural arms against `Intl.PluralRules('ru')`, code tokens, product names, typography and the rendered value of every key; and `node verify.mjs --negative`, thirteen injected defects each of which must be caught. `diff-vs-round1.txt` is the per-key comparison of these bytes against round 1's own rendered output, which is what binds the delta to the earlier audit.

## Independence and self-review

This is the SAME agent and session as round 1, grading replacements it prescribed itself. Disclosed, not papered over. Mitigations: every shipped value is compared BYTE-WISE with this session's own record.json rather than with prose; every width is re-measured on the same harness, whose two controls (the repo's recorded 189.4 pt Spanish chip, and the round-1 strings re-measuring to 296.2 / 313.8 / 306.0 / 316.0 pt) show the method is unchanged; and an independent second pass judged all seven delta strings from the guide, glossary and English only, without seeing this session's conclusions. It dissented on two of the seven, and this auditor rejected one of its replacement proposals on measurement.

## What could not be verified

- Figtree is not installed on this machine, so CoreText widths fall back to the system sans face and absolute points are approximate. Two controls make the ratios sound: the harness reproduces the repository's own recorded 189.4 pt Spanish-chip measurement to the tenth of a point, and it re-measures the round-1 strings to round 1's exact figures (296.2 / 313.8 / 306.0 pt for the three tips, 316.0 pt for the old placeholder), which is the evidence that this round used the same method.
- No rendered frame was captured: this is a copy audit and the app was not built or driven. A UI reviewer still has to look at the ru strings in a build; these are text advances, not screenshots.
- The 320 pt figures are derived, not captured: the composer's own chrome is subtracted from the viewport — mx-3 (12 pt each side) + px-2 (8 pt each side) + the two hairline borders = 42 pt — and the sidecar records the field at ~348 px at 390 pt, which is the same 42 pt, so 320 pt leaves 278 pt. The tip row's ~270 pt text box (the 288 pt row minus the 12 pt Info icon and gap-1.5) is round 1's own note, carried forward because the layout did not change.
- This delta round is bounded by design: it re-judges the changed values and re-runs the mechanical suite over every key of the namespace, and it carries the round-1 linguistic verdict for the unchanged keys because their bytes are identical (proved by sha256) and their English source and context sidecars are byte-identical to round 1 too.
- Independence is disclosed rather than claimed: this auditor is the same agent and session as round 1 and is therefore grading its own prescriptions.
