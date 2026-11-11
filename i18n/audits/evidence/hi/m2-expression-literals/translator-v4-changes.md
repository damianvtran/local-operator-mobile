# Hindi M2 — v4, round-2 accepted delta

Date: 2026-11-11. Translator session: `6735a5e26f5b`. ACTUAL served model: `openai/gpt-6.1-sol` (session model header); no fallback or MT service used. Lane: bounded copy fix (<2 h). This is translation remediation and mechanical validation, NOT an independent audit or a passed ledger record. No repository files or ledger rows edited; no commit made.

## Value changes (exactly three)

| Finding | Key | v3 → v4 |
|---|---|---|
| H-D-03 MAJOR, accepted | `mobile.settings.diagnostics.stream_degraded` | `उत्तर नहीं दे रहा` → `बाधित` |
| H-D-02 MINOR, accepted | `mobile.session.tray.context_short` | `{percent}% संद.` → `{percent}% संद॰` |
| H-D-02 MINOR, accepted | `mobile.session.tray.context_short_estimate` | `{percent}% संद. (अनुमान)` → `{percent}% संद॰ (अनुमान)` |

### H-D-03 verification and reasoning

Read the actual M2 worktree `~/local-operator-mobile/.worktrees/i18n-m2-scanner` at `9d99fa0f`: `src/features/settings/settings.tsx:741–744` maps stream state `degraded` to the Status pill's `mobile.settings.status.not_answering`; `:754–766` separately describes Diagnostics as the stream health enum, and selects `mobile.settings.diagnostics.stream_degraded`. English/context sidecar says `degraded`, a one-word diagnostic value. `बाधित` is a compact adjective describing the impaired stream, not the status sentence. The v3 diagnostic was byte-identical to its status counterpart; v4 restores the intended distinction. The Status pill stays `उत्तर नहीं दे रहा`.

Fresh catalogue recount (Python JSON values, not assumed from the audit): `उत्तर नहीं दे रहा` occurs in 3 core messages and 1 mobile message; the mobile occurrence is `relay.chrome.session.subtitle.not_answering`. `बाधित` occurs in neither set, so this is a deliberate diagnostic distinction, not a claim of existing glossary attestation. The source glossary has no required degraded-stream term. The earlier v1 decision and round-1 acceptance are reported by the independent R2 report, not independently re-audited here.

### H-D-02 verification, choice and widths

Fresh Python recount of message values: core `local_operator/i18n/catalogues/hi` has 37 message JSON files; mobile `i18n-app-scan/src/i18n/catalogues/hi` has 21 message JSON files plus 1 context sidecar. Thus the audit's 59 JSON-file total is correct if including that sidecar; the actual message-catalogue denominator is 58. The M2 worktree has the same 21-message/1-sidecar split. In both mobile branches, `संद.` = 0 hits; `॰` = 0; `संदर्भ` = 2. Core: `संद.` = 0; `॰` = 0; `संदर्भ` = 22. No claim that U+0970 is already shipped as a literal catalogue character.

Binding style guide `~/local-operator/i18n/style-guides/hi.md:55–60` explicitly gives the formatter's `10 अक्टू॰ 2026` example; this is the attestation for the abbreviation sign, not for the particular new short form. Use `संद॰` as a visibly marked short form of established `संदर्भ`. This avoids a misleading ASCII sentence stop without widening the existing narrow fact. The full word is allowed by the sidecar, but the actual `contextFact` comment (`app/(app)/session/[id].tsx:132–146`) specifically motivates the under-340pt variant to avoid a two-line activity band; keeping the short variant is the conservative delta. Existing estimate qualifier `अनुमान` is unchanged.

