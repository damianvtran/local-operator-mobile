# Audit — ru / mobile.session_health (ru30a3)

**Verdict: `changes_requested`** — 0 BLOCKER, 1 MAJOR, 0 MINOR, 0 NIT

| | |
|---|---|
| Locale | `ru` |
| Namespace | `mobile.session_health` |
| Keys | 11 (English = target) |
| Branch / head | `feat/i18n-russian` / `ba39018c493dda114d42a6b4d9dfbf337f4110f5` |
| Auditor | i18n-auditor (lopdev team), session 68877acd3c8a, **radient/auto** (primary anthropic/claude-sonnet-5-5 hit provider quota; fallbacks disclosed in record.json) |
| Second independent pass | reviewer (lopdev team), job 0e8a65e92a72, radient/auto — scope: this namespace |
| Machine translation | none |


## Findings

| ID | Severity | Key | Current | Problem | Replacement |
|---|---|---|---|---|---|
| ru30a3-F1 | **MAJOR** | `mobile.session_health.ended_placeholder` | Отправка откроет её в домашней папке… | The slot is clamped to ONE line (placeholderMaxLines={1} in the composer; the field's resting height must not grow). Measured 316.0 pt at the body step against the field's own recorded size — ~348 pt at a 390 pt viewport, which tracks the viewport and leaves ~278 pt at 320 pt. At 390 pt the string takes 91 % of the box and fits; at 320 pt it exceeds it by roughly 38 pt and clips, where the English source (266.7 pt) still fits. It is also 37 cells against the sidecar's recorded 36-cell translator budget, and one cell over is enough to clip. The sidecar itself records the remedy for this exact slot: French ships the shortest honest form («Envoyer rouvre…») and leaves the destination to the health sheet's ended_detail sentence. | **Отправка откроет её…** |

### ru30a3-F1 — mobile.session_health.ended_placeholder (MAJOR)

- **Current:** Отправка откроет её в домашней папке…
- **Problem:** The slot is clamped to ONE line (placeholderMaxLines={1} in the composer; the field's resting height must not grow). Measured 316.0 pt at the body step against the field's own recorded size — ~348 pt at a 390 pt viewport, which tracks the viewport and leaves ~278 pt at 320 pt. At 390 pt the string takes 91 % of the box and fits; at 320 pt it exceeds it by roughly 38 pt and clips, where the English source (266.7 pt) still fits. It is also 37 cells against the sidecar's recorded 36-cell translator budget, and one cell over is enough to clip. The sidecar itself records the remedy for this exact slot: French ships the shortest honest form («Envoyer rouvre…») and leaves the destination to the health sheet's ended_detail sentence.
- **Replacement:** Отправка откроет её… — measures **171.5 pt** at the same type step
- **Gate:** MAJOR — a visible truncation at the narrowest supported phone width. The translator flagged the cell count and shipped anyway; judged here as SHORTEN rather than ship.

## Considered and accepted (no change requested)

### `mobile.session_health.resume_gone` — ACCEPT — but the cross-screen claim in its sidecar cannot hold yet.

> Эта сессия больше не сохранена.

The sidecar asks for «the same words this app's Past sessions screen uses for the same fact». src/features/past/past.tsx still sets that sentence as a hardcoded English literal (`setRefusal("This session is no longer saved.")`), baselined in scripts/i18n/strings-baseline.json — check-strings tolerates it because it is an exact mirror of this catalogue value. So on a Russian device that screen will print English even after this wave ships. Not a defect in the translation; a code fix that belongs with whoever keys past.tsx.

## What was executed

`audit.log` in this directory is the transcript: the catalogue validator, `verify.mjs` for this namespace (key sets, placeholder names and types read by the repo's parser, plural arms against `Intl.PluralRules('ru')`, code tokens and product names, typography, terminal punctuation, and the rendered value of every key), then `verify.mjs --negative`, where each check must fail on an injected defect. `verify.mjs.txt` is the script that produced it.

## What could not be verified

- No frame was rendered: the app was not built, so these are copy-level findings, and a UI pass still has to see the ru strings on device.
- Widths are CoreText advances with the system face standing in for Figtree (absolute points approximate, ratios sound).
- The 320 pt composer field width is inferred from the sidecar's 390 pt measurement, not captured.

