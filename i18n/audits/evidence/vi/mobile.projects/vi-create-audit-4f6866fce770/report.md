# Vietnamese project creation/status audit

Auditor: translation-auditor; model: openai/gpt-6.1-terra. Reviewed commit: 5d48015a75804c50638063492ecd6742ddf61af0. Scope: 17 keys, read in both locales via 34 successful keyed public-copy calls.

## Verdicts
- `mobile.projects.create`: clean, 10 keys. Name and tag examples remain identical (`my-project`, `ios, q4`); labels and help preserve the source intent.
- `mobile.projects.status`: clean linguistically, 7 keys; **rendered width check outstanding**. `active` → `đang thực hiện` (6 → 14 characters), `done` → `hoàn thành` (4 → 10), and `planning` → `lập kế hoạch` (8 → 12) are materially longer. These are natural phrases, not established overflow defects. Check wrapping and touch targets at narrow widths and large text; the source uses flex-wrap and comments describe a two-row target (`project-create.tsx:263–266`). Character counts are not pixel measurements.
- Overall: clean linguistically with rendered width check outstanding, not a rendered-layout sign-off.

All 17 pairs contain no curly braces or angle-bracket markup; thus there are no ICU/plural branches, interpolation placeholders, number/date skeletons, or angle-bracket markup in this scope to preserve. Vietnamese is left-to-right; RTL check not applicable. No tests, Node, installation or browser were used. No sidecar was invoked; it was previously described as unroutable, not verified anew.

Values are captured in record.json; exact keyed route receipts are in audit.log. Scans checked for the literal byte marker `[REDACTED]` only, before reading the four listed input files; no other redaction marker detection is claimed. The earlier blocked evidence bundle is preserved.
