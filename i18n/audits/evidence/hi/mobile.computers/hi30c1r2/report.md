# Hindi (`hi`) — `mobile.computers` — round 2 (delta re-audit)

| | |
|---|---|
| Locale | `hi` |
| Namespace | `mobile.computers` (10 keys) |
| File group | B (77 keys across four namespaces) |
| Round | 2 — same-history delta re-audit |
| Parent audit | `hi30c1` (round 1: **passed**, no findings) |
| Audited head | `d4e31b1915b558171ded41501c741568f0854f3f` on `feat/i18n-hindi` |
| Auditor | `i18n-auditor` (lopdev), session `4d508455ed51`, served model `radient/auto` |
| Verdict | **passed** — 0 BLOCKER, 0 MAJOR, no findings |

## What this delta did to the namespace

Nothing. The file is **byte-identical** to the audited round-1 bytes: its sha256
equals `hi30c1`'s recorded `input_hashes.target.sha256`
(`0b38dc5d9c5b8eb132ec017d573ac46f4fdb6aa7887e9ce85be786e2a9ffb8a5`), which the
transcript prints side by side. The English source and sidecar are unchanged too,
so no key needed re-reading.

## Mechanical, re-run over the whole group

The independent verifier runs over all 77 group-B keys, this namespace included:
10 keys here, key set and key order identical to English, placeholder name sets
identical, every plural node carrying `one` + `other`, NFC clean, no ZWJ/ZWNJ or
bidi controls, no doubled spaces. No escalation lives in this file.

`node scripts/i18n/generate.ts --check` → exit 0; `check-strings` → 284
baselined, 0 new; `vitest run src/i18n src/features/schedules
src/features/projects` → 188 tests passed; `tsc --noEmit` → exit 0.

## Honest limits

Round-1 reasoning for this namespace is unchanged and is not re-derived here;
this bundle records absence of change, not a second semantic pass.
