# Delta audit (round 2) — ru / mobile.account_routing (ru30a4r2)

**Verdict: `passed`** — 0 round-1 findings; the namespace is byte-identical to its audited round-1 bytes and re-ran clean (142 checks, 0 failed)

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.account_routing` |
| Keys | 14 (English = target = context) |
| Branch / head | `feat/i18n-russian` / `2921aea7b1de32f3d64a4df5c8a1a1b5eaab9f88` |
| Round-1 bundle | `i18n/audits/evidence/ru/mobile.account_routing/ru30a4/` |
| Auditor | i18n-auditor (lopdev team), session c9aa2aca8837, **radient/auto** — same agent as round 1; the self-review is disclosed in record.json |
| Second independent pass | reviewer (lopdev team), job d473234f21a9, radient/auto (pinned anthropic/claude-opus-5-5) |
| Machine translation | none |

## Round-1 findings

None — round 1 recorded no findings for this namespace.

## Considered and accepted (no change requested)

- `all 14 values` — The target file's sha256 is IDENTICAL to the bytes audited in round 1 (c1d8cfd327be840a…), and the English catalogue and context sidecar are identical too, so the round-1 `passed` verdict stands byte-for-byte. This round re-ran the mechanical suite over all 14 keys rather than re-litigating wording that did not move.

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