Measured with `~/local-operator/.venv/bin/python`, `rich.cells.cell_len` (the style guide's specified, optimistic model):

| Fact | 42% cells | 100% cells |
|---|---:|---:|
| old plain `संद.` | 7 | 8 |
| new plain `संद॰` | 7 | 8 |
| full plain `संदर्भ` | 8 | 9 |
| old narrow estimate `संद. (अनुमान)` | 14 | 15 |
| new narrow estimate `संद॰ (अनुमान)` | 14 | 15 |
| unchanged wide estimate `संदर्भ (अनुमानित)` | 16 | 17 |

The estimate stays 2 cells narrower than the wide form. These are terminal cell-model measurements, NOT a rendered native-app layout or font-width proof. A subsequent literal `rg` recount command was blocked by the shell's unbounded-root guard; it produced no search result and was not retried. Counts above were already derived by the explicit JSON-file/value recount, which also separates context sidecars.

## Required key-name repair (values unchanged, positions retained)

- `mobile.session.region.label.working` → `mobile.session.region.label_working`: `गतिविधि`
- `mobile.session.region.label.subagents` → `mobile.session.region.label_subagents`: `उप-एजेंट`
- `mobile.session.region.label.todos` → `mobile.session.region.label_todos`: `कार्य`
- `mobile.session.region.label.strip` → `mobile.session.region.label_strip`: `स्थिति`

All four new names match the actual English catalogue. All 33 English source strings were cross-checked against the worktree English catalogues; order is exactly `keys33.json` with these four renames. No other value changed.

## Declined items and retained nits

No requested accepted fix declined. Per brief, retain `below_labels` colon, `कनेक्ट है`, and `गतिविधि` exactly; no unrelated polish.

## Executed mechanical validation

Command: `python3 ~/.local-operator/sessions/6735a5e26f5b/scratchpad/validate_hi_v4.py`

Exit 0, actual output:

```text
PASS: 33 keys; exact source order with four underscore renames; 33 shipped English values match; placeholders per key match English and sidecar; no empties; all NFC; English-identical only Local Operator; exactly 3 value changes; all other values retained
Changed: mobile.settings.diagnostics.stream_degraded, mobile.session.tray.context_short, mobile.session.tray.context_short_estimate
```

No plural/select messages in this slice; all placeholder syntax is simple `{name}` and checked per key against both English and the supplied sidecar list. `Local Operator` is the sole English-identical value and is required by glossary product-name policy.

Repository validator, executed separately in `~/local-operator-mobile/.worktrees/i18n-m2-scanner`:

```sh
node scripts/i18n/generate.ts --check && node scripts/i18n/check-strings.ts
```

Exit 0, actual stdout:

```text
src/i18n/catalogue.gen.ts is current (642 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
scanner sha256: base=fd5946dfe556d9f0161b6093ab9792ae2049758d1870a56a0d888e4d95154d5c head=6b174462dcb13aaf3800eb99b7927982824bc02efdb7301e206c9ba5ce30c6f0
check-strings: 230 finding(s), all baselined; 0 new; verified historical debt vs d78ca8616286
```

Node emitted `MODULE_TYPELESS_PACKAGE_JSON` performance warnings for `messages.ts` and the isolated base scanner. Repository validators check the existing worktree, not this uninstalled scratch candidate; candidate-specific guarantees come from the Python run above. No passed audit or release claim.

## Glossary proposals

- Diagnostic stream `degraded` → `बाधित` (distinct from Status `not answering` → `उत्तर नहीं दे रहा`).
- Narrow context-window fact: `संद॰`, explicitly abbreviated from `संदर्भ`; U+0970 is supported by the style guide's formatter example, not attested as an existing catalogue abbreviation.

## Outputs

- `~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/hi.v4.json` — 33 keys, SHA-256 `fff352508a5c10c68ce30d9e978e8ddd15b249219b8f394a93a0900d343e12b7`.
- `~/.local-operator/sessions/3ef6295a5545/scratchpad/m2-prep/hi.v4-changes.md` — this remediation record.

Independent auditing and durable repository evidence integration remain with the manager/auditor; these requested scratch outputs are not audit artifacts of record.
