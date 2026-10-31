# ur · mobile.projects · ur30b2 — independent audit

**Verdict: changes_requested** · keys 15/15 (en/ur), keyset equal: True · BLOCKER 0 · MAJOR 1 · MINOR 1 · NIT 0

Auditor: i18n-auditor (lopdev), session b5f20e88b803, model anthropic/claude-sonnet-5-5 (no fallback observed).

Route: Catalogue, sidecars, scripts and generate.ts read by ordinary worktree file reads and `git show origin/main:` of the core repo; NOT the read_public_copy route (refused for src/i18n/**). Context sidecars are nested JSON, not routable. No receipt claimed.

Redaction markers: **0** · bidi/zero-width control chars in target: **0** · `generate.ts --check`: current · placeholder-name parity: 0 mismatches.

## Findings

### P1 — MAJOR — `mobile.projects.project_name_hint`

- current: `لمبائی 1 سے 64 حروف؛ نام میں الفبائی حروف، ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔`
- replacement: `لمبائی 1 سے 64 حروف؛ نام میں صرف انگریزی حروف، 0 سے 9 تک ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔`
- why: The sentence is 'the reader's only warning before a refusal' and must keep the allowed characters exact (sidecar). To an Urdu reader «الفبائی حروف» means letters of the alphabet — including their own — and «ہندسے» includes ۱۲۳. The relay accepts ONLY ASCII (core projects._NAME_RE = ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$): control run shows 'پروجیکٹ' and '٣٤' are refused. An Urdu user is therefore invited to type exactly what gets refused. Replacement states the alphabet (انگریزی حروف) and digits (0 سے 9) explicitly.
- verified: origin/main:local_operator/projects.py _NAME_RE read; repl.ts name-grammar control (پروجیکٹ false, alpha true, ٣٤ false); replacement parsed and rendered.

### P2 — MINOR — `mobile.projects.draft_kept_note`

- current: `آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ نئی چیز شروع کرنے کے لیے خانے صاف کریں۔`
- replacement: `آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ کچھ نیا شروع کرنے کے لیے خانے صاف کریں۔`
- why: «نئی چیز» is a word-for-word 'something new' calque; «کچھ نیا» is the natural Urdu.
- verified: repl.ts render before/after.

## Observations (not findings on the Urdu text)

- write_receipt: 4 kinds x 8 actions (7 codes + unknown) all rendered and read (audit.log): verb-final, correct masculine agreement for پروجیکٹ/سنگ میل/bare name, unknown kind and unknown action fall back to the 'other' arm / «اپ ڈیٹ کیا گیا». «“{subject}”» quoting is a translator addition (EN is unquoted); harmless and consistent with delete_body/remove_milestone_body.
- milestones.count «{total} میں سے {completed} سنگ میل»: سنگ میل is invariant in the plural, so no agreement needed at any count; joined row meta «5 میں سے 2 سنگ میل · 3 سیشنز». sessions.count one/other with سیشنز matches core usage (relay.approvals «تمام سیشنز»).
- English-source observation (NOT an Urdu defect, not filed as one): the relay regex also rejects a leading '.' or '_' (only [A-Za-z0-9] may start a name), but the EN hint (and the Urdu) say only 'can't start with a hyphen'. The Urdu follows the source faithfully.

## Per-key read (each key read against EN text, sidecar note and, where composed, its call site)

| key | role | result |
|---|---|---|
| `delete_body` | confirm | ok |
| `draft_kept_note` | help | P2 |
| `milestone_slash_note` | help | ok |
| `milestones.count` | meta | ok |
| `milestones.none` | meta | ok |
| `project_name_hint` | help | P1 |
| `remove_milestone_body` | confirm | ok |
| `session_state.filed_by` | status | ok |
| `session_state.missing` | status | ok |
| `session_state.not_running` | status | ok |
| `sessions.count` | meta | ok |
| `sessions.live` | meta | ok |
| `stale_badge` | status | ok |
| `write_receipt` | status | ok |
| `write_unknown_note` | status | ok |

Commands and their actual output: `audit.log` in this directory.
